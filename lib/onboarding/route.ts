import { z } from "zod";
import { getIdentitySessionPort } from "@/lib/auth/server";
import {
  WorkspaceSlugConflictError,
  runOnboardingTransaction,
} from "@/lib/onboarding/onboard-owner";
import { getDb } from "@/lib/db/client";
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
    if (session.kind !== "authenticated" || session.session.expiresAt.getTime() <= Date.now()) {
      return c.json(
        {
          error: {
            code: "AUTH_REQUIRED",
            message: session.kind === "expired" ? "Session expired" : "Authentication required",
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

    const payloadSchema = z.object({
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
    const responseBody = {
      data: {
        profile: { id: "", display_name: parsed.data.owner_display_name },
        business: { id: "", name: parsed.data.business_name, slug: parsed.data.slug, status: "active" },
        membership: { role: "owner", status: "active" },
      },
    };

    try {
      const result = await getDb().transaction(async (tx) =>
        runOnboardingTransaction(tx, {
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
          // Idempotency record is persisted in the SAME transaction
          // (API_SPEC.md §1.4). The response body hash uses the canonical
          // payload; the stored body is filled in after the IDs are known.
          idempotency: {
            workspaceId: null,
            principalId: session.session.identity.authUserId,
            route: "/api/v1/onboarding",
            resourceId: null,
            key: idempotencyKey,
            requestBodyHash: stableStringify(parsed.data),
            responseStatus: 201,
            responseBody,
            expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            now,
          },
        }),
      );

      return c.json(
        {
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
        },
        201,
      );
    } catch (err) {
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

/** Deterministic JSON stringification for the idempotency body hash. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return val;
  });
}
