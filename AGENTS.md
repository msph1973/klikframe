# KlikFrame — Panduan Agen

## Identitas Proyek

KlikFrame adalah SaaS pengelolaan bisnis fotografi. Bahasa produk MVP hanya mengenal dua pihak: **pemilik akun bisnis fotografi** dan **klien**. Istilah teknis `workspace` boleh dipakai di implementasi, tetapi tidak ditampilkan sebagai pilihan tipe akun.

Dokumen ini adalah satu-satunya guideline agen tingkat repository. Jangan membuat `.junie/AGENTS.md` kedua karena file tersebut dapat mengambil prioritas dan menyimpang dari aturan ini.

## Quick Start dan Boot Protocol

Pada awal setiap task:

1. Baca [snapshot proyek](.junie/memory/PROJECT_CONTEXT.md) dan [handoff aktif](.junie/memory/HANDOFF.md).
2. Tentukan domain task, lalu baca hanya dokumen kanonis yang relevan dari peta di bawah. Jangan memuat semua dokumen secara default.
3. Cari topik atau ID yang relevan di [decision log](.junie/memory/DECISIONS.md); tidak perlu membaca seluruh log.
4. Periksa nama dan deskripsi skill yang tersedia. Muat `SKILL.md` hanya untuk skill yang cocok dengan task, dan baca resource turunannya hanya saat diperlukan.
5. Periksa status working tree dan perubahan yang sudah ada sebelum mengedit. Jangan menimpa pekerjaan pengguna atau agen lain.

Jika konteks chat bertentangan dengan repository, konfirmasi intent terbaru pengguna. Transcript, hidden reasoning, dan MCP memory bukan sumber kebenaran.

## Peta Source of Truth

| Domain | Sumber kanonis |
|---|---|
| Tujuan produk, persona, cakupan, acceptance criteria | `PRODUCT_REQUIREMENTS.md` setelah tersedia; sebelum itu plan aktif di `.junie/plans/` |
| Tahapan delivery produk | `ROADMAP.md` |
| Boundary sistem dan pilihan teknologi | `ARCHITECTURE.md` |
| Entitas, constraint, ownership, dan lifecycle data | `DATABASE_SCHEMA.md` |
| Route, payload, error, dan state transition | `API_SPEC.md` |
| Auth, authorization, privacy, dan threat controls | `SECURITY.md` |
| Strategi serta skenario validasi | `TESTING.md` |
| Environment, operasi, backup, dan release | `DEPLOYMENT.md` |
| Tooling agen lokal dan MCP trust boundary | `TOOLING.md` |
| Keputusan lintas domain yang telah diterima | `.junie/memory/DECISIONS.md` sebagai indeks menuju sumber kanonis |
| Posisi pekerjaan dan langkah berikutnya | `.junie/memory/HANDOFF.md` |

Memory hanya menyimpan snapshot dan indeks. Jika detail berbeda, dokumen domain kanonis menang dan memory harus diperbarui.

## Invariant Arsitektur dan Produk

- Stack MVP: Next.js dan Hono di Vercel, Neon PostgreSQL dengan Managed Better Auth, Upstash, Civo S3 Object Storage (S3-compatible), Resend, dan Ably untuk event bisnis realtime.
- Neon Auth hanya mengelola identity dan session. Data aplikasi tidak menyimpan ulang password atau credential auth.
- Setiap pendaftar mendapat tepat satu akun bisnis secara otomatis. Implementasi membuat `workspaces` dan membership pemilik secara atomik serta idempotent.
- Semua data bisnis diisolasi dengan `workspace_id`; MVP hanya memberi akses dashboard kepada pemilik.
- Manajemen anggota serta role `admin` dan `assistant` adalah Post-MVP.
- API eksternal memakai Hono pada `/api/v1`; Server Actions hanya adapter ke service/use-case yang sama.
- Upload memakai presigned S3 dan objek tetap private; URL akses dibuat sementara, bukan disimpan sebagai URL permanen.
- Akses portal klien memakai opaque token yang di-hash, dibatasi scope, expiry, revocation, dan rate limit.
- Ably hanya kanal event/invalidation setelah commit; database dan `/api/v1` tetap sumber data kanonis, dan reconnect/gap selalu dipulihkan melalui refetch.
- Midtrans, WhatsApp API, worker terpisah, AI, dan pgvector berada di luar MVP.

