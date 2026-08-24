import { defineConfig } from "drizzle-kit";
import { z } from "zod";

import "./lib/db/schema";

/**
 * drizzle-kit configuration (DEPLOYMENT.md §4 step 5): checked-in SQL
 * migrations generated into `drizzle/`; production applies them through the
 * direct `DATABASE_MIGRATION_URL`. `drizzle-kit push` is forbidden — there
 * is deliberately no push-friendly passthrough URL here.
 * The URL resolves through the canonical zod schema (`DATABASE_MIGRATION_URL`
 * is `min(1)`-validated, blank values stripped) instead of raw
 * `process.env`, so migration commands cannot bypass the shared
 * environment-validation boundary (PRRT_kwDOT_C_FM6bh72X). drizzle-kit runs
 * under plain Node, where the `server-only` marker package would throw, so
 * the parser is inlined here rather than imported from `lib/config/env` —
 * the field definition mirrors that file's exactly and must stay in sync.
 */
const migrationUrlSchema = z.object({
  DATABASE_MIGRATION_URL: z.string().min(1).optional(),
});

function migrationUrl(): string {
  // Blank values are "unset" per the canonical parser's contract
  // (.env.example documents optional keys as `KEY=`).
  const source: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && value.trim().length > 0) source[key] = value;
  }
  const parsed = migrationUrlSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error("Invalid DATABASE_MIGRATION_URL for drizzle-kit");
  }
  // `generate`/`check` never connect, so an unset URL is valid there;
  // `migrate` fails on its own with drizzle-kit's clearer error.
  return parsed.data.DATABASE_MIGRATION_URL ?? "";
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema/index.ts",
  out: "./drizzle",
  // `generate` never connects; `migrate`/`check` require the real direct
  // migration URL in the environment (DEPLOYMENT.md §3).
  dbCredentials: {
    url: migrationUrl(),
  },
  verbose: true,
  strict: true,
});
