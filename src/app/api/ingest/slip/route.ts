import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { defaultSlipProcessor } from "@/lib/slip/processor";
import { MAX_FILE_SIZE_BYTES } from "@/lib/slip/validation";
import { SlipSource } from "@/types/slip";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    let authenticatedUserId: string | null = null;
    let authMethod: "bearer_token" | "session" = "session";

    // 1. Check Authorization Header (Bearer Ingest Token)
    const authHeader = req.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const rawToken = authHeader.slice(7).trim();
      authMethod = "bearer_token";

      const token = await DataStore.verifyAndConsumeIngestToken(rawToken);

      if (!token) {
        return NextResponse.json(
          { error: "Finn token is invalid, revoked, or expired" },
          { status: 401 }
        );
      }

      authenticatedUserId = token.user_id;
    }

    // 2. Fallback to Active Finn Session
    if (!authenticatedUserId) {
      const sessionUser = await getAuthenticatedUser();
      if (sessionUser) {
        authenticatedUserId = sessionUser.id;
        authMethod = "session";
      }
    }

    // 3. Reject Unauthenticated
    if (!authenticatedUserId) {
      return NextResponse.json(
        { error: "Authentication required: provide valid Bearer token or session cookie" },
        { status: 401 }
      );
    }

    // 4. Rate Limiting Check (30 requests per hour per user/token)
    const rateLimit = checkRateLimit(`slip_ingest:${authenticatedUserId}`, 30, 60 * 60 * 1000);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded (30 slips/hour). Please wait before submitting more slips.",
          retryAfterSeconds: Math.ceil(rateLimit.resetInMs / 1000),
        },
        { status: 429 }
      );
    }

    // 5. Parse Multipart Form Data
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Request body must be valid multipart/form-data" },
        { status: 400 }
      );
    }

    const file = formData.get("file");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Missing required 'file' form field" },
        { status: 400 }
      );
    }

    // 6. Check Size Limit (10 MB)
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: "File exceeds maximum size of 10 MB" },
        { status: 413 }
      );
    }

    // 7. Extract Optional Metadata
    const sourceParam = formData.get("source")?.toString();
    const source: SlipSource =
      sourceParam === "ios_shortcut" || sourceParam === "web_upload" || sourceParam === "manual"
        ? sourceParam
        : authMethod === "bearer_token"
        ? "ios_shortcut"
        : "web_upload";

    const idempotencyKey =
      formData.get("idempotency_key")?.toString() ||
      req.headers.get("idempotency-key") ||
      null;

    const clientId = formData.get("client_id")?.toString() || null;

    // 8. Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 9. Process Slip through SlipProcessor
    const result = await defaultSlipProcessor.processSlip({
      userId: authenticatedUserId,
      buffer,
      source,
      idempotencyKey,
      clientId,
    });

    if (result.status === "failed") {
      if (result.errorCode === "INVALID_MAGIC_BYTES" || result.errorCode === "UNSUPPORTED_TYPE") {
        return NextResponse.json(
          { error: result.errorMessage || "Unsupported file format. Please upload JPEG, PNG, or WebP." },
          { status: 415 }
        );
      }
      if (result.errorCode === "FILE_TOO_LARGE") {
        return NextResponse.json(
          { error: result.errorMessage },
          { status: 413 }
        );
      }
      return NextResponse.json(
        {
          jobId: result.jobId,
          status: "failed",
          error: result.errorMessage || "Failed to process slip",
        },
        { status: 422 }
      );
    }

    // 10. Return Response matching IOS_SHORTCUT_SPEC
    const httpStatus = result.status === "created" ? 201 : 200;

    return NextResponse.json(
      {
        jobId: result.jobId,
        status: result.status,
        amount: result.amount,
        currency: result.currency || "THB",
        reviewUrl: result.reviewUrl,
        warning: result.warningMessage,
      },
      { status: httpStatus }
    );
  } catch (error: unknown) {
    const err = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: "An unexpected error occurred during slip ingestion", detail: err },
      { status: 500 }
    );
  }
}
