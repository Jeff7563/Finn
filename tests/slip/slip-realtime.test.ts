import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  subscribeToSlipsChanges,
  SlipsRealtimePayload,
} from "@/lib/slip/realtime/slips-realtime";
import { createClient } from "@/lib/supabase/client";
import { DataStore } from "@/lib/server/data-store";
import fs from "fs";
import path from "path";

describe("Realtime Review Inbox Synchronization", () => {
  const userId = "realtime-user-123";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function createMockSupabase() {
    let changeHandler: ((payload: SlipsRealtimePayload) => void) | null = null;
    let registeredFilter: Record<string, unknown> | null = null;

    const mockChannel = {
      on: vi.fn().mockImplementation((type: string, filter: Record<string, unknown>, callback: any) => {
        if (type === "postgres_changes") {
          registeredFilter = filter;
          changeHandler = callback;
        }
        return mockChannel;
      }),
      subscribe: vi.fn().mockImplementation(() => mockChannel),
      unsubscribe: vi.fn().mockReturnValue(Promise.resolve()),
    };

    const mockSupabase = {
      channel: vi.fn().mockReturnValue(mockChannel),
      removeChannel: vi.fn().mockImplementation(() => Promise.resolve("ok")),
    };

    return {
      mockSupabase,
      mockChannel,
      getRegisteredFilter: () => registeredFilter,
      dispatch: (payload: SlipsRealtimePayload) => {
        if (!changeHandler) {
          throw new Error("No change handler registered on mock channel");
        }
        changeHandler(payload);
      },
    };
  }

  // 1. Review Inbox subscribes to public.slips
  it("1. Review Inbox subscribes to public.slips with user_id filter", () => {
    const { mockSupabase, mockChannel, getRegisteredFilter } = createMockSupabase();
    const onRefresh = vi.fn();

    const cleanup = subscribeToSlipsChanges({
      supabase: mockSupabase as any,
      userId,
      onRefresh,
    });

    expect(mockSupabase.channel).toHaveBeenCalledWith(`slips-realtime-${userId}`);
    expect(mockChannel.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "*",
        schema: "public",
        table: "slips",
        filter: `user_id=eq.${userId}`,
      }),
      expect.any(Function)
    );
    expect(mockChannel.subscribe).toHaveBeenCalled();

    const filter = getRegisteredFilter();
    expect(filter?.schema).toBe("public");
    expect(filter?.table).toBe("slips");
    expect(filter?.filter).toBe(`user_id=eq.${userId}`);

    cleanup();
  });

  // 2. INSERT triggers a debounced refresh
  it("2. INSERT triggers a debounced refresh after specified delay", () => {
    const { mockSupabase, dispatch } = createMockSupabase();
    const onRefresh = vi.fn();

    const cleanup = subscribeToSlipsChanges({
      supabase: mockSupabase as any,
      userId,
      onRefresh,
      debounceMs: 200,
    });

    dispatch({
      eventType: "INSERT",
      schema: "public",
      table: "slips",
      new: {
        id: "slip-insert-1",
        user_id: userId,
        status: "uploaded",
      },
    });

    // Before debounce delay expires (at 100ms)
    vi.advanceTimersByTime(100);
    expect(onRefresh).not.toHaveBeenCalled();

    // After debounce delay expires (200ms total)
    vi.advanceTimersByTime(100);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    cleanup();
  });

  // 3. UPDATE triggers refresh
  it("3. UPDATE triggers refresh when slip extraction or status changes", () => {
    const { mockSupabase, dispatch } = createMockSupabase();
    const onRefresh = vi.fn();

    const cleanup = subscribeToSlipsChanges({
      supabase: mockSupabase as any,
      userId,
      onRefresh,
      debounceMs: 200,
    });

    dispatch({
      eventType: "UPDATE",
      schema: "public",
      table: "slips",
      old: {
        id: "slip-update-1",
        status: "processing",
      },
      new: {
        id: "slip-update-1",
        status: "needs_review",
        extracted_json: {
          amount: 18.0,
          currency: "THB",
        },
      },
    });

    vi.advanceTimersByTime(200);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    cleanup();
  });

  // 4. DELETE triggers refresh
  it("4. DELETE triggers refresh when slip is removed or cleared", () => {
    const { mockSupabase, dispatch } = createMockSupabase();
    const onRefresh = vi.fn();

    const cleanup = subscribeToSlipsChanges({
      supabase: mockSupabase as any,
      userId,
      onRefresh,
      debounceMs: 200,
    });

    dispatch({
      eventType: "DELETE",
      schema: "public",
      table: "slips",
      old: {
        id: "slip-delete-1",
        user_id: userId,
      },
    });

    vi.advanceTimersByTime(200);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    cleanup();
  });

  // 5. Multiple rapid events trigger only one refresh
  it("5. Multiple rapid events trigger only one smooth refresh rather than UI flashing", () => {
    const { mockSupabase, dispatch } = createMockSupabase();
    const onRefresh = vi.fn();

    const cleanup = subscribeToSlipsChanges({
      supabase: mockSupabase as any,
      userId,
      onRefresh,
      debounceMs: 200,
    });

    // Rapid event sequence typical of iPhone ingest pipeline:
    // 1. Ingestion: slip record created (INSERT)
    dispatch({
      eventType: "INSERT",
      schema: "public",
      table: "slips",
      new: { id: "slip-seq-1", status: "uploaded" },
    });

    // 40ms later: Vision extraction started
    vi.advanceTimersByTime(40);
    dispatch({
      eventType: "UPDATE",
      schema: "public",
      table: "slips",
      new: { id: "slip-seq-1", status: "processing" },
    });

    // 60ms later: Vision OCR completed & parsed
    vi.advanceTimersByTime(60);
    dispatch({
      eventType: "UPDATE",
      schema: "public",
      table: "slips",
      new: { id: "slip-seq-1", status: "processing", extracted_json: { amount: 18.0 } },
    });

    // 50ms later: Confidence engine finalized -> needs_review
    vi.advanceTimersByTime(50);
    dispatch({
      eventType: "UPDATE",
      schema: "public",
      table: "slips",
      new: { id: "slip-seq-1", status: "needs_review", overall_confidence: 0.65 },
    });

    // At this point, 150ms have elapsed since first event, 50ms since last event
    expect(onRefresh).not.toHaveBeenCalled();

    // Advance 200ms from the last event (total 350ms elapsed)
    vi.advanceTimersByTime(200);

    // Exactly one refresh fired! No flashing.
    expect(onRefresh).toHaveBeenCalledTimes(1);

    cleanup();
  });

  // 6. Channel is removed on unmount & cancels pending timers
  it("6. Channel is removed on unmount and prevents memory leaks or phantom refreshes", () => {
    const { mockSupabase, mockChannel, dispatch } = createMockSupabase();
    const onRefresh = vi.fn();

    const cleanup = subscribeToSlipsChanges({
      supabase: mockSupabase as any,
      userId,
      onRefresh,
      debounceMs: 200,
    });

    // Dispatch event that queues a refresh in 200ms
    dispatch({
      eventType: "INSERT",
      schema: "public",
      table: "slips",
      new: { id: "slip-unmount-1" },
    });

    // Advance 50ms (before timer expires) and unmount/cleanup
    vi.advanceTimersByTime(50);
    cleanup();

    // Verify channel was removed
    expect(mockSupabase.removeChannel).toHaveBeenCalledWith(mockChannel);

    // Advance past original timer duration
    vi.advanceTimersByTime(300);

    // Verify onRefresh was NEVER called after cleanup
    expect(onRefresh).not.toHaveBeenCalled();
  });

  // 7. No service-role key is exposed client-side
  it("7. Client-side browser client uses anon key only, never exposing SUPABASE_SERVICE_ROLE_KEY", () => {
    const browserClientFile = path.resolve(__dirname, "../../src/lib/supabase/client.ts");
    const content = fs.readFileSync(browserClientFile, "utf-8");

    // Client bundle must not reference service role
    expect(content).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(content).not.toContain("service_role");

    // Must use public anon key and URL
    expect(content).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(content).toContain("NEXT_PUBLIC_SUPABASE_URL");

    // Instantiating createClient does not leak service role
    const client = createClient();
    expect(client).toBeDefined();
  });

  // 8. Idempotent Realtime Migration File Integrity
  it("8. Migration enables REPLICA IDENTITY FULL and adds public.slips to supabase_realtime idempotently", () => {
    const migrationFile = path.resolve(
      __dirname,
      "../../supabase/migrations/20260915000000_realtime_slips.sql"
    );
    expect(fs.existsSync(migrationFile)).toBe(true);

    const sql = fs.readFileSync(migrationFile, "utf-8");
    expect(sql).toContain("ALTER TABLE public.slips REPLICA IDENTITY FULL;");
    expect(sql).toContain("ALTER PUBLICATION supabase_realtime ADD TABLE public.slips;");
    expect(sql).toContain("pg_publication");
    expect(sql).toContain("supabase_realtime");
  });

  // 9. Existing review/reprocess/edit flows still work
  it("9. DataStore and Review Inbox operations maintain consistent state with realtime updates", async () => {
    const testUserId = "realtime-datastore-user";
    DataStore.reset();

    // 1. Initial slip created (e.g. from Shortcut upload)
    const slip = await DataStore.createSlip(testUserId, {
      storage_path: "shortcuts/slip-rt-1.jpg",
      file_hash_sha256: "hash-rt-1",
      mime_type: "image/jpeg",
      file_size: 2048,
      source: "ios_shortcut",
      status: "needs_review",
      extracted_json: {
        amount: 250.0,
        currency: "THB",
        sender: { name: "สมชาย" },
        receiver: { name: "ร้านค้า A" },
        fieldConfidence: { amount: 0.95 },
      },
    });

    const pending = await DataStore.getPendingReviewSlips(testUserId);
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe(slip.id);
    expect(pending[0].extracted_json?.amount).toBe(250.0);

    // 2. Simulate Vision update arriving in background
    await DataStore.updateSlip(testUserId, slip.id, {
      status: "needs_review",
      extracted_json: {
        amount: 250.0,
        currency: "THB",
        sender: { name: "สมชาย", bank: "KBANK", accountMasked: "xxx-1234" },
        receiver: { name: "ร้านค้า A", bank: "SCB", accountMasked: "xxx-5678" },
        fieldConfidence: { amount: 0.95 },
      },
      overall_confidence: 0.85,
    });

    const updatedPending = await DataStore.getPendingReviewSlips(testUserId);
    expect(updatedPending.length).toBe(1);
    expect(updatedPending[0].extracted_json?.sender?.bank).toBe("KBANK");
    expect(updatedPending[0].overall_confidence).toBe(0.85);

    // 3. Confirming the slip marks it created and removes it from pending review
    await DataStore.updateSlip(testUserId, slip.id, {
      status: "created",
    });

    const finalPending = await DataStore.getPendingReviewSlips(testUserId);
    expect(finalPending.length).toBe(0);
  });
});
