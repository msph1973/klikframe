# Kebijakan Keamanan — KlikFrame

## 1. Identity, Session, dan Tenancy

- Autentikasi dikelola **Neon Auth (Managed Better Auth)**. Tabel pada schema `neon_auth`, password, OAuth credential, verification, serta session berada di boundary provider dan tidak diduplikasi aplikasi.
- Session owner memakai cookie `httpOnly`, `Secure`, `SameSite=Lax`; cookie signing secret hanya ada di environment platform. OAuth dikonfigurasi di Neon Console.
- Managed Better Auth berstatus Beta dan bukan boundary tenant. Adapter auth mengisolasi provider-specific calls sehingga perpindahan provider tidak mengubah `profiles`, `workspaces`, atau `workspace_members`.
- Setiap pendaftar mendapat satu workspace dan satu membership `owner` aktif secara atomik/idempotent. MVP tidak memiliki invitation, `admin`, atau `assistant`.
- Data bisnis tidak pernah di-scope langsung dengan session user ID. Middleware mengambil membership aktif, menetapkan `workspace_id` server-side, lalu repository selalu memfilter resource dengan workspace tersebut.

Urutan wajib endpoint owner: **resolve session → active owner membership → allowed workspace state → resource workspace scope → input validation**. Route bisnis hanya menerima workspace `active`; export/deletion boleh `active`/`suspended` setelah reauthentication; `deletion_pending`/`deleted` selalu ditolak. Jangan menerima `workspace_id` otoritatif dari body/query/header client. Owner suspended/revoked diperlakukan tidak memiliki akses.

## 1.1 Portal Klien

- Portal memakai opaque token acak minimal 256-bit. Database hanya menyimpan SHA-256 hash; token mentah hanya ada pada URL yang dikirim dan tidak masuk log, analytics, referrer, atau error.
- Resolver memeriksa token dengan perbandingan constant-time, expiry, revocation, resource type/id, client, workspace, dan scope action.
- Token ditempatkan di fragment/bootstrap exchange atau route yang segera menukar token ke cookie portal `httpOnly`; response memakai `Referrer-Policy: no-referrer` dan tidak di-cache publik.
- Revocation efektif sebelum request berikutnya. Rotasi membuat token baru dan mencabut token lama.

## 1.2 Ably Realtime

- Browser tidak pernah menerima `ABLY_API_KEY`; Hono menukar owner session atau portal cookie aktif menjadi Ably token capability subscribe-only dengan expiry maksimal 15 menit.
- Owner capability hanya untuk channel akun bisnis hasil membership server-side. Portal capability hanya untuk exact token principal + resource type/ID/scope; channel name atau `workspace_id` dari client tidak dipercaya.
- Nama channel, payload event, client ID, log, dan metadata provider tidak memuat PII, raw token, signed URL, isi kontrak, signature, bukti pembayaran, atau nominal.
- Event hanya invalidation setelah commit. Subscriber tidak mempercayai payload sebagai state dan tetap melewati authorization `/api/v1` saat refetch, sehingga duplicate/out-of-order/gap tidak dapat melewati resource scope.
- Token issue dan publish dibatasi rate, diaudit/diukur tanpa secret, dan app Ably dipisahkan per environment. Provider failure tidak rollback transaksi bisnis dan tidak membuka fallback channel lintas tenant.

## 2. Input Validation

- Semua input dari client divalidasi dengan **Zod schema** di Hono.
- Hindari penggunaan `eval` atau `innerHTML` dengan data user.
- Sanitasi output untuk mencegah XSS (React sudah escape by default, tapi tetap validasi).
- Signature diunggah sebagai private PNG maksimal 1 MB melalui portal presign/finalize dan capability exact-target; base64 inline tidak diterima.
- Mutasi berbasis cookie wajib memverifikasi allowed `Origin`/`Host` dan memakai CSRF token untuk form/request yang tidak terlindungi `SameSite`; method aman tidak boleh mengubah state.

## 3. SQL Injection

- Menggunakan **Drizzle ORM** dengan parameterized queries.
- Tidak ada query string mentah (`sql.raw` hanya jika perlu dan dengan binding).

## 4. File Upload (Civo S3 Object Storage)

