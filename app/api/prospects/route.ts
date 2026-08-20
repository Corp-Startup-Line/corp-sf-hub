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
import { enrichEngagements, type Engagement } from "./engagements";
import { TEAM_BDRS, TEAM_AES, CORP_TEAM_LOWER } from "./team";

// Strip the noise so "Acme, Inc." and "Acme Inc" match: lower-case, drop
// punctuation and common company suffixes, then collapse the spaces. Used to key
// companies for de-duping, cross-BDR ownership, and the hidden-company list.
function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(
      /\b(llc|inc|incorporated|ltd|limited|corp|corporation|co|company|llp|lp|plc|gmbh|group|holdings)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

// BDR roster lookup that IGNORES capitalization. A HubSpot profile whose name is
// stored in a different case (e.g. "ethan wilensky") must still match our roster
// entry ("Ethan Wilensky"); an exact, case-sensitive match silently dropped every
// one of that person's deals. This maps a HubSpot display name back to the
// roster's canonical spelling (or undefined if they're not on the team), so the
// guard passes AND the dashboard always shows the tidy roster capitalization.
const BDR_BY_LOWER = new Map(
  [...TEAM_BDRS].map((n) => [n.toLowerCase(), n] as const),
);
const canonicalBdr = (name: string): string | undefined =>
  BDR_BY_LOWER.get(name.trim().toLowerCase());

// AEs are rostered too (SF corp AEs only — see team.ts). A deal's HubSpot owner
// is only shown as the AE if they're on that roster; any other owner (a non-corp
// AE, or a BDR who happens to own the deal) falls back to "Unassigned". This
// keeps the AE filter/section to just the three corp AEs on BOTH dashboards, and
// lets a non-corp BDR's self-owned wins fall into their BDR total (the BDR money
// rule excludes deals you also own as AE; with the AE blanked that never fires).
const AE_BY_LOWER = new Map(
  [...TEAM_AES].map((n) => [n.toLowerCase(), n] as const),
);
const canonicalAe = (name: string): string | undefined =>
  AE_BY_LOWER.get(name.trim().toLowerCase());

// Companies to hide from the dashboard entirely (temporary). A deal whose
// company name matches one of these is dropped at the source, so it disappears
// everywhere at once — the deals table, KPIs, funnel, ARR totals, and the Metrics
// feed / landing ring (they all read these same rows). Remove a name here to
// bring its deals back.
const EXCLUDED_COMPANIES = new Set<string>([
  normalizeCompany("Hyperbolic"),
]);

// One-off manual deal overrides, keyed by the EXACT HubSpot deal id → the roster
// BDR who should be credited, plus an optional forced stage. Keyed by id (not
// company name) so we only ever touch the one specific deal — a company can have
// several deals in HubSpot and we must not rewrite the others. We fetch each deal
// by id (fetchOverrideDeals) in case its HubSpot BDR is off-roster, and in mapDeal
// we force the BDR (and stage, if given), leaving the HubSpot record untouched.
//
// 340222763740 — "Zig.ai - New Deal", Closed Won $10,878.84 (entered 2026-08-14):
// confirmed by Carwyn as Garrett Peterson's sourced win; HubSpot's BDR field names
// an off-roster rep. (A separate open Zig.ai deal, 337282480845 $17,208, is left
// untouched — it is NOT this win.)
const DEAL_OVERRIDES: Record<string, { bdr: string; forceStage?: Stage }> = {
  "340222763740": { bdr: "Garrett Peterson", forceStage: "Closed Won" },
};

// Always run fresh on each request (read the live key + live deals), never
// cached at build time.
export const dynamic = "force-dynamic";
// A cold pull (all team deals + their engagements) can take a while against
// HubSpot's rate limits. The engagement pass now also reads meetings, notes and
// company-level activity to attribute "Last Rep Contact" to the right person, so
// allow up to 120s so Vercel doesn't cut a cold pull off; after the first pull
// the result is cached and responses are instant.
export const maxDuration = 120;

const HUBSPOT_BASE = "https://api.hubapi.com";

// How long (seconds) to reuse a fetched result before going back to HubSpot.
// Keeps the dashboard fast on repeat loads without showing badly stale
// numbers. Used by unstable_cache below (Next's persistent Data Cache).
const REVALIDATE_SECONDS = 5 * 60; // 5 minutes

// YOUR team roster lives in ONE place now — app/api/prospects/team.ts. Add or
// remove a teammate there; both this route and the dashboard read from it.

// HubSpot's internal stage IDs → the dashboard's stage names.
// (Mapping confirmed with Carwyn: HubSpot's "Closed Lost" shows as Ghosting;
// HubSpot's "Disqualified" shows as Closed Lost.)
// NOTE: The old "Quoted" stage came from the retired Corgi/Django system. With
// Django access gone we no longer track it, so HubSpot's two former Quoted
// stages now fold into "Meeting Booked" — each deal keeps its quote amount, only
// the stage label changes.
const STAGE_BY_HUBSPOT: Record<string, Stage> = {
  contractsent: "Meeting Booked", // labelled "Booked" in HubSpot
  qualifiedtobuy: "Qualified", // labelled "Discovery"
  "2808562411": "Meeting Booked", // was "Quoted"
  "3653087972": "Meeting Booked", // was "Quoted" ("Contract Sent")
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
  "hs_v2_date_entered_closedwon",
  "source",
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

// Fetch the exact deals listed in DEAL_OVERRIDES by their HubSpot id. Their BDR
// may be off our roster, so searchTeamDeals (bdr IN roster) wouldn't return them —
// we pull each one directly here and let mapDeal reassign the BDR (and stage).
// Merging by id downstream means a deal that's ALSO in the roster feed is counted
// once, so this is safe even when the deal's BDR is on the team. A missing/deleted
// deal is skipped rather than failing the whole pull.
async function fetchOverrideDeals(token: string): Promise<HubSpotDeal[]> {
  const props = DEAL_PROPERTIES.join(",");
  const out: HubSpotDeal[] = [];
  for (const id of Object.keys(DEAL_OVERRIDES)) {
    try {
      const deal = await hs(
        `/crm/v3/objects/deals/${id}?properties=${props}`,
        token,
      );
      if (deal?.id) out.push(deal);
    } catch {
      // Deal not found (deleted or wrong id) → skip; the rest still load.
    }
  }
  return out;
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
): Prospect | null {
  const p = d.properties;

  // A manual override (see DEAL_OVERRIDES) for a human-confirmed credit, matched on
  // the exact HubSpot deal id. When present it pins the sourcing BDR and, if given,
  // forces the stage — so a deal whose HubSpot BDR/stage was changed still shows as
  // that BDR's win on the dashboard. HubSpot is untouched.
  const override = DEAL_OVERRIDES[d.id];

  const stage = override?.forceStage ?? STAGE_BY_HUBSPOT[p.dealstage ?? ""];
  if (!stage) return null; // stage we don't track → skip

  // Resolve the BDR. The override wins first; otherwise match the roster
  // case-insensitively and adopt its canonical spelling, so a lowercased HubSpot
  // profile ("ethan wilensky") still lands on the right card. A deal with no
  // rostered BDR (and no override) is dropped.
  const bdr =
    override?.bdr ?? canonicalBdr(p.bdr ? id2name.get(p.bdr) ?? "" : "");
  if (!bdr) return null;
  // `owner` = the deal's real HubSpot owner, whoever it is — shown as-is in the
  // deals table so the deal history always names the actual person.
  // `ae` = the ATTRIBUTION AE, used for the AE filter, AE breakdown, and the money
  // rules: only a rostered SF corp AE counts; any other owner (non-corp AE, or a
  // BDR who owns their own deal) → "Unassigned", keeping the AE filter/section and
  // the credit maths limited to the three corp AEs on both dashboards.
  const ownerName = p.hubspot_owner_id
    ? id2name.get(p.hubspot_owner_id) ?? ""
    : "";
  const owner = ownerName.trim() || "Unassigned";
  const ae = canonicalAe(ownerName) ?? "Unassigned";
  // Which date a deal is dated by. Drives BOTH `month` and `closeDate`, so the
  // Corp SF Pipeline and Corp SF Metrics dashboards bucket every deal identically
  // (they read these same rows) and can't disagree.
  //
  // A HubSpot data migration on 2026-06-18 bulk-stamped every then-existing
  // Closed Won deal with a fake June-2026 `closedate` — collapsing the whole
  // back-catalogue into one giant fake June bar. It ALSO stamped those same
  // deals' "date entered Closed Won" at exactly 2026-06-18. So for a WON deal we
  // date it by the real "date entered Closed Won" (which survives the closedate
  // overwrite for genuine wins), EXCEPT the migration batch (entered exactly on
  // 2026-06-18) which we date by createdate — when the deal was actually worked —
  // to keep the migrated back-catalogue out of a fake June spike. Every other
  // deal keeps the old rule: trust closedate unless it's in the migration month,
  // else fall back to createdate. Open deals have no closedate → createdate too.
  const MIGRATION_DAY = "2026-06-18";
  const MIGRATION_MONTH = "2026-06";
  const enteredWon = (p.hs_v2_date_entered_closedwon ?? "").slice(0, 10);
  const closeMonth = (p.closedate ?? "").slice(0, 7);
  const when =
    stage === "Closed Won"
      ? enteredWon && enteredWon !== MIGRATION_DAY
        ? enteredWon
        : p.createdate || p.closedate || ""
      : p.closedate && closeMonth !== MIGRATION_MONTH
        ? p.closedate
        : p.createdate || p.closedate || "";

  const company = (p.dealname ?? "Untitled")
    .replace(/\s*-\s*New Deal\s*$/i, "")
    .trim();
  // Hidden company (see EXCLUDED_COMPANIES) → drop the deal entirely. Checks the
  // base name too, so "Hyperbolic - Upsell" is caught alongside "Hyperbolic".
  if (
    EXCLUDED_COMPANIES.has(normalizeCompany(company)) ||
    EXCLUDED_COMPANIES.has(baseCompanyKey(company))
  ) {
    return null;
  }
  // Money comes straight from the HubSpot deal amount.
  return {
    id: Number(d.id),
    company,
    stage,
    bdr,
    ae,
    owner,
    contact: "",
    meetingDate: toDate(p.createdate),
    quote: Math.round(Number(p.amount) || 0),
    notes: "",
    month: when.slice(0, 7), // "YYYY-MM"
    // The full resolved date (same migration-corrected value as `month`) and the
    // deal source, so the Corp SF Metrics page can bucket this won deal into the
    // right week and split it inbound/outbound off these very rows.
    closeDate: when ? when.slice(0, 10) : null,
    source: p.source ?? null,
    confirmed: stage === "Closed Won",
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
}

// Manual ownership calls for genuine data ties. When the same company is worked
// by two different BDRs and the rules of engagement can't separate them, these
// overrides record who the account actually belongs to (used by pickOwner in the
// cross-BDR collapse). Keyed by normalised company name → the BDR's full HubSpot
// name. Mainstay Digital: confirmed by Carwyn as his deal.
const OWNERSHIP_OVERRIDES: Record<string, string> = {
  [normalizeCompany("Mainstay Digital")]: "Carwyn Chiramel",
};

// The BASE company for a HubSpot deal, with any trailing deal-type suffix
// removed ("Trellus (YC W22) - D&O upsell" and "Trellus (YC W22) - D&O" both →
// "trellus yc w22"; "Journey - Upsell" → "journey"). Lets the hidden-company
// list catch a company's follow-on deals ("Hyperbolic - Upsell") alongside its
// base deal. Only strips a trailing " - <...>" segment; names without one are
// unchanged.
function baseCompanyKey(company: string): string {
  const stripped = company.replace(/\s*[-–—]\s+.*$/, "").trim();
  return normalizeCompany(stripped) || normalizeCompany(company);
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
// confirmed money first, then how far along the stage is, then the deal amount.
// Bigger wins on the first field that differs.
function realness(p: Prospect): number[] {
  return [
    p.confirmed ? 1 : 0,
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
// plus an earlier-stage leftover or a ghosted shell. A single BDR must never see
// the same company twice, so within each company+BDR we keep only the most-real
// row (confirmed money → furthest stage → biggest amount) and drop the rest. Two
// different BDRs genuinely working the same company are kept apart (one row
// each), so neither rep's board loses a deal.
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
  // Turn our team's names into HubSpot user IDs for the search filter. Look up
  // case-insensitively: a HubSpot profile stored in a different case (e.g.
  // "ethan wilensky") would otherwise never resolve to an ID, so none of that
  // rep's deals would even be requested.
  const name2idLower = new Map<string, string>();
  for (const [n, id] of name2id) name2idLower.set(n.toLowerCase(), id);
  const bdrIds = [...TEAM_BDRS]
    .map((name) => name2idLower.get(name.toLowerCase()))
    .filter((id): id is string => Boolean(id));
  // Fetch the team's deals from HubSpot. The Corgi/Django feed has been retired
  // (its API token was revoked), so every number now comes straight from HubSpot.
  const deals = await searchTeamDeals(token, bdrIds);
  // Also pull any manually-overridden deals (e.g. the Zig.ai win → Garrett) by id,
  // in case their HubSpot BDR is off-roster so the roster search above skips them.
  // Merge and de-dupe by HubSpot deal id so a deal that also appears in the roster
  // feed is counted once.
  const overrideDeals = await fetchOverrideDeals(token);
  const byId = new Map<string, HubSpotDeal>();
  for (const d of [...deals, ...overrideDeals]) byId.set(d.id, d);
  const mapped = [...byId.values()]
    .map((d) => mapDeal(d, id2name))
    .filter((x): x is Prospect => x !== null);
  // Collapse each BDR's duplicate rows for a company down to one.
  const deduped = dedupeByCompany(mapped);

  // Attach the customer/BDR contact dates from HubSpot engagements (calls +
  // incoming emails) BEFORE resolving cross-BDR ownership, so the rules of
  // engagement can see who has the most recent positive contact. Best-effort and
  // only for the deals we actually show, so a slow/failed enrichment never
  // blocks the deals themselves.
  const bdrOwnerIds = new Set(bdrIds); // our BDRs' HubSpot user ids
  // Every corp colleague's HubSpot user id (the WHOLE company, not just SF).
  // The "someone else touched it" alert ignores anyone in here — a corp teammate
  // touching a deal is normal; only a genuinely outside-corp owner raises a flag.
  const corpOwnerIds = new Set<string>();
  for (const [nameLower, id] of name2idLower) {
    if (CORP_TEAM_LOWER.has(nameLower)) corpOwnerIds.add(id);
  }
  // Per deal, who is the deal's OWN rep (as a HubSpot user id)? We resolve each
  // deal's canonical BDR name back to a user id via the case-insensitive owner
  // map, so engagement attribution can tell "the rep did this" from "a teammate
  // did this" — even for override deals whose HubSpot bdr field differs.
  const repOwnerByDeal = new Map<string, string | undefined>();
  // Same, but the deal's AE — so engagement attribution can also be computed
  // relative to the AE (used by the AE view, where "you" = the AE, not the BDR).
  const aeOwnerByDeal = new Map<string, string | undefined>();
  for (const r of deduped) {
    repOwnerByDeal.set(String(r.id), name2idLower.get(r.bdr.toLowerCase()));
    aeOwnerByDeal.set(String(r.id), name2idLower.get(r.ae.toLowerCase()));
  }
  const engagements = await enrichEngagements(
    token,
    deduped.map((r) => String(r.id)),
    {
      bdrOwnerIds,
      repOwnerByDeal,
      aeOwnerByDeal,
      corpOwnerIds,
      ownerName: (ownerId) => (ownerId ? id2name.get(ownerId) ?? null : null),
    },
  );
  for (const r of deduped) {
    const e: Engagement | undefined = engagements.get(String(r.id));
    r.lastInbound = e?.lastInbound ?? null;
    r.lastBdrOutbound = e?.lastBdrOutbound ?? null;
  }

  // Give every company a single owner (rules of engagement). Money and stages
  // now come straight from HubSpot (no Corgi enrichment), so the owned rows are
  // the final rows.
  const owned = collapseCrossBdr(deduped);

  // Set the DISPLAYED "Last Rep Contact" to the rep's OWN activity (repLastContact
  // from the engagements pass), and attach the "someone else touched it" alert.
  // This runs AFTER ownership is resolved on purpose: the cross-BDR "who owns this
  // company" decision above still uses each deal's original pre-collapse
  // lastContact, so swapping the displayed value here can never move a deal (or
  // its money) to a different rep. Floor with meetingDate (= the deal's create
  // date) so the column is never blank when the rep has no logged activity yet.
  for (const r of owned) {
    const e = engagements.get(String(r.id));
    r.lastContact = e?.repLastContact ?? r.meetingDate;
    r.outsideActivity = e?.outside ?? null;
    // AE-relative versions of the same two signals (the AE view swaps to these so
    // "you" means the AE). Same post-collapse safety: display-only, never moves money.
    r.lastContactAe = e?.aeLastContact ?? r.meetingDate;
    r.outsideActivityAe = e?.aeOutside ?? null;
  }
  return owned;
}

// The expensive pull (all HubSpot deals + their engagements, ~30–60s cold)
// wrapped in Next's persistent Data Cache. Unlike a plain
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
export const getCachedProspects = unstable_cache(
  async (): Promise<Prospect[]> => {
    const token = process.env.HUBSPOT_TOKEN;
    if (!token) throw new Error("HUBSPOT_TOKEN is not set on the server.");
    return loadProspects(token);
  },
  ["prospects-v21"], // cache key (no secrets); bump the suffix to force a refresh
  { revalidate: REVALIDATE_SECONDS, tags: ["prospects"] },
);

// Edge/CDN caching for the finished rows. These are the SAME de-duped, owned
// rows getCachedProspects() already computes (and shares across instances via
// Next's Data Cache) — the header only lets Vercel's CDN serve that identical
// JSON from the edge, so no number changes. `s-maxage` mirrors REVALIDATE_SECONDS
// (5 min); stale-while-revalidate serves the cached copy while refreshing in the
// background, so a repeat visitor never waits on the slow HubSpot pull.
const CDN_CACHE = "public, s-maxage=300, stale-while-revalidate=900";

export async function GET() {
  if (!process.env.HUBSPOT_TOKEN) {
    return Response.json(
      { error: "HUBSPOT_TOKEN is not set on the server." },
      { status: 500 },
    );
  }

  try {
    const prospects = await getCachedProspects();
    return Response.json(prospects, {
      headers: { "Cache-Control": CDN_CACHE, "CDN-Cache-Control": CDN_CACHE },
    });
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
