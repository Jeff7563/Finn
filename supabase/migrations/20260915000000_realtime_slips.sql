-- Migration: Enable Supabase Realtime for public.slips
-- Ensures public.slips is included in the Supabase Realtime publication (supabase_realtime).
-- Authoritative RLS policies are preserved so users only receive their own slip changes.

-- 1. Set REPLICA IDENTITY to FULL on public.slips
-- This ensures that UPDATE and DELETE payloads contain all row columns (notably user_id),
-- allowing Supabase Realtime to evaluate RLS and column-level filters (user_id=eq.X) accurately.
ALTER TABLE public.slips REPLICA IDENTITY FULL;

-- 2. Add public.slips to supabase_realtime publication idempotently
DO $$
BEGIN
    -- Verify supabase_realtime publication exists
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        -- Check if public.slips is already a member of the publication
        IF NOT EXISTS (
            SELECT 1 
            FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' 
              AND schemaname = 'public' 
              AND tablename = 'slips'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.slips;
        END IF;
    END IF;
END $$;