- Upload selalu memakai presign → direct object-storage upload → finalize. Presign hanya mengizinkan key acak ber-prefix workspace/purpose, content length, checksum, MIME allowlist, dan expiry singkat.
- Gallery image menerima JPEG/PNG/WebP maksimal 20 MB; payment proof menerima JPEG/PNG/PDF maksimal 10 MB; signature hanya PNG yang dibatasi ukuran. Finalize memeriksa magic bytes, size, checksum, key, ownership, dan object existence.
- File disimpan di **Civo S3 Object Storage** (private bucket, `Block Public Access = ON`). Database menyimpan key dan metadata, bukan signed URL; akses download hanya lewat presigned download URL ber-expiry yang dihasilkan server on-demand.
- Row upload tetap `pending` sampai finalize, lalu `available` atau `quarantined`/`failed`. Cleanup menghapus pending expired, checksum mismatch, dan orphan object secara idempotent.
- Bucket: versioning ON, server-side encryption, lifecycle sesuai retention/legal hold, CORS hanya untuk `https://app.klikframe.id`.
- Scan malware opsional dengan ClamAV (Post-MVP).

## 5. Payment Webhook Security (Post-MVP — nonaktif di MVP)

> MVP tanpa Midtrans. Transfer manual dicatat owner sebagai immutable payment ledger dengan idempotency key; status invoice dihitung transaksional dari ledger.

Saat Midtrans aktif:
- Verifikasi signature Midtrans menggunakan `serverKey` (HMAC SHA-512).
- Hanya menerima request dari IP Midtrans (opsional, via allowlist).
- Tidak mempercayai data dari client untuk status pembayaran.
- Webhook harus idempotent (cek `external_id` sudah diproses belum).

## 6. Rate Limiting

- Implementasi rate limit menggunakan **Upstash Redis**:
  - Login (`/api/auth/*`): 5 percobaan per menit per IP.
  - Upload: 20 request per menit per user.
  - API umum: 100 request per menit per user.
  - Resolve token portal: 10 request per menit per IP + token fingerprint.
  - Tanda tangan dan payment proof: 5 request per menit per token + IP.
- Response 429 menyertakan header `Retry-After`.
- Rate limit auth juga di-handle di sisi Neon Auth service.

## 7. Security Scanning di CI

- **Semgrep**: analisis static code untuk vulnerability (jalan di GitHub Actions).
- **CodeQL**: analisis kode untuk CWE.
- **Trivy**: scan Docker image worker sebelum deploy — **hanya jika pakai worker BullMQ Post-MVP** (MVP tanpa Docker, skip).
- **npm audit signatures** + **Dependabot** wajib aktif untuk supply-chain.
- TypeScript `strict` + ESLint type-aware menolak explicit/implicit `any`, unsafe assignment/member access/call/return, dan bypass boundary; input provider tetap `unknown` sampai tervalidasi.

> MVP: cukup Semgrep + CodeQL + `npm audit signatures`. Trivy ditunda.

## 8. Data Privacy

- Mematuhi **UU Perlindungan Data Pribadi (UU PDP)** Indonesia.
- Data klien hanya digunakan untuk keperluan order.
- Data diklasifikasikan sebagai identity, contact, contract evidence, financial record, media, security log, atau operational metadata. Collection dan log mengikuti minimisasi UU PDP.
- Export hanya dijalankan untuk owner yang reauthenticated dan hanya mengambil workspace `active`/`suspended` miliknya; workspace lain dan state deletion ditolak.
- Deletion request mencabut session dan portal token segera; media/data nonwajib dijadwalkan hard delete maksimal 30 hari. Tidak ada cascade buta dari auth user ke record bisnis.
- Retensi MVP mengikuti matriks di bawah. Legal/privacy owner wajib menyetujui dasar hukum sebelum production; perubahan periode memperbarui requirement, schema cleanup, dan test bersama-sama.
- IP/user-agent signature adalah evidence sensitif: akses dibatasi, penggunaan diaudit, dan tidak ditampilkan pada UI umum.

| Kategori | Retensi setelah penutupan akun | Dasar/akses | Setelah expiry |
|---|---|---|---|
| Session dan portal token | Dicabut segera; record operasional maksimal 30 hari | Security/revocation; system only | Hard delete atau anonymize identifier |
| Profile, lead, client contact, draft order/document | Maksimal 30 hari | Pemenuhan deletion request; restricted cleanup job | Revoke token, null client FK, lalu hard delete contact/draft |
| Gallery media dan payment proof nonretained | Maksimal 30 hari | Pemenuhan layanan/deletion; signed access only | Delete S3 object lalu tombstone metadata |
| Contract snapshot, PDF, signature evidence | 10 tahun sejak akhir tahun order selesai/void | Pembuktian kontrak/klaim; legal/support audited access | Cryptographic erase object dan delete/anonymize row sesuai legal hold |
| Invoice dan payment ledger | 10 tahun sejak akhir tahun transaksi | Catatan finansial/perpajakan; owner + audited finance/support access | Delete/anonymize bila tidak ada legal hold |
| Completed/void order subject + minimum client snapshot | 10 tahun mengikuti contract/invoice terlama | Integritas referensi dan pembuktian; encrypted, legal/support audited access | Delete subject/snapshot setelah seluruh child expiry |
| Audit event umum | 2 tahun | Security/accountability; security-only query | Delete partition; event terkait record 10 tahun mengikuti record induk |

