import "server-only";
import { z } from "zod";

/**
 * Canonical MVP environment variables (DEPLOYMENT.md §3). Provider-specific
 * fields stay optional in Phase 0 because no adapter consumes them yet and
 * CI/local runs have no provisioned secrets; each provider wave tightens
 * its own field to required once the corresponding adapter is wired.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ORIGIN: z.url().optional(),
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_MIGRATION_URL: z.string().min(1).optional(),
  NEON_AUTH_BASE_URL: z.url().optional(),
  NEON_AUTH_COOKIE_SECRET: z.string().min(32).optional(),
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  AWS_REGION: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).optional(),
  CLOUDFRONT_DOMAIN: z.string().min(1).optional(),
  CLOUDFRONT_KEY_PAIR_ID: z.string().min(1).optional(),
  CLOUDFRONT_PRIVATE_KEY: z.string().min(1).optional(),
  UPLOAD_CAPABILITY_SECRET: z.string().min(32).optional(),
  DATA_ENCRYPTION_KEY: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(32).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.email().optional(),
  ABLY_API_KEY: z.string().min(1).optional(),
  SENTRY_DSN: z.url().optional(),
  SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  readonly issues: z.core.$ZodIssue[];

  constructor(issues: z.core.$ZodIssue[]) {
    super("Invalid server environment configuration");
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

/**
 * Parses an `unknown` source (defaults to `process.env`) into a typed,
 * validated `Env`. Never trust `process.env` fields directly by name
 * elsewhere in the codebase — always go through this parser.
 */
export function loadEnv(source: unknown = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(result.error.issues);
  }
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= loadEnv();
  return cached;
}

export function resetEnvCacheForTests(): void {
  cached = undefined;
}
