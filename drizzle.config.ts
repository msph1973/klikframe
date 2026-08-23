import { defineConfig } from "drizzle-kit";

import "./lib/db/schema";

/**
 * drizzle-kit configuration (DEPLOYMENT.md §4 step 5): checked-in SQL
 * migrations generated into `drizzle/`; production applies them through the
 * direct `DATABASE_MIGRATION_URL`. `drizzle-kit push` is forbidden — there
 * is deliberately no push-friendly passthrough URL here.
 *
 * Credentials come only from the canonical environment variables; this file
 * never embeds a connection string. The schema import is side-effectful on
 * purpose so kit picks up every table module from the single barrel.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema/index.ts",
  out: "./drizzle",
  // `generate` never connects; `migrate`/`check` require the real direct
  // migration URL in the environment (DEPLOYMENT.md §3).
  dbCredentials: {
    url: process.env.DATABASE_MIGRATION_URL ?? "",
  },
  verbose: true,
  strict: true,
});
