# Spesifikasi API — KlikFrame

## 1. Boundary dan Konvensi

- **Base URL:** `http://localhost:3000/api/v1` (development), `https://app.klikframe.id/api/v1` (production).
- **Format:** JSON UTF-8; upload file langsung ke S3, bukan multipart ke API.
- **Contract owner:** Hono `/api/v1`. Server Actions hanya adapter UI ke service/use-case yang sama.
- **Auth provider routes:** `/api/auth/*` diproxy langsung ke Managed Better Auth dan berada di luar `/api/v1`.
- **Versioning:** perubahan breaking membuat `/api/v2`; penambahan field bersifat backward-compatible.

Setiap response membawa `X-Request-Id`. Rate-limited response membawa `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, dan `Retry-After` pada `429`.

### 1.1 Boundary Akses

| Boundary | Credential | Middleware wajib |
|---|---|---|
| Owner | Neon Auth secure session cookie | session → active `owner` membership → allowed workspace state → server-resolved `workspace_id` → resource scope → Zod validation |
| Portal | Portal cookie hasil token exchange | token hash → expiry/revocation → typed resource + client subject + action scope → rate limit → validation |
| Realtime auth | Owner session atau portal cookie | principal resolution → allowed workspace/resource channel → least-privilege Ably capability → short expiry |
| Cron | `Authorization: Bearer <CRON_SECRET>` | constant-time secret check → schedule/dedupe guard |
| Public | Tidak ada | Hanya health response tersanitasi dan token exchange yang di-rate-limit |

`workspace_id`, role, client subject, dan resource scope tidak pernah dipercaya dari request client. Mutasi cookie-based memverifikasi `Origin`/`Host`; CSRF token diwajibkan ketika perlindungan SameSite tidak cukup. Portal response memakai `Cache-Control: private, no-store` dan `Referrer-Policy: no-referrer`.

Route bisnis/dashboard hanya menerima workspace `active`. `POST /data-export` dan `POST /account-deletion-requests` adalah pengecualian sempit untuk workspace `active` atau `suspended` setelah reauthentication; workspace `deletion_pending`/`deleted` selalu ditolak. Onboarding adalah boundary pre-workspace tersendiri.

### 1.2 Error Envelope

```json
{
  "error": {
    "code": "INVALID_STATE_TRANSITION",
    "message": "Order tidak dapat berpindah dari completed ke draft",
    "details": { "from": "completed", "to": "draft" },
    "request_id": "req_01..."
  }
}
```

| HTTP | Code utama | Makna |
|---|---|---|
| 400 | `INVALID_INPUT`, `INVALID_CURSOR` | Payload/query tidak valid |
| 401 | `AUTH_REQUIRED`, `PORTAL_TOKEN_INVALID`, `PORTAL_TOKEN_EXPIRED` | Credential tidak ada/tidak valid |
| 403 | `MEMBERSHIP_INACTIVE`, `PORTAL_SCOPE_DENIED`, `ORIGIN_DENIED`, `CSRF_INVALID`, `UPLOAD_CAPABILITY_INVALID` | Principal valid tetapi aksi ditolak |
| 404 | `RESOURCE_NOT_FOUND` | Tidak ditemukan atau disembunyikan karena cross-workspace |
| 409 | `ALREADY_ONBOARDED`, `DUPLICATE_CONTACT`, `INVALID_STATE_TRANSITION`, `IDEMPOTENCY_CONFLICT` | Konflik state/identity |
| 410 | `UPLOAD_EXPIRED` | Pending upload melewati expiry |
| 413 | `UPLOAD_TOO_LARGE` | Ukuran melebihi policy purpose |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | MIME/magic bytes ditolak |
| 422 | `CHECKSUM_MISMATCH`, `UPLOAD_NOT_FOUND` | Finalize tidak dapat menerima object |
| 429 | `RATE_LIMITED` | Batas request terlampaui |
| 503 | `DEPENDENCY_UNAVAILABLE` | Provider sementara gagal; retry policy berlaku |
| 412 | `PRECONDITION_FAILED` | ETag stale |
| 428 | `PRECONDITION_REQUIRED` | `If-Match` wajib tetapi tidak ada |

Tidak ada error yang membocorkan keberadaan resource workspace lain, token mentah, signed URL, atau detail provider credential.

### 1.3 Pagination dan Filter

Endpoint list memakai cursor opaque dengan urutan stabil `created_at DESC, id DESC`. Query umum: `limit` default 20, maksimum 100, `cursor`, `search`, dan filter endpoint-specific.

```json
{
  "data": [],
  "page": { "next_cursor": "opaque-or-null", "has_more": false }
}
```

Cursor terikat pada filter/sort saat dibuat; cursor yang diubah atau dipakai dengan filter berbeda menghasilkan `INVALID_CURSOR`. Offset/page tidak menjadi contract MVP.

### 1.4 Idempotency

Header `Idempotency-Key` wajib pada onboarding, publish/send/sign, issue invoice, payment/reversal, presign/finalize, portal token issue/exchange, export, dan deletion request. Key di-scope oleh principal + route + resource selama minimal 24 jam; request body hash yang berbeda dengan key sama menghasilkan `409 IDEMPOTENCY_CONFLICT`. Replay valid mengembalikan status/body awal dan header `Idempotency-Replayed: true`. Cron tidak mengirim header ini dan memakai dedupe key persisten resource+recipient+tanggal UTC.

### 1.5 Rate Limit

| Boundary/route | Key | Limit/window | Urutan |
|---|---|---|---|
| Managed auth | IP + provider controls | 5/menit/IP | Sebelum credential work |
| Owner API umum | auth user ID | 100/menit | Setelah session, sebelum use case |
| Owner presign/finalize | auth user ID + workspace | 20/menit | Sebelum S3 operation |
| Portal exchange | IP + token fingerprint | 10/menit | Sebelum database token lookup mahal |
| Portal sign/proof | portal token ID + IP | 5/menit | Sebelum storage/signature transaction |

Semua node memakai Upstash-backed shared limiter. `429` selalu menggunakan error envelope dan rate headers; limiter gagal mengikuti fail-closed untuk exchange/sign/proof dan policy operasional terdokumentasi untuk owner reads.

### 1.6 Origin, CSRF, dan ETag

- Trusted origin production hanya `https://app.klikframe.id`; development memakai allowlist konfigurasi eksplisit. Mutasi dengan foreign, absent, atau `null` Origin ditolak `403 ORIGIN_DENIED`, kecuali cron yang memakai secret dan bukan cookie.
- Token exchange juga mewajibkan exact Origin/Host dan `Sec-Fetch-Site: same-origin`; ini mencegah foreign site membuat portal cookie.
- Browser memperoleh random CSRF value melalui cookie `__Host-kf_csrf` (`Secure`, `SameSite=Lax`, `Path=/`, tidak `HttpOnly`) dan mengirim nilai sama pada `X-CSRF-Token`. Missing/mismatch menghasilkan `403 CSRF_INVALID`. Token login/provider tetap mengikuti proteksi Managed Better Auth.
- Resource mutable mengembalikan strong ETag dari canonical `updated_at` + ID. `If-Match` wajib pada PATCH owner: missing `428`, stale `412`; weak ETag ditolak. Response sukses mengembalikan ETag baru.

