# Active Handoff — KlikFrame

- **Last updated:** 2026-08-20
- **Status:** Ready for implementation
- **Owner:** Next implementation session
- **Canonical task:** Phase 0 in [`ROADMAP.md`](../../ROADMAP.md); foundation plan [completed](../plans/harden-klikframe-foundation-docs.md)
- **Size limit:** 100 lines or 10 KB
- **Compaction:** Keep only the current task, validated progress, blockers, and ordered next actions. At task completion, replace this state with the next implementation entry point; move useful prior milestones to `.junie/memory/archive/HANDOFF-YYYY-MM-DD.md` only when audit history is needed.

## Active Task

Start KlikFrame Phase 0 from the reviewed specification baseline. Scope begins with exact toolchain/repository setup, strict code-quality gates, provider adapters including Ably, migration foundation, and atomic/idempotent owner onboarding; do not re-open product scope without a new approved decision.

## Validated Progress

- The foundation hardening plan and realtime/code-quality extension are complete; all domain documents share one two-persona MVP and owner-only workspace tenancy.
- Product requirements are traced through data, API, security, tests, and roadmap; Ably event/invalidation is MVP while team management and other deferred integrations remain Post-MVP.
- Owner/portal/cron/public boundaries, typed upload capabilities, immutable evidence, payment ledger/reversal, retention, and workspace lifecycle are implementation-ready.
- Testing/deployment use controlled provider boundaries, one verified toolchain matrix, canonical env/cron/storage/Ably contracts, strict no-`any` checks, 400-line target/500-line hard gate, and evidence-based recovery gates.
- Fresh completion gate passed 14 Markdown files, `opencode.json`, all 18 requirement/NFR IDs, local file links, code fences, obsolete-scope phrases, and explicit realtime event/resource mappings; independent review findings were resolved.

## Blockers

- No blocker for Phase 0 scaffold. Production remains gated by legal retention approval, provider-plan verification, and recorded restore/deletion/security drills.

## Next Actions

1. Read `PRODUCT_REQUIREMENTS.md` KF-ONB-001, `ROADMAP.md` Phase 0, and the onboarding/tenancy sections of `DATABASE_SCHEMA.md`, `API_SPEC.md`, `SECURITY.md`, and `TESTING.md`.
2. Initialize the repository with the exact `DEPLOYMENT.md` toolchain baseline and committed lockfile; configure TypeScript strict, type-aware no-`any` linting, and the 500-line file-size CI gate before feature code.
3. Create provider ports/adapters, including a deterministic Ably event publisher/token capability adapter, and the first checked-in migrations for profiles, workspaces, and owner memberships without touching schema `neon_auth`.
4. Implement `POST /api/v1/onboarding` atomically/idempotently with concurrent retry, rollback, workspace-state, and two-tenant integration tests.
5. Configure isolated nonproduction provider resources including a separate Ably app/key, then run Phase 0 document/file-size/lint/type/unit/integration/build gates before expanding scope.

## Handoff Rules

- Record only completed and evidenced work under Validated Progress; planned work belongs under Next Actions.
- Put approved cross-domain outcomes in `DECISIONS.md`, not here.
- Put stable baseline changes in `PROJECT_CONTEXT.md`, not here.
- Do not paste transcript, hidden reasoning, full document content, secrets, or unverified assumptions.