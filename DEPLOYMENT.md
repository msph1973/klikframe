# Panduan Deployment — KlikFrame

## 1. Baseline dan Prasyarat

| Komponen | Baseline MVP | Pin | Sumber resmi |
|---|---|---|---|
| Node.js | 24.19.0 LTS | `.nvmrc`, `engines`, CI image | [Node.js v24.19.0 release](https://nodejs.org/en/blog/release/v24.19.0) |
| npm | 11.19.0 | `packageManager` + CI | [npm 11.19.0 changelog](https://docs.npmjs.com/cli/v11/using-npm/changelog#11190-2026-07-28) |
| TypeScript | 5.9.3 | exact devDependency | [Microsoft TypeScript releases](https://github.com/microsoft/TypeScript/releases/tag/v5.9.3) |
| Next.js | 16.3.1 | exact dependency | [Official npm package](https://www.npmjs.com/package/next/v/16.3.1) |

Tabel ini adalah satu-satunya matriks versi kanonis. Versi library lain dipilih dari compatibility/security review saat scaffold lalu di-pin exact dalam `package-lock.json`; tidak ada `latest` pada manifest atau command release. Baseline diverifikasi ulang terhadap sumber resmi sebelum scaffold/upgrade, dan perubahan hanya melalui pull request dengan CI/rollback evidence.

Prasyarat: akun Vercel, Neon project dengan Managed Better Auth, Upstash Redis, Civo account (S3 Object Storage), Resend domain, Ably app, GitHub repository, serta owner untuk security/privacy/operations. Midtrans, WhatsApp provider, QStash/BullMQ, AI, dan pgvector bukan dependency MVP.

## 2. Arsitektur Deployment MVP

- Satu Next.js/Hono deployment Vercel untuk UI, `/api/v1`, auth proxy, dan Vercel Cron.
- Neon PostgreSQL untuk schema aplikasi; Managed Better Auth mengelola identity/session pada `neon_auth`.
- Upstash Redis hanya untuk shared rate limit dan cache ringan.
- Private Civo S3 Object Storage (S3-compatible) dengan Block Public Access + server-side encryption; delivery memakai presigned download URL ber-expiry yang dihasilkan server.
- Resend untuk email synchronous-after-commit dengan persisted delivery/dedupe state.
- Ably untuk event/invalidation bisnis setelah commit; app/key dipisahkan per environment dan tidak menyimpan state kanonis.

Preview, staging, dan production memakai project/database/bucket/prefix/Redis/domain terpisah. Production secret dan data tidak boleh tersedia pada preview.

## 3. Konfigurasi Environment Variables

Semua secret disimpan di Vercel/CI secret store, tidak di Git, preview logs, atau dokumentasi bernilai nyata. Production dan nonproduction memakai nilai berbeda. Canonical MVP variables:

```env
APP_ORIGIN=https://app.klikframe.id
DATABASE_URL=<neon-pooled-connection>
DATABASE_MIGRATION_URL=<neon-direct-connection>
NEON_AUTH_BASE_URL=<managed-auth-url>
NEON_AUTH_COOKIE_SECRET=<random-32-plus-bytes>
UPSTASH_REDIS_REST_URL=<https-url>
UPSTASH_REDIS_REST_TOKEN=<secret>
AWS_ACCESS_KEY_ID=<civo-object-storage-access-key>
AWS_SECRET_ACCESS_KEY=<civo-object-storage-secret-key>
S3_ENDPOINT=https://objectstore.<region>.civo.com
AWS_REGION=<civo-region>
S3_BUCKET=<private-bucket-name>
UPLOAD_CAPABILITY_SECRET=<random-32-plus-bytes>
DATA_ENCRYPTION_KEY=<versioned-envelope-key>
CRON_SECRET=<random-32-plus-bytes>
RESEND_API_KEY=<secret>
RESEND_FROM_EMAIL=no-reply@klikframe.id
ABLY_API_KEY=<server-only-api-key>
SENTRY_DSN=<project-dsn>
SENTRY_AUTH_TOKEN=<build-only-secret>
```

Generate independent random secrets; jangan reuse satu nilai:

```bash
openssl rand -base64 32
```

Google OAuth dikonfigurasi pada Neon Console, bukan melalui app env. `NEXTAUTH_*`, `GOOGLE_CLIENT_*`, `S3_PUBLIC_URL`, `R2_*`, `MIDTRANS_*`, `WHATSAPP_*`, `QSTASH_*`, dan worker variables tidak boleh ada pada MVP. Satu-satunya env Ably kanonis adalah `ABLY_API_KEY`; public API key atau `NEXT_PUBLIC_ABLY_*` dilarang.

## 4. Langkah Deploy (MVP)


1. **Verify baseline dan immutable install:**
    ```bash
    node --version # v24.19.0
    npm --version  # 11.19.0
    npx tsc --version # 5.9.3
    npm ci
    npm run docs:check
    npm run check:file-size
    npm run lint && npm run typecheck && npm run test && npm run build
    ```

2. **Provision per environment:** Neon branch/project and Managed Auth, isolated Upstash DB, Civo object-storage bucket/prefix per environment, Resend domain, Ably app/API key, Sentry project, Vercel project/alias.

3. **Harden storage:** bucket private (Block Public Access ON), server-side encryption, versioning, lifecycle rules, and CORS exact `APP_ORIGIN`. Direct unauthenticated object read must fail; delivery hanya melalui presigned download URL ber-expiry.

4. **Set environment variables** with preview/staging/production scope. Run secret scan and verify no production secret is exposed to preview/build output.

5. **Validate migration on disposable/staging branch:**
    ```bash
    npm run db:generate
    npm run db:migrate
    npm run db:check
    ```
    Production migration hanya memakai checked-in migration via direct migration URL; `drizzle-kit push` dilarang. Schema `neon_auth` tidak dimigrasikan aplikasi.

6. **Deploy preview, run E2E/provider smoke, lalu promote immutable artifact:**
    ```bash
    vercel build
    vercel deploy --prebuilt
    npm run test:e2e
    ```

7. **Configure cron** dengan path kanonis dan `CRON_SECRET`:
    ```json
    {
      "crons": [{ "path": "/api/v1/internal/cron/reminders", "schedule": "0 9 * * *" }]
    }
    ```
    Vercel mengirim `Authorization: Bearer <CRON_SECRET>`. Missing/wrong secret harus `401`; retry tanggal sama harus terdeduplikasi.

8. **Production smoke:** `/api/v1/health`, unauthenticated auth denial, owner onboarding on controlled account, portal exchange, signed URL expiry, rate limit, cron auth, Resend sandbox, Ably owner/portal token capability + publish/refetch/reconnect, request-ID/log redaction. Promote only after go/no-go approval.

## 5. Monitoring & Logging

- Production wajib memiliki Sentry server/client, Vercel Web Vitals, Neon query/connection metrics, Upstash limiter metrics, object-storage access/error metrics (Civo), Resend delivery result, Ably token/publish/failure/reconnect metrics, dan cron summary.
- Semua request memiliki `X-Request-Id`; audit, delivery, storage finalize, dan provider error dapat dikorelasikan. Raw cookie/token, signed URL query, signature bytes, contact body, database URL, dan secret direduksi sebelum log/APM.
- Alert minimum: error-rate spike, p95 budget breach, database saturation, rate-limit backend failure, Ably auth/publish failure spike, cron tidak sukses >26 jam, email failure spike, orphan/pending upload backlog, dan backup/restore drill overdue.
- Log operasional target 30 hari dan audit mengikuti 2/10-year policy. Sebelum production, verifikasi plan platform memenuhi target; jika tidak, aktifkan encrypted log drain dengan least-privilege access.
- Dependabot/security advisory, CodeQL, lockfile audit/provenance capability, secret scan, dan SBOM artifact berjalan di CI. Exception memiliki owner, alasan, expiry, dan compensating control.

## 6. Backup & Recovery

Target MVP: **RPO ≤24 jam** dan **RTO ≤4 jam** untuk data aplikasi; object media mengikuti versioning/lifecycle dan metadata database. Ini target produk, bukan klaim kemampuan plan provider.

- Sebelum production, verifikasi dan catat fitur/retensi backup Neon plan. Jika PITR window tidak memenuhi target, buat daily encrypted logical backup menggunakan read-only backup identity ke bucket backup terpisah dari app bucket.
- S3 versioning ON; lifecycle noncurrent version mengikuti retention/legal-hold policy, bukan blanket 90-day delete. Backup bucket tidak dapat ditulis credential aplikasi.
- Backup mencakup schema/migration version, application data, serta inventory object/checksum. Schema managed auth mengikuti prosedur recovery resmi provider; jangan dump/edit tabelnya tanpa dukungan resmi.
- Secret rotation runbook mencakup auth cookie (invalidasi session), upload capability, cron, Civo object-storage key, Upstash, Resend, Ably (overlap maksimal token expiry lalu revoke key lama), dan Sentry. Evidence tanpa nilai secret disimpan bersama release record.
- Rollback app mempromosikan artifact Vercel sebelumnya. Migration memakai expand/contract: deploy backward-compatible schema, app switch, lalu cleanup pada release terpisah. Destructive migration membutuhkan verified backup + rehearsed forward-fix; jangan mengandalkan down migration.

## 7. Email dan Cron Reliability

- Resource mutation dan `notification_deliveries: pending` commit sebelum Resend call. Success/failure memperbarui row dan attempt count.
- Retry delivery failed mencabut token undelivered dan menghasilkan fresh raw link hanya di memory; sent delivery tetap deduped. Reminder key resource+recipient+tanggal UTC membatasi satu kiriman per hari.
- Cron hanya route `/api/v1/internal/cron/reminders`, `CRON_SECRET` constant-time check, timeout budget, bounded batch, dan summary metric. Manual retry menggunakan secret yang sama dan dedupe persisten.

## 8. Checklist Go-Live MVP

- [ ] Exact Node/npm/TypeScript/Next baseline, lockfile, immutable install, document/file-size/lint/type/test/build/E2E gates lulus; tidak ada `any` dan file source/test >500 baris di luar allowlist.
- [ ] Seluruh env canonical terisi pada scope yang benar; forbidden/legacy env, private endpoint, dan secret tidak ada di repository/build/log.
- [ ] Managed Auth Beta boundary, migration/reconciliation, email+OAuth/session flows, dan provider exit path diuji.
- [ ] Object storage private/SSE/versioning/CORS/presign/finalize/checksum/orphan cleanup dan presigned download URL expiry teruji.
- [ ] Civo key rotation, least-privilege credential, Upstash shared limiter, Resend SPF/DKIM/dedupe/fresh-token retry teruji.
- [ ] Ably app terpisah per environment, server-only key, owner/portal capability isolation, token expiry/rotation, post-commit event, redaction, duplicate/order/gap, outage/refetch fallback teruji.
- [ ] `CRON_SECRET`, canonical route, daily dedupe, missed-run alert, dan manual retry teruji.
- [ ] Sentry/metrics/request ID/redaction/alerts aktif; public health tidak membocorkan dependency.
- [ ] Backup feature/retention terverifikasi; restore memenuhi RPO/RTO; deletion/retention/legal-hold drill lulus.
- [ ] Security, accessibility, performance, privacy, dan traceability gates pada `TESTING.md` lulus; go/no-go owner tercatat.