## 2. Managed Auth dan Onboarding

Managed Better Auth menangani `/api/auth/sign-up/email`, `/sign-in/email`, `/sign-out`, `/get-session`, dan recovery yang diaktifkan Neon Console. KlikFrame tidak membuat endpoint password/session sendiri.

### `POST /onboarding`

**Access:** owner session tanpa workspace. **Idempotency:** wajib.

```json
{
  "business_name": "Klik Studio",
  "slug": "klik-studio",
  "owner_display_name": "Ayu",
  "phone_e164": "+628123456789"
}
```

`201` membuat profile, satu workspace, dan satu active owner membership dalam transaksi. Replay mengembalikan `201` dan body yang sama; slug milik pihak lain menghasilkan `409`. Kegagalan tidak boleh meninggalkan workspace tanpa owner.

### Owner Identity dan Lifecycle

| Method/path | Fungsi | Success |
|---|---|---|
| `GET /me` | Session, profile, business account summary | `200` |
| `PATCH /me/profile` | Ubah display name/phone | `200` |
| `PATCH /business` | Ubah nama, slug, rekening sumber | `200` |
| `POST /data-export` | Reauthentication lalu response JSON attachment ter-scope; media direpresentasikan sebagai manifest | `200`; idempotent |
| `POST /account-deletion-requests` | Reauthentication + konfirmasi; response memuat retention exceptions lalu session/token dicabut | `202`; idempotent |
| `POST /realtime/token` | Buat Ably token request dengan subscribe-only capability berdasarkan principal aktif | `200`; tidak di-cache |

