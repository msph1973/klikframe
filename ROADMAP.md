# Roadmap Pengembangan — KlikFrame

- **Status:** Baseline delivery MVP
- **Last updated:** 20 Agustus 2026
- **Product source of truth:** [Product Requirements](PRODUCT_REQUIREMENTS.md)

Roadmap ini mengurutkan delivery requirement, bukan menambah cakupan produk. MVP hanya memiliki pemilik akun bisnis dan klien; fitur tim serta role tambahan dimulai setelah MVP tervalidasi. Versi toolchain tidak diduplikasi di sini dan mengikuti baseline terverifikasi di `DEPLOYMENT.md` serta lockfile saat implementasi.

## Prinsip Delivery

- Selesaikan satu vertical slice yang dapat diuji sebelum menambah automasi.
- Setiap fase memiliki exit criteria dan traceability ke requirement.
- Hono `/api/v1` menjadi boundary eksternal; UI dan Server Actions memakai service/use-case yang sama.
- Data dua akun bisnis harus terisolasi sejak migrasi pertama.
- Ably adalah dependency MVP khusus event/invalidation bisnis; database dan `/api/v1` tetap sumber data kanonis.
- Midtrans, WhatsApp API, worker terpisah, AI, pgvector, dan manajemen tim bukan dependency MVP.

## Fase 0 — Foundation dan Onboarding (Minggu 1–2)

**Requirement:** `KF-ONB-001`; fondasi `KF-RT-001`; baseline `NFR-SEC-001`, `NFR-ISO-001`, `NFR-PRV-001`, `NFR-REL-001`, `NFR-OBS-001`, `NFR-OPS-001`, dan `NFR-CQ-001`.

- Setup repository, toolchain konservatif yang di-pin, lockfile, dan CI: strict lint/typecheck tanpa `any`, file-size gate 500 baris, test, build, serta supply-chain checks (`NFR-SEC-001`, `NFR-OPS-001`, `NFR-CQ-001`).
- Setup Next.js/Hono di Vercel, Neon PostgreSQL/Managed Better Auth, Upstash, private Civo S3 Object Storage, Resend, dan Ably app terisolasi per environment.
- Implementasi migration baseline, profile aplikasi, workspace teknis, dan membership pemilik.
- Implementasi satu alur registrasi/onboarding tanpa pilihan tipe akun.
- Setup request ID, structured error/logging, secret management, dan health check (`NFR-OBS-001`, `NFR-SEC-001`).
- Implementasi port realtime, endpoint token capability owner/portal, versioned event envelope, dan deterministic fake adapter; event domain mulai dipublish oleh slice yang memilikinya.

**Exit criteria:** Onboarding atomik dan idempotent lulus integration test; dua akun bisnis terbukti terisolasi; deploy preview dan migration dapat diulang.

## Fase 1 — Lead, Klien, dan Order (Minggu 3–4)

**Requirement:** `KF-CRM-001`, `KF-ORD-001`.

- CRUD, search, filter, dan archive lead.
- Data klien serta konversi lead deterministik ke klien existing atau tepat satu klien baru.
- Order dengan field minimum dan transition table `draft → confirmed → in_progress → completed`, serta jalur `cancelled` yang ditetapkan requirement.
- Dashboard status pekerjaan dengan UX responsive dan accessible.
- Audit dasar untuk perubahan sensitif.

**Exit criteria:** Pemilik dapat membawa lead menjadi order; cross-account list/detail/search/mutation ditolak; invalid transition dan retry teruji.

## Fase 2 — Kontrak dan Invoice (Minggu 5–6)

**Requirement:** `KF-CON-001`, `KF-INV-001`, dan delivery penerbitan pada `KF-NOT-001`.

- Template dan snapshot kontrak final, document hash, PDF React-PDF, serta penyimpanan private.
- Portal token untuk melihat dan menandatangani kontrak dengan evidence append-only.
- Invoice item, snapshot rekening, instruksi transfer manual, dan upload bukti pembayaran private yang ter-scope.
- Ledger pembayaran parsial/penuh dengan idempotency, status invoice transaksional, dan proyeksi pembayaran order yang dihitung.
- Email penerbitan kontrak dan invoice melalui Resend.
- Publish `contract.signed`, `invoice.updated`, dan `payment.recorded` setelah commit; subscriber hanya invalidasi/refetch resource terkait.

