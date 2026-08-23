# Laporan Implementasi — Phase 0 Wave 0 / Foundation

**Proyek:** KlikFrame (`msph1973/klikframe`)
**Paket:** Wave 0 — Foundation scaffold, shared contracts, quality gates
**Tanggal:** 2026-08-23 (revisi 2)
**Agen pelaksana:** External foundation implementer (ox-alpha)

---

## Status: READY (revisi 2 — TESTING.md §8 lengkap)

PR terbuka, seluruh CI checks hijau pada HEAD terbaru, seluruh temuan BOT terselesaikan (thread PRRT_kwDOT_C_FM6bX9Ko kini diimplementasikan penuh dan resolved — tidak ada thread terbuka). **PR sengaja tidak di-merge** — menunggu persetujuan eksplisit dari pengguna sesuai kontrak delegasi.

---

## Identitas Commit & Branch

| Item | Nilai |
|---|---|
| Baseline commit (`main`) | `d9597f6821f42410eadc8a1137e4f9e1822d987b` |
| Foundation branch | `foundation/phase-0-scaffold` |
| Worktree path | `/root/klik-foundation` |
| Foundation commit (HEAD) | `7e560f30a615d0793d28b88b24a98e5588939dac` |
| PR | [msph1973/klikframe#1](https://github.com/msph1973/klikframe/pull/1) |
| State PR | `OPEN`, `MERGEABLE`, mergeState `CLEAN`, `mergedAt: null` |
| Total perubahan | 68 file, ±11.4k baris |

Rantai commit foundation (terlama → terbaru):

```
23ad85d feat(foundation): Next.js App Router + Hono scaffold, quality gates, frozen contracts
db02b79 fix(foundation): apply Next.js 16 mandatory tsconfig.json corrections
daf8b02 fix(idempotency): deterministic key sort and undefined-safe canonical hash
0b23de3 fix: address cubic-dev-ai and gitar-bot review findings on PR #1
4ce0d15 fix(ci): gitignore generated SBOM and run secret scan before it exists
349f1bf fix: address round-2 cubic-dev-ai findings (edge cases in round-1 fixes)
ad906b0 fix: address round-3 cubic-dev-ai findings (Set-Cookie loss and markdown edge cases)
b34e9db docs: add Phase 0 Wave 0 foundation implementation report
09a3e5d feat(docs-check): implement full TESTING.md section 8 static validation
ba60a0f fix(docs-check): remove EVENT_NAME_PATTERN superseded by embedded variant
7e560f3 refactor(docs-check): extract STATUS_STOPWORDS to keep files under review target
```

## Git Bootstrap

- Pre-Git check TOOLING.md dijalankan: `.env` & `.env.s3` (berisi kredensial nyata) sudah ter-cover `.gitignore` pattern `.env*`; tidak ada pola secret pada file yang akan di-commit; JSON `opencode.json` tervalidasi.
- Identitas global disetel dan diverifikasi: `user.name=YLx`, `user.email=masipah1973@gmail.com`.
- `git init -b main` + `--add safe.directory /root/klik`.
- Remote `origin` = `https://github.com/msph1973/klikframe` (fetch = push), diverifikasi.
- Satu baseline commit hanya berisi 17 dokumen fondasi yang sudah ada (tanpa scaffold); di-push ke `main` sebagai satu-satunya pengecualian bootstrap dari aturan PR-only. Remote terkonfirmasi kosong (tanpa default branch) sebelum push.

---

## File yang Diubah (per tanggung jawab)

### Toolchain / Manifest
`package.json`, `package-lock.json`, `.nvmrc`, `.npmrc`, `.gitignore`, `tsconfig.json`, `eslint.config.mjs`, `next.config.ts`, `vitest.config.ts`, `.env.example`

### Composition Root Next.js + Hono
`app/api/[[...route]]/route.ts`, `app/api/auth/[...path]/route.ts`, `proxy.ts`, `app/layout.tsx`, `app/page.tsx`, `lib/http/app.ts`

### HTTP Shell
`lib/http/request-id.ts`, `lib/http/errors.ts`, `lib/http/health.ts`

### Config (server-only, parsed dari unknown)
`lib/config/env.ts`

### Frozen Contracts (vendor-neutral)
`lib/auth/identity-session-port.ts`, `lib/auth/server.ts`, `lib/db/transaction-port.ts`, `lib/idempotency/idempotency-port.ts`, `lib/realtime/realtime-port.ts`, `lib/shared/clock.ts`, `lib/shared/id.ts`, `lib/shared/provider-error.ts`

### Quality Gates
`scripts/docs-check.mjs`, `scripts/docs/markdown.mjs`, `scripts/docs/rules.mjs`, `scripts/docs/section8-rules.mjs`, `scripts/docs/canonical-vocabulary.mjs`, `scripts/docs/stopwords.mjs` (+ deklarasi `.d.mts`), `scripts/check-file-size.mjs` (+`.d.mts`), `scripts/secret-scan.mjs` (+`.d.mts`), `scripts/e2e-placeholder.mjs`, `config/file-size-allowlist.json`

### CI
`.github/workflows/ci.yml`, `.github/workflows/codeql.yml`, `.github/dependabot.yml`

### Tests & Fixtures
17 file test di `tests/unit/**` (144 test, termasuk 19 test §8), negative fixtures di `tests/fixtures/negative/**` (implicit-any, explicit-any + tsconfig isolat), `tests/setup/server-only-mock.ts`, `tests/integration/README.md`

---

## Frozen Interfaces (path + signature)

| Interface | Path | Signature kunci |
|---|---|---|
| `IdentitySessionPort` | `lib/auth/identity-session-port.ts` | `resolveSession(request: Request): Promise<SessionResolution>`; `SessionResolution = {kind:"authenticated"\|"unauthenticated"\|"expired"}` |
| `TransactionRunner<TxContext>` | `lib/db/transaction-port.ts` | `run<T>(work: (tx: TxContext) => Promise<T>): Promise<T>` |
| `IdempotencyStore` | `lib/idempotency/idempotency-port.ts` | `begin(scope, requestBodyHash): Promise<IdempotencyOutcome>`; `complete(scope, result)`; `IdempotencyKeyScope = principalId + route + resourceId(null) + key`; `computeCanonicalBodyHash(body: unknown): string` (code-point sort, undefined-safe) |
| `RealtimePublisher` | `lib/realtime/realtime-port.ts` | `publish(envelope, channels: readonly RealtimeChannel[]): Promise<void>` |
| `RealtimeTokenIssuer` | `lib/realtime/realtime-port.ts` | `issueCapability(channel): Promise<RealtimeTokenCapability>` + wajib panggil `assertRealtimeTokenTtl(clock, expiresAt)` (guard runtime ≤15 menit, menolak non-finite) |
| Envelope realtime | `lib/realtime/realtime-port.ts` | Discriminated union: setiap `eventType` terikat ke resource type sesuai API_SPEC §9.6 (contract.signed→contract, invoice.updated/payment.recorded→invoice, gallery.published/selection.updated→album) |
| `Clock` / `UuidGenerator` | `lib/shared/clock.ts`, `lib/shared/id.ts` | `now(): Date`; `next(): string` — implementasi System/Fixed dan Crypto/Sequential |
| `ProviderError` | `lib/shared/provider-error.ts` | kind: `timeout \| retryable \| permanent \| malformed_response`; getter `isRetryable` |
| Error envelope | `lib/http/errors.ts` | `ERROR_STATUS_MAP` (kode→HTTP status persis API_SPEC §1.2 + `INTERNAL_ERROR` catch-all tersanitasi); `AppError.from(cause)` memetakan ProviderError retryable → `DEPENDENCY_UNAVAILABLE`(503) |

---

## Keputusan

1. **ESLint pin `9.39.5`**, bukan latest `10.9.0` — `eslint-config-next@16.3.1` membawa `eslint-plugin-react` yang memanggil `context.getFilename()` yang telah dihapus di ESLint 10 (crash saat load config; lihat vercel/next.js#89764). Direvisit ulang ketika eslint-config-next merilis plugin yang kompatibel.
2. **Env provider-specific tetap `.optional()`** di Phase 0 karena belum ada adapter yang mengonsumsi nilainya dan CI/local tanpa secret provisioned; tiap provider wave mengetatkan field miliknya saat adapter di-wire. Yang sudah diterapkan sejak foundation: `UPSTASH_REDIS_REST_URL` wajib https, secret min. 32 byte, blank `.env.example`-style dianggap unset, `NODE_ENV` kosong ditolak (tidak diam-diam fallback ke default).
3. **`test:integration` / `test:e2e` no-op tapi terpasang** di urutan CI TESTING.md §6 (`--passWithNoTests` / placeholder) — harness nyata milik Step 2 (data), Step 4 (integrasi), Step 5 (verifier). Pemisahan unit vs integration dipaksakan lewat argumen path di masing-masing npm script, bukan hanya `include` config.
4. **`docs:check` mengimplementasikan seluruh TESTING.md §8**: links/anchors, duplikat/referensi requirement-ID (definisi kanonis = heading KF-* + baris tabel NFR-* di section Non-Functional Requirements saja), parse JSON/Mermaid, table shape, unterminated fence, forbidden env vocabulary (negasi per kalimat), route vocabulary lintas dokumen (referensi route di luar API_SPEC harus terdeklarasi; prefix `/api/v1` distrip dari path; proxy auth dikecualikan), status vocabulary (token status dekat kata "status" harus anggota enum DATABASE_SCHEMA), role vocabulary (role non-owner hanya boleh dalam konteks Post-MVP/out-of-scope), traceability completeness (kedua matriks wajib setara ID + fase; tiap fase yang direferensikan wajib punya heading Fase di ROADMAP), dan Ably scope consistency (action scope allowlist API_SPEC §7, bentuk channel kanonis, pairing event→resource §9.6, aturan server-only key/publish-capability).
5. **Secret scan diposisikan setelah e2e** agar urutan persis TESTING.md §6, tetapi sebelum SBOM generation sehingga artifact generated (`sbom.cyclonedx.json`, untracked+gitignored) tidak memicu fail-closed oversize-check.
6. **SBOM native**: `npm sbom --sbom-format=cyclonedx` (didukung npm 11.19.0) — tanpa dependency tambahan.
7. **Auth proxy shell** (`app/api/auth/[...path]/route.ts` + `proxy.ts`) mendelegasikan via composition point yang dapat ditukar (`setAuthRequestHandler` / `setAuthProxyHandler` di `lib/auth/server.ts`) sehingga provider wave (Step 3) tidak pernah menyentuh composition root Next.js. Route juga memaksa konsistensi `X-Request-Id`: ID terkomputasi dipaksakan ke request yang didelegasikan dan response header selalu dioverwrite, dengan preservasi penuh multi `Set-Cookie`.

---

## Validasi

Semua command dieksekusi lokal di `/root/klik-foundation` mengikuti urutan TESTING.md §6:

| # | Command | Exit | Hasil ringkas |
|---|---|---|---|
| 1 | `npm ci` | 0 | 406 packages, immutable install dari lockfile |
| 2 | `npm run docs:check` | 0 | 18 Markdown divalidasi (termasuk §8 vocabulary/traceability/Ably), 0 temuan |
| 3 | `npm run check:file-size` | 0 | 52 file source/test discan, 0 melewati target review 400 |
| 4 | `npm run lint` | 0 | `eslint .` type-aware (strictTypeChecked + stylisticTypeChecked), 0 error |
| 5 | `npm run typecheck` | 0 | `tsc --noEmit` strict bersih |
| 6 | `npm run test:unit -- --coverage` | 0 | **144 tests lulus**; coverage ≥95%; thresholds ≥80% global, ≥90% `lib/idempotency/**` aktif dan terpenuhi |
| 7 | `npm run test:integration` | 0 | passWithNoTests (kosong by design, milik Step 2) |
| 8 | `npm run build` | 0 | Build produksi Next.js 16.3.1 sukses (Turbopack) |
| 9 | `npm run test:e2e` | 0 | Placeholder terdokumentasi (milik Step 5) |
| 10 | `npm audit signatures` | 0 | 406 packages signature verified, 104 attestation verified |
| 11 | `npm audit --audit-level=high` | 0 | 0 vulnerabilities (full dependency tree) |
| 12 | `npm run secret:scan` | 0 | Bersih (tracked + untracked-not-ignored, fail-closed >500KB) |
| 13 | `npm sbom --sbom-format=cyclonedx` | 0 | SBOM CycloneDX 1.5 ~521KB di-generate (CI step + upload artifact) |

### Negative fixtures (pembuktian gate menolak)

| Fixture | Perintah | Exit | Bukti penolakan |
|---|---|---|---|
| Implicit any | `node node_modules/typescript/bin/tsc --noEmit -p tests/fixtures/negative/tsconfig.json` | 2 | `error TS7006: Parameter 'value' implicitly has an 'any' type` |
| Explicit/unsafe any | `node node_modules/eslint/bin/eslint.js --no-ignore tests/fixtures/negative/explicit-any.fixture.ts` | 1 | 3 error: `no-explicit-any`, `no-unsafe-assignment`, `no-unsafe-member-access` |
| File >500 baris | unit test `evaluateFile` + allowlist | 0 (assert lulus) | severity `fail` untuk >500 tanpa allowlist entry eksplisit; glob path di allowlist ditolak |

Invokasi binary melalui `process.execPath <pkg>/bin/<entry>.js` (cross-platform, exact-pinned) — bukan `npx` (ambigu versi) maupun `node_modules/.bin/*` (rusak di Windows).

### Smoke test runtime

`next build && next start`, diverifikasi via curl:
- `GET /api/v1/health` → 200 `{"status":"ok","version":...}` + header `X-Request-Id`
- Rute tidak dikenal di luar daftar kanonis API_SPEC (uji: path acak yang tidak dideklarasikan) → 404 envelope `RESOURCE_NOT_FOUND` dengan `request_id` yang sama dengan header
- `GET /api/auth/get-session` → 503 envelope `DEPENDENCY_UNAVAILABLE` (perilaku shell yang benar sebelum adapter provider di-wire)

---

## gh pr checks status

```
Analyze (javascript-typescript)   pass    56s    GitHub Actions
CodeQL                            pass     2s    GitHub Actions
Foundation quality gates          pass    61s    GitHub Actions (semua gate TESTING.md §6)
CodeRabbit                        pass     0s    Review skipped (repo <10 stars, manual trigger)
Gitar                             pass   1m14s   app.gitar.ai
Job 1 (Klikframe)                 pass     0s    TeamCity
Klikframe (KlikFrame)             pass     0s    TeamCity
cubic · AI code reviewer          pass   7m30s   www.cubic.dev
```

Exit code `gh pr checks`: **0** (semua hijau).

---

## Status BOT Review

| Bot | Status akhir |
|---|---|
| **cubic-dev-ai** | ✅ Konvergen setelah 6 putaran review. Pass terakhir pada HEAD `7e560f3`: 1 temuan P3 metadata (laporan tertinggal satu commit) — diperbaiki di commit laporan ini; tidak ada isu kode tersisa |
| CodeRabbit | Pass — skip by configuration (repo OSS <10 stars); opsi trigger manual tersedia di PR |

---

## Setiap Temuan BOT dan Resolusinya

### Round 1 — gitar-bot (2 temuan) + cubic (39 temuan unik, deduplicated dari dua submission)

| # | Lokasi | Temuan | Resolusi |
|---|---|---|---|
| G1 | `lib/idempotency/idempotency-port.ts` | Sort key pakai `localeCompare` (locale-dependent) → hash bisa beda antar environment | ✅ Code-point comparison; commit `daf8b02`; regression test pasangan key locale-sensitive |
| G2 | `lib/idempotency/idempotency-port.ts` | `canonicalize(undefined)` return nilai JS `undefined` (bukan string) → TypeError saat hash body kosong | ✅ Map `undefined` → `"null"` dengan trade-off terdokumentasi; regression test no-throw |
| C1–C39 | Berbagai | Lihat rincian komentar PR ([ringkasan round-1](https://github.com/pull/1#issuecomment-5380336924)): idempotency scope tanpa resource dimension, publisher tanpa channel tujuan, envelope union, TTL guard, Upstash http, ProviderError→503 mapping, kind `unauthorized` tak berkanon, health baca process.env langsung, auth route tanpa jaminan X-Request-Id, ekstensi `.mts/.cts/.jsx` terlewat, 13 temuan robustness parser markdown/docs, NFR self-authorize, vitest include, tsconfig exclude shadowing, lint scope, audit --omit=dev, SBOM hilang, npx ambiguity, dead-code test, afterEach no-op, README stale command, lang mismatch, asersi korrelasi missing, nama test overclaim | ✅ Semua difix di `0b23de3` + `4ce0d15` (38 thread resolved); regression test utk tiap fix |

### Round 2 — cubic (23 temuan baru, deduplicated → 18 genuin + 5 duplikat stale)

| Temuan (lokasi) | Resolusi |
|---|---|
| `vitest.config.ts` — integration masuk shared `include` bikin `test:unit` ikut menjalankan test DB | ✅ `test:unit` kini passing path args eksplisit `tests/unit tests/negative`; commit `349f1bf` |
| `app/api/auth/[...path]/route.ts` — handler delegasi bisa mint ID sendiri → desync client vs provider logs | ✅ Force computed ID ke request delegasi + selalu overwrite response header |
| `lib/http/health.ts` — `getEnv()` gagal total jika var tak terkait malformed → 500 liveness | ✅ Accessoris sempit baru `getDeployMetadata()` divalidasi independen; health pakai itu |
| `lib/config/env.ts` — array input diam-dipa jadi object; `NODE_ENV=""` diam-diam fallback default | ✅ Array diteruskan ke Zod (ditolak); `NODE_ENV` dikecualikan dari blank-stripping |
| `lib/realtime/realtime-port.ts` — invalid Date → NaN lolos kedua bound check TTL | ✅ Guard `Number.isFinite(ttlMs)` eksplisit; regression test |
| `scripts/secret-scan.mjs` — exemption `tests/` prefix-based (real secret di tests/ lain lolos); quoted JSON key tidak terdeteksi | ✅ Dipersempit ke exact file; dukungan `"SECRET": "..."` |
| `scripts/docs/markdown.mjs` (3) — fence indent >3 spasi close early; closer lebih pendek dari opener salah status; `~~~` fence tak dikenal; multi-backtick code span salah split; prose line ber-pipe code-span jadi phantom row | ✅ Rewriting unified `scanFences()` (marker length variabel, same-char rule CommonMark, ≤3 indent), `splitRow` backtick-run-aware, row continuation pakai output `splitRow`; semua fence-consumer derivasi satu pass |
| `scripts/docs/rules.mjs` — NFR-shaped ID dari tabel mana pun di PRODUCT_REQUIREMENTS self-authorize; unterminated fence hanya exact-3-backtick closer | ✅ Definisi NFR di-scope ke section Non-Functional Requirements saja; closer ≥ panjang opener didukung |
| `tests/negative/quality-gates.test.ts` — `npx` ambigu versi; oversize test dead-code write | ✅ Jalankan `node <pkg>/bin/<entry>.js` via `process.execPath`; test membaca file balik |
| `tests/unit/auth/server.test.ts` — afterEach no-op self-reassignment | ✅ Helper baru `resetAuthCompositionForTests()` yang benar-benar restore default |
| `.github/workflows/ci.yml` — audit skip devDeps padahal dieksekusi di CI; secret scan di luar urutan dokumentasi | ✅ Full-tree audit; scan dikembalikan ke posisi sesuai TESTING.md §6 (tetap sebelum SBOM) |
| Test completeness (2) — discriminated union tanpa negative case; envelope coverage baru 3/5 event types | ✅ Tambah `@ts-expect-error` case mismatch event/resource; lengkapi ke 5/5 member union |
| 5 duplikat stale (round-1 double-submission) | ✅ Dibalas dengan referensi fix yang sudah ada, lalu resolved |

### Round 3 — cubic (3 temuan)

| # | Lokasi | Temuan | Resolusi |
|---|---|---|---|
| R3-1 | `lib/http/request-id.ts:50` (P1) | Rebuild Response dari Headers collapse repeated `Set-Cookie` (last-one-wins) → bisa pecah session establishment multi-cookie | ✅ Diverifikasi dulu mekanismenya (repro Node), lalu `withRequestIdHeader` capture `getSetCookie()` sebelum rebuild, delete header collapse, re-append tiap cookie individual; regression test two-cookie session intact; commit `ad906b0` |
| R3-2 | `scripts/docs/markdown.mjs:13` (P2) | `~~~ json` (whitespace sebelum language) tidak pernah open → closer jadi phantom unterminated | ✅ `FENCE_OPEN` allow `\s*` antara marker dan info-string; regression test utk ``` json dan ~~~ json |
| R3-3 | `scripts/docs/markdown.mjs:151` (P2) | Baris malformed outer-pipe-only (`| only |`) ter-drop diam-diam alih-alih dilaporkan mismatch kolom | ✅ Helper bersama baru `isTableRowCandidate`: pertahankan outer-pipe-only row agar surface sebagai finding; prose ber-pipe code-span tetap terminate table; regression test kedua arah |

### Thread PRRT_kwDOT_C_FM6bX9Ko — TESTING.md §8 (sebelumnya didefer, KINI IMPLEMENTED)

| Thread | Status akhir |
|---|---|
| [`scripts/docs-check.mjs` — TESTING.md §8 full automation](https://github.com/msph1973/klikframe/pull/1#discussion_r3835996892) | ✅ **Resolved setelah implementasi penuh** (revisi 2). Temuan awal: docs:check belum menguji route/status/role vocabulary, traceability completeness, dan Ably scope consistency. Semua kini otomatis di `scripts/docs/section8-rules.mjs` + vocabulary kanonis di `scripts/docs/canonical-vocabulary.mjs`, dengan 19 test positif/negatif di `tests/unit/scripts/section8-rules.test.ts`. Deferral sebelumnya dicabut; tidak ada thread terbuka tersisa. |

---

## Konfirmasi

- ❌ **TIDAK ADA MERGE** — `gh pr view`: `state: OPEN`, `mergedAt: null`, `mergeCommit: null`. Branch `origin/main` masih di baseline `d9597f6` (hanya dokumen).
- ✅ Tidak ada force-push; semua push bersifat fast-forward pada branch foundation.
- ✅ Worktree `/root/klik-foundation` dan branch `foundation/phase-0-scaffold` dibiarkan utuh untuk siklus feedback.
- ✅ Tidak ada secret/PII/private endpoint yang di-commit (`.env*` tetap ter-ignore; secret scan bersih).
- ✅ Scope dijaga: tanpa schema/migration/repository, tanpa adapter provider konkret, tanpa onboarding business logic/route, tanpa fitur Phase 1+. Tidak ada modifikasi dokumen kanonis maupun `.junie/plans/**`. File memory (HANDOFF/DECISIONS/PROJECT_CONTEXT) tidak disentuh sesuai instruksi (update menunggu evidence tervalidasi oleh integrator).

---

## Blockers

**Tidak ada blocker teknis.** Merge PR #1 kini hanya menunggu keputusan eksplisit Anda.

## Remaining Risks

1. **ESLint tertahan di v9** sampai `eslint-config-next` merilis `eslint-plugin-react` yang kompatibel ESLint 10 — upgrade path perlu dipantau di wave berikutnya (low risk, fungsional penuh di v9).
2. **BOT review adalah AI reviewer** (gitar/cubic/CodeRabbit) — approval mereka bukan substitusi human review. Persetujuan merge tetap di tangan Anda.
3. **Integration/E2E belum ada harness nyata** — sesuai desain gelombang (Step 2/4/5); CI step sudah terpasang di posisi kanan sehingga harness tinggal di-drop-in.
4. **Status-vocabulary check berbasis stoplist** — pendekatan "token backtick dekat kata status" sengaja menerima false-negative kecil (status salah yang tidak ditulis di baris ber-kata "status"); false positive dicegah lewat stoplist identifier. Trade-off didokumentasikan di source.
5. **GitHub secret scanning / push protection** direkomendasikan diaktifkan di level repo (Settings → Code security) sebagai pelengkap scanner lokal — di luar wewenang agen (butuh akses settings admin).

## Langkah Berikutnya (untuk Anda)

1. Review PR [#1](https://github.com/msph1973/klikframe/pull/1) — diff 67 file, deskripsi lengkap di body PR.
2. Jika setuju: berikan instruksi eksplisit "merge PR #1" (agen tidak akan merge tanpa instruksi tersebut).
3. Setelah merge: Wave 1A (data: schema/migration/repository) dan Wave 1B (provider: ports/adapters/Ably) siap dikerjakan paralel dari merge-commit hasil PR #1 (bukan SHA cabang foundation) sesuai plan.