Tidak ada endpoint invitation/member/role pada MVP.

## 3. Owner API — CRM dan Order

Semua route pada bagian ini memakai owner boundary dan workspace hasil middleware.

### Clients

| Method/path | Fungsi | Success |
|---|---|---|
| `GET /clients` | List/search active atau archived clients | `200` cursor page |
| `POST /clients` | Buat client dengan normalized email/phone dedupe | `201` |
| `GET /clients/:id` | Detail client | `200` |
| `PATCH /clients/:id` | Ubah contact/notes dengan `If-Match` ETag dari `updated_at` | `200` |
| `DELETE /clients/:id` | Archive client; tidak menghapus evidence | `204` |

Duplicate normalized email/phone pada workspace yang sama menghasilkan `409 DUPLICATE_CONTACT` dengan ID client existing yang hanya diberikan bila owner berhak.

### Leads

| Method/path | Fungsi | Success |
|---|---|---|
| `GET /leads` | Filter `status`, `search`; cursor page | `200` |
| `POST /leads` | Buat lead status `new` | `201` |
| `GET /leads/:id` | Detail | `200` |
| `PATCH /leads/:id` | Ubah field atau transition yang diizinkan | `200` |
| `POST /leads/:id/convert` | Pilih `existing_client_id` atau payload client baru | `200`; idempotent |
| `DELETE /leads/:id` | Transition ke `archived` | `204` |

Convert mewajibkan tepat satu sumber client. Kontak normalized existing harus dipakai; retry selalu mengembalikan `client_id` yang sama.

### Orders

| Method/path | Fungsi | Success |
|---|---|---|
| `GET /orders` | Filter `status`, client, event range; cursor page | `200` |
| `POST /orders` | Buat draft dari client/optional lead | `201` |
| `GET /orders/:id` | Detail dan links contract/invoice/album | `200` |
| `PATCH /orders/:id` | Ubah field draft/nonimmutable dengan `If-Match` ETag | `200` |
| `POST /orders/:id/transitions` | Body `{ "to": "confirmed" }` | `200`; idempotent |

Allowed: `draft → confirmed|cancelled`, `confirmed → in_progress|cancelled`, `in_progress → completed|cancelled`. `completed`/`cancelled` terminal. Same-state replay tidak membuat audit event kedua.

## 4. Owner API — Contract

### Templates

| Method/path | Fungsi | Success |
|---|---|---|
| `GET /contract-templates` | List active/archived | `200` |
| `POST /contract-templates` | Buat template JSON | `201` |
| `GET /contract-templates/:id` | Detail | `200` |
| `PATCH /contract-templates/:id` | Ubah template dengan `If-Match` ETag | `200` |
| `DELETE /contract-templates/:id` | Archive; snapshot existing tetap | `204` |

### Contracts

| Method/path | Fungsi | Success |
|---|---|---|
| `GET /contracts` | Filter order/status; cursor page | `200` |
| `POST /contracts` | Buat draft dari `order_id` + `template_id` | `201` |
| `GET /contracts/:id` | Detail metadata; temporary PDF URL bila authorized | `200` |
| `POST /contracts/:id/publish` | Snapshot content, React-PDF object, hash, audit | `200`; idempotent |
| `POST /contracts/:id/send` | Rotate scoped portal token, catat delivery, lalu kirim langsung via Resend | `202`; dedupe |
| `POST /contracts/:id/void` | Void dengan alasan; evidence retained | `200` |
| `POST /portal-access/:id/revoke` | Cabut token metadata yang dimiliki workspace | `204`; idempotent |

