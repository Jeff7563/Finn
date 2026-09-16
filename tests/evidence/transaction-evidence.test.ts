import { describe, it, expect, beforeEach } from "vitest";
import { MemoryDataStore } from "@/lib/server/memory-data-store";
import { Transaction } from "@/types/finance";
import { Slip } from "@/types/slip";
import { IngestionItem, SourceDocument } from "@/types/multi-source";

describe("Decision 1: Existing Slip → Transaction Evidence Bridge", () => {
  const userA = "user-alice-1111-1111-1111-111111111111";
  const userB = "user-bob-2222-2222-2222-222222222222";

  beforeEach(() => {
    MemoryDataStore.reset();
  });

  it("achieves 1 Transaction with 3 Evidence rows (slip + gmail + statement row) without altering legacy slips", async () => {
    // 1. Create Account for User A
    const acc = await MemoryDataStore.createAccount(userA, {
      name: "KBANK Main",
      type: "bank",
      opening_balance: 5000,
      currency: "THB",
      active: true,
      balance_as_of: "2026-09-01T00:00:00.000Z",
    });

    // 2. Create canonical Transaction #123
    const tx = await MemoryDataStore.createTransaction(userA, {
      type: "expense",
      amount: 450.0,
      currency: "THB",
      transaction_date: "2026-09-10T12:00:00.000Z",
      from_account_id: acc.id,
      description: "Team Lunch",
      source: "slip",
    });

    // 3. Create legacy Finn Slip (canonical pipeline unchanged)
    const slip = await MemoryDataStore.createSlip(userA, {
      storage_path: "slips/userA/slip123.jpg",
      file_hash_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      mime_type: "image/jpeg",
      file_size: 102400,
      source: "web_upload",
      parser_version: "2.0",
      status: "created",
      linked_transaction_id: tx.id,
    });

    // 4. Create Source Document & Ingestion Items for Gmail & Statement
    const emailDoc = await MemoryDataStore.createSourceDocument(userA, {
      document_type: "email",
      status: "processed",
      provider_metadata: { subject: "KBANK Transfer Alert" },
    });

    const gmailItem = (
      await MemoryDataStore.createIngestionItems(userA, [
        {
          source_document_id: emailDoc.id,
          item_type: "email_notification",
          status: "linked",
          parsed_data: { amount: 45000, direction: "outgoing" },
          matched_transaction_id: tx.id,
        },
      ])
    )[0];

    const stmtDoc = await MemoryDataStore.createSourceDocument(userA, {
      document_type: "csv_statement",
      status: "processed",
    });

    const stmtItem = (
      await MemoryDataStore.createIngestionItems(userA, [
        {
          source_document_id: stmtDoc.id,
          item_type: "statement_row",
          status: "linked",
          parsed_data: { amount: 45000, direction: "outgoing" },
          matched_transaction_id: tx.id,
        },
      ])
    )[0];

    // 5. Create 3 Transaction Evidence records linked to Transaction #123
    // Evidence #1: slip_id = existing Finn slip
    const ev1 = await MemoryDataStore.createTransactionEvidence(userA, {
      transaction_id: tx.id,
      slip_id: slip.id,
      evidence_type: "slip",
    });

    // Evidence #2: ingestion_item_id = Gmail candidate
    const ev2 = await MemoryDataStore.createTransactionEvidence(userA, {
      transaction_id: tx.id,
      ingestion_item_id: gmailItem.id,
      evidence_type: "email_notification",
    });

    // Evidence #3: ingestion_item_id = Statement row
    const ev3 = await MemoryDataStore.createTransactionEvidence(userA, {
      transaction_id: tx.id,
      ingestion_item_id: stmtItem.id,
      evidence_type: "statement_row",
    });

    // Verify 1 Transaction, 3 Evidence rows
    const evidences = await MemoryDataStore.getTransactionEvidence(userA, tx.id);
    expect(evidences).toHaveLength(3);

    expect(evidences.map((e) => e.evidence_type)).toEqual([
      "slip",
      "email_notification",
      "statement_row",
    ]);

    expect(ev1.slip_id).toBe(slip.id);
    expect(ev1.ingestion_item_id).toBeNull();

    expect(ev2.slip_id).toBeNull();
    expect(ev2.ingestion_item_id).toBe(gmailItem.id);

    expect(ev3.slip_id).toBeNull();
    expect(ev3.ingestion_item_id).toBe(stmtItem.id);

    // Existing slip remains canonical and untouched
    const retrievedSlip = await MemoryDataStore.getSlipById(userA, slip.id);
    expect(retrievedSlip).not.toBeNull();
    expect(retrievedSlip?.linked_transaction_id).toBe(tx.id);
  });

  it("enforces constraint: EXACTLY ONE of slip_id or ingestion_item_id must be non-null", async () => {
    const acc = await MemoryDataStore.createAccount(userA, {
      name: "KBANK",
      type: "bank",
      opening_balance: 1000,
      currency: "THB",
      active: true,
    });

    const tx = await MemoryDataStore.createTransaction(userA, {
      type: "expense",
      amount: 100.0,
      currency: "THB",
      transaction_date: "2026-09-10T12:00:00.000Z",
      from_account_id: acc.id,
      source: "manual",
    });

    // Case A: Both slip_id and ingestion_item_id are null -> REJECTED
    await expect(
      MemoryDataStore.createTransactionEvidence(userA, {
        transaction_id: tx.id,
        slip_id: null,
        ingestion_item_id: null,
        evidence_type: "slip",
      })
    ).rejects.toThrow(/Exactly one of slip_id or ingestion_item_id must be provided/i);

    // Case B: Both slip_id and ingestion_item_id are provided -> REJECTED
    await expect(
      MemoryDataStore.createTransactionEvidence(userA, {
        transaction_id: tx.id,
        slip_id: "slip-fake-id",
        ingestion_item_id: "item-fake-id",
        evidence_type: "slip",
      })
    ).rejects.toThrow(/Exactly one of slip_id or ingestion_item_id must be provided/i);
  });

  it("enforces DB-level uniqueness: slip can link to at most one transaction via evidence", async () => {
    const acc = await MemoryDataStore.createAccount(userA, {
      name: "KBANK",
      type: "bank",
      opening_balance: 1000,
      currency: "THB",
      active: true,
    });

    const tx1 = await MemoryDataStore.createTransaction(userA, {
      type: "expense",
      amount: 100.0,
      currency: "THB",
      transaction_date: "2026-09-10T12:00:00.000Z",
      from_account_id: acc.id,
      source: "slip",
    });

    const tx2 = await MemoryDataStore.createTransaction(userA, {
      type: "expense",
      amount: 100.0,
      currency: "THB",
      transaction_date: "2026-09-10T13:00:00.000Z",
      from_account_id: acc.id,
      source: "slip",
    });

    const slip = await MemoryDataStore.createSlip(userA, {
      storage_path: "slips/slip1.jpg",
      file_hash_sha256: "hash1",
      mime_type: "image/jpeg",
      file_size: 1000,
      source: "web_upload",
      parser_version: "2.0",
      status: "created",
    });

    // Link slip to tx1 -> OK
    await MemoryDataStore.createTransactionEvidence(userA, {
      transaction_id: tx1.id,
      slip_id: slip.id,
      evidence_type: "slip",
    });

    // Attempting to link same slip to tx2 -> REJECTED by unique constraint
    await expect(
      MemoryDataStore.createTransactionEvidence(userA, {
        transaction_id: tx2.id,
        slip_id: slip.id,
        evidence_type: "slip",
      })
    ).rejects.toThrow(/Unique constraint violation/i);
  });

  it("enforces DB-level uniqueness: ingestion_item can link to at most one transaction via evidence", async () => {
    const acc = await MemoryDataStore.createAccount(userA, {
      name: "KBANK",
      type: "bank",
      opening_balance: 1000,
      currency: "THB",
      active: true,
    });

    const tx1 = await MemoryDataStore.createTransaction(userA, {
      type: "expense",
      amount: 100.0,
      currency: "THB",
      transaction_date: "2026-09-10T12:00:00.000Z",
      from_account_id: acc.id,
      source: "import",
    });

    const tx2 = await MemoryDataStore.createTransaction(userA, {
      type: "expense",
      amount: 100.0,
      currency: "THB",
      transaction_date: "2026-09-10T13:00:00.000Z",
      from_account_id: acc.id,
      source: "import",
    });

    const doc = await MemoryDataStore.createSourceDocument(userA, {
      document_type: "csv_statement",
      status: "processed",
    });

    const item = (
      await MemoryDataStore.createIngestionItems(userA, [
        {
          source_document_id: doc.id,
          item_type: "statement_row",
          status: "pending",
        },
      ])
    )[0];

    // Link item to tx1 -> OK
    await MemoryDataStore.createTransactionEvidence(userA, {
      transaction_id: tx1.id,
      ingestion_item_id: item.id,
      evidence_type: "statement_row",
    });

    // Attempting to link same item to tx2 -> REJECTED by unique constraint
    await expect(
      MemoryDataStore.createTransactionEvidence(userA, {
        transaction_id: tx2.id,
        ingestion_item_id: item.id,
        evidence_type: "statement_row",
      })
    ).rejects.toThrow(/Unique constraint violation/i);
  });

  it("enforces cross-user ownership integrity: strictly rejects linking cross-user records", async () => {
    // Setup User A transaction
    const accA = await MemoryDataStore.createAccount(userA, {
      name: "Alice KBANK",
      type: "bank",
      opening_balance: 1000,
      currency: "THB",
      active: true,
    });
    const txA = await MemoryDataStore.createTransaction(userA, {
      type: "expense",
      amount: 100.0,
      currency: "THB",
      transaction_date: "2026-09-10T12:00:00.000Z",
      from_account_id: accA.id,
      source: "slip",
    });

    // Setup User B slip and ingestion item
    const slipB = await MemoryDataStore.createSlip(userB, {
      storage_path: "slips/userB/slip.jpg",
      file_hash_sha256: "hashB",
      mime_type: "image/jpeg",
      file_size: 1000,
      source: "web_upload",
      parser_version: "2.0",
      status: "created",
    });

    const docB = await MemoryDataStore.createSourceDocument(userB, {
      document_type: "email",
      status: "processed",
    });
    const itemB = (
      await MemoryDataStore.createIngestionItems(userB, [
        {
          source_document_id: docB.id,
          item_type: "email_notification",
          status: "pending",
        },
      ])
    )[0];

    // Attack 1: User A tries to link User B's slip to User A's transaction
    await expect(
      MemoryDataStore.createTransactionEvidence(userA, {
        transaction_id: txA.id,
        slip_id: slipB.id,
        evidence_type: "slip",
      })
    ).rejects.toThrow(/Cross-user integrity violation/i);

    // Attack 2: User A tries to link User B's ingestion item to User A's transaction
    await expect(
      MemoryDataStore.createTransactionEvidence(userA, {
        transaction_id: txA.id,
        ingestion_item_id: itemB.id,
        evidence_type: "email_notification",
      })
    ).rejects.toThrow(/Cross-user integrity violation/i);

    // Attack 3: User B tries to link their slip to User A's transaction
    await expect(
      MemoryDataStore.createTransactionEvidence(userB, {
        transaction_id: txA.id,
        slip_id: slipB.id,
        evidence_type: "slip",
      })
    ).rejects.toThrow(/Cross-user integrity violation/i);
  });
});
