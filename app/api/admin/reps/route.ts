// ============================================================================
// SERVER ROUTE: /api/admin/reps  (app/api/admin/reps/route.ts)
// ----------------------------------------------------------------------------
// The dropdown list for the admin "view as" switcher (app/components/
// AdminImpersonate.tsx). Admin-only: everyone else gets 403, even a signed-in,
// allowlisted user — this list exists purely to feed app/api/impersonate.
// ============================================================================

import { getCurrentUser } from "../../../lib/currentUser";
import { isAdmin } from "../../../lib/admins";
import { getRosterOwners } from "../../../lib/hubspotOwners";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!isAdmin(user?.email)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const owners = await getRosterOwners();
  return Response.json({
    reps: owners.map((o) => ({ id: o.id, name: o.name })),
  });
}
