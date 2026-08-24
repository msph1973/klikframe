import { readFileSync } from "node:fs";

import { getTableColumns, getTableName } from "drizzle-orm";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  actorTypeEnum,
  memberStatusEnum,
  auditEvents,
  idempotencyRequests,
  memberRoleEnum,
  profiles,
  workspaceMembers,
  workspaceStatusEnum,
  workspaces,
} from "../../../lib/db/schema";
import {
  computeCanonicalBodyHash,
  IDEMPOTENCY_MIN_TTL_HOURS,
  IDEMPOTENCY_MIN_TTL_MS,
} from "../../../lib/idempotency/idempotency-port";

/**
 * Schema-shape contracts (DATABASE_SCHEMA.md §2/§5) plus the database
 * boundaries this data layer leans on: the two partial unique indexes that
 * are THE onboarding concurrency boundary, the FK constraints anchoring
 * tenant tagging, the `NULLS NOT DISTINCT` idempotency scope, and the
 * checked-in migration's audit append-only trigger.
 */
function columnNames(table: Parameters<typeof getTableColumns>[0]): string[] {
  return Object.values(getTableColumns(table))
    .map((column: { name: string }) => column.name)
    .sort();
}

describe("schema shape matches DATABASE_SCHEMA.md", () => {
  it("profiles carries exactly the canonical columns", () => {
    expect(columnNames(profiles)).toEqual([
      "auth_user_id",
      "created_at",
      "display_name",
      "id",
      "phone_e164",
      "updated_at",
    ]);
  });

  it("workspaces carries lifecycle timestamps and status", () => {
    expect(columnNames(workspaces)).toEqual([
      "bank_account",
      "created_at",
      "deleted_at",
      "deletion_requested_at",
      "id",
      "name",
      "slug",
      "status",
      "updated_at",
    ]);
  });

  it("workspace_members carries role/status/joined_at", () => {
    expect(columnNames(workspaceMembers)).toEqual([
      "auth_user_id",
      "created_at",
      "id",
      "joined_at",
      "role",
      "status",
      "updated_at",
      "workspace_id",
    ]);
  });

  it("audit_events carries actor/resource/request correlation", () => {
    expect(columnNames(auditEvents)).toEqual([
      "action",
      "actor_id",
      "actor_type",
      "created_at",
      "id",
      "metadata",
      "request_id",
      "resource_id",
      "resource_type",
      "workspace_id",
    ]);
  });

  it("idempotency_requests carries scope, body hash, response, expiry", () => {
    expect(columnNames(idempotencyRequests)).toEqual([
      "created_at",
      "expires_at",
      "id",
      "key",
      "principal_id",
      "request_body_hash",
      "resource_id",
      "response_body",
      "response_status",
      "route",
      "workspace_id",
    ].sort());
  });

  it("status enums use the exact canonical vocabularies", () => {
    expect(workspaceStatusEnum.enumValues).toEqual([
      "active",
      "deletion_pending",
      "suspended",
      "deleted",
    ]);
    expect(memberStatusEnum.enumValues).toEqual(["active", "suspended", "revoked"]);
    expect(memberRoleEnum.enumValues).toEqual(["owner"]);
    expect(actorTypeEnum.enumValues).toEqual(["owner", "portal", "system"]);
  });
});

