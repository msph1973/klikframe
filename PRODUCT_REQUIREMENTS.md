# Product Requirements — KlikFrame MVP

## 1. Status Dokumen

- **Status:** Baseline produk MVP
- **Last updated:** 20 Agustus 2026
- **Owner:** Product dan Engineering
- **Dokumen terkait:** [Roadmap](ROADMAP.md), [Arsitektur](ARCHITECTURE.md), [Skema Database](DATABASE_SCHEMA.md), [Spesifikasi API](API_SPEC.md), [Keamanan](SECURITY.md), [Testing](TESTING.md), [Deployment](DEPLOYMENT.md)

Dokumen ini adalah sumber kebenaran untuk tujuan produk, persona, ruang lingkup, user story, dan acceptance criteria. Dokumen teknis menjelaskan cara memenuhi requirement di sini dan tidak boleh memperluas MVP tanpa perubahan requirement yang disetujui.

## 2. Ringkasan Produk

KlikFrame membantu pemilik akun bisnis fotografi mengelola pekerjaan dari calon klien hingga penyerahan galeri dalam satu alur: **lead → order → kontrak → invoice → galeri**. Klien menerima tautan aman untuk meninjau dan menandatangani kontrak, melihat invoice, serta mengakses galeri tanpa masuk ke dashboard bisnis.

### 2.1 Masalah yang Diselesaikan

- Informasi calon klien, pekerjaan, dokumen, pembayaran, dan galeri tersebar di banyak alat.
- Status pekerjaan sulit ditelusuri sehingga tindak lanjut dan penagihan mudah terlewat.
- Klien membutuhkan pengalaman yang sederhana dan aman tanpa harus mempelajari aplikasi bisnis.
- Pemilik membutuhkan satu catatan operasional yang konsisten, bukan automasi kompleks sebelum alur dasar tervalidasi.

### 2.2 Sasaran MVP

- Satu pemilik dapat menyelesaikan alur bisnis inti tanpa spreadsheet terpisah.
- Klien dapat menyelesaikan tindakan yang diminta melalui portal berbasis tautan aman.
- Ownership, status, dan riwayat tindakan penting dapat diaudit serta terisolasi antar akun bisnis.
- MVP dapat diuji bersama sedikitnya 10 pemilik akun bisnis sebelum fitur tim atau integrasi berbayar ditambahkan.

## 3. Persona MVP

### 3.1 Pemilik Akun Bisnis Fotografi

Orang yang mendaftar, mengatur profil bisnis, mengelola data operasional, dan menjadi satu-satunya pengguna dashboard pada MVP. Pengguna yang bekerja sendiri maupun mengelola studio mengikuti onboarding yang sama; tidak ada pilihan tipe akun saat mendaftar.

**Kebutuhan utama:**

- Melihat posisi setiap pekerjaan dengan cepat.
- Membuat dokumen dan galeri yang konsisten.
- Menagih dan mencatat pembayaran manual secara akurat.
- Membagikan akses klien tanpa membuka data bisnis lain.

### 3.2 Klien

Pihak yang menerima layanan fotografi dan mengakses resource tertentu melalui portal aman. Klien bukan anggota dashboard dan tidak memiliki role internal.

**Kebutuhan utama:**

- Membaca dan menandatangani kontrak yang final.
- Melihat invoice dan instruksi pembayaran yang jelas.
- Mengakses galeri serta menyimpan pilihan foto.
- Memahami status tindakan tanpa proses login yang rumit.

## 4. Prinsip Pengalaman Produk

- Gunakan istilah **akun bisnis**, bukan workspace atau tenant, pada UI dan komunikasi pengguna.
- Jangan meminta pengguna memilih antara akun solo dan studio.
- Setiap halaman menampilkan tindakan utama dan status yang dapat dipahami tanpa pengetahuan teknis.
- Portal hanya menampilkan resource dalam scope tautan klien yang sedang digunakan.
- Status tidak boleh berubah diam-diam; tindakan sensitif menghasilkan umpan balik dan jejak audit.
- Semua alur utama dapat digunakan pada layar mobile dan dengan keyboard.

