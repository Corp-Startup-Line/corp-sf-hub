// ============================================================================
// SERVER-ONLY: Corgi (Django) quote lookup  (app/api/prospects/corgi.ts)
// ----------------------------------------------------------------------------
// Corgi's API can't search by company — you can only page through EVERY quote.
// So this runs ONLY on the server (same place the secret key lives): it pages
// through all quotes with the partner key, boils each one down to
// { status, premium } keyed by a normalised company name, and hands back a
// lookup table. The deals route then attaches a quote to a deal ONLY when the
// company name matches — every other company's data is dropped right here and
// never gets saved, never leaves the server, and never reaches the browser.
// ============================================================================

const CORGI_BASE = "https://api.corgi.insure/api/external/v1";
const PAGE_SIZE = 100; // the API's maximum page size
const MAX_QUOTES = 40_000; // safety cap so we can never loop forever
const CONCURRENCY = 8; // parallel page fetches (Corgi throttles above this)
const CACHE_TTL_MS = 10 * 60 * 1000; // reuse the pulled quotes for 10 minutes

// One distinct confirmed-revenue unit credited to a Closed Won deal. Its dollar
// figure comes from the PURCHASED QUOTE's annual_premium (the exact base premium
// Django's UI shows for a sale) — NOT from summing the /policies per-line
// premiums, which don't add up to the quote total and double-count re-issued
// bundles. The purchase month is taken from the matching /policies purchased_at.
// `keys` are every handle we can match a HubSpot deal on — the company legal name
// and the buyer's email, normalised — so a deal found by ANY of them can claim it.
export type CorgiPolicy = {
  id: string; // synthetic "companyKey|premium|idx" — one distinct sale unit
  premium: number; // the purchased quote's annual premium (USD)
  month: string; // "YYYY-MM" taken from the policy's purchased_at
  keys: string[]; // normalised legal name / email handles
  nameKeys: string[]; // just the name-derived handles (a strong, non-shared match)
};

// Everything we keep about ONE company's quotes in Corgi/Django. A company can
// buy several policies (e.g. cyber + tech E&O), so we keep the FULL list of
// purchased premiums — not just the biggest one — and their running total.
// `purchasedSum` is the company's real confirmed revenue; `purchasedPremiums`
// lets the deals route spread those policies across a company's HubSpot deals
// so no single policy is ever counted twice.
export type CorgiCompany = {
  purchasedPremiums: number[]; // each purchased policy's annual premium (USD)
  purchasedSum: number; // sum of the above = confirmed revenue for the company
  quotedPremium: number; // largest annual premium among NON-purchased quotes —
  // i.e. what we quoted but haven't sold yet. Shown in the deal finder's Quote
  // column so open deals display their quoted figure; NEVER counted as revenue.
  hasQuote: boolean; // a quote exists at all (any status)
  hasPurchased: boolean; // at least one quote turned into a bought policy
  status: string | null; // a representative status ("purchased" once bought)
};

// Strip the noise so "Acme, Inc." and "Acme Inc" match: lower-case, drop
// punctuation and common company suffixes, then collapse the spaces.
export function normalizeCompany(name: string): string {
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

// Tidy an email for matching: lower-case and trim. Emails are a far stronger
// contact identifier than a name — one address points to exactly one buyer — so
// we key the fallback index on this. Empty/whitespace becomes "" (no match).
export function normalizeEmail(email: string | null | undefined): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

// A quote whose status means "money confirmed" (bought policy).
function isPurchased(status: string | null): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s === "purchased" || s === "active" || s === "bound" || s === "issued";
}

// A quote that is a REAL, live quote the BDR has raised — i.e. it counts as
// "Quoted" on the dashboard. "quoted" is the finished figure; "needs_review" is a
// genuine quote parked for the underwriting team (Django sometimes leaves its
// premium at $0 until they finish, but it's still a real quote); "submitted" is
// on its way. A "draft" is an unfinished form (often $0, junk test rows) — NOT a
// real quote, so it never promotes a deal to Quoted. "purchased" is handled
// separately as confirmed revenue.
function isRealQuoteStatus(status: string | null): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s === "quoted" || s === "needs_review" || s === "submitted";
}