Legal hold menunda expiry hanya untuk record yang disebut, mencatat actor/alasan/waktu, dan ditinjau minimal tahunan. Production release membutuhkan approval matriks serta bukti export, expiry cleanup, legal-hold, restore, dan deletion drill.

## 8.1 Auditability

- Event append-only wajib untuk onboarding, membership/status, publish/void/sign contract, issue/void invoice, record/reverse payment, token issue/revoke, upload finalize/delete, export, dan deletion request.
- Event menyimpan request ID dan actor reference, tetapi tidak menyimpan raw token, cookie, signature bytes, full contact data, atau secret.
- Application role tidak diberi izin update/delete audit row; koreksi dilakukan dengan compensating event.

## 9. Secrets Management

- Nama environment variable kanonis hanya didefinisikan di `DEPLOYMENT.md` §3. Nilai berada pada Vercel/CI secret store dan password manager; tidak ada secret atau private endpoint literal di Git, log, memory, maupun preview output.
- `NEON_AUTH_COOKIE_SECRET`, `UPLOAD_CAPABILITY_SECRET`, dan `CRON_SECRET` memakai nilai random independen minimal 32 byte. `ABLY_API_KEY` hanya tersedia server-side; rotasi mencabut key lama setelah overlap token expiry. Rotasi auth secret menginvalidasi session; semua rotation diaudit tanpa menyimpan nilai.
- Civo object-storage credential memakai principal least-privilege pada bucket/prefix environment (`PutObject/GetObject/HeadObject/DeleteObject`). `S3_ENDPOINT` wajib https dan tidak boleh berupa endpoint privat di luar allowlist. App tidak memiliki bucket-policy mutation. Secret scan wajib pada pull request dan sebelum Git initialization/import.
- `opencode.json` adalah tooling lokal dan mengikuti `TOOLING.md`; provider/MCP token serta endpoint privat hanya lewat environment.

## 10. Incident Response

- Error tracking dan alert production wajib melalui Sentry/metric providers yang ditetapkan `DEPLOYMENT.md`; contact alert tidak di-hardcode di repository.
- Target log operasional minimal 30 hari harus diverifikasi terhadap plan platform; jika platform tidak memenuhi, gunakan sink eksternal atau kurangi klaim sebelum production.
- Restore database/S3 dan rollback deploy adalah prosedur teruji, bukan asumsi fitur plan. Bukti drill staging wajib sebelum beta production.

## 11. Toolchain dan Supply-Chain

Matriks versi tunggal beserta sumber resmi berada di `DEPLOYMENT.md` §1. Dokumen keamanan tidak menyalin daftar versi/CVE yang cepat usang; advisory Node.js, npm, TypeScript, Next.js, GitHub, dan dependency langsung ditinjau saat scaffold, upgrade, dan release.

Kontrol wajib:

- Exact dependency versions dan committed `package-lock.json`; CI hanya memakai `npm ci`.
- Package baru menjalani owner/source/license/permission/provenance review dan release-age cooldown yang didukung npm baseline.
- CI menjalankan audit vulnerability/signature capability, secret scan, CodeQL, SBOM generation, lint/type/test/build, dan menolak high/critical finding tanpa exception aktif.
- Dependency update melalui pull request dengan test/preview evidence. Dependabot atau bot lain hanya membuat PR dan tidak auto-merge.
- Install script, native binary, Git dependency, lifecycle hook, dan newly-published package memerlukan review tambahan; token CI least-privilege dan tidak tersedia pada untrusted fork.
- npm publishing (jika kelak ada) memakai 2FA/trusted publishing; application build tidak membutuhkan npm write token.
- Security exception mencatat package/advisory, exposure, compensating control, owner, dan expiry. Expired exception memblokir release.
- Runtime permission flag bukan sandbox; Vercel/Civo/database roles tetap least privilege.
Baseline diverifikasi ulang terhadap sumber resmi sebelum scaffold dan setiap upgrade. Lockfile/SBOM menjadi bukti versi aktual yang dirilis.
