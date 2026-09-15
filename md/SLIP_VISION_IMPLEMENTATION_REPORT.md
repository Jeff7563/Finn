# FINN — Real Bank Slip OCR & Vision Extraction Report

**Date**: 2026-09-15  
**Release Target**: Production Hardening  
**Scope**: Real Thai Bank Slip Extraction, Vision AI Provider Integration, Normalization, QR Verification Separation, Review Inbox UI & Reprocessing  

---

## 1. Executive Summary

In previous builds, slips ingested via the iPhone Share Sheet Shortcut reached private storage and the Review Inbox, but extracted zero-value placeholders (`amount: 0.00`, `sender: unknown`, `receiver: unknown`, missing date) because `src/lib/slip/ocr/ai-vision-parser.ts` was an unconfigured stub. Furthermore, the Review Inbox UI fell back to `overall_confidence || 0.8`, misleadingly claiming "ความมั่นใจ 80%" when confidence had never been evaluated, and permitted users to confirm incomplete transactions.

This release delivers **production-grade real Thai bank slip extraction**, multi-provider Vision LLM integration (Google Gemini Vision primary with OpenAI Vision fallback), strict Buddhist Era (พ.ศ.) date normalization, amount/fee safety rules, QR verification separation, and Review Inbox hardening with in-place slip reprocessing.

---

## 2. Architecture & Vision Provider Integration

### 2.1 Multi-Provider Server-Side Pipeline (`AiVisionSlipParser`)
The system integrates server-side Vision APIs with zero client-side credential exposure:

```
                          ┌───────────────────────────┐
                          │   Real Thai Bank Slip     │
                          └─────────────┬─────────────┘
                                        │
                                        ▼
                          ┌───────────────────────────┐
                          │   validateSlipFile()      │
                          │   (JPEG / PNG / WebP)     │
                          └─────────────┬─────────────┘
                                        │
                         ┌──────────────┴──────────────┐
                         ▼                             ▼
               ┌───────────────────┐         ┌───────────────────┐
               │    QR Decoder     │         │ Vision AI Parser  │
               │  (Decoder/Parser) │         │ (Gemini / OpenAI) │
               └─────────┬─────────┘         └─────────┬─────────┘
                         │                             │
                         │   QR vs Vision Cross-Check  │
                         └──────────────┬──────────────┘
                                        │
                                        ▼
                          ┌───────────────────────────┐
                          │   ThaiSlipNormalizer      │
                          │   (BE Date, THB, Banks)   │
                          └─────────────┬─────────────┘
                                        │
                                        ▼
                          ┌───────────────────────────┐
                          │    Confidence Engine      │
                          └─────────────┬─────────────┘
                                        │
                         ┌──────────────┴──────────────┐
                         ▼                             ▼
               ┌───────────────────┐         ┌───────────────────┐
               │   Auto-Created    │         │   Review Inbox    │
               │ (≥98% confidence) │         │  (Needs Review)   │
               └───────────────────┘         └───────────────────┘
```

1. **Google Gemini Vision (`GEMINI_API_KEY`)**:
   - Primary model: `gemini-2.0-flash` (with automated fallback to `gemini-1.5-flash`).
   - Direct REST API communication without heavyweight external SDK dependencies.
   - Structured JSON response generation (`response_mime_type: "application/json"`, temperature 0.1).
2. **OpenAI Vision (`OPENAI_API_KEY`)**:
   - Secondary / fallback model: `gpt-4o-mini` (configurable via `OPENAI_VISION_MODEL`).
   - JSON mode structured extraction (`response_format: { type: "json_object" }`).
3. **Graceful Degradation**:
   - If neither provider key is configured (e.g. offline testing), throws `PROVIDER_NOT_CONFIGURED` without crashing or fabricating mock data.
4. **Privacy Boundaries**:
   - Only raw slip image bytes are transmitted to the Vision API. User credentials, session tokens, and transaction history are never included.

---

## 3. Thai Banking Domain Normalization (`thai-slip-normalizer.ts`)

Real Thai banking slips present unique domain challenges that are now deterministically normalized:

### 3.1 Buddhist Era (พ.ศ.) to Gregorian (ค.ศ.) Normalization
- **4-Digit BE Years**: Years in range `2400..2700` subtract `543` (e.g., `2569` $\rightarrow$ `2026`, `2568` $\rightarrow$ `2025`, `2567` $\rightarrow$ `2024`).
- **2-Digit Thai Years**: Years in range `43..99` map to `2500 + yy - 543` (e.g., `69` $\rightarrow$ `2026`).
- **Thai Month Names & Abbreviations**: Both abbreviated (`ม.ค.`, `ก.พ.`, `ก.ย.`, `ธ.ค.`) and full Thai names (`มกราคม`, `กันยายน`) are parsed into ISO 8601 month indices.
- **Timezone**: Formatted with Asia/Bangkok time offset (`+07:00`) and validated as UTC ISO timestamps.

### 3.2 Principal Amount vs Transfer Fee Safety
- Strips commas, currency tokens (`บาท`, `THB`, `฿`), and decimal shorthand (`18.-` $\rightarrow$ `18.00`).
- Strictly extracts the **transferred principal amount** (`จำนวนเงิน`, `โอนเงิน`, `Amount`).
- Filters out fee lines (`ค่าธรรมเนียม: 0.00 บาท`), account balances, and negative/zero values.
- Never guesses: If the amount is obscured or unreadable, `amount` remains `undefined` with confidence `0.0`.

