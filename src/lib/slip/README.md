# Slip Intelligence Module (Phase 2)

This directory is reserved for Phase 2 implementation of slip ingestion, optical character recognition, QR verification, and automated transaction extraction.

## Planned Architecture:
- `qr-decoder.ts`: Bank transfer slip QR decoding (PromptPay / Thai QR payment verification)
- `ocr-engine.ts`: Multi-line text extraction from slip images
- `parser.ts`: Deterministic parsing of bank, date, sender, receiver, amounts, and reference codes
- `duplicate-detector.ts`: Hash and perceptual comparison to prevent duplicate entries
- `confidence.ts`: Multi-factor confidence scoring (> 0.95 auto-save, 0.70-0.95 pending review, < 0.70 confirm)
