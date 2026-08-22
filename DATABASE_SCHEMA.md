# Skema Database — KlikFrame

Database: PostgreSQL di Neon dengan Drizzle ORM. Semua timestamp memakai `timestamptz`, nominal memakai `numeric(14,2)`, dan ID aplikasi memakai UUID. `pgvector` tidak diaktifkan pada MVP.

## 1. Prinsip Schema

- Schema `neon_auth` dimiliki Managed Better Auth. Tabel `neon_auth.user`, `neon_auth.session`, `neon_auth.account`, dan `neon_auth.verification` tidak dibuat atau diubah migration aplikasi.
- KlikFrame tidak menyimpan email login, password hash, OAuth token, atau session. `auth_user_id text` mengikuti tipe `neon_auth.user.id`; tidak ada FK fisik ke schema managed, sehingga onboarding memverifikasi identity melalui adapter dan reconciliation job mengaudit referensi yatim.
- Semua data bisnis memiliki `workspace_id`. FK antardata bisnis memakai `(workspace_id, id)` untuk mencegah relasi lintas akun.
- Default FK adalah `ON DELETE RESTRICT`. Hard cascade hanya diizinkan untuk draft/row ephemeral yang disebut eksplisit saat migration review.
- `archived_at` digunakan untuk arsip. `deleted_at` hanya ada pada workspace, storage object, dan foto; kontrak, signature, invoice, payment, serta audit di-void/retained.

## 2. Identity dan Akun Bisnis

### `profiles`

| Kolom | Tipe | Aturan |
|---|---|---|
| id | uuid PK | ID profil aplikasi |
| auth_user_id | text unique | ID identitas `neon_auth.user.id`; tanpa FK fisik ke schema managed |
| display_name | varchar(255) | Not null |
| phone_e164 | varchar(20) | Nullable |
| created_at, updated_at | timestamptz | Not null |

### `workspaces`

| Kolom | Tipe | Aturan |
|---|---|---|
| id | uuid PK | ID teknis akun bisnis |
| name | varchar(255) | Not null |
| slug | varchar(80) unique | Identifier URL internal |
| bank_account | jsonb | Sumber snapshot rekening invoice |
| status | enum | `active`, `deletion_pending`, `suspended`, `deleted` |
| deletion_requested_at, deleted_at | timestamptz nullable | Lifecycle terkontrol |
| created_at, updated_at | timestamptz | Not null |

### `workspace_members`

| Kolom | Tipe | Aturan |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK | Ke `workspaces`, restrict |
| auth_user_id | text | Referensi identitas Neon Auth |
| role | enum | MVP hanya `owner` |
| status | enum | `active`, `suspended`, `revoked` |
| joined_at, created_at, updated_at | timestamptz | Not null |

Unique `(workspace_id, auth_user_id)`. Index `UNIQUE(workspace_id) WHERE role='owner' AND status='active'` menjamin satu owner aktif per workspace; `UNIQUE(auth_user_id) WHERE role='owner' AND status='active'` menjamin satu workspace milik per identity. Invitation, multi-membership, serta role `admin`/`assistant` adalah migration Post-MVP.

## 3. Data Operasional

### `clients`

| Kolom       | Tipe         | Keterangan                       |
|-------------|--------------|----------------------------------|
| id          | uuid PK      |                                  |
| workspace_id | uuid FK     | Not null, tenant owner              |
| subject_id  | uuid         | Unique per workspace; non-PII stable subject |
| name        | varchar(255) | Nama klien                       |
| email       | varchar(255) |                                  |
| phone       | varchar(20)  |                                  |
| email_normalized | varchar(255) | Nullable, lowercase/trimmed       |
| phone_normalized | varchar(20) | Nullable, format E.164             |
| instagram   | varchar(255) |                                  |
| address     | text         |                                  |
| notes       | text         | Catatan internal                 |
| created_at  | timestamptz  |                                  |
| updated_at  | timestamptz  |                                  |
| archived_at | timestamptz  | Nullable                         |

