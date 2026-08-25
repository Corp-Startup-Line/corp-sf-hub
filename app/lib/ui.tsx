// ============================================================================
// REUSABLE UI BUILDING BLOCKS  (app/lib/ui.tsx)
// Small, dumb pieces used all over the dashboard: money formatting, the
// frosted-glass "Card", progress bars, coloured stage badges, and skeletons.
// ============================================================================
import type { ReactNode } from "react";
import { QUOTA, type Stage } from "./data";

// ---- Money + number formatting -------------------------------------------

// Compact form for big headline numbers: 48000 -> "£48k", 1200000 -> "£1.2M"
export function money(n: number): string {
  const c = QUOTA.currency;
  if (Math.abs(n) >= 1_000_000) return `${c}${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${c}${Math.round(n / 1_000)}k`;
  return `${c}${n}`;
}

// Full form for tables: 48000 -> "$48,000"
export function moneyFull(n: number): string {
  return `${QUOTA.currency}${n.toLocaleString("en-US")}`;
}

// "2026-03-15" -> "15 Mar 2026". Handles the null (no meeting) case.
export function prettyDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ---- The frosted-glass card ----------------------------------------------
// A `tint` swaps the neutral white glass for a coloured glass whose hue matches
// the big number inside it (e.g. an emerald card for a green "Closed Won"). The
// gradient strings are written out in full — not built by string-joining — so
// Tailwind can see and generate every one of them.
export type TintName = "ginger" | "violet" | "sky" | "amber" | "emerald" | "rose" | "slate";

// Coloured glass: a stronger colour along the top edge fading to near-clear at
// the bottom, so it still reads as glass rather than a flat colour block. Each
// entry carries its own dark-mode pair.
const TINT_GRADIENT: Record<TintName, string> = {
  ginger: "from-corgi-ginger/25 to-white/20 dark:from-corgi-ginger/25 dark:to-white/[0.03]",
  violet: "from-violet-500/25 to-white/20 dark:from-violet-500/25 dark:to-white/[0.03]",
  sky: "from-sky-500/25 to-white/20 dark:from-sky-500/25 dark:to-white/[0.03]",
  amber: "from-amber-500/25 to-white/20 dark:from-amber-500/25 dark:to-white/[0.03]",
  emerald: "from-emerald-500/25 to-white/20 dark:from-emerald-500/25 dark:to-white/[0.03]",
  rose: "from-rose-500/25 to-white/20 dark:from-rose-500/25 dark:to-white/[0.03]",
  slate: "from-slate-500/25 to-white/20 dark:from-slate-500/25 dark:to-white/[0.03]",
};

const NEUTRAL_GRADIENT =
  "from-white/70 to-white/35 dark:from-white/[0.10] dark:to-white/[0.03]";

// `active` draws a ginger ring to show it's the currently-selected filter.
export function Card({
  children,
  className = "",
  onClick,
  active = false,
  tint,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  active?: boolean;
  tint?: TintName;
}) {
  const clickable = onClick
    ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.7),0_18px_40px_-14px_rgba(0,0,0,0.28)] active:translate-y-0"
    : "";
  const ring = active
    ? "ring-2 ring-corgi-ginger ring-offset-2 ring-offset-transparent"
    : "";
  const gradient = tint ? TINT_GRADIENT[tint] : NEUTRAL_GRADIENT;
  // Frosted "liquid glass": a top-lit translucent gradient, heavy backdrop blur
  // + saturation to pick up the warm glows behind it, a glossy inset highlight
  // along the top edge, and a soft lifted shadow.
  return (
    <div
      onClick={onClick}
      className={`rounded-3xl border border-white/50 bg-gradient-to-b ${gradient} p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6),0_12px_34px_-14px_rgba(0,0,0,0.22)] backdrop-blur-2xl backdrop-saturate-150 transition-all dark:border-white/[0.12] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10),0_12px_34px_-14px_rgba(0,0,0,0.55)] ${clickable} ${ring} ${className}`}
    >
      {children}
    </div>
  );
}

// ---- Small uppercase section label ---------------------------------------
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
      {children}
    </h2>
  );
}

// ---- Progress bar with red/amber/green colour based on % ------------------
export function progressColor(pct: number): string {
  if (pct >= 100) return "bg-emerald-500";
  if (pct >= 60) return "bg-amber-500";
  return "bg-rose-500";
}

export function ProgressBar({ pct }: { pct: number }) {
  const width = Math.min(pct, 100); // never overflow the track visually
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
      <div
        className={`h-full rounded-full transition-[width] duration-700 ease-out ${progressColor(pct)}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

// ---- Coloured badge for a deal's stage -----------------------------------
const STAGE_STYLES: Record<Stage, string> = {
  "Closed Won": "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  Qualified: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  Quoted: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "Meeting Booked": "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  "Closed Lost": "bg-slate-500/15 text-slate-600 dark:text-slate-400",
};

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STAGE_STYLES[stage]}`}
    >
      {stage}
    </span>
  );
}

// ---- Loading skeleton (grey shimmer shown before data arrives) -----------
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-black/10 dark:bg-white/10 ${className}`}
    />
  );
}
