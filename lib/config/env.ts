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
  // DEPLOYMENT.md §3 labels this an "https-url": the REST token travels in
  // the URL's request headers, so http would leak it in cleartext.
  UPSTASH_REDIS_REST_URL: z.url({ protocol: /^https$/ }).optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  // DEPLOYMENT.md §3: the Civo object-storage endpoint must be https so
  // presigned-URL query credentials never travel in cleartext.
  S3_ENDPOINT: z.url({ protocol: /^https$/ }).optional(),
  AWS_REGION: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).optional(),
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

// Fields that must survive blank-string stripping so an explicit-but-empty
// value is rejected by its own validator instead of silently disappearing
// and falling back to a default.
const PRESERVE_BLANK_FOR = new Set(["NODE_ENV"]);

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
  const result = envSchema.safeParse(stripBlankValues(source));
  if (!result.success) {
    throw new EnvValidationError(result.error.issues);
  }
  return result.data;
}

/**
 * `.env.example` documents optional keys as `KEY=` (blank). A developer
 * copying that template gets `process.env.KEY === ""`, which must mean
 * "unset", not "invalid" — an optional field's validators (`.url()`,
 * `.min(32)`, ...) would otherwise reject the blank string. Arrays are
 * passed through untouched so Zod's own "expected object" issue fires,
 * instead of `Object.entries` silently coercing one into an empty-ish
 * environment. `NODE_ENV` is exempt: a present-but-blank value is more
 * likely a broken substitution than an intentional "unset", so it must
 * fail enum validation rather than quietly falling back to the default.
 */
function stripBlankValues(source: unknown): unknown {
  if (typeof source !== "object" || source === null || Array.isArray(source)) return source;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (value === "" && !PRESERVE_BLANK_FOR.has(key)) continue;
    result[key] = value;
  }
  return result;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= loadEnv();
  return cached;
}

export function resetEnvCacheForTests(): void {
  cached = undefined;
}

/**
 * Deploy metadata (not in DEPLOYMENT.md §3; set by the platform/npm
 * itself), validated independently of the full canonical `Env` schema.
 * `lib/http/health.ts` uses this instead of `getEnv()` so a liveness
 * probe never fails because an unrelated provider variable is malformed
 * elsewhere in the environment.
 */
const deployMetadataSchema = z.object({
  VERCEL_GIT_COMMIT_SHA: z.string().min(1).optional(),
  npm_package_version: z.string().min(1).optional(),
});

export type DeployMetadata = z.infer<typeof deployMetadataSchema>;

export function getDeployMetadata(source: unknown = process.env): DeployMetadata {
  const result = deployMetadataSchema.safeParse(stripBlankValues(source));
  return result.success ? result.data : {};
}
