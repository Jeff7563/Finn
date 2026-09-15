"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

export interface SlipsRealtimePayload {
  eventType: "INSERT" | "UPDATE" | "DELETE" | string;
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
  schema: string;
  table: string;
  commit_timestamp?: string;
}

export interface SlipsRealtimeClient {
  channel: (name: string) => RealtimeChannel;
  removeChannel: (channel: RealtimeChannel) => unknown;
}

export interface SlipsSubscriptionOptions {
  supabase?: SlipsRealtimeClient | SupabaseClient;
  userId?: string;
  onRefresh: () => void;
  debounceMs?: number;
  onEvent?: (payload: SlipsRealtimePayload) => void;
}

/**
 * Subscribes to Supabase Realtime changes on public.slips table.
 * Listens for INSERT, UPDATE, and DELETE events filtered by user_id.
 * Batches rapid events (e.g. from iPhone upload -> Vision parse -> Confidence engine)
 * into a single debounced onRefresh() invocation (default 200ms).
 *
 * Returns an unsubscribe cleanup function.
 */
export function subscribeToSlipsChanges(options: SlipsSubscriptionOptions): () => void {
  const {
    supabase = createClient(),
    userId,
    onRefresh,
    debounceMs = 200,
    onEvent,
  } = options;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const triggerDebouncedRefresh = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      onRefresh();
    }, debounceMs);
  };

  const channelName = `slips-realtime-${userId || "authenticated"}`;
  const channel: RealtimeChannel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "slips",
        ...(userId ? { filter: `user_id=eq.${userId}` } : {}),
      },
      (payload: SlipsRealtimePayload) => {
        // Safe dispatch without logging sensitive financial fields
        onEvent?.(payload);
        triggerDebouncedRefresh();
      }
    )
    .subscribe();

  return () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    supabase.removeChannel(channel);
  };
}

export interface UseSlipsRealtimeOptions {
  userId?: string;
  debounceMs?: number;
  onRefresh?: () => void;
  supabaseClient?: SlipsRealtimeClient | SupabaseClient;
}

/**
 * React hook to synchronize Review Inbox with Supabase Realtime.
 * Automatically triggers Next.js router.refresh() when bank slips are
 * uploaded, parsed, or modified, without full browser reload.
 */
export function useSlipsRealtime(options: UseSlipsRealtimeOptions = {}) {
  const { userId, debounceMs = 200, onRefresh, supabaseClient } = options;
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [justUpdated, setJustUpdated] = useState(false);
  const updatedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleRefresh = () => {
      startTransition(() => {
        if (onRefresh) {
          onRefresh();
        } else {
          router.refresh();
        }
      });

      setJustUpdated(true);
      if (updatedTimeoutRef.current) {
        clearTimeout(updatedTimeoutRef.current);
      }
      updatedTimeoutRef.current = setTimeout(() => {
        setJustUpdated(false);
      }, 2500);
    };

    const cleanup = subscribeToSlipsChanges({
      supabase: supabaseClient,
      userId,
      debounceMs,
      onRefresh: handleRefresh,
    });

    return () => {
      if (updatedTimeoutRef.current) {
        clearTimeout(updatedTimeoutRef.current);
      }
      cleanup();
    };
  }, [userId, debounceMs, onRefresh, router, supabaseClient]);

  return { justUpdated };
}

export interface FinancialRealtimeOptions {
  supabase?: SlipsRealtimeClient | SupabaseClient;
  userId?: string;
  onRefresh: () => void;
  debounceMs?: number;
}

/**
 * Subscribes to financial changes across slips, transactions, and accounts.
 * Debounces rapid updates to trigger a smooth UI refresh.
 */
export function subscribeToFinancialChanges(options: FinancialRealtimeOptions): () => void {
  const {
    supabase = createClient(),
    userId,
    onRefresh,
    debounceMs = 200,
  } = options;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const triggerDebouncedRefresh = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      onRefresh();
    }, debounceMs);
  };

  const channelName = `financial-realtime-${userId || "auth"}`;
  const filter = userId ? `user_id=eq.${userId}` : undefined;

  const channel: RealtimeChannel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "slips",
        ...(filter ? { filter } : {}),
      },
      () => triggerDebouncedRefresh()
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "transactions",
        ...(filter ? { filter } : {}),
      },
      () => triggerDebouncedRefresh()
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "accounts",
        ...(filter ? { filter } : {}),
      },
      () => triggerDebouncedRefresh()
    )
    .subscribe();

  return () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    supabase.removeChannel(channel);
  };
}

/**
 * Global Realtime component mounted in DashboardLayout.
 * Synchronizes Today, Transactions, Accounts, and Review automatically when data changes.
 */
export function RealtimeDashboardSync({ userId }: { userId?: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!userId) return;

    const cleanup = subscribeToFinancialChanges({
      userId,
      onRefresh: () => {
        startTransition(() => {
          router.refresh();
        });
      },
    });

    return () => {
      cleanup();
    };
  }, [userId, router]);

  return null;
}
