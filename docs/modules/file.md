# File Module -- Secure File Storage & Antivirus Scanning

## 1. Purpose

The File module provides secure file storage, antivirus scanning, and variant generation for all platform attachments within the Sentinel disaster management platform. It is the single source of truth for binary content: every file uploaded by any module (Communication, Document, Incident, Task) is stored, scanned, and served through this module.

### Ownership Boundaries

File **owns**:

- File metadata (filename, MIME type, size, SHA-256 hash, upload provenance)
- Physical object storage in MinIO (S3-compatible), on-prem/air-gap capable
- Antivirus scanning lifecycle (ClamAV integration, scan status, scan results)
- File variants (thumbnails at multiple sizes, OCR text extraction, PDF previews)
- Presigned URL generation for uploads and downloads
- Content-addressable deduplication (SHA-256 unique per tenant)
- Soft-delete lifecycle with 30-day retention before hard purge
- Object lock (WORM) for audit-grade files (call recordings, signed documents)

File **does not own**:

- Entity linking (which message, sitrep, or document references a file) -- the consumer module stores `uuid` or `uuid[]` references and is responsible for maintaining those links
- Push notifications on scan results (owned by Notification; File emits events that Notification consumes)
- User identity and permissions (owned by IAM; File queries IAM PDP for authorization)
- Audit log persistence (delegates to the Audit module; File emits auditable events)

### Key Design Decisions

- **Content addressing:** Files are addressed by `id` (UUIDv7) externally. Physical MinIO paths (`bucket/object_key`) are never exposed to clients. All downloads go through presigned URLs or a proxy endpoint.
- **Scan-before-access:** No file is reachable (downloadable, embeddable, linkable) until `scan_status = 'clean'`. This is enforced at the query and URL-generation layers.
- **Deduplication:** SHA-256 is unique per tenant. If a user uploads a file with an identical hash to one already stored for that tenant, the existing file reference is returned. No duplicate bytes are stored in MinIO.
- **Air-gap support:** MinIO is deployed on-prem. No external network calls are required for storage or scanning. ClamAV runs as a local daemon.

---

## 2. Domain Model

### Aggregates

#### File (Aggregate Root)

| Column       | Type        | Notes                                                                        |
| ------------ | ----------- | ---------------------------------------------------------------------------- |
| id           | uuid (v7)   | PK                                                                           |
| tenant_id    | uuid        | FK -> iam.tenants, NOT NULL                                                  |
| bucket       | text        | MinIO bucket name, NOT NULL. Format: `t-{tenant_id_short}`                   |
| object_key   | text        | MinIO object key, NOT NULL. Format: `{yyyy}/{mm}/{dd}/{uuid}.{ext}`          |
| filename     | text        | Original filename as uploaded by user, 1-255 chars, NOT NULL                 |
| mime_type    | text        | Validated MIME type from whitelist, NOT NULL                                  |
| size_bytes   | bigint      | File size in bytes, NOT NULL, CHECK > 0                                      |
| sha256       | text        | SHA-256 hex digest (64 chars), NOT NULL                                      |
| scan_status  | text        | CHECK (scan_status IN ('pending','clean','infected','error')), NOT NULL      |
| uploaded_by  | uuid        | FK -> iam.users, NOT NULL                                                    |
| uploaded_at  | timestamptz | Default now(), NOT NULL                                                      |
| deleted_at   | timestamptz | Nullable. Set on soft-delete. MinIO object retained for 30 days after this   |
| deleted_by   | uuid        | FK -> iam.users, nullable. The user who initiated deletion                   |
| worm_locked  | boolean     | Default false. When true, file cannot be deleted until lock expires           |
| worm_until   | timestamptz | Nullable. Object lock expiry. NULL if not WORM-locked                        |

**Invariants:**

- `scan_status` starts as `'pending'` on insert. Only the AV scan worker transitions it.
- `sha256` + `tenant_id` is unique. Duplicate uploads within the same tenant return the existing file.
- `deleted_at` being set makes the file invisible to all queries (soft-delete). The MinIO object is purged by the retention worker 30 days after `deleted_at`.
- `worm_locked = true` prevents deletion regardless of user role. Only `platform_admin` can set WORM lock. Lock is time-bound via `worm_until`.
- `object_key` follows a date-partitioned layout for efficient MinIO listing and lifecycle policies.
- `bucket` is auto-created per tenant on first upload if it does not exist.

#### FileVariant (Entity)

| Column       | Type        | Notes                                                                      |
| ------------ | ----------- | -------------------------------------------------------------------------- |
| id           | uuid (v7)   | PK                                                                         |
| file_id      | uuid        | FK -> file.files, NOT NULL                                                 |
| kind         | text        | CHECK (kind IN ('thumbnail_sm','thumbnail_md','thumbnail_lg','ocr_text','preview_pdf')), NOT NULL |
| object_key   | text        | MinIO object key for this variant, NOT NULL                                |
| mime_type    | text        | MIME type of variant output, NOT NULL                                      |
| size_bytes   | bigint      | Variant file size, NOT NULL, CHECK > 0                                     |
| status       | text        | CHECK (status IN ('generating','ready','failed')), NOT NULL, default 'generating' |
| error_message| text        | Nullable. Set when status = 'failed'                                       |
| generated_at | timestamptz | Nullable. Set when status = 'ready'                                        |
| created_at   | timestamptz | Default now(), NOT NULL                                                    |

**Invariants:**

- A file can have at most one variant of each `kind` (enforced by unique index on `file_id, kind`).
- Variants are only generated for files with `scan_status = 'clean'`.
- Variant `object_key` follows the pattern: `{file_object_key_base}/variants/{kind}.{ext}`.
- When the parent file is soft-deleted, variants are also deleted in the same retention cycle.

#### FileScanResult (Entity)

| Column     | Type        | Notes                                                              |
| ---------- | ----------- | ------------------------------------------------------------------ |
| id         | uuid (v7)   | PK                                                                 |
| file_id    | uuid        | FK -> file.files, NOT NULL                                         |
| scanner    | text        | Scanner identifier, NOT NULL. Currently always `'clamav'`          |
| result     | text        | CHECK (result IN ('clean','infected','error')), NOT NULL           |
| signature  | text        | Nullable. Virus signature name if result = 'infected'              |
| detail     | text        | Nullable. Additional scanner output or error message               |
| scanned_at | timestamptz | NOT NULL, Default now()                                            |

**Invariants:**

- Multiple scan results can exist per file (re-scans). The latest result determines `file.scan_status`.
- `signature` is NOT NULL when `result = 'infected'`, NULL otherwise.
- Scan results are immutable once created. They are never updated or deleted.

### Value Objects

**ScanStatus**

```typescript
export enum ScanStatus {
  PENDING  = 'pending',
  CLEAN    = 'clean',
  INFECTED = 'infected',
  ERROR    = 'error',
}
```

**VariantKind**

```typescript
export enum VariantKind {
  THUMBNAIL_SM  = 'thumbnail_sm',   // 64x64 px, JPEG
  THUMBNAIL_MD  = 'thumbnail_md',   // 256x256 px, JPEG
  THUMBNAIL_LG  = 'thumbnail_lg',   // 512x512 px, JPEG
  OCR_TEXT      = 'ocr_text',        // Extracted text, text/plain
  PREVIEW_PDF   = 'preview_pdf',    // PDF preview for non-PDF documents
}
```

