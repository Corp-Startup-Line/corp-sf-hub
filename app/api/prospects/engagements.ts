// ============================================================================
// SERVER-ONLY: HubSpot engagement enrichment  (app/api/prospects/engagements.ts)
// ----------------------------------------------------------------------------
// The deal record alone can't tell us WHO last spoke to a customer or which way
// the conversation went. That lives in HubSpot's "engagements" — the individual
// call and email records. This module attaches two dates to each deal:
//
//   lastInbound      — the last time the CUSTOMER reached in (an inbound call
//                      that connected, or an incoming email from their contacts)
//   lastBdrOutbound  — the last time one of OUR BDRs reached out (an outbound
//                      call the BDR logged)
//
//   lastInbound  — despite the name, this is now the last POSITIVE CONTACT: the
//                  last time a real conversation happened OR the customer reached
//                  in. That means (a) any call that CONNECTED — a live person
//                  answered — in EITHER direction (an inbound call they picked up,
//                  or an outbound call of ours that got through), or (b) an
//                  incoming email from their contacts. A cold call that rang out
//                  or hit voicemail is NOT positive contact.
//
// How the data is shaped in HubSpot (confirmed by probing the live portal):
//   • Calls associate DIRECTLY to a deal, and carry hs_call_direction
//     (INBOUND / OUTBOUND) plus hubspot_owner_id (who made the call) — so calls
//     give us both direction AND the person, reliably.
//   • Whether a call CONNECTED is read from hs_call_disposition (a coded
//     outcome). This portal uses HubSpot's built-in "Connected" plus a set of
//     custom "Answered - ..." outcomes (Meeting Set, Referral, Not Interested,
//     etc.); every one of those means a live person answered. "No answer",
//     "Left voicemail", "Busy", "Wrong number" and "Left live message" do not.
//     Rather than hard-code the portal's GUIDs (they differ per portal), we read
//     the portal's own disposition list and treat any outcome labelled
//     "Connected" or starting with "Answered" as a real connect.
//   • Emails DON'T associate to a deal; they hang off the CONTACT. So to find a
//     deal's emails we go deal → contacts → emails. Emails carry
//     hs_email_direction (INCOMING_EMAIL = from the customer) but their
//     hubspot_owner_id is frequently null — so we trust emails for INBOUND
//     ("customer emailed us") but NOT for attributing an OUTBOUND email to a
//     specific BDR. BDR outreach is therefore measured from calls only.
//
// Everything here runs on the server and is folded into the same 5-minute cache
// as the deals, so the extra HubSpot calls happen at most once per cache window.
// ============================================================================

const HUBSPOT_BASE = "https://api.hubapi.com";

// Batch endpoints accept up to 100 ids per request.
const BATCH = 100;
// How many batch requests to run at once. Enrichment fans out over thousands of
// calls/emails, so at CONCURRENCY=4 the whole pass crept up to ~56s — too close
// to the 60s serverless ceiling. HubSpot's documented burst limit is ~150
// req/10s, so 10 parallel batch reads stays well under it while roughly halving
// the wall-clock time; the fetch helper still backs off on any 429/5xx blip.
const CONCURRENCY = 10;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Same retry behaviour as the deals route: back off on rate-limits/5xx so a
// burst of batch calls doesn't fail the whole enrichment.
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
  // A failed batch shouldn't kill the page — enrichment is best-effort, so we
  // swallow the error and return an empty result for this batch.
  return null;
}

// A call "connected" when a live person answered. HubSpot records the outcome
// as a GUID in hs_call_disposition; the GUID → label map is portal-specific, so
// we read it once from the portal and keep the GUIDs whose label is "Connected"
// or starts with "Answered" (this portal's custom "Answered - Meeting Set",
// "Answered - Not Interested", … are all real connects). Cached for 30 min.
const DISP_TTL_MS = 30 * 60 * 1000;
let connectedCache: { at: number; ids: Set<string> } | null = null;

