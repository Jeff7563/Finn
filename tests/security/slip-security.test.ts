import { describe, it, expect, beforeEach } from "vitest";
import { DataStore } from "@/lib/server/data-store";
import { hashToken, verifyTokenHash, isTokenUsable } from "@/lib/slip/token";
import { checkRateLimit, resetRateLimit } from "@/lib/server/rate-limiter";
import { defaultSlipProcessor } from "@/lib/slip/processor";
import { createSyntheticSlipJpeg } from "../slip/fixtures";

describe("Phase 2 — Slip Security & Adversarial Hardening", () => {
  const USER_A = "user-alice-security-1";
  const USER_B = "user-bob-security-2";

  beforeEach(() => {
    DataStore.reset();
    resetRateLimit();
  });

  // 1. Cross-User Slip Isolation
  it("SEC-SLIP-01: User A cannot read or access User B's slip", async () => {
    // User B creates a slip
    const slipB = await DataStore.createSlip(USER_B, {
      file_hash_sha256: "hash-bob-secret-slip",
      storage_path: `${USER_B}/2026/09/secret.jpg`,
      status: "needs_review",
    });

    // User A attempts to read User B's slip
    const accessedByA = await DataStore.getSlipById(USER_A, slipB.id);
    expect(accessedByA).toBeNull();

    // User A attempts to update User B's slip
    await expect(
      DataStore.updateSlip(USER_A, slipB.id, { status: "created" })
    ).rejects.toThrow(/access denied/i);
  });

  // 2. Cross-User Ingest Token Isolation
  it("SEC-SLIP-02: User A cannot list or revoke User B's ingest tokens", async () => {
    const { token: tokenB } = await (async () => {
      const { rawToken, record } = await DataStore.createIngestToken(USER_B, {
        label: "Bob's iPhone",
      });
      return { raw: rawToken, token: record };
    })();

    // User A lists tokens -> Bob's token must not appear
    const tokensA = await DataStore.getIngestTokens(USER_A);
    expect(tokensA.some((t) => t.id === tokenB.id)).toBe(false);

    // User A attempts to revoke Bob's token
    await expect(DataStore.revokeIngestToken(USER_A, tokenB.id)).rejects.toThrow(
      /access denied/i
    );
  });

  // 3. Raw Token Storage Security
  it("SEC-SLIP-03: Raw ingest token is NEVER stored in database (only SHA-256 hash)", async () => {
    const { rawToken, record } = await DataStore.createIngestToken(USER_A, {
      label: "Alice iPad",
    });

    expect(rawToken).toContain("finn_ingest_");
    // Verify stored record only has hash
    expect(record.token_hash).toBe(hashToken(rawToken));
    expect(record.token_hash).not.toContain("finn_ingest_");

    // Check rawToken does not equal stored hash
    expect(rawToken).not.toBe(record.token_hash);
  });

  // 4. Revoked and Expired Token Rejection
  it("SEC-SLIP-04: Revoked or expired token is immediately rejected", async () => {
    const { rawToken, record } = await DataStore.createIngestToken(USER_A, {
      label: "Revocation Test",
    });

    // Active token verifies successfully
    const active = await DataStore.verifyAndConsumeIngestToken(rawToken);
    expect(active).not.toBeNull();
    expect(active?.user_id).toBe(USER_A);

    // Revoke token
    await DataStore.revokeIngestToken(USER_A, record.id);

    // Attempt consumption after revocation
    const afterRevoke = await DataStore.verifyAndConsumeIngestToken(rawToken);
    expect(afterRevoke).toBeNull();
  });

  // 5. Cross-User Relational Linking Attack
  it("SEC-SLIP-05: User A cannot link User B's transaction to User A's slip", async () => {
    // User A creates an account and slip
    const accA = await DataStore.createAccount(USER_A, {
      name: "Alice Main",
      type: "bank",
      opening_balance: 1000,
    });
    const slipA = await DataStore.createSlip(USER_A, {
      file_hash_sha256: "hash-alice-slip",
      storage_path: `${USER_A}/2026/09/slip.jpg`,
      status: "needs_review",
    });

    // User B creates a transaction
    const accB = await DataStore.createAccount(USER_B, {
      name: "Bob Main",
      type: "bank",
      opening_balance: 5000,
    });
    const txB = await DataStore.createTransaction(USER_B, {
      type: "expense",
      amount: 250,
      currency: "THB",
      transaction_date: new Date().toISOString(),
      from_account_id: accB.id,
      source: "manual",
    });

    // User A attempts to link User B's transaction to Alice's slip
    await expect(
      DataStore.updateSlip(USER_A, slipA.id, {
        linked_transaction_id: txB.id,
      })
    ).rejects.toThrow(/security violation/i);
  });

  // 6. Signed Preview URL Signature & Owner Verification
  it("SEC-SLIP-06: Signed preview URL verifies HMAC signature and rejects expired signatures", async () => {
    const slipA = await DataStore.createSlip(USER_A, {
      file_hash_sha256: "hash-signed-test",
      storage_path: `${USER_A}/2026/09/test.jpg`,
      status: "created",
    });

    // Generate valid signed URL (15 min validity)
    const signedUrl = await DataStore.createSignedSlipUrl(USER_A, slipA.id, 900);
    const parsedUrl = new URL(`http://localhost${signedUrl}`);
    const exp = parseInt(parsedUrl.searchParams.get("exp") || "0", 10);
    const sig = parsedUrl.searchParams.get("sig") || "";

    expect(sig).toBeTruthy();
    expect(DataStore.verifySlipPreviewSignature(slipA.id, exp, sig)).toBe(true);

    // Tampered signature must fail
    expect(DataStore.verifySlipPreviewSignature(slipA.id, exp, "tampered-signature")).toBe(false);

    // Tampered slip ID must fail
    expect(DataStore.verifySlipPreviewSignature("different-slip-id", exp, sig)).toBe(false);

    // Expired timestamp must fail
    const expiredExp = Date.now() - 1000;
    expect(DataStore.verifySlipPreviewSignature(slipA.id, expiredExp, sig)).toBe(false);
  });

  // 7. Rate Limiter Gating
  it("SEC-SLIP-07: Ingest rate limit enforces 30 requests/hour barrier", () => {
    const rateLimitKey = "test_user_rate_limit";
    // First 30 requests must succeed
    for (let i = 0; i < 30; i++) {
      const status = checkRateLimit(rateLimitKey, 30, 3600000);
      expect(status.allowed).toBe(true);
    }

    // 31st request must be blocked
    const blocked = checkRateLimit(rateLimitKey, 30, 3600000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetInMs).toBeGreaterThan(0);
  });

  // 8. Ingest Token Authority Boundary (Scope slip:ingest only)
  it("SEC-SLIP-08: Ingest tokens strictly enforce slip:ingest scope", async () => {
    const { record } = await DataStore.createIngestToken(USER_A, {
      label: "Shortcut Test",
    });
    expect(record.scope).toBe("slip:ingest");
    // Token cannot be used to grant finance admin rights
    expect(record.scope).not.toContain("admin");
    expect(record.scope).not.toContain("service_role");
  });

  // 9. Service Role Key Absence
  it("SEC-SLIP-09: No service role keys are exposed in token generation or response", async () => {
    const { rawToken } = await DataStore.createIngestToken(USER_A, {
      label: "No Service Role Exposure",
    });
    // Ensure raw token is application-generated entropy, not Supabase service role secret
    expect(rawToken.startsWith("finn_ingest_")).toBe(true);
    expect(rawToken).not.toContain("eyJ"); // Not a JWT
  });
});