Variant generation rules by source MIME type:

| Source MIME                   | thumbnail_sm | thumbnail_md | thumbnail_lg | ocr_text | preview_pdf |
| ---------------------------- | ------------ | ------------ | ------------ | -------- | ----------- |
| image/*                      | yes          | yes          | yes          | yes      | no          |
| application/pdf              | yes          | yes          | yes          | yes      | no          |
| application/msword           | no           | no           | no           | no       | yes         |
| application/vnd.openxml...   | no           | no           | no           | no       | yes         |
| video/mp4                    | yes (frame)  | yes (frame)  | no           | no       | no          |
| audio/*, text/plain          | no           | no           | no           | no       | no          |

**MimeType (Validated Whitelist)**

```typescript
export const ALLOWED_MIME_TYPES: readonly string[] = [
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/tiff',
  'image/bmp',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  // Text
  'text/plain',
  'text/csv',
  // Media
  'video/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  // Archives (for document bundles)
  'application/zip',
] as const;

// Tenants can restrict this list further via tenant configuration.
// Tenants cannot add types outside the platform whitelist.
```

**FileAddress (Value Object)**

```typescript
export class FileAddress {
  constructor(
    public readonly bucket: string,
    public readonly objectKey: string,
  ) {}

  /** Never expose to clients. Internal use only. */
  toMinioPath(): string {
    return `${this.bucket}/${this.objectKey}`;
  }
}
```

---

## 3. Business Rules

### Upload Rules

| #  | Rule                                                                                           | Enforcement                                                                 |
| -- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| U1 | File not reachable until `scan_status = 'clean'`. All download URL generation and proxy endpoints check this. | Application layer check in GetDownloadUrl handler + RLS policy filter       |
| U2 | SHA-256 unique per tenant. Duplicate upload returns existing file reference without storing new bytes. | UNIQUE(tenant_id, sha256) constraint + CheckDuplicate query before upload   |
| U3 | Physical MinIO paths never exposed to clients. Presigned URLs or server-side proxy only.       | No object_key or bucket in response DTOs. Presigned URL generation server-side |
| U4 | MIME type validated against whitelist before upload is accepted. MIME is re-validated server-side from magic bytes, not trusted from Content-Type header. | `file-type` library (magic byte detection) in upload handler                |
| U5 | Max file size: 100 MB default. Configurable per tenant (stored in `iam.tenant_settings`). Maximum absolute cap: 500 MB (for call recordings). | Multipart size limit in NestJS + presigned URL policy condition             |
| U6 | Filename sanitized: path traversal characters stripped (`../`, `./`, `/`, `\`), Unicode normalized (NFC), max 255 chars. | Sanitization function in upload handler                                     |
| U7 | Empty files (0 bytes) rejected.                                                                | DTO validation + MinIO upload validation                                    |
| U8 | Bucket auto-created per tenant on first upload with proper ACLs (private, no public access).   | MinIO SDK `makeBucket` with `bucketExists` check                            |

### Scanning Rules

| #  | Rule                                                                                           | Enforcement                                                                 |
| -- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| S1 | Every file is AV-scanned via ClamAV before becoming accessible. No exceptions.                 | `file.uploaded.v1` event triggers scan worker                               |
| S2 | If AV scanner is unavailable, file stays in `pending`. Retry via NATS with exponential backoff (1s, 2s, 4s, 8s, 16s, max 30s). | NATS JetStream AckWait + MaxDeliver configuration                           |
| S3 | Alert emitted if any file remains in `pending` for more than 5 minutes.                        | Cron job checks `WHERE scan_status = 'pending' AND uploaded_at < now() - interval '5 minutes'` |
| S4 | Infected file: `scan_status` set to `infected`, `file.scanned.v1` emitted with `status: 'infected'` and virus `signature`. Uploader notified. `file.infected.v1` emitted for consumer modules to remove references. | Scan worker + event emission                                                |
| S5 | Scan error (ClamAV returns error, not clean/infected): `scan_status` set to `error`. Retry up to 3 times. After 3 failures, manual review required. | Scan worker retry logic + alert                                             |
| S6 | Re-scan capability: `platform_admin` can trigger a re-scan of any file. New `FileScanResult` row created. | Admin-only endpoint                                                         |

### Variant Rules

| #  | Rule                                                                                           | Enforcement                                                                 |
| -- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| V1 | Thumbnails auto-generated for images and PDFs once `scan_status = 'clean'`.                    | `file.scanned.v1` event handler triggers variant worker when status = clean |
| V2 | OCR text extracted for images and scanned PDFs via Tesseract worker.                           | Same trigger as V1                                                          |
| V3 | Variant generation retried 3 times on failure. After 3 failures, variant marked as `failed`. File itself remains usable. | NATS MaxDeliver = 3 + status update                                         |
| V4 | Preview PDFs generated for Office documents (docx, xlsx, pptx) via LibreOffice headless.       | Same trigger as V1                                                          |
| V5 | Video thumbnails extracted from first keyframe via FFmpeg.                                      | Same trigger as V1                                                          |

### Deletion Rules

| #  | Rule                                                                                           | Enforcement                                                                 |
| -- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| D1 | Soft-delete: `deleted_at` set, file becomes invisible to queries. MinIO object retained for 30 days. | Application layer + query filter `WHERE deleted_at IS NULL`                 |
| D2 | Hard purge: MinIO object and variants deleted after 30-day retention period. File metadata row kept with `deleted_at` for audit trail. | Scheduled purge worker runs daily                                           |
| D3 | WORM-locked files cannot be soft-deleted until `worm_until` has passed. Returns `FILE_WORM_LOCKED`. | Application layer check before delete                                       |
| D4 | Files referenced by multiple entities: soft-delete makes file invisible. Consumer modules handle broken references gracefully (show "file deleted" placeholder). | Consumer module responsibility; File emits `file.deleted.v1`                |
| D5 | Only `platform_admin` can hard-purge before the 30-day retention period (emergency purge).     | Permission check in PurgeFile handler                                       |

---

## 4. Use Cases

### Commands

#### UploadFile

**Actor:** Authenticated user with `file.upload` permission
**Input:** Multipart form data: `file` (binary), `filename` (optional override)
**Flow:**

1. Validate MIME type from magic bytes (not Content-Type header). Reject if not in whitelist. Return `FILE_TYPE_NOT_ALLOWED`.
2. Validate file size against tenant limit. Reject if exceeded. Return `FILE_TOO_LARGE`.
3. Sanitize filename (strip path traversal, Unicode NFC normalize, truncate to 255 chars).
4. Compute SHA-256 hash of the file content (streamed, not buffered entirely in memory).
5. Check for duplicate: `SELECT id FROM file.files WHERE tenant_id = :tenantId AND sha256 = :sha256 AND deleted_at IS NULL`.
6. If duplicate found: return existing file reference with `FILE_DUPLICATE` info (HTTP 200, not error). Increment a `duplicate_uploads` counter metric.
7. If not duplicate: generate UUIDv7 for file ID. Construct object key: `{yyyy}/{mm}/{dd}/{fileId}.{ext}`.
8. Ensure tenant bucket exists (`t-{tenantIdShort}`). Create if not found.
9. Upload file to MinIO with `Content-Type` and `x-amz-meta-sha256` metadata.
10. Insert `file.files` row with `scan_status = 'pending'` in a transaction with outbox event.
11. Write outbox event `file.uploaded.v1`.
12. Return file DTO (id, filename, mimeType, sizeBytes, scanStatus: 'pending').

**Errors:** `FILE_TYPE_NOT_ALLOWED`, `FILE_TOO_LARGE`, `FILE_UPLOAD_FAILED`

#### RequestPresignedUpload

**Actor:** Authenticated user with `file.upload` permission
**Input:** `{ filename, mimeType, sizeBytes }`
**Flow:**

1. Validate MIME type against whitelist. Reject if not allowed.
2. Validate size against tenant limit. Reject if exceeded.
3. Sanitize filename.
4. Generate UUIDv7 for file ID. Construct object key.
5. Ensure tenant bucket exists.
6. Generate presigned PUT URL with conditions: exact Content-Type, max Content-Length, 1-hour expiry.
7. Insert `file.files` row with `scan_status = 'pending'` and a `confirmed` flag set to `false` (file not yet uploaded to MinIO).
8. Return `{ fileId, uploadUrl, expiresAt, method: 'PUT', headers: { 'Content-Type': mimeType } }`.

**Errors:** `FILE_TYPE_NOT_ALLOWED`, `FILE_TOO_LARGE`

#### ConfirmUpload

**Actor:** The same user who requested the presigned upload
**Input:** `{ fileId, sha256 }`
**Flow:**

1. Load file record. Verify it exists, belongs to the actor, and `confirmed = false`.
2. Verify the object exists in MinIO (HEAD request). If not, return `FILE_UPLOAD_FAILED`.
3. Verify object size matches `size_bytes` declared in presigned request. If mismatch, delete MinIO object and return `FILE_UPLOAD_FAILED`.
4. Verify SHA-256 from client matches server-computed hash (download + hash, or use MinIO metadata if available). If mismatch, delete MinIO object and return `FILE_UPLOAD_FAILED`.
5. Check for duplicate by SHA-256 within tenant. If duplicate, delete newly uploaded MinIO object, return existing file reference.
6. Set `confirmed = true`, update `sha256`.
7. Write outbox event `file.uploaded.v1`.
8. Return file DTO.

**Errors:** `FILE_NOT_FOUND`, `FILE_UPLOAD_FAILED`, `FILE_DUPLICATE`

#### ScanFile (Worker)

**Actor:** System (triggered by `file.uploaded.v1` event via NATS consumer)
**Input:** `{ fileId }`
**Flow:**

1. Load file record. Verify `scan_status = 'pending'`.
2. Download file from MinIO to a temporary path (or stream to ClamAV via `clamd` TCP socket).
3. Send file to ClamAV daemon (`INSTREAM` command via `clamd` socket on port 3310).
4. Parse ClamAV response.
5. Insert `file.scan_results` row with result and signature (if infected).
6. Update `file.files SET scan_status = :result`.
7. Write outbox event `file.scanned.v1` with status and signature.
8. If infected: also write `file.infected.v1` event for consumer modules to remove references.
9. Clean up temporary file.

**Retry:** NATS AckWait = 60s. MaxDeliver = 5. Backoff: 1s, 2s, 4s, 8s, 16s. On final failure, set `scan_status = 'error'`, emit `file.scan_failed.v1`.

#### GenerateVariant (Worker)

**Actor:** System (triggered by `file.scanned.v1` when status = clean, via NATS consumer)
**Input:** `{ fileId, variantKind }`
**Flow:**

1. Load file record. Verify `scan_status = 'clean'`.
2. Check if variant already exists for this file + kind. If yes, skip (idempotent).
3. Insert `file.variants` row with `status = 'generating'`.
4. Download source file from MinIO to temporary path.
5. Generate variant based on kind:
   - `thumbnail_sm/md/lg`: Use Sharp (Node.js) for images. Use `pdf-poppler` for PDF first-page render, then Sharp for resize. Use FFmpeg for video frame extraction.
   - `ocr_text`: Use Tesseract.js or `tesseract` CLI. For PDFs, first render to images via `pdf-poppler`, then OCR each page.
   - `preview_pdf`: Use LibreOffice headless (`soffice --convert-to pdf`).
6. Upload variant to MinIO at `{file_object_key_base}/variants/{kind}.{ext}`.
7. Update variant row: `status = 'ready'`, `generated_at = now()`, `size_bytes`, `mime_type`.
8. Write outbox event `file.variant_ready.v1`.

**Retry:** MaxDeliver = 3. On final failure, update variant `status = 'failed'`, set `error_message`.

#### DeleteFile (Soft)

**Actor:** File uploader or tenant_admin
**Input:** `{ fileId }`
**Flow:**

1. Load file record. Verify it exists and `deleted_at IS NULL`.
2. Verify WORM lock: if `worm_locked = true AND worm_until > now()`, return `FILE_WORM_LOCKED`.
3. Verify authorization: actor is the uploader OR has `file.delete` permission (tenant_admin+).
4. Set `deleted_at = now()`, `deleted_by = actorId`.
5. Write outbox event `file.deleted.v1`.

**Errors:** `FILE_NOT_FOUND`, `FILE_WORM_LOCKED`, `FILE_DELETE_DENIED`

#### PurgeFile (Hard)

**Actor:** `platform_admin` only (or automated retention worker after 30 days)
**Input:** `{ fileId }` or batch from retention worker
**Flow:**

1. Load file record. Verify `deleted_at IS NOT NULL` and either 30 days have passed or actor is `platform_admin`.
2. Delete MinIO object (file).
3. Delete all MinIO variant objects.
4. Delete `file.variants` rows.
5. Delete `file.scan_results` rows.
6. Update file row: keep metadata for audit trail (do not hard-delete the row). Set a `purged_at` timestamp.

**Errors:** `FILE_NOT_FOUND`, `FILE_PURGE_DENIED`

### Queries

#### GetFile

**Input:** `{ fileId }`
**Output:** File metadata DTO. Does NOT include object_key or bucket.

```sql
SELECT id, tenant_id, filename, mime_type, size_bytes, sha256,
       scan_status, uploaded_by, uploaded_at, deleted_at, worm_locked
