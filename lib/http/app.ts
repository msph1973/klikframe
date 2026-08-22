import { Hono } from "hono";
import { requestIdMiddleware, type RequestIdVariables } from "./request-id";
import { AppError, toErrorEnvelope } from "./errors";
import { registerHealthRoute } from "./health";

export type AppVariables = RequestIdVariables;
export type KlikFrameApp = Hono<{ Variables: AppVariables }>;

/**
 * Single Hono composition root mounted at `/api/v1` (ARCHITECTURE.md §3.2).
 * Later Phase 0 waves register additional routes here without duplicating
 * request ID/error-handling wiring.
 */
export function createApp(): KlikFrameApp {
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