// The domain part of an email ("karan@trycosmos.ai" → "trycosmos.ai"). Empty
// when there's no "@". Used as a company handle when the buyer's personal email
// differs but their company domain is the same across HubSpot and Django.
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim() : "";
}

// Free / shared email providers — a match on one of these means nothing (two
// unrelated companies both using gmail aren't the same buyer), so domains like
// these are never used as a company handle.
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com",
  "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com",
  "hey.com", "pm.me", "zoho.com", "yandex.com", "fastmail.com",
]);

export function isPublicDomain(domain: string): boolean {
  return !domain || PUBLIC_EMAIL_DOMAINS.has(domain);
}

// One page request. Returns the parsed rows, the server's reported total, and
// whether it succeeded. Corgi occasionally 500s on a single malformed quote
// record, poisoning any page that spans it — callers handle that.
async function fetchPage(
  token: string,
  resource: "quotes" | "policies",
  offset: number,
  limit: number,
): Promise<{ ok: boolean; total: number | null; results: any[] }> {
  const url = `${CORGI_BASE}/${resource}?limit=${limit}&offset=${offset}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return { ok: false, total: null, results: [] };
  const json = await res.json().catch(() => null);
  const data = json?.data;
  return {
    ok: true,
    total: typeof data?.total === "number" ? data.total : null,
    results: data?.results ?? [],
  };
}

// Collect a window of quotes, working AROUND poison records. If a page fails,
// split it in half and retry each half; a window of size 1 that still fails is
// the single bad record itself, so we skip it (losing one quote, not the run).
async function collectWindow(
  token: string,
  resource: "quotes" | "policies",
  offset: number,
  limit: number,
  out: any[],
): Promise<void> {
  const page = await fetchPage(token, resource, offset, limit);
  if (page.ok) {
    out.push(...page.results);
    return;
  }
  if (limit <= 1) return; // the poison record — skip it and move on
  const half = Math.floor(limit / 2);
  await collectWindow(token, resource, offset, half, out);
  await collectWindow(token, resource, offset + half, limit - half, out);
}

// Page through every quote and return the raw rows. First probes the total,
// then fetches all windows with bounded concurrency (Corgi throttles hard, so
// a small pool is as fast as it gets), salvaging good records around poison ones.
async function fetchAll(
  token: string,
  resource: "quotes" | "policies",
): Promise<any[]> {
  // Probe record 0 (always healthy) just to read the total count.
  const probe = await fetchPage(token, resource, 0, 1);
  if (!probe.ok) return [];
  const total = Math.min(probe.total ?? PAGE_SIZE, MAX_QUOTES);

  const offsets: number[] = [];
  for (let o = 0; o < total; o += PAGE_SIZE) offsets.push(o);

  const out: any[] = [];
  let next = 0;
  async function worker() {
    while (next < offsets.length) {
      const offset = offsets[next++];
      await collectWindow(token, resource, offset, PAGE_SIZE, out);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, offsets.length) }, worker),
  );
  return out;
}

// Round a dollar amount to whole cents (avoids 4584.6199999 float noise).
function toCents(n: number): number {
  return Math.round(n * 100) / 100;
}

// One purchased quote reduced to the two fields that tell policies apart:
// its annual premium and its coverage type ("directors-and-officers", etc.).
type PurchasedItem = { premium: number; coverage: string | null };

// How close two premiums must be (as a fraction) to count as "the same money".
// 5% comfortably catches a re-quote that drifted a couple of percent (Blue Ocean:
// $102,011 vs $104,370 ≈ 2.3%) without merging genuinely different policies.
const DUP_PREMIUM_TOLERANCE = 0.05;

// True when two premiums are within the tolerance of each other (0 vs 0 counts).
function premiumsClose(a: number, b: number): boolean {
  const m = Math.max(Math.abs(a), Math.abs(b));
  if (m === 0) return true;
  return Math.abs(a - b) / m <= DUP_PREMIUM_TOLERANCE;
}

// Collapse a company's PURCHASED quotes down to its real, distinct policies —
// summing genuine bundles (a customer who bought D&O + cyber + tech-E&O keeps
// all three) while dropping duplicate/revised quotes for the SAME policy that
// Django sometimes leaves marked "purchased". The discriminator learned from the
// data is COVERAGE:
//   • Two quotes with the same non-null coverage are a revision of one policy —
//     keep the larger, never both (e.g. two D&O quotes).
//   • Two quotes with different non-null coverages are distinct policies — sum.
//   • A null-coverage quote (Django sometimes omits it) can't be told apart by
//     type, so it's judged a duplicate only when its premium is within 5% of a
//     policy we're already keeping (Blue Ocean's null $104,370 next to its D&O
//     $102,011); otherwise it stands as its own policy. Premium is NEVER used to
//     merge two known-different coverages, so near-priced distinct policies
//     (Avono's D&O $7,082 and tech-E&O $7,171) both survive.
// Returns the kept premiums (each a distinct policy), largest first.
export function dedupePurchased(items: PurchasedItem[]): number[] {
  // Start with the non-null coverages: one entry per coverage type, largest
  // premium wins (a same-coverage re-quote collapses into it).
  const byCoverage = new Map<string, number>();
  const nulls: number[] = [];
  for (const it of items) {
    if (it.premium <= 0) continue; // a $0 "purchased" quote adds no revenue
    if (it.coverage) {
      const prev = byCoverage.get(it.coverage) ?? 0;
      if (it.premium > prev) byCoverage.set(it.coverage, it.premium);
    } else {
      nulls.push(it.premium);
    }
  }

  const kept = [...byCoverage.values()];
  // Fold each null-coverage quote (largest first) into the nearest kept policy
  // when their premiums match; otherwise it's a genuinely separate policy.
  for (const prem of nulls.sort((a, b) => b - a)) {
    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < kept.length; i++) {
      if (!premiumsClose(prem, kept[i])) continue;
      const diff = Math.abs(prem - kept[i]);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) kept.push(prem); // no match → its own policy
    else if (prem > kept[bestIdx]) kept[bestIdx] = prem; // duplicate → keep larger
  }
  return kept.map(toCents).sort((a, b) => b - a);
}

// Build the company → all-its-quotes lookup. A company's PURCHASED quotes are
// buffered with their coverage, then de-duplicated (see dedupePurchased) so a
// customer's genuinely distinct policies are summed while revised/duplicate
// quotes for one policy are collapsed. Merely quoted / draft records still flag
// "this company has a quote" but don't add to confirmed revenue.
function indexBy(
  quotes: any[],
  keyOf: (q: any) => string,
): Map<string, CorgiCompany> {
  const map = new Map<string, CorgiCompany>();
  // Buffer of each key's purchased quotes (premium + coverage), de-duped
  // after the full pass so same-policy revisions across pages collapse together.
  const purchasedByKey = new Map<string, PurchasedItem[]>();

  for (const q of quotes) {
    const key = keyOf(q);
    if (!key) continue;
    const status: string | null = q?.status ?? null;
    // Only real quotes and purchases count. A draft (unfinished $0 form, often a
    // junk/test row) is ignored entirely, so a company with nothing but drafts
    // gets no entry and is never wrongly flagged "Quoted".
    if (!isPurchased(status) && !isRealQuoteStatus(status)) continue;
    const premium = toCents(Number(q?.annual_premium) || 0);
    const coverage: string | null =
      typeof q?.coverage === "string" ? q.coverage : null;

    let e = map.get(key);
    if (!e) {
      e = {
        purchasedPremiums: [],
        purchasedSum: 0,
        quotedPremium: 0,
        hasQuote: false,
        hasPurchased: false,
        status: null,
      };
      map.set(key, e);
    }
    e.hasQuote = true;
    if (isPurchased(status)) {
      e.hasPurchased = true;
      e.status = "purchased";
      const buf = purchasedByKey.get(key);
      if (buf) buf.push({ premium, coverage });
      else purchasedByKey.set(key, [{ premium, coverage }]);
    } else {
      if (!e.status) e.status = status; // keep the first non-purchased status
      // Remember the largest amount we quoted this company (not yet sold), so
      // the deal finder can show a real quote figure instead of $0.
      if (premium > e.quotedPremium) e.quotedPremium = premium;
    }
  }

  // De-dupe each company's purchased quotes into its distinct policies, then
  // record them and their true confirmed-revenue total.
  for (const [key, items] of purchasedByKey) {
    const e = map.get(key)!;
    e.purchasedPremiums = dedupePurchased(items);
    e.purchasedSum = toCents(
      e.purchasedPremiums.reduce((sum, p) => sum + p, 0),
    );
  }
  return map;
}

// The full lookup we hand back: quotes keyed BOTH by company name and by the
// buyer's email. `byCompany` is the primary match; `byEmail` is the fallback the
// deals route uses when a won deal's company name doesn't line up with Corgi's
// spelling. `emailCompanyKeys` records, for each email, which company name(s) its
// quotes belong to — the route uses this to make sure a premium already counted
// via a company-name match is never counted a second time via the email match.
export type CorgiIndex = {
  byCompany: Map<string, CorgiCompany>;
  byEmail: Map<string, CorgiCompany>;
  // Quotes aggregated by the buyer's EMAIL DOMAIN (company domain, public
  // providers excluded). Lets an open deal find its Django quote when the exact
  // buyer email differs but the company domain is the same — e.g. a HubSpot
  // contact at trycosmos.ai matching a Django quote from another trycosmos.ai
  // address. Display-only (flags "has a quote" + a quoted figure); never revenue.
  byDomain: Map<string, CorgiCompany>;
  emailCompanyKeys: Map<string, Set<string>>;
  // Every distinct confirmed-revenue unit (purchased-quote premium + real
  // purchase date), the source of truth for Closed Won money. The deals route
  // assigns each unit to exactly ONE won deal (so no sale is counted twice) and
  // dates that deal by the unit's purchased_at month, instead of HubSpot's
  // migration-corrupted close date.
  policies: CorgiPolicy[];
};

// Build the revenue units the dashboard credits to Closed Won deals. The dollar
// figure is the PURCHASED QUOTE's annual_premium — the exact number Django's UI
// shows as a sale's base premium (e.g. Izuma $9,253.63, Mainstay $7,469.05). The
// /policies feed is used ONLY for the real purchase DATE (purchased_at): its
// per-line `premium` values don't sum to the quote total, and Django lists a
// re-issued bundle's old + new lines both as "active", so summing them
// double-counted the same sale. The rare company whose purchased quote is
// missing or $0 falls back to its policy lines (deduped, so still counted once).
type RevItem = {
  premium: number;
  coverage: string | null;
  nameKeys: string[]; // strong name handles (insured/org/entity legal name)
  email: string; // exact buyer email (domain deliberately never used — shared
  // broker inboxes span unrelated companies, e.g. jeremy@waxregistry.com)
  month: string; // "YYYY-MM"
};

// Earliest purchase month per company handle (name or email), read from
// /policies — the only feed carrying a real purchased_at date.
function buildMonthMap(policies: any[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of policies) {
    if (String(p?.status ?? "").toLowerCase() === "cancelled") continue;
    const month =
      typeof p?.purchased_at === "string" ? p.purchased_at.slice(0, 7) : "";
    if (!month) continue;
    const keys = [
      normalizeCompany(p?.insured_legal_name ?? ""),
      normalizeCompany(p?.organization_name ?? ""),
      normalizeEmail(p?.customer_email),
    ].filter(Boolean);
    for (const k of keys) {
      const prev = m.get(k);
      if (!prev || month < prev) m.set(k, month); // keep the earliest
    }
  }
  return m;
}

function lookupMonth(map: Map<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = k ? map.get(k) : undefined;
    if (v) return v;
  }
  return "";
}

// Group a company's revenue items (purchased quotes, or fallback policy lines)
// by company, collapse revised/duplicate coverages via dedupePurchased (so a
// re-bought bundle counts once) while summing genuinely distinct coverages, and
// emit one CorgiPolicy-shaped unit per surviving premium. Grouped by the company
// NAME key (falling back to email) — the same handle deals are matched on later.
function groupUnits(items: RevItem[]): CorgiPolicy[] {
  const byKey = new Map<string, RevItem[]>();
  for (const it of items) {
    const gk = it.nameKeys[0] || it.email;
    if (!gk) continue;
    const arr = byKey.get(gk);
    if (arr) arr.push(it);
    else byKey.set(gk, [it]);
  }
  const out: CorgiPolicy[] = [];
  for (const [gk, arr] of byKey) {
    const deduped = dedupePurchased(
      arr.map((i) => ({ premium: i.premium, coverage: i.coverage })),
    );
    if (deduped.length === 0) continue;
    const nameKeys = [...new Set(arr.flatMap((i) => i.nameKeys))].filter(Boolean);
    const emails = [...new Set(arr.map((i) => i.email).filter(Boolean))];
    const month = arr.map((i) => i.month).filter(Boolean).sort()[0] || "";
    deduped.forEach((prem, idx) =>
      out.push({
        id: `${gk}|${prem}|${idx}`,
        premium: prem,
        month,
        keys: [...nameKeys, ...emails],
        nameKeys,
      }),
    );
  }
  return out;
}

// The revenue units, the single source of truth for Closed Won money. Primary
// source is the PURCHASED QUOTE annual_premium (matches Django's UI); /policies
// supplies the purchase date and covers the rare company whose quote is $0.
export function buildPurchasedQuotes(
  quotes: any[],
  policies: any[],
): CorgiPolicy[] {
  const monthByKey = buildMonthMap(policies);

  // 1) Purchased quotes → the real base premium per company.
  const quoteItems: RevItem[] = [];
  const covered = new Set<string>(); // company handles that have a purchased quote
  for (const q of quotes) {
    if (!isPurchased(q?.status ?? null)) continue;
    const premium = toCents(Number(q?.annual_premium) || 0);
    if (premium <= 0) continue; // $0 purchased quote → left to the policy fallback
    const nameKey = normalizeCompany(
      typeof q?.entity_legal_name === "string" ? q.entity_legal_name : "",
    );
    const email = normalizeEmail(q?.customer_email);
    if (!nameKey && !email) continue;
    if (nameKey) covered.add(nameKey);
    if (email) covered.add(email);
    const month =
      lookupMonth(monthByKey, [nameKey, email]) ||
      (typeof q?.created_at === "string" ? q.created_at.slice(0, 7) : "");
    quoteItems.push({
      premium,
      coverage: typeof q?.coverage === "string" ? q.coverage : null,
      nameKeys: nameKey ? [nameKey] : [],
      email,
      month,
    });
  }

  // 2) Fallback: policy lines, but ONLY for companies with NO purchased quote
  //    (so the correct quote total is never overridden or double-counted).
  const polItems: RevItem[] = [];
  for (const p of policies) {
    if (String(p?.status ?? "").toLowerCase() === "cancelled") continue;
    const month =
      typeof p?.purchased_at === "string" ? p.purchased_at.slice(0, 7) : "";
    if (!month) continue;
    const premium = toCents(Number(p?.premium) || 0);
    if (premium <= 0) continue;
    const nameKeys = [
      normalizeCompany(p?.insured_legal_name ?? ""),
      normalizeCompany(p?.organization_name ?? ""),
    ].filter((k, i, a) => k && a.indexOf(k) === i);
    const email = normalizeEmail(p?.customer_email);
    if (nameKeys.length === 0 && !email) continue;
    if (nameKeys.some((k) => covered.has(k)) || (email && covered.has(email))) {
      continue; // this company already has a purchased-quote figure
    }
    polItems.push({
      premium,
      coverage: typeof p?.coverage_type === "string" ? p.coverage_type : null,
      nameKeys,
      email,
      month,
    });
  }

  return [...groupUnits(quoteItems), ...groupUnits(polItems)];
}

// Build the company index, the email index, and the email→company-name map in
// one pass over the quotes. Same aggregation either way; only the key differs.
export function buildCorgiIndex(quotes: any[], policies: any[]): CorgiIndex {
  const byCompany = indexBy(quotes, (q) =>
    normalizeCompany(
      typeof q?.entity_legal_name === "string" ? q.entity_legal_name : "",
    ),
  );
  const byEmail = indexBy(quotes, (q) => normalizeEmail(q?.customer_email));
  const byDomain = indexBy(quotes, (q) => {
    const dom = emailDomain(normalizeEmail(q?.customer_email));
    return isPublicDomain(dom) ? "" : dom; // public/empty domains → no key
  });

  const emailCompanyKeys = new Map<string, Set<string>>();
  for (const q of quotes) {
    const emailKey = normalizeEmail(q?.customer_email);
    if (!emailKey) continue;
    const companyKey = normalizeCompany(
      typeof q?.entity_legal_name === "string" ? q.entity_legal_name : "",
    );
    if (!companyKey) continue;
    const set = emailCompanyKeys.get(emailKey);
    if (set) set.add(companyKey);
    else emailCompanyKeys.set(emailKey, new Set([companyKey]));
  }

  return {
    byCompany,
    byEmail,
    byDomain,
    emailCompanyKeys,
    policies: buildPurchasedQuotes(quotes, policies),
  };
}

// In-memory index shared across requests on this server instance, plus a
// single in-flight promise so concurrent requests share one pull.
let cache: { at: number; index: CorgiIndex } | null = null;
let inFlight: Promise<CorgiIndex | null> | null = null;

// Pull (or reuse) the quote index. Returns null when there's no key or the
// pull failed, so the caller can fall back to HubSpot stages instead of
// treating every deal as un-quoted. A successful pull is a populated CorgiIndex.
export async function getCorgiIndex(): Promise<CorgiIndex | null> {
  const token = process.env.CORGI_PARTNER_TOKEN;
  if (!token) return null;
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.index;
  if (!inFlight) {
    inFlight = (async () => {
      try {
        // Pull quotes (for quoted premiums) and policies (for confirmed
        // purchases + their real purchase dates) side by side.
        const [quotes, policies] = await Promise.all([
          fetchAll(token, "quotes"),
          fetchAll(token, "policies"),
        ]);
        if (quotes.length === 0) return cache?.index ?? null; // pull failed
        const index = buildCorgiIndex(quotes, policies);
        cache = { at: Date.now(), index };
        return index;
      } catch {
        return cache?.index ?? null;
      } finally {
        inFlight = null;
      }
    })();
  }
  return inFlight;
}

// Find a company's Corgi record by EXACT normalised name (null when there's no
// match). This is the match that drives confirmed revenue and cross-BDR deal
// ownership, so it stays strict on purpose — a looser match here could hand one
// BDR's purchased policy to another's deal. Fuzzy name matching for DISPLAY-only
// quote flags on open deals lives in matchCompanyLoose.
export function matchCompany(
  index: Map<string, CorgiCompany>,
  company: string,
): CorgiCompany | null {
  const key = normalizeCompany(company);
  if (!key) return null;
  return index.get(key) ?? null;
}

// A looser name match for OPEN deals only (never revenue/ownership). Tries the
// exact name first, then a UNIQUE prefix match: HubSpot often holds a short brand
// ("Anomaly", "Cloudbreak Energy") while Django files the full legal name
// ("Anomaly Innovations Inc.", "Cloudbreak Energy Partners LLC"). If exactly one
// Django company's name starts with the deal's name it's that company; if several
// do it's ambiguous and we refuse to guess (so two firms are never merged). Short
// deal names (< 5 chars) are too generic to prefix-match and only match exactly.
export function matchCompanyLoose(
  index: Map<string, CorgiCompany>,
  company: string,
): CorgiCompany | null {
  const key = normalizeCompany(company);
  if (!key) return null;
  const exact = index.get(key);
  if (exact) return exact;
  if (key.length < 5) return null; // too short/generic to prefix-match safely
  let hit: CorgiCompany | null = null;
  let count = 0;
  for (const [k, v] of index) {
    if (k !== key && k.startsWith(key)) {
      count++;
      if (count > 1) return null; // more than one → ambiguous, don't guess
      hit = v;
    }
  }
  return count === 1 ? hit : null;
}
