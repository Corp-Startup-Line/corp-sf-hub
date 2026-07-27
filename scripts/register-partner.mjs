// ============================================================================
// ONE-TIME: register this dashboard as a Corgi partner.
// ----------------------------------------------------------------------------
// WHAT THIS DOES, in plain terms:
//   1. Takes the one-time invite code you generated in the Corgi admin.
//   2. "Redeems" it — i.e. tells Corgi "this dashboard is a partner now".
//   3. Corgi replies with a permanent partner key (the thing we actually need).
//   4. This script saves that key into .env.local for you (never printed to git).
//
// HOW TO RUN (from the fugazi-dashboard folder):
//   node scripts/register-partner.mjs
//   ...or override the email:
//   node scripts/register-partner.mjs you@youremail.com
//
// The invite code is ONE-TIME. If this fails, generate a fresh code and rerun.
// ============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(HERE, "..", ".env.local");

// ---- The details we register the dashboard under. Edit if you like. --------
// Pass the fresh invite code as the first argument:
//   node scripts/register-partner.mjs <INVITE_CODE> [email]
const INVITE_TOKEN = process.argv[2];
if (!INVITE_TOKEN) {
  console.log("Missing invite code. Run:\n  node scripts/register-partner.mjs <INVITE_CODE> [email]");
  process.exit(1);
}
const DETAILS = {
  first_name: "Carwyn",
  last_name: "Chiramel",
  org_name: "Corgi Pipeline Dashboard",
  email: process.argv[3] || "Carwyn0208@gmail.com",
};

const URL = `https://api.corgi.insure/api/external/v1/invites/${INVITE_TOKEN}/redeem`;

// Fields the response might use for the permanent key — we grab whichever exists.
const KEY_FIELDS = ["token", "api_key", "apiKey", "key", "secret", "access_token", "credential"];

function findKey(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 4) return null;
  for (const f of KEY_FIELDS) {
    if (typeof obj[f] === "string" && obj[f].length > 8) return obj[f];
  }
  for (const v of Object.values(obj)) {
    const found = findKey(v, depth + 1);
    if (found) return found;
  }
  return null;
}

(async () => {
  console.log(`Registering "${DETAILS.org_name}" <${DETAILS.email}> as a Corgi partner...`);
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(DETAILS),
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }

  console.log(`\nHTTP ${res.status} ${res.statusText}`);
  console.log("Response:\n" + text.slice(0, 1500));

  if (!res.ok) {
    console.log("\n✗ Redeem failed. If it says the invite is used/expired, generate a fresh code and rerun.");
    process.exit(1);
  }

  const key = json && findKey(json);
  if (key) {
    // Replace any existing CORGI_PARTNER_TOKEN line (e.g. an old, dead key)
    // with the fresh one, then save.
    let existing = "";
    try { existing = readFileSync(ENV_PATH, "utf8"); } catch {}
    const cleaned = existing
      .split(/\n/)
      .filter((l) => !l.trim().startsWith("CORGI_PARTNER_TOKEN="))
      .join("\n")
      .replace(/\n+$/, "");
    writeFileSync(ENV_PATH, `${cleaned}\nCORGI_PARTNER_TOKEN=${key}\n`);
    console.log("\n✓ Saved the new partner key to .env.local (old one replaced).");
  } else {
    console.log("\n! Registration succeeded but I couldn't spot a key in the response.");
    console.log("  Paste the response above back to me and I'll find the right field.");
  }
})();