**Exit criteria:** Snapshot tidak berubah saat template diedit; signature evidence lengkap; pembayaran parsial/penuh dan duplicate request konsisten; token matrix lulus.

## Fase 3 — Portal, Galeri, dan Reminder (Minggu 7–8)

**Requirement:** `KF-GAL-001` dan delivery reminder pada `KF-NOT-001`.

- Portal klien ter-scope untuk kontrak, invoice, dan album.
- Upload presign → S3 direct upload → finalize dengan verifikasi metadata dan checksum.
- Delivery melalui presigned download URL sementara; object storage tetap private.
- Album dan selection/favorit per principal klien.
- Vercel Cron reminder terproteksi dan pengiriman email dengan retry/deduplication.
- Publish `gallery.published` dan `selection.updated` setelah commit dengan capability portal ter-scope.

**Exit criteria:** Upload incomplete, MIME palsu, checksum gagal, dan object orphan ditangani; token valid/expired/revoked/salah scope/rate-limit teruji; cron tidak dapat dipanggil tanpa secret.

## Fase 4 — Hardening dan Data Lifecycle (Minggu 9–10)

**Requirement:** `KF-LIF-001`, seluruh NFR.

- Export data dan workflow permintaan penghapusan dengan reauthentication, audit, dan legal-retention exceptions.
- Observability endpoint kritis, cron, email, upload, dan audit tanpa token/data sensitif.
- Observability Ably auth/publish/failure/reconnect gap; provider failure tidak rollback state bisnis dan fallback refetch tetap benar.
- Accessibility conformance WCAG 2.2 AA pada lima alur `NFR-ACC-001` dan performance measurement sesuai sample/profile `NFR-PER-001`.
- Backup/restore drill, migration rollback drill, retention cleanup, policy retensi legal dengan periode/dasar hukum pasti, dan incident runbook.
- Security review untuk tenant isolation, portal token, CSRF/origin, rate limit, serta object access.

**Exit criteria:** Quality gates lintas dokumen dan aplikasi lulus; tidak ada temuan security severity tinggi/kritis terbuka; restore dan rollback memiliki bukti eksekusi.

## Fase 5 — Beta dan Peluncuran MVP (Minggu 11–12)

**Requirement:** Semua requirement MVP dan metrik beta di `PRODUCT_REQUIREMENTS.md`.

- Uji beta dengan sedikitnya 10 pemilik akun bisnis.
- Validasi alur lead → order → kontrak → invoice → galeri serta lifecycle data.
- Perbaikan berdasarkan telemetry dan feedback tanpa menambah scope Post-MVP.
- Production readiness review dan production deployment.
- Go/no-go berdasarkan metrik keberhasilan, security findings, serta skenario kritis.

**Exit criteria:** Seluruh acceptance criteria MVP dan skenario kritis lulus; production monitoring aktif; rollback owner serta prosedur incident terdokumentasi.

## Fase 6 — Post-MVP (Setelah Validasi)

Urutan berikut ditentukan dari hasil beta, bukan komitmen tanggal:

- Undangan anggota, pengelolaan tim, multi-membership, dan role `admin`/`assistant`.
- Analitik bisnis dan pengaturan notifikasi lanjutan.
- Midtrans atau payment gateway lain.
- WhatsApp API dan template pesan otomatis.
- Ekspansi realtime ke presence, typing indicator, atau payload data lengkap hanya jika tervalidasi; kontrak MVP tetap event/invalidation.
- Upstash QStash atau worker terpisah jika retry dan throughput membutuhkannya.
- AI culling, pencarian pgvector, generator website portofolio, marketplace, dan aplikasi mobile.

## Change Control

- Fitur baru harus memiliki requirement dan acceptance criteria di `PRODUCT_REQUIREMENTS.md` sebelum dijadwalkan.
- Perubahan fase harus memperbarui traceability matrix dan dokumen teknis yang terdampak.
- Fitur Post-MVP tidak boleh menjadi dependency tersembunyi pada migration, API wajib, UI onboarding, atau exit criteria MVP.