FROM file.files
WHERE id = :fileId
  AND tenant_id = current_setting('app.current_tenant_id')::uuid
  AND deleted_at IS NULL;
```

#### GetDownloadUrl

**Input:** `{ fileId }`
**Output:** `{ url, expiresAt }` -- presigned GET URL with 15-minute TTL.

```sql
-- First verify the file is clean and accessible
SELECT id, bucket, object_key, filename, mime_type, scan_status
FROM file.files
WHERE id = :fileId
  AND tenant_id = current_setting('app.current_tenant_id')::uuid
  AND deleted_at IS NULL
  AND scan_status = 'clean';
```

If `scan_status != 'clean'`: return `FILE_SCAN_PENDING` (if pending) or `FILE_INFECTED` (if infected).

Presigned URL includes `response-content-disposition: attachment; filename="{sanitized_filename}"` to force download with the original filename.

#### ListFiles

**Input:** `{ tenantId, uploadedBy?, mimeType?, scanStatus?, limit (default 50, max 200), offset }`
**Output:** Paginated list of file metadata DTOs.

```sql
SELECT id, filename, mime_type, size_bytes, sha256,
       scan_status, uploaded_by, uploaded_at
FROM file.files
WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
  AND deleted_at IS NULL
  AND (:uploadedBy IS NULL OR uploaded_by = :uploadedBy)
  AND (:mimeType IS NULL OR mime_type LIKE :mimeTypePattern)
  AND (:scanStatus IS NULL OR scan_status = :scanStatus)
