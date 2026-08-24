import { z } from "zod";
import { getIdentitySessionPort } from "@/lib/auth/server";
import { AppError } from "@/lib/http/errors";
import {
  WorkspaceSlugConflictError,
  runOnboardingTransaction,
  findIdempotencyRecord,
  updateIdempotencyResponseBody,
} from "@/lib/onboarding/onboard-owner";
import { getDb } from "@/lib/db/client";
import { computeCanonicalBodyHash } from "@/lib/idempotency/idempotency-port";
import type { KlikFrameApp } from "@/lib/http/app";

/**
 * POST /api/v1/onboarding (API_SPEC.md §2, KF-ONB-001).
 *
 * Access: authenticated owner session WITHOUT an existing workspace.
 * Idempotency-Key header: required (API_SPEC.md §1.4).
 */
export function registerOnboardingRoute(app: KlikFrameApp): void {
  app.post("/onboarding", async (c) => {
    const requestId = c.get("requestId");
    const session = await getIdentitySessionPort().resolveSession(c.req.raw);
    const sessionExpired =
      session.kind === "expired" ||
      (session.kind === "authenticated" && session.session.expiresAt.getTime() <= Date.now());
    if (session.kind !== "authenticated" || sessionExpired) {
      return c.json(
        {
          error: {
            code: "AUTH_REQUIRED",
            message: sessionExpired ? "Session expired" : "Authentication required",
            request_id: requestId,
          },
        },
        401,
      );
    }

    const idempotencyKey = c.req.header("Idempotency-Key");
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 255) {
      return c.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Idempotency-Key header must be 16-255 characters",
            request_id: requestId,
          },
        },
        400,
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Request body must be valid JSON",
            request_id: requestId,
          },
        },
        400,
      );
    }

    // API_SPEC.md §9: unknown fields are rejected on sensitive mutations.
    const payloadSchema = z.strictObject({
      business_name: z.string().min(1).max(255),
      slug: z
        .string()
        .min(3)
        .max(80)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase alphanumeric with hyphens"),
      owner_display_name: z.string().min(1).max(255),
      phone_e164: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
    });
    const parsed = payloadSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Payload validation failed",
            details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
            request_id: requestId,
          },
        },
        400,
      );
    }

    const now = new Date();

    const requestBodyHash = computeCanonicalBodyHash(parsed.data);

    try {
      const result = await getDb().transaction(async (tx) => {
        // API_SPEC.md §1.4 replay: an existing committed record for this
        // scope+key short-circuits to its stored response — but only when
        // the body hash matches; a different body with the same key is a
        // 409 IDEMPOTENCY_CONFLICT.
        const existing = await findIdempotencyRecord(tx, {
          principalId: session.session.identity.authUserId,
          route: "/api/v1/onboarding",
          key: idempotencyKey,
        });
        if (existing !== null) {
          if (existing.requestBodyHash !== requestBodyHash) {
            throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with a different request body");
          }
          return { replayed: true, stored: existing.responseBody };
        }

        const result = await runOnboardingTransaction(tx, {
          profile: {
            authUserId: session.session.identity.authUserId,
            displayName: parsed.data.owner_display_name,
            phoneE164: parsed.data.phone_e164 ?? null,
            now,
          },
          workspace: {
            name: parsed.data.business_name,
            slug: parsed.data.slug,
            now,
          },
          audit: { requestId },
          idempotency: {
            workspaceId: null,
            principalId: session.session.identity.authUserId,
            route: "/api/v1/onboarding",
            resourceId: null,
            key: idempotencyKey,
            requestBodyHash,
            responseStatus: 201,
            responseBody: {},
            expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            now,
          },
        });

        const responseBody = {
          data: {
            profile: { id: result.profileId, display_name: parsed.data.owner_display_name },
            business: {
              id: result.workspaceId,
              name: parsed.data.business_name,
              slug: result.workspaceSlug,
              status: result.workspaceStatus,
            },
            membership: { role: "owner", status: "active" },
          },
        };
        // Update the stored idempotency body in-place (same transaction)
        // so a replay returns the exact body the original client received.
        await updateIdempotencyResponseBody(
          tx,
          {
            workspaceId: result.workspaceId,
            principalId: session.session.identity.authUserId,
            route: "/api/v1/onboarding",
            key: idempotencyKey,
          },
          responseBody,
        );

        return { replayed: false, responseBody };
      });

      if (result.replayed) {
        // API_SPEC.md §1.4: valid replay returns the stored body plus the
        // Idempotency-Replayed marker header.
        c.header("Idempotency-Replayed", "true");
        return c.json(result.stored as Record<string, unknown>, 201);
      }
      return c.json(result.responseBody, 201);
    } catch (err) {
      if (err instanceof AppError && err.code === "IDEMPOTENCY_CONFLICT") {
        return c.json(
          {
            error: {
              code: err.code,
              message: err.message,
              request_id: requestId,
            },
          },
          err.status,
        );
      }
      if (err instanceof WorkspaceSlugConflictError) {
        return c.json(
          {
            error: {
              code: "SLUG_CONFLICT",
              message: "This business URL is already taken",
              request_id: requestId,
            },
          },
          409,
        );
      }
      throw err;
    }
  });
}

