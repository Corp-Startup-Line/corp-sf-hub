// ============================================================================
// SERVER ROUTE: /api/roster  (app/api/roster/route.ts)
// ----------------------------------------------------------------------------
// Hands the browser the official team roster (from app/api/prospects/team.ts)
// so the dashboard can show EVERY teammate — even someone with 0 deals yet,
// like a rep you just added. This is just the list of names; no HubSpot key,
// no deal data. It's tiny and changes rarely, so it's cheap to fetch.
// ============================================================================

import { TEAM_BDR_NAMES, TEAM_AE_NAMES } from "../prospects/team";

export const dynamic = "force-static";

export async function GET() {
  return Response.json({
    bdrs: [...TEAM_BDR_NAMES],
    aes: [...TEAM_AE_NAMES],
  });
}
