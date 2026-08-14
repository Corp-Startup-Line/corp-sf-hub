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
// The SF Revenue team (matches the SF BDR/AE dashboard roster). Parker Horton
// and Amos Book sit in BOTH lists on purpose: they source deals (BDR) AND close
// deals (AE), so their numbers show on both the BDR and the AE side.
export const TEAM_BDR_NAMES = [
  "Andrew Bagasbas",
  "Dino Citti",
  "Carwyn Chiramel",
  "Garrett Peterson",
  "Jackson Lau",
  "Broderick Cowan",
  "Ethan Wilensky",
  "Parker Horton",
  "Amos Book",
] as const;

// YOUR AEs — a deal's "owner" in HubSpot is the AE. Only these people are corp
// AEs; any other owner (including BDRs who happen to own a deal) is shown as
// "Unassigned" on the AE side so they don't clutter the AE cards.
// NOTE: Dino Citti and Jackson Lau are BDRs only — they occasionally close their
// own demos as the deal owner but are NOT corp AEs, so they are deliberately kept
// off this list. Their owned wins are credited to their BDR card (see BDR_NOT_AE
// in route.ts), not shown on the AE side.
export const TEAM_AE_NAMES = [
  "Amos Book",
  "Kaya Roberts",
  "Parker Horton",
] as const;

// Fast lookups used by the server route (built from the lists above — don't edit).
export const TEAM_BDRS = new Set<string>(TEAM_BDR_NAMES);
export const TEAM_AES = new Set<string>(TEAM_AE_NAMES);
