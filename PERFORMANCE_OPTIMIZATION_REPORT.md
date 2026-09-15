# Finn — Production Navigation Performance Optimization Report

## 1. Executive Summary & Root Cause Analysis

The Finn dashboard navigation experienced noticeable latency despite Vercel serverless functions running in `bom1` alongside Supabase PostgreSQL in `ap-south-1` (Mumbai). A comprehensive architectural audit revealed three primary bottlenecks:

1. **Repeated Auth Round Trips (`auth.getUser()`)**:
   - Every single `DataStore` method (`getAccounts`, `getCategories`, `getPeople`, `getMerchants`, `getTransactions`, etc.) called private `getClient(userId)`.
   - `getClient(userId)` executed `await userClient.auth.getUser()` over HTTP to GoTrue on **every invocation**.
   - Combined with independent `getAuthenticatedUser()` / `requireUser()` calls in `layout.tsx` and the target page, a single navigation to `/transactions` or `/overview` triggered **7 to 10+ round trips to GoTrue**, adding significant latency.

2. **Duplicated Relation Queries & N+1 Patterns**:
   - `/transactions` called `DataStore.getTransactions(user.id)`, `DataStore.getAccounts(user.id)`, `DataStore.getCategories(user.id)`, `DataStore.getPeople(user.id)`, and `DataStore.getMerchants(user.id)`.
   - `DataStore.getTransactions(user.id)` internally fetched accounts, categories, people, and merchants again, causing **double fetching of all relation tables**.
   - `DataStore.getTransactionById(user.id, id)` called `getTransactions(user.id)`, pulling the entire transactions history from PostgreSQL just to find a single row.
   - `/overview`, `/accounts`, `/people`, and `/merchants` experienced similar duplicate queries.

3. **Blocking Server Component Navigation (Frozen UX)**:
   - Dashboard routes lacked Next.js `loading.tsx` files.
   - When users clicked a link in the desktop sidebar or mobile bottom nav, the browser remained completely frozen on the previous route until all server data fetches and HTML streaming finished, making navigation feel sluggish and unresponsive.

---

## 2. Architecture Changes & Implementations

