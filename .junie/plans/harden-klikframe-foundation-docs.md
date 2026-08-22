---
sessionId: session-260820-170503-1cyg
---

# Requirements

### Tujuan
Merapikan dokumen KlikFrame menjadi spesifikasi MVP yang konsisten dan siap diimplementasikan. MVP hanya mengenal dua peran produk: **pemilik akun bisnis fotografi** dan **klien**. Istilah fotografer solo, owner studio, serta workspace tidak ditampilkan sebagai pilihan tipe akun; setiap pendaftar otomatis memiliki satu akun bisnis.

### Ruang Lingkup
- Tambahkan root `AGENTS.md` sebagai guideline ringkas yang otomatis dimuat Junie pada setiap task, tanpa membuat duplikat `.junie/AGENTS.md` yang dapat menyimpang.
- Tambahkan memory repository terpisah untuk snapshot proyek, decision log, dan handoff aktif; semuanya menjadi indeks ke dokumen kanonis, bukan salinan seluruh isi dokumen atau transcript sesi.
- Definisikan boot/close protocol lintas sesi dan kebijakan progressive disclosure untuk skill di `.junie/skills/`.
- Tambahkan `PRODUCT_REQUIREMENTS.md` sebagai sumber utama untuk persona pemilik akun bisnis dan klien, alur inti, definisi MVP, acceptance criteria, glossary, dan batas Post-MVP.
- Selaraskan `ARCHITECTURE.md`, `DATABASE_SCHEMA.md`, `API_SPEC.md`, `SECURITY.md`, `TESTING.md`, `DEPLOYMENT.md`, dan `ROADMAP.md` dengan keputusan produk tersebut.
- Pertahankan stack serverless yang sudah dipilih: Next.js/Hono di Vercel, Neon PostgreSQL + Managed Better Auth, Upstash, AWS S3/CloudFront, Resend, dan Ably untuk realtime event bisnis.
- Tegaskan satu pilihan untuk bagian yang kini masih ambigu: TypeScript konservatif, upload presigned S3, generator PDF, kontrak akses publik, dan strategi tenant.
- Pindahkan UI/API undangan, pengelolaan anggota, serta role `admin`/`assistant` ke Post-MVP.
- Tetapkan quality gate implementasi: TypeScript `strict`, larangan explicit/implicit `any`, validasi `unknown` pada boundary, target review 400 baris, dan batas keras 500 baris per file source/test.

### Di Luar Lingkup
- Menjanjikan pemulihan transcript atau hidden reasoning sesi lama; Junie hanya menjamin guideline terpilih dimasukkan ke setiap task.
- Menjadikan MCP `memory` pada `opencode.json` sebagai sumber kebenaran; layanan tersebut boleh menjadi cache tambahan, tetapi state wajib tetap versioned di repository.
- Memuat seluruh skill atau seluruh dokumen pada setiap task; hanya metadata skill dan dokumen yang relevan yang dibaca.
- Scaffold atau implementasi aplikasi.
- Midtrans, WhatsApp API, worker terpisah, AI, pgvector, dan manajemen tim sebelum MVP tervalidasi.
- Desain visual rinci; dokumen hanya menetapkan kebutuhan UX dan accessibility minimum.

### Hasil yang Diharapkan
- Sesi baru dapat memulihkan tujuan, keputusan, posisi pekerjaan terakhir, dan langkah berikutnya dengan membaca `AGENTS.md` lalu memory repository yang dirujuknya.
- Context tetap kecil karena fakta detail tinggal di dokumen kanonis dan arsip lama tidak dimuat secara default.
- Skill yang tersedia dipakai otomatis ketika relevan; pola berulang dapat dipromosikan menjadi skill proyek yang fokus, bukan guideline global yang membengkak.
- Setiap fitur MVP memiliki user story, kontrak data/API, aturan akses, dan skenario uji.
- Tidak ada janji roadmap yang kehilangan dukungan API atau data model.
- Keputusan implementasi tidak lagi bergantung pada alternatif yang belum dipilih.
- Realtime tidak menjadi sumber kebenaran: event Ably hanya memicu invalidation/refetch ke API setelah transaksi database commit.
- CI menolak penggunaan `any` dan file source/test di atas 500 baris, dengan pengecualian artefak generated, migration, lockfile, dan fixture data yang terdokumentasi.