// If the disposition list can't be read, fall back to the GUIDs observed live in
// this portal so the "connected" signal never silently disappears.
const FALLBACK_CONNECTED = new Set<string>([
  "f240bbac-87c9-4f6e-bf70-924b57d47db7", // Connected
  "a7e75897-da88-45c7-b9c8-0377e53916a0", // Answered - Call Back Later
  "06ac1f20-3cac-43c1-9e3d-0ec82fc68236", // Answered - Do Not Call Again
  "7a1c70f1-a1c8-4ba2-aaab-17d2e6fa8226", // Answered - Meeting Set
  "c17122f6-18d5-40e9-acd1-164fa47126b0", // Answered - Not Interested
  "2be1d824-9bd1-42c1-92f5-eafaf1988add", // Answered - Referral
  "4c32ee15-d66d-4496-a66c-71b59405329c", // Answered - Send an Email
]);

function isConnectedLabel(label: string): boolean {
  return label === "Connected" || label.startsWith("Answered");
}

async function connectedDispositions(token: string): Promise<Set<string>> {
  if (connectedCache && Date.now() - connectedCache.at < DISP_TTL_MS) {
    return connectedCache.ids;
  }
  const res = await hs("/calling/v1/dispositions", token);
  const arr = Array.isArray(res) ? res : res?.results ?? [];
  const ids = new Set<string>();
  for (const o of arr) {
    const id = o?.id ?? o?.value;
    if (id && isConnectedLabel(String(o?.label ?? ""))) ids.add(String(id));
  }
  // Empty means the read failed (or the portal has no dispositions) — use the
  // observed fallback rather than counting every call as "not connected".
  const final = ids.size ? ids : FALLBACK_CONNECTED;
  connectedCache = { at: Date.now(), ids: final };
  return final;
}

// Run an async task over each item with a bounded worker pool (keeps us under
// HubSpot's rate ceiling while still overlapping requests).
async function pool<T>(items: T[], run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      await run(item);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker),
  );
}

// Split a list of ids into 100-sized chunks for the batch endpoints.
function chunks(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH) out.push(ids.slice(i, i + BATCH));
  return out;
}

function uniq(ids: string[]): string[] {
  return [...new Set(ids)];
}

// Read "which <to> objects are associated with each <from> object", in batches.
// Returns fromId → [toId, ...]. Uses the CRM v4 batch association read.
async function assocBatch(
  token: string,
  from: string,
  to: string,
  ids: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (ids.length === 0) return out;
  await pool(chunks(ids), async (chunk) => {
    const body = { inputs: chunk.map((id) => ({ id })) };
    const res = await hs(
      `/crm/v4/associations/${from}/${to}/batch/read`,
      token,
      { method: "POST", body: JSON.stringify(body) },
    );
    for (const r of res?.results ?? []) {
      const fromId = String(r.from?.id ?? "");
      if (!fromId) continue;
      const toIds = (r.to ?? []).map((t: any) => String(t.toObjectId));
      const prev = out.get(fromId);
      if (prev) prev.push(...toIds);
      else out.set(fromId, toIds);
    }
  });
  return out;
}

// Read a set of properties for many objects (calls, emails) in batches.
// Returns objectId → properties.
async function objBatch(
  token: string,
  objType: string,
  ids: string[],
  properties: string[],
): Promise<Map<string, Record<string, string | null>>> {
  const out = new Map<string, Record<string, string | null>>();
  if (ids.length === 0) return out;
  await pool(chunks(ids), async (chunk) => {
    const body = { properties, inputs: chunk.map((id) => ({ id })) };
    const res = await hs(`/crm/v3/objects/${objType}/batch/read`, token, {
      method: "POST",
      body: JSON.stringify(body),
    });
    for (const r of res?.results ?? []) {
      out.set(String(r.id), r.properties ?? {});
    }
  });
  return out;
}

// Keep the later of two ISO timestamps (either may be null).
function laterIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(b).getTime() > new Date(a).getTime() ? b : a;
}