## 5. Definisi MVP

MVP dinyatakan selesai ketika satu pemilik akun bisnis dapat mendaftar, menyelesaikan onboarding, membuat lead dan klien, mengubah pekerjaan menjadi order, menerbitkan kontrak, mencatat pembayaran invoice, menyerahkan galeri, serta memenuhi lifecycle data dasar. Klien dapat menandatangani kontrak, melihat invoice, dan menggunakan galeri melalui akses terbatas.

### 5.1 Dalam Cakupan

- Registrasi, session, onboarding, dan satu akun bisnis otomatis.
- Profil bisnis serta rekening tujuan untuk snapshot invoice.
- Lead, data klien, order, dan status alur kerja.
- Template kontrak, snapshot kontrak, PDF React-PDF, tanda tangan, dan audit evidence.
- Invoice item, pembayaran transfer manual parsial/penuh, bukti pembayaran opsional, dan reminder email.
- Portal klien berbasis opaque token.
- Album, upload langsung presigned S3, delivery presigned download URL private, dan pilihan/favorit klien.
- Event bisnis realtime melalui Ably untuk perubahan kontrak, invoice, pembayaran, galeri, dan selection; event hanya memicu invalidation/refetch API.
- Export data dan permintaan penghapusan akun dengan pengecualian retensi yang dijelaskan.
- Logging, rate limit, observability minimum, dan quality gates rilis.

### 5.2 Di Luar Cakupan MVP

- Undangan anggota, pengelolaan tim, dan role `admin` atau `assistant`.
- Midtrans atau payment gateway lain.
- WhatsApp API, worker terpisah, dan aplikasi mobile native.
- AI culling, pencarian pgvector, marketplace, serta generator website portofolio.
- Akuntansi, payroll, inventaris, booking marketplace, dan CRM marketing lanjutan.

## 6. User Stories dan Acceptance Criteria

### KF-ONB-001 — Onboarding Akun Bisnis

**User story:** Sebagai pemilik, saya ingin mendaftar melalui satu alur agar dapat mulai bekerja tanpa memilih tipe bisnis.

**Acceptance criteria:**

- Registrasi/onboarding membuat tepat satu akun bisnis dan satu membership pemilik aktif secara atomik.
- Pengulangan request dengan identitas yang sama tidak membuat akun bisnis atau membership kedua.
- Dashboard tidak dapat digunakan sebelum profil wajib onboarding lengkap.
- Kegagalan parsial tidak meninggalkan akun bisnis tanpa pemilik.

### KF-CRM-001 — Lead dan Klien

**User story:** Sebagai pemilik, saya ingin mencatat calon klien dan data klien agar tindak lanjut tidak tersebar.

**Acceptance criteria:**

- Pemilik dapat membuat, melihat, memperbarui, mencari, memfilter, dan mengarsipkan lead milik akun bisnisnya.
- Konversi lead harus memilih satu klien existing atau membuat tepat satu klien baru; jika email atau nomor telepon ternormalisasi cocok dengan klien aktif pada akun bisnis yang sama, sistem mewajibkan penggunaan klien existing.
- Konversi lead yang sama bersifat idempotent dan selalu menghasilkan hubungan ke `client_id` yang sama.
- Data dari akun bisnis lain tidak pernah muncul pada hasil list, search, detail, export, atau error.
- Pengarsipan mempertahankan riwayat yang masih dirujuk order.

### KF-ORD-001 — Order dan Alur Status

**User story:** Sebagai pemilik, saya ingin mengubah pekerjaan yang disepakati menjadi order agar kontrak, invoice, dan galeri berada dalam satu konteks.

**Acceptance criteria:**

