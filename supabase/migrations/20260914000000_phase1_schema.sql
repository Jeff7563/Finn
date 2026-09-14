-- Phase 1 Schema Migration: Money Core
-- Tables: profiles, accounts, categories, people, merchants, transactions

-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. PROFILES
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    display_name TEXT,
    currency TEXT NOT NULL DEFAULT 'THB',
    timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. ACCOUNTS
CREATE TABLE IF NOT EXISTS public.accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    institution TEXT,
    type TEXT NOT NULL CHECK (type IN ('bank', 'cash', 'e_wallet', 'credit_card', 'investment', 'other')),
    masked_number TEXT,
    opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    currency TEXT NOT NULL DEFAULT 'THB',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. CATEGORIES
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    icon TEXT,
    color TEXT,
    is_system BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. PEOPLE
CREATE TABLE IF NOT EXISTS public.people (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    aliases TEXT[] NOT NULL DEFAULT '{}',
    phone TEXT,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. MERCHANTS
CREATE TABLE IF NOT EXISTS public.merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    category_hint TEXT,
    aliases TEXT[] NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. TRANSACTIONS
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN (
        'income', 'expense', 'transfer', 'refund', 'reimbursement',
        'loan_received', 'loan_payment', 'gift', 'investment', 'adjustment'
    )),
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL DEFAULT 'THB',
    transaction_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    description TEXT,
    note TEXT,
    from_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
    to_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
    person_id UUID REFERENCES public.people(id) ON DELETE SET NULL,
    merchant_id UUID REFERENCES public.merchants(id) ON DELETE SET NULL,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    payment_method TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    source_document_id UUID,
    source_slip_id UUID,
    reference_number TEXT,
    tax_income_type TEXT,
    tax_deductible BOOLEAN NOT NULL DEFAULT false,
    tax_year INTEGER,
    confidence NUMERIC(3, 2) NOT NULL DEFAULT 1.00,
    review_status TEXT NOT NULL DEFAULT 'confirmed' CHECK (review_status IN ('pending', 'confirmed', 'corrected', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT check_transfer_accounts CHECK (
        type != 'transfer' OR (
            from_account_id IS NOT NULL AND 
            to_account_id IS NOT NULL AND 
            from_account_id != to_account_id
        )
    )
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_accounts_user_active ON public.accounts(user_id, active);
CREATE INDEX IF NOT EXISTS idx_categories_user_type ON public.categories(user_id, type);
CREATE INDEX IF NOT EXISTS idx_categories_system ON public.categories(is_system);
CREATE INDEX IF NOT EXISTS idx_people_user_normalized ON public.people(user_id, normalized_name);
CREATE INDEX IF NOT EXISTS idx_merchants_user_normalized ON public.merchants(user_id, normalized_name);
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON public.transactions(user_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user_type ON public.transactions(user_id, type);
CREATE INDEX IF NOT EXISTS idx_transactions_from_account ON public.transactions(from_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_to_account ON public.transactions(to_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON public.transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_person ON public.transactions(person_id);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON public.transactions(merchant_id);

-- ROW LEVEL SECURITY (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
CREATE POLICY "Users can view own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Accounts Policies
CREATE POLICY "Users can manage own accounts" ON public.accounts
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Categories Policies
CREATE POLICY "Users can view own and system categories" ON public.categories
    FOR SELECT USING (auth.uid() = user_id OR is_system = true);
CREATE POLICY "Users can manage own categories" ON public.categories
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- People Policies
CREATE POLICY "Users can manage own people" ON public.people
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Merchants Policies
CREATE POLICY "Users can manage own merchants" ON public.merchants
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Transactions Policies
CREATE POLICY "Users can manage own transactions" ON public.transactions
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- SEED SYSTEM DEFAULT CATEGORIES
INSERT INTO public.categories (name, type, is_system) VALUES
-- Income
('Salary', 'income', true),
('Freelance', 'income', true),
('Business', 'income', true),
('Affiliate', 'income', true),
('Commission', 'income', true),
('Refund', 'income', true),
('Investment Income', 'income', true),
('Gift', 'income', true),
('Loan Received', 'income', true),
('Other Income', 'income', true),
-- Expense
('Food', 'expense', true),
('Transport', 'expense', true),
('Fuel', 'expense', true),
('Rent', 'expense', true),
('Utilities', 'expense', true),
('Internet', 'expense', true),
('Phone', 'expense', true),
('Shopping', 'expense', true),
('Entertainment', 'expense', true),
('Education', 'expense', true),
('Health', 'expense', true),
('Pet', 'expense', true),
('Family', 'expense', true),
('Debt', 'expense', true),
('Subscription', 'expense', true),
('Investment', 'expense', true),
('Tax', 'expense', true),
('Donation', 'expense', true),
('Business Expense', 'expense', true),
('Other', 'expense', true)
ON CONFLICT DO NOTHING;