// "2026-06-18T17:32:04Z" → "2026-06-18" (or null).
function toDay(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

// A "last contact" can never be in the future: a meeting or call scheduled for a
// later date hasn't happened yet, so it must not count as the rep's most recent
// touch (otherwise "Last Rep Contact" shows dates weeks ahead of today). This
// guard applies ONLY to the rep's own last-contact — the outside-activity alert
// still intentionally surfaces future-booked meetings, and lastInbound /
// lastBdrOutbound are left untouched (cross-BDR ownership depends on them).
function notFuture(ts: string): boolean {
  return new Date(ts).getTime() <= Date.now();
}

// A single activity by someone OTHER than the deal's own rep — used to alert the
// rep that a teammate (usually the AE) touched their deal. `who` is the person's
// name when HubSpot records an owner (calls/meetings/notes always do; emails
// often don't → null = "someone else").
export type OutsideActivity = {
  date: string; // "YYYY-MM-DD"
  who: string | null; // teammate's name, or null when HubSpot didn't record one
  action: string; // human label: "logged a call" / "sent an email" / …
};

export type Engagement = {
  lastInbound: string | null; // last POSITIVE CONTACT: a connected call (either
  // direction) or an incoming email from the customer's contacts
  lastBdrOutbound: string | null; // last outbound call attempt by one of our BDRs
  repLastContact: string | null; // newest activity attributable to THIS deal's OWN
  // BDR, across the deal, its contacts, and its company (calls/meetings/notes the
  // BDR owns, plus outgoing emails). This is the BDR-relative "Last Rep Contact".
  outside: OutsideActivity | null; // newest activity NOT attributable to the BDR
  // (a teammate — usually the AE — logging a call/email/meeting/note on the deal)
  aeLastContact: string | null; // same, but relative to the deal's AE — the newest
  // activity the AE themselves logged (used in the AE view, where "you" = the AE)
  aeOutside: OutsideActivity | null; // newest activity NOT by the AE (the BDR or
  // another teammate touching the AE's deal) — the AE-view "someone else" alert
};

// Options describing, per deal, who the deal's own reps are — so we can split every
// activity into "the rep did this" vs "someone else did this", once relative to the
// BDR and once relative to the AE.
export type EnrichOptions = {
  bdrOwnerIds: Set<string>; // every rostered BDR's HubSpot user id (for lastBdrOutbound)
  repOwnerByDeal: Map<string, string | undefined>; // deal id → that deal's BDR user id
  aeOwnerByDeal: Map<string, string | undefined>; // deal id → that deal's AE user id
  ownerName: (ownerId: string | null | undefined) => string | null; // user id → display name
};

// Attach engagement dates to every deal id. Best-effort: any batch that fails is
// simply skipped, leaving that signal null rather than failing the whole dashboard.
//
// "Last Rep Contact" (repLastContact) counts only activity we can attribute to the
// deal's OWN rep: calls, meetings and notes whose HubSpot owner IS that rep, plus
// OUTGOING emails on the deal/contacts/company (this portal usually leaves email
// owner blank, so an owner-less outgoing email is treated as the rep's own; an
// outgoing email owned by a DIFFERENT person is not). Customer INBOUND emails
// never count as rep activity. Anything owned by a different teammate becomes the
// deal's "outside activity" alert.
export async function enrichEngagements(
  token: string,
  dealIds: string[],
  opts: EnrichOptions,
): Promise<Map<string, Engagement>> {
  const { bdrOwnerIds, repOwnerByDeal, aeOwnerByDeal, ownerName } = opts;

  // deal → its calls / meetings / notes (all associate directly to the deal),
  // deal → its contacts (emails hang off contacts), deal → its company.
  const [dealCalls, dealMeetings, dealNotes, dealContacts, dealCompanies] =
    await Promise.all([
      assocBatch(token, "deals", "calls", dealIds),
      assocBatch(token, "deals", "meetings", dealIds),
      assocBatch(token, "deals", "notes", dealIds),
      assocBatch(token, "deals", "contacts", dealIds),
      assocBatch(token, "deals", "companies", dealIds),
    ]);

  // Emails hang off contacts; company-level activity (reps often log against the
  // company, not the deal) hangs off the company. Fetch both sets of associations.
  const allContactIds = uniq([...dealContacts.values()].flat());
  const allCompanyIds = uniq([...dealCompanies.values()].flat());
  const [contactEmails, companyCalls, companyMeetings, companyNotes, companyEmails] =
    await Promise.all([
      assocBatch(token, "contacts", "emails", allContactIds),
      assocBatch(token, "companies", "calls", allCompanyIds),
      assocBatch(token, "companies", "meetings", allCompanyIds),
      assocBatch(token, "companies", "notes", allCompanyIds),
      assocBatch(token, "companies", "emails", allCompanyIds),
    ]);

  // Read the properties we need off every engagement object (deduped across the
  // deal- and company-level sources so each object is fetched once).
  const allCallIds = uniq([
    ...[...dealCalls.values()].flat(),
    ...[...companyCalls.values()].flat(),
  ]);
  const allMeetingIds = uniq([
    ...[...dealMeetings.values()].flat(),
    ...[...companyMeetings.values()].flat(),
  ]);
  const allNoteIds = uniq([
    ...[...dealNotes.values()].flat(),
    ...[...companyNotes.values()].flat(),
  ]);
  const allEmailIds = uniq([
    ...[...contactEmails.values()].flat(),
    ...[...companyEmails.values()].flat(),
  ]);
  const [callProps, meetingProps, noteProps, emailProps, connectedIds] =
    await Promise.all([
      objBatch(token, "calls", allCallIds, [
        "hs_call_direction",
        "hs_timestamp",
        "hubspot_owner_id",
        "hs_call_disposition",
      ]),
      objBatch(token, "meetings", allMeetingIds, [
        "hs_timestamp",
        "hubspot_owner_id",
      ]),
      objBatch(token, "notes", allNoteIds, ["hs_timestamp", "hubspot_owner_id"]),
      objBatch(token, "emails", allEmailIds, [
        "hs_email_direction",
        "hs_timestamp",
        "hubspot_owner_id",
      ]),
      connectedDispositions(token),
    ]);

  // Per-deal id gatherers: an activity "belongs" to a deal if it's on the deal
  // itself or on the deal's associated company (emails also via the contacts).
  const companyIdsOf = (dealId: string) => dealCompanies.get(dealId) ?? [];
  const callsOf = (dealId: string) =>
    uniq([
      ...(dealCalls.get(dealId) ?? []),
      ...companyIdsOf(dealId).flatMap((co) => companyCalls.get(co) ?? []),
    ]);
  const meetingsOf = (dealId: string) =>
    uniq([
      ...(dealMeetings.get(dealId) ?? []),
      ...companyIdsOf(dealId).flatMap((co) => companyMeetings.get(co) ?? []),
    ]);
  const notesOf = (dealId: string) =>
    uniq([
      ...(dealNotes.get(dealId) ?? []),
      ...companyIdsOf(dealId).flatMap((co) => companyNotes.get(co) ?? []),
    ]);
  const emailsOf = (dealId: string) =>
    uniq([
      ...(dealContacts.get(dealId) ?? []).flatMap(
        (cid) => contactEmails.get(cid) ?? [],
      ),
      ...companyIdsOf(dealId).flatMap((co) => companyEmails.get(co) ?? []),
    ]);

  const out = new Map<string, Engagement>();
  for (const dealId of dealIds) {
    // lastInbound / lastBdrOutbound keep their ORIGINAL meaning and sources (the
    // deal's own calls + the deal's contacts' incoming emails) so cross-BDR
    // ownership — which reads lastInbound — is unchanged.
    let lastInbound: string | null = null;
    let lastBdrOutbound: string | null = null;
    for (const callId of dealCalls.get(dealId) ?? []) {
      const p = callProps.get(callId);
      const ts = p?.hs_timestamp ?? null;
      if (!ts) continue;
      if (connectedIds.has(p?.hs_call_disposition ?? "")) {
        lastInbound = laterIso(lastInbound, ts);
      }
      if (
        p?.hs_call_direction === "OUTBOUND" &&
        bdrOwnerIds.has(p?.hubspot_owner_id ?? "")
      ) {
        lastBdrOutbound = laterIso(lastBdrOutbound, ts);
      }
    }
    for (const emailId of uniq(
      (dealContacts.get(dealId) ?? []).flatMap(
        (cid) => contactEmails.get(cid) ?? [],
      ),
    )) {
      const p = emailProps.get(emailId);
      const ts = p?.hs_timestamp ?? null;
      if (!ts) continue;
      if (p?.hs_email_direction === "INCOMING_EMAIL") {
        lastInbound = laterIso(lastInbound, ts);
      }
    }

    // repLastContact / outside: split every activity on the deal (and its
    // company/contacts) into "the rep did it" vs "a teammate did it". We run this
    // split twice — once with the BDR as the reference rep (for the BDR view) and
    // once with the AE (for the AE view) — so "you" always means the rep in focus.
    type OutsideAcc = { ts: string; tms: number; who: string | null; action: string };
    const attribute = (refOwner: string | undefined) => {
      let repLast: string | null = null;
      // Held in an object so TypeScript keeps the union type across the closure
      // that mutates it (a bare `let` would get narrowed to null).
      const acc: { best: OutsideAcc | null } = { best: null };
      // A teammate activity: only counted when we actually know the reference rep
      // (so we can be sure it wasn't them). Keeps the newest such activity.
      const pushOutside = (
        ts: string | null | undefined,
        ownerId: string | null | undefined,
        action: string,
      ) => {
        if (!ts || !refOwner || !ownerId || ownerId === refOwner) return;
        const tms = new Date(ts).getTime();
        if (!Number.isFinite(tms)) return;
        if (!acc.best || tms > acc.best.tms) {
          acc.best = { ts, tms, who: ownerName(ownerId), action };
        }
      };
      const ownedByRep = (ownerId: string | null | undefined) =>
        Boolean(refOwner) && ownerId === refOwner;

      for (const callId of callsOf(dealId)) {
        const p = callProps.get(callId);
        const ts = p?.hs_timestamp ?? null;
        if (!ts) continue;
        const owner = p?.hubspot_owner_id ?? null;
        if (ownedByRep(owner)) {
          if (notFuture(ts)) repLast = laterIso(repLast, ts);
        } else pushOutside(ts, owner, "logged a call");
      }
      for (const mId of meetingsOf(dealId)) {
        const p = meetingProps.get(mId);
        const ts = p?.hs_timestamp ?? null;
        if (!ts) continue;
        const owner = p?.hubspot_owner_id ?? null;
        if (ownedByRep(owner)) {
          if (notFuture(ts)) repLast = laterIso(repLast, ts);
        } else pushOutside(ts, owner, "logged a meeting");
      }
      for (const nId of notesOf(dealId)) {
        const p = noteProps.get(nId);
        const ts = p?.hs_timestamp ?? null;
        if (!ts) continue;
        const owner = p?.hubspot_owner_id ?? null;
        if (ownedByRep(owner)) {
          if (notFuture(ts)) repLast = laterIso(repLast, ts);
        } else pushOutside(ts, owner, "added a note");
      }
      for (const eId of emailsOf(dealId)) {
        const p = emailProps.get(eId);
        const ts = p?.hs_timestamp ?? null;
        if (!ts) continue;
        // Customer inbound email is never OUR activity — skip entirely.
        if (p?.hs_email_direction === "INCOMING_EMAIL") continue;
        const owner = p?.hubspot_owner_id ?? null;
        // Outgoing email owned by another teammate → outside; owner-less or the
        // rep's own → the rep's activity (email owner is usually blank here).
        if (owner && refOwner && owner !== refOwner) {
          pushOutside(ts, owner, "sent an email");
        } else if (notFuture(ts)) {
          repLast = laterIso(repLast, ts);
        }
      }

      return {
        repLastContact: toDay(repLast),
        outside: acc.best
          ? {
              date: toDay(acc.best.ts) as string,
              who: acc.best.who,
              action: acc.best.action,
            }
          : null,
      };
    };

    const bdrAttr = attribute(repOwnerByDeal.get(dealId));
    const aeAttr = attribute(aeOwnerByDeal.get(dealId));

    out.set(dealId, {
      lastInbound: toDay(lastInbound),
      lastBdrOutbound: toDay(lastBdrOutbound),
      repLastContact: bdrAttr.repLastContact,
      outside: bdrAttr.outside,
      aeLastContact: aeAttr.repLastContact,
      aeOutside: aeAttr.outside,
    });
  }
  return out;
}
