import type { Hono } from "hono";
import { getEnv } from "@/lib/config/env";
import type { RequestIdVariables } from "./request-id";

/**
 * API_SPEC.md §8: public health MUST only return status/version — no DSN,
 * region, bucket, provider error, or secret state. Deep dependency checks
 * are deliberately out of scope for this public route.
 */
export function registerHealthRoute(app: Hono<{ Variables: RequestIdVariables }>): void {
  app.get("/health", (c) => {
    const env = getEnv();
    const version = env.VERCEL_GIT_COMMIT_SHA ?? env.npm_package_version ?? "dev";
    return c.json({ status: "ok", version });
  });
}
