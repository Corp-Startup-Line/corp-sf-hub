"use client";

// Career Progression — a rep's own standing, built on the identity pieces
// added in app/api/me (Google sign-in → HubSpot owner) and app/api/impersonate
// (an admin viewing as any rep). Same SFCR visual language as app/dashboard.

import { useEffect, useMemo, useState } from "react";
import { getProspects, type Prospect } from "../lib/data";
import { DIAL_TARGET_PER_DAY, DEMO_TARGET_PER_WEEK, SHOW_RATE_TARGET } from "../lib/repTargets";

type Me = {
  authenticated: boolean;
  ownerId?: string | null;
  ownerName?: string | null;
  impersonating?: boolean;
};

// Only BDRs carry activity fields (dials/demos/showRate/stage) — AEs in
// /api/sf-metrics track ARR only (see app/dashboard/page.tsx's AeMetric note).
type RepMetric = {
  id?: string | null;
  name?: string;
  dials?: number;
  demosWk?: number;
  showRate?: number;
  stage?: "ramp" | "steady";
};
type SfMetrics = { reps?: RepMetric[]; aes?: RepMetric[] };

const same = (a?: string | null, b?: string | null) =>
  (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();

// "$642K" / "$1.24M" — matches the formatting used elsewhere on the SFCR pages.
function fmtArr(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `$${Number.isInteger(m) ? m.toFixed(0) : m.toFixed(2)}M`;
  }
  const k = n / 1000;
  return `$${Number.isInteger(k) ? String(k) : k.toFixed(1)}K`;
}

const colors = {
  bg: "#F7F4EF",
  ink: "#111111",
  muted: "#8A8279",
  line: "#E4DED4",
  accent: "#FF6B35",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: colors.bg, color: colors.ink, fontFamily: "'Archivo', system-ui, sans-serif" }}>
      {children}
    </div>
  );
}

// Shared centered-message state (loading / not signed in / no HubSpot match).
function StatusScreen({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "96px 32px", textAlign: "center" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em" }}>{title}</h1>
        <p style={{ marginTop: 10, fontSize: 14, color: colors.muted }}>{body}</p>
      </div>
    </Shell>
  );
}

type Kpi = { label: string; actual: string; status: "met" | "below" | "none" };

