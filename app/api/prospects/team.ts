// ============================================================================
// THE TEAM ROSTER  —  the ONE place to add or remove a teammate
// ----------------------------------------------------------------------------
// This is the single list of everyone on your team. Edit it here and nowhere
// else; the rest of the dashboard reads from this file.
//
//   • TO ADD a rep:    add their exact HubSpot name on a new line, with quotes
//                      and a comma, e.g.   "Jane Doe",
//   • TO REMOVE a rep: delete their line.
//
// IMPORTANT: the name must match the person's HubSpot name EXACTLY (spelling,
// spacing, capitals). If it doesn't match, none of their deals will be found.
//
// After editing, the change goes live once the site redeploys (a push to the
// repo) and the data refreshes. A newly-added rep shows on the dashboard right
// away — even with 0 deals — so you can confirm they're wired up correctly.
// ============================================================================

// YOUR BDRs — only deals whose HubSpot "BDR" field is one of these people show
// on the dashboard. Everyone else's / company-wide deals are ignored.
export const TEAM_BDR_NAMES = [
  "Jed Clark",
  "Oz Harkavi",
  "Ben Boneham",
  "Daryl Wilson",
  "Gabriel Serrano",
  "Carwyn Chiramel",
  "Luke Jopling",
  "Dino Citti",
  "Andrew Bagasbas",
  "Parker Horton",
  "Amos Book",
  "Pristina Adhikari",
  "Lewis Mitchell",
  "Fernando Cabrera",
  "Alex Estes",
] as const;

// YOUR AEs — a deal's "owner" in HubSpot is the AE. Only these people are corp
// AEs; any other owner (including BDRs who happen to own a deal) is shown as
// "Unassigned" on the AE side so they don't clutter the AE cards.
export const TEAM_AE_NAMES = [
  "Matthew Elmer", // "Matt" in HubSpot is registered as Matthew Elmer
  "Alex Frankel",
  "Drew Gordillo",
  "Tor Gordon",
  "Gavin Winchell",
  "Garrett Martel", // HubSpot spelling (garrett@corgi.insure)
  "Samuel Noyce", // "Sam" in HubSpot is registered as Samuel Noyce
] as const;

// Fast lookups used by the server route (built from the lists above — don't edit).
export const TEAM_BDRS = new Set<string>(TEAM_BDR_NAMES);
export const TEAM_AES = new Set<string>(TEAM_AE_NAMES);
