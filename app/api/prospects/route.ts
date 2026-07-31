// ============================================================================
// SERVER ROUTE: /api/prospects  (app/api/prospects/route.ts)
// ----------------------------------------------------------------------------
// Runs ONLY on the server, so the secret HubSpot key never reaches the browser.
// It asks HubSpot's Search API for just our team's deals, translates HubSpot's
// field names + codes into the exact `Prospect` shape the dashboard already
// understands, and hands back a plain list. The result is cached for a few
// minutes so repeat visits are instant. The browser fetches this via
// getProspects() in data.ts.
// ============================================================================

import { unstable_cache } from "next/cache";
import type { Prospect, Stage } from "../../lib/data";
import {
  emailDomain,
  getCorgiIndex,
  matchCompany,
  matchCompanyLoose,
  normalizeCompany,
  normalizeEmail,
  type CorgiCompany,
  type CorgiIndex,
} from "./corgi";
import { enrichEngagements, type Engagement } from "./engagements";
import { TEAM_BDRS, TEAM_AES } from "./team";

// Always run fresh on each request (read the live key + live deals), never
// cached at build time.
export const dynamic = "force-dynamic";
// Corgi's API can only be paged (no company filter) and throttles hard, so a
// cold pull of all quotes takes ~30s. Allow up to 60s so Vercel doesn't cut it
// off; after the first pull it's cached in memory and responses are instant.
export const maxDuration = 60;

const HUBSPOT_BASE = "https://api.hubapi.com";

// How long (seconds) to reuse a fetched result before going back to HubSpot +
// Corgi. Keeps the dashboard fast on repeat loads without showing badly stale
// numbers. Used by unstable_cache below (Next's persistent Data Cache).
const REVALIDATE_SECONDS = 5 * 60; // 5 minutes

// YOUR team roster lives in ONE place now — app/api/prospects/team.ts. Add or
// remove a teammate there; both this route and the dashboard read from it.

// HubSpot's internal stage IDs → the dashboard's stage names.
// (Mapping confirmed with Carwyn: Contract Sent folds into Quoted; HubSpot's
// "Closed Lost" shows as Ghosting; HubSpot's "Disqualified" shows as Closed Lost.)
const STAGE_BY_HUBSPOT: Record<string, Stage> = {
  contractsent: "Meeting Booked", // labelled "Booked" in HubSpot
  qualifiedtobuy: "Qualified", // labelled "Discovery"
  "2808562411": "Quoted",
  "3653087972": "Quoted", // "Contract Sent"
  closedwon: "Closed Won",
  closedlost: "Ghosting",
  "3448964848": "Closed Lost", // "Disqualified"
};

const DEAL_PROPERTIES = [
  "dealname",
  "amount",
  "dealstage",
  "bdr",
  "hubspot_owner_id",
  "notes_last_contacted",
  "notes_last_updated",
  "hs_last_sales_activity_timestamp",
  "closedate",
  "createdate",
];