Unique `(workspace_id, subject_id)`. Unique partial `(workspace_id, email_normalized)` dan `(workspace_id, phone_normalized)` untuk kontak aktif ketika nilainya tersedia. `subject_id` dapat dipertahankan pada snapshot historis tanpa mempertahankan row/contact client.

### `leads`

| Kolom            | Tipe         | Keterangan                                |
|------------------|--------------|-------------------------------------------|
| id               | uuid PK      |                                           |
| workspace_id     | uuid FK      | Not null                                  |
| client_id        | uuid FK      | Nullable; immutable setelah konversi      |
| name             | varchar(255) | Nama calon klien                          |
| phone            | varchar(20)  |                                           |
| email            | varchar(255) |                                           |
| source           | varchar(50)  | 'instagram','referral','WO','website', dll. |
| status           | enum         | `new`,`follow_up`,`converted`,`lost`,`archived` |
| estimated_budget | numeric(12,2)|                                           |
| wedding_date     | date         |                                           |
| notes            | text         |                                           |
| created_at       | timestamptz  |                                           |
| updated_at       | timestamptz  |                                           |
| converted_at     | timestamptz  | Nullable                                  |
| archived_at      | timestamptz  | Nullable                                  |

Konversi mengunci `client_id` dalam satu transaksi. Kontak existing pada workspace yang sama wajib dipakai; retry tidak membuat client kedua.

### `orders`

| Kolom          | Tipe         | Keterangan                                      |
|----------------|--------------|-------------------------------------------------|
| id             | uuid PK      |                                                 |
| workspace_id   | uuid FK      | Not null                                        |
| client_id      | uuid nullable FK | Composite workspace FK selama client aktif   |
| client_subject_id | uuid      | Immutable non-PII subject                       |
| client_snapshot | jsonb       | Nama/kontak yang diperlukan saat order confirmed; encrypted/access-audited |
| lead_id        | uuid FK      | Nullable; composite workspace FK                |
| service_name   | varchar(255) | Not null                                        |
| agreed_amount  | numeric(14,2)| Check >= 0                                      |
| event_at       | timestamptz  | Not null                                        |
| location       | text         | Lokasi acara                                    |
| status         | enum         | `draft`,`confirmed`,`in_progress`,`completed`,`cancelled` |
| notes          | text         |                                                 |
| created_at     | timestamptz  |                                                 |
| updated_at     | timestamptz  |                                                 |

Transisi: `draft → confirmed|cancelled`, `confirmed → in_progress|cancelled`, `in_progress → completed|cancelled`; state terminal tidak berubah. Status pembayaran tidak disimpan sebagai status order dan selalu dihitung dari invoice/payment ledger.

Unique `(workspace_id, id, client_subject_id)`. Sebelum client dihapus karena lifecycle, seluruh token dicabut dan `orders.client_id` dibuat null; `client_subject_id` serta snapshot minimum dipertahankan bersama order historis.

### `contracts`

| Kolom                  | Tipe         | Keterangan                                |
|------------------------|--------------|-------------------------------------------|
| id                     | uuid PK      |                                           |
| workspace_id, order_id | uuid FK      | Composite ke orders, ON DELETE RESTRICT   |
| client_subject_id      | uuid         | Harus sama dengan order                   |
| template_id            | uuid nullable FK | Composite workspace FK, ON DELETE SET NULL |
| content_snapshot       | jsonb        | Immutable setelah publish                 |
| document_hash          | char(64)     | SHA-256 snapshot/PDF                      |
| pdf_object_id          | uuid FK      | Ke `storage_objects`                      |
| status                 | enum         | `draft`,`published`,`signed`,`void`       |
| created_at             | timestamptz  |                                           |
| updated_at             | timestamptz  |                                           |

Setelah `published`, content/hash/PDF tidak dapat diubah. Revisi membuat contract baru; kontrak lama menjadi `void` tanpa dihapus.

### `contract_templates`

| Kolom      | Tipe         | Keterangan                 |
|------------|--------------|----------------------------|
| id         | uuid PK      |                            |
| workspace_id | uuid FK    | Not null                   |
| name       | varchar(255) |                            |
| content    | jsonb        | Template dengan placeholder `{{client_name}}`, `{{wedding_date}}` |
| created_at | timestamptz  |                            |
| updated_at | timestamptz  |                            |
| archived_at | timestamptz | Nullable                   |

