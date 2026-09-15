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
import { CompositeSlipParser, VisionSlipParser, VisionProviderDiagnostics } from "./ocr";
import { normalizeBankName } from "./bank-normalization";
import { matchOwnedAccount } from "./account-match";
import { matchCounterparty } from "./counterparty-match";
import { suggestCategory } from "./category-suggest";
import { detectDuplicate } from "./duplicate";
import { classifyDirection } from "./direction";
import { evaluateConfidence } from "./confidence";
import {
  isMateriallyUnusable,
  calculateCompletenessScore,
  mergeSlipExtractions,
  isAmountValid,
} from "./quality-gate";

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
      isReprocess: false,
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
      isReprocess: true,
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
    isReprocess?: boolean;
  }): Promise<SlipProcessingResult> {
    const { userId, slip, job, buffer, mime, fileHash, source, isReprocess = false } = params;
    const existingExtraction = slip.extracted_json || null;
    const prevScore = calculateCompletenessScore(existingExtraction);

    try {
      // 6. QR Code Decoding
      let qrPayload: string | null = null;
      try {
        qrPayload = await this.qrDecoder.decode(buffer);
      } catch {
        // QR failure is non-fatal; continue to OCR/Vision
      }

      // 7. OCR / Vision Extraction
      let rawExtraction: SlipExtraction | null = null;
      let newExtractionFailed = false;
      let extractionErrorCode: string | null = null;
      let extractionErrorMessage: string | null = null;
      let extractionDiagnostics: VisionProviderDiagnostics | undefined = undefined;

      try {
        rawExtraction = await this.visionParser.parse({
          imageBuffer: buffer,
          mimeType: mime,
          qrPayload,
        });
        if (isMateriallyUnusable(rawExtraction)) {
          newExtractionFailed = true;
          extractionErrorCode = "VISION_EMPTY_EXTRACTION";
          extractionErrorMessage =
            "Vision extraction returned no usable financial data (empty response)";
        }
      } catch (err: unknown) {
        newExtractionFailed = true;
        extractionErrorCode =
          (err as { code?: string })?.code || "VISION_EXTRACTION_FAILED";
        extractionErrorMessage =
          err instanceof Error ? err.message : "Slip extraction failed";
        extractionDiagnostics =
          (err as { diagnostics?: VisionProviderDiagnostics })?.diagnostics;
      }

      // Handle failed or materially unusable provider response
      if (newExtractionFailed || !rawExtraction) {
        if (isReprocess && existingExtraction) {
          // Reprocess Quality Gate: Preserve existing extraction completely
          const diagJson = JSON.stringify({
            parser: slip.parser_version || "v2-vision",
            provider: extractionDiagnostics?.provider || "gemini",
            primaryModel: extractionDiagnostics?.primaryModel || process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
            primaryDurationMs: extractionDiagnostics?.primaryDurationMs,
            primaryAttempts: extractionDiagnostics?.primaryAttempts,
            fallbackModel: extractionDiagnostics?.fallbackModel || process.env.GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite",
            fallbackDurationMs: extractionDiagnostics?.fallbackDurationMs,
            fallbackAttempts: extractionDiagnostics?.fallbackAttempts,
            model: extractionDiagnostics?.model,
            httpStatus: extractionDiagnostics?.httpStatus ?? null,
            attemptCount: extractionDiagnostics?.attemptCount,
            timeout: extractionDiagnostics?.timeout ?? false,
            fallbackModelUsed: extractionDiagnostics?.fallbackModelUsed ?? false,
            totalDurationMs: extractionDiagnostics?.totalDurationMs,
            errorCode: extractionErrorCode || "VISION_EMPTY_EXTRACTION",
            safeErrorMessage: "การประมวลผลใหม่อ่านข้อมูลได้ไม่ครบ จึงคงข้อมูลเดิมไว้",
            preservedPrevious: true,
            completenessScore: {
              previous: prevScore,
              new: 0,
              merged: prevScore,
            },
            fieldMergeOccurred: false,
          });

          await DataStore.updateSlipJob(userId, job.id, {
            status: "needs_review",
            error_code: extractionErrorCode || "VISION_EMPTY_EXTRACTION",
            safe_error_message: diagJson,
            finished_at: new Date().toISOString(),
          });

          await DataStore.updateSlip(userId, slip.id, {
            status: "needs_review",
            processed_at: new Date().toISOString(),
          });

          return {
            jobId: job.id,
            slipId: slip.id,
            status: "needs_review",
            currency: "THB",
            amount: existingExtraction.amount ?? undefined,
            reviewUrl: `/review?slipId=${slip.id}`,
            extracted: existingExtraction,
            overallConfidence: slip.overall_confidence ?? undefined,
            warningMessage: "การประมวลผลใหม่อ่านข้อมูลได้ไม่ครบ จึงคงข้อมูลเดิมไว้",
            preservedPrevious: true,
            completenessScore: prevScore,
            errorCode: extractionErrorCode || "VISION_EMPTY_EXTRACTION",
            errorMessage: "การประมวลผลใหม่อ่านข้อมูลได้ไม่ครบ จึงคงข้อมูลเดิมไว้",
          };
        } else {
          // Initial first-time ingestion failure
          const safeError = extractionErrorMessage || "Slip extraction failed";
          const firstTimeDiag = JSON.stringify({
            parser: slip.parser_version || "v2-vision",
            provider: extractionDiagnostics?.provider || "gemini",
            primaryModel: extractionDiagnostics?.primaryModel || process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
            primaryDurationMs: extractionDiagnostics?.primaryDurationMs,
            primaryAttempts: extractionDiagnostics?.primaryAttempts,
            fallbackModel: extractionDiagnostics?.fallbackModel || process.env.GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite",
            fallbackDurationMs: extractionDiagnostics?.fallbackDurationMs,
            fallbackAttempts: extractionDiagnostics?.fallbackAttempts,
            model: extractionDiagnostics?.model,
            httpStatus: extractionDiagnostics?.httpStatus ?? null,
            attemptCount: extractionDiagnostics?.attemptCount,
            timeout: extractionDiagnostics?.timeout ?? false,
            fallbackModelUsed: extractionDiagnostics?.fallbackModelUsed ?? false,
            totalDurationMs: extractionDiagnostics?.totalDurationMs,
            errorCode: extractionErrorCode || "VISION_EXTRACTION_FAILED",
            safeErrorMessage: safeError,
            preservedPrevious: false,
          });

          await DataStore.updateSlip(userId, slip.id, {
            status: "needs_review",
          });
          await DataStore.updateSlipJob(userId, job.id, {
            status: "needs_review",
            error_code: extractionErrorCode || "VISION_EXTRACTION_FAILED",
            safe_error_message: firstTimeDiag,
            finished_at: new Date().toISOString(),
          });

          return {
            jobId: job.id,
            slipId: slip.id,
            status: "needs_review",
            currency: "THB",
            reviewUrl: `/review?slipId=${slip.id}`,
            warningMessage: "ระบบอ่านสลิปอัตโนมัติไม่พร้อมใช้งานชั่วคราว",
            errorCode: extractionErrorCode || "VISION_EXTRACTION_FAILED",
            errorMessage: safeError,
          };
        }
      }

      // 7b. QR and Vision Cross-Check & Corroboration
      let qrMismatch = false;
      if (qrPayload) {
        const qrParsed = parseSlipQrPayload(qrPayload);
        if (qrParsed?.amount != null && rawExtraction.amount != null) {
          if (Math.abs(qrParsed.amount - rawExtraction.amount) > 0.01) {
            qrMismatch = true;
            rawExtraction.fieldConfidence.amount = Math.min(
              rawExtraction.fieldConfidence.amount || 0.5,
              0.4
            );
          } else {
            rawExtraction.fieldConfidence.amount = 0.99;
          }
        } else if (rawExtraction.amount == null && qrParsed?.amount != null) {
          rawExtraction.amount = qrParsed.amount;
          rawExtraction.fieldConfidence.amount = qrParsed.fieldConfidence?.amount || 0.95;
        }

        if (qrParsed?.reference && !rawExtraction.reference) {
          rawExtraction.reference = qrParsed.reference;
          rawExtraction.fieldConfidence.reference = qrParsed.fieldConfidence?.reference || 0.95;
        }
      }

      // 7c. Extraction Quality Gate & Merging
      let extraction: SlipExtraction = rawExtraction;
      let preservedPrevious = false;
      let fieldMergeOccurred = false;
      const newScore = calculateCompletenessScore(rawExtraction);
      let mergedScore = newScore;

      if (isReprocess && existingExtraction) {
        const mergeResult = mergeSlipExtractions(existingExtraction, rawExtraction);
        extraction = mergeResult.merged;
        mergedScore = calculateCompletenessScore(extraction);
        fieldMergeOccurred = mergeResult.fieldMergeOccurred;

        const isIncomingDegraded =
          newScore < prevScore ||
          (!isAmountValid(rawExtraction.amount) && isAmountValid(existingExtraction.amount)) ||
          mergeResult.preservedFields.length > 0;

        if (isIncomingDegraded) {
          preservedPrevious = true;
        }
      }

      const warningMessage = preservedPrevious
        ? "การประมวลผลใหม่อ่านข้อมูลได้ไม่ครบ จึงคงข้อมูลเดิมไว้"
        : undefined;

      const jobDiagnostics = JSON.stringify({
        parser: slip.parser_version || "v2-vision",
        provider: "gemini",
        primaryModel: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
        fallbackModel: process.env.GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite",
        errorCode: preservedPrevious ? "QUALITY_GATE_RETAINED_PREVIOUS" : null,
        safeErrorMessage: warningMessage || null,
        preservedPrevious,
        completenessScore: {
          previous: prevScore,
          new: newScore,
          merged: mergedScore,
        },
        fieldMergeOccurred,
      });

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

      const effectiveConfidence =
        preservedPrevious && slip.overall_confidence != null
          ? Math.max(slip.overall_confidence, confidenceDecision.overallConfidence)
          : confidenceDecision.overallConfidence;

      // 15. Execution: Auto-Create OR Review Inbox
      // Note: If previous was preserved due to degraded reprocess, NEVER auto-create.
      if (confidenceDecision.canAutoCreate && !preservedPrevious) {
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
          qr_payload: qrPayload || slip.qr_payload,
          extracted_json: extraction,
          overall_confidence: confidenceDecision.overallConfidence,
          parser_version: "v2-vision",
          processed_at: new Date().toISOString(),
        });

        await DataStore.updateSlipJob(userId, job.id, {
          status: "created",
          safe_error_message: isReprocess ? jobDiagnostics : null,
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
          preservedPrevious: false,
          completenessScore: mergedScore,
        };
      } else {
        // Send to Review Inbox
        await DataStore.updateSlip(userId, slip.id, {
          status: "needs_review",
          qr_payload: qrPayload || slip.qr_payload,
          extracted_json: extraction,
          overall_confidence: effectiveConfidence,
          parser_version: "v2-vision",
          processed_at: new Date().toISOString(),
        });

        await DataStore.updateSlipJob(userId, job.id, {
          status: "needs_review",
          error_code: preservedPrevious ? "QUALITY_GATE_RETAINED_PREVIOUS" : null,
          safe_error_message: isReprocess ? jobDiagnostics : (confidenceDecision.reasons.join(", ") || null),
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
          overallConfidence: effectiveConfidence,
          direction: directionClass.direction,
          matchedFromAccountId: senderMatch.accountId,
          matchedToAccountId: receiverMatch.accountId,
          errorMessage: warningMessage || confidenceDecision.reasons.join(", "),
          warningMessage,
          preservedPrevious,
          completenessScore: mergedScore,
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Processing error";
      if (isReprocess && existingExtraction) {
        const diagJson = JSON.stringify({
          parser: slip.parser_version || "v2-vision",
          provider: "ai-vision",
          errorCode: "PROCESSING_ERROR",
          safeErrorMessage: msg,
          preservedPrevious: true,
          completenessScore: {
            previous: prevScore,
            new: 0,
            merged: prevScore,
          },
          fieldMergeOccurred: false,
        });
        await DataStore.updateSlip(userId, slip.id, { status: "needs_review" });
        await DataStore.updateSlipJob(userId, job.id, {
          status: "needs_review",
          error_code: "PROCESSING_ERROR",
          safe_error_message: diagJson,
          finished_at: new Date().toISOString(),
        });

        return {
          jobId: job.id,
          slipId: slip.id,
          status: "needs_review",
          currency: "THB",
          amount: existingExtraction.amount ?? undefined,
          reviewUrl: `/review?slipId=${slip.id}`,
          extracted: existingExtraction,
          overallConfidence: slip.overall_confidence ?? undefined,
          warningMessage: "การประมวลผลใหม่อ่านข้อมูลได้ไม่ครบ จึงคงข้อมูลเดิมไว้",
          preservedPrevious: true,
          completenessScore: prevScore,
          errorCode: "PROCESSING_ERROR",
          errorMessage: "การประมวลผลใหม่อ่านข้อมูลได้ไม่ครบ จึงคงข้อมูลเดิมไว้",
        };
      }

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