Publish hanya `draft → published`; send memerlukan `published`; client sign terjadi hanya pada portal route. Send mencabut token aktif lama untuk typed target+scope lalu membuat token baru. Void/revoke/account deletion mencabut token sebelum commit response. Token mentah tidak pernah dikembalikan pada list/log dan hanya diberikan sekali ke delivery use case.

## 5. Owner API — Invoice dan Payment

| Method/path | Fungsi | Success |
|---|---|---|
| `GET /invoices` | Filter status/due date/order; cursor page | `200` |
| `POST /invoices` | Buat draft dengan items | `201` |
| `GET /invoices/:id` | Detail items, ledger, proof review, balance | `200` |
| `PATCH /invoices/:id` | Ubah draft items/due date | `200` |
| `POST /invoices/:id/issue` | Validate totals + snapshot bank account + `unpaid` | `200`; idempotent |
| `POST /invoices/:id/send` | Issue portal token + Resend delivery | `202`; dedupe |
| `POST /invoices/:id/payments` | Catat manual payment/recalculate invoice | `201`; idempotent |
| `POST /invoices/:id/payments/:paymentId/reverse` | Append equal reversal + recalculate | `201`; idempotent |
| `POST /invoices/:id/payment-proofs/:proofId/review` | Body `{ "status": "accepted" }` atau `{ "status": "rejected" }` | `200` |
| `POST /invoices/:id/void` | Void dengan alasan; payment harus direversal | `200` |

```json
{
  "amount": "1500000.00",
  "occurred_at": "2026-08-20T10:00:00Z",
  "payment_proof_id": "optional-accepted-proof-id"
}
```

Create/reverse payment mengunci invoice, memvalidasi proof same-invoice bila ada, append ledger/audit, menghitung balance, dan mengubah `unpaid|partial|paid` dalam satu transaksi. Overpayment ditolak `409`; concurrent request diserialisasi. Tidak ada `mark-paid` pada MVP.

## 6. Owner API — Gallery dan Storage

### Albums

| Method/path | Fungsi | Success |
|---|---|---|
| `GET /albums` | Filter order/status; cursor page | `200` |
| `POST /albums` | Buat draft album untuk order | `201` |
| `GET /albums/:id` | Detail + photo metadata | `200` |
| `PATCH /albums/:id` | Ubah title/expiry saat diizinkan | `200` |
| `POST /albums/:id/publish` | `draft → published` | `200` |
| `POST /albums/:id/send` | Issue scoped portal token, catat delivery, lalu kirim via Resend | `202`; dedupe |
| `POST /albums/:id/archive` | Transition ke terminal `archived` | `200` |
| `DELETE /photos/:id` | Soft-delete foto dan schedule object cleanup | `202` |

### Presign dan Finalize Owner

`POST /uploads/presign` hanya menerima purpose `gallery_original` dengan `album_id`, `size_bytes`, `mime_type`, dan `checksum_sha256`. Gallery menerima JPEG/PNG/WebP maksimal 20 MB. Response `201` berisi `upload_id`, method, temporary S3 URL, required headers, expiry, dan signed `finalize_token`; tidak mengembalikan permanent object URL.

`POST /uploads/:uploadId/finalize` mewajibkan `X-Upload-Capability: <finalize_token>` dan memverifikasi pending row, principal, workspace/context, S3 object, size, magic bytes, checksum, expiry, serta nonce. `200` mengembalikan object/photo metadata; retry sama mengembalikan hasil awal. Mismatch menghasilkan status quarantined/failed dan `422`. Pending expired menghasilkan `410 UPLOAD_EXPIRED`.

## 7. Portal API

Link email membawa token pada URL fragment agar tidak dikirim sebagai referrer. UI menukar token sekali:

### `POST /portal/exchange`

**Access:** public dari trusted same-origin UI, strict rate limit. **Body:** `{ "token": "raw-opaque-token" }`. **Idempotency:** wajib. Server hash/validasi token lalu mengatur cookie `__Host-kf_portal` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, tanpa `Domain`, max-age minimum antara 1 jam dan expiry token). Cookie berisi opaque portal-session ID terikat token ID/typed target; setiap request tetap mengecek expiry/revocation/scope di database. Exchange merotasi cookie portal existing. Raw token wajib direduksi dari body/log/APM. Success `204`.

### Portal Context dan Contract

