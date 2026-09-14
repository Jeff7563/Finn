import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: slipId } = await context.params;
    if (!slipId) {
      return NextResponse.json({ error: "Missing slip ID" }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const sig = searchParams.get("sig");
    const expStr = searchParams.get("exp");

    let isAuthorized = false;
    const authenticatedUser = await getAuthenticatedUser();

    // 1. Verify Signed URL Signature if provided
    if (sig && expStr) {
      const exp = parseInt(expStr, 10);
      if (DataStore.verifySlipPreviewSignature(slipId, exp, sig)) {
        isAuthorized = true;
      }
    }

    // 2. Fetch the slip
    const slip = await DataStore.getSlipByIdUnscoped(slipId);
    if (!slip) {
      return NextResponse.json({ error: "Slip not found" }, { status: 404 });
    }

    // 3. Authorization check
    // Either signed preview is valid, OR authenticated user owns the slip
    if (!isAuthorized) {
      if (!authenticatedUser) {
        return NextResponse.json(
          { error: "Unauthorized access: valid signed URL or session required" },
          { status: 401 }
        );
      }
      if (slip.user_id !== authenticatedUser.id) {
        return NextResponse.json(
          { error: "Forbidden: cross-user access denied" },
          { status: 403 }
        );
      }
    }

    // 4. Fetch file buffer from private storage
    const fileBuffer = await DataStore.getSlipFile(slip.storage_path);
    if (!fileBuffer) {
      return NextResponse.json(
        { error: "Slip file not found in storage" },
        { status: 404 }
      );
    }

    // 5. Return file with strict privacy headers
    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        "Content-Type": slip.mime_type || "image/jpeg",
        "Content-Disposition": `inline; filename="slip-${slip.id}.jpg"`,
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    const err = error instanceof Error ? error.message : "Error serving slip preview";
    return NextResponse.json(
      { error: "Failed to load slip preview", detail: err },
      { status: 500 }
    );
  }
}