> `contracts.content_snapshot` dan `contract_templates.content` sama-sama `jsonb`; snapshot tidak berubah setelah publish.

### `invoices`

| Kolom        | Tipe         | Keterangan                              |
|--------------|--------------|-----------------------------------------|
| id           | uuid PK      |                                         |
| workspace_id, order_id | uuid FK | Composite ke orders, ON DELETE RESTRICT |
| client_subject_id | uuid | Harus sama dengan order                  |
| invoice_number | varchar(50)| Unique per workspace, format INV-YYYYMM-XXXX |
| subtotal     | numeric(14,2)| Check >= 0                              |
| total        | numeric(14,2)| Check >= 0                              |
| bank_account_snapshot | jsonb | Immutable setelah issued             |
| status       | enum         | `draft`,`unpaid`,`partial`,`paid`,`void` |
| due_date     | date         |                                         |
| issued_at    | timestamptz  | Nullable                                |
| created_at   | timestamptz  |                                         |
| updated_at   | timestamptz  |                                         |

Unique `(workspace_id, invoice_number)`. Total dibayar berasal dari payment entries dikurangi reversal; `partial` bila `0 < paid < total`, `paid` bila `paid >= total`. `overdue` dihitung dari `due_date`, bukan state persisted.

### `invoice_items`

| Kolom | Tipe | Aturan |
|---|---|---|
| id | uuid PK | |
| workspace_id, invoice_id | uuid FK | Composite tenant FK |
| description | varchar(500) | Not null |
| quantity | numeric(12,2) | Check > 0 |
| unit_price, line_total | numeric(14,2) | Check >= 0 |
| sort_order | integer | Check >= 0 |

Items immutable setelah invoice issued.

### `payments`

| Kolom         | Tipe         | Keterangan                            |
|---------------|--------------|---------------------------------------|
| id            | uuid PK      |                                       |
| workspace_id, invoice_id | uuid FK | Composite tenant FK                 |
| amount        | numeric(14,2)| Check > 0                              |
| method        | enum         | MVP hanya `manual_transfer`           |
| entry_type    | enum         | `payment`,`reversal`                  |
| payment_proof_id | uuid nullable FK | Accepted proof pada invoice yang sama |
| idempotency_key | varchar(255) | Not null                            |
| recorded_by_auth_user_id | text | Owner yang memverifikasi            |
| reversal_of_payment_id | uuid nullable FK | Composite same-workspace/invoice ke payment asal |
| occurred_at, created_at | timestamptz | Not null                           |

Unique `(workspace_id, idempotency_key)` dan unique partial `(workspace_id,invoice_id,reversal_of_payment_id) WHERE entry_type='reversal'`. Checks mewajibkan `payment ⇒ reversal_of IS NULL` dan `reversal ⇒ reversal_of IS NOT NULL`. Composite FK mengikat reversal ke entry invoice/workspace yang sama; deferrable constraint trigger memastikan parent bertipe `payment`, nominal sama, dan belum pernah direversal. Row append-only; total dibayar = jumlah `payment` dikurangi `reversal`. Insert ledger dan perubahan status invoice berjalan dalam satu transaksi.

### `invoice_payment_proofs`

| Kolom | Tipe | Aturan |
|---|---|---|
| id | uuid PK | |
| workspace_id, invoice_id | uuid FK | Composite ke invoice, ON DELETE RESTRICT |
| portal_token_id | uuid FK | Token yang tepat menarget invoice |
| storage_object_id | uuid FK | Purpose `payment_proof`, status `available` |
| status | enum | `submitted`,`accepted`,`rejected`,`deleted` |
| reviewed_by_auth_user_id, reviewed_at | text, timestamptz | Nullable sampai review |
| created_at | timestamptz | Not null |

Unique `(invoice_id, storage_object_id)` dan unique `(workspace_id,invoice_id,id)`. Proof dapat diterima sebelum payment dibuat; `payments.payment_proof_id` memakai composite FK ke proof pada invoice sama dan deferrable constraint trigger hanya menerima status `accepted`.