ORDER BY uploaded_at DESC
LIMIT :limit OFFSET :offset;
```

#### GetVariant

**Input:** `{ fileId, kind }`
**Output:** Presigned GET URL for the variant, or status if not ready.

```sql
SELECT v.id, v.kind, v.object_key, v.mime_type, v.size_bytes,
       v.status, v.error_message, v.generated_at
FROM file.variants v
JOIN file.files f ON f.id = v.file_id
WHERE v.file_id = :fileId
  AND v.kind = :kind
  AND f.tenant_id = current_setting('app.current_tenant_id')::uuid
  AND f.deleted_at IS NULL;
```

If `status = 'ready'`: generate presigned URL and return. If `status = 'generating'`: return `FILE_VARIANT_NOT_READY`. If `status = 'failed'`: return error message.

#### GetScanResult

**Input:** `{ fileId }`
**Output:** Latest scan result for the file.

```sql
SELECT id, scanner, result, signature, detail, scanned_at
FROM file.scan_results
WHERE file_id = :fileId
ORDER BY scanned_at DESC
LIMIT 1;
```

#### CheckDuplicate

**Input:** `{ tenantId, sha256 }`
**Output:** Existing file ID if duplicate, null otherwise.

```sql
SELECT id, filename, mime_type, size_bytes, scan_status
FROM file.files
WHERE tenant_id = :tenantId
  AND sha256 = :sha256
  AND deleted_at IS NULL;
```

---

## 5. API Contracts

### DTOs

```typescript
import {
  IsString, IsOptional, IsEnum, IsUUID, IsInt, IsBoolean,
  Min, Max, MaxLength, Length, IsHexadecimal,
} from 'class-validator';

// ── Upload DTOs ─────────────────────────────────────────

/** Used for POST /api/v1/files (multipart). File binary is in form-data field "file". */
export class UploadFileDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  filename?: string; // Override original filename. If omitted, derived from multipart field.
}

export class RequestPresignedUploadDto {
  @IsString()
  @Length(1, 255)
  filename: string;

  @IsString()
  mimeType: string; // Validated against whitelist server-side

  @IsInt()
  @Min(1)
  @Max(524_288_000) // 500 MB absolute max
  sizeBytes: number;
}

export class ConfirmUploadDto {
  @IsUUID()
  fileId: string;

  @IsString()
  @IsHexadecimal()
  @Length(64, 64)
  sha256: string;
}

// ── Query DTOs ──────────────────────────────────────────

export class ListFilesQueryDto {
  @IsOptional()
  @IsUUID()
  uploadedBy?: string;

  @IsOptional()
  @IsString()
  mimeType?: string; // Supports prefix matching: "image/" matches all image types

