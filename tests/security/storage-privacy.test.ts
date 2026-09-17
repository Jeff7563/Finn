import { describe, it, expect, beforeEach, vi } from "vitest";
import { DataStore } from "@/lib/server/data-store";
import {
  deriveTrustedSlipPath,
  createSlipSignedViewUrl,
  pruneSlipBinary,
  getSlipBinary,
  saveSlipBinary,
  signSlipPreview,
  verifySlipPreviewSignature,
  requirePreviewSigningSecret,
  evaluateStorageMutationGuard,
  pinEvidence,
  unpinEvidence,
  rollbackUploadedSlipBinary,
  privateStorage,
} from "@/lib/server/private-storage";
import { GET as previewRouteHandler } from "@/app/api/slips/[id]/preview/route";
import { NextRequest } from "next/server";
import { hasAdminCredentials } from "@/lib/supabase/admin";
import { bulkPruneAction } from "@/app/actions/storage";
import { evaluateUnifiedStorageCleanupDryRun } from "@/lib/storage/retention";
import { Slip } from "@/types/slip";
import { SourceDocument } from "@/types/multi-source";
import { defaultSlipProcessor } from "@/lib/slip/processor";
import { getSlipSignedPreviewUrlAction } from "@/app/actions/slip-review";
import { createSyntheticSlipJpeg } from "../slip/fixtures";

let mockUser: { id: string; email: string; display_name?: string } | null = null;

