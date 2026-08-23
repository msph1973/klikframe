# Project Context — KlikFrame

- **Last updated:** 2026-08-20
- **Status:** Stable specification baseline; ready for Phase 0 implementation
- **Owner:** Repository maintainers
- **Canonical sources:** [`PRODUCT_REQUIREMENTS.md`](../../PRODUCT_REQUIREMENTS.md) plus the domain documents indexed below
- **Size limit:** 120 lines or 12 KB
- **Compaction:** Keep only the current stable snapshot and links. Move obsolete snapshots to `.junie/memory/archive/PROJECT_CONTEXT-YYYY-MM-DD.md`; archives are not loaded during boot.

## Purpose

KlikFrame is a serverless-first SaaS for managing a photography business from lead through gallery delivery. MVP product language has only two actors: the photography business account owner and the client.

## Current Phase

The repository contains a reviewed implementation specification and no application scaffold yet. The completed [foundation hardening plan](../plans/harden-klikframe-foundation-docs.md) aligns product, roadmap, architecture, data, API, security, testing, deployment, and local tooling. The next phase is application Phase 0: repository/toolchain setup and owner onboarding foundation.

## Stable Baseline

- Every registrant follows one onboarding flow and automatically receives one business account.
- Technical tenancy uses `workspaces` and owner membership so future teams do not require ownership migration; team UX and additional roles are Post-MVP.
- MVP runs Next.js/Hono on Vercel with Neon PostgreSQL and Managed Better Auth, Upstash, private Civo S3 Object Storage (S3-compatible), Resend, and Ably.
- Hono `/api/v1` is the external API contract; Server Actions reuse the same service/use-case layer.
- Client portal access is token-based and separate from owner dashboard sessions.
- Presigned S3 upload, manual payment, Vercel Cron, email, and post-commit Ably event/invalidation are MVP choices. API/database remain canonical; payment gateway, WhatsApp API, workers, AI, and vector search are deferred.
- TypeScript is strict with no explicit/implicit/unsafe `any`; external boundaries validate `unknown`. Source/test files target 400 lines and fail CI above 500 except an explicit non-source allowlist.

## Domain Index

| Question | Read |
|---|---|
| What is in MVP and who uses it? | [`PRODUCT_REQUIREMENTS.md`](../../PRODUCT_REQUIREMENTS.md) |
| How are components and boundaries organized? | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) |
| What owns data and how does it transition? | [`DATABASE_SCHEMA.md`](../../DATABASE_SCHEMA.md) |
| What are the external contracts? | [`API_SPEC.md`](../../API_SPEC.md) |
| What controls protect the system and data? | [`SECURITY.md`](../../SECURITY.md) |
| How is behavior verified? | [`TESTING.md`](../../TESTING.md) |
| How is it released and operated? | [`DEPLOYMENT.md`](../../DEPLOYMENT.md) |
| In which phase is a capability delivered? | [`ROADMAP.md`](../../ROADMAP.md) |
| How is local agent tooling trusted/configured? | [`TOOLING.md`](../../TOOLING.md) |
| What cross-domain decisions are accepted? | [`DECISIONS.md`](DECISIONS.md), searched by topic or ID |
| What should the next session do? | [`HANDOFF.md`](HANDOFF.md) |

## Memory Ownership

- This file owns only the stable project snapshot and domain index.
- `DECISIONS.md` owns decision metadata and links, not full specifications.
- `HANDOFF.md` owns temporary execution state and next actions.
- Domain details belong to root specification documents. Resolve conflicts in favor of those documents, then refresh this snapshot.

## Implementation Entry State

All foundation documents include the validated realtime and code-quality baseline. Application code, migrations, provider resources, and lockfile have not been created. Legal approval of the retention matrix, provider-plan verification, and restore/deletion drills remain mandatory production release gates, not blockers for starting Phase 0.