# Technical Design

### Temuan Utama
- Repositori belum memiliki `AGENTS.md`, `.junie/AGENTS.md`, atau project skill di `.junie/skills/`; context saat ini hanya tersebar di dokumen root dan plan aktif.
- `opencode.json` mengaktifkan MCP `memory`, tetapi konfigurasi itu bukan mekanisme auto-load guideline resmi Junie dan tidak membuktikan durabilitas lintas alat/sesi.
- `DATABASE_SCHEMA.md` menaruh tenant pada `user_id`; ini tidak kompatibel dengan `team_members` dan RBAC multianggota.
- Tabel Managed Better Auth seharusnya dirujuk di schema `neon_auth`; jangan menduplikasi password/email pada tabel aplikasi.
- Portal klien, tanda tangan kontrak, album, dan favorit memerlukan principal/token publik, tetapi `API_SPEC.md` menyatakan hampir semua endpoint wajib session fotografer.
- `DELETE /leads/:id` menjanjikan soft delete tanpa `deleted_at`; invoice partial-payment tidak memiliki item/snapshot yang memadai; signature hanya memiliki timestamp tanpa bukti/audit.
- Upload multipart dan presigned URL, REST dan Server Actions, serta beberapa pilihan tool masih ditulis sebagai alternatif bersamaan.

### Model Akun yang Dipilih
- Pada bahasa produk gunakan istilah **akun bisnis**, bukan workspace, tenant, fotografer solo, atau owner studio.
- Neon Auth hanya mengelola identitas dan session.
- Saat registrasi/onboarding, aplikasi otomatis membuat satu `workspaces` dan satu `workspace_members` berstatus aktif untuk pemilik; detail ini tidak memerlukan pilihan dari pengguna.
- Data bisnis memakai `workspace_id`, sehingga dukungan tim kelak tidak memerlukan migrasi ownership.
- Pada MVP hanya pemilik yang dapat masuk ke dashboard; undangan anggota serta role `admin`/`assistant` didokumentasikan sebagai ekstensi Post-MVP.
- Pisahkan profil aplikasi dari tabel `neon_auth.user` dan hilangkan `password_hash` aplikasi.

### Context dan Memory Lintas Sesi
- Gunakan root `AGENTS.md`, karena format ini portabel dan tetap ditemukan Junie setelah `.junie/AGENTS.md`; jangan buat keduanya agar tidak ada dua guideline dengan prioritas berbeda.
- `AGENTS.md` hanya memuat identitas proyek, aturan kritis, urutan baca awal, peta source of truth, workflow kerja, quality gates, aturan keamanan, dan protocol pembaruan memory.
- Tambahkan `.junie/memory/PROJECT_CONTEXT.md` untuk snapshot stabil dan indeks domain, `.junie/memory/DECISIONS.md` untuk keputusan bernomor dengan status serta tautan sumber, dan `.junie/memory/HANDOFF.md` untuk task aktif, progres tervalidasi, blocker, serta next actions.
- Boot protocol membaca `PROJECT_CONTEXT.md` dan `HANDOFF.md` pada awal task, kemudian hanya dokumen domain yang relevan; `DECISIONS.md` dicari berdasarkan topik/ID dan tidak wajib dibaca penuh.
- Close protocol memperbarui handoff setelah milestone bermakna, mempromosikan keputusan yang sudah disetujui ke decision log, dan memperbarui snapshot hanya jika baseline proyek berubah.
- Setiap memory file memiliki `Last updated`, status, tautan sumber, batas ukuran, dan aturan archive/compaction; fakta tidak boleh diduplikasi tanpa penunjuk dokumen kanonis.
- `.junie/skills/` mengikuti format resmi `SKILL.md`. Saat ini belum ada project skill, sehingga tidak dibuat atau dipanggil secara fiktif; `AGENTS.md` mewajibkan pemeriksaan skill yang tersedia dan penggunaan skill relevan, tetapi melarang pemuatan paksa semua skill. Skill proyek baru dibuat hanya untuk workflow berulang yang sudah stabil.
- Konfigurasi MCP `memory` di `opencode.json` diperlakukan sebagai convenience non-kanonis karena persistensi dan auto-load-nya tidak dijamin oleh mekanisme guideline Junie.

