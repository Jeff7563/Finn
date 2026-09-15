import { DataStore } from "@/lib/server/data-store";
import {
  SlipProcessingResult,
  SlipSource,
  SlipExtraction,
  Slip,
  SlipIngestionJob,
} from "@/types/slip";
import {
  validateSlipFile,
  computeFileSha256,
  generateSlipStoragePath,
} from "./validation";
import { DefaultQrDecoder, QrDecoder } from "./qr/decoder";
import { parseSlipQrPayload } from "./qr/parser";
import { CompositeSlipParser, VisionSlipParser } from "./ocr";
import { normalizeBankName } from "./bank-normalization";
import { matchOwnedAccount } from "./account-match";
import { matchCounterparty } from "./counterparty-match";
import { suggestCategory } from "./category-suggest";
import { detectDuplicate } from "./duplicate";
import { classifyDirection } from "./direction";
import { evaluateConfidence } from "./confidence";

export interface ProcessSlipOptions {
  userId: string;
  buffer: Buffer;
  source?: SlipSource;
  idempotencyKey?: string | null;
  clientId?: string | null;
  qrDecoder?: QrDecoder;
  visionParser?: VisionSlipParser;
}

export interface ReprocessSlipOptions {
  userId: string;
  slipId: string;
  buffer: Buffer;
}

export class SlipProcessor {
  private qrDecoder: QrDecoder;
  private visionParser: VisionSlipParser;

  constructor(options?: { qrDecoder?: QrDecoder; visionParser?: VisionSlipParser }) {
    this.qrDecoder = options?.qrDecoder || new DefaultQrDecoder();
    this.visionParser = options?.visionParser || new CompositeSlipParser();
  }

  async processSlip(options: ProcessSlipOptions): Promise<SlipProcessingResult> {
    const { userId, buffer, source = "web_upload" } = options;
    // 1. File Validation
    const validation = validateSlipFile(buffer);
    if (!validation.valid || !validation.mime) {
      return {
        jobId: "none",
        slipId: "none",
        status: "failed",
        currency: "THB",
        errorCode: validation.errorCode || "INVALID_FILE",
        errorMessage: validation.error || "Invalid file",
      };
    }

    // 2. Exact Duplicate Check via SHA-256
    const fileHash = computeFileSha256(buffer);
    const existingDuplicate = await DataStore.getSlipByFileHash(userId, fileHash);

    if (existingDuplicate) {
      // Create a duplicate ingestion job record for audit trail
      const job = await DataStore.createSlipJob(userId, {
        slip_id: existingDuplicate.id,
        status: "duplicate",
        finished_at: new Date().toISOString(),
      });

      return {
        jobId: job.id,
        slipId: existingDuplicate.id,
        status: "duplicate",
        currency: "THB",
        amount: existingDuplicate.extracted_json?.amount,
        reviewUrl: `/review?slipId=${existingDuplicate.id}`,
        duplicateOfSlipId: existingDuplicate.id,
        transactionId: existingDuplicate.linked_transaction_id || undefined,
        errorMessage: "สลิปนี้ถูกบันทึกแล้ว (Duplicate file)",
      };
    }

    // 3. Save Privately to Storage
    const storagePath = generateSlipStoragePath(userId, validation.extension || "jpg");
    await DataStore.saveSlipFile(storagePath, buffer);

    // 4. Create Slip Record
    const slip = await DataStore.createSlip(userId, {
      storage_path: storagePath,
      file_hash_sha256: fileHash,
      mime_type: validation.mime,
      file_size: buffer.length,
      source,
      status: "processing",
    });

    // 5. Create Job Record
    const job = await DataStore.createSlipJob(userId, {
      slip_id: slip.id,
      status: "processing",
    });

    return this.executePipeline({
      userId,
      slip,
      job,
      buffer,
      mime: validation.mime,
      fileHash,
      source,
    });
  }

  /**
   * Reprocesses an existing slip record (e.g. from Review Inbox).
   */
  async reprocessSlip(options: ReprocessSlipOptions): Promise<SlipProcessingResult> {
    const { userId, slipId, buffer } = options;

    const slip = await DataStore.getSlipById(userId, slipId);
    if (!slip) {
      return {
        jobId: "none",
        slipId,
        status: "failed",
        currency: "THB",
        errorMessage: "ไม่พบข้อมูลสลิปที่ต้องการประมวลผล",
      };
    }

    const validation = validateSlipFile(buffer);
    if (!validation.valid || !validation.mime) {
      return {
        jobId: "none",
        slipId,
        status: "failed",
        currency: "THB",
        errorCode: validation.errorCode || "INVALID_FILE",
        errorMessage: validation.error || "ไฟล์สลิปไม่ถูกต้อง",
      };
    }

    const job = await DataStore.createSlipJob(userId, {
      slip_id: slip.id,
      status: "processing",
    });

    return this.executePipeline({
      userId,
      slip,
      job,
      buffer,
      mime: validation.mime,
      fileHash: slip.file_hash_sha256,
      source: slip.source,
    });
  }