### 2.1 Request-Scoped Auth & Client Deduplication
- **[`src/lib/server/auth.ts`](file:///src/lib/server/auth.ts)**:
  - Wrapped `getAuthenticatedUser` and `requireUser` with React's `cache()` API.
  - In Next.js Server Components, React `cache()` scopes memoization strictly to the lifecycle of a single HTTP request using `AsyncLocalStorage`.
  - Layout and Page now share the exact same resolved user instance. Subsequent calls in the same request resolve in **0ms** without network I/O.
- **[`src/lib/supabase/server.ts`](file:///src/lib/supabase/server.ts)**:
  - Wrapped `createClient()` with React's `cache()`, instantiating only one `@supabase/ssr` server client per request.
- **[`src/lib/server/supabase-data-store.ts`](file:///src/lib/server/supabase-data-store.ts)**:
  - Refactored `getClient(userId)`: Added a fast path that checks `await getAuthenticatedUser()`. If the request-scoped user matches `userId`, it immediately returns `userClient` with the active session cookies.
  - Eliminated repetitive `auth.getUser()` network calls inside DataStore methods.
  - Preserves RLS enforcement at the PostgreSQL database level.
  - No service-role client is used for normal dashboard reads.

### 2.2 Request-Scoped Read Model & Relation Deduplication
- **[`src/lib/server/data-store-interface.ts`](file:///src/lib/server/data-store-interface.ts)**:
  - Added `TransactionsPageData` interface:
    ```typescript
    export interface TransactionsPageData {
      transactions: TransactionWithRelations[];
      accounts: Account[];
      categories: Category[];
      people: Person[];
      merchants: Merchant[];
    }
    ```
  - Added `PreloadedRelations` support to `getTransactions` and `getTransactionById`:
    ```typescript
    getTransactions(userId: string, preloadedRelations?: PreloadedRelations): Promise<TransactionWithRelations[]>;
    getTransactionsPageData(userId: string): Promise<TransactionsPageData>;
    getTransactionById(userId: string, id: string, preloadedRelations?: PreloadedRelations): Promise<TransactionWithRelations | null>;
    ```
- **[`src/lib/server/supabase-data-store.ts`](file:///src/lib/server/supabase-data-store.ts)**:
  - Implemented `getTransactionsPageData(userId)`: Fetches accounts, categories, people, merchants, and raw transactions in a **single concurrent `Promise.all` batch**, then maps relations in memory. Total database queries reduced from 9–10 down to 5 parallel queries.
  - Optimized `getTransactionById(userId, id)`: Queries **only the requested transaction row** by `id` (`eq("id", id).maybeSingle()`) instead of loading all user transactions.
  - Added request-scoped memoization (`getCachedAccounts`, `getCachedCategories`, `getCachedPeople`, `getCachedMerchants`) via React `cache()` so any duplicate calls within the same render pass share in-flight promises.
- **[`src/lib/server/memory-data-store.ts`](file:///src/lib/server/memory-data-store.ts)** & **[`src/lib/server/data-store.ts`](file:///src/lib/server/data-store.ts)**:
  - Implemented `getTransactionsPageData` and `preloadedRelations` support across the facade and test runner store to guarantee 100% interface parity.

### 2.3 Dashboard Route Optimization
- **[`/transactions`](file:///src/app/(dashboard)/transactions/page.tsx)**: Replaced 5 individual DataStore calls with `DataStore.getTransactionsPageData(user.id)` running in parallel with `searchParams`.
- **[`/overview`](file:///src/app/(dashboard)/overview/page.tsx)**: Switched to `DataStore.getTransactionsPageData(user.id)`, eliminating duplicate queries for accounts, categories, people, and merchants.
- **[`/today`](file:///src/app/(dashboard)/today/page.tsx)**: Runs `getTransactionsPageData(user.id)` and `getPendingReviewSlips(user.id)` in parallel. Accounts and transactions share relation data without double fetching.
- **[`/accounts`](file:///src/app/(dashboard)/accounts/page.tsx)**: Loads `getTransactionsPageData(user.id)` in one parallel call.
- **[`/people`](file:///src/app/(dashboard)/people/page.tsx)** & **[`/merchants`](file:///src/app/(dashboard)/merchants/page.tsx)**: Loads consolidated page data in one parallel call.
- **[`/transactions/[id]`](file:///src/app/(dashboard)/transactions/[id]/page.tsx)**: Queries only the specific transaction and preloads relations in memory.

### 2.4 Immediate Visual Feedback & Route-Level Loading UX
Implemented custom `loading.tsx` skeleton interfaces for all dashboard routes:
1. `src/app/(dashboard)/today/loading.tsx`: Greeting header, hero balance card, 3-metric monthly summary grid, transaction item list skeletons.
2. `src/app/(dashboard)/transactions/loading.tsx`: Title with "+ เพิ่มรายการ" button, filter bar, transaction rows.
3. `src/app/(dashboard)/overview/loading.tsx`: 4 summary metric cards, full-width calendar section skeleton, 2-column breakdown card skeletons.
4. `src/app/(dashboard)/accounts/loading.tsx`: Account cards grid with masked number and balance placeholders.
5. `src/app/(dashboard)/people/loading.tsx`: Unified contacts tab switcher, search bar, contact item rows.
6. `src/app/(dashboard)/merchants/loading.tsx`: Merchant contact rows with logo placeholders.
7. `src/app/(dashboard)/categories/loading.tsx`: Category cards grid.
8. `src/app/(dashboard)/review/loading.tsx`: Slip review inbox card skeletons with action buttons.
9. `src/app/(dashboard)/settings/loading.tsx`: Appearance, automation, and user profile card skeletons.

**Design Invariants**:
- Built with Finn Theme V3 design tokens (`bg-surface`, `border-border`, `animate-pulse`, `bg-surface-muted/70`).
- No full-screen spinners or jarring layout shifts.
- Zero horizontal overflow on Desktop and iPhone 11 Pro Max (414×896).
- Standard `next/link` prefetching preserved.

### 2.5 Performance Instrumentation Utility
Created **[`src/lib/server/perf.ts`](file:///src/lib/server/perf.ts)**:
- Function: `measurePerf<T>(name: string, operation: () => Promise<T>, extractCount?: (res: T) => number)`
- Measures duration (`performance.now()`) across major dashboard data operations:
  - `auth.getAuthenticatedUser`
  - `data.accounts`
  - `data.allAccounts`
  - `data.categories`
  - `data.people`
  - `data.merchants`
  - `data.transactions`
  - `data.getTransactionsPageData`
  - `data.getTransactionById`
  - `data.slips`
  - `data.slips.pendingReview`
- **Privacy & Security Invariant**: Never logs financial amounts, balances, tokens, or personal identifiers. Logs only operation names, timings in milliseconds, and non-sensitive record counts (e.g. `[12 items]`).
- Automatically emits a warning if any single database operation exceeds 500ms.

---

## 3. Security & Cache Invariant Audit

| Requirement | Implementation | Status |
| :--- | :--- | :--- |
| **No Cross-User Shared Caching** | React `cache()` is strictly request-scoped and backed by `AsyncLocalStorage`. Caches are destroyed when the HTTP response completes. No Redis or shared in-memory dictionary is used for user data. | ✅ Enforced |
| **Supabase RLS Enforced** | All queries continue using `userClient` with authenticated session cookies. PostgREST enforces row ownership at the PostgreSQL level. | ✅ Enforced |
| **No Service Role for Dashboard** | Normal dashboard reads (`getAccounts`, `getTransactions`, etc.) always execute with user permissions. Service role is strictly restricted to background jobs / ingest token verification. | ✅ Enforced |
| **Private Slip Security** | Slip queries and previews remain scoped by `user_id` and verified against ownership. | ✅ Enforced |
| **No Static Caching of Finance Pages** | All dashboard pages retain dynamic server rendering (`force-dynamic` / request headers). Financial figures are always fresh per request. | ✅ Enforced |

---

## 4. Verification & Automated Test Results

### 4.1 Typecheck
```bash
npm run typecheck
```
**Result**: `tsc --noEmit` exited with code `0`. Zero TypeScript compilation errors.

### 4.2 Lint
```bash
npm run lint
```
**Result**: `next lint` exited with code `0`. Zero ESLint errors, zero warnings.

### 4.3 Unit & Integration Tests (Vitest)
```bash
npm test
```
**Result**: 12 test files passed, **124 tests passed, 0 failed**.
- `tests/perf/deduplication.test.ts`: 4 passed (validates `getTransactionsPageData`, preloaded relations, single-row lookup, and cross-user isolation)
- `tests/perf/perf.test.ts`: 3 passed (validates duration measurement, non-leakage, and error propagation)
- `tests/auth/jwt-clock-skew.test.ts`: 12 passed
- `tests/auth/auth-recovery.test.ts`: 22 passed
- `tests/slip/slip-domain.test.ts`: 25 passed
- `tests/security/adversarial.test.ts`: 14 passed
- `tests/security/slip-security.test.ts`: 9 passed
- `tests/finance/calendar.test.ts`: 9 passed
- `tests/finance/finance.test.ts`: 7 passed
- `tests/supabase/supabase-data-layer.test.ts`: 8 passed
- `tests/theme/theme.test.ts`: 7 passed
- `tests/server/data-store.test.ts`: 4 passed

### 4.4 Production Build
```bash
npm run build
```
**Result**: Next.js 15 optimized production build compiled successfully. All routes (dynamic `ƒ` and static `○`) and route-level loading chunks built with shared JS bundles (~103 kB).

### 4.5 End-to-End Tests (Playwright)
```bash
npx playwright test
```
**Result**: **76 passed (100% pass rate)**.
- **Desktop Chrome**: 38 tests passed
- **iPhone 11 Pro Max (414×896)**: 38 tests passed
- Validated all core financial flows, transactions, accounts, overview calendar, auth recovery, slip processing, theme switching, and responsive layouts without horizontal overflow.
