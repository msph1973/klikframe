# Strategi Testing — KlikFrame

## 1. Tujuan dan Baseline

Strategi ini memverifikasi acceptance criteria di `PRODUCT_REQUIREMENTS.md`, kontrak `/api/v1`, isolasi `workspace_id`, serta boundary provider tanpa mengandalkan production atau cleanup internal Managed Better Auth. Toolchain mengikuti matriks kanonis `DEPLOYMENT.md` §1; versi runner dipilih dan di-pin exact saat scaffold.

Quality gate bukan hanya coverage. Mutasi finansial/legal, tenant isolation, token portal, dan upload finalize harus memiliki positive, negative, retry, concurrency, serta audit assertions.

## 2. Piramida Test dan Boundary Eksternal

### 2.1 Unit — Vitest

- Pure domain/service tests: state machine, normalized contact, invoice totals/reversal, token scope, dedupe key, cursor, retention calculation, dan Zod schemas.
- Gunakan fake clock/UUID dan deterministic random bytes; jangan snapshot secret/token.
- Target branch coverage minimum 90% untuk authorization, payment, signature, idempotency, dan lifecycle modules; 80% untuk kode non-UI lain. Coverage tidak menggantikan scenario wajib.

### 2.2 Integration — Hono + PostgreSQL

- Jalankan request melalui Hono app yang sama dengan production, termasuk middleware session/token → membership/scope → validation. Jangan memanggil service langsung untuk contract test.
- Auth memakai `IdentitySessionPort` test adapter yang menghasilkan signed fixture session pada boundary resmi; jangan mock `auth.getSession()` di tengah middleware.
- Database memakai disposable Neon test branch/database per CI run dengan migration production yang sama. Schema `neon_auth` tidak dimutasi test aplikasi.
- Object storage (Civo S3-compatible), Resend, Upstash, dan Ably memakai deterministic adapters di test cepat; nightly/staging contract suite menguji API provider nyata pada bucket/domain/key/database/app terisolasi.
- Test transaction menjalankan real constraints/triggers untuk cross-tenant FK, payment reversal, typed portal target, dan onboarding concurrency.

### 2.3 Contract Provider

| Provider | Fast CI | Staging contract |
|---|---|---|
| Managed Better Auth | Adapter conformance fixtures: valid/expired/missing session | Signup/signin/signout pada dedicated nonproduction auth project; tidak query/delete schema managed |
| Neon PostgreSQL | Disposable database/branch | Migration, pool, timeout, restore compatibility |
| Civo S3 Object Storage | Fake object adapter + capability verifier | Presign PUT, checksum, CORS, private-bucket denial, signed URL expiry |
| Upstash | In-memory limiter with shared contract | Atomic multi-key limit and TTL on isolated database |
| Resend | Capture adapter with deterministic failures | Verified sandbox recipient/domain; status mapping and redaction |
| Ably | Fake publisher/token capability verifier + duplicate/order/gap stream | Isolated app: token auth, capability denial, publish/subscribe, reconnect, expiry, redaction |

Provider failure fixtures harus menguji timeout, retryable error, permanent error, malformed response, dan redaction.

### 2.4 End-to-End — Playwright

- Jalankan terhadap Vercel preview yang memakai dedicated test dependencies, bukan production.
- Pre-provision owner identities atau gunakan public signup dengan unique run namespace. Jangan membersihkan `neon_auth` melalui SQL. Isolasi dihapus dengan supported project/branch lifecycle atau dibiarkan expire menurut test-data policy.
- Storage state Playwright dibuat per run dan tidak di-commit. Jangan menggunakan shared `playwright/.auth/user.json` lintas CI run.
- Jalankan satu happy path lengkap: onboarding → lead/client → order → contract publish/send/sign → invoice issue/proof/payment → presigned gallery/finalize → portal selection.
- Jalankan client portal melalui link/token nyata dari capture-email adapter, bukan bypass UI.

## 3. Skenario Kritis MVP