- Order selalu terkait dengan satu klien dan minimal menyimpan nama layanan, tanggal/waktu pekerjaan, nilai yang disepakati, serta status.
- Status order adalah `draft`, `confirmed`, `in_progress`, `completed`, atau `cancelled`; transisi MVP hanya `draft → confirmed|cancelled`, `confirmed → in_progress|cancelled`, dan `in_progress → completed|cancelled`.
- `completed` dan `cancelled` bersifat terminal pada MVP; request transisi berulang ke state yang sama aman dan tidak membuat audit event duplikat.
- Kontrak, invoice, album, dan audit event dapat ditelusuri dari order.
- Status pembayaran order berasal dari ledger pembayaran invoice, bukan perubahan UI tanpa bukti.

### KF-CON-001 — Kontrak dan Tanda Tangan

**User story:** Sebagai pemilik, saya ingin menerbitkan kontrak final agar klien dapat meninjau dan menandatanganinya secara aman.

**Acceptance criteria:**

- Penerbitan membuat snapshot konten final dan document hash; perubahan template berikutnya tidak mengubah kontrak terbit.
- PDF dibuat dengan React-PDF dan disimpan sebagai object private.
- Klien dengan token valid dan scope benar dapat melihat lalu menandatangani tepat kontrak tersebut.
- Signature menyimpan signer role, consent timestamp, IP, user-agent, signature object, document hash, dan audit event append-only.
- Token expired, revoked, salah scope, atau terkena rate limit tidak dapat membaca atau menandatangani kontrak.

### KF-INV-001 — Invoice dan Pembayaran Manual

**User story:** Sebagai pemilik, saya ingin menerbitkan invoice dan mencatat transfer agar sisa tagihan selalu akurat.

**Acceptance criteria:**

- Invoice menyimpan item, subtotal, total, jatuh tempo, dan snapshot rekening tujuan saat diterbitkan.
- Klien dengan akses valid dapat melihat invoice dan instruksi transfer tanpa melihat resource lain.
- Pemilik dapat mencatat satu atau beberapa pembayaran; total dibayar dan sisa tagihan dihitung dari ledger.
- Request pembayaran berulang dengan idempotency key yang sama tidak menggandakan nominal.
- Status invoice `unpaid`, `partial`, dan `paid` berubah dalam transaksi ledger yang konsisten; ringkasan pembayaran order dihitung dari invoice/ledger dan bukan state order manual.
- Klien dengan token invoice yang valid dapat mengunggah bukti opsional berupa JPEG, PNG, atau PDF maksimal 10 MB melalui presign/finalize; object tetap private, terikat ke invoice yang sama, dan gagal scope/MIME/ukuran/checksum tidak menjadi bukti aktif.

### KF-GAL-001 — Galeri dan Pilihan Klien

**User story:** Sebagai pemilik, saya ingin menyerahkan galeri private agar klien dapat melihat dan memilih foto dengan aman.

**Acceptance criteria:**

- Upload menggunakan alur presign → direct upload → finalize; finalize memverifikasi key, ownership, ukuran, MIME, dan checksum.
- Upload yang tidak selesai atau gagal verifikasi tidak menjadi foto aktif dan dapat dibersihkan sebagai orphan.
- URL upload dan delivery memiliki masa berlaku; bucket tidak public-read dan URL permanen tidak disimpan.
- Klien hanya dapat melihat album dalam scope token dan pilihan foto disimpan per principal klien, bukan boolean global.
- Token valid, expired, revoked, salah scope, dan brute-force/rate-limit menghasilkan perilaku yang teruji.

### KF-NOT-001 — Email dan Reminder

**User story:** Sebagai pemilik, saya ingin sistem mengirim tautan serta reminder agar tindakan klien tidak terlewat.

**Acceptance criteria:**

- Email kontrak dan invoice menggunakan Resend serta tidak memuat token dalam log.
- Vercel Cron reminder hanya berjalan dengan `CRON_SECRET` valid.
- Penerbitan memakai idempotency key per resource/version/penerima; reminder memakai key per jenis resource/penerima/tanggal UTC sehingga satu reminder otomatis maksimal terkirim sekali per hari.
- Kegagalan pengiriman tercatat dan dapat diulang tanpa mengubah state bisnis secara keliru.

### KF-LIF-001 — Export dan Penghapusan

