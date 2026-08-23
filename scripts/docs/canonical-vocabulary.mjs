// Canonical vocabulary extracted from the source-of-truth documents
// (DATABASE_SCHEMA.md, API_SPEC.md, PRODUCT_REQUIREMENTS.md,
// DEPLOYMENT.md). docs-check validates that every other Markdown file
// uses these tokens consistently; a contradiction here means two
// canonical documents disagree, which TESTING.md §8 requires the static
// gate to catch.

export const REQUIREMENTS_FILE = "PRODUCT_REQUIREMENTS.md";
export const API_SPEC_FILE = "API_SPEC.md";
export const SCHEMA_FILE = "DATABASE_SCHEMA.md";
export const TESTING_FILE = "TESTING.md";
export const ROADMAP_FILE = "ROADMAP.md";

/**
 * Status enums per entity, parsed from DATABASE_SCHEMA.md's `| status |
 * enum |` table rows. Keys are entity names in table order.
 */
export const CANONICAL_STATUS_ENUMS = {
  workspace: ["active", "deletion_pending", "suspended", "deleted"],
  workspace_member: ["active", "suspended", "revoked"],
  lead: ["new", "follow_up", "converted", "lost", "archived"],
  order: ["draft", "confirmed", "in_progress", "completed", "cancelled"],
  contract: ["draft", "published", "signed", "void"],
  invoice: ["draft", "unpaid", "partial", "paid", "void"],
  payment_proof: ["submitted", "accepted", "rejected", "deleted"],
  album: ["draft", "published", "archived"],
  storage_object: ["pending", "available", "quarantined", "failed", "deleted"],
  notification_delivery: ["pending", "sent", "failed"],
};

/** Flat set of every legal status token. */
export const ALL_CANONICAL_STATUSES = new Set(
  Object.values(CANONICAL_STATUS_ENUMS).flat(),
);

/** Roles: MVP has exactly one membership role and one signer role. */
export const CANONICAL_ROLES = {
  membership_role: ["owner"],
  signer_role: ["client"],
  actor_type: ["owner", "portal", "system"],
};

/** Role names that are explicitly Post-MVP and must never appear as an active MVP role. */
export const POST_MVP_ONLY_ROLES = new Set(["admin", "assistant"]);

/**
 * HTTP route vocabulary declared by API_SPEC.md (owner + portal + public +
 * internal), normalized to method + path-with-placeholders.
 */
export const CANONICAL_API_ROUTES = [
  // §2 Managed Auth dan Onboarding / Owner Identity
  "POST /onboarding",
  "GET /me",
  "PATCH /me/profile",
  "PATCH /business",
  "POST /data-export",
  "POST /account-deletion-requests",
  "POST /realtime/token",
  // §3 CRM dan Order
  "GET /clients",
  "POST /clients",
  "GET /clients/:id",
  "PATCH /clients/:id",
  "DELETE /clients/:id",
  "GET /leads",
  "POST /leads",
  "GET /leads/:id",
  "PATCH /leads/:id",
  "POST /leads/:id/convert",
  "DELETE /leads/:id",
  "GET /orders",
  "POST /orders",
  "GET /orders/:id",
  "PATCH /orders/:id",
  "POST /orders/:id/transitions",
  // §4 Contract
  "GET /contract-templates",
  "POST /contract-templates",
  "GET /contract-templates/:id",
  "PATCH /contract-templates/:id",
  "DELETE /contract-templates/:id",
  "GET /contracts",
  "POST /contracts",
  "GET /contracts/:id",
  "POST /contracts/:id/publish",
  "POST /contracts/:id/send",
  "POST /contracts/:id/void",
  "POST /portal-access/:id/revoke",
  // §5 Invoice dan Payment
  "GET /invoices",
  "POST /invoices",
  "GET /invoices/:id",
  "PATCH /invoices/:id",
  "POST /invoices/:id/issue",
  "POST /invoices/:id/send",
  "POST /invoices/:id/payments",
  "POST /invoices/:id/payments/:paymentId/reverse",
  "POST /invoices/:id/payment-proofs/:proofId/review",
  "POST /invoices/:id/void",
  // §6 Gallery dan Storage
  "GET /albums",
  "POST /albums",
  "GET /albums/:id",
  "PATCH /albums/:id",
  "POST /albums/:id/publish",
  "POST /albums/:id/send",
  "POST /albums/:id/archive",
  "DELETE /photos/:id",
  "POST /uploads/presign",
  "POST /uploads/:uploadId/finalize",
  // §7 Portal API
  "POST /portal/exchange",
  "GET /portal/context",
  "GET /portal/contracts/:id",
  "POST /portal/contracts/:id/signatures/presign",
  "POST /portal/contracts/:id/signatures/:uploadId/finalize",
  "POST /portal/contracts/:id/sign",
  "GET /portal/invoices/:id",
  "POST /portal/invoices/:id/payment-proofs/presign",
  "POST /portal/invoices/:id/payment-proofs/:uploadId/finalize",
  "GET /portal/albums/:id",
  "GET /portal/albums/:id/photos",
  "PUT /portal/albums/:id/selections/:photoId",
  "DELETE /portal/albums/:id/selections/:photoId",
  // §8 Internal dan Public Operations
  "GET /health",
  "GET /internal/cron/reminders",
];