### `gallery_albums`

| Kolom       | Tipe         | Keterangan                          |
|-------------|--------------|-------------------------------------|
| id          | uuid PK      |                                     |
| workspace_id, order_id | uuid FK | Composite ke orders, ON DELETE RESTRICT |
| client_subject_id | uuid | Harus sama dengan order                  |
| title       | varchar(255) |                                     |
| status      | enum         | `draft`,`published`,`archived`      |
| published_at, expires_at | timestamptz | Nullable                   |
| created_at  | timestamptz  |                                     |

### `gallery_photos`

| Kolom          | Tipe         | Keterangan                         |
|----------------|--------------|------------------------------------|
| id             | uuid PK      |                                    |
| workspace_id   | uuid FK      | Not null                           |
| album_id       | uuid FK      | Composite tenant FK, ON DELETE RESTRICT |
| storage_object_id | uuid FK   | Object original berstatus `available` |
| thumbnail_object_id | uuid FK | Nullable                           |
| sort_order     | integer      | Check >= 0                         |
| created_at     | timestamptz  |                                    |
| deleted_at     | timestamptz  | Nullable                           |

URL signed tidak disimpan. Foto soft-deleted tidak muncul di portal; object dihapus setelah retention/cleanup aman.

## 4. Akses Portal dan Evidence

### `portal_access_tokens`

| Kolom | Tipe | Aturan |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK | Not null |
| client_subject_id | uuid | Non-PII subject; harus sama dengan typed target |
| contract_id | uuid nullable FK | Composite workspace FK |
| invoice_id | uuid nullable FK | Composite workspace FK |
| album_id | uuid nullable FK | Composite workspace FK |
| token_hash | char(64) unique | SHA-256 token acak; token mentah tidak disimpan |
| scopes | text[] | Allowlist action minimum |
| expires_at, revoked_at, last_used_at | timestamptz | Nullable kecuali expiry |
| created_at | timestamptz | Not null |

Check constraint mewajibkan tepat satu dari `contract_id`, `invoice_id`, atau `album_id` terisi. Composite typed FK memakai `(workspace_id,target_id,client_subject_id)`, sehingga token tidak dapat menunjuk resource subject lain. Token minimal 256-bit, dibandingkan constant-time, dan selalu divalidasi terhadap typed target, scope, expiry, revocation, serta rate limit.

### `contract_signatures`

| Kolom | Tipe | Aturan |
|---|---|---|
| id | uuid PK | |
| workspace_id, contract_id | uuid FK | Composite tenant FK |
| portal_token_id | uuid FK | Principal klien |
| signer_role | enum | MVP hanya `client` |
| signature_object_id | uuid FK | Private PNG evidence |
| consent_text_snapshot | text | Not null |
| consented_at | timestamptz | Not null |
| ip_address | inet | Not null; access dibatasi |
| user_agent | text | Not null |
| document_hash | char(64) | Harus sama dengan contract |
| created_at | timestamptz | Not null |

Unique `(contract_id, signer_role)`. Composite constraint/FK memastikan `portal_token_id` menarget `contract_id` yang sama. Row append-only: tidak ada update/delete biasa.

### `gallery_selections`

| Kolom | Tipe | Aturan |
|---|---|---|
| id | uuid PK | |
| workspace_id, album_id, photo_id | uuid FK | Composite tenant FK |
| portal_token_id | uuid FK | Principal klien |
| selected_at | timestamptz | Not null |

Unique `(portal_token_id, photo_id)`. Composite constraints memastikan album foto dan target album token sama; unselect menghapus row selection, bukan mengubah foto global.

## 5. Storage dan Operasi

### `storage_objects`

| Kolom | Tipe | Aturan |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK | Not null |
| purpose | enum | `gallery_original`, `gallery_thumbnail`, `contract_pdf`, `signature`, `payment_proof` |
| object_key | text unique | Key acak; bukan URL |
| size_bytes | bigint | Check > 0 |
| mime_type | varchar(100) | Allowlist per purpose |
| checksum_sha256 | char(64) | Not null |
| status | enum | `pending`,`available`,`quarantined`,`failed`,`deleted` |
| upload_expires_at, finalized_at, deleted_at | timestamptz | Nullable |
| created_at | timestamptz | Not null |