  /**
   * Core extraction and classification pipeline shared by processSlip and reprocessSlip.
   */
  private async executePipeline(params: {
    userId: string;
    slip: Slip;
    job: SlipIngestionJob;
    buffer: Buffer;
    mime: string;
    fileHash: string;
    source: SlipSource;
  }): Promise<SlipProcessingResult> {
    const { userId, slip, job, buffer, mime, fileHash, source } = params;

    try {
      // 6. QR Code Decoding
      let qrPayload: string | null = null;
      try {
        qrPayload = await this.qrDecoder.decode(buffer);
      } catch {
        // QR failure is non-fatal; continue to OCR/Vision
      }

      // 7. OCR / Vision Extraction
      let extraction: SlipExtraction;
      try {
        extraction = await this.visionParser.parse({
          imageBuffer: buffer,
          mimeType: mime,
          qrPayload,
        });
      } catch (err: unknown) {
        // Safe error handling for unconfigured providers or unreadable slips
        const safeError = err instanceof Error ? err.message : "Slip extraction failed";
        await DataStore.updateSlip(userId, slip.id, {
          status: "needs_review",
        });
        await DataStore.updateSlipJob(userId, job.id, {
          status: "needs_review",
          safe_error_message: safeError,
          finished_at: new Date().toISOString(),
        });

        return {
          jobId: job.id,
          slipId: slip.id,
          status: "needs_review",
          currency: "THB",
          reviewUrl: `/review?slipId=${slip.id}`,
          errorMessage: safeError,
        };
      }

      // 7b. QR and Vision Cross-Check & Corroboration
      let qrMismatch = false;
      if (qrPayload) {
        const qrParsed = parseSlipQrPayload(qrPayload);
        if (qrParsed?.amount != null && extraction.amount != null) {
          if (Math.abs(qrParsed.amount - extraction.amount) > 0.01) {
            qrMismatch = true;
            extraction.fieldConfidence.amount = Math.min(
              extraction.fieldConfidence.amount || 0.5,
              0.4
            );
          } else {
            extraction.fieldConfidence.amount = 0.99;
          }
        } else if (extraction.amount == null && qrParsed?.amount != null) {
          extraction.amount = qrParsed.amount;
          extraction.fieldConfidence.amount = qrParsed.fieldConfidence?.amount || 0.95;
        }

        if (qrParsed?.reference && !extraction.reference) {
          extraction.reference = qrParsed.reference;
          extraction.fieldConfidence.reference = qrParsed.fieldConfidence?.reference || 0.95;
        }
      }

      // 8. Bank Normalization
      const normalizedSenderBank = normalizeBankName(extraction.sender?.bank);
      const normalizedReceiverBank = normalizeBankName(extraction.receiver?.bank);

      // 9. Match User Owned Accounts
      const ownedAccounts = await DataStore.getAccounts(userId);
      const senderMatch = matchOwnedAccount(
        {
          ...extraction.sender,
          bank: normalizedSenderBank || extraction.sender?.bank,
        },
        ownedAccounts
      );

      const receiverMatch = matchOwnedAccount(
        {
          ...extraction.receiver,
          bank: normalizedReceiverBank || extraction.receiver?.bank,
        },
        ownedAccounts
      );

      // 10. Direction & Suggested Transaction Type
      const directionClass = classifyDirection(
        senderMatch.accountId,
        receiverMatch.accountId
      );

      // 11. Match Counterparty
      const merchants = await DataStore.getMerchants(userId);
      const people = await DataStore.getPeople(userId);
      const counterpartyName =
        directionClass.direction === "outgoing"
          ? extraction.receiver?.name
          : extraction.sender?.name;
      const counterpartyMatch = matchCounterparty(
        counterpartyName,
        merchants,
        people
      );

      // 12. Suggest Category
      const matchedMerchant = counterpartyMatch.merchantId
        ? merchants.find((m) => m.id === counterpartyMatch.merchantId)
        : null;
      const categories = await DataStore.getCategories(userId);
      const userTransactions = await DataStore.getTransactions(userId);
      const categorySuggestion = suggestCategory({
        merchant: matchedMerchant,
        counterpartyName,
        userTransactions,
        categories,
      });

      // 13. Reference Duplicate & Fuzzy Duplicate Detection
      const existingSlips = await DataStore.getSlips(userId);
      const duplicateResult = detectDuplicate({
        userId,
        fileHash,
        currentSlipId: slip.id,
        referenceNumber: extraction.reference,
        amount: extraction.amount,
        transactionDate: extraction.transactionDate,
        accountId: senderMatch.accountId || receiverMatch.accountId,
        direction: directionClass.direction,
        existingSlips,
        existingTransactions: userTransactions,
      });

      if (duplicateResult.isDuplicate) {
        await DataStore.updateSlip(userId, slip.id, {
          status: "duplicate",
          duplicate_of_slip_id: duplicateResult.matchedSlipId || null,
          linked_transaction_id: duplicateResult.matchedTransactionId || null,
        });
        await DataStore.updateSlipJob(userId, job.id, {
          status: "duplicate",
          finished_at: new Date().toISOString(),
        });

        return {
          jobId: job.id,
          slipId: slip.id,
          status: "duplicate",
          amount: extraction.amount,
          currency: "THB",
          duplicateOfSlipId: duplicateResult.matchedSlipId,
          transactionId: duplicateResult.matchedTransactionId,
          reviewUrl: `/review?slipId=${slip.id}`,
          errorMessage: duplicateResult.reason,
        };
      }

      // 14. Confidence Engine Evaluation
      const confidenceDecision = evaluateConfidence({
        amount: extraction.amount,
        transactionDate: extraction.transactionDate,
        direction: directionClass.direction,
        directionRequiresReview: directionClass.requiresReview || qrMismatch,
        senderAccountId: senderMatch.accountId,
        senderAccountConfidence: senderMatch.confidence,
        receiverAccountId: receiverMatch.accountId,
        receiverAccountConfidence: receiverMatch.confidence,
        fieldConfidence: extraction.fieldConfidence,
        duplicateWarning: duplicateResult.duplicateType === "fuzzy_match",
        duplicateRequiresReview: duplicateResult.requiresReview,
      });

      if (qrMismatch) {
        confidenceDecision.reasons.push(
          "จำนวนเงินจาก QR Code และภาพสลิปไม่ตรงกัน (QR and Vision amount mismatch)"
        );
      }

      // 15. Execution: Auto-Create OR Review Inbox
      if (confidenceDecision.canAutoCreate) {
        // Auto-Create Transaction
        const newTx = await DataStore.createTransaction(userId, {
          type: directionClass.suggestedType,
          amount: extraction.amount!,
          currency: "THB",
          transaction_date: extraction.transactionDate || new Date().toISOString(),
          description: counterpartyMatch.matchedName
            ? `${directionClass.suggestedType === "transfer" ? "โอนเงิน" : "ชำระเงิน"} - ${counterpartyMatch.matchedName}`
            : (counterpartyName ? `โอนให้ ${counterpartyName}` : "บันทึกจากสลิป"),
          from_account_id: senderMatch.accountId,
          to_account_id: receiverMatch.accountId,
          merchant_id: counterpartyMatch.merchantId,
          person_id: counterpartyMatch.personId,
          category_id: categorySuggestion.categoryId,
          source: source === "ios_shortcut" ? "shortcut" : "slip",
          source_slip_id: slip.id,
          reference_number: extraction.reference || null,
          confidence: confidenceDecision.overallConfidence,
          review_status: "confirmed",
        });

        // Link slip and update status
        await DataStore.updateSlip(userId, slip.id, {
          status: "created",
          linked_transaction_id: newTx.id,
          qr_payload: qrPayload,
          extracted_json: extraction,
          overall_confidence: confidenceDecision.overallConfidence,
          parser_version: "v2-vision",
          processed_at: new Date().toISOString(),
        });

        await DataStore.updateSlipJob(userId, job.id, {
          status: "created",
          finished_at: new Date().toISOString(),
        });

        return {
          jobId: job.id,
          slipId: slip.id,
          status: "created",
          amount: extraction.amount,
          currency: "THB",
          transactionId: newTx.id,
          extracted: extraction,
          overallConfidence: confidenceDecision.overallConfidence,
          direction: directionClass.direction,
          matchedFromAccountId: senderMatch.accountId,
          matchedToAccountId: receiverMatch.accountId,
        };
      } else {
        // Send to Review Inbox
        await DataStore.updateSlip(userId, slip.id, {
          status: "needs_review",
          qr_payload: qrPayload,
          extracted_json: extraction,
          overall_confidence: confidenceDecision.overallConfidence,
          parser_version: "v2-vision",
          processed_at: new Date().toISOString(),
        });

        await DataStore.updateSlipJob(userId, job.id, {
          status: "needs_review",
          finished_at: new Date().toISOString(),
        });

        return {
          jobId: job.id,
          slipId: slip.id,
          status: "needs_review",
          amount: extraction.amount,
          currency: "THB",
          reviewUrl: `/review?slipId=${slip.id}`,
          extracted: extraction,
          overallConfidence: confidenceDecision.overallConfidence,
          direction: directionClass.direction,
          matchedFromAccountId: senderMatch.accountId,
          matchedToAccountId: receiverMatch.accountId,
          errorMessage: confidenceDecision.reasons.join(", "),
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Processing error";
      await DataStore.updateSlip(userId, slip.id, { status: "failed" });
      await DataStore.updateSlipJob(userId, job.id, {
        status: "failed",
        safe_error_message: msg,
        finished_at: new Date().toISOString(),
      });

      return {
        jobId: job.id,
        slipId: slip.id,
        status: "failed",
        currency: "THB",
        errorMessage: msg,
      };
    }
  }
}

export const defaultSlipProcessor = new SlipProcessor();