**User story:** Sebagai pemilik, saya ingin mengekspor atau meminta penghapusan data agar dapat mengelola lifecycle akun secara transparan.

**Acceptance criteria:**

- Export setelah reauthentication hanya berisi data akun bisnis milik pemilik dalam status `active` atau `suspended`; workspace `deletion_pending`/`deleted` dan akun bisnis lain selalu ditolak.
- Permintaan penghapusan memerlukan reauthentication/konfirmasi dan menghasilkan audit event.
- Session dan token dicabut segera; object serta data nonwajib dijadwalkan terhapus maksimal 30 hari setelah permintaan tervalidasi.
- Record kontrak, invoice, pembayaran, dan audit yang wajib dipertahankan dikecualikan hanya menurut policy yang menyebut kategori, periode pasti, dasar hukum, akses selama retensi, dan tindakan setelah expiry; production release diblokir sampai policy tersebut disetujui di `SECURITY.md`.
- Session, token portal, dan akses object dicabut sesuai urutan lifecycle yang terdokumentasi.

### KF-RT-001 — Event Bisnis Realtime

**User story:** Sebagai pemilik atau klien portal, saya ingin perubahan penting terlihat tanpa refresh manual agar status yang sedang saya lihat cepat diperbarui.

**Acceptance criteria:**

- Ably mengirim event/invalidation setelah transaksi kanonis berhasil commit untuk kontrak, invoice, pembayaran, galeri, dan selection.
- Payload hanya memuat `event_id`, `schema_version`, `event_type`, resource type/ID, dan timestamp; payload tidak memuat PII, token, signed URL, isi dokumen, atau nominal pembayaran.
- Owner hanya mendapat capability channel akun bisnisnya; portal hanya mendapat capability channel resource dan action scope dari principal aktif.
- Duplicate atau out-of-order event tidak mengubah state secara langsung. Client melakukan refetch `/api/v1`, dan reconnect/gap selalu memulihkan state dari API.
- Kegagalan publish Ably tidak membatalkan transaksi bisnis; kegagalan terukur, dapat didiagnosis, dan UI tetap benar melalui refetch/polling fallback terbatas.

## 7. Alur Inti End-to-End

1. Pemilik mendaftar dan menyelesaikan onboarding akun bisnis.
2. Pemilik membuat lead, melengkapinya sebagai klien, lalu membuat order.
3. Pemilik memilih template dan menerbitkan kontrak snapshot.
4. Klien membuka tautan aman, membaca, memberi consent, dan menandatangani kontrak.
5. Pemilik menerbitkan invoice; klien melihat instruksi transfer dan dapat mengirim bukti.
6. Pemilik mencatat pembayaran parsial atau penuh sampai invoice lunas.
7. Pemilik mengunggah foto melalui presigned S3 dan menerbitkan album.
8. Klien membuka galeri private serta menyimpan pilihan foto.
9. Sistem mempertahankan audit trail, reminder yang terdeduplikasi, dan lifecycle data sepanjang alur.
10. Perubahan kontrak, invoice, pembayaran, galeri, dan selection menerbitkan invalidation event setelah commit; client mengambil ulang state kanonis melalui API.

## 8. Non-Functional Requirements