Presign membuat row `pending`; finalize memverifikasi key, workspace, MIME/magic bytes, ukuran, checksum, dan object existence sebelum `available`. Cleanup menghapus pending expired/orphan. Signed URL dibuat on-demand dan tidak disimpan.

### `notification_deliveries`

| Kolom | Tipe | Aturan |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK | Not null |
| resource_type, resource_id | varchar, uuid | Sumber pesan |
| recipient_email | varchar(255) | Snapshot tujuan |
| template_key | varchar(100) | Not null |
| dedupe_key | varchar(255) | Not null |
| status | enum | `pending`,`sent`,`failed` |
| provider_message_id | varchar(255) | Nullable |
| attempt_count | integer | Default 0 |
| sent_at, created_at, updated_at | timestamptz | |

Unique `(workspace_id, dedupe_key)`. Penerbitan memakai resource/version/recipient; reminder memakai resource/recipient/date UTC.

### `audit_events`

| Kolom | Tipe | Aturan |
|---|---|---|
| id | uuid PK | Time-sortable UUID direkomendasikan |
| workspace_id | uuid FK | Not null |
| actor_type | enum | `owner`,`portal`,`system` |
| actor_id | text | Auth user ID, portal token ID, atau cron identity |
| action, resource_type | varchar(100) | Not null |
| resource_id | uuid | Not null |
| request_id | varchar(100) | Not null |
| metadata | jsonb | Allowlist; tanpa secret/token/PII mentah |
| created_at | timestamptz | Not null |

Append-only; application role tidak memiliki `UPDATE`/`DELETE` pada row audit.

## 6. Constraint, Index, dan Lifecycle

- Setiap tabel tenant memiliki unique `(workspace_id, id)` untuk composite FK.
- Index list utama: `leads(workspace_id,status,created_at desc)`, `clients(workspace_id,email_normalized)`, `orders(workspace_id,status,event_at)`, `contracts(workspace_id,order_id,status)`, `invoices(workspace_id,status,due_date)`, `payments(workspace_id,invoice_id,created_at)`, `gallery_photos(workspace_id,album_id,sort_order)`, `storage_objects(workspace_id,status,upload_expires_at)`, dan `audit_events(workspace_id,created_at desc)`.
- Checks: nominal nonnegatif, payment positif, checksum hex 64 karakter, expiry setelah created, serta resource type/scope allowlist.
- Parent historis (`orders`, issued contract/invoice) memakai restrict. Draft child dapat cascade hanya jika migration menyebutkannya; production records di-archive/void.
- Deletion request segera mencabut session/token; object dan data nonwajib dihapus maksimal 30 hari. Contract/invoice/payment/audit mengikuti policy legal di `SECURITY.md` dan dihapus setelah expiry policy.

### FK Inventory Normatif

| Child | Parent | Delete action |
|---|---|---|
| `profiles.auth_user_id`, `workspace_members.auth_user_id` | logical `neon_auth.user.id` | Tanpa FK fisik; adapter verification + reconciliation |
| seluruh `workspace_id` | `workspaces.id` | Restrict |
| `(workspace_id, client_id)` | `clients(workspace_id,id)` | Restrict; lifecycle men-null FK order setelah token dicabut/snapshot tervalidasi |
| `(workspace_id, order_id, client_subject_id)` | `orders(workspace_id,id,client_subject_id)` | Restrict untuk contract/invoice/album dan mengikat subject |
| `(workspace_id, template_id)` | `contract_templates(workspace_id,id)` | Set null bila template diarsip/dihapus |
| `(workspace_id, invoice_id)` | `invoices(workspace_id,id)` | Restrict untuk item/payment/proof/reversal |
| `(workspace_id, album_id)` | `gallery_albums(workspace_id,id)` | Restrict; cleanup draft eksplisit |
| `(workspace_id, album_id, photo_id)` | `gallery_photos(workspace_id,album_id,id)` | Restrict untuk selection |
| typed token targets | Contract/invoice/album composite tenant keys | Restrict; exactly one target |
| signature/selection/proof `portal_token_id` | token + target composite unique key | Restrict; target harus identik |
| payment `(workspace_id,invoice_id,payment_proof_id)` | accepted proof pada invoice sama | Restrict + constraint trigger status accepted |
| seluruh storage reference | `storage_objects(workspace_id,id)` | Restrict sampai retention cleanup |

