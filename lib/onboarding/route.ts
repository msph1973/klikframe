import { z } from "zod";
import { getIdentitySessionPort } from "@/lib/auth/server";
import { AppError } from "@/lib/http/errors";
import { assertSameOrigin } from "@/lib/http/origin";
import {
  IdempotencyRaceError,
  WorkspaceSlugConflictError,
  AlreadyOnboardedRaceError,
  assertNotAlreadyOnboarded,
  runOnboardingTransaction,
  findIdempotencyRecord,
  updateIdempotencyResponseBody,
} from "@/lib/onboarding/onboard-owner";
import { getProviders } from "@/lib/providers/composition";
import { computeCanonicalBodyHash } from "@/lib/idempotency/idempotency-port";
import { DrizzleTransactionRunner } from "@/lib/db/transaction-runner";
import { getDb } from "@/lib/db/client";
import type { KlikFrameApp } from "@/lib/http/app";

/** Owner API shared window (API_SPEC.md §1.5): 100 requests per minute. */
const OWNER_API_RATE_LIMIT = 100;
const OWNER_API_WINDOW_MS = 60_000;

/**
 * POST /api/v1/onboarding (API_SPEC.md §2, KF-ONB-001).
 *
 * Access: authenticated owner session WITHOUT an existing workspace.
 * Idempotency-Key header: required (API_SPEC.md §1.4).
 *
 * Request pipeline order (API_SPEC.md §1.5/§1.6):
 *  1. Origin guard  — cookie-authenticated mutations verify Origin/Host
 *     before any authenticated work (§1.6).
 *  2. Session resolution — 401 AUTH_REQUIRED envelope.
 *  3. Rate limit — 100/min per auth user ID, after session, before use case
 *     (§1.5); 429 RATE_LIMITED carries Retry-After.
 *  4. Payload parsing/validation.
 */
