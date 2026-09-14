# IOS_SHORTCUT_BUILD_GUIDE.md
# Finn — Build “บันทึกสลิปใน Finn” on iPhone

> Device: iPhone 11 Pro Max
> App: Apple Shortcuts
> Purpose: Share a bank slip directly into Finn
> Authentication: Finn scoped ingest token

---

## 1. Before You Start

You need:

```text
1. Finn deployed with HTTPS
2. Phase 2 migration applied
3. Finn Ingest Token
4. Finn API base URL
```

Example:

```text
https://finn.example.com
```

Do NOT use:

```text
http://localhost:3000
```

from the iPhone.

---

## 2. Create the Finn Token

In Finn:

```text
ตั้งค่า
→ Automation / iPhone Shortcut
→ สร้าง Ingest Token
```

Label:

```text
iPhone 11 Pro Max
```

Copy the token.

It should look conceptually like:

```text
finn_ingest_********************************
```

Do not send this token to anyone.

---

## 3. Create Shortcut

Open:

```text
Shortcuts
```

Tap:

```text
+
```

Name:

```text
บันทึกสลิปใน Finn
```

---

## 4. Enable Share Sheet

Open Shortcut details/settings.

Enable:

```text
Show in Share Sheet
```

Accepted input:

```text
Images
Files
```

Recommended:
- disable unrelated content types

---

## 5. Handle Missing Share Input

Add action:

```text
If
```

Condition:

```text
Shortcut Input
does not have any value
```

Inside:

```text
Select Photos
```

Select:
- one or multiple if desired

Otherwise:
- use Shortcut Input

The resulting image/file becomes the upload input.

---

## 6. Optional HEIC Conversion

If Finn server does not support HEIC:

Add:

```text
Convert Image
```

Format:

```text
JPEG
```

Quality:

```text
High
```

If the server already supports the input type safely, skip this step.

---

## 7. Add API Request

Add action:

```text
Get Contents of URL
```

URL:

```text
https://YOUR-FINN-DOMAIN/api/ingest/slip
```

Method:

```text
POST
```

---

## 8. Add Headers

Header:

```text
Authorization
```

Value:

```text
Bearer YOUR_FINN_INGEST_TOKEN
```

Header:

```text
Accept
```

Value:

```text
application/json
```

Important:

Do not append the token to the URL.

Wrong:

```text
/api/ingest/slip?token=...
```

Correct:

```text
Authorization: Bearer ...
```

---

## 9. Configure Request Body

Choose:

```text
Form
```

Add:

```text
file
```

Type/value:

```text
File / prepared image
```

Add:

```text
source
```

Value:

```text
ios_shortcut
```

Optional:

```text
client_id
```

Value:

```text
iphone-11-pro-max
```

---

## 10. Multiple Images

If Share Sheet may send multiple files:

Wrap upload request in:

```text
Repeat with Each
```

Use:

```text
Repeat Item
```

as `file`.

Recommended maximum per run:

```text
5
```

For initial testing, start with exactly one slip.

---

## 11. Read API Response

The response is JSON.

Expected:

```text
status
amount
currency
jobId
transactionId
reviewUrl
```

Add:

```text
Get Dictionary Value
```

Key:

```text
status
```

---

## 12. Handle `created`

Add an If:

```text
If status is created
```

Get:

```text
amount
```

Show Notification:

```text
Finn
บันทึกรายการ ฿[amount] แล้ว
```

For privacy, do not show:
- account number
- reference
- full sender/receiver name

---

## 13. Handle `needs_review`

Else If:

```text
status is needs_review
```

Show Notification:

```text
Finn
มีรายการที่ต้องตรวจสอบ
```

Get:

```text
reviewUrl
```

Optional:

```text
Choose from Menu
เปิดตรวจสอบตอนนี้
ไว้ทีหลัง
```

If Open:

```text
Open URLs
https://YOUR-FINN-DOMAIN[reviewUrl]
```

---

## 14. Handle `duplicate`

Else If:

```text
status is duplicate
```

Show Notification:

```text
Finn
สลิปนี้ถูกบันทึกแล้ว
```

Do not retry.

---

## 15. Handle `processing`

Else If:

```text
status is processing
```

Show:

```text
Finn
รับสลิปแล้ว กำลังประมวลผล
```

Do not create a fast polling loop.

---

## 16. Handle Failure

Otherwise:

```text
Finn
อ่านสลิปไม่สำเร็จ
เปิด Finn เพื่อตรวจสอบ
```

Optional:

```text
Open URLs
https://YOUR-FINN-DOMAIN/review
```

---

## 17. HTTP Authentication Error

If the request fails with 401/403:

Expected message:

```text
Finn Token ใช้งานไม่ได้
กรุณาสร้าง Token ใหม่ใน Finn
```

Then:

```text
Stop This Shortcut
```

---

## 18. File Too Large

If server returns 413:

```text
ไฟล์สลิปใหญ่เกินไป
ลองใช้ภาพขนาดเล็กลง
```

If this happens frequently, add a conditional resize step rather than always reducing image quality.

---

## 19. Rate Limit

For 429:

```text
ส่งรายการเร็วเกินไป
รอสักครู่แล้วลองใหม่
```

Do not automatically hammer retry.

---

## 20. Test the Shortcut

First test from Photos:

```text
Photos
→ Select test slip
→ Share
→ บันทึกสลิปใน Finn
```

Expected:

```text
notification
```

Then open Finn:

```text
Transactions / Review
```

Verify the result.

---

## 21. Test from Banking App

After Photos test passes:

```text
Bank app
→ completed transfer
→ Share slip
→ บันทึกสลิปใน Finn
```

Do one low-value transaction first.

Verify everything before normal use.

---

## 22. Shortcut Security

The configured Shortcut contains the ingest token.

Do NOT:

```text
Share the configured Shortcut
Post screenshots showing token
Paste token into public chat/repo
Use service-role key
```

If device is lost:

```text
Finn
→ Settings
→ Automation
→ revoke iPhone token
```

---

## 23. Changing Finn Domain

If your deployment URL changes:

Update only:

```text
FINN_API_URL / Get Contents of URL
```

The Shortcut should not know anything about Supabase internals.

---

## 24. Recommended Final Flow

The finished Shortcut should conceptually be:

```text
Receive Share Sheet Input
↓
If none → Select Photos
↓
Repeat Each Image
↓
Optional Convert to JPEG
↓
POST /api/ingest/slip
  Authorization: Bearer token
  file: image
  source: ios_shortcut
↓
Read `status`
↓
created       → notification
needs_review  → notification + optional Open Finn
duplicate     → notification
processing    → notification
failed        → notification
```

---

## 25. Real Test Checklist

```text
[ ] Photos share works
[ ] Banking app share works
[ ] amount correct
[ ] outgoing classification correct
[ ] transfer classification correct
[ ] incoming goes to Review
[ ] duplicate blocked
[ ] revoked token rejected
[ ] no token in URL
[ ] HTTPS used
```

---

## 26. Final Goal

Normal daily flow should become:

```text
จ่ายเงิน
↓
ได้สลิป
↓
Share
↓
Finn
↓
เสร็จ
```

Manual entry remains fallback only.
