// ============================================================================
// SERVER ROUTE: /api/me  (app/api/me/route.ts)
// ----------------------------------------------------------------------------
// "Who's signed in, and which HubSpot rep are they?" — the piece a client
// component needs to build a personalized view (your own dials, your own
// Career Progression, etc.) instead of the team-wide one. Three lookups:
//   1. app/lib/currentUser.ts — the Google (Supabase) session's email/name.
//      null for a logged-out visitor OR the legacy shared-password login,
//      which carries no identity.
//   2. app/lib/hubspotOwners.ts — that email matched against every HubSpot
//      owner, so pages can filter by ownerId the same way the dashboards
//      already do internally.
//   3. app/lib/admins.ts + the impersonation cookie (see app/api/impersonate)
//      — an admin "viewing as" a rep gets THAT rep's ownerId/ownerName here
//      instead of their own, so every page built on this endpoint picks it up
//      automatically. Re-checked here on every call, never trusted from the
//      cookie alone: only honored if the signed-in email is STILL an admin.
// `ownerId`/`ownerName` are null when neither the real signed-in email nor an
// active impersonation resolves to a HubSpot owner.
// ============================================================================

import { cookies } from "next/headers";
import { getCurrentUser } from "../../lib/currentUser";
import { getOwnerByEmail, getOwnerById } from "../../lib/hubspotOwners";
import { isAdmin } from "../../lib/admins";
import { IMPERSONATE_COOKIE } from "../impersonate/route";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ authenticated: false });
  }

  const admin = isAdmin(user.email);
  let owner = await getOwnerByEmail(user.email);
  let impersonating = false;

  if (admin) {
    const impersonateId = (await cookies()).get(IMPERSONATE_COOKIE)?.value;
    if (impersonateId) {
      const impersonated = await getOwnerById(impersonateId);
      if (impersonated) {
        owner = impersonated;
        impersonating = true;
      }
    }
  }

  return Response.json({
    authenticated: true,
    email: user.email,
    name: user.name,
    isAdmin: admin,
    impersonating,
    ownerId: owner?.id ?? null,
    ownerName: owner?.name ?? null,
  });
}
