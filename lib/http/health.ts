import type { Hono } from "hono";
import { getDeployMetadata } from "@/lib/config/env";
import type { RequestIdVariables } from "./request-id";

/**
 * API_SPEC.md §8: public health MUST only return status/version — no DSN,
 * region, bucket, provider error, or secret state. Deep dependency checks
 * are deliberately out of scope for this public route. Uses the narrow
 * `getDeployMetadata()` accessor rather than `getEnv()` so this liveness
 * probe never fails just because an unrelated provider variable elsewhere
 * in the environment is malformed.
 */
export function registerHealthRoute(app: Hono<{ Variables: RequestIdVariables }>): void {
  app.get("/health", (c) => {
    const metadata = getDeployMetadata();
    const version = metadata.VERCEL_GIT_COMMIT_SHA ?? metadata.npm_package_version ?? "dev";
    return c.json({ status: "ok", version });
  });
}