### Kontrak Data yang Perlu Diperjelas
- Akses klien: token acak yang hanya disimpan sebagai hash, memiliki scope resource, expiry, revocation, dan rate limit.
- Kontrak: snapshot konten final, signature object, signer role, consent timestamp, IP/user-agent, document hash, dan audit event append-only.
- Storage: simpan S3 object key, ukuran, MIME, checksum, dan status upload; signed URL dibuat saat dibutuhkan dan tidak disimpan sebagai URL permanen.
- Galeri: pindahkan pilihan/favorit ke entitas selection yang terkait principal klien, bukan boolean global pada foto.
- Invoice: item, subtotal/total, rekening tujuan snapshot, proof object key, payment ledger, serta transisi status transaksional dan idempotent.
- Tambahkan `deleted_at` hanya pada resource yang benar-benar mendukung soft delete serta audit log untuk tindakan sensitif.

### API dan Boundary
- Dokumentasikan middleware berurutan: session/token resolution → workspace membership → permission → resource scope → validation.
- Pisahkan endpoint authenticated workspace dari endpoint portal berbasis opaque token.
- Tambahkan kontrak yang hilang untuk clients, templates, portal, presigned upload/finalize, cron reminders, health, onboarding akun bisnis, dan account/data lifecycle; endpoint team invitation ditunda ke Post-MVP.
- Pilih Hono `/api/v1` sebagai kontrak eksternal; Server Actions hanya adapter UI yang memanggil service/use-case yang sama agar business rule tidak ganda.
- Tetapkan error codes, cursor/page policy, idempotency, state transitions, dan status HTTP per endpoint penting.

### Keamanan dan Operasional
- Dokumentasikan status Beta Managed Better Auth dan boundary migrasinya.
- Tambahkan proteksi `CRON_SECRET`, CSRF/origin checks, token hashing, tenant isolation, auditability, upload quarantine/finalization, dan retention/deletion policy sesuai UU PDP.
- Ganti klaim retensi/backup platform yang tidak dijamin plan dengan target serta prosedur yang dapat diverifikasi.
- Pusatkan matriks versi pada satu bagian yang mengacu sumber resmi; pilih satu baseline awal dan gunakan lockfile, bukan menyalin alternatif ke semua dokumen.
- Tinjau `opencode.json` sebagai konfigurasi tooling terpisah; pastikan endpoint privat dan token tidak menjadi bagian spesifikasi produk atau secret repository.
- Gunakan Ably token authentication dengan capability minimum per akun bisnis atau portal principal; `ABLY_API_KEY` hanya tersedia server-side dan payload event tidak memuat PII, token, atau signed URL.
- Event realtime memiliki `event_id`, versi schema, jenis resource, dan resource ID; publish dilakukan setelah commit, sedangkan reconnect/gap dipulihkan dengan refetch API.

### Code Quality
- TypeScript memakai mode `strict`; explicit `any`, implicit `any`, unsafe assignment/member access/return, dan assertion untuk melewati validasi boundary dilarang.
- Data eksternal masuk sebagai `unknown` lalu divalidasi dan di-narrow sebelum digunakan.
- File source dan test ditargetkan maksimal 400 baris dan gagal CI jika melebihi 500 baris; pemecahan wajib mengikuti tanggung jawab modul, bukan sekadar memindahkan baris.
- Generated code, migration, lockfile, dan fixture data boleh dikecualikan melalui daftar eksplisit yang ditinjau, bukan pola pengecualian umum.

# Testing