export const CANONICAL_API_ROUTE_SET = new Set(CANONICAL_API_ROUTES);

/**
 * Route paths referenced outside API_SPEC.md must use one of these fully
 * qualified forms when written with the `/api/v1` prefix.
 */
export const CANONICAL_QUALIFIED_PREFIX = "/api/v1";

/**
 * Portal action scopes from API_SPEC.md §7 (typed token scopes) — the
 * exact allowlist a portal capability may reference.
 */
export const CANONICAL_PORTAL_ACTION_SCOPES = [
  "contract:read",
  "contract:sign",
  "invoice:read",
  "invoice:proof:create",
  "album:read",
  "album:select",
];

/**
 * Ably channel shapes from ARCHITECTURE.md §3.6 / API_SPEC.md §9.6:
 * exactly one owner channel namespace and one portal channel namespace.
 */
export const CANONICAL_ABLY_CHANNEL_PATTERNS = [
  /^workspace:<workspace_id>$/,
  /^portal:<portal_token_id>:<resource_type>:<resource_id>$/,
];

/**
 * Realtime event names from API_SPEC.md §9.6. `payment.recorded` maps to
 * the invoice resource and `selection.updated` to the album resource.
 */
export const CANONICAL_REALTIME_EVENTS = {
  "contract.signed": "contract",
  "invoice.updated": "invoice",
  "payment.recorded": "invoice",
  "gallery.published": "album",
  "selection.updated": "album",
};

/**
 * Environment variable names allowed anywhere in documentation. Anything
 * matching FORBIDDEN_ENV_PATTERNS is checked separately (negation-aware).
 * This list is the positive vocabulary for cross-document env references.
 */
export const CANONICAL_ENV_VARS = [
  "APP_ORIGIN",
  "DATABASE_URL",
  "DATABASE_MIGRATION_URL",
  "NEON_AUTH_BASE_URL",
  "NEON_AUTH_COOKIE_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "S3_ENDPOINT",
  "AWS_REGION",
  "S3_BUCKET",
  "UPLOAD_CAPABILITY_SECRET",
  "DATA_ENCRYPTION_KEY",
  "CRON_SECRET",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "ABLY_API_KEY",
  "SENTRY_DSN",
  "SENTRY_AUTH_TOKEN",
  // Platform-provided runtime vars referenced by canonical docs/code
  // (TESTING.md §5 seed guard, health deploy version).
  "NODE_ENV",
  "VERCEL_ENV",
  "VERCEL_GIT_COMMIT_SHA",
];