export function registerOnboardingRoute(app: KlikFrameApp): void {
  app.post("/onboarding", async (c) => {
    const requestId = c.get("requestId");

    // §1.6: foreign, absent, or null Origin on a cookie-authenticated
    // mutation is rejected before session and database work.
    try {
      assertSameOrigin(c.req.raw);
    } catch (error) {
      return originDeniedResponse(error, requestId);
    }

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

    // §1.5: owner API limiter — Upstash-backed in every real environment,
    // deterministic fake under test. Runs after the session exists (the key
    // is the auth user ID) and BEFORE payload parsing/use-case work; a
    // blocked request never reaches the database.
    const principalId = session.session.identity.authUserId;
    const rateLimit = await getProviders().rateLimiter.limit([
      { key: `owner-api:${principalId}`, limit: OWNER_API_RATE_LIMIT, windowMs: OWNER_API_WINDOW_MS },
    ]);
    if (!rateLimit.success) {
      return c.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests — retry later",
            request_id: requestId,
          },
        },
        429,
        {
          "Retry-After": String(Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000))),
          "RateLimit-Limit": String(rateLimit.limit),
          "RateLimit-Remaining": String(rateLimit.remaining),
          "RateLimit-Reset": String(Math.ceil(rateLimit.resetAt.getTime() / 1000)),
        },
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
      // DATABASE_SCHEMA.md §7: serializable isolation + retry-on-40001 is a
      // property of the runner. runOnce encapsulates one attempt; the
      // retry-once wrapper covers the idempotency insert race (a loser
      // aborts with IdempotencyRaceError and re-runs in a FRESH transaction
      // whose snapshot observes the winner's committed record through the
      // replay lookup).
      //
      // Precondition ordering (PRRT_kwDOT_C_FM6bsYro, PRRT_kwDOT_C_FM6btFPe):
      // assertNotAlreadyOnboarded runs INSIDE this transaction as a plain
      // SELECT on tx — never a nested runner.run — AFTER the idempotency
      // replay lookup: on the first success the record and the owner
      // membership commit together, so a genuine replay MUST short-circuit
      // to its stored 201 before the precondition can ever observe that
      // membership. Only a FIRST-TIME request (lookup missed) is rejected
      // here when the identity already owns a workspace.
      const runner = new DrizzleTransactionRunner(getDb());
      const runOnce = async (): Promise<
        { replayed: true; stored: unknown } | { replayed: false; responseBody: Record<string, unknown> }
      > =>
        runner.run(async (tx) => {
          const existing = await findIdempotencyRecord(tx, {
            principalId,
            route: "/api/v1/onboarding",
            key: idempotencyKey,
          });
          if (existing !== null) {
            if (existing.requestBodyHash !== requestBodyHash) {
              throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with a different request body");
            }
            // Replay hit: the stored response IS the answer. No precondition
            // here — on first success the idempotency record and the owner
            // membership committed together, so checking membership now
            // would 409 every genuine retry (PRRT_kwDOT_C_FM6bsYro).
            return { replayed: true as const, stored: existing.responseBody };
          }
          // First-time path only: reject an identity that already owns a
          // workspace BEFORE writing anything (PRRT_kwDOT_C_FM6bpRIt), as a
          // plain SELECT on THIS transaction — never a nested runner.run
          // inside the open tx (PRRT_kwDOT_C_FM6btFPe).
          await assertNotAlreadyOnboarded(tx, principalId);

          const onboarded = await runOnboardingTransaction(tx, {
            profile: {
              authUserId: principalId,
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
              principalId,
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
              profile: { id: onboarded.profileId, display_name: parsed.data.owner_display_name },
              business: {
                id: onboarded.workspaceId,
                name: parsed.data.business_name,
                slug: onboarded.workspaceSlug,
                status: onboarded.workspaceStatus,
              },
              membership: { role: "owner", status: "active" },
            },
          };
          // Update the stored idempotency body in-place (same transaction)
          // so a replay returns the exact body the original client received.
          // Scope pins resource_id NULL-aware so it can only ever touch the
          // row this transaction inserted.
          await updateIdempotencyResponseBody(
            tx,
            {
              workspaceId: onboarded.workspaceId,
              principalId,
              route: "/api/v1/onboarding",
              resourceId: null,
              key: idempotencyKey,
            },
            responseBody,
          );

          return { replayed: false as const, responseBody };
        });

      let result;
      try {
        result = await runOnce();
      } catch (error) {
        if (!(error instanceof IdempotencyRaceError)) {
          throw error;
        }
        // Lost the insert race: one clean retry in a fresh snapshot replays
        // the winner's response (or conflicts on a body-hash mismatch).
        result = await runOnce();
      }

      if (result.replayed) {
        c.header("Idempotency-Replayed", "true");
        return c.json(result.stored as Record<string, unknown>, 201);
      }
      return c.json(result.responseBody, 201);
    } catch (err) {
      if (err instanceof AlreadyOnboardedRaceError) {
        // Lost the FIRST-TIME ownership race (PRRT_kwDOT_C_FM6bspCN): the
        // concurrent winner committed the identity's active owner
        // membership, so this attempt stored nothing. Answer the frozen 409
        // ALREADY_ONBOARDED envelope — never the raw 23505 as a generic 500.
        return c.json(
          {
            error: {
              code: "ALREADY_ONBOARDED",
              message: "Identity already owns a workspace",
              request_id: requestId,
            },
          },
          409,
        );
      }
      if (err instanceof AppError && err.code === "IDEMPOTENCY_CONFLICT") {
        return errorEnvelope(err, requestId);
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

/**
 * Maps an origin-guard rejection onto the frozen ORIGIN_DENIED envelope
 * (API_SPEC.md §1.6). ONLY an actual `ORIGIN_DENIED` AppError converts
 * here; any other failure (env/config faults, guard dependency errors) is
 * rethrown so the app error handler returns the appropriate sanitized
 * envelope — this helper must not mask unexpected errors as 403
 * (PRRT_kwDOT_C_FM6bspCO).
 */
function originDeniedResponse(error: unknown, requestId: string): Response {
  if (!(error instanceof AppError) || error.code !== "ORIGIN_DENIED") {
    throw error;
  }
  return Response.json(
    { error: { code: "ORIGIN_DENIED", message: error.message, request_id: requestId } },
    { status: 403 },
  );
}
/** Builds the standard `{ error: { code, message, request_id } }` JSON response for an AppError. */
function errorEnvelope(err: AppError, requestId: string): Response {
  return Response.json(
    { error: { code: err.code, message: err.message, request_id: requestId } },
    { status: err.status },
  );
}