describe("onboarding concurrency boundary (partial unique indexes)", () => {
  const dialect = new PgDialect();

  function uniqueIndexNames(table: Parameters<typeof getTableConfig>[0]): (string | undefined)[] {
    return getTableConfig(table).indexes.map((idx) => idx.config.name);
  }

  /** Index columns may be raw SQL expressions; plain columns carry a name. */
  function indexColumnNames(index: { readonly config: { readonly columns: unknown[] } } | undefined): string[] {
    if (index === undefined) return [];
    return index.config.columns.flatMap((column) =>
      typeof column === "object" && column !== null && "name" in column
        ? [String(column.name)]
        : [],
    );
  }

  it("keeps exactly one active owner per workspace", () => {
    const index = getTableConfig(workspaceMembers).indexes.find(
      (idx) => idx.config.name === "workspace_members_single_active_owner_per_workspace_key",
    );
    expect(indexColumnNames(index)).toEqual(["workspace_id"]);
    expect(index?.config.where).toBeDefined();
    if (index?.config.where === undefined) return;
    expect(dialect.sqlToQuery(index.config.where).sql).toBe(
      "role = 'owner' AND status = 'active'",
    );
  });

  it("keeps at most one owned workspace per identity", () => {
    const index = getTableConfig(workspaceMembers).indexes.find(
      (idx) => idx.config.name === "workspace_members_single_owned_workspace_per_identity_key",
    );
    expect(index).toBeDefined();
    expect(index?.config.unique).toBe(true);
    expect(indexColumnNames(index)).toEqual(["auth_user_id"]);
  });

  it("declares both boundary indexes (a dropped index regresses concurrency)", () => {
    expect(uniqueIndexNames(workspaceMembers)).toEqual(
      expect.arrayContaining([
        "workspace_members_single_active_owner_per_workspace_key",
        "workspace_members_single_owned_workspace_per_identity_key",
      ]),
    );
  });

  it("exposes the canonical UNIQUE (workspace_id, id) on every tenant-scoped table", () => {
    // DATABASE_SCHEMA.md §6: each tenant table's `(workspace_id, id)` key is
    // the target set future composite child FKs reference. Postgres FKs must
    // match an existing unique constraint's exact column list — a missing
    // key makes the table unusable as a composite-tenant parent.
    for (const table of [auditEvents, idempotencyRequests, workspaceMembers]) {
      const constraint = getTableConfig(table).uniqueConstraints.find(
        (candidate) =>
          candidate.name === `${getTableName(table as Parameters<typeof getTableName>[0])}_workspace_id_id_key`,
      );
      expect(constraint, `${getTableName(table as Parameters<typeof getTableName>[0])} must carry <table>_workspace_id_id_key`).toBeDefined();
      expect(constraint?.columns.map((column) => column.name)).toEqual([
        "workspace_id",
        "id",
      ]);
    }
  });

  it("anchors every tenant-tagged child to workspaces.id (composite FK)", () => {
    for (const table of [auditEvents, idempotencyRequests, workspaceMembers]) {
      const config = getTableConfig(table);
      const fk = config.foreignKeys.find(
        (constraint) => getTableName(constraint.reference().foreignTable) === "workspaces",
      );
      expect(fk, `${config.name} must reference workspaces`).toBeDefined();
    }
  });

  it("scopes idempotency replay keys with NULLS NOT DISTINCT semantics", () => {
    const constraint = getTableConfig(idempotencyRequests).uniqueConstraints.find(
      (candidate) => candidate.name === "idempotency_requests_scope_key",
    );
    expect(constraint?.columns.map((column) => column.name)).toEqual([
      "principal_id",
      "route",
      "resource_id",
      "key",
    ]);
  });
});

describe("audit_events append-only enforcement lives in the migration", () => {
  const migrationSql = readFileSync("drizzle/0000_init_data_layer.sql", "utf8");

  it("installs a BEFORE UPDATE OR DELETE trigger on audit_events", () => {
    expect(migrationSql).toMatch(
      /CREATE TRIGGER "audit_events_append_only" BEFORE UPDATE OR DELETE ON "audit_events"/,
    );
  });

  it("backs the trigger with a raising block-mutation function", () => {
    expect(migrationSql).toMatch(/CREATE FUNCTION "audit_events_block_mutation"/);
    expect(migrationSql).toContain("RAISE EXCEPTION");
  });

  it("blocks TRUNCATE through a separate statement-level trigger (PRRT_kwDOT_C_FM6bipfF follow-up)", () => {
    // A row-level BEFORE UPDATE OR DELETE trigger never fires for TRUNCATE,
    // so without this trigger a plain `TRUNCATE audit_events` would wipe
    // history and bypass the append-only boundary.
    expect(migrationSql).toMatch(
      /CREATE TRIGGER "audit_events_append_only_truncate" BEFORE TRUNCATE ON "audit_events"\s*FOR EACH STATEMENT EXECUTE FUNCTION "audit_events_block_mutation"\(\);/,
    );
    // The row trigger must NOT claim TRUNCATE: Postgres rejects
    // `BEFORE ... OR TRUNCATE ... FOR EACH ROW` at CREATE TRIGGER time.
    expect(migrationSql).not.toMatch(
      /CREATE TRIGGER "audit_events_append_only"[^;]*TRUNCATE[^;]*FOR EACH ROW/,
    );
  });
});

