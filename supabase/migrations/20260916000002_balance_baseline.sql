-- Migration: 20260916000002_balance_baseline.sql
-- Description: Balance Baseline / As-Of Balance Architecture for Accounts
-- 1. Adds balance_as_of TIMESTAMPTZ NULL column to public.accounts.
-- 2. Non-destructive: preserves existing opening_balance column and values.
-- 3. Does NOT automatically populate balance_as_of for existing accounts (they remain NULL / legacy).
-- 4. RLS and ownership policies remain intact. Rerunnable and idempotent.

ALTER TABLE public.accounts
ADD COLUMN IF NOT EXISTS balance_as_of TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.accounts.balance_as_of IS 'Authoritative as-of timestamp for opening_balance baseline. Transactions on or before this timestamp do not affect current balance.';
