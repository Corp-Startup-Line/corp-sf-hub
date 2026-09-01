// ============================================================================
// PER-BDR TARGETS BY TENURE TIER  (app/lib/repTargets.ts)
// ----------------------------------------------------------------------------
// Ported from the legacy dashboard's source of truth (public/sf/index.html:
// the TGT constant). "Ramp" = a rep's first 30 days — the same cutoff
// /api/sf-metrics uses to set each rep's `stage`. Shared by app/dashboard
// (the team-wide SFCR metrics) and app/career-progression (a rep's own
// standing against these same numbers), so the two pages can never drift.
// ============================================================================

// Dials: anchored per DAY. Weekly = daily × 5 dialing days; monthly = weekly ×
// weeks-in-month.
export const DIAL_TARGET_PER_DAY = { ramp: 1000, steady: 500 } as const;

// Demos booked: anchored per WEEK (unlike dials). Daily = weekly ÷ 5; monthly
// = weekly × weeks.
export const DEMO_TARGET_PER_WEEK = { ramp: 15, steady: 10 } as const;

// Show rate: a ratio, not a count — same target regardless of tier framing
// (ramp gets a LOWER bar here, unlike dials/demos, since new reps get a grace
// period on meeting quality while they're still building pipeline).
export const SHOW_RATE_TARGET = { ramp: 0.65, steady: 0.7 } as const;

export const DIALING_DAYS_PER_WEEK = 5;
