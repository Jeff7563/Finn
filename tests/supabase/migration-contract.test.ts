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

describe("Migration Contract Tests: 20260924000001_source_slip_active_uniqueness.sql", () => {
  const hotfixPath = path.resolve(
    process.cwd(),
    "supabase/migrations/20260924000001_source_slip_active_uniqueness.sql"
  );
  const hotfixSql = fs.readFileSync(hotfixPath, "utf-8");

  it("hotfix migration file exists and is wrapped in an explicit transaction", () => {
    expect(fs.existsSync(hotfixPath)).toBe(true);
    expect(hotfixSql).toMatch(/^\s*BEGIN;/m);
    expect(hotfixSql).toMatch(/COMMIT;\s*$/m);
  });

  it("drops old lifetime-unique index idx_transactions_source_slip_id_unique", () => {
    expect(hotfixSql).toContain("DROP INDEX IF EXISTS public.idx_transactions_source_slip_id_unique;");
  });

  it("creates active-only unique index with predicate (source_slip_id IS NOT NULL AND voided_at IS NULL)", () => {
    expect(hotfixSql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+idx_transactions_source_slip_id_unique\s+ON\s+public\.transactions\s*\(\s*source_slip_id\s*\)\s+WHERE\s+source_slip_id\s+IS\s+NOT\s+NULL\s+AND\s+voided_at\s+IS\s+NULL;/i
    );
  });

  it("updates confirm_slip_transaction RPC with active-only source_slip_id fallback query", () => {
    expect(hotfixSql).toContain("CREATE OR REPLACE FUNCTION public.confirm_slip_transaction");
    expect(hotfixSql).toMatch(/WHERE\s+source_slip_id\s*=\s*p_slip_id\s+AND\s+user_id\s*=\s*p_user_id\s+AND\s+voided_at\s+IS\s+NULL/i);
    expect(hotfixSql).toMatch(/ORDER\s+BY\s+created_at\s+DESC\s+LIMIT\s+1/i);
  });

  it("preserves canonical linked_transaction_id priority in confirm_slip_transaction", () => {
    expect(hotfixSql).toMatch(/v_slip\.linked_transaction_id\s+IS\s+NOT\s+NULL/i);
    expect(hotfixSql).toMatch(/WHERE\s+id\s*=\s*v_slip\.linked_transaction_id\s+AND\s+user_id\s*=\s*p_user_id/i);
  });

  it("hardens confirm_slip_transaction RPC execute permissions", () => {
    expect(hotfixSql).toContain("REVOKE ALL ON FUNCTION public.confirm_slip_transaction");
    expect(hotfixSql).toContain("FROM PUBLIC");
    expect(hotfixSql).toContain("FROM anon");
    expect(hotfixSql).toContain("TO authenticated");
    expect(hotfixSql).toContain("TO service_role");
  });

  it("includes all 7 operator verification PASS/FAIL checks in Section 4", () => {
    expect(hotfixSql).toContain("1. old index exists with new active-only predicate");
    expect(hotfixSql).toContain("2. index is UNIQUE");
    expect(hotfixSql).toContain("3. predicate includes source_slip_id IS NOT NULL");
    expect(hotfixSql).toContain("4. predicate includes voided_at IS NULL");
    expect(hotfixSql).toContain("5. no lifetime-unique source_slip index remains");
    expect(hotfixSql).toContain("6. replacement RPC still exists");
    expect(hotfixSql).toContain("7. restore replacement guard still exists");
  });

  it("includes production-safe invariant assertion query (active_count <= 1)", () => {
    expect(hotfixSql).toContain("COUNT(*) FILTER (WHERE voided_at IS NULL) AS active_count");
    expect(hotfixSql).toContain("HAVING COUNT(*) FILTER (WHERE voided_at IS NULL) > 1");
    expect(hotfixSql).toContain("active_count <= 1");
  });
});