### Validasi Dokumen
- Lakukan fresh-session drill: mulai hanya dari root `AGENTS.md`, ikuti boot protocol, lalu pastikan tujuan, keputusan aktif, status terakhir, dan next action dapat direkonstruksi tanpa transcript chat.
- Validasi semua path dan tautan memory, metadata pembaruan, ID keputusan, batas ukuran, serta aturan archive/compaction.
- Pastikan instruksi skill memakai progressive disclosure: skill relevan terpilih dari nama/deskripsi, sedangkan skill yang tidak relevan tidak dimuat.
- Buat traceability matrix: requirement → tabel/kontrak → endpoint/use case → security rule → test scenario → fase roadmap.
- Periksa semua nama role, status, route, environment variable, dan layanan agar identik lintas dokumen.
- Validasi Mermaid, internal link/anchor, contoh JSON, dan snippet konfigurasi.

### Skenario Kritis yang Harus Tercakup
- Onboarding membuat tepat satu akun bisnis dan membership pemilik secara atomik serta idempotent.
- Dua akun bisnis tetap terisolasi meskipun model teknis memakai `workspace_id`; skenario multianggota ditunda ke Post-MVP.
- Token portal valid, expired, revoked, salah scope, dan brute-force/rate-limit.
- Kontrak ditandatangani dengan snapshot serta audit evidence yang tidak dapat diubah.
- Upload presigned yang tidak selesai, MIME palsu, checksum gagal, object orphan, dan penghapusan.
- Pembayaran manual parsial/penuh, request berulang, serta konsistensi status invoice dan order.
- Cron reminder terautentikasi, retry aman, dan deduplikasi email.
- Export/deletion workspace dengan pengecualian retensi legal/keuangan yang dinyatakan eksplisit.
- Ably capability lintas akun bisnis ditolak, payload tidak membawa data sensitif, duplicate/out-of-order event aman, dan reconnect memulihkan state melalui API.
- Lint/typecheck gagal untuk explicit/implicit `any`, unsafe TypeScript, serta file source/test di atas 500 baris.

# Delivery Steps

### ✓ Step 1: Bangun boot protocol dan memory repository Junie
`AGENTS.md` selalu memberi sesi baru jalur baca yang kecil dan cukup untuk melanjutkan pekerjaan tanpa bergantung pada transcript atau MCP memory.

- Buat root `AGENTS.md` berdasarkan urutan discovery resmi Junie dan format terbuka AGENTS.md; jangan membuat `.junie/AGENTS.md` kedua.
- Dokumentasikan quick-start, peta source of truth, aturan arsitektur/keamanan yang tidak boleh dilanggar, workflow perubahan, quality gates, dan boot/close protocol.
- Buat `.junie/memory/PROJECT_CONTEXT.md`, `.junie/memory/DECISIONS.md`, dan `.junie/memory/HANDOFF.md` dengan template metadata, ownership fakta, batas ukuran, serta mekanisme archive/compaction.
- Nyatakan `opencode.json` MCP memory hanya cache opsional dan semua state penting wajib berada dalam file repository yang dapat ditinjau.
- Tambahkan aturan untuk menemukan dan memakai skill relevan secara progresif dari `.junie/skills/`; jangan memaksa semua skill masuk ke context dan jangan membuat skill sebelum polanya stabil.
- Uji protocol dengan simulasi sesi baru dan perbaiki tautan atau informasi yang belum cukup untuk menentukan next action.

### ✓ Step 2: Tetapkan source of truth produk dan MVP
`PRODUCT_REQUIREMENTS.md` dan `ROADMAP.md` mendefinisikan satu MVP yang terukur sebelum keputusan teknis diturunkan.

- Susun hanya dua persona MVP: pemilik akun bisnis fotografi dan klien.
- Jelaskan bahwa fotografer solo maupun studio melewati onboarding yang sama tanpa memilih tipe akun.
- Tetapkan alur leads → order → kontrak → invoice → galeri beserta acceptance criteria.
- Nyatakan manajemen tim dan fitur lain yang belum dibutuhkan sebagai Post-MVP.
- Tambahkan glossary, asumsi, non-functional requirements, dan matriks keterlacakan awal.

### ✓ Step 3: Rancang ulang tenancy dan kontrak data inti
`DATABASE_SCHEMA.md`, `ARCHITECTURE.md`, dan `SECURITY.md` memiliki model workspace serta ownership yang konsisten.