### 3.3 Modern Thai Banking App Canonicalization (`bank-normalization.ts`)
Updated canonical bank mapping to recognize modern banking channels:
- **KBank**: Added `MAKE by KBank`, `makebykbank`, `make`, `K+`, `K PLUS` $\rightarrow$ `KBANK`.
- **SCB**: `SCB EASY`, `scbeasy` $\rightarrow$ `SCB`.
- **Krungthai**: `Krungthai NEXT`, `next`, `เป๋าตัง` $\rightarrow$ `KTB`.
- **PromptPay**: `พร้อมเพย์`, `PromptPay` $\rightarrow$ `PROMPTPAY`.

---

## 4. QR Verification vs EMVCo Merchant Separation

### 4.1 The Slip Verification QR Problem
Thai bank transfer slips print a QR code intended for slip verification (BOT / ITMX SlipVerify standard or bank deep links). These verification QRs **do not** encode EMVCo Tag 54 amounts. In contrast, EMVCo Tag 54 is only present on merchant payment presentation QRs.

### 4.2 Separation & Cross-Check Rules
1. **Verification URLs** (e.g. `https://promptpay.scb/verify?ref=...`):
   - Extracts reference from URL parameters or path.
   - Sets `channel: "QR Slip Verification URL"`.
   - `amount` remains strictly `undefined`.
2. **BOT / ITMX PromptPay SlipVerify Mini-QRs** (e.g. `004600060000010103...`):
   - Extracts sending bank AID (`000001`), bank code (subtag `01`), and transaction reference (subtag `02`).
   - Sets `channel: "PromptPay Mini-QR"`.
   - `amount` remains strictly `undefined`.
3. **EMVCo Merchant QRs** (starts with `000201`):
   - Only extracts `amount` when Tag 54 is explicitly present, numeric, and positive.
4. **QR vs Vision Amount Cross-Check**:
   - If both QR amount and Vision amount exist and differ by $> 0.01$ THB:
     - Mismatch flagged immediately.
     - Amount confidence drops to `0.4`.
     - Slip is forcibly routed to `needs_review` with explanation: `"จำนวนเงินจาก QR Code และภาพสลิปไม่ตรงกัน"`.
   - If amounts match: amount confidence is corroborated to `0.99`.

---

## 5. Review Inbox UI Hardening (`ReviewInboxClient.tsx`)

### 5.1 Removed Erroneous Confidence Fallback
- **Before**: `(slip.overall_confidence || 0.8) * 100` resulted in displaying "ความมั่นใจ 80%" on completely unparsed or newly ingested slips.
- **After**:
  - When `slip.overall_confidence != null`: Displays `ความมั่นใจ XX%` with `ShieldCheck`.
  - When `slip.overall_confidence == null`: Displays `ยังไม่ประเมิน` with `ShieldAlert`.

### 5.2 Incomplete Data Warning & Confirm Button Safety
- When `amount` is invalid or $\le 0$:
  - Prominently displays badge: **"อ่านข้อมูลสลิปไม่ครบ"** (`AlertCircle`).
  - Disables the **"ยืนยันรายการ"** button (`disabled={isActing || !isAmountValid}`).
  - Tooltip / helper note: `* ข้อมูลสลิปยังไม่สมบูรณ์ (จำนวนเงินไม่ถูกต้อง) กรุณากด "แก้ไข" เพื่อระบุจำนวนเงิน หรือกด "ประมวลผลใหม่"`.

### 5.3 In-Place Slip Reprocessing ("ประมวลผลใหม่")
- Added **"ประมวลผลใหม่"** button (`RefreshCw`) with loading spinner on eligible `needs_review` slips.
- Triggers `reprocessSlipAction(slip.id)`.
- Re-reads private storage buffer, re-runs Vision parser, updates slip record and confidence, and updates client UI in-place without page refresh.

---

## 6. Verification & Quality Gates

All 5 core verification suites passed with zero regressions:

| Step | Command | Result | Notes |
|---|---|---|---|
| 1 | `npm run lint` | **PASS (0 warnings, 0 errors)** | ESLint verified across all components and libraries |
| 2 | `npm run typecheck` | **PASS (0 errors)** | TypeScript strict type checking passed |
| 3 | `npm test` | **PASS (149 tests)** | 13 test files (all 149 Vitest unit & domain tests passed) |
| 4 | `npm run build` | **PASS (code 0)** | Next.js 15.5 production build and route optimization succeeded |
| 5 | `npx playwright test` | **PASS (76 tests)** | Desktop Chrome and mobile (iPhone 11 Pro Max: 414x896) suites |

---

## 7. Modified & Created Files

- [`src/lib/slip/ocr/ai-vision-parser.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/slip/ocr/ai-vision-parser.ts): Production Gemini Vision REST integration with OpenAI Vision fallback and strict safety gating.
- [`src/lib/slip/ocr/thai-slip-normalizer.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/slip/ocr/thai-slip-normalizer.ts): Thai BE date, month abbreviations, amount sanitization, and party name normalizers.
- [`src/lib/slip/qr/parser.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/slip/qr/parser.ts): Separation of verification URLs/Mini-QRs from EMVCo merchant payments.
- [`src/lib/slip/bank-normalization.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/slip/bank-normalization.ts): Modern bank alias updates including MAKE by KBank.
- [`src/lib/slip/processor.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/slip/processor.ts): QR vs Vision corroboration, mismatch handling, and `reprocessSlip` pipeline.
- [`src/app/actions/slip-review.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/app/actions/slip-review.ts): Added `reprocessSlipAction` Server Action with private buffer access and ownership checks.
- [`src/components/slips/ReviewInboxClient.tsx`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/components/slips/ReviewInboxClient.tsx): Hardened confidence display, missing data warnings, disabled confirm, and reprocess button.
- [`tests/slip/slip-vision.test.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/tests/slip/slip-vision.test.ts): 25 comprehensive tests for vision extraction, normalization, and safety rules.
