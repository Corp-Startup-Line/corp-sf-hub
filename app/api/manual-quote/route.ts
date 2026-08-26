// ============================================================================
// SERVER ROUTE: /api/manual-quote  (app/api/manual-quote/route.ts)
// ----------------------------------------------------------------------------
// Reads and writes the shared, DISPLAY-ONLY manual quotes (see quoteStore.ts).
// This never touches HubSpot or any money total — it just remembers a number a
// teammate typed onto a deal, so everyone sees the same value.
//
//   GET  → { configured, quotes }  — the whole overlay map, keyed by deal id.
//   POST → { id, value, by }       — upsert one quote (or clear it when value
//                                     is blank/null). Returns the saved entry.
//
// The site-wide password gate (proxy.ts) already protects this route: any /api
// path without a valid session cookie is rejected with 401 before it runs.
// ============================================================================

import {
  getAllQuotes,
  setQuote,
  clearQuote,
  storeConfigured,
} from "../../lib/quoteStore";

// Never cache: reads must always reflect the latest saved quotes, and writes
// obviously can't be cached.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const quotes = await getAllQuotes();
    return Response.json({ configured: storeConfigured(), quotes });
  } catch {
    // If the store hiccups, don't break the dashboard — return an empty overlay.
    return Response.json({ configured: storeConfigured(), quotes: {} });
  }
}

export async function POST(request: Request) {
  // Store not connected yet → tell the UI so it can show a setup hint.
  if (!storeConfigured()) {
    return Response.json(
      { configured: false, error: "store-not-configured" },
      { status: 503 },
    );
  }

  let body: { id?: unknown; value?: unknown; by?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad-json" }, { status: 400 });
  }

  // The join key is the HubSpot deal id (a stable number that survives refreshes
  // and de-dup), so quotes always re-attach to the right row.
  const id = String(body?.id ?? "").trim();
  if (!/^\d+$/.test(id)) {
    return Response.json({ error: "bad-id" }, { status: 400 });
  }

  const by = String(body?.by ?? "").trim().slice(0, 60);
  const rawValue = body?.value;

  // Blank / null value = clear the manual quote for this deal.
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    try {
      await clearQuote(id);
      return Response.json({ configured: true, cleared: true, id });
    } catch {
      return Response.json({ error: "store-write-failed" }, { status: 502 });
    }
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0 || value > 100_000_000) {
    return Response.json({ error: "bad-value" }, { status: 400 });
  }
  if (!by) {
    return Response.json({ error: "missing-name" }, { status: 400 });
  }

  try {
    const entry = await setQuote(id, Math.round(value), by);
    return Response.json({ configured: true, entry, id });
  } catch {
    return Response.json({ error: "store-write-failed" }, { status: 502 });
  }
}
