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

// One PURCHASED policy from the /policies endpoint. Django's /policies feed is
// the source of truth for confirmed revenue: unlike /quotes (which often marks a
// bought policy "purchased" but leaves its premium at $0), every policy here
// carries its REAL annual premium and the REAL date it was bought
// (`purchased_at`). Each record is one distinct sale (unique policy_number), so
// there's no de-duping to do. `keys` are every handle we can match a HubSpot deal
// on — the insured legal name, the organization name, and the buyer's email, all
// normalised — so a deal found by ANY of them can claim this policy.
export type CorgiPolicy = {
  id: string; // policy_number — the unique sale, so each is counted once
  premium: number; // the policy's annual premium (USD)
  month: string; // "YYYY-MM" taken from purchased_at
  keys: string[]; // normalised legal name / org name / email handles
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
  emailCompanyKeys: Map<string, Set<string>>;
  // Every distinct PURCHASED policy (from /policies), the source of truth for
  // confirmed revenue and its real purchase date. The deals route assigns each
  // policy to exactly ONE won deal (so no sale is ever counted twice) and dates
  // that deal by the policy's purchased_at month, instead of trusting the
  // /quotes feed (which zeroes purchased premiums) or HubSpot's close date.
  policies: CorgiPolicy[];
};

// Reduce the raw /policies feed to the list of distinct purchased policies we
// credit as revenue. Each record is already one unique sale (policy_number), so
// we only tag it with the handles a HubSpot deal can be matched on — the insured
// legal name, the organization name (both "strong" name handles), and the
// buyer's email — and drop anything with no premium or no purchase date.
export function buildPolicies(policies: any[]): CorgiPolicy[] {
  const out: CorgiPolicy[] = [];
  for (const p of policies) {
    // A cancelled policy is churned, not won revenue — and Django often leaves
    // the ORIGINAL (later re-bought) policy sitting as "cancelled" next to its
    // active replacement, so counting it double-counts the same sale. Skip it.
    if (String(p?.status ?? "").toLowerCase() === "cancelled") continue;
    const month =
      typeof p?.purchased_at === "string" ? p.purchased_at.slice(0, 7) : "";
    if (!month) continue; // no purchase date → can't recognise it
    const premium = toCents(Number(p?.premium) || 0);
    if (premium <= 0) continue; // a $0 policy adds no revenue
    const nameKeys = [
      normalizeCompany(p?.insured_legal_name ?? ""),
      normalizeCompany(p?.organization_name ?? ""),
    ].filter((k, i, a) => k && a.indexOf(k) === i);
    const email = normalizeEmail(p?.customer_email);
    const keys = email ? [...nameKeys, email] : [...nameKeys];
    if (keys.length === 0) continue; // nothing to match a deal on
    const id =
      typeof p?.policy_number === "string" && p.policy_number
        ? p.policy_number
        : `${keys[0]}|${premium}|${month}`;
    out.push({ id, premium, month, keys, nameKeys });
  }
  return out;
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

  return { byCompany, byEmail, emailCompanyKeys, policies: buildPolicies(policies) };
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

// Find a company's Corgi record by name (null when there's no match).
export function matchCompany(
  index: Map<string, CorgiCompany>,
  company: string,
): CorgiCompany | null {
  const key = normalizeCompany(company);
  if (!key) return null;
  return index.get(key) ?? null;
}
