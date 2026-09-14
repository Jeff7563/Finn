# Finn — Private Storage & Future Slip Security Specification

> Status: Architecture specification for Phase 2 implementation  
> Scope: Storage bucket configuration, authorization, upload validation, and AI/OCR privacy.

---

## 1. Storage Buckets Architecture

All document and slip storage in Finn must be **PRIVATE**. Public buckets are strictly forbidden.

| Bucket Name | Privacy Level | Allowed MIME Types | Max Size | Path Schema |
| :--- | :--- | :--- | :--- | :--- |
| `slips` | **Private** | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` | 10 MB | `slips/{user_id}/{uuid}.{ext}` |
| `documents` | **Private** | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` | 15 MB | `documents/{user_id}/{uuid}.{ext}` |

---

## 2. Storage Row Level Security (RLS)

Storage objects must enforce ownership based on the first path segment matching `auth.uid()`:

```sql
-- Enable RLS on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- 1. SELECT: Users can only read their own slips
CREATE POLICY "Users can access own slips"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'slips' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

-- 2. INSERT: Users can only upload into their own folder
CREATE POLICY "Users can upload own slips"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'slips' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

-- 3. DELETE: Users can only delete their own slips
CREATE POLICY "Users can delete own slips"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'slips' AND
    (storage.foldername(name))[1] = auth.uid()::text
);
```

---

## 3. Signed URLs Protocol

* Documents and slip images must **NEVER** have permanent public URLs.
* When viewing a slip preview in the web UI, the backend generates a short-lived **Signed URL**:
  * **TTL (Time-To-Live)**: 5 to 15 minutes max.
  * Signed URLs must **NEVER** be stored in the database as transaction links. Only the canonical object path (`slips/{user_id}/{uuid}.jpg`) may be stored in `transactions.source_slip_id` or similar metadata.

---

## 4. File Upload & Ingestion Hardening

Before writing files to Supabase Storage:
1. **Authentication Verification**: Request must originate from an authenticated user.
2. **Magic Byte Inspection**: Do not rely on client `Content-Type` header alone; inspect file header bytes (e.g. `FF D8 FF` for JPEG, `89 50 4E 47` for PNG, `25 50 44 46` for PDF).
3. **Randomized File Names**: File paths must use random UUIDs (`crypto.randomUUID()`), never filenames containing account numbers, names, or amounts.
4. **Metadata Stripping**: Strip sensitive EXIF / GPS metadata prior to saving images.

---

## 5. OCR & AI Processing Privacy

1. **Minimization**: When sending parsed slip text to AI models, extract and transmit only transaction-relevant fields (amount, timestamp, merchant). Never send banking credentials (PINs, passwords).
2. **Zero Training**: Ensure commercial agreement with AI API providers guarantees zero data retention and zero training on customer financial slips.
3. **User Opt-Out**: Provide a toggle in Settings allowing users to disable AI-assisted OCR if preferred.