| Method/path | Scope | Fungsi | Success |
|---|---|---|---|
| `GET /portal/context` | Semua token valid | Typed resource summary tanpa data internal | `200` |
| `GET /portal/contracts/:id` | `contract:read` exact target | Snapshot + temporary PDF URL | `200` |
| `POST /portal/contracts/:id/signatures/presign` | `contract:sign` exact target | Presign PNG signature dengan size/checksum policy | `201` |
| `POST /portal/contracts/:id/signatures/:uploadId/finalize` | Same target/scope | Finalize private signature object | `200`; idempotent |
| `POST /portal/contracts/:id/sign` | `contract:sign` exact target | Simpan immutable evidence | `201`; idempotent |

Contract view mengembalikan `consent_version` dan `consent_hash` dari text server. Sign body berisi `signature_upload_id`, `consent_hash`, dan `document_hash`; server mengambil text snapshot berdasarkan hash, bukan mempercayai text client. Service mengunci contract, mencocokkan hash/status, menyimpan signature evidence (token principal, consent timestamp, IP, user-agent, object), transition ke signed, dan append audit atomik. Sign kedua dengan key/body sama replay; body/hash berbeda menghasilkan `409`.

### Portal Invoice dan Proof

| Method/path | Scope | Fungsi | Success |
|---|---|---|---|
| `GET /portal/invoices/:id` | `invoice:read` exact target | Items, totals, balance, bank snapshot | `200` |
| `POST /portal/invoices/:id/payment-proofs/presign` | `invoice:proof:create` | JPEG/PNG/PDF ≤10 MB | `201` |
| `POST /portal/invoices/:id/payment-proofs/:uploadId/finalize` | Same target/scope | Create submitted proof | `201`; idempotent |

### Portal Gallery dan Selection

| Method/path | Scope | Fungsi | Success |
|---|---|---|---|
| `GET /portal/albums/:id` | `album:read` exact target | Album metadata | `200` |
| `GET /portal/albums/:id/photos` | `album:read` | Cursor `sort_order ASC,id ASC` + temporary CloudFront URLs | `200` |
| `PUT /portal/albums/:id/selections/:photoId` | `album:select`; photo in album | Create/no-op selection | `204` |
| `DELETE /portal/albums/:id/selections/:photoId` | `album:select`; photo in album | Remove/no-op selection | `204` |

Expired/revoked/wrong-target token tidak dapat memperoleh signed URL atau membedakan resource existence. Rate limit token+IP diterapkan sebelum expensive storage/signature operations.

## 8. Internal dan Public Operations

### `GET /health`

Public `200` hanya mengembalikan `{ "status": "ok", "version": "deploy-id" }`. Deep dependency checks tersedia hanya untuk protected operational tooling; response publik tidak membocorkan DSN, region, bucket, provider error, atau secret state.

### `GET /internal/cron/reminders`

Vercel Cron mengirim `Authorization: Bearer <CRON_SECRET>`. MVP hanya memilih invoice berstatus `unpaid`/`partial` pada workspace `active`, dengan `due_date` tepat 7 hari sebelum, 1 hari sebelum, hari jatuh tempo, atau 3 hari lewat jatuh tempo menurut tanggal UTC. Invoice `paid`/`void` dan workspace non-active tidak eligible. Endpoint membuat dedupe key invoice+recipient+offset+tanggal UTC lalu mencatat `notification_deliveries`. Contract reminder ditunda sampai memiliki requirement dan schedule persisten. Success `200`:

```json
{ "examined": 24, "sent": 3, "deduplicated": 21, "failed": 0 }
```

Secret salah/missing menghasilkan `401` tanpa detail. Retry pada tanggal yang sama tidak mengirim duplikat. Endpoint mencatat audit/metric dan tidak menerima workspace dari query.

## 9. Payload Normatif untuk Mutasi Berisiko Tinggi

Semua contoh success dibungkus `{ "data": ... }` kecuali response file/`204`. UUID, timestamp RFC 3339, decimal string, dan checksum SHA-256 divalidasi ketat; unknown field ditolak pada mutasi sensitif.

### 9.1 Onboarding dan Lifecycle

Response onboarding `201`:

```json
{
  "data": {
    "profile": { "id": "uuid", "display_name": "Ayu" },
    "business": { "id": "uuid", "name": "Klik Studio", "slug": "klik-studio", "status": "active" },
    "membership": { "role": "owner", "status": "active" }
  }
}
```

`POST /data-export` mewajibkan `{ "reauthentication_token": "single-use-token-max-age-5m" }`. Response `200 application/json` memakai `Content-Disposition: attachment; filename="klikframe-export-YYYY-MM-DD.json"` dan berisi `schema_version`, `generated_at`, business/profile, clients, leads, orders, contract metadata/evidence references, invoice/items/ledger, album/photo manifest, serta retention manifest. Password/session/raw token/signed URL tidak disertakan. Request dan completion diaudit.

`POST /account-deletion-requests`:

```json
{
  "reauthentication_token": "single-use-token-max-age-5m",
  "confirmation": "DELETE klik-studio",
  "reason": "optional, max 500 chars"
}
```

Response `202` memuat `status: deletion_pending`, `requested_at`, `nonretained_delete_by` (≤30 hari), serta array kategori retained berisi `category`, `retain_until`, `legal_basis`, dan `legal_hold`. Dalam transaction boundary, workspace menjadi `deletion_pending`, audit dibuat, seluruh portal token dicabut; setelah response dibuat, seluruh session owner direvoke. Request ulang mereplay receipt yang sama. Cleanup mengikuti `SECURITY.md` dan tidak dapat membatalkan legal hold tanpa audited legal action.

### 9.2 Contract Publish, Delivery, dan Sign

Publish body `{ "expected_status": "draft" }`. Server merender/upload PDF ke temporary key, memverifikasi checksum, lalu transaction menyimpan snapshot/hash/object metadata/status/audit. Gagal sebelum commit membersihkan temporary object dan contract tetap draft; gagal finalize setelah commit ditandai failed melalui compensating transaction dan tidak mengirim portal token. Response `200` memuat contract ID, `status: published`, `document_hash`, `published_at`, dan temporary PDF access descriptor.

Semua endpoint `send` menerima `{ "recipient_email": "client@example.com" }`. Transaction merotasi token lama dan membuat `notification_deliveries: pending`, lalu raw link hanya dirakit di memory untuk provider call setelah commit. `202` memuat `delivery_id`, status `sent|failed`, dan `deduplicated`; token tidak ada di response atau storage recoverable. Key baru pada delivery failed atomik mencabut token undelivered, membuat token/hash baru, mengubah row delivery yang sama ke pending, dan menaikkan attempt sebelum mengirim fresh link; delivery sent dideduplikasi. Provider failure tidak membatalkan resource dan dicatat tanpa token.

Portal signature presign menerima `{ "size_bytes": 12345, "mime_type": "image/png", "checksum_sha256": "64hex" }`, maksimal 1 MB. Finalize memakai capability sebagaimana §9.4. Sign request:

```json
{
  "signature_upload_id": "uuid",
  "consent_hash": "64hex",
  "document_hash": "64hex"
}
```

Response `201` memuat signature ID, contract ID, `status: signed`, server `consented_at`, signer role, dan document hash; IP/user-agent tidak dikembalikan. Endpoint-specific conflicts: `CONTRACT_NOT_PUBLISHED`, `DOCUMENT_HASH_MISMATCH`, `CONSENT_MISMATCH`, `ALREADY_SIGNED` (`409`).

### 9.3 Invoice, Proof, Payment, dan Reversal

Create invoice body memuat `order_id`, `due_date`, dan 1–100 items `{description 1..500, quantity >0, unit_price >=0}`; server menghitung line/subtotal/total. Issue body `{ "expected_status": "draft" }`; response `200` memuat item snapshot, bank snapshot, total, balance, `status: unpaid`, dan `issued_at`.

Proof review body wajib `{ "status": "accepted" }` atau `{ "status": "rejected" }`; accepted membutuhkan object available dengan purpose payment proof pada invoice/client subject yang sama. Response memuat proof ID/status/reviewed_at tanpa signed object URL.