| ID | Area | Requirement MVP |
|---|---|---|
| NFR-SEC-001 | Security | Semua akses owner memverifikasi session, membership aktif, dan resource scope; semua akses klien memverifikasi hash token, scope, expiry, revocation, dan rate limit. |
| NFR-ISO-001 | Isolation | Pengujian otomatis membuktikan dua akun bisnis tidak dapat membaca atau mengubah data satu sama lain. |
| NFR-PRV-001 | Privacy | Pengumpulan, export, retensi, dan deletion data mengikuti prinsip minimisasi serta UU PDP; secret dan token mentah tidak masuk log. |
| NFR-PER-001 | Performance | Pada staging setara production, p95 endpoint internal non-upload wajib ≤500 ms untuk minimal 1.000 request per endpoint kritis di luar latency provider; p75 LCP wajib ≤2,5 detik pada onboarding, dashboard, signing, invoice, dan gallery menurut profil Lighthouse mobile. |
| NFR-REL-001 | Reliability | Mutasi kritis onboarding, signature, finalize upload, dan pembayaran bersifat transaksional/idempotent serta aman saat retry. |
| NFR-ACC-001 | Accessibility | Onboarding, form lead/order, signing, invoice, dan gallery wajib memenuhi WCAG 2.2 AA untuk keyboard, focus terlihat, label form, kontras, pesan error, dan reduced motion. |
| NFR-OBS-001 | Observability | Request ID, error terstruktur, metrik endpoint kritis, cron result, email result, dan audit event tersedia tanpa mengekspos data sensitif. |
| NFR-OPS-001 | Operability | Deploy, migration, rollback, backup/restore drill, dan incident response memiliki prosedur yang dapat diverifikasi sebelum beta production. |
| NFR-CQ-001 | Code quality | TypeScript `strict` melarang explicit/implicit/unsafe `any`; boundary eksternal memakai `unknown` + validasi/narrowing. File source/test ditargetkan ≤400 baris dan CI gagal di atas 500 baris, kecuali allowlist artefak non-source yang eksplisit. |

## 9. Asumsi dan Batasan

- Satu identitas pemilik hanya memiliki satu akun bisnis pada MVP.
- Klien tidak wajib membuat akun dashboard; akses berbasis tautan/token yang dapat dicabut.
- Pembayaran diverifikasi manual oleh pemilik; KlikFrame bukan pemroses pembayaran pada MVP.
- Email adalah channel otomatis utama; tautan dapat disalin ke channel lain secara manual.
- Foto asli dapat berukuran besar sehingga upload tidak melewati bandwidth fungsi Vercel.
- Tim internal, multi-membership, dan delegasi permission tidak dibutuhkan untuk validasi awal.
- Managed Better Auth masih diperlakukan sebagai dependency yang memiliki boundary migrasi terdokumentasi.

## 10. Metrik Keberhasilan Beta

- Sedikitnya 10 pemilik menyelesaikan onboarding tanpa bantuan perubahan data manual.
- Sedikitnya 80% order beta yang masuk status `confirmed` mencapai kontrak signed, invoice issued, dan gallery published tanpa koreksi data oleh engineering.
- Tidak ada temuan isolasi akun bisnis severity tinggi/kritis yang terbuka saat rilis beta.
- Sedikitnya 90% pengiriman email transaksional mencapai status accepted atau delivered; kegagalan dapat didiagnosis.
- Semua skenario kritis pada `TESTING.md` lulus sebelum production beta.

## 11. Initial Traceability Matrix

Kontrak teknis pada matriks ini telah dispesifikasikan tetapi belum diimplementasikan. Matriks final lintas test/roadmap berada di `TESTING.md` §7.

