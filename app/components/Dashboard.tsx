"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getProspects,
  filterProspects,
  computeFunnel,
  computeDealValues,
  computeQuota,
  computeRepStats,
  computeKpis,
  computeMonthlyTrend,
  computeInsights,
  loadBdrRoster,
  saveBdrRoster,
  DEFAULT_BDRS,
  DEFAULT_FILTERS,
  type Filters,
  type Stage,
} from "../lib/data";
import { Skeleton } from "../lib/ui";
import Header from "./Header";
import FilterBar from "./FilterBar";
import ManageBdrs from "./ManageBdrs";
import { KpiStrip, InsightsPanel, Funnel, DealValue, QuotaAndRevenue, RepCards } from "./Sections";
import { WonTrend, RepLeaderboard } from "./Charts";
import ProspectsTable from "./ProspectsTable";

export default function Dashboard() {
  // ---- Shared state (the "controls" that change what's shown) ----
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [team, setTeam] = useState<"bdr" | "ae">("bdr");
  const [sortByWon, setSortByWon] = useState(false);
  const [wonOnly, setWonOnly] = useState(false);
  const [stageFilter, setStageFilter] = useState<Stage | "all">("all");
  const [loading, setLoading] = useState(true);

  // The live BDR roster. Seeded from the default list, then replaced with the
  // saved roster from the browser after mount (done in an effect to avoid a
  // server/client mismatch). Editing it via "Manage BDRs" persists to storage.
  const [bdrs, setBdrs] = useState<string[]>([...DEFAULT_BDRS]);
  useEffect(() => {
    setBdrs(loadBdrRoster());
  }, []);

  function updateBdrs(next: string[]) {
    setBdrs(next);
    saveBdrRoster(next);
    // If the currently-filtered BDR was removed, drop back to "all".
    if (filters.bdr !== "all" && !next.includes(filters.bdr)) {
      setFilters({ ...filters, bdr: "all" });
    }
  }

  // Pretend to "load data" for a moment so the skeletons are visible. When you
  // switch to a real API, this is where you'd fetch instead.
  useEffect(() => {
    const id = setTimeout(() => setLoading(false), 600);
    return () => clearTimeout(id);
  }, []);

  // ---- Derived data (recalculated only when inputs change) ----
  const allRows = useMemo(() => getProspects(), []);
  const rows = useMemo(() => filterProspects(allRows, filters), [allRows, filters]);
  const funnel = useMemo(() => computeFunnel(rows), [rows]);
  const values = useMemo(() => computeDealValues(rows), [rows]);
  const quota = useMemo(() => computeQuota(rows, filters), [rows, filters]);
  const repStats = useMemo(() => computeRepStats(rows, team, bdrs), [rows, team, bdrs]);
  const kpis = useMemo(() => computeKpis(rows), [rows]);
  const trend = useMemo(() => computeMonthlyTrend(rows), [rows]);
  const insights = useMemo(() => computeInsights(rows), [rows]);

  // Which rep (if any) is selected for the current team tab.
  const selectedRep = team === "bdr" ? filters.bdr : filters.ae;

  // Click a rep card → filter to them; click the same one again → clear.
  function selectRep(name: string) {
    const key = team === "bdr" ? "bdr" : "ae";
    setFilters({ ...filters, [key]: filters[key] === name ? "all" : name });
  }

  // Click a funnel card → filter deals by that stage; same one again → clear.
  function selectStage(f: Stage | "all") {
    setStageFilter((prev) => (f === "all" || prev === f ? "all" : f));
  }

  function clearAll() {
    setFilters(DEFAULT_FILTERS);
    setStageFilter("all");
    setWonOnly(false);
    setSortByWon(false);
  }

  const anyFilter =
    filters.month !== "all" ||
    filters.bdr !== "all" ||
    filters.ae !== "all" ||
    stageFilter !== "all" ||
    wonOnly;

  // One BDR in focus → hide the cross-rep comparison sections.
  const singleBdr = filters.bdr !== "all";

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <Header />
      <div className="mb-3 flex justify-end">
        <ManageBdrs bdrs={bdrs} onChange={updateBdrs} />
      </div>
      <FilterBar filters={filters} setFilters={setFilters} bdrs={bdrs} />

      {loading ? (
        <LoadingState />
      ) : (
        <>
          <KpiStrip kpis={kpis} />
          <InsightsPanel insights={insights} />
          <Funnel funnel={funnel} activeStage={stageFilter} onSelect={selectStage} />
          <DealValue
            values={values}
            sortByWon={sortByWon}
            wonOnly={wonOnly}
            onToggleSort={() => setSortByWon((v) => !v)}
            onToggleWonOnly={() => setWonOnly((v) => !v)}
          />
          <QuotaAndRevenue
            quota={quota}
            confirmed={values.confirmed}
            perBdr={filters.bdr !== "all"}
          />

          {/* The leaderboard and per-rep breakdown are for comparing reps to
              each other, so they only make sense when viewing the whole team.
              Once a single BDR is in focus, hide them and let the Won-value
              trend (their own numbers) take the full width. */}
          {singleBdr ? (
            <section className="mb-10">
              <WonTrend data={trend} />
            </section>
          ) : (
            <>
              <section className="mb-10 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <WonTrend data={trend} />
                <RepLeaderboard stats={repStats} teamLabel={team === "bdr" ? "BDR" : "AE"} />
              </section>

              <RepCards
                team={team}
                setTeam={setTeam}
                stats={repStats}
                selected={selectedRep}
                onSelect={selectRep}
              />
            </>
          )}

          {anyFilter && <ActiveFilters {...{ filters, stageFilter, wonOnly, clearAll }} />}

          <ProspectsTable
            rows={rows}
            wonOnly={wonOnly}
            sortByWon={sortByWon}
            stageFilter={stageFilter}
            onStageFilter={selectStage}
          />
        </>
      )}
    </main>
  );
}

// Small strip showing which section-driven filters are active, with a clear button.
function ActiveFilters({
  filters,
  stageFilter,
  wonOnly,
  clearAll,
}: {
  filters: Filters;
  stageFilter: Stage | "all";
  wonOnly: boolean;
  clearAll: () => void;
}) {
  const chips: string[] = [];
  if (filters.month !== "all") chips.push(filters.month);
  if (filters.bdr !== "all") chips.push(`BDR: ${filters.bdr}`);
  if (filters.ae !== "all") chips.push(`AE: ${filters.ae}`);
  if (stageFilter !== "all") {
    chips.push(`Stage: ${stageFilter}`);
  }
  if (wonOnly) chips.push("Won deals only");

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-neutral-500 dark:text-neutral-400">Filtering deals by:</span>
      {chips.map((c) => (
        <span
          key={c}
          className="rounded-full bg-corgi-ginger/15 px-3 py-1 text-corgi-ginger"
        >
          {c}
        </span>
      ))}
      <button
        onClick={clearAll}
        className="ml-1 rounded-full px-2 py-1 text-neutral-500 underline-offset-2 transition hover:text-neutral-800 hover:underline dark:hover:text-neutral-200"
      >
        Clear all ✕
      </button>
    </div>
  );
}

// Grey placeholder shown for the brief "loading" moment.
function LoadingState() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