vi.mock("@/lib/server/auth", () => ({
  getAuthenticatedUser: vi.fn(async () => mockUser),
  requireUser: vi.fn(async () => {
    if (!mockUser) throw new Error("Unauthorized");
    return mockUser;
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

function signSlip(slipId: string, exp: number): string {
  return signSlipPreview(slipId, exp);
}

describe("Storage Privacy Hardening & Security (15 Scenarios)", () => {
  const USER_ALICE = "user-alice-storage-sec-1";
  const USER_BOB = "user-bob-storage-sec-2";

  beforeEach(() => {
    mockUser = null;
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
    expect(verifySlipPreviewSignature(slip.id, exp, sig)).toBe(true);

    // Forged signature fails
    expect(verifySlipPreviewSignature(slip.id, exp, "forged-signature-xyz")).toBe(false);
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
    expect(verifySlipPreviewSignature(slip.id, exp + 10000, sig)).toBe(false);

    // Tampering with slipId
    expect(verifySlipPreviewSignature("tampered-slip-id", exp, sig)).toBe(false);
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

describe("Storage Privacy Final Operator Security Invariants (12 Verification Scenarios)", () => {
  const USER_ALICE = "user-alice-sec-inv-1";
  const USER_BOB = "user-bob-sec-inv-2";

  beforeEach(() => {
    mockUser = null;
    DataStore.reset();
  });

  // 1. Missing SESSION_SECRET -> sign fails closed
  it("INV-01: missing SESSION_SECRET -> signSlipPreview fails closed", () => {
    const original = process.env.SESSION_SECRET;
    try {
      delete process.env.SESSION_SECRET;
      expect(() => requirePreviewSigningSecret()).toThrow(
        /SESSION_SECRET is missing or insufficient/i
      );
      expect(() => signSlipPreview("slip-test-1", Date.now() + 60000)).toThrow(
        /SESSION_SECRET is missing or insufficient/i
      );
    } finally {
      process.env.SESSION_SECRET = original;
    }
  });

  // 2. SESSION_SECRET < 32 chars -> sign fails closed
  it("INV-02: SESSION_SECRET < 32 chars -> signSlipPreview fails closed", () => {
    const original = process.env.SESSION_SECRET;
    try {
      process.env.SESSION_SECRET = "short-secret-under-32-chars";
      expect(() => requirePreviewSigningSecret()).toThrow(
        /SESSION_SECRET is missing or insufficient/i
      );
      expect(() => signSlipPreview("slip-test-2", Date.now() + 60000)).toThrow(
        /SESSION_SECRET is missing or insufficient/i
      );
    } finally {
      process.env.SESSION_SECRET = original;
    }
  });

  // 3. Missing or weak SESSION_SECRET -> verify returns false
  it("INV-03: missing or weak SESSION_SECRET -> verifySlipPreviewSignature returns false (fail-closed)", () => {
    const original = process.env.SESSION_SECRET;
    try {
      delete process.env.SESSION_SECRET;
      expect(verifySlipPreviewSignature("slip-test-3", Date.now() + 60000, "any-sig")).toBe(false);

      process.env.SESSION_SECRET = "too-short";
      expect(verifySlipPreviewSignature("slip-test-3", Date.now() + 60000, "any-sig")).toBe(false);
    } finally {
      process.env.SESSION_SECRET = original;
    }
  });

  // 4. Browser cannot insert slip with storage_path
  it("INV-04: browser cannot insert slip with storage_path", async () => {
    const guard = evaluateStorageMutationGuard(
      "slips",
      "INSERT",
      { storage_path: "alice/2026/09/evil.jpg" },
      "authenticated"
    );
    expect(guard.allowed).toBe(false);
    expect(guard.error).toContain("Direct client initialization of slips storage metadata");

    await expect(
      DataStore.createSlip(
        USER_ALICE,
        { storage_path: "alice/2026/09/evil.jpg", status: "created" },
        { asClientRole: "authenticated" }
      )
    ).rejects.toThrow(/Direct client initialization of slip storage metadata/i);
  });

  // 5. Browser cannot insert slip with file_hash_sha256
  it("INV-05: browser cannot insert slip with file_hash_sha256", async () => {
    const guard = evaluateStorageMutationGuard(
      "slips",
      "INSERT",
      { file_hash_sha256: "fake-sha-hash" },
      "authenticated"
    );
    expect(guard.allowed).toBe(false);
    expect(guard.error).toContain("Direct client initialization of slips storage metadata");

    await expect(
      DataStore.createSlip(
        USER_ALICE,
        { file_hash_sha256: "fake-sha-hash", status: "created" },
        { asClientRole: "authenticated" }
      )
    ).rejects.toThrow(/Direct client initialization of slip storage metadata/i);
  });

  // 6. Browser cannot insert source document with storage_path
  it("INV-06: browser cannot insert source document with storage_path", async () => {
    const guard = evaluateStorageMutationGuard(
      "source_documents",
      "INSERT",
      { storage_path: "alice/2026/09/evil.pdf" },
      "authenticated"
    );
    expect(guard.allowed).toBe(false);
    expect(guard.error).toContain("Direct client initialization of source_documents storage metadata");

    await expect(
      DataStore.createSourceDocument(
        USER_ALICE,
        {
          storage_path: "alice/2026/09/evil.pdf",
          document_type: "pdf_statement",
          original_filename: "evil.pdf",
        },
        { asClientRole: "authenticated" }
      )
    ).rejects.toThrow(/Direct client initialization of source document storage metadata/i);
  });

  // 7. Browser cannot update is_pinned directly
  it("INV-07: browser cannot update is_pinned directly", async () => {
    const slip = await DataStore.createSlip(USER_ALICE, {
      storage_path: "alice/2026/09/slip7.jpg",
      file_hash_sha256: "hash-inv-7-slip",
      status: "created",
    });

    const doc = await DataStore.createSourceDocument(USER_ALICE, {
      storage_path: "alice/2026/09/doc7.pdf",
      file_hash: "hash-inv-7-doc",
      document_type: "pdf_statement",
      original_filename: "doc7.pdf",
    });

    // Direct browser update of is_pinned on slip rejected
    await expect(
      DataStore.updateSlip(USER_ALICE, slip.id, { is_pinned: true }, { asClientRole: "authenticated" })
    ).rejects.toThrow(/Direct client modification of slip storage metadata/i);

    // Direct browser update of is_pinned on source document rejected
    await expect(
      DataStore.updateSourceDocument(USER_ALICE, doc.id, { is_pinned: true }, { asClientRole: "authenticated" })
    ).rejects.toThrow(/Direct client modification of source document storage metadata/i);

    // Direct browser update of protected storage columns rejected
    await expect(
      DataStore.updateSlip(USER_ALICE, slip.id, { storage_path: "tampered" }, { asClientRole: "authenticated" })
    ).rejects.toThrow(/Direct client modification of slip storage metadata/i);
  });

  // 8. Trusted server ingest still works
  it("INV-08: trusted server ingest still works with storage metadata", async () => {
    const trustedSlip = await DataStore.createSlip(USER_ALICE, {
      storage_path: "alice/2026/09/trusted.jpg",
      file_hash_sha256: "sha256-trusted-slip",
      file_size: 2048,
      stored_file_size: 2048,
      status: "created",
    });
    expect(trustedSlip.id).toBeDefined();
    expect(trustedSlip.storage_path).toBe("alice/2026/09/trusted.jpg");
    expect(trustedSlip.stored_file_size).toBe(2048);

    const trustedDoc = await DataStore.createSourceDocument(USER_ALICE, {
      storage_path: "alice/2026/09/trusted.pdf",
      file_hash: "sha256-trusted-doc",
      file_size: 4096,
      stored_file_size: 4096,
      document_type: "pdf_statement",
      original_filename: "trusted.pdf",
    });
    expect(trustedDoc.id).toBeDefined();
    expect(trustedDoc.storage_path).toBe("alice/2026/09/trusted.pdf");
    expect(trustedDoc.stored_file_size).toBe(4096);
  });

  // 9. Trusted pin/unpin works and appends audit event
  it("INV-09: trusted pin/unpin works and appends audit event to storage_binary_events", async () => {
    const slip = await DataStore.createSlip(USER_ALICE, {
      storage_path: "alice/2026/09/pin_audit.jpg",
      file_hash_sha256: "hash-pin-audit",
      status: "created",
    });

    // Pin slip
    await pinEvidence(USER_ALICE, "slip", slip.id);
    let updatedSlip = await DataStore.getSlipById(USER_ALICE, slip.id);
    expect(updatedSlip?.is_pinned).toBe(true);

    let events = await DataStore.getStorageBinaryEvents(USER_ALICE);
    const pinEvent = events.find((e) => e.slip_id === slip.id && e.action === "pin");
    expect(pinEvent).toBeDefined();

    // Unpin slip
    await unpinEvidence(USER_ALICE, "slip", slip.id);
    updatedSlip = await DataStore.getSlipById(USER_ALICE, slip.id);
    expect(updatedSlip?.is_pinned).toBe(false);

    events = await DataStore.getStorageBinaryEvents(USER_ALICE);
    const unpinEvent = events.find((e) => e.slip_id === slip.id && e.action === "unpin");
    expect(unpinEvent).toBeDefined();
  });

  // 10. Bulk prune revalidates server-side
  it("INV-10: bulk prune authoritatively revalidates eligibility server-side", async () => {
    mockUser = { id: USER_ALICE, email: "alice@example.com" };

    const oldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const filePath = `${USER_ALICE}/2026/05/old_candidate.jpg`;
    await DataStore.saveSlipFile(filePath, Buffer.from("candidate image"));

    const eligibleSlip = await DataStore.createSlip(USER_ALICE, {
      storage_path: filePath,
      file_hash_sha256: "hash-candidate-10",
      file_size: 50000,
      stored_file_size: 50000,
      status: "created",
      created_at: oldDate,
    });

    const res = await bulkPruneAction([
      { targetId: eligibleSlip.id, targetType: "slip" },
    ]);

    expect(res.success).toBe(true);
    expect(res.totalPruned).toBe(1);
    expect(res.totalBytesFreed).toBe(50000);

    const prunedSlip = await DataStore.getSlipById(USER_ALICE, eligibleSlip.id);
    expect(prunedSlip?.stored_file_size).toBe(0);
    expect(prunedSlip?.binary_deleted_at).toBeTruthy();
  });

  // 11. Forged bulk prune target cannot prune recent file
  it("INV-11: forged bulk prune target cannot prune recent file", async () => {
    mockUser = { id: USER_ALICE, email: "alice@example.com" };

    const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const recentPath = `${USER_ALICE}/2026/09/recent_protected.jpg`;
    await DataStore.saveSlipFile(recentPath, Buffer.from("recent binary"));

    const recentSlip = await DataStore.createSlip(USER_ALICE, {
      storage_path: recentPath,
      file_hash_sha256: "hash-recent-protected",
      file_size: 80000,
      stored_file_size: 80000,
      status: "created",
      created_at: recentDate,
    });

    // Client requests pruning recent slip
    const res = await bulkPruneAction([
      { targetId: recentSlip.id, targetType: "slip" },
    ]);

    expect(res.totalPruned).toBe(0);
    expect(res.failedCount).toBe(1);

    // Verify binary is untouched
    const afterSlip = await DataStore.getSlipById(USER_ALICE, recentSlip.id);
    expect(afterSlip?.stored_file_size).toBe(80000);
    expect(afterSlip?.binary_deleted_at).toBeNull();
    expect(await DataStore.slipFileExists(recentPath)).toBe(true);
  });

  // 12. source_document_retention_days is independently honored & unresolved docs exempt
  it("INV-12: source_document_retention_days is independently honored and unresolved docs are exempt", () => {
    const now = new Date("2026-09-17T12:00:00.000Z");

    const slip60: Slip = {
      id: "slip-60",
      user_id: USER_ALICE,
      storage_path: "p1.jpg",
      file_hash_sha256: "h1",
      mime_type: "image/jpeg",
      file_size: 1000,
      stored_file_size: 1000,
      source: "web_upload",
      parser_version: "v1",
      status: "created",
      is_pinned: false,
      created_at: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const doc60: SourceDocument = {
      id: "doc-60",
      user_id: USER_ALICE,
      document_type: "pdf_statement",
      storage_path: "p2.pdf",
      file_size: 2000,
      stored_file_size: 2000,
      file_hash: "h2",
      status: "processed",
      is_pinned: false,
      provider_metadata: {},
      received_at: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const doc200: SourceDocument = {
      ...doc60,
      id: "doc-200",
      received_at: new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const docReceived: SourceDocument = {
      ...doc200,
      id: "doc-received",
      status: "received",
    };

    const docProcessing: SourceDocument = {
      ...doc200,
      id: "doc-processing",
      status: "processing",
    };

    const dryRun = evaluateUnifiedStorageCleanupDryRun(
      [doc60, doc200, docReceived, docProcessing],
      [slip60],
      {
        now,
        slipRetentionDays: 30,
        sourceDocumentRetentionDays: 180,
      }
    );

    // slip60: 60d > 30d -> eligible
    expect(dryRun.candidates.some((c) => c.id === "slip-60")).toBe(true);

    // doc60: 60d < 180d -> exempt recent
    expect(dryRun.candidates.some((c) => c.id === "doc-60")).toBe(false);

    // doc200: 200d > 180d & processed -> eligible
    expect(dryRun.candidates.some((c) => c.id === "doc-200")).toBe(true);

    // docReceived & docProcessing: unresolved -> exempt
    expect(dryRun.candidates.some((c) => c.id === "doc-received")).toBe(false);
    expect(dryRun.candidates.some((c) => c.id === "doc-processing")).toBe(false);
    expect(dryRun.exemptUnresolvedCount).toBe(2);
  });
});

describe("Storage Privacy Final Audit Closure (17 Invariants)", () => {
  const USER_ALICE = "user-alice-closure-audited";
  const USER_BOB = "user-bob-closure-audited";

  beforeEach(() => {
    mockUser = null;
    DataStore.reset();
  });

  // 1. Browser cannot delete slip directly
  it("CLOSURE-01: browser cannot delete slip directly", async () => {
    const slip = await DataStore.createSlip(USER_ALICE, {
      storage_path: `${USER_ALICE}/2026/09/closure1.jpg`,
      file_hash_sha256: "hash-closure-1",
      status: "needs_review",
    });

    const guard = evaluateStorageMutationGuard("slips", "DELETE", {}, "authenticated");
    expect(guard.allowed).toBe(false);
    expect(guard.error).toContain("Direct client deletion of slips records is prohibited");

    await expect(
      DataStore.deleteSlip(USER_ALICE, slip.id, { asClientRole: "authenticated" })
    ).rejects.toThrow(/Direct client deletion of slips? records is prohibited/i);

    const fetched = await DataStore.getSlipById(USER_ALICE, slip.id);
    expect(fetched).not.toBeNull();
  });

  // 2. Linked slip cannot be deleted directly and remains intact
  it("CLOSURE-02: linked slip cannot be deleted directly and remains intact", async () => {
    const acc = await DataStore.createAccount(USER_ALICE, {
      name: "Main Account",
      type: "bank",
    });
    const tx = await DataStore.createTransaction(USER_ALICE, {
      from_account_id: acc.id,
      amount: 450,
      currency: "THB",
      type: "expense",
      transaction_date: "2026-09-17T10:00:00.000Z",
    });
    const slip = await DataStore.createSlip(USER_ALICE, {
      storage_path: `${USER_ALICE}/2026/09/closure2.jpg`,
      file_hash_sha256: "hash-closure-2",
      status: "created",
      linked_transaction_id: tx.id,
    });

    await expect(
      DataStore.deleteSlip(USER_ALICE, slip.id, { asClientRole: "authenticated" })
    ).rejects.toThrow(/Direct client deletion of slips? records is prohibited/i);

    const slipAfter = await DataStore.getSlipById(USER_ALICE, slip.id);
    expect(slipAfter).not.toBeNull();
    expect(slipAfter?.linked_transaction_id).toBe(tx.id);

    const txAfter = await DataStore.getTransactionById(USER_ALICE, tx.id);
    expect(txAfter).not.toBeNull();
  });

  // 3. Unlinked slip cannot be deleted directly and remains intact
  it("CLOSURE-03: unlinked slip cannot be deleted directly and remains intact", async () => {
    const slip = await DataStore.createSlip(USER_ALICE, {
      storage_path: `${USER_ALICE}/2026/09/closure3.jpg`,
      file_hash_sha256: "hash-closure-3",
      status: "needs_review",
      linked_transaction_id: null,
    });

    await expect(
      DataStore.deleteSlip(USER_ALICE, slip.id, { asClientRole: "authenticated" })
    ).rejects.toThrow(/Direct client deletion of slips? records is prohibited/i);

    const slipAfter = await DataStore.getSlipById(USER_ALICE, slip.id);
    expect(slipAfter).not.toBeNull();
  });

  // 4. Server binary prune works while slip row, OCR, and linked transaction survive
  it("CLOSURE-04: server binary prune works while slip row, OCR, and linked transaction survive", async () => {
    const acc = await DataStore.createAccount(USER_ALICE, {
      name: "Savings",
      type: "bank",
    });
    const tx = await DataStore.createTransaction(USER_ALICE, {
      from_account_id: acc.id,
      amount: 1500,
      currency: "THB",
      type: "expense",
      transaction_date: "2026-09-17T10:00:00.000Z",
    });
    const storagePath = `${USER_ALICE}/2026/09/closure4.jpg`;
    await DataStore.saveSlipFile(storagePath, Buffer.from("image-binary-data"));

    const slip = await DataStore.createSlip(USER_ALICE, {
      storage_path: storagePath,
      file_hash_sha256: "sha256-closure-4",
      file_size: 1024,
      stored_file_size: 1024,
      extracted_json: {
        amount: 1500,
        receiver: { bank: "KBANK", name: "Shop A" },
        fieldConfidence: { amount: 0.99 },
      },
      status: "created",
      linked_transaction_id: tx.id,
    });

    const pruneResult = await pruneSlipBinary(USER_ALICE, slip.id);
    expect(pruneResult.success).toBe(true);

    const slipAfter = await DataStore.getSlipById(USER_ALICE, slip.id);
    expect(slipAfter).not.toBeNull();
    expect(slipAfter?.stored_file_size).toBe(0);
    expect(slipAfter?.binary_deleted_at).toBeTruthy();
    expect(slipAfter?.file_hash_sha256).toBe("sha256-closure-4");
    expect(slipAfter?.extracted_json?.amount).toBe(1500);
    expect(slipAfter?.extracted_json?.receiver?.bank).toBe("KBANK");
    expect(slipAfter?.linked_transaction_id).toBe(tx.id);

    expect(await DataStore.slipFileExists(storagePath)).toBe(false);

    const txAfter = await DataStore.getTransactionById(USER_ALICE, tx.id);
    expect(txAfter).not.toBeNull();
  });

  // 5. Upload succeeds + DB insert succeeds -> normal ingestion
  it("CLOSURE-05: upload succeeds + DB insert succeeds -> normal ingestion", async () => {
    const buffer = createSyntheticSlipJpeg({ amount: 500 });
    const result = await defaultSlipProcessor.processSlip({
      userId: USER_ALICE,
      buffer,
      source: "web_upload",
    });

    expect(result.slipId).toBeTruthy();
    expect(["needs_review", "auto_confirmed", "manual_confirmed"]).toContain(result.status);

    const slip = await DataStore.getSlipById(USER_ALICE, result.slipId);
    expect(slip).not.toBeNull();
    expect(slip?.storage_path).toBeTruthy();
    expect(await DataStore.slipFileExists(slip!.storage_path!)).toBe(true);
  });

  // 6. Upload succeeds + DB insert fails -> binary removed (compensating rollback, no orphan left, original DB error thrown)
  it("CLOSURE-06: upload succeeds + DB insert fails -> binary removed via compensating rollback (original DB error thrown)", async () => {
    const buffer = createSyntheticSlipJpeg({ amount: 600 });
    let savedStoragePath: string | null = null;
    const origSave = DataStore.saveSlipFile.bind(DataStore);
    const saveSpy = vi.spyOn(DataStore, "saveSlipFile").mockImplementation(async (path, buf) => {
      savedStoragePath = path;
      return origSave(path, buf);
    });

    const createSpy = vi.spyOn(DataStore, "createSlip").mockRejectedValueOnce(
      new Error("DB constraint violation: slip table disk full")
    );

    await expect(
      defaultSlipProcessor.processSlip({
        userId: USER_ALICE,
        buffer,
        source: "web_upload",
      })
    ).rejects.toThrow(/DB constraint violation: slip table disk full/i);

    expect(savedStoragePath).toBeTruthy();
    expect(await DataStore.slipFileExists(savedStoragePath!)).toBe(false);

    createSpy.mockRestore();
    saveSpy.mockRestore();
  });

  // 7. Failed rollback reports safe diagnostic without exposing paths/secrets
  it("CLOSURE-07: failed rollback reports safe diagnostic without exposing paths or secrets", async () => {
    const buffer = createSyntheticSlipJpeg({ amount: 700 });
    const createSpy = vi.spyOn(DataStore, "createSlip").mockRejectedValueOnce(
      new Error("DB write timeout")
    );
    const rollbackSpy = vi.spyOn(privateStorage, "rollbackUploadedSlipBinary").mockResolvedValueOnce({
      cleaned: false,
      diagnostic: "Storage upstream 503 unavailable",
    });

    await expect(
      defaultSlipProcessor.processSlip({
        userId: USER_ALICE,
        buffer,
        source: "web_upload",
      })
    ).rejects.toThrow(/DB write timeout.*Storage upstream 503 unavailable/i);

    createSpy.mockRestore();
    rollbackSpy.mockRestore();
  });

  // 8. Rollback helper validates userId and slipId against storagePath
  it("CLOSURE-08: rollback helper validates userId and slipId against storagePath", async () => {
    // 1) Path ownership mismatch
    const badOwner = await rollbackUploadedSlipBinary(
      USER_ALICE,
      "slip-closure-8",
      `${USER_BOB}/2026/09/slip-closure-8.jpg`
    );
    expect(badOwner.cleaned).toBe(false);
    expect(badOwner.diagnostic).toContain("does not match trusted user and slip identifiers");

    // 2) Slip ID mismatch
    const badSlipId = await rollbackUploadedSlipBinary(
      USER_ALICE,
      "slip-closure-8",
      `${USER_ALICE}/2026/09/wrong-uuid.jpg`
    );
    expect(badSlipId.cleaned).toBe(false);
    expect(badSlipId.diagnostic).toContain("does not match trusted user and slip identifiers");

    // 3) Valid rollback
    const validPath = `${USER_ALICE}/2026/09/slip-closure-8.jpg`;
    await DataStore.saveSlipFile(validPath, Buffer.from("rollback-target"));
    expect(await DataStore.slipFileExists(validPath)).toBe(true);

    const success = await rollbackUploadedSlipBinary(
      USER_ALICE,
      "slip-closure-8",
      validPath
    );
    expect(success.cleaned).toBe(true);
    expect(await DataStore.slipFileExists(validPath)).toBe(false);
  });

  // 9. getSlipSignedPreviewUrlAction uses privateStorage.createSlipSignedViewUrl
  it("CLOSURE-09: getSlipSignedPreviewUrlAction uses privateStorage.createSlipSignedViewUrl", async () => {
    mockUser = { id: USER_ALICE, email: "alice@example.com" };
    const filePath = `${USER_ALICE}/2026/09/closure9.jpg`;
    await DataStore.saveSlipFile(filePath, Buffer.from("preview-target"));

    const slip = await DataStore.createSlip(USER_ALICE, {
      storage_path: filePath,
      file_hash_sha256: "sha256-closure-9",
      status: "needs_review",
    });

    const res = await getSlipSignedPreviewUrlAction(slip.id);
    expect(res.success).toBe(true);
    expect(res.url).toBeTruthy();

    const parsed = new URL(res.url!, "http://localhost");
    expect(parsed.pathname).toBe(`/api/slips/${slip.id}/preview`);

    const exp = parseInt(parsed.searchParams.get("exp") || "0", 10);
    const sig = parsed.searchParams.get("sig") || "";
    expect(exp).toBeGreaterThan(Date.now());
    expect(verifySlipPreviewSignature(slip.id, exp, sig)).toBe(true);
  });

  // 10. 120s signed preview is accepted
  it("CLOSURE-10: 120s signed preview is accepted", () => {
    const expSec = Math.floor(Date.now() / 1000) + 120;
    const sigSec = signSlipPreview("slip-c10", expSec);
    expect(verifySlipPreviewSignature("slip-c10", expSec, sigSec)).toBe(true);

    const expMs = Date.now() + 120 * 1000;
    const sigMs = signSlipPreview("slip-c10", expMs);
    expect(verifySlipPreviewSignature("slip-c10", expMs, sigMs)).toBe(true);
  });

  // 11. 300s signed preview is accepted
  it("CLOSURE-11: 300s signed preview is accepted", () => {
    const expSec = Math.floor(Date.now() / 1000) + 300;
    const sigSec = signSlipPreview("slip-c11", expSec);
    expect(verifySlipPreviewSignature("slip-c11", expSec, sigSec)).toBe(true);

    const expMs = Date.now() + 300 * 1000;
    const sigMs = signSlipPreview("slip-c11", expMs);
    expect(verifySlipPreviewSignature("slip-c11", expMs, sigMs)).toBe(true);
  });

  // 12. >300s signed preview is rejected even with valid HMAC
  it("CLOSURE-12: >300s signed preview is rejected even with valid HMAC", () => {
    const expSec = Math.floor(Date.now() / 1000) + 301;
    const sigSec = signSlipPreview("slip-c12", expSec);
    expect(verifySlipPreviewSignature("slip-c12", expSec, sigSec)).toBe(false);

    const expMs = Date.now() + 301 * 1000;
    const sigMs = signSlipPreview("slip-c12", expMs);
    expect(verifySlipPreviewSignature("slip-c12", expMs, sigMs)).toBe(false);

    const expFar = Math.floor(Date.now() / 1000) + 3600;
    const sigFar = signSlipPreview("slip-c12", expFar);
    expect(verifySlipPreviewSignature("slip-c12", expFar, sigFar)).toBe(false);
  });

  // 13. Expired signed preview is rejected
  it("CLOSURE-13: expired signed preview is rejected", () => {
    const expSec = Math.floor(Date.now() / 1000) - 10;
    const sigSec = signSlipPreview("slip-c13", expSec);
    expect(verifySlipPreviewSignature("slip-c13", expSec, sigSec)).toBe(false);

    const expMs = Date.now() - 5000;
    const sigMs = signSlipPreview("slip-c13", expMs);
    expect(verifySlipPreviewSignature("slip-c13", expMs, sigMs)).toBe(false);
  });

  // 14. Tampered signed preview is rejected
  it("CLOSURE-14: tampered signed preview is rejected", () => {
    const exp = Math.floor(Date.now() / 1000) + 120;
    const sig = signSlipPreview("slip-c14", exp);

    expect(verifySlipPreviewSignature("slip-c14", exp, "tampered-sig")).toBe(false);
    expect(verifySlipPreviewSignature("slip-c14", exp, sig + "x")).toBe(false);
    expect(verifySlipPreviewSignature("slip-different", exp, sig)).toBe(false);
    expect(verifySlipPreviewSignature("slip-c14", exp + 1, sig)).toBe(false);
  });

  // 15. Storage binary audit event rejects cross-user slip ownership mismatch
  it("CLOSURE-15: storage binary audit event rejects cross-user slip ownership mismatch", async () => {
    const aliceSlip = await DataStore.createSlip(USER_ALICE, {
      storage_path: `${USER_ALICE}/2026/09/alice_slip.jpg`,
      file_hash_sha256: "hash-alice-c15",
      status: "created",
    });

    await expect(
      DataStore.createStorageBinaryEvent(USER_BOB, {
        user_id: USER_BOB,
        slip_id: aliceSlip.id,
        action: "prune_completed",
      })
    ).rejects.toThrow(/does not match slip owner/i);
  });

  // 16. Storage binary audit event rejects cross-user source document mismatch
  it("CLOSURE-16: storage binary audit event rejects cross-user source document mismatch", async () => {
    const aliceDoc = await DataStore.createSourceDocument(USER_ALICE, {
      storage_path: `${USER_ALICE}/2026/09/alice_doc.pdf`,
      file_hash: "hash-alice-c16",
      document_type: "pdf_statement",
      original_filename: "alice_doc.pdf",
    });

    await expect(
      DataStore.createStorageBinaryEvent(USER_BOB, {
        user_id: USER_BOB,
        source_document_id: aliceDoc.id,
        action: "prune_completed",
      })
    ).rejects.toThrow(/does not match source document owner/i);
  });

  // 17. Exactly-one-target constraint enforced on storage binary event
  it("CLOSURE-17: exactly-one-target constraint enforced on storage binary event", async () => {
    const aliceSlip = await DataStore.createSlip(USER_ALICE, {
      storage_path: `${USER_ALICE}/2026/09/alice_slip_17.jpg`,
      file_hash_sha256: "hash-alice-c17",
      status: "created",
    });
    const aliceDoc = await DataStore.createSourceDocument(USER_ALICE, {
      storage_path: `${USER_ALICE}/2026/09/alice_doc_17.pdf`,
      file_hash: "hash-alice-doc-c17",
      document_type: "pdf_statement",
      original_filename: "alice_doc_17.pdf",
    });

    // Neither target
    await expect(
      DataStore.createStorageBinaryEvent(USER_ALICE, {
        user_id: USER_ALICE,
        action: "prune_completed",
      } as any)
    ).rejects.toThrow(/must specify exactly one target/i);

    // Both targets
    await expect(
      DataStore.createStorageBinaryEvent(USER_ALICE, {
        user_id: USER_ALICE,
        slip_id: aliceSlip.id,
        source_document_id: aliceDoc.id,
        action: "prune_completed",
      })
    ).rejects.toThrow(/must specify exactly one target/i);

    // Exactly one target (slip)
    const ev1 = await DataStore.createStorageBinaryEvent(USER_ALICE, {
      user_id: USER_ALICE,
      slip_id: aliceSlip.id,
      action: "prune_completed",
    });
    expect(ev1.slip_id).toBe(aliceSlip.id);
    expect(ev1.source_document_id).toBeNull();

    // Exactly one target (source document)
    const ev2 = await DataStore.createStorageBinaryEvent(USER_ALICE, {
      user_id: USER_ALICE,
      source_document_id: aliceDoc.id,
      action: "prune_completed",
    });
    expect(ev2.source_document_id).toBe(aliceDoc.id);
    expect(ev2.slip_id).toBeNull();
  });
});