type HubSpotDeal = {
  id: string;
  properties: Record<string, string | null>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Small helper: call HubSpot with the bearer token and return parsed JSON.
// Retries on rate-limits (429) and transient 5xx with a short backoff, so a
// burst of requests doesn't break the page. `init` lets us do POST (search).
async function hs(
  path: string,
  token: string,
  init?: RequestInit,
  attempt = 0,
): Promise<any> {
  const res = await fetch(`${HUBSPOT_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (res.ok) return res.json();

  const retryable = res.status === 429 || res.status >= 500;
  if (retryable && attempt < 5) {
    const retryAfter = Number(res.headers.get("retry-after")) || 0;
    const wait = retryAfter * 1000 || Math.min(500 * 2 ** attempt, 8000);
    await sleep(wait);
    return hs(path, token, init, attempt + 1);
  }

  const body = await res.text();
  throw new Error(`HubSpot ${res.status} on ${path}: ${body.slice(0, 200)}`);
}

// Build owner lookups from HubSpot's user list. Returns both directions:
//   id2name — user ID → "First Last" (for showing the AE/BDR name)
//   name2id — "First Last" → user ID (to look up our team's BDR IDs)
async function fetchOwners(token: string): Promise<{
  id2name: Map<string, string>;
  name2id: Map<string, string>;
}> {
  const id2name = new Map<string, string>();
  const name2id = new Map<string, string>();
  let after: string | undefined;
  do {
    const q = `/crm/v3/owners?limit=100${after ? `&after=${after}` : ""}`;
    const page = await hs(q, token);
    for (const o of page.results ?? []) {
      const id = String(o.id);
      const name = [o.firstName, o.lastName].filter(Boolean).join(" ").trim();
      const display = name || o.email || `User ${id}`;
      id2name.set(id, display);
      if (name) name2id.set(name, id);
    }
    after = page.paging?.next?.after;
  } while (after);
  return { id2name, name2id };
}

// Ask HubSpot's Search API for ONLY the deals whose BDR field is one of the
// given user IDs. This returns just our team's ~1.5k deals instead of every
// company deal, so it's far fewer pages to fetch.
async function searchTeamDeals(
  token: string,
  bdrIds: string[],
): Promise<HubSpotDeal[]> {
  const deals: HubSpotDeal[] = [];
  let after: string | undefined;
  let guard = 0;
  do {
    const body = {
      filterGroups: [
        { filters: [{ propertyName: "bdr", operator: "IN", values: bdrIds }] },
      ],
      properties: DEAL_PROPERTIES,
      limit: 100,
      ...(after ? { after } : {}),
    };
    const page = await hs("/crm/v3/objects/deals/search", token, {
      method: "POST",
      body: JSON.stringify(body),
    });
    deals.push(...(page.results ?? []));
    after = page.paging?.next?.after;
  } while (after && ++guard < 120); // search caps at 10k results
  return deals;
}

// Turn "2026-06-18T17:32:04Z" into "2026-06-18" (or null).
function toDate(iso: string | null | undefined): string | null {
  return iso ? iso.slice(0, 10) : null;
}

// Return whichever of two HubSpot timestamps is more recent (ISO strings sort
// chronologically, so a plain string compare gives the later one). Used so
// "Last Rep Contact" reflects the broader "Last Activity" — the newest of a
// logged call/email/meeting OR a note update — not just calls/emails/meetings.
function latestIso(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  if (a && b) return a > b ? a : b;
  return a ?? b ?? null;
}

function mapDeal(
  d: HubSpotDeal,
  id2name: Map<string, string>,
  byCompany: Map<string, CorgiCompany> | null,
): Prospect | null {
  const p = d.properties;
  const stage = STAGE_BY_HUBSPOT[p.dealstage ?? ""];
  if (!stage) return null; // stage we don't track → skip

  // The search already limited results to our team's BDRs, so just resolve
  // the display names. Keep the on-team guard as a belt-and-braces check.
  const bdr = p.bdr ? id2name.get(p.bdr) ?? "Unassigned" : "Unassigned";
  if (!TEAM_BDRS.has(bdr)) return null;
  const ownerName = p.hubspot_owner_id
    ? id2name.get(p.hubspot_owner_id) ?? "Unassigned"
    : "Unassigned";
  // Only surface corp AEs; anyone else's name becomes "Unassigned" so they
  // don't appear as an AE card/filter option (the deal itself is kept).
  const ae = TEAM_AES.has(ownerName) ? ownerName : "Unassigned";
  // Which month a deal belongs to. A HubSpot data migration on ~2026-06-18
  // OVERWROTE the closedate of every then-existing Closed Won deal, stamping the
  // whole back-catalogue into June 2026 (this collapsed the year's wins into one
  // giant fake June bar). Deals closed AFTER the migration carry a REAL closedate
  // (e.g. genuine July wins). So: trust closedate normally, but for anything
  // stamped in the June-2026 migration month fall back to createdate (when the
  // deal was actually worked). Open deals have no closedate → createdate too.
  const MIGRATION_MONTH = "2026-06";
  const closeMonth = (p.closedate ?? "").slice(0, 7);
  const when =
    p.closedate && closeMonth !== MIGRATION_MONTH
      ? p.closedate
      : p.createdate || p.closedate || "";

  const company = (p.dealname ?? "Untitled")
    .replace(/\s*-\s*New Deal\s*$/i, "")
    .trim();
  // Look up THIS company's Corgi/Django record (all its quotes). When the Corgi
  // index is unavailable (null), leave the quote fields undefined so the
  // dashboard falls back to the HubSpot deal amount instead of showing zeroes.
  const c = byCompany ? matchCompany(byCompany, company) : null;
  const base: Prospect = {
    id: Number(d.id),
    company,
    stage,
    bdr,
    ae,
    contact: "",
    meetingDate: toDate(p.createdate),
    quote: Math.round(Number(p.amount) || 0),
    notes: "",
    month: when.slice(0, 7), // "YYYY-MM"
    confirmed: stage === "Closed Won", // fallback until Corgi says otherwise
    // Every deal must carry a real HubSpot date. Prefer the newest of the "Last
    // Contacted" stamp (calls/emails/meetings) and "Last Activity" stamp (which
    // also covers logged notes) — this is HubSpot's broader activity view; then
    // fall back to the last sales-activity timestamp, then to the deal's
    // creation date as a floor. This guarantees no deal has a null contact date.
    lastContact:
      toDate(latestIso(p.notes_last_contacted, p.notes_last_updated)) ??
      toDate(p.hs_last_sales_activity_timestamp) ??
      toDate(p.createdate),
  };
  if (!byCompany) return base; // Corgi unavailable → stage-based fallback only

  // The actual premium is filled in AFTER de-duping (distributeCorgiRevenue),
  // because a company's purchased policies are spread across its surviving deals
  // there — doing it per-deal here would copy one company's total onto each of
  // its deals and double-count. corgiRevenueResolved marks deals whose value
  // Corgi owns (so a $0 there means "no policy", not "fall back to HubSpot").
  return {
    ...base,
    confirmed: c?.hasPurchased ?? false, // refined per-deal after distribution
    hasCorgiQuote: c?.hasQuote ?? false, // Corgi/Django has a quote for it
    corgiStatus: c?.status ?? null,
    corgiPremium: 0,
    corgiQuotedPremium: c?.quotedPremium ?? 0, // amount quoted (not yet sold)
    corgiRevenueResolved: false,
  };
}

// Manual ownership calls for genuine data ties. When one Corgi policy could
// belong to either of two IDENTICAL Closed Won deals (same company, same
// amount) owned by different BDRs, nothing in HubSpot or Corgi can tell them
// apart, so the nearest-amount match is a coin-flip. These overrides record who
// the policy actually belongs to. Keyed by normalised company name → the BDR's
// full HubSpot name. Mainstay Digital: confirmed by Carwyn as his deal.
const OWNERSHIP_OVERRIDES: Record<string, string> = {
  [normalizeCompany("Mainstay Digital")]: "Carwyn Chiramel",
};

// Human-confirmed identity aliases: a HubSpot deal named on the LEFT is the same
// customer as the Django legal entity on the RIGHT. HubSpot deals use nicknames
// ("ChatLabs") while Django files the full legal name ("ChatLabs Technology Inc"),
// and there's no shared ID between the two systems — so when the deal has no
// contact email to bridge them (the reliable link), an exact/domain match is
// impossible and the sale would show $0. Each pair below was verified by hand
// against Django's /policies feed (real bought policy + premium). This is the ONLY
// place fuzzy names are trusted, and only because a human signed off on each one —
// so it can never silently merge two different companies the way prefix-guessing
// did. To link a new one: add its contact email in HubSpot (auto-links by domain)
// or add a confirmed pair here. Left = the HubSpot deal name, right = the exact
// Django insured legal name.
const COMPANY_ALIAS_PAIRS: [string, string][] = [
  ["ChatLabs", "ChatLabs Technology Inc"],
  ["Nimblemind.ai", "Nimblemind INC."],
  ["Lillia", "Lillia Healthcare Technologies Inc"],
  ["Rette (Defect AI)", "Rette Corp"],
  ["Eckuity Capital - Upsell", "Eckuity LLC"],
  ["PicMii Crowdfunding", "PicMii Crowdfunding, LLC (d/b/a Highlander Crowdfunding)"],
  // These two also share the customer's email DOMAIN with their Django policy
  // (korra.ai, soap.health), so the match is doubly confirmed.
  ["Korra", "Korra AI"],
  ["SOAP Health", "SOAP, Inc."],
];
// normalised HubSpot deal name → the normalised Django legal-name key it matches.
const COMPANY_ALIASES = new Map<string, string>(
  COMPANY_ALIAS_PAIRS.map(([deal, legal]) => [
    normalizeCompany(deal),
    normalizeCompany(legal),
  ]),
);

// The BASE company for a HubSpot deal, with any trailing deal-type suffix
// removed ("Trellus (YC W22) - D&O upsell" and "Trellus (YC W22) - D&O" both →
// "trellus yc w22"; "Journey - Upsell" → "journey"). This lets a company's base
// deal and its follow-on deals (upsell / D&O / reinstatement) each match the same
// Django customer's policies even when only one of them carries a contact email.
// Only strips a trailing " - <...>" segment; names without one are unchanged.
function baseCompanyKey(company: string): string {
  const stripped = company.replace(/\s*[-–—]\s+.*$/, "").trim();
  return normalizeCompany(stripped) || normalizeCompany(company);
}

// ----------------------------------------------------------------------------
// Credit each Closed Won deal with the real premium of the Django POLICY it sold,
// using the /policies feed as the single source of truth (the /quotes feed marks
// bought policies "purchased" but zeroes their premium, which used to make wins
// fall back to the QUOTED figure or to another company matched by a shared email
// — both overstated the number).
//
// Every policy is a distinct sale (policy_number) and is assigned to EXACTLY ONE
// won deal — the candidate whose HubSpot amount is nearest, biggest policies
// first — so no sale is ever counted twice, even when several deals share a
// broker email. A deal is a candidate for a policy when any of its handles (its
// company name, its family's base name, or the buyer's email) matches one of the
// policy's handles. Each credited deal is also dated by its policy's real
// purchase month (purchased_at), fixing wins mis-dated by HubSpot's June-2026
// migration.
//
// A won deal whose COMPANY NAME matches a Django policy is "Corgi-owned": if it
// wins no policy (its sale went to a sibling deal) it shows $0, never a fallback,
// so a customer's total is never inflated. A won deal that only ever matched by a
// shared email and won nothing is left alone (keeps its HubSpot amount), so a
// broker inbox can't wrongly zero an unrelated deal.
// ----------------------------------------------------------------------------
function resolveCorgiRevenue(
  rows: Prospect[],
  index: CorgiIndex,
  emailByDeal: Map<number, string>,
): Prospect[] {
  const won = rows.filter((r) => r.stage === "Closed Won");
  if (won.length === 0) return rows;

  // Handles each won deal can be matched to a policy on: its own name, its
  // family's base name (strong "name" handles), and the buyer's email (a weaker
  // handle — a broker inbox can span many companies).
  const nameHandles = new Map<number, Set<string>>();
  const allHandles = new Map<number, Set<string>>();
  for (const d of won) {
    const names = new Set<string>(
      [normalizeCompany(d.company), baseCompanyKey(d.company)].filter(Boolean),
    );
    // A human-confirmed alias (e.g. "ChatLabs" → "ChatLabs Technology Inc") is a
    // STRONG name handle: it lets this deal claim the policy filed under the
    // Django legal name, exactly as if the names had matched directly.
    const alias = COMPANY_ALIASES.get(normalizeCompany(d.company));
    if (alias) names.add(alias);
    const all = new Set<string>(names);
    const email = normalizeEmail(emailByDeal.get(d.id) ?? "");
    if (email) all.add(email); // exact-buyer handle (email domain is NOT used —
    // shared broker addresses span unrelated companies; see buildPolicies).
    nameHandles.set(d.id, names);
    allHandles.set(d.id, all);
  }

  // Assign each distinct policy to exactly one won deal (biggest first, nearest
  // HubSpot amount). Tally the premium and remember the policy's month per deal.
  const premiumByDeal = new Map<number, number>();
  const monthByDeal = new Map<number, string>();
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const policies = [...index.policies].sort((a, b) => b.premium - a.premium);
  for (const pol of policies) {
    const cands = won.filter((d) =>
      pol.keys.some((k) => allHandles.get(d.id)!.has(k)),
    );
    if (cands.length === 0) continue;
    // A NAME match beats an EMAIL match: a policy filed under a company's legal
    // name belongs to THAT company's deal, never to a stranger who merely shares
    // the buyer's (often brokered) email. Only when no deal matches the policy by
    // name do we let the email-matched deals compete for it.
    const nameCands = cands.filter((d) =>
      pol.nameKeys.some((k) => nameHandles.get(d.id)!.has(k)),
    );
    const scoped = nameCands.length ? nameCands : cands;
    // Honour a manual ownership call when a candidate for this exact policy is
    // pinned to a BDR (a human-confirmed tie), else take the nearest amount.
    const pinned = scoped.filter(
      (d) => OWNERSHIP_OVERRIDES[normalizeCompany(d.company)] === d.bdr,
    );
    const pool = pinned.length ? pinned : scoped;
    let best = pool[0];
    let bestDiff = Infinity;
    for (const d of pool) {
      const diff = Math.abs((d.quote || 0) - pol.premium);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = d;
      }
    }
    premiumByDeal.set(best.id, round2((premiumByDeal.get(best.id) ?? 0) + pol.premium));
    if (!monthByDeal.has(best.id)) monthByDeal.set(best.id, pol.month);
  }

  // --------------------------------------------------------------------------
  // Consolidate a customer's scattered policies onto ONE deal. A single
  // customer often has several Closed-Won deals (a base deal plus "- Upsell" /
  // "- Reinstatement" lines) and files several policies; the per-policy
  // nearest-amount match above can pile every policy onto one sibling and leave
  // the others at $0, so the main deal misleadingly shows "—". We group sibling
  // deals that share a company name (or are bridged by a single policy carrying
  // both a legal name and an organization name, e.g. "Altrina Corporation" /
  // "Hammr"), keep every group inside a single BDR so no rep's total can shift,
  // and move each group's whole premium onto its primary deal (the base line,
  // the one with no deal-type suffix).
  // --------------------------------------------------------------------------
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    for (let c = x; c !== r; ) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const union = (a: number, b: number) => parent.set(find(a), find(b));
  for (const d of won) parent.set(d.id, d.id);
  // Link deals that share a company-name handle (base + its "- Upsell" lines).
  const byNameHandle = new Map<string, number[]>();
  for (const d of won)
    for (const k of nameHandles.get(d.id)!) {
      const a = byNameHandle.get(k) ?? [];
      a.push(d.id);
      byNameHandle.set(k, a);
    }
  for (const ids of byNameHandle.values())
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  // Link deals bridged by one policy that carries several names.
  for (const pol of index.policies) {
    const linked = won.filter((d) =>
      pol.nameKeys.some((k) => nameHandles.get(d.id)!.has(k)),
    );
    for (let i = 1; i < linked.length; i++) union(linked[0].id, linked[i].id);
  }
  // Bucket by (customer group, BDR) so a rep's total never moves to another.
  const groups = new Map<string, Prospect[]>();
  for (const d of won) {
    const key = `${find(d.id)}|${d.bdr}`;
    const a = groups.get(key) ?? [];
    a.push(d);
    groups.set(key, a);
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const total = round2(
      members.reduce((s, d) => s + (premiumByDeal.get(d.id) ?? 0), 0),
    );
    if (total === 0) continue;
    // Primary = the base line (name has no "- suffix"), else the largest
    // HubSpot amount, then the lowest id — always deterministic.
    const primary = [...members].sort((a, b) => {
      const asuf = normalizeCompany(a.company) === baseCompanyKey(a.company) ? 0 : 1;
      const bsuf = normalizeCompany(b.company) === baseCompanyKey(b.company) ? 0 : 1;
      if (asuf !== bsuf) return asuf - bsuf;
      if ((b.quote || 0) !== (a.quote || 0)) return (b.quote || 0) - (a.quote || 0);
      return a.id - b.id;
    })[0];
    const month = members
      .map((d) => monthByDeal.get(d.id))
      .filter(Boolean)
      .sort()[0];
    for (const d of members) {
      premiumByDeal.set(d.id, d.id === primary.id ? total : 0);
    }
    if (month) monthByDeal.set(primary.id, month);
  }

  // Every Django policy NAME handle, so we can tell a "Corgi-owned" won deal
  // (its company name is on a real policy) from one Corgi has never heard of.
  const policyNameKeys = new Set<string>();
  for (const pol of index.policies)
    for (const k of pol.nameKeys) policyNameKeys.add(k);

  for (const d of won) {
    const wonPremium = premiumByDeal.get(d.id) ?? 0;
    const nameMatched = [...nameHandles.get(d.id)!].some((k) =>
      policyNameKeys.has(k),
    );
    if (wonPremium === 0 && !nameMatched) continue; // no Corgi purchase → HubSpot amount
    d.corgiRevenueResolved = true; // Corgi owns the value (0 = no policy, not a fallback)
    d.corgiPremium = wonPremium;
    d.confirmed = wonPremium > 0;
    const m = monthByDeal.get(d.id);
    if (m) d.month = m;
  }
  return rows;
}

// ----------------------------------------------------------------------------
// Attach Django quotes to OPEN deals whose company name didn't line up with
// Django's spelling. A deal only gets a quote by NAME when HubSpot's company
// name matches Django's — so brand-vs-legal-name drift ("Anomaly" vs "Anomaly
// Innovations Inc.") and quotes filed under an unrelated legal name (Cosmos AI's
// quote sits under "Bazzuka, Inc.") were missed. Django keys the same buyer
// reliably by EMAIL, and by their company's email DOMAIN even when the exact
// person differs, so for any open deal still missing a quote we look the buyer up
// by email, then by domain, and copy across:
//   • hasCorgiQuote — so the deal shows as "Quoted" (a real quote OR a purchase),
//     including a "needs_review" quote whose premium Django hasn't computed yet
//     (badge shows, value stays "—");
//   • the quoted premium, only when we don't already have one and Django has a
//     non-zero figure.
// Purchased-policy REVENUE is resolved elsewhere (by policy name/email); this
// only ever fills display fields on open deals, never overwrites a name match.
// ----------------------------------------------------------------------------
const OPEN_STAGES: Stage[] = ["Meeting Booked", "Qualified", "Quoted"];

function enrichOpenQuotes(
  rows: Prospect[],
  index: CorgiIndex,
  emailByDeal: Map<number, string>,
): Prospect[] {
  for (const r of rows) {
    if (!OPEN_STAGES.includes(r.stage)) continue;
    if (r.hasCorgiQuote && (r.corgiQuotedPremium ?? 0) > 0) continue; // fully resolved by name
    // Try to find this open deal's Django record three ways, cheapest first:
    //   1. a loose NAME match (exact, else a unique legal-name prefix) — needs no
    //      email, so it catches brand-vs-legal drift ("Anomaly" → "Anomaly
    //      Innovations Inc.", "Cloudbreak Energy" → "…Partners LLC");
    //   2. the buyer's exact email;
    //   3. the buyer's company email domain.
    // This never touches revenue/ownership (matchCompany, exact-only, still owns
    // that) — it only fills display flags on open deals.
    const email = normalizeEmail(emailByDeal.get(r.id) ?? "");
    const dom = email ? emailDomain(email) : "";
    const c =
      matchCompanyLoose(index.byCompany, r.company) ??
      (email ? index.byEmail.get(email) : null) ??
      (dom ? index.byDomain.get(dom) : null) ??
      null;
    if (!c) continue;
    if (c.hasQuote) r.hasCorgiQuote = true; // real quote (or purchase) exists → Quoted
    if (!r.corgiStatus && c.status) r.corgiStatus = c.status;
    if ((r.corgiQuotedPremium ?? 0) === 0 && c.quotedPremium > 0) {
      r.corgiQuotedPremium = c.quotedPremium;
    }
  }
  return rows;
}

// ----------------------------------------------------------------------------
// De-duplicating deals. HubSpot often holds the same company twice: one real
// deal plus an empty "shell" (amount 0, still sitting in an early stage). Left
// alone they show up as two rows and inflate the funnel counts. We collapse
// every company down to ONE deal — keeping whichever is "most real".
// ----------------------------------------------------------------------------

// How advanced each stage is (higher = further along, so more "real").
const STAGE_PRIORITY: Record<Stage, number> = {
  "Closed Won": 5,
  Quoted: 4,
  Qualified: 3,
  "Meeting Booked": 2,
  Ghosting: 1,
  "Closed Lost": 0,
};

// A ranked "realness" fingerprint for a deal, compared field-by-field:
// confirmed money first, then having a real Corgi quote, then how far along the
// stage is, then the deal amount. Bigger wins on the first field that differs.
function realness(p: Prospect): number[] {
  return [
    p.confirmed ? 1 : 0,
    p.hasCorgiQuote ? 1 : 0,
    STAGE_PRIORITY[p.stage] ?? 0,
    p.quote || 0,
  ];
}

function moreReal(a: Prospect, b: Prospect): boolean {
  const ra = realness(a);
  const rb = realness(b);
  for (let i = 0; i < ra.length; i++) {
    if (ra[i] !== rb[i]) return ra[i] > rb[i];
  }
  return false;
}

// Sort comparator: most-real deal first; on a realness tie, the NEWER deal (by
// create date) wins, since that's the one the rep pushed to the finish line.
function byRealThenNewer(a: Prospect, b: Prospect): number {
  if (moreReal(a, b)) return -1;
  if (moreReal(b, a)) return 1;
  return ms(b.meetingDate) - ms(a.meetingDate);
}

// Collapse duplicate company rows down to ONE deal per company per BDR. HubSpot
// routinely holds the same opportunity several times for one rep — a real deal
// plus an earlier-stage leftover or a ghosted shell — and because the company
// carries a Corgi quote, every one of those rows looks "real", so they were all
// surviving and showing as duplicates. A single BDR must never see the same
// company twice, so within each company+BDR we keep only the most-real row
// (confirmed money → Corgi quote → furthest stage → biggest amount) and drop
// the rest. Revenue is safe: the company's full confirmed premium is credited
// to the surviving deal afterwards (distributeCorgiRevenue). Two different BDRs
// genuinely working the same company are kept apart (one row each), so neither
// rep's board loses a deal.
function dedupeByCompany(rows: Prospect[]): Prospect[] {
  const groups = new Map<string, Prospect[]>();
  for (const r of rows) {
    const key = `${r.company.trim().toLowerCase()}::${r.bdr}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  const out: Prospect[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    // Keep the single most-real deal; the others are duplicate HubSpot records
    // for the same opportunity and must never appear as separate deals. When two
    // are equally "real" (e.g. both Closed Won), the NEWER deal wins — that's the
    // one the rep pushed to the finish line (Group B).
    out.push([...group].sort(byRealThenNewer)[0]);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Cross-BDR ownership. After the per-BDR de-dupe a company can still appear once
// under two different BDRs (both reps worked the same account). A company must
// have exactly ONE owner, decided by the team's rules of engagement:
//   • Whoever has the most recent POSITIVE contact keeps it. A rep only loses an
//     account once they've gone quiet — the "no positive contact in 3 days" rule
//     — so an actively-engaged rep (recent contact) always outranks a stale one.
//   • If neither rep has any positive contact on record, the most recent deal /
//     activity (last-contacted or created date) wins.
//   • A manual ownership override (a human-confirmed call) beats both.
// The losing rep's row is dropped; revenue is untouched because the company's
// full confirmed premium is credited to the surviving owner afterwards.
// ----------------------------------------------------------------------------
const ms = (iso: string | null): number =>
  iso ? Date.parse(iso) || 0 : 0;

// Most recent positive contact (a connected call / inbound email).
const positiveContactTime = (p: Prospect): number => ms(p.lastInbound ?? null);
// Most recent deal signal when there's no positive contact: last-contacted
// stamp or the deal's creation date, whichever is newer.
const dealRecencyTime = (p: Prospect): number =>
  Math.max(ms(p.lastContact), ms(p.meetingDate));

function ownsMore(a: Prospect, b: Prospect): boolean {
  const pa = positiveContactTime(a);
  const pb = positiveContactTime(b);
  if (pa !== pb) return pa > pb; // most recent positive contact wins (ROE)
  const ra = dealRecencyTime(a);
  const rb = dealRecencyTime(b);
  if (ra !== rb) return ra > rb; // else most recent deal activity
  return ms(a.meetingDate) > ms(b.meetingDate); // final tie → newer deal wins
}

function pickOwner(deals: Prospect[]): Prospect {
  const owner = OWNERSHIP_OVERRIDES[normalizeCompany(deals[0].company)];
  if (owner) {
    const pinned = deals.find((d) => d.bdr === owner);
    if (pinned) return pinned;
  }
  return [...deals].sort((a, b) => (ownsMore(a, b) ? -1 : 1))[0];
}

// Collapse every company down to a single owner (one row per company, full
// stop). Needs engagement dates (lastInbound) already attached so the rules of
// engagement above can see who's actively in contact.
function collapseCrossBdr(rows: Prospect[]): Prospect[] {
  const groups = new Map<string, Prospect[]>();
  for (const r of rows) {
    const key = normalizeCompany(r.company);
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const out: Prospect[] = [];
  for (const group of groups.values()) {
    out.push(group.length === 1 ? group[0] : pickOwner(group));
  }
  return out;
}

async function loadProspects(token: string): Promise<Prospect[]> {
  const { id2name, name2id } = await fetchOwners(token);
  // Turn our team's names into HubSpot user IDs for the search filter.
  const bdrIds = [...TEAM_BDRS]
    .map((name) => name2id.get(name))
    .filter((id): id is string => Boolean(id));
  // Fetch the team's deals and the Corgi quote index side by side. If Corgi is
  // unavailable, getCorgiIndex() returns an empty map and deals still load.
  const [deals, corgi] = await Promise.all([
    searchTeamDeals(token, bdrIds),
    getCorgiIndex(),
  ]);
  const byCompany = corgi?.byCompany ?? null;
  const mapped = deals
    .map((d) => mapDeal(d, id2name, byCompany))
    .filter((x): x is Prospect => x !== null);
  // Collapse each BDR's duplicate rows for a company down to one.
  const deduped = dedupeByCompany(mapped);

  // Attach the customer/BDR contact dates from HubSpot engagements (calls +
  // incoming emails) BEFORE resolving cross-BDR ownership, so the rules of
  // engagement can see who has the most recent positive contact. Best-effort and
  // only for the deals we actually show, so a slow/failed enrichment never
  // blocks the deals themselves.
  const bdrOwnerIds = new Set(bdrIds); // our BDRs' HubSpot user ids
  const engagements = await enrichEngagements(
    token,
    deduped.map((r) => String(r.id)),
    (ownerId) => Boolean(ownerId) && bdrOwnerIds.has(ownerId!),
  );
  // Deal id → its contact's email, kept server-side only (never put on a Prospect,
  // so customer emails never reach the browser). Feeds the Group A email fallback.
  const emailByDeal = new Map<number, string>();
  for (const r of deduped) {
    const e: Engagement | undefined = engagements.get(String(r.id));
    r.lastInbound = e?.lastInbound ?? null;
    r.lastBdrOutbound = e?.lastBdrOutbound ?? null;
    if (e?.contactEmail) emailByDeal.set(r.id, e.contactEmail);
  }

  // Give every company a single owner (rules of engagement), THEN spread each
  // Django customer's purchased Corgi policies across the surviving deals —
  // grouping by canonical identity (company name, or email resolved back to the
  // owning company) so a base deal and its upsell share one pool of policies and
  // nothing is double-counted. When Corgi is unavailable, keep the HubSpot
  // stage-based rows as-is.
  const owned = collapseCrossBdr(deduped);
  const rows = corgi
    ? enrichOpenQuotes(
        resolveCorgiRevenue(owned, corgi, emailByDeal),
        corgi,
        emailByDeal,
      )
    : owned;
  return rows;
}

// The expensive pull (all HubSpot deals + the full Corgi/Django quote & policy
// feed, ~30–60s cold) wrapped in Next's persistent Data Cache. Unlike a plain
// module-level variable — which lives only inside ONE serverless instance and is
// thrown away when that instance sleeps — unstable_cache stores the finished
// result in a cache that is SHARED across every serverless instance (and even
// across deployments) on Vercel. So the first visitor pays the slow pull once,
// and for the next REVALIDATE_SECONDS everyone else (on any instance) gets it
// instantly. After that window the next request triggers a background refresh;
// it may serve the slightly-stale copy while the new numbers are fetched, so the
// page is never blocked on the slow pull again. The HubSpot key is read inside
// this function (server-only, never in the cache key or the browser). It also
// coalesces concurrent identical calls, so a burst of visitors triggers one pull.
const getCachedProspects = unstable_cache(
  async (): Promise<Prospect[]> => {
    const token = process.env.HUBSPOT_TOKEN;
    if (!token) throw new Error("HUBSPOT_TOKEN is not set on the server.");
    return loadProspects(token);
  },
  ["prospects-v1"], // cache key (no secrets); bump the suffix to force a refresh
  { revalidate: REVALIDATE_SECONDS, tags: ["prospects"] },
);

export async function GET() {
  if (!process.env.HUBSPOT_TOKEN) {
    return Response.json(
      { error: "HUBSPOT_TOKEN is not set on the server." },
      { status: 500 },
    );
  }

  try {
    const prospects = await getCachedProspects();
    return Response.json(prospects);
  } catch (err) {
    // The browser keeps its own last-good copy (localStorage) and falls back to
    // it when this route errors, so a transient upstream failure never blanks
    // the dashboard — see getProspects() in app/lib/data.ts.
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }
}