| Requirement | Data/contract | API/use case | Security rule | Test scenario | Roadmap |
|---|---|---|---|---|---|
| KF-ONB-001 | `workspaces`, owner membership | Onboard business account | Session + atomic ownership | Duplicate/retry/rollback onboarding | Phase 0 |
| KF-CRM-001 | Leads, clients, normalized contact uniqueness | Lead/client CRUD, deterministic conversion, archive | Business-account isolation | Existing-contact conversion, retry, cross-account denial | Phase 1 |
| KF-ORD-001 | Orders and explicit status transitions | Order lifecycle | Owner membership + scope | Required fields, full transition table, retry | Phase 1 |
| KF-CON-001 | Contract snapshot, signature, audit | Publish/view/sign contract | Portal token + immutable evidence | Expired/revoked/scope/sign retry | Phase 2 |
| KF-INV-001 | Invoice items, payment ledger, private proof object | Issue/view/record payment/upload proof | Owner/portal scope + idempotency + upload validation | Partial/full/duplicate/concurrent payment and proof type/size/checksum | Phase 2 |
| KF-GAL-001 | Storage objects, albums, selections | Presign/finalize/view/select | Object ownership + token scope | MIME/checksum/orphan/token matrix | Phase 3 |
| KF-NOT-001 | Notification delivery and dedupe keys | Issue email in Phase 2; invoice cron in Phase 3; hardening in Phase 4 | `CRON_SECRET` + token redaction | Auth/retry/daily deduplication | Phase 2–4 |
| KF-LIF-001 | Deletion/export audit | Export/delete account | Reauthentication + retention policy | Cross-account export and legal hold | Phase 4 |
| KF-RT-001 | Versioned event envelope + scoped capability | Realtime token + post-commit publish/refetch | Least-privilege Ably channel, no sensitive payload | Cross-account capability, duplicate/order/gap/provider failure | Phase 0–4 |
| NFR-SEC-001 | Auth/authorization controls | Middleware and sensitive use cases | Session/token/scope controls | Owner, portal, CSRF/origin, rate-limit matrices | Phase 0–4 |
| NFR-ISO-001 | Workspace ownership constraints | Every business-data use case | Deny by default across accounts | Cross-account list/detail/mutation/export | Phase 0–4 |
| NFR-PRV-001 | Data classification and retention | Export/delete/redaction use cases | UU PDP, minimization, legal retention | Log scan, deletion, legal-hold scenarios | Phase 0, 4 |
| NFR-PER-001 | Performance budgets | Critical endpoint/page measurements | Abuse limits remain enabled during measurement | 1,000-request p95 and Lighthouse mobile p75 | Phase 4 |
| NFR-REL-001 | Transaction/idempotency keys (planned) | Onboard/sign/finalize/pay/send | Replay-safe mutations | Concurrent and duplicate request suites | Phase 0–3 |
| NFR-ACC-001 | UI conformance | Five named core flows | Accessible auth/errors | Automated scan plus keyboard/manual audit | Phase 1–4 |
| NFR-OBS-001 | Logs, metrics, audit (planned) | Health and critical operations | Sensitive-data redaction | Correlation and redaction tests | Phase 0–4 |
| NFR-OPS-001 | Runbooks and drills (planned) | Deploy/migrate/restore/rollback | Least-privilege operations | Recorded staging drills | Phase 0, 4–5 |
| NFR-CQ-001 | Strict compiler/lint/file-size policy | Semua modul aplikasi dan test | No unsafe boundary bypass | Negative fixture `any` + file >500 lines | Phase 0–5 |

## 12. Glossary

| Istilah | Definisi |
|---|---|
| Akun bisnis | Wadah produk untuk profil dan seluruh data operasional satu bisnis fotografi. |
| Pemilik | Satu-satunya pengguna dashboard pada MVP dan pihak yang mengendalikan akun bisnis. |
| Klien | Penerima layanan yang mengakses resource terbatas melalui portal. |
| Workspace | Istilah implementasi untuk batas tenant akun bisnis; tidak digunakan sebagai pilihan atau persona produk. |
| Membership | Hubungan teknis antara identitas auth pemilik dan workspace. |
| Lead | Calon pekerjaan atau calon klien sebelum menjadi order. |
| Order | Konteks pekerjaan yang menghubungkan klien, kontrak, invoice, dan album. |
| Portal | Antarmuka klien berbasis opaque token dengan scope terbatas. |
| Snapshot | Salinan final data/konten saat dokumen diterbitkan agar perubahan sumber tidak mengubah histori. |
| Opaque token | Nilai acak yang maknanya tidak dapat ditebak klien dan hanya disimpan server sebagai hash. |
| Selection | Pilihan/favorit foto milik principal klien pada album tertentu. |
| Ledger pembayaran | Catatan append-oriented untuk setiap pembayaran yang menentukan total dibayar dan sisa invoice. |

## 13. Change Control

- Perubahan persona, cakupan MVP, atau acceptance criteria harus memperbarui dokumen ini terlebih dahulu.
- Perubahan kemudian diturunkan ke roadmap, data, API, security, testing, dan deployment melalui traceability matrix.
- Fitur Post-MVP tidak boleh masuk kontrak wajib MVP tanpa keputusan baru di `.junie/memory/DECISIONS.md`.