  @IsOptional()
  @IsEnum(ScanStatus)
  scanStatus?: ScanStatus;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number; // default 50

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

// ── Response DTOs ───────────────────────────────────────

export class FileResponseDto {
  id: string;
  tenantId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  scanStatus: ScanStatus;
  uploadedBy: string;
  uploadedAt: string; // ISO 8601
  wormLocked: boolean;
  variants: VariantSummaryDto[];
}

export class VariantSummaryDto {
  kind: VariantKind;
  status: string; // 'generating' | 'ready' | 'failed'
  mimeType: string | null;
  sizeBytes: number | null;
  generatedAt: string | null;
}

export class FileUploadResponseDto {
  file: FileResponseDto;
  duplicate: boolean; // true if existing file was returned
}

export class PresignedUploadResponseDto {
  fileId: string;
  uploadUrl: string;
  expiresAt: string; // ISO 8601
  method: 'PUT';
  headers: Record<string, string>;
}

export class DownloadUrlResponseDto {
  url: string;
  expiresAt: string; // ISO 8601
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export class VariantResponseDto {
  fileId: string;
  kind: VariantKind;
  status: string;
  url: string | null;      // presigned URL, only when status = 'ready'
  expiresAt: string | null; // URL expiry
  mimeType: string | null;
  sizeBytes: number | null;
  errorMessage: string | null; // only when status = 'failed'
}

export class ScanResultResponseDto {
  id: string;
  fileId: string;
  scanner: string;
  result: string;
  signature: string | null;
  detail: string | null;
  scannedAt: string;
}

export class FileListResponseDto {
  data: FileResponseDto[];
  total: number;
  limit: number;
  offset: number;
}
```

### REST Endpoints

| Method | Path                              | Handler                 | Auth                | Notes                                                      |
| ------ | --------------------------------- | ----------------------- | ------------------- | ---------------------------------------------------------- |
| POST   | `/api/v1/files`                   | UploadFile              | `file.upload`       | Multipart form-data. Max body: 100 MB (tenant-configurable) |
| POST   | `/api/v1/files/presigned`         | RequestPresignedUpload  | `file.upload`       | Body: `RequestPresignedUploadDto`                          |
| POST   | `/api/v1/files/confirm`           | ConfirmUpload           | `file.upload`       | Body: `ConfirmUploadDto`                                   |
| GET    | `/api/v1/files/:id`               | GetFile                 | `file.read`         | Returns file metadata, never binary                        |
| GET    | `/api/v1/files/:id/download`      | GetDownloadUrl          | `file.read`         | Returns presigned URL (302 redirect or JSON based on Accept header) |
| GET    | `/api/v1/files/:id/variants/:kind`| GetVariant              | `file.read`         | Returns variant presigned URL or status                    |
| GET    | `/api/v1/files/:id/scan`          | GetScanResult           | `file.read`         | Returns latest scan result                                 |
| DELETE | `/api/v1/files/:id`               | DeleteFile              | `file.delete`       | Soft-delete. Uploader or tenant_admin                      |
| DELETE | `/api/v1/files/:id/purge`         | PurgeFile               | `file.purge`        | Hard purge. platform_admin only                            |
| GET    | `/api/v1/files`                   | ListFiles               | `file.read`         | Query: `ListFilesQueryDto`                                 |

### Error Codes

| Code                     | HTTP Status | Description                                                               |
| ------------------------ | ----------- | ------------------------------------------------------------------------- |
| `FILE_NOT_FOUND`         | 404         | File does not exist, is deleted, or user lacks tenant access              |
| `FILE_SCAN_PENDING`      | 409         | File exists but AV scan has not completed. Retry after scan completes     |
| `FILE_INFECTED`          | 403         | File is infected. Download denied. Contact administrator                  |
| `FILE_TOO_LARGE`         | 413         | File exceeds tenant size limit                                            |
| `FILE_TYPE_NOT_ALLOWED`  | 415         | MIME type not in tenant whitelist                                         |
| `FILE_DUPLICATE`         | 200         | File with same SHA-256 already exists in tenant. Existing file returned   |
| `FILE_UPLOAD_FAILED`     | 500         | Upload to MinIO failed or presigned upload verification failed            |
| `FILE_VARIANT_NOT_READY` | 202         | Variant is still being generated. Retry later                             |
| `FILE_VARIANT_FAILED`    | 500         | Variant generation failed permanently                                     |
| `FILE_WORM_LOCKED`       | 409         | File is WORM-locked and cannot be deleted until lock expires              |
| `FILE_DELETE_DENIED`     | 403         | User is not the uploader and not a tenant_admin                           |
| `FILE_PURGE_DENIED`      | 403         | User is not a platform_admin                                              |

---

## 6. Events

All events are published to NATS JetStream via the transactional outbox pattern. Each event includes the standard envelope:

```typescript
interface EventEnvelope<T> {
  id: string;          // UUIDv7, unique per event
  type: string;        // e.g., "file.uploaded.v1"
  source: string;      // "file-module"
  tenantId: string;
  timestamp: string;   // ISO 8601
  correlationId: string;
  data: T;
}
```

### Produced Events

#### file.uploaded.v1

Emitted when a file is successfully stored in MinIO (either via direct upload or after presigned upload confirmation). Triggers AV scan.

```json
{
  "id": "019526c0-1000-7000-8000-000000000001",
  "type": "file.uploaded.v1",
  "source": "file-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T09:00:00.000Z",
  "correlationId": "019526c0-1000-7000-8000-000000000099",
  "data": {
    "fileId": "019526c0-1000-7000-8000-000000000010",
    "tenantId": "019526a0-1000-7000-8000-000000000001",
    "filename": "damage-assessment-bridge-north.jpg",
    "mimeType": "image/jpeg",
    "sizeBytes": 4587632,
    "sha256": "a3f2b8c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1",
    "uploadedBy": "019526a0-1000-7000-8000-000000000050"
  }
}
```

#### file.scanned.v1

Emitted after ClamAV scan completes (clean or infected). Consumers use this to update UI indicators and trigger variant generation.

```json
{
  "id": "019526c0-2000-7000-8000-000000000001",
  "type": "file.scanned.v1",
  "source": "file-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T09:00:05.000Z",
  "correlationId": "019526c0-1000-7000-8000-000000000099",
  "data": {
    "fileId": "019526c0-1000-7000-8000-000000000010",
    "tenantId": "019526a0-1000-7000-8000-000000000001",
    "status": "clean",
    "signature": null,
    "scanner": "clamav",
    "scannedAt": "2026-04-12T09:00:05.000Z"
  }
}
```

**Infected file example:**

```json
{
  "id": "019526c0-2000-7000-8000-000000000002",
  "type": "file.scanned.v1",
  "source": "file-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T09:01:00.000Z",
  "correlationId": "019526c0-1000-7000-8000-000000000100",
  "data": {
    "fileId": "019526c0-3000-7000-8000-000000000020",
    "tenantId": "019526a0-1000-7000-8000-000000000001",
    "status": "infected",
    "signature": "Win.Trojan.Agent-123456",
    "scanner": "clamav",
    "scannedAt": "2026-04-12T09:01:00.000Z"
  }
}
```

#### file.scan_failed.v1

Emitted when AV scan fails after all retries (ClamAV unreachable, processing error).

```json
{
  "id": "019526c0-2000-7000-8000-000000000003",
  "type": "file.scan_failed.v1",
  "source": "file-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T09:05:00.000Z",
  "correlationId": "019526c0-1000-7000-8000-000000000101",
  "data": {
    "fileId": "019526c0-3000-7000-8000-000000000030",
    "tenantId": "019526a0-1000-7000-8000-000000000001",
    "error": "ClamAV daemon unreachable after 5 retries",
    "lastAttemptAt": "2026-04-12T09:05:00.000Z",
    "attemptCount": 5
  }
}
```

#### file.infected.v1

Emitted specifically for infected files so consumer modules can remove references. Separate from `file.scanned.v1` to allow fine-grained subscription.

```json
{
  "id": "019526c0-2000-7000-8000-000000000004",
  "type": "file.infected.v1",
  "source": "file-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T09:01:01.000Z",
  "correlationId": "019526c0-1000-7000-8000-000000000100",
  "data": {
    "fileId": "019526c0-3000-7000-8000-000000000020",
    "tenantId": "019526a0-1000-7000-8000-000000000001",
    "filename": "report-final.docx",
    "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "signature": "Win.Trojan.Agent-123456",
    "uploadedBy": "019526a0-1000-7000-8000-000000000050"
  }
}
```

#### file.variant_ready.v1

Emitted when a variant has been successfully generated and stored.

```json
{
  "id": "019526c0-4000-7000-8000-000000000001",
  "type": "file.variant_ready.v1",
  "source": "file-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T09:00:12.000Z",
  "correlationId": "019526c0-1000-7000-8000-000000000099",
  "data": {
    "fileId": "019526c0-1000-7000-8000-000000000010",
    "tenantId": "019526a0-1000-7000-8000-000000000001",
    "variantId": "019526c0-4000-7000-8000-000000000010",
    "variantKind": "thumbnail_md",
    "mimeType": "image/jpeg",
    "sizeBytes": 28456
  }
}
```

#### file.deleted.v1

Emitted on soft-delete. Consumer modules should handle this to show "file deleted" placeholders.

```json
{
  "id": "019526c0-5000-7000-8000-000000000001",
  "type": "file.deleted.v1",
  "source": "file-module",
  "tenantId": "019526a0-1000-7000-8000-000000000001",
  "timestamp": "2026-04-12T14:30:00.000Z",
  "correlationId": "019526c0-5000-7000-8000-000000000099",
  "data": {
    "fileId": "019526c0-1000-7000-8000-000000000010",
    "tenantId": "019526a0-1000-7000-8000-000000000001",
    "deletedBy": "019526a0-1000-7000-8000-000000000050",
    "deletedAt": "2026-04-12T14:30:00.000Z"
  }
}
```

### Consumed Events

#### file.uploaded.v1 (self-consumption)

**Source:** file-module (self)
**Consumer group:** `file-scan-worker`
**Handler:** `OnFileUploaded`
**Action:**

1. Load file metadata by `fileId`.
2. Download file from MinIO.
3. Stream to ClamAV daemon for scanning.
4. Record scan result in `file.scan_results`.
5. Update `file.files.scan_status`.
6. Emit `file.scanned.v1` (or `file.scan_failed.v1` on final retry failure).

**Idempotency:** Check if a scan result already exists for this file. If `scan_status != 'pending'`, skip. Prevents duplicate scans on redelivery.

**NATS configuration:**

```
Stream:    FILE_EVENTS
Subject:   file.uploaded.v1
Consumer:  file-scan-worker
AckWait:   60s
MaxDeliver: 5
BackOff:   [1s, 2s, 4s, 8s, 16s]
```

#### file.scanned.v1 (self-consumption, when status = clean)

**Source:** file-module (self)
**Consumer group:** `file-variant-worker`
**Handler:** `OnFileScannedClean`
**Action:**

1. If `status != 'clean'`, acknowledge and skip.
2. Load file metadata. Determine applicable variant kinds based on MIME type (see variant generation table in section 2).
3. For each applicable variant kind, emit an internal `file.generate_variant.v1` command event with `{ fileId, variantKind }`.

**Idempotency:** Check if variants already exist for this file. Skip kinds that are already `ready` or `generating`.

**NATS configuration:**

```
Stream:    FILE_EVENTS
Subject:   file.scanned.v1
Consumer:  file-variant-worker
AckWait:   30s
MaxDeliver: 3
```

#### file.generate_variant.v1 (internal command)

**Source:** file-module (self, emitted by `OnFileScannedClean`)
**Consumer group:** `file-variant-generator`
**Handler:** `OnGenerateVariant`
**Action:**

1. Execute the GenerateVariant use case for the specified `fileId` and `variantKind`.
2. On success, emit `file.variant_ready.v1`.
3. On failure after max retries, update variant `status = 'failed'`.

**NATS configuration:**

```
Stream:    FILE_COMMANDS
Subject:   file.generate_variant.v1
Consumer:  file-variant-generator
AckWait:   120s  (variant generation can be slow, especially OCR)
MaxDeliver: 3
BackOff:   [5s, 15s, 30s]
```

---

## 7. Database Schema

### DDL

```sql
-- =============================================================================
-- Schema
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS file;

-- =============================================================================
-- file.files
-- =============================================================================
CREATE TABLE file.files (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid            NOT NULL REFERENCES iam.tenants(id),
    bucket          text            NOT NULL CHECK (char_length(bucket) BETWEEN 1 AND 63),
    object_key      text            NOT NULL CHECK (char_length(object_key) BETWEEN 1 AND 1024),
    filename        text            NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
    mime_type       text            NOT NULL CHECK (char_length(mime_type) BETWEEN 1 AND 255),
    size_bytes      bigint          NOT NULL CHECK (size_bytes > 0),
    sha256          text            NOT NULL CHECK (char_length(sha256) = 64),
    scan_status     text            NOT NULL DEFAULT 'pending' CHECK (
                        scan_status IN ('pending','clean','infected','error')
                    ),
    uploaded_by     uuid            NOT NULL REFERENCES iam.users(id),
    uploaded_at     timestamptz     NOT NULL DEFAULT now(),
    confirmed       boolean         NOT NULL DEFAULT true,
    deleted_at      timestamptz,
    deleted_by      uuid            REFERENCES iam.users(id),
    purged_at       timestamptz,
    worm_locked     boolean         NOT NULL DEFAULT false,
    worm_until      timestamptz,

    -- WORM consistency: worm_until required when worm_locked
    CONSTRAINT chk_worm_consistency CHECK (
        (worm_locked = false AND worm_until IS NULL) OR
        (worm_locked = true AND worm_until IS NOT NULL)
    ),
    -- Deletion consistency: deleted_by required when deleted_at set
    CONSTRAINT chk_deletion_consistency CHECK (
        (deleted_at IS NULL AND deleted_by IS NULL) OR
        (deleted_at IS NOT NULL AND deleted_by IS NOT NULL)
    )
);

-- SHA-256 unique per tenant (deduplication). Only for non-deleted files.
CREATE UNIQUE INDEX idx_files_tenant_sha256
    ON file.files (tenant_id, sha256)
    WHERE deleted_at IS NULL;

-- Tenant lookup (RLS filter path)
CREATE INDEX idx_files_tenant_id ON file.files (tenant_id);

-- Uploader lookup
CREATE INDEX idx_files_uploaded_by ON file.files (tenant_id, uploaded_by, uploaded_at DESC);

-- MIME type filtering per tenant
CREATE INDEX idx_files_tenant_mime ON file.files (tenant_id, mime_type);

-- Scan status filtering (for monitoring pending/error files)
CREATE INDEX idx_files_scan_status ON file.files (scan_status, uploaded_at)
    WHERE scan_status IN ('pending', 'error');

-- Soft-deleted files pending purge (retention worker)
CREATE INDEX idx_files_pending_purge ON file.files (deleted_at)
    WHERE deleted_at IS NOT NULL AND purged_at IS NULL;

-- Unconfirmed presigned uploads (cleanup worker)
CREATE INDEX idx_files_unconfirmed ON file.files (uploaded_at)
    WHERE confirmed = false;

-- Object key lookup (internal, for MinIO operations)
CREATE UNIQUE INDEX idx_files_bucket_object_key ON file.files (bucket, object_key);

-- Trigger: auto-update updated_at (not present on files since files are immutable
-- after creation, but we track state changes via scan_status and deleted_at)

-- =============================================================================
-- file.variants
-- =============================================================================
CREATE TABLE file.variants (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id         uuid            NOT NULL REFERENCES file.files(id) ON DELETE CASCADE,
    kind            text            NOT NULL CHECK (kind IN (
                        'thumbnail_sm','thumbnail_md','thumbnail_lg',
                        'ocr_text','preview_pdf'
                    )),
    object_key      text            NOT NULL CHECK (char_length(object_key) BETWEEN 1 AND 1024),
    mime_type       text            NOT NULL CHECK (char_length(mime_type) BETWEEN 1 AND 255),
    size_bytes      bigint          NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
    status          text            NOT NULL DEFAULT 'generating' CHECK (
                        status IN ('generating','ready','failed')
                    ),
    error_message   text            CHECK (char_length(error_message) <= 2000),
    generated_at    timestamptz,
    created_at      timestamptz     NOT NULL DEFAULT now(),

    -- Status consistency
    CONSTRAINT chk_variant_status_consistency CHECK (
        (status = 'ready' AND generated_at IS NOT NULL AND size_bytes > 0) OR
        (status = 'generating' AND generated_at IS NULL) OR
        (status = 'failed' AND generated_at IS NULL)
    ),
    -- Error message only when failed
    CONSTRAINT chk_variant_error CHECK (
        (status = 'failed' AND error_message IS NOT NULL) OR
        (status != 'failed' AND error_message IS NULL)
    )
);

-- One variant per kind per file
CREATE UNIQUE INDEX idx_variants_file_kind ON file.variants (file_id, kind);

-- File's variants lookup
CREATE INDEX idx_variants_file_id ON file.variants (file_id);

-- Status monitoring (for stuck generating variants)
CREATE INDEX idx_variants_status ON file.variants (status, created_at)
    WHERE status = 'generating';

-- =============================================================================
-- file.scan_results
-- =============================================================================
CREATE TABLE file.scan_results (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id         uuid            NOT NULL REFERENCES file.files(id) ON DELETE CASCADE,
    scanner         text            NOT NULL CHECK (char_length(scanner) BETWEEN 1 AND 50),
    result          text            NOT NULL CHECK (result IN ('clean','infected','error')),
    signature       text            CHECK (char_length(signature) <= 500),
    detail          text            CHECK (char_length(detail) <= 2000),
    scanned_at      timestamptz     NOT NULL DEFAULT now(),

    -- Signature required when infected
    CONSTRAINT chk_scan_signature CHECK (
        (result = 'infected' AND signature IS NOT NULL) OR
        (result != 'infected' AND signature IS NULL)
    )
);

-- File's scan history (latest first)
CREATE INDEX idx_scan_results_file ON file.scan_results (file_id, scanned_at DESC);

-- Scanner monitoring
CREATE INDEX idx_scan_results_scanner ON file.scan_results (scanner, scanned_at DESC);

-- Infected files lookup
CREATE INDEX idx_scan_results_infected ON file.scan_results (file_id)
    WHERE result = 'infected';

-- =============================================================================
-- file.outbox (transactional outbox for event publishing)
-- =============================================================================
CREATE TABLE file.outbox (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregatetype   text            NOT NULL DEFAULT 'file',
    aggregateid     uuid            NOT NULL,
    type            text            NOT NULL,
    payload         jsonb           NOT NULL,
    tenant_id       uuid            NOT NULL,
    created_at      timestamptz     NOT NULL DEFAULT now(),
    published_at    timestamptz
);

CREATE INDEX idx_file_outbox_unpublished ON file.outbox (created_at)
    WHERE published_at IS NULL;

-- =============================================================================
-- Row-Level Security (RLS)
-- =============================================================================
ALTER TABLE file.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE file.variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE file.scan_results ENABLE ROW LEVEL SECURITY;

-- Policy: files visible to same tenant, excluding deleted
CREATE POLICY tenant_isolation ON file.files
    USING (
        tenant_id = current_setting('app.current_tenant_id')::uuid
    );

-- Policy: only clean files are visible to non-admin users for download purposes.
-- Admin users can see all statuses (for monitoring). This is enforced at application
-- layer rather than RLS to avoid blocking the scan worker.
-- RLS focuses on tenant isolation only.

-- Policy: variants — accessible if parent file is accessible
CREATE POLICY tenant_isolation ON file.variants
    USING (
        EXISTS (
            SELECT 1 FROM file.files f
            WHERE f.id = file_id
              AND f.tenant_id = current_setting('app.current_tenant_id')::uuid
        )
    );

-- Policy: scan results — accessible if parent file is accessible
CREATE POLICY tenant_isolation ON file.scan_results
    USING (
        EXISTS (
            SELECT 1 FROM file.files f
            WHERE f.id = file_id
              AND f.tenant_id = current_setting('app.current_tenant_id')::uuid
        )
    );
```

### Scheduled Maintenance Jobs

```sql
-- Purge soft-deleted files after 30-day retention (runs daily at 02:00 UTC)
-- The application-layer PurgeFile worker handles the actual MinIO deletion.
-- This query identifies candidates:
SELECT cron.schedule('file-purge-candidates', '0 2 * * *', $$
    UPDATE file.files
    SET purged_at = now()
    WHERE deleted_at IS NOT NULL
      AND purged_at IS NULL
      AND deleted_at < now() - interval '30 days'
      AND worm_locked = false
    RETURNING id, bucket, object_key;
$$);

-- Clean up unconfirmed presigned uploads after 24 hours
SELECT cron.schedule('file-cleanup-unconfirmed', '30 2 * * *', $$
    DELETE FROM file.files
    WHERE confirmed = false
      AND uploaded_at < now() - interval '24 hours';
$$);

-- Alert on files stuck in pending scan status for more than 5 minutes
-- (This is implemented as a NestJS cron job that queries and emits alerts,
-- not a pg_cron job, since it needs to interact with NATS for alerting.)
```

---

## 8. Permissions (IAM Integration)

Every operation maps to a permission string evaluated by the IAM module's Policy Decision Point (PDP). The File module sends authorization queries to IAM before executing commands.

### Permission Matrix

| Permission     | Required Role              | Description                                                          |
| -------------- | -------------------------- | -------------------------------------------------------------------- |
| `file.upload`  | any authenticated user     | Upload files (direct or presigned)                                   |
| `file.read`    | any authenticated user     | View file metadata and download clean files within same tenant       |
| `file.delete`  | file uploader OR tenant_admin | Soft-delete a file                                                 |
| `file.purge`   | platform_admin only        | Hard-purge a file (remove MinIO object before retention period)      |
| `file.rescan`  | platform_admin only        | Trigger a re-scan of a file                                          |
| `file.worm`    | platform_admin only        | Set or modify WORM lock on a file                                    |

### ABAC Conditions

The following attribute-based conditions are applied in addition to role checks:

| Condition                    | Attributes                                    | Applied To                      |
| ---------------------------- | --------------------------------------------- | ------------------------------- |
| Tenant isolation             | `file.tenantId == user.tenantId`              | All operations                  |
| Ownership for delete         | `file.uploadedBy == user.id OR user.role >= tenant_admin` | `file.delete`         |
| Classification clearance     | `user.clearance >= linked_entity.classification` | `file.read` when file is linked to a classified entity (evaluated by consumer module before requesting download URL) |
| Scan status gate             | `file.scanStatus == 'clean'`                  | `file.read` (download only; metadata is always visible) |
| WORM lock gate               | `file.wormLocked == false OR file.wormUntil < now()` | `file.delete`            |

### Authorization Flow

```
Client Request
    |
    v
File Module (Command/Query Handler)
    |
    +-- 1. Extract JWT claims (tenantId, userId, roles, clearance)
    |
    +-- 2. Set PostgreSQL session variables for RLS:
    |       SET app.current_tenant_id = :tenantId
    |       SET app.current_user_id = :userId
    |
    +-- 3. Query IAM PDP for permission check:
    |       pdp.evaluate({
    |           action: 'file.read',
    |           resource: 'file:{fileId}',
    |           subject: { userId, tenantId, roles },
    |           context: { scanStatus, wormLocked }
    |       })
    |
    +-- 4. If denied -> return 403 with error code
    |
    +-- 5. If allowed -> proceed with command execution
    |       (RLS enforces tenant isolation at DB level)
```

**Note on classification:** The File module itself does not enforce classification-based access. Files are generic storage. The consumer module (e.g., Incident, Document) is responsible for checking the user's clearance against the linked entity's classification before requesting a download URL. The File module trusts that the calling module has already performed this check when the request arrives through an internal service call. External API calls go through the standard `file.read` permission which only checks tenant isolation and scan status.

---

## 9. Edge Cases

### Upload interrupted mid-stream

**Scenario:** A user's network connection drops while uploading a large file via multipart POST. The request handler receives only partial data.
**Handling:** The NestJS multipart parser (via `@fastify/multipart` or `multer`) will throw an error when the stream ends prematurely. The upload handler catches this error and returns `FILE_UPLOAD_FAILED`. No file record is inserted into PostgreSQL (transaction is rolled back). Any partially uploaded data to MinIO is cleaned up by the handler's `finally` block (delete the object if it was partially written). For presigned uploads, MinIO's multipart upload mechanism handles this natively: incomplete multipart uploads are cleaned up by MinIO's lifecycle policy after 24 hours. The `file.files` row with `confirmed = false` is cleaned up by the scheduled `file-cleanup-unconfirmed` job.

### AV scanner down

**Scenario:** The ClamAV daemon is unreachable when the scan worker attempts to scan a file.
**Handling:**

1. The scan worker catches the connection error and NAK-s the NATS message, triggering redelivery.
2. NATS JetStream retries with exponential backoff: 1s, 2s, 4s, 8s, 16s (MaxDeliver = 5).
3. If all 5 attempts fail, the worker sets `scan_status = 'error'` and emits `file.scan_failed.v1`.
4. A separate NestJS cron job runs every minute, querying `WHERE scan_status = 'pending' AND uploaded_at < now() - interval '5 minutes'`. If any files match, it emits an operational alert via the Notification module (paging the ops team).
5. Once ClamAV is restored, `platform_admin` can trigger a re-scan via the admin API, or the ops team can replay the NATS messages from the stream.
6. Files remain in `pending` status and are not downloadable during this period. The UI shows a "scan in progress" indicator.

### File infected

**Scenario:** ClamAV detects a virus in an uploaded file.
**Handling:**

1. Scan worker sets `scan_status = 'infected'` on the file record.
2. `file.scanned.v1` event emitted with `status: 'infected'` and the virus `signature`.
3. `file.infected.v1` event emitted separately. Consumer modules (Communication, Document, etc.) subscribe to this event and remove or flag references to the infected file. For example, the Communication module removes the file UUID from `message.attachments[]` arrays and posts a SYSTEM message: `"An attached file was removed because it was flagged as infected."`.
4. The Notification module consumes `file.infected.v1` to notify the uploader: `"Your file {filename} was flagged as infected ({signature}) and has been quarantined."`.
5. The file's MinIO object is retained (not deleted) for forensic analysis by the security team. It is only accessible to `platform_admin` via a dedicated quarantine review endpoint (not part of the standard API).

### Duplicate upload race condition

**Scenario:** Two users upload the same file (identical SHA-256) to the same tenant within milliseconds of each other.
**Handling:**

1. Both upload handlers compute the SHA-256 and check for duplicates via `SELECT ... WHERE tenant_id = :tenantId AND sha256 = :sha256 AND deleted_at IS NULL`.
2. Both find no existing file and proceed to insert.
3. The UNIQUE index `idx_files_tenant_sha256` on `(tenant_id, sha256) WHERE deleted_at IS NULL` causes the second INSERT to fail with a unique constraint violation.
4. The second handler catches the constraint violation, queries for the existing file, deletes the just-uploaded MinIO object (cleanup), and returns the existing file reference to the client with `duplicate: true`.
5. The first upload proceeds normally through the scan pipeline.
6. Net result: one file stored, one MinIO object, both users get the same file ID.

### Variant generation fails

**Scenario:** Thumbnail generation fails because Sharp cannot process a corrupted image, or Tesseract cannot OCR a complex document.
**Handling:**

1. The variant worker catches the processing error and NAK-s the NATS message.
2. NATS retries up to 3 times with backoff: 5s, 15s, 30s.
3. After 3 failures, the worker updates the variant row: `status = 'failed'`, `error_message = '{error details}'`.
4. No event is emitted for failed variants (consumers poll variant status or rely on `file.variant_ready.v1` which simply never arrives for failed variants).
5. The parent file remains fully usable. Only the specific variant is unavailable.
6. The `GET /api/v1/files/:id/variants/:kind` endpoint returns HTTP 500 with `FILE_VARIANT_FAILED` and the error message.
7. `platform_admin` can retry variant generation manually via an admin endpoint.

### MinIO bucket not found

**Scenario:** A user uploads their first file to a tenant that has never had a file upload before. The tenant's bucket does not exist in MinIO.
**Handling:**

1. The upload handler calls `minioClient.bucketExists(bucketName)` before uploading.
2. If the bucket does not exist, the handler calls `minioClient.makeBucket(bucketName, region)` with the configured region.
3. The handler then sets the bucket policy to private (no public access): `minioClient.setBucketPolicy(bucketName, privatePolicyJson)`.
4. If the bucket creation fails (e.g., MinIO is down), the upload fails with `FILE_UPLOAD_FAILED` and the error is logged.
5. Bucket creation is idempotent: if two concurrent uploads for the same new tenant race to create the bucket, `makeBucket` on the second call returns a "bucket already exists" error which is caught and ignored.
6. Bucket naming convention: `t-{first 12 chars of tenant_id}` (e.g., `t-019526a01000`). This ensures uniqueness and stays within MinIO's 63-character bucket name limit.

### Presigned URL expired before download completes

**Scenario:** A user requests a download URL, but their slow connection means the download is not complete when the 15-minute presigned URL expires.
**Handling:**

1. The MinIO/S3 presigned URL is valid for the entire download as long as the HTTP connection was established before expiry. The download continues even after the URL expires (this is standard S3 behavior for GET requests -- the signature is validated at connection time, not during the transfer).
2. If the user has not started the download before the URL expires (e.g., they copy the URL and paste it later), they receive a 403 from MinIO. The client should catch this and request a new download URL from the File module.
3. The File module does not rate-limit download URL generation beyond standard API rate limits. Requesting a new URL is a lightweight operation (no MinIO call, just HMAC signing).

### File referenced by multiple entities, then deleted

**Scenario:** A file is attached to 3 different messages across 2 channels, then the uploader deletes it.
**Handling:**

1. Soft-delete sets `deleted_at = now()`. The file becomes invisible to all queries (filtered by `deleted_at IS NULL`).
2. `file.deleted.v1` event emitted. Consumer modules (Communication, Document) subscribe to this event.
3. Consumer modules do NOT remove the file UUID from their reference arrays. Instead, when rendering a message with an attachment UUID that resolves to a deleted file (or returns 404), they display a "file deleted" placeholder.
4. This avoids a cascade of writes across multiple tables in multiple modules on file deletion.
5. After the 30-day retention period, the MinIO object is hard-purged by the retention worker. The file metadata row remains in PostgreSQL with `purged_at` set, serving as an audit record.
6. If the file is restored before the retention period expires (future feature), the `deleted_at` is cleared and the file becomes visible again.

### WORM-locked file deletion attempt

**Scenario:** A `tenant_admin` attempts to delete a call recording that is WORM-locked for compliance retention.
**Handling:**

1. The delete handler checks `worm_locked = true AND worm_until > now()`.
2. Returns `FILE_WORM_LOCKED` (HTTP 409) with a message including the lock expiry date.
3. Even `platform_admin` cannot delete a WORM-locked file before `worm_until`. This is a compliance requirement for audit-grade files.
4. WORM lock can only be extended, never shortened. `platform_admin` can update `worm_until` to a later date but never an earlier one.
5. After `worm_until` passes, the file can be deleted normally through the soft-delete flow.

### Large file upload via presigned URL with network issues

**Scenario:** A user uploads a 400 MB call recording via presigned URL. The upload succeeds on MinIO but the `POST /api/v1/files/confirm` call fails due to a network blip.
**Handling:**

1. The MinIO object exists but the `file.files` row has `confirmed = false`.
2. The client retries the confirm request. The handler is idempotent: it re-validates the MinIO object and completes the confirmation.
3. If the client never retries, the `file-cleanup-unconfirmed` cron job deletes the `file.files` row after 24 hours. The corresponding MinIO object is orphaned.
4. A separate MinIO lifecycle policy deletes objects in tenant buckets that are not referenced by any `file.files` row. This runs weekly as a reconciliation job (application-level, not MinIO-native) to catch any orphaned objects.
