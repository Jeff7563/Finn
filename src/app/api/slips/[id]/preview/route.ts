import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/server/auth";
import { authorizeAndReadSlipPreview } from "@/lib/server/private-storage";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: slipId } = await context.params;
    const { searchParams } = new URL(req.url);
    const sig = searchParams.get("sig");
    const expStr = searchParams.get("exp");

    const authUser = await getAuthenticatedUser();
    const result = await authorizeAndReadSlipPreview({
      slipId,
      expStr,
      sig,
      authenticatedUserId: authUser?.id ?? null,
    });

    if (result.status !== 200 || !result.buffer) {
      return NextResponse.json(
        { error: result.error || "Preview unavailable" },
        { status: result.status }
      );
    }

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": result.mimeType || "image/jpeg",
        "Content-Disposition": `inline; filename="slip-${result.slipId}.jpg"`,
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