Parent menyediakan unique key yang sama persis dengan kolom FK tersebut. Migration test wajib mencoba FK lintas workspace dan gagal di database, bukan hanya service.

### State Transition Matrix

Semua retry ke state yang sama adalah no-op dan tidak membuat event kedua. Transisi selain tabel berikut ditolak:

| Entity | Allowed transition | Actor/precondition |
|---|---|---|
| workspace | `active → suspended/deletion_pending`; `suspended → active/deletion_pending`; `deletion_pending → deleted` | Owner/system; deletion selesai setelah policy |
| membership | `active → suspended/revoked`; `suspended → active/revoked` | System/support; `revoked` terminal |
| lead | `new → follow_up/converted/lost/archived`; `follow_up → converted/lost/archived`; `lost → follow_up/archived` | Owner; converted membutuhkan immutable client link |
| order | `draft → confirmed/cancelled`; `confirmed → in_progress/cancelled`; `in_progress → completed/cancelled` | Owner; terminal completed/cancelled |
| contract | `draft → published/void`; `published → signed/void`; `signed → void` | Owner publish/void, scoped client sign; evidence retained |
| invoice | `draft → unpaid/void`; `unpaid → partial/paid/void`; `partial → paid/unpaid`; `paid → partial/unpaid` | Payment/reversal menghitung state; void hanya saat draft atau net paid = 0 |
| payment proof | `submitted → accepted/rejected/deleted`; `rejected → deleted`; `accepted → deleted` | Client submit; owner review; delete hanya lifecycle |
| album | `draft → published/archived`; `published → archived` | Owner; archived terminal |
| storage object | `pending → available/quarantined/failed/deleted`; `quarantined → available/deleted`; `available → deleted`; `failed → deleted` | Finalizer/cleanup; deleted terminal |
| notification | `pending → sent/failed`; `failed → pending` | System; retry menaikkan attempt count |

## 7. Transaksi dan Acceptance Criteria Schema

### Onboarding

Dalam satu transaksi serializable/advisory-lock per `auth_user_id`: upsert profile, buat workspace bila belum ada, lalu buat owner membership. Unique constraints membuat retry mengembalikan workspace yang sama. Commit gagal seluruhnya bila salah satu langkah gagal.

### Isolasi dan Otorisasi

- Repository/use-case wajib menerima `workspace_id` dari membership aktif, bukan request body.
- Route bisnis mensyaratkan `workspaces.status = 'active'`; export/deletion adalah pengecualian reauthenticated untuk `active`/`suspended`, sedangkan `deletion_pending`/`deleted` ditolak.
- Detail/mutasi memakai `WHERE workspace_id = :resolvedWorkspaceId AND id = :id`; kegagalan scope dikembalikan sebagai not found/forbidden sesuai policy API.
- Integration test wajib mencakup dua akun bisnis, ID valid dari tenant lain, cross-tenant FK, owner suspended/revoked, seluruh workspace state, lifecycle exception, dan onboarding concurrent retry.

### Transaksi Kritis

- Publish contract: snapshot + PDF object + hash + audit dalam boundary transaksi/outbox yang terdokumentasi.
- Sign contract: lock contract, validasi token/hash/status, insert signature tunggal, ubah status, dan audit secara idempotent.
- Record payment: unique idempotency key, insert ledger, hitung total, ubah invoice, dan audit dalam satu transaksi.
- Finalize upload: lock storage row, verifikasi object/checksum, lalu ubah status sekali; retry mengembalikan hasil sama.

## 8. Evolusi Post-MVP

Migration Post-MVP dapat menambah invitation, role `admin`/`assistant`, multi-workspace membership, subscription billing, payment gateway, automation rules, dan `photo_embeddings`. Tidak ada tabel/UI/API invitation atau permission JSON pada baseline MVP.