| Area | Positive | Negative/retry/concurrency |
|---|---|---|
| Onboarding | Satu workspace + active owner | exact/changing-key replay, concurrent request, transaction rollback, orphan auth reconciliation |
| Isolation | Owner hanya melihat workspace sendiri | valid foreign ID pada list/detail/search/nested mutation/export; cross-tenant FK ditolak DB |
| Membership/workspace | Active owner + active workspace authorized | missing/suspended/revoked membership, suspended/deletion-pending/deleted workspace, lifecycle exception, forged workspace input |
| Lead/client | Deterministic conversion | normalized duplicate, existing contact, repeated conversion, archived references |
| Order | Seluruh allowed transition | invalid/terminal/same-state retry dan audit count |
| Portal | Read exact typed resource | malformed/expired/revoked/wrong target/scope/subject, cookie rotation/fixation, brute-force limit |
| Contract | Snapshot/hash/PDF/signature evidence | template changed, wrong consent/hash, concurrent sign, void retains evidence, fresh-token send retry |
| Invoice | Issue, partial, full, reversal | invalid totals, overpay, duplicate/concurrent payment, proof wrong invoice/status, reversal twice, void before reversal |
| Upload | Presign/direct/finalize/delivery | altered capability, wrong principal/target/nonce, expiry, incomplete, MIME spoof, oversize, checksum, orphan cleanup |
| Gallery | Private photos + per-token selection | wrong-album photo, idempotent select/unselect, revoked URL, soft-delete retention |
| Cron/email | Eligible invoice reminder sent once/offset/day | -7/-1/0/+3 UTC boundary, paid/void/non-active workspace, missing secret, provider failure, fresh-token retry, dedupe, raw-token log scan |
| Lifecycle | Scoped export/deletion receipt | stale reauth, repeated deletion, immediate revoke, 30-day cleanup, legal hold, 2/10-year expiry |
| Realtime | Post-commit event memicu API refetch | foreign workspace/resource capability, publish capability denied, expiry, sensitive payload, pre-commit leak, duplicate/out-of-order/gap, provider outage/fallback |

## 4. Security, Accessibility, dan Performance

- Security tests: exact Origin/Host, absent/foreign/`null` Origin, CSRF mismatch, `If-Match` `428/412`, rate headers, token/secret redaction, SQL/XSS payload, object public-access denial, least-privilege DB/S3 roles.
- Dependency gate: lockfile immutable install, provenance/signature capability yang didukung npm baseline, audit policy terdokumentasi, dan secret scan. Jangan mengabaikan failure tanpa approved exception ber-expiry.
- Accessibility: axe automated scan serta manual keyboard/focus/screen-reader smoke pada onboarding, lead/order form, signing, invoice, dan gallery; semua wajib WCAG 2.2 AA.
- Performance: staging test minimal 1.000 request per endpoint kritis; p95 internal non-upload ≤500 ms di luar provider latency. Web Vitals p75 LCP ≤2,5 detik pada lima halaman inti dengan Lighthouse mobile profile.
- Reliability: inject retry/concurrency pada onboarding, sign, payment/reversal, finalize, delivery, cron, export, dan deletion.
- Realtime security/reliability: assertion capability hanya subscribe pada exact channel, event tidak terbit sebelum commit, payload allowlist-only, duplicate/out-of-order tidak menjadi state, reconnect/gap melakukan refetch, dan provider failure tidak rollback mutasi.

## 5. Test Data dan Cleanup

- Factory selalu membutuhkan `run_id` dan `workspace_id`; fixture dua tenant tersedia pada setiap authorization suite.
- Seed hanya boleh berjalan jika `NODE_ENV !== 'production'`, `VERCEL_ENV !== 'production'`, dan database host/branch cocok allowlist test.
- Jangan memakai data pribadi nyata. Gunakan domain email reserved dan gambar sintetis kecil dengan checksum tetap.
- Cleanup hanya menyentuh resource yang dibuat run tersebut melalui API aplikasi/provider yang didukung. Jangan menjalankan SQL pada schema `neon_auth` atau wildcard delete.
- TTL maksimal test artifact: database branch 24 jam, S3 prefix 24 jam, capture email 7 hari, CI artifact 14 hari; cleanup job idempotent dan diaudit.

## 6. CI dan Release Gates

Urutan pull request: immutable install → document/static validation → file-size check → lint → typecheck → unit → integration → build → preview → E2E/accessibility. Provider contract, performance, restore, dan deletion/retention drill berjalan nightly atau sebelum production release.

Konfigurasi TypeScript wajib `strict: true` dan tidak boleh mengaktifkan pengecualian yang melemahkan implicit/unsafe typing. ESLint type-aware menolak explicit `any` dan operasi unsafe; input HTTP/provider/database decoder dimulai sebagai `unknown` lalu divalidasi. `npm run check:file-size` menghitung physical lines file source/test: ≤400 adalah target review, 401–500 harus memiliki alasan pemisahan saat file disentuh, dan >500 gagal CI. Generated code, migration, lockfile, serta fixture data hanya dikecualikan lewat allowlist path eksplisit dengan owner/reason; glob umum seperti `src/**` dilarang.