Payment body mengikuti contoh §5 dengan amount positif, RFC 3339 `occurred_at`, dan optional accepted `payment_proof_id`. Response `201` memuat payment entry, paid total, balance, dan invoice status. Reversal body `{ "reason": "1..500 chars" }`; response `201` memuat reversal entry dan invoice totals/state. Conflict mencakup `OVERPAYMENT`, `PROOF_NOT_ACCEPTED`, `PROOF_INVOICE_MISMATCH`, `PAYMENT_ALREADY_REVERSED`, dan `INVOICE_VOID`.

Invoice void body `{ "reason": "1..500 chars" }`; semua payment harus sudah memiliki reversal. Response memuat `status: void`, `voided_at`, dan audit request ID.

### 9.4 Upload Capability dan Purpose Matrix

| Caller | Purpose | Required target | Policy |
|---|---|---|---|
| Owner browser | `gallery_original` | Exact draft/published album in workspace | JPEG/PNG/WebP ≤20 MB |
| Internal publish service | `contract_pdf` | Exact contract | PDF generated server-side; no browser presign |
| Portal contract | `signature` | Exact contract/token/client subject | PNG ≤1 MB |
| Portal invoice | `payment_proof` | Exact invoice/token/client subject | JPEG/PNG/PDF ≤10 MB |
| Internal media service | `gallery_thumbnail` | Exact photo | Server-generated only |

Presign request fields: target ID, purpose, size, MIME, checksum; filename is informational and never part of object key. Response:

```json
{
  "data": {
    "upload_id": "uuid",
    "method": "PUT",
    "upload_url": "temporary-s3-url",
    "required_headers": { "content-type": "image/png", "x-amz-checksum-sha256": "..." },
    "expires_at": "2026-08-20T10:10:00Z",
    "finalize_token": "signed-short-lived-capability"
  }
}
```

Capability ditandatangani server dan memuat upload ID, workspace, initiator type/ID (owner auth user atau portal token ID), client subject bila portal, exact target type/ID, purpose, size, MIME, checksum, expiry, dan nonce. Finalize membutuhkan principal/cookie yang sama serta `X-Upload-Capability`; claim/body/path/object harus sama. Pending→available hanya sekali; replay principal/request sama mengembalikan response awal, sedangkan substitution, altered claim, wrong principal/target, atau used nonce berbeda menghasilkan `403 UPLOAD_CAPABILITY_INVALID` tanpa mengaktifkan object.

### 9.5 State Transition Contract

Same-state request dengan idempotency replay adalah no-op dan tidak menambah audit. Semua transisi lain mengikuti tabel ini:

| Resource/action | Precondition → result | Actor/side effect |
|---|---|---|
| workspace deletion | `active/suspended → deletion_pending → deleted` | Owner+reauth/system cleanup; revoke+audit |
| lead update/convert/archive | `new→follow_up/converted/lost/archived`; `follow_up→converted/lost/archived`; `lost→follow_up/archived` | Owner; converted membutuhkan client immutable + audit |
| order transition | Matrix lengkap pada §3 | Owner; audit once |
| contract publish/sign/void | `draft→published`, `published→signed`, `draft/published/signed→void` | Owner/client; revoke token on void, retain evidence |
| invoice issue/payment/reversal/void | `draft→unpaid/void`; `unpaid→partial/paid/void`; `partial→paid/unpaid`; `paid→partial/unpaid`; void hanya saat draft atau net paid = 0 | Owner; transaction+audit; same totals no-op |
| proof review/lifecycle | `submitted→accepted/rejected/deleted`; `accepted→deleted`; `rejected→deleted` | Owner review/system expiry; delete audit |
| album publish/archive | `draft→published/archived`; `published→archived` | Owner; revoke token on archive |
| storage finalize/cleanup | `pending→available/quarantined/failed/deleted`; `quarantined→available/deleted`; `available→deleted`; `failed→deleted` | Bound principal finalizer/system cleanup; audit once |
| notification delivery/retry | `pending→sent/failed`; `failed→pending` | System; increment attempt/dedupe |

### 9.6 Realtime Token dan Event Contract

