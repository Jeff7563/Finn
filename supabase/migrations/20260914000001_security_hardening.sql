-- Phase 1 Security Hardening Migration
-- Enforces database-level foreign key ownership integrity and value bounds

-- 1. FOREIGN-KEY OWNERSHIP INTEGRITY TRIGGER
-- Prevents User A from referencing User B's accounts, categories, people, or merchants in transactions.
CREATE OR REPLACE FUNCTION public.check_transaction_ownership()
RETURNS TRIGGER AS $$
BEGIN
    -- Check from_account_id belongs to the same user
    IF NEW.from_account_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.accounts
            WHERE id = NEW.from_account_id AND user_id = NEW.user_id
        ) THEN
            RAISE EXCEPTION 'Security violation: foreign source account does not belong to user %', NEW.user_id;
        END IF;
    END IF;

    -- Check to_account_id belongs to the same user
    IF NEW.to_account_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.accounts
            WHERE id = NEW.to_account_id AND user_id = NEW.user_id
        ) THEN
            RAISE EXCEPTION 'Security violation: foreign destination account does not belong to user %', NEW.user_id;
        END IF;
    END IF;

    -- Check category_id belongs to user OR is a system category
    IF NEW.category_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.categories
            WHERE id = NEW.category_id AND (user_id = NEW.user_id OR is_system = true)
        ) THEN
            RAISE EXCEPTION 'Security violation: foreign category does not belong to user %', NEW.user_id;
        END IF;
    END IF;

    -- Check person_id belongs to user
    IF NEW.person_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.people
            WHERE id = NEW.person_id AND user_id = NEW.user_id
        ) THEN
            RAISE EXCEPTION 'Security violation: foreign person does not belong to user %', NEW.user_id;
        END IF;
    END IF;

    -- Check merchant_id belongs to user
    IF NEW.merchant_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.merchants
            WHERE id = NEW.merchant_id AND user_id = NEW.user_id
        ) THEN
            RAISE EXCEPTION 'Security violation: foreign merchant does not belong to user %', NEW.user_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_check_transaction_ownership ON public.transactions;
CREATE TRIGGER trg_check_transaction_ownership
BEFORE INSERT OR UPDATE ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.check_transaction_ownership();

-- 2. MAXIMUM AMOUNT & FINITENESS CHECK CONSTRAINT
ALTER TABLE public.transactions
DROP CONSTRAINT IF EXISTS check_max_amount;

ALTER TABLE public.transactions
ADD CONSTRAINT check_max_amount CHECK (amount > 0 AND amount <= 999999999999.99);

-- 3. PROFILES DELETE POLICY HARDENING
-- Ensure profiles cannot be deleted directly by clients
DROP POLICY IF EXISTS "Users cannot delete profile" ON public.profiles;
CREATE POLICY "Users cannot delete profile" ON public.profiles
    FOR DELETE USING (false);
