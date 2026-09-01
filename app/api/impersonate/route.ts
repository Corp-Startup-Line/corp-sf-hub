// ============================================================================
// SERVER ROUTE: /api/impersonate  (app/api/impersonate/route.ts)
// ----------------------------------------------------------------------------
// Lets an admin (app/lib/admins.ts) "view as" any rep on the roster — sets a
// cookie recording which owner to impersonate. /api/me reads this cookie and
// substitutes the impersonated owner's id/name in its response, so any page
// built on /api/me's ownerId (a future "your own dials" or Career Progression
// page) shows that rep's data instead of the admin's own.
//
// SECURITY: the cookie only ever gets read back by /api/me for a user who is
// STILL an admin at read time (re-checked there, not trusted from the cookie
// itself), and the owner id is re-verified against a real HubSpot owner here
// before being stored — never a client-supplied name.
// ============================================================================

import { cookies } from "next/headers";
import { getCurrentUser } from "../../lib/currentUser";
import { isAdmin } from "../../lib/admins";
import { getOwnerById } from "../../lib/hubspotOwners";

export const IMPERSONATE_COOKIE = "corgi_impersonate_owner_id";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!isAdmin(user?.email)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const ownerId = typeof body?.ownerId === "string" ? body.ownerId : null;
  if (!ownerId) {
    return Response.json({ error: "Missing ownerId" }, { status: 400 });
  }

  const owner = await getOwnerById(ownerId);
  if (!owner) {
    return Response.json({ error: "Unknown owner" }, { status: 404 });
  }

  const jar = await cookies();
  jar.set({
    name: IMPERSONATE_COOKIE,
    value: owner.id,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12h — a admin's "view as" shouldn't quietly outlive their session
  });

  return Response.json({ ok: true, ownerId: owner.id, ownerName: owner.name });
}

// Stop impersonating — back to viewing as yourself.
export async function DELETE() {
  const user = await getCurrentUser();
  if (!isAdmin(user?.email)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const jar = await cookies();
  jar.set({ name: IMPERSONATE_COOKIE, value: "", path: "/", maxAge: 0 });
  return Response.json({ ok: true });
}
