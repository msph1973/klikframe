# Decision Log — KlikFrame

- **Last updated:** 2026-08-20
- **Status:** Active index
- **Owner:** Repository maintainers
- **Canonical sources:** Linked in each decision
- **Size limit:** 40 active decisions or 20 KB
- **Compaction:** Keep accepted decisions that constrain current work. Move superseded/obsolete entries to `.junie/memory/archive/DECISIONS-YYYY.md`, retaining a one-line pointer here when historical context remains relevant.

## Usage

Search by decision ID, status, or topic; this file is not required reading in full during boot. Valid statuses are `Proposed`, `Accepted`, `Superseded`, and `Rejected`. A decision summarizes the outcome and must link to its canonical rationale or contract.

## Active Decisions

### KF-001 — Product account language

- **Status:** Accepted
- **Date:** 2026-08-20
- **Decision:** MVP presents one photography business account type and two product actors: business account owner and client. Solo/studio/workspace are not signup choices.
- **Source:** [`PRODUCT_REQUIREMENTS.md` — Persona and product principles](../../PRODUCT_REQUIREMENTS.md#3-persona-mvp).

### KF-002 — Application-owned tenancy

- **Status:** Accepted
- **Date:** 2026-08-20
- **Decision:** Application data is scoped by `workspace_id`; onboarding atomically creates one workspace and one active owner membership.
- **Source:** [`DATABASE_SCHEMA.md` — Identity and business account](../../DATABASE_SCHEMA.md#2-identity-dan-akun-bisnis).

### KF-003 — Authentication boundary

- **Status:** Accepted
- **Date:** 2026-08-20
- **Decision:** Managed Better Auth owns identity and sessions in Neon `neon_auth`; KlikFrame owns profiles, tenancy, and authorization without duplicating credentials.
- **Source:** [`DATABASE_SCHEMA.md` — Schema principles](../../DATABASE_SCHEMA.md#1-prinsip-schema) and [`SECURITY.md` — Identity/session/tenancy](../../SECURITY.md#1-identity-session-dan-tenancy).

### KF-004 — Team scope

- **Status:** Accepted
- **Date:** 2026-08-20
- **Decision:** Only owners access the MVP dashboard. Invitations, member management, and `admin`/`assistant` roles are Post-MVP extensions.
- **Source:** [`PRODUCT_REQUIREMENTS.md` — Out of scope](../../PRODUCT_REQUIREMENTS.md#52-di-luar-cakupan-mvp) and [`ROADMAP.md`](../../ROADMAP.md).

### KF-005 — API boundary

- **Status:** Accepted
- **Date:** 2026-08-20
- **Decision:** Hono under `/api/v1` is the external API contract; Server Actions are UI adapters over the same service/use-case layer.
- **Source:** [`API_SPEC.md` — Boundary and conventions](../../API_SPEC.md#1-boundary-dan-konvensi).

### KF-006 — Public client access

- **Status:** Accepted
- **Date:** 2026-08-20
- **Decision:** Client portal resources use hashed opaque tokens with resource scope, expiry, revocation, and rate limiting, separate from owner sessions.
- **Source:** [`DATABASE_SCHEMA.md` — Portal access and evidence](../../DATABASE_SCHEMA.md#4-akses-portal-dan-evidence), [`SECURITY.md` — Portal client](../../SECURITY.md#11-portal-klien), and [`API_SPEC.md` — Portal API](../../API_SPEC.md#7-portal-api).

### KF-007 — Object upload and delivery

- **Status:** Accepted
- **Date:** 2026-08-20
- **Decision:** MVP uses presigned direct upload to private Civo S3 Object Storage and server-generated presigned download URLs with expiry; persistent records store object metadata and keys, not signed URLs.
- **Source:** [`DATABASE_SCHEMA.md` — Storage and operations](../../DATABASE_SCHEMA.md#5-storage-dan-operasi), [`API_SPEC.md` — Upload capability](../../API_SPEC.md#94-upload-capability-dan-purpose-matrix), and [`DEPLOYMENT.md`](../../DEPLOYMENT.md).

### KF-008 — Conservative TypeScript baseline

- **Status:** Accepted
- **Date:** 2026-08-20
- **Decision:** Use the conservative stable TypeScript line rather than the alternative Go-native line; exact verified toolchain versions are centralized and pinned by lockfile.
- **Source:** [`DEPLOYMENT.md` — Canonical baseline](../../DEPLOYMENT.md#1-baseline-dan-prasyarat).

### KF-009 — Contract PDF generator

- **Status:** Accepted
- **Date:** 2026-08-20
- **Decision:** Use React-PDF for MVP contract PDF generation; Puppeteer is not an active alternative.
- **Source:** [`PRODUCT_REQUIREMENTS.md`](../../PRODUCT_REQUIREMENTS.md) and [`ARCHITECTURE.md`](../../ARCHITECTURE.md).

### KF-010 — Ably realtime event boundary

- **Status:** Accepted
- **Date:** 2026-08-20
- **Decision:** Ably is an MVP dependency for post-commit business event/invalidation only; `/api/v1` and PostgreSQL remain canonical, with least-privilege owner/portal capabilities and refetch recovery.
- **Source:** [`PRODUCT_REQUIREMENTS.md` — KF-RT-001](../../PRODUCT_REQUIREMENTS.md#kf-rt-001--event-bisnis-realtime), [`ARCHITECTURE.md` — Realtime](../../ARCHITECTURE.md#36-realtime--ably-eventinvalidation), and [`API_SPEC.md` — Event contract](../../API_SPEC.md#96-realtime-token-dan-event-contract).

### KF-011 — Strict code quality limits

- **Status:** Accepted
- **Date:** 2026-08-20
- **Decision:** TypeScript is strict with explicit/implicit/unsafe `any` forbidden; external boundaries use validated `unknown`, source/test files target 400 lines and fail CI above 500 except an explicit non-source allowlist.
- **Source:** [`PRODUCT_REQUIREMENTS.md` — NFR-CQ-001](../../PRODUCT_REQUIREMENTS.md#8-non-functional-requirements), [`AGENTS.md` — Quality Gates](../../AGENTS.md#quality-gates), and [`TESTING.md` — CI gates](../../TESTING.md#6-ci-dan-release-gates).

## Decision Template

### KF-NNN — Short title

- **Status:** Proposed | Accepted | Superseded | Rejected
- **Date:** YYYY-MM-DD
- **Decision:** One concise outcome.
- **Source:** Link to the canonical requirement, contract, or approved plan section.
- **Supersedes:** Optional decision ID.