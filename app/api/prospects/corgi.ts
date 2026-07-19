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

// What we keep about the best quote we found for one company.
export type CorgiMatch = {
  status: string | null; // e.g. "purchased", "quoted"
  premium: number; // annual premium in USD
  purchased: boolean; // true once the quote turned into a bought policy
};

// Strip the noise so "Acme, Inc." and "Acme Inc" match: lower-case, drop
// punctuation and common company suffixes, then collapse the spaces.
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
  offset: number,
  limit: number,
): Promise<{ ok: boolean; total: number | null; results: any[] }> {
  const url = `${CORGI_BASE}/quotes?limit=${limit}&offset=${offset}`;
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
  offset: number,
  limit: number,
  out: any[],
): Promise<void> {
  const page = await fetchPage(token, offset, limit);
  if (page.ok) {
    out.push(...page.results);
    return;
  }
  if (limit <= 1) return; // the poison record — skip it and move on
  const half = Math.floor(limit / 2);
  await collectWindow(token, offset, half, out);
  await collectWindow(token, offset + half, limit - half, out);
}

// Page through every quote and return the raw rows. First probes the total,
// then fetches all windows with bounded concurrency (Corgi throttles hard, so
// a small pool is as fast as it gets), salvaging good records around poison ones.
async function fetchAllQuotes(token: string): Promise<any[]> {
  // Probe record 0 (always healthy) just to read the total count.
  const probe = await fetchPage(token, 0, 1);
  if (!probe.ok) return [];
  const total = Math.min(probe.total ?? PAGE_SIZE, MAX_QUOTES);

  const offsets: number[] = [];
  for (let o = 0; o < total; o += PAGE_SIZE) offsets.push(o);

  const out: any[] = [];
  let next = 0;
  async function worker() {
    while (next < offsets.length) {
      const offset = offsets[next++];
      await collectWindow(token, offset, PAGE_SIZE, out);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, offsets.length) }, worker),
  );
  return out;
}

// Build the company → best-quote lookup. When a company has several quotes, a
// purchased one wins (that's confirmed revenue); otherwise the higher premium.
export function indexByCompany(quotes: any[]): Map<string, CorgiMatch> {
  const map = new Map<string, CorgiMatch>();
  for (const q of quotes) {
    const company =
      typeof q?.entity_legal_name === "string" ? q.entity_legal_name : "";
    const key = normalizeCompany(company);
    if (!key) continue;
    const status: string | null = q?.status ?? null;
    const match: CorgiMatch = {
      status,
      premium: Math.round(Number(q?.annual_premium) || 0),
      purchased: isPurchased(status),
    };
    const prev = map.get(key);
    if (!prev) {
      map.set(key, match);
      continue;
    }
    const better =
      (match.purchased && !prev.purchased) ||
      (match.purchased === prev.purchased && match.premium > prev.premium);
    if (better) map.set(key, match);
  }
  return map;
}

// In-memory index shared across requests on this server instance, plus a
// single in-flight promise so concurrent requests share one pull.
let cache: { at: number; index: Map<string, CorgiMatch> } | null = null;
let inFlight: Promise<Map<string, CorgiMatch> | null> | null = null;

// Pull (or reuse) the quote index. Returns null when there's no key or the
// pull failed, so the caller can fall back to HubSpot stages instead of
// treating every deal as un-quoted. A successful pull is a (non-empty) Map.
export async function getCorgiIndex(): Promise<Map<string, CorgiMatch> | null> {
  const token = process.env.CORGI_PARTNER_TOKEN;
  if (!token) return null;
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.index;
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const quotes = await fetchAllQuotes(token);
        if (quotes.length === 0) return cache?.index ?? null; // pull failed
        const index = indexByCompany(quotes);
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

// Find the quote for one company name (null when there's no match).
export function matchCompany(
  index: Map<string, CorgiMatch>,
  company: string,
): CorgiMatch | null {
  const key = normalizeCompany(company);
  if (!key) return null;
  return index.get(key) ?? null;
}