export default function CareerProgressionPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [sf, setSf] = useState<SfMetrics | null>(null);
  const [prospects, setProspects] = useState<Prospect[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/me")
      .then((r) => r.json())
      .then((d: Me) => alive && setMe(d))
      .catch(() => alive && setMe({ authenticated: false }));
    fetch("/api/sf-metrics")
      .then((r) => r.json())
      .then((d: SfMetrics) => alive && setSf(d))
      .catch(() => {});
    getProspects().then((rows) => alive && setProspects(rows));
    return () => {
      alive = false;
    };
  }, []);

  const rep = useMemo(() => {
    if (!me?.ownerId || !sf) return null;
    return sf.reps?.find((r) => r.id === me.ownerId) ?? sf.aes?.find((r) => r.id === me.ownerId) ?? null;
  }, [me, sf]);

  // Career-to-date totals: every Closed Won deal ever attributed to this rep
  // as BDR (excluding any they also own as AE — same rule the rest of the app
  // uses so this never double-counts against the AE side).
  const career = useMemo(() => {
    if (!rep?.name || !prospects) return null;
    const mine = prospects.filter(
      (p) => p.stage === "Closed Won" && same(p.bdr, rep.name) && !same(p.ae, rep.name),
    );
    return { deals: mine.length, arr: mine.reduce((s, p) => s + (p.quote || 0), 0) };
  }, [rep, prospects]);

  const kpis: Kpi[] | null = useMemo(() => {
    if (!rep || rep.stage == null) return null; // AE — no activity targets defined
    const tier = rep.stage === "ramp" ? "ramp" : "steady";
    const dialTarget = DIAL_TARGET_PER_DAY[tier];
    const demoTarget = DEMO_TARGET_PER_WEEK[tier];
    const showTarget = SHOW_RATE_TARGET[tier];
    const dials = rep.dials ?? 0;
    const demos = rep.demosWk ?? 0;
    const show = rep.showRate ?? 0;
    return [
      { label: `${dialTarget} dials a day`, actual: dials.toLocaleString("en-US"), status: dials >= dialTarget ? "met" : "below" },
      { label: `${demoTarget} demos a week`, actual: demos.toLocaleString("en-US"), status: demos >= demoTarget ? "met" : "below" },
      { label: `${Math.round(showTarget * 100)}% show rate`, actual: `${Math.round(show * 100)}%`, status: show >= showTarget ? "met" : "below" },
      { label: "Must attend every in-house event w/ intent to book", actual: "—", status: "none" },
    ];
  }, [rep]);

  if (me && !me.authenticated) {
    return (
      <StatusScreen
        title="Sign in to see your career progression"
        body="This page shows your own standing, so it needs a signed-in Google account — the shared password doesn't carry an identity."
      />
    );
  }
  if (me?.authenticated && !me.ownerId) {
    return (
      <StatusScreen
        title="No matching HubSpot rep found"
        body={`Your account (${me.ownerName ?? "signed in"}) isn't linked to a HubSpot owner, so there's no personal data to show yet.`}
      />
    );
  }
  if (!me || !sf || !prospects) {
    return <StatusScreen title="Loading…" body="" />;
  }
  // Everything loaded, but this owner isn't on the tracked BDR/AE roster
  // (app/api/prospects/team.ts) — a real HubSpot owner, just not one of the
  // people /api/sf-metrics tracks activity for. Distinct from still-loading,
  // so this doesn't spin forever for an admin/exec whose Google account is
  // allowlisted but who isn't themselves a rep.
  if (!rep || !career) {
    return (
      <StatusScreen
        title="You're not on the tracked roster"
        body={`${me.ownerName ?? "This account"} is a real HubSpot owner, but not one of the BDRs/AEs this page tracks. If you're an admin, use "View as" in the sidebar to see a rep's progression.`}
      />
    );
  }

  return (
    <Shell>
      <header style={{ padding: "24px 32px 16px", borderBottom: `2px solid ${colors.ink}` }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: colors.muted }}>
              Career Progression Tracking
            </div>
            <h1 style={{ margin: "4px 0 0", fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em" }}>{rep.name}</h1>
            {me.impersonating && (
              <div style={{ marginTop: 4, fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: colors.accent }}>
                Viewing as (admin)
              </div>
            )}
          </div>
          <div
            style={{
              border: `1px solid ${colors.ink}`,
              padding: "10px 16px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            Progression Handbook
          </div>
        </div>
      </header>

      <section style={{ padding: "32px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div style={{ background: "#fff", borderTop: `2px solid ${colors.ink}`, padding: "20px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: colors.muted }}>
            <span>Tracks Closed</span>
            <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>Career to date</span>
          </div>
          <div style={{ marginTop: 10, fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em" }}>{career.deals}</div>
        </div>
        <div style={{ background: "#fff", borderTop: `2px solid ${colors.ink}`, padding: "20px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: colors.muted }}>
            <span>Tracks ARR</span>
            <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>Career to date</span>
          </div>
          <div style={{ marginTop: 10, fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em" }}>{fmtArr(career.arr)}</div>
        </div>
      </section>

      <section style={{ padding: "0 32px 48px" }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: "-0.01em", borderBottom: `2px solid ${colors.ink}`, paddingBottom: 12 }}>
          Expectations / Minimums / KPI&rsquo;s
        </h2>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: colors.muted, padding: "12px 0 4px" }}>
          Your standing this week
        </div>

        {kpis ? (
          kpis.map((k) => (
            <div
              key={k.label}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                borderBottom: `1px solid ${colors.line}`,
                padding: "16px 0",
              }}
            >
              <span style={{ fontSize: 15 }}>{k.label}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <span style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{k.actual}</span>
                {k.status === "none" ? (
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: colors.muted }}>
                    Not tracked
                  </span>
                ) : (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: k.status === "below" ? colors.accent : colors.muted,
                    }}
                  >
                    <span style={{ width: 6, height: 6, background: k.status === "below" ? colors.accent : "#CFC8BE" }} />
                    {k.status === "below" ? "Below" : "Met"}
                  </span>
                )}
              </div>
            </div>
          ))
        ) : (
          <p style={{ fontSize: 13, color: colors.muted, padding: "16px 0" }}>
            KPI expectations aren&rsquo;t defined for AEs yet — only BDR dial/demo/show-rate targets exist today.
          </p>
        )}
      </section>
    </Shell>
  );
}
