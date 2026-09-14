# IOS_SHORTCUT_SPEC.md
# Finn — iPhone Slip Shortcut

> Target: iPhone 11 Pro Max
> Goal: Share a banking slip to Finn with as few actions as possible.
> Security: scoped/revocable `slip:ingest` token only.

## 1. User Experience

Target flow:

```text
Banking app / Photos / Files
→ Share
→ บันทึกสลิปใน Finn
→ notification
```

Normal successful use should require no manual amount entry.

## 2. Shortcut Name

Recommended:

```text
บันทึกสลิปใน Finn
```

Short Share Sheet label may simply be:

```text
Finn
```

## 3. Input

Shortcut receives:

```text
Images
Files
```

If run manually without input, optionally use `Select Photos`.

## 4. Initial Setup

In Finn:

```text
ตั้งค่า
→ Automation / iPhone Shortcut
→ สร้าง Ingest Token
```

Label token:

```text
iPhone 11 Pro Max
```

Finn shows the raw token once.

Warning:

```text
อย่าแชร์ Shortcut ที่ฝัง Token นี้ให้ผู้อื่น
หากอุปกรณ์หายหรือ Token รั่ว ให้ยกเลิก Token ทันที
```

## 5. Shortcut Variables

Use:

```text
FINN_API_URL
FINN_INGEST_TOKEN
```

Never put token in URL.

Use Authorization header.

## 6. Recommended Action Sequence

```text
1. Receive Images and Files from Share Sheet
2. If no Shortcut Input → Select Photos
3. Repeat with each item
4. Prepare image if needed
5. Get Contents of URL
6. Read JSON response
7. Show Notification
8. If needs_review → optionally Open URL
```

## 7. Image Preparation

If JPEG/PNG/WebP and within server size limit, send original.

If HEIC is unsupported by server:

```text
Convert Image → JPEG
Quality: High (~95%)
```

Do not aggressively resize because QR/OCR quality may degrade.

## 8. Request

URL:

```text
{FINN_API_URL}/api/ingest/slip
```

Method:

```text
POST
```

Headers:

```text
Authorization: Bearer {FINN_INGEST_TOKEN}
Accept: application/json
```

Body:

```text
multipart/form-data
file   = prepared image
source = ios_shortcut
```

Optional:

```text
client_id = iphone-11-pro-max
```

## 9. Idempotency

If Shortcuts can generate a UUID cleanly, send:

```text
Idempotency-Key: <UUID>
```

If not, server-side file hash/reference detection remains mandatory.

## 10. Response Statuses

```text
created
needs_review
duplicate
processing
failed
```

## 11. `created`

Show privacy-safe notification:

```text
Finn
บันทึกรายการ ฿189 แล้ว
```

Do not display account number/reference on lock screen.

## 12. `needs_review`

Show:

```text
Finn
มีรายการที่ต้องตรวจสอบ
```

Then optionally ask:

```text
เปิดตรวจสอบตอนนี้ไหม?
```

If yes, open:

```text
{FINN_API_URL}{reviewUrl}
```

## 13. `duplicate`

Show:

```text
Finn
สลิปนี้ถูกบันทึกแล้ว
```

Do not retry automatically.

## 14. `processing`

Show:

```text
Finn
รับสลิปแล้ว กำลังประมวลผล
```

Do not create a tight polling loop in MVP.

## 15. `failed`

Show:

```text
Finn
อ่านสลิปไม่สำเร็จ
เปิด Finn เพื่อตรวจสอบหรือกรอกเอง
```

## 16. Multiple Images

Support repeating through multiple shared images.

Recommended max per Shortcut run:

```text
5
```

For more, ask user to split into batches.

## 17. Security Model

The Shortcut locally contains an ingest token.

That token is acceptable for personal-use MVP because it is:

- random
- revocable
- scoped only to slip upload
- unable to read finance history
- not a bank credential
- not a Supabase admin/service key

Risk:

> Anyone who obtains the configured Shortcut/token may submit slips to that Finn account until revoked.

Mitigation:

- do not share configured Shortcut
- revoke on lost device
- rate limit
- optional expiry
- show last-used timestamp in Finn

## 18. Lost Device

In Finn:

```text
ตั้งค่า
→ Automation
→ iPhone 11 Pro Max
→ ยกเลิก Token
```

Revocation must take effect immediately.

## 19. Token Rotation

A simple rotation flow is enough:

```text
revoke old → create new → update Shortcut
```

No automatic rotation is required in Phase 2.

## 20. Setup Guide Route

Recommended:

```text
/settings/automation/ios
```

Show setup steps:

```text
1. สร้าง Ingest Token
2. เปิด Shortcuts
3. สร้าง Shortcut ใหม่
4. เปิดรับ Images/Files จาก Share Sheet
5. เพิ่ม Get Contents of URL
6. ใส่ Finn API URL
7. ใส่ Authorization header
8. Request Body = Form
9. ใส่ file + source
10. เพิ่ม Show Notification
11. ตั้งชื่อ “บันทึกสลิปใน Finn”
```

## 21. Future Installable Template

A future shareable Shortcut template must contain **no real token**.

User imports template and adds their own token.

## 22. Error Handling

Network error:

```text
เชื่อมต่อ Finn ไม่สำเร็จ
ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง
```

401/403:

```text
Finn Token ใช้งานไม่ได้
กรุณาสร้าง Token ใหม่ในตั้งค่า
```

413:

```text
ไฟล์สลิปใหญ่เกินไป
ลองใช้ภาพขนาดเล็กลง
```

429:

```text
ส่งรายการเร็วเกินไป
รอสักครู่แล้วลองใหม่
```

## 23. Development Note

An iPhone cannot access computer `localhost` as its own Finn server.

For device testing use one of:

- computer LAN IP with firewall/network configured
- secure development tunnel
- deployed test environment

Production must use HTTPS.

## 24. Stable Contract

Shortcut depends only on:

```text
POST /api/ingest/slip
Authorization: Bearer <token>
multipart file
```

Do not couple Shortcut directly to Supabase tables.

## 25. Manual Test Checklist

On iPhone 11 Pro Max:

```text
[ ] Banking app → Share → Finn
[ ] Photos → Share → Finn
[ ] Screenshot → Share → Finn
[ ] Duplicate slip
[ ] Blurred image
[ ] No internet
[ ] Revoked token
[ ] Multiple images
[ ] Needs-review deep link
[ ] Light/Dark web review page
```

## 26. Definition of Done

Complete when:

- token creation/revocation works
- Shortcut uploads a test slip
- no bank credentials involved
- token never appears in URL
- duplicate slip does not duplicate transaction
- notifications are privacy-safe
- review deep link works
- revoked token is rejected
- deployed endpoint uses HTTPS
- normal flow is effectively Share → Finn → notification

## 27. Final Principle

The Shortcut is not a login token and not a banking credential.

Its authority should be intentionally narrow:

> Upload a slip for this user. Nothing more.
