import { Hono } from "hono";
import { requestIdMiddleware, type RequestIdVariables } from "./request-id";
import { AppError, toErrorEnvelope } from "./errors";
import { registerHealthRoute } from "./health";
import { wireIdentitySessionPort } from "@/lib/providers/composition";

export type AppVariables = RequestIdVariables;
export type KlikFrameApp = Hono<{ Variables: AppVariables }>;

/**
 * Single Hono composition root mounted at `/api/v1` (ARCHITECTURE.md §3.2).
 * Later Phase 0 waves register additional routes here without duplicating
 * request ID/error-handling wiring.
 */
export function createApp(): KlikFrameApp {
  // Session resolution must use the real (or test-fake) Neon adapter from
  // the first served request — the unauthenticated default is never
  // acceptable in production (cubic PRRT_kwDOT_C_FM6bh9m3).
  wireIdentitySessionPort();

  const app = new Hono<{ Variables: AppVariables }>().basePath("/api/v1");

  app.use("*", requestIdMiddleware());

  app.notFound((c) => {
    const error = new AppError("RESOURCE_NOT_FOUND", "Route not found");
    return c.json(toErrorEnvelope(error, c.get("requestId")), error.status);
  });

  app.onError((err, c) => {
    const error = AppError.from(err);
    return c.json(toErrorEnvelope(error, c.get("requestId")), error.status);
  });

  registerHealthRoute(app);

  return app;
}