`POST /realtime/token` menerima body opsional `{ "resource_type": "contract|invoice|album", "resource_id": "uuid" }`. Owner session aktif menerima subscribe-only capability untuk `workspace:<workspace_id>`. Portal cookie aktif wajib mengirim exact typed target dalam token scope dan memiliki action scope `contract:read`, `invoice:read`, atau `album:read` yang cocok; portal hanya menerima `portal:<portal_token_id>:<resource_type>:<resource_id>`. Client tidak boleh mengirim nama channel atau `workspace_id`. Response `200` adalah Ably token request berdurasi maksimal 15 menit dengan `Cache-Control: private, no-store`; raw `ABLY_API_KEY` tidak pernah dikirim ke browser.

Event diterbitkan hanya setelah transaksi database commit. Nama event MVP: `contract.signed`, `invoice.updated`, `payment.recorded`, `gallery.published`, dan `selection.updated`. `payment.recorded` memakai resource invoice karena state yang di-refetch adalah invoice; `selection.updated` memakai resource album karena selection adalah state turunan album dan portal principal tidak memiliki target selection terpisah. Envelope yang kompatibel mundur:

```json
{
  "event_id": "evt_01...",
  "schema_version": 1,
  "event_type": "invoice.updated",
  "resource": { "type": "invoice", "id": "uuid" },
  "occurred_at": "2026-08-20T10:00:00Z"
}
```

Envelope tidak memuat PII, nominal, raw token, signed URL, isi kontrak, signature, bukti pembayaran, atau state snapshot. Subscriber melakukan deduplikasi `event_id`, tidak menerapkan event sebagai state, dan selalu refetch resource melalui endpoint API yang sudah diotorisasi. Event duplicate/out-of-order aman; reconnect, resume failure, gap, atau provider outage memicu refetch penuh untuk scope tampilan. Publish failure tidak mengubah response mutasi yang sudah commit, tetapi menghasilkan metric/error teredaksi dan UI tetap memiliki bounded polling/manual refresh fallback.

## 10. Contract dan Integration Scenarios

| Area | Skenario wajib |
|---|---|
| Onboarding | first create, exact retry, changed-body same key, concurrent requests, partial failure rollback |
| Tenant isolation | list/detail/search/mutation/export dengan valid ID workspace lain; cross-tenant nested IDs/FK |
| Owner/workspace | active membership+workspace; missing/suspended/revoked membership; suspended/deletion-pending/deleted workspace; narrow lifecycle exception; forged workspace input |
| Portal token | valid, malformed, expired, revoked, wrong typed target, wrong scope/client subject, brute force/rate limit |
| Contract | publish retry, template changed after snapshot, wrong hash, concurrent sign, already signed, void evidence retained |
| Invoice/payment | invalid totals, issue retry, partial/full, concurrent payment, duplicate key, overpay, same-invoice accepted proof, reversal once |
| Upload | presign policy, expired/incomplete, wrong key/workspace, MIME spoof, oversize, checksum mismatch, finalize retry, orphan cleanup |
| Gallery | wrong-album photo, selection idempotency, revoked-token URL denial, photo soft delete/object retention |
| Notification/cron | missing secret, boundary dates -7/-1/0/+3 UTC, ineligible status/workspace, same-day retry, provider failure, dedupe, token redaction |
| Realtime | owner/portal capability benar, foreign workspace/resource ditolak, token expiry, no publish capability, sensitive-payload scan, post-commit only, duplicate/out-of-order/gap, provider failure + refetch fallback |
| Lifecycle | cross-workspace export, reauthentication, token/session revocation, 30-day cleanup, legal hold, retained snapshot, expiry deletion |

Tambahan wajib: missing/stale `If-Match` (`428`/`412`), foreign/absent/`null` Origin, missing/mismatch CSRF, portal-cookie fixation/rotation/revocation, upload-ID/capability substitution, wrong finalize principal/target/nonce, repeated deletion receipt, send provider failure setelah token issuance, fresh-token regeneration pada retry, old-token revocation, serta deduped sent delivery. Setiap assertion memeriksa HTTP/error code, persisted state, audit count, redaction, dan replay response.

## 11. Post-MVP Boundary

Invitation/member/role endpoints, Midtrans webhooks, WhatsApp webhooks, realtime presence/typing/payload snapshot, worker administration, AI, dan vector search tidak menjadi bagian `/api/v1` MVP. Penambahan fitur tersebut membutuhkan requirement, schema, permission, threat model, dan contract test baru.