```yaml
- run: npm ci
- run: npm run docs:check
- run: npm run check:file-size
- run: npm run lint
- run: npm run typecheck
- run: npm run test:unit -- --coverage
- run: npm run test:integration
- run: npm run build
- run: npm run test:e2e
```

Release diblokir bila ada test gagal, explicit/implicit/unsafe `any`, file source/test >500 baris di luar allowlist, migration drift, secret/high-critical dependency finding tanpa exception aktif, security severity tinggi/kritis, unmet accessibility/performance budget, atau restore/deletion drill tanpa bukti. Flaky test diperbaiki atau dikarantina dengan owner+expiry; tidak boleh di-skip permanen.

## 7. Traceability Matrix Final

| Requirement | Data contract | API/use case | Security control | Test suite | Roadmap |
|---|---|---|---|---|---|
| KF-ONB-001 | profiles/workspaces/members + unique/transaction | `POST /onboarding` | Session, owner creation, reconciliation | Onboarding concurrency/rollback/isolation | Phase 0 |
| KF-CRM-001 | clients/leads + normalized unique | `/clients`, `/leads/:id/convert` | Workspace scope + archive | Contact dedupe/conversion/cross-tenant | Phase 1 |
| KF-ORD-001 | orders + state matrix/snapshot | `/orders`, transitions | Owner scope + ETag | Required field/state/retry/audit | Phase 1 |
| KF-CON-001 | contract snapshot/signature/audit/object | publish/send + portal sign | Typed token, consent/hash, immutable evidence | Hash/concurrent sign/token matrix | Phase 2 |
| KF-INV-001 | items/ledger/reversal/proof | issue/payment/reverse/proof review | Transaction, idempotency, same-invoice proof | Partial/full/concurrent/reversal/void | Phase 2 |
| KF-GAL-001 | objects/albums/photos/selections | presign/finalize + portal album | Capability, private-bucket denial, token/photo scope | MIME/checksum/orphan/selection/URL expiry | Phase 3 |
| KF-NOT-001 | notification deliveries/dedupe | send + cron reminders | `CRON_SECRET`, redaction, fresh token retry | Provider failure/dedupe/auth/log scan | Phase 2–4 |
| KF-LIF-001 | workspace lifecycle/audit/retained snapshot | export/deletion request | Reauth, revoke, legal hold/retention | Export scope/30-day/2-year/10-year cleanup | Phase 4 |
| KF-RT-001 | Versioned event envelope/capability | `/realtime/token` + post-commit publish/refetch | Channel isolation, expiry, payload minimization | Capability/ordering/gap/failure/provider contract | Phase 0–4 |
| NFR-SEC-001 | Tenant keys/audit | All middleware | CSRF/origin/rate/least privilege | Security matrix | Phase 0–4 |
| NFR-ISO-001 | Composite FK/subject binding | Every owner/portal use case | Deny by default | Two-tenant matrix | Phase 0–4 |
| NFR-PRV-001 | Classification/retention | Export/deletion | UU PDP, minimization, redaction | Lifecycle/log scans | Phase 0,4 |
| NFR-PER-001 | Index budgets | Critical reads/mutations | Abuse limits active | k6 + Lighthouse budgets | Phase 4 |
| NFR-REL-001 | Idempotency/transactions | Critical mutations | Replay/concurrency controls | Fault injection suites | Phase 0–3 |
| NFR-ACC-001 | UI semantics | Five named flows | Accessible errors/session | axe + keyboard/manual | Phase 1–4 |
| NFR-OBS-001 | Audit/delivery/object states | Health/critical routes | Redaction + request ID | Correlation/redaction tests | Phase 0–4 |
| NFR-OPS-001 | Migration/retention contracts | Operational endpoints | Least privilege | Deploy/rollback/restore drills | Phase 0,4–5 |
| NFR-CQ-001 | Strict compiler/lint/file-size policy | Semua source/test | Unknown boundary + no unsafe bypass | Negative lint/type fixture + >500-line fixture | Phase 0–5 |

## 8. Dokumentasi dan Static Validation

`npm run docs:check` kelak harus memvalidasi local links/anchors, duplicate requirement IDs, Mermaid parse, JSON examples, table shape, route/status/role/environment vocabulary, dan traceability completeness. Static gate juga memindai kontradiksi scope Ably dan memastikan allowlist file-size hanya memuat path eksplisit. Sampai script tersedia, review checklist yang sama wajib dijalankan manual dan dicatat di handoff.
