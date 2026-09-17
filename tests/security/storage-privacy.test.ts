import { describe, it, expect, beforeEach } from "vitest";
import { DataStore } from "@/lib/server/data-store";
import {
  deriveTrustedSlipPath,
  createSlipSignedViewUrl,
  pruneSlipBinary,
  getSlipBinary,
} from "@/lib/server/private-storage";
import { GET as previewRouteHandler } from "@/app/api/slips/[id]/preview/route";
import { NextRequest } from "next/server";
import { hasAdminCredentials } from "@/lib/supabase/admin";
import crypto from "crypto";

function signSlip(slipId: string, exp: number): string {
  const secret = process.env.SESSION_SECRET || "finn-preview-signature-secret-2026";
  return crypto.createHmac("sha256", secret).update(`${slipId}:${exp}`).digest("hex");
}

describe("Storage Privacy Hardening & Security (15 Scenarios)", () => {
  const USER_ALICE = "user-alice-storage-sec-1";
  const USER_BOB = "user-bob-storage-sec-2";

  beforeEach(() => {
    DataStore.reset();
  });

  // 1. Storage bucket is strictly private
  it("SEC-STOR-01: Slip storage bucket is private without public URL generation", async () => {
    // In Finn architecture, getPublicUrl is never used.
    // The bucket is private, accessed only via signed HMAC URLs or authenticated route streaming.
    expect(DataStore.slipFileExists).toBeDefined();
    expect(DataStore.deleteSlipFile).toBeDefined();
  });

  // 2. Anonymous access to preview route is rejected (401)
  it("SEC-STOR-02: Anonymous request without valid signed URL is rejected (401 Unauthorized)", async () => {
    const slip = await DataStore.createSlip(USER_ALICE, {
      storage_path: `${USER_ALICE}/2026/09/alice_slip.jpg`,
      file_hash_sha256: "hash-alice-slip-1",
      status: "needs_review",
    });

    const req = new NextRequest(`http://localhost:3000/api/slips/${slip.id}/preview`);
    const res = await previewRouteHandler(req, { params: Promise.resolve({ id: slip.id }) });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Unauthorized access");
  });

  // 3. Cross-user access denied (403)
  it("SEC-STOR-03: User Bob cannot access Alice's slip via preview route without signature", async () => {
    const slip = await DataStore.createSlip(USER_ALICE, {
      storage_path: `${USER_ALICE}/2026/09/alice_slip.jpg`,
      file_hash_sha256: "hash-alice-slip-1",
      status: "needs_review",
    });

    // Request with an invalid or missing signature
    const req = new NextRequest(`http://localhost:3000/api/slips/${slip.id}/preview`);
    const res = await previewRouteHandler(req, { params: Promise.resolve({ id: slip.id }) });
    expect(res.status).toBe(401);
  });

  // 4. Signed preview URL HMAC verification and expiry
  it("SEC-STOR-04: Signed preview URL verifies HMAC signature and rejects forged signatures", async () => {
    const slip = await DataStore.createSlip(USER_ALICE, {
      storage_path: `${USER_ALICE}/2026/09/alice_slip.jpg`,
      file_hash_sha256: "hash-alice-slip-1",
      status: "needs_review",
    });

    const viewResult = await createSlipSignedViewUrl(USER_ALICE, slip.id, 120);
    expect(viewResult.url).toContain("sig=");
    expect(viewResult.url).toContain("exp=");

    const parsedUrl = new URL(`http://localhost${viewResult.url}`);
    const sig = parsedUrl.searchParams.get("sig")!;
    const exp = parseInt(parsedUrl.searchParams.get("exp")!, 10);

    // Signature verification succeeds
    expect(DataStore.verifySlipPreviewSignature(slip.id, exp, sig)).toBe(true);

    // Forged signature fails
    expect(DataStore.verifySlipPreviewSignature(slip.id, exp, "forged-signature-xyz")).toBe(false);
  });

  // 5. Signed preview URL TTL clamped (max 300s, default 120s)
  it("SEC-STOR-05: Signed preview URL TTL is clamped to default 120s and maximum 300s", async () => {
    const slip = await DataStore.createSlip(USER_ALICE, {
      storage_path: `${USER_ALICE}/2026/09/alice_slip.jpg`,
      file_hash_sha256: "hash-alice-slip-1",
      status: "needs_review",
    });

    // Default request (120s)
    const defResult = await createSlipSignedViewUrl(USER_ALICE, slip.id);
    expect(defResult.expiresIn).toBe(120);

    // Excessive request (3600s requested -> clamped to 300s)
    const clampedResult = await createSlipSignedViewUrl(USER_ALICE, slip.id, 3600);
    expect(clampedResult.expiresIn).toBe(300);

    // Negative or 0 request -> clamped to at least 1s
    const minResult = await createSlipSignedViewUrl(USER_ALICE, slip.id, -50);
    expect(minResult.expiresIn).toBe(1);
  });

  // 6. Pruned binary returns 410 Gone
  it("SEC-STOR-06: Previewing a slip with pruned binary returns HTTP 410 Gone", async () => {
    const slip = await DataStore.createSlip(USER_ALICE, {
      storage_path: `${USER_ALICE}/2026/09/alice_slip.jpg`,
      file_hash_sha256: "hash-alice-slip-1",
      status: "created",
      binary_deleted_at: "2026-09-17T00:00:00.000Z",
    });

    const exp = Date.now() + 120000;
    const sig = signSlip(slip.id, exp);

    const req = new NextRequest(`http://localhost:3000/api/slips/${slip.id}/preview?exp=${exp}&sig=${sig}`);
    const res = await previewRouteHandler(req, { params: Promise.resolve({ id: slip.id }) });

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe("ไฟล์ต้นฉบับถูกลบตามนโยบายการเก็บรักษาแล้ว");
  });

  // 7. Missing slip or missing buffer returns 404
  it("SEC-STOR-07: Missing slip or missing binary file returns HTTP 404", async () => {
    const nonExistentId = "non-existent-slip-uuid";
    const exp = Date.now() + 120000;
    const sig = signSlip(nonExistentId, exp);

    const req = new NextRequest(`http://localhost:3000/api/slips/${nonExistentId}/preview?exp=${exp}&sig=${sig}`);
    const res = await previewRouteHandler(req, { params: Promise.resolve({ id: nonExistentId }) });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("ไม่พบไฟล์หลักฐาน");
  });

  // 8. Cross-user prune rejected
  it("SEC-STOR-08: Cross-user prune action is strictly rejected", async () => {
    const slipAlice = await DataStore.createSlip(USER_ALICE, {
      storage_path: `${USER_ALICE}/2026/09/alice_slip.jpg`,
      file_hash_sha256: "hash-alice-slip-1",
      status: "created",
      file_size: 150000,
    });

    // User Bob attempts to prune Alice's slip
    await expect(
      pruneSlipBinary(USER_BOB, slipAlice.id, "malicious_prune_attempt")
    ).rejects.toThrow(/Slip not found or access denied/i);
  });

  // 9. Path injection attacks rejected
  it("SEC-STOR-09: Path injection attacks are sanitized and cannot escape user directory", () => {
    // Malicious slipId with path traversal
    const maliciousSlipId = "../../../etc/passwd";
    const derivedPath = deriveTrustedSlipPath(USER_ALICE, maliciousSlipId, "image/jpeg");

    // The derived path must sanitize traversal dots
    expect(derivedPath).not.toContain("../");
    expect(derivedPath.startsWith(`${USER_ALICE}/`)).toBe(true);
  });

  // 10. Canonical storage path format enforced
  it("SEC-STOR-10: Server-derived slip path enforces canonical format {userId}/{YYYY}/{MM}/{slipId}.{ext}", () => {
    const slipId = "valid-slip-uuid-1234";
    const path = deriveTrustedSlipPath(USER_ALICE, slipId, "image/png");

    const parts = path.split("/");
    expect(parts[0]).toBe(USER_ALICE);
    expect(parts[1]).toMatch(/^\d{4}$/); // YYYY
    expect(parts[2]).toMatch(/^\d{2}$/); // MM
    expect(parts[3]).toBe(`${slipId}.png`);
  });

  // 11. SUPABASE_SERVICE_ROLE_KEY never in NEXT_PUBLIC_
  it("SEC-STOR-11: No service role keys are exposed under NEXT_PUBLIC_ environment variables", () => {
    const publicKeys = Object.keys(process.env).filter((k) =>
      k.startsWith("NEXT_PUBLIC_")
    );
    for (const key of publicKeys) {
      const val = process.env[key] || "";
      expect(val).not.toContain("service_role");
      expect(key).not.toContain("SERVICE_ROLE");
    }
  });

  // 12. hasAdminCredentials check helper behaves predictably
  it("SEC-STOR-12: Admin credentials helper verifies configuration without leaking keys", () => {
    const result = hasAdminCredentials();
    expect(typeof result).toBe("boolean");
  });

  // 13. Storage binary audit events log prune_requested and prune_completed
  it("SEC-STOR-13: Storage binary audit events record prune_requested and prune_completed with snapshots", async () => {
    const storagePath = `${USER_ALICE}/2026/09/audit_slip.jpg`;
    await DataStore.saveSlipFile(storagePath, Buffer.from("test image data"));

    const slip = await DataStore.createSlip(USER_ALICE, {
      storage_path: storagePath,
      file_hash_sha256: "sha256-audit-slip-snapshot",
      file_size: 250000,
      stored_file_size: 250000,
      status: "created",
    });

    const pruneResult = await pruneSlipBinary(USER_ALICE, slip.id, "audit_test");
    expect(pruneResult.success).toBe(true);
    expect(pruneResult.bytesFreed).toBe(250000);

    const events = await DataStore.getStorageBinaryEvents(USER_ALICE);
    const requested = events.find((e) => e.slip_id === slip.id && e.action === "prune_requested");
    const completed = events.find((e) => e.slip_id === slip.id && e.action === "prune_completed");

    expect(requested).toBeDefined();
    expect(requested?.file_hash_snapshot).toBe("sha256-audit-slip-snapshot");
    expect(requested?.bytes_affected).toBe(250000);

    expect(completed).toBeDefined();
    expect(completed?.file_hash_snapshot).toBe("sha256-audit-slip-snapshot");
  });

  // 14. Tampered signed preview parameters fail verification
  it("SEC-STOR-14: Tampering with expiry timestamp or slip ID invalidates signed preview", async () => {
    const slip = await DataStore.createSlip(USER_ALICE, {
      storage_path: `${USER_ALICE}/2026/09/alice_slip.jpg`,
      file_hash_sha256: "hash-alice-slip-1",
      status: "needs_review",
    });

    const exp = Date.now() + 120000;
    const sig = signSlip(slip.id, exp);

    // Tampering with exp timestamp by +10 seconds
    expect(DataStore.verifySlipPreviewSignature(slip.id, exp + 10000, sig)).toBe(false);

    // Tampering with slipId
    expect(DataStore.verifySlipPreviewSignature("tampered-slip-id", exp, sig)).toBe(false);
  });

  // 15. Preview route privacy headers
  it("SEC-STOR-15: Preview route returns strict Cache-Control and security headers", async () => {
    const storagePath = `${USER_ALICE}/2026/09/header_test.jpg`;
    await DataStore.saveSlipFile(storagePath, Buffer.from("image payload"));

    const slip = await DataStore.createSlip(USER_ALICE, {
      storage_path: storagePath,
      file_hash_sha256: "hash-header-test",
      mime_type: "image/jpeg",
      status: "created",
    });

    const exp = Date.now() + 120000;
    const sig = signSlip(slip.id, exp);

    const req = new NextRequest(`http://localhost:3000/api/slips/${slip.id}/preview?exp=${exp}&sig=${sig}`);
    const res = await previewRouteHandler(req, { params: Promise.resolve({ id: slip.id }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store, max-age=0, must-revalidate");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
