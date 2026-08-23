import { getTableColumns } from "drizzle-orm";
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
  advisoryLockKey,
  MAX_SERIALIZABLE_RETRIES,
  SERIALIZABLE_TX_CONFIG,
} from "../../../lib/db/transaction-runner";
import { computeCanonicalBodyHash } from "../../../lib/idempotency/idempotency-port";

/** Column names asserted against DATABASE_SCHEMA.md §2/§5 contracts. */
function columnNames(table: Parameters<typeof getTableColumns>[0]): string[] {
  return Object.values(getTableColumns(table))
    .map((column) => column.name)
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
    ]);
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

describe("advisory lock helper", () => {
  it("derives a deterministic key per identity", () => {
    expect(advisoryLockKey("auth-42")).toBe(advisoryLockKey("auth-42"));
    expect(advisoryLockKey("auth-43")).not.toBe(advisoryLockKey("auth-42"));
  });

  it("keeps every derived key inside PostgreSQL signed int8 range", () => {
    for (let i = 0; i < 500; i += 1) {
      const key = advisoryLockKey(`auth-${String(i)}`);
      expect(key).toBeLessThanOrEqual(2n ** 63n - 1n);
      expect(key).toBeGreaterThanOrEqual(-(2n ** 63n));
    }
  });

  it("configures serializable transactions with a retry budget", () => {
    expect(SERIALIZABLE_TX_CONFIG).toEqual({ isolationLevel: "serializable" });
    expect(MAX_SERIALIZABLE_RETRIES).toBeGreaterThan(0);  });
});
