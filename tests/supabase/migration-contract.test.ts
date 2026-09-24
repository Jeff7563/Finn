import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Migration Contract Tests: 20260924000000_slip_replacement_and_binary_repair.sql", () => {
  const migrationPath = path.resolve(
    process.cwd(),
    "supabase/migrations/20260924000000_slip_replacement_and_binary_repair.sql"
  );

  const sqlContent = fs.readFileSync(migrationPath, "utf-8");

  it("migration file exists and is not empty", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sqlContent.length).toBeGreaterThan(1000);
  });

  it("uses evidence_type column and NEVER references source_type in transaction_evidence insertion or replace_voided_slip_transaction", () => {
    // Assert evidence_type is present in INSERT
    expect(sqlContent).toContain("INSERT INTO public.transaction_evidence");
    expect(sqlContent).toContain("evidence_type");

    // Extract replace_voided_slip_transaction function body
    const functionStart = sqlContent.indexOf("CREATE OR REPLACE FUNCTION public.replace_voided_slip_transaction");
    const functionEnd = sqlContent.indexOf("$$ LANGUAGE plpgsql", functionStart);
    const functionBody = sqlContent.slice(
      functionStart,
      functionEnd !== -1 ? functionEnd : sqlContent.indexOf("$$;", functionStart)
    );

    expect(functionBody.length).toBeGreaterThan(0);
    expect(functionBody).toContain("evidence_type");
    expect(functionBody).not.toContain("source_type");
  });

  it("locks transaction_evidence FOR UPDATE during replacement check", () => {
    expect(sqlContent).toMatch(
      /SELECT\s+transaction_id\s+INTO\s+v_evidence_tx_id\s+FROM\s+public\.transaction_evidence\s+WHERE\s+slip_id\s*=\s*p_slip_id\s+FOR\s+UPDATE;/i
    );
  });

  it("enforces canonical link safety checks in RPC replace_voided_slip_transaction", () => {
    // A. Fail closed if slip is canonically linked to another transaction
    expect(sqlContent).toMatch(
      /v_slip\.linked_transaction_id\s+IS\s+NOT\s+NULL\s+AND\s+v_slip\.linked_transaction_id\s*<>\s*p_old_transaction_id/i
    );

    // B. Fail closed if transaction_evidence belongs to another transaction
    expect(sqlContent).toMatch(
      /v_has_canonical_evidence\s+AND\s+v_evidence_tx_id\s*<>\s*p_old_transaction_id/i
    );

    // C. Legacy fallback allowed ONLY when slip has no canonical link and no transaction_evidence row exists
    expect(sqlContent).toMatch(
      /v_slip\.linked_transaction_id\s+IS\s+NULL\s+AND\s+NOT\s+v_has_canonical_evidence/i
    );

    // D. One Canonical Slip -> One Active Transaction invariant
    expect(sqlContent).toMatch(/t\.voided_at\s+IS\s+NULL/i);
    expect(sqlContent).toMatch(/t\.id\s*=\s*v_slip\.linked_transaction_id/i);
    expect(sqlContent).toMatch(/t\.id\s*=\s*v_evidence_tx_id/i);
    expect(sqlContent).toMatch(/t\.source_slip_id\s*=\s*p_slip_id/i);
  });

  it("enforces reason check constraint on transaction_replacement_events", () => {
    expect(sqlContent).toMatch(
      /CHECK\s*\(\s*length\s*\(\s*trim\s*\(\s*reason\s*\)\s*\)\s*>\s*0\s+AND\s+length\s*\(\s*reason\s*\)\s*<=\s*500\s*\)/i
    );
  });

  it("enforces old_transaction_id <> new_transaction_id constraint", () => {
    expect(sqlContent).toMatch(
      /CONSTRAINT\s+chk_different_transactions\s+CHECK\s*\(\s*old_transaction_id\s*<>\s*new_transaction_id\s*\)/i
    );
  });

  it("enforces uniqueness constraints on old_transaction_id and new_transaction_id", () => {
    expect(sqlContent).toContain("CONSTRAINT uq_transaction_replacement_old_tx UNIQUE (old_transaction_id)");
    expect(sqlContent).toContain("CONSTRAINT uq_transaction_replacement_new_tx UNIQUE (new_transaction_id)");
  });

  it("enforces ON DELETE RESTRICT on all foreign keys of transaction_replacement_events", () => {
    expect(sqlContent).toMatch(/REFERENCES\s+public\.slips\(id\)\s+ON\s+DELETE\s+RESTRICT/i);
    expect(sqlContent).toMatch(/REFERENCES\s+public\.transactions\(id\)\s+ON\s+DELETE\s+RESTRICT/i);
  });

  it("extends storage_binary_events actions with restore and external missing actions", () => {
    expect(sqlContent).toContain("'restore_requested'");
    expect(sqlContent).toContain("'restore_completed'");
    expect(sqlContent).toContain("'restore_failed'");
    expect(sqlContent).toContain("'external_missing_detected'");
  });

  it("hardens restore_transaction to prevent restoring a voided transaction that has already been replaced", () => {
    expect(sqlContent).toMatch(
      /FROM\s+public\.transaction_replacement_events\s+WHERE\s+old_transaction_id\s*=\s*p_transaction_id/i
    );
  });

  it("includes all 14 operator verification PASS/FAIL checks in Section E", () => {
    for (let i = 1; i <= 14; i++) {
      expect(sqlContent).toContain(`${i}.`);
    }
    expect(sqlContent).toContain("1. transaction_replacement_events table exists");
    expect(sqlContent).toContain("2. transaction_evidence column evidence_type exists");
    expect(sqlContent).toContain("3. transaction_replacement_events reason CHECK exists");
    expect(sqlContent).toContain("4. replace_voided_slip_transaction is SECURITY DEFINER");
    expect(sqlContent).toContain("5. RPC execute denied to anon/PUBLIC");
    expect(sqlContent).toContain("6. RPC execute allowed to authenticated and service_role");
    expect(sqlContent).toContain("7. Row Level Security enabled on transaction_replacement_events");
    expect(sqlContent).toContain("8. Direct mutations denied on transaction_replacement_events");
    expect(sqlContent).toContain("9. Foreign keys enforce ON DELETE RESTRICT");
    expect(sqlContent).toContain("10. Uniqueness on old_transaction_id");
    expect(sqlContent).toContain("11. Uniqueness on new_transaction_id");
    expect(sqlContent).toContain("12. Ownership integrity trigger exists");
    expect(sqlContent).toContain("13. Function definition references evidence_type and not source_type");
    expect(sqlContent).toContain("14. storage_binary_events action check includes restore actions");
  });
});
