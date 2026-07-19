"use client";

import { type Filters } from "../lib/data";
import { prettyMonth } from "../lib/month";

// One labelled dropdown. `value` is the current choice, `onChange` reports
// the new choice back up to the Dashboard.
function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-xl border border-black/10 bg-white/70 px-3 py-2 outline-none transition focus:ring-2 focus:ring-emerald-500/40 dark:border-white/15 dark:bg-white/10"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function FilterBar({
  filters,
  setFilters,
  bdrs,
  months,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  bdrs: string[];
  months: string[];
}) {
  const monthOptions = [
    { value: "all", label: "All Time" },
    ...months.map((m) => ({ value: m, label: prettyMonth(m) })),
  ];
  const bdrOptions = [
    { value: "all", label: "All BDRs" },
    ...bdrs.map((b) => ({ value: b, label: b })),
  ];

  const isFiltered =
    filters.month !== "all" || filters.bdr !== "all" || filters.ae !== "all";

  return (
    <div className="mb-6 flex flex-wrap items-end gap-4 rounded-2xl border border-white/50 bg-gradient-to-b from-white/60 to-white/30 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6),0_12px_34px_-16px_rgba(0,0,0,0.18)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.12] dark:from-white/[0.08] dark:to-white/[0.03]">
      <Select
        label="Month"
        value={filters.month}
        onChange={(v) => setFilters({ ...filters, month: v })}
        options={monthOptions}
      />
      <Select
        label="BDR"
        value={filters.bdr}
        onChange={(v) => setFilters({ ...filters, bdr: v })}
        options={bdrOptions}
      />
      {isFiltered && (
        <button
          onClick={() => setFilters({ month: "all", bdr: "all", ae: "all" })}
          className="rounded-xl px-3 py-2 text-sm text-neutral-500 underline-offset-2 transition hover:text-neutral-800 hover:underline dark:hover:text-neutral-200"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