- Ganti ownership berbasis `user_id` dengan `workspace_id`; buat satu membership pemilik otomatis saat onboarding.
- Koreksi referensi Managed Better Auth ke schema `neon_auth` dan hapus duplikasi credential aplikasi.
- Lengkapi model client access token, contract evidence, audit log, storage object, gallery selection, invoice item/payment, dan soft delete.
- Sisakan desain undangan serta role anggota sebagai catatan evolusi Post-MVP, bukan tabel/API wajib fase awal.
- Definisikan constraint, unique key per akun bisnis, index, cascade/retention, dan transisi status.
- Sertakan pengujian onboarding idempotent, isolasi akun bisnis, dan authorization pemilik sebagai acceptance criteria schema.

### ✓ Step 4: Selaraskan API dengan workflow dan keamanan
`API_SPEC.md` mencakup semua workflow MVP dengan boundary authenticated dan public yang eksplisit.

- Tambahkan endpoint clients, templates, portal, presigned upload/finalize, cron, health, onboarding akun bisnis, dan data lifecycle; jangan menambahkan endpoint invitation pada MVP.
- Definisikan middleware session → membership pemilik → resource scope serta token scope portal, CSRF/origin policy, rate limit, dan ownership checks.
- Lengkapi request/response, error, pagination, idempotency, status transition, serta transaksi invoice/order.
- Tegaskan Hono sebagai API boundary dan shared service layer untuk pemanggilan dari Server Actions.
- Turunkan contract/integration scenarios untuk setiap endpoint berisiko tinggi.

### ✓ Step 5: Sinkronkan delivery, deployment, dan quality gates
`TESTING.md`, `DEPLOYMENT.md`, `SECURITY.md`, dan seluruh referensi lintas dokumen dapat digunakan sebagai checklist implementasi tanpa kontradiksi.

- Pilih satu baseline toolchain yang diverifikasi dari sumber resmi dan pusatkan kebijakan upgrade/version pin.
- Konsistenkan presigned S3, CloudFront private access, environment variables, cron authentication, email retry/deduplication, backup, dan observability.
- Revisi strategi test agar unit/integration memakai boundary eksternal yang terkendali dan E2E tidak bergantung pada cleanup auth yang rapuh.
- Tambahkan traceability matrix serta pemeriksaan link, Mermaid, contoh payload, status, dan istilah lintas dokumen; pastikan istilah teknis `workspace` tidak membebani bahasa produk.
- Sinkronkan `PROJECT_CONTEXT.md` dan `HANDOFF.md` hanya setelah baseline dokumen final tervalidasi, lalu arsipkan state sementara agar sesi implementasi pertama dimulai dari konteks bersih.
- Tandai `opencode.json` sebagai tooling lokal dan dokumentasikan penanganan endpoint/token sebelum repository Git diinisialisasi.

### ✓ Step 6: Aktifkan realtime Ably dan quality gate kode ketat
Dokumen kanonis memasukkan Ably sebagai dependency MVP untuk event bisnis dan menetapkan aturan kualitas yang dapat dipaksakan oleh CI sebelum scaffold dimulai.

- Selaraskan `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md`, dan `ARCHITECTURE.md` dengan realtime event/invalidation setelah commit; API/database tetap sumber data kanonis.
- Dokumentasikan kontrak token/capability, channel isolation, envelope event, reconnect/refetch, duplicate/out-of-order handling, dan larangan data sensitif pada `API_SPEC.md` serta `SECURITY.md`.
- Tambahkan `ABLY_API_KEY` server-only, pemisahan environment/app, observability, failure mode, dan go-live checks pada `DEPLOYMENT.md`.
- Tambahkan quality gate TypeScript `strict` tanpa explicit/implicit `any`, boundary `unknown`, target 400 baris, batas gagal 500 baris, dan pengecualian eksplisit pada `AGENTS.md` serta `TESTING.md`.
- Perbarui traceability, decision log, project context, dan handoff; validasi tidak ada lagi pernyataan bahwa Ably berada di luar MVP.