## Aturan Keamanan

- Urutan authorization owner: resolve session, validasi membership pemilik aktif, validasi workspace state, cek resource scope, lalu validasi input; portal memakai typed token scope tersendiri.
- Jangan pernah menaruh secret, token mentah, endpoint privat, atau data pribadi dalam dokumen, fixture, log, maupun commit.
- Terapkan least privilege, CSRF/origin checks, rate limit, audit event untuk aksi sensitif, dan isolasi akun bisnis pada setiap query.
- Upload harus melalui tahap presign lalu finalize dengan verifikasi ukuran, MIME, checksum, dan ownership.
- Perubahan retensi, export, deletion, backup, atau bukti tanda tangan harus konsisten dengan `SECURITY.md`, `DATABASE_SCHEMA.md`, dan UU PDP.

## Workflow Perubahan

1. Tetapkan requirement dan dokumen kanonis yang terdampak sebelum mengedit.
2. Telusuri perubahan lintas produk, data, API, keamanan, test, deployment, dan roadmap; jangan memperbaiki satu dokumen sambil meninggalkan kontradiksi.
3. Gunakan istilah, role, status, route, dan environment variable yang sama di seluruh dokumen.
4. Buat perubahan minimal sesuai scope. Jangan scaffold aplikasi dalam pekerjaan dokumentasi foundation.
5. Jalankan quality gates yang relevan dan catat bukti tervalidasi di handoff.

## Quality Gates

- Requirement dapat ditelusuri ke model data/use-case, API, aturan keamanan, skenario test, dan fase roadmap.
- Internal link, anchor, Mermaid, JSON, dan snippet konfigurasi valid.
- Role, status, route, environment variable, nama layanan, dan batas MVP konsisten lintas dokumen.
- Skenario negatif mencakup isolasi akun bisnis, token portal, signature evidence, upload finalize, pembayaran idempotent, cron, serta export/deletion.
- TypeScript wajib `strict`; explicit/implicit `any` dan unsafe `any` dilarang. Boundary eksternal masuk sebagai `unknown`, lalu divalidasi dan di-narrow sebelum dipakai.
- File source dan test ditargetkan ≤400 baris dan dibatasi keras ≤500 baris. Generated code, migration, lockfile, dan fixture data hanya boleh dikecualikan melalui allowlist eksplisit; pecah modul berdasarkan tanggung jawab, bukan sekadar jumlah baris.
- Untuk perubahan code kelak: lint, typecheck, file-size check, test, dan build harus lulus sesuai `TESTING.md`; dokumentasikan kegagalan yang belum selesai tanpa menyembunyikannya.

## Progressive Disclosure untuk Skill

- Pilih skill dari nama dan deskripsinya berdasarkan kebutuhan task; jangan memuat semua skill.
- Ikuti skill yang relevan dan baca referensi tambahannya hanya saat langkah tersebut membutuhkan detail.
- Jangan mengarang atau memanggil project skill yang belum ada.
- Buat skill baru di `.junie/skills/<nama>/SKILL.md` hanya setelah workflow berulang terbukti stabil dan dapat dipisahkan dari guideline global.

## Close Protocol dan Memory

Setelah milestone bermakna atau sebelum menyerahkan pekerjaan:

1. Perbarui `.junie/memory/HANDOFF.md` dengan task aktif, progres yang benar-benar tervalidasi, blocker, dan next actions terurut.
2. Promosikan keputusan yang telah disetujui ke `.junie/memory/DECISIONS.md` dengan ID, status, tanggal, dan tautan sumber. Jangan mencatat spekulasi sebagai keputusan.
3. Perbarui `.junie/memory/PROJECT_CONTEXT.md` hanya jika baseline stabil, source map, atau fase proyek berubah.
4. Compact/archive sesuai batas tiap file; arsip tidak dibaca saat boot kecuali dirujuk oleh task.
5. Pastikan memory menunjuk ke fakta kanonis alih-alih menyalin isi lengkap atau transcript sesi.

MCP `memory` di `opencode.json` hanya cache opsional. State yang diperlukan sesi berikutnya wajib disimpan dalam file repository yang dapat ditinjau.