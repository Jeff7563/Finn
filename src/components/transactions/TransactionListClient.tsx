"use client";

import React, { useMemo, useState } from "react";
import {
  Account,
  Category,
  Merchant,
  Person,
  TransactionType,
  TransactionWithRelations,
} from "@/types/finance";
import { filterTransactions, sortTransactionsChronological } from "@/lib/finance/transactions";
import { TransactionItem } from "@/components/ui/TransactionItem";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDayHeadingThai } from "@/lib/finance/formatters";
import {
  Search,
  Filter,
  X,
  ArrowUpDown,
} from "lucide-react";

interface TransactionListClientProps {
  initialTransactions: TransactionWithRelations[];
  accounts: Account[];
  categories: Category[];
  people: Person[];
  merchants: Merchant[];
  initialAccountId?: string;
  initialDate?: string;
}

export function TransactionListClient({
  initialTransactions,
  accounts,
  categories,
  people,
  merchants,
  initialAccountId,
  initialDate,
}: TransactionListClientProps) {
  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState<TransactionType | "all">("all");
  const [selectedAccountId, setSelectedAccountId] = useState(initialAccountId || "");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [selectedMerchantId, setSelectedMerchantId] = useState("");
  const [startDate, setStartDate] = useState(initialDate || "");
  const [endDate, setEndDate] = useState(initialDate || "");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [showFilters, setShowFilters] = useState(Boolean(initialDate));

  const activeFilterCount =
    (selectedType !== "all" ? 1 : 0) +
    (selectedAccountId ? 1 : 0) +
    (selectedCategoryId ? 1 : 0) +
    (selectedPersonId ? 1 : 0) +
    (selectedMerchantId ? 1 : 0) +
    (startDate ? 1 : 0) +
    (endDate ? 1 : 0);

  const clearFilters = () => {
    setSearch("");
    setSelectedType("all");
    setSelectedAccountId("");
    setSelectedCategoryId("");
    setSelectedPersonId("");
    setSelectedMerchantId("");
    setStartDate("");
    setEndDate("");
  };

  const filteredTransactions = useMemo(() => {
    const filtered = filterTransactions(initialTransactions, {
      search,
      type: selectedType,
      accountId: selectedAccountId || undefined,
      categoryId: selectedCategoryId || undefined,
      personId: selectedPersonId || undefined,
      merchantId: selectedMerchantId || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    });

    return sortTransactionsChronological(filtered, sortOrder);
  }, [
    initialTransactions,
    search,
    selectedType,
    selectedAccountId,
    selectedCategoryId,
    selectedPersonId,
    selectedMerchantId,
    startDate,
    endDate,
    sortOrder,
  ]);

  // Group transactions by date heading
  const groupedTransactions = useMemo(() => {
    const groups: { heading: string; items: TransactionWithRelations[] }[] = [];
    let currentHeading = "";
    let currentGroup: TransactionWithRelations[] = [];

    for (const tx of filteredTransactions) {
      const heading = formatDayHeadingThai(tx.transaction_date);
      if (heading !== currentHeading) {
        if (currentGroup.length > 0) {
          groups.push({ heading: currentHeading, items: currentGroup });
        }
        currentHeading = heading;
        currentGroup = [tx];
      } else {
        currentGroup.push(tx);
      }
    }
    if (currentGroup.length > 0) {
      groups.push({ heading: currentHeading, items: currentGroup });
    }

    return groups;
  }, [filteredTransactions]);

  const typeLabels: { key: TransactionType | "all"; label: string }[] = [
    { key: "all", label: "ทั้งหมด" },
    { key: "expense", label: "รายจ่าย" },
    { key: "income", label: "รายรับ" },
    { key: "transfer", label: "โอน" },
  ];

  return (
    <div className="space-y-4">
      {/* Search & Top Action Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหารายการ, ร้านค้า, บุคคล, จำนวนเงิน..."
            className="w-full pl-9 pr-8 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 p-0.5"
              aria-label="ล้างการค้นหา"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium border transition-colors ${
              showFilters || activeFilterCount > 0
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>ตัวกรอง</span>
            {activeFilterCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-white text-slate-900 text-[10px] font-bold flex items-center justify-center ml-0.5">
                {activeFilterCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
            className="p-2 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
            title={`เรียงลำดับ: ${sortOrder === "desc" ? "ล่าสุดก่อน" : "เก่าสุดก่อน"}`}
            aria-label="สลับลำดับเวลา"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Quick Type Pill Filter */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
        {typeLabels.map((t) => (
          <button
            key={t.key}
            onClick={() => setSelectedType(t.key)}
            className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors ${
              selectedType === t.key
                ? "bg-slate-900 text-white font-semibold"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        ))}
        {activeFilterCount > 0 && (
          <button
            onClick={clearFilters}
            className="text-xs text-rose-600 hover:text-rose-700 font-semibold px-2 py-1 ml-auto"
          >
            ล้างตัวกรอง
          </button>
        )}
      </div>

      {/* Expanded Filters Drawer / Panel */}
      {showFilters && (
        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-4 animate-in fade-in">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {/* Account */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                บัญชี (Account)
              </label>
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                <option value="">ทุกบัญชี</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Category */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                หมวดหมู่ (Category)
              </label>
              <select
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                <option value="">ทุกหมวดหมู่</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.type === "expense" ? "รายจ่าย" : "รายรับ"})
                  </option>
                ))}
              </select>
            </div>

            {/* Person */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                บุคคล (Person)
              </label>
              <select
                value={selectedPersonId}
                onChange={(e) => setSelectedPersonId(e.target.value)}
                className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                <option value="">ทุกคน</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Merchant */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                ร้านค้า (Merchant)
              </label>
              <select
                value={selectedMerchantId}
                onChange={(e) => setSelectedMerchantId(e.target.value)}
                className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                <option value="">ทุกร้านค้า</option>
                {merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                ตั้งแต่วันที่
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
              </input>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                ถึงวันที่
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
              </input>
            </div>
          </div>
        </div>
      )}

      {/* Results Counter */}
      <div className="flex items-center justify-between text-xs text-slate-400 px-1">
        <span>
          แสดง {filteredTransactions.length} จากทั้งหมด {initialTransactions.length} รายการ
        </span>
      </div>

      {/* Transactions List Grouped by Date */}
      {filteredTransactions.length === 0 ? (
        <EmptyState
          title="ยังไม่มีรายการ"
          description="เริ่มจากเพิ่มรายรับ รายจ่าย หรือโอนเงินระหว่างบัญชี"
          actionHref="/transactions/new"
          actionLabel="+ เพิ่มรายการ"
        />
      ) : (
        <div className="space-y-4">
          {groupedTransactions.map((group) => (
            <div key={group.heading} className="space-y-1.5">
              <h3 className="text-xs font-semibold text-slate-500 px-1">
                {group.heading}
              </h3>
              <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden divide-y divide-slate-100">
                {group.items.map((tx) => (
                  <TransactionItem key={tx.id} transaction={tx} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