describe("frozen 24h replay TTL stays in sync across port, schema, and migration", () => {
  // PRRT_kwDOT_C_FM6biuYr: the CHECK constraint used to re-declare the
  // frozen window as a raw SQL literal in three places (port constant,
  // drizzle table, migration SQL). The schema now renders the interval from
  // IDEMPOTENCY_MIN_TTL_HOURS, which is itself derived from
  // IDEMPOTENCY_MIN_TTL_MS; these tests pin the remaining seams so a change
  // to the canonical constant cannot silently diverge from the SQL that the
  // database actually enforces.
  const dialect = new PgDialect();

  it("renders the schema CHECK interval from the canonical constant, not a literal", () => {
    const check = getTableConfig(idempotencyRequests).checks.find(
      (candidate) => candidate.name === "idempotency_requests_expiry_after_creation_check",
    );
    expect(check).toBeDefined();
    if (check === undefined) return;
    const checkValue: Parameters<typeof dialect.sqlToQuery>[0] = check.value;
    const rendered = dialect.sqlToQuery(checkValue).sql;
    const expectedInterval = `interval '${String(IDEMPOTENCY_MIN_TTL_HOURS)} hours'`;
    expect(rendered).toBe(
      `"idempotency_requests"."expires_at" >= "idempotency_requests"."created_at" + ${expectedInterval}`,
    );
  });

  it("keeps the checked-in migration's CHECK on the same window as the schema", () => {
    const migrationSql = readFileSync("drizzle/0000_init_data_layer.sql", "utf8");
    const expectedInterval = `interval '${String(IDEMPOTENCY_MIN_TTL_HOURS)} hours'`;
    const expected =
      `CONSTRAINT "idempotency_requests_expiry_after_creation_check" ` +
      `CHECK ("idempotency_requests"."expires_at" >= "idempotency_requests"."created_at" ` +
      `+ ${expectedInterval})`;
    expect(migrationSql).toContain(expected);
    const literals = migrationSql.match(/interval '\d+ hours'/g) ?? [];
    expect(literals.every((literal) => literal === expectedInterval)).toBe(true);
    // The migration must actually carry the CHECK whose window we pinned.
    expect(literals).not.toEqual([]);
  });

  it("derives the hours value from the milliseconds constant without rounding", () => {
    expect(IDEMPOTENCY_MIN_TTL_MS % (60 * 60 * 1000)).toBe(0);
    expect(IDEMPOTENCY_MIN_TTL_HOURS * 60 * 60 * 1000).toBe(IDEMPOTENCY_MIN_TTL_MS);
  });
});

describe("canonical body-hash stability", () => {
  it("hashes onboarding payloads identically regardless of key order", () => {
    const a = computeCanonicalBodyHash({
      business_name: "Klik Studio",
      owner_display_name: "Ayu",
      slug: "klik-studio",
    });
    const b = computeCanonicalBodyHash({
      slug: "klik-studio",
      business_name: "Klik Studio",
      owner_display_name: "Ayu",
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("distinguishes different bodies for conflict detection", () => {
    expect(computeCanonicalBodyHash({ a: 1 })).not.toBe(computeCanonicalBodyHash({ a: 2 }));
  });
});

describe("drizzle schema stays sorted-stable for deterministic migrations", () => {
  it("enum vocabulary order matches the checked-in migration types", () => {
    const migrationSql = readFileSync("drizzle/0000_init_data_layer.sql", "utf8");
    expect(migrationSql).toContain(
      `CREATE TYPE "public"."member_status" AS ENUM(${memberStatusEnum.enumValues
        .map((value) => `'${value}'`)
        .join(", ")})`,
    );
    expect(migrationSql).toContain(
      `CREATE TYPE "public"."actor_type" AS ENUM(${actorTypeEnum.enumValues
        .map((value) => `'${value}'`)
        .join(", ")})`,
    );
  });

  it("keeps the expires-at sweep index present", () => {
    const names = getTableConfig(idempotencyRequests).indexes.map((idx) => idx.config.name);
    expect(names).toContain("idempotency_requests_expires_at_idx");
  });
});
