// Save/replace the Corgi partner (or admin) key in .env.local.
// Usage:
//   node scripts/set-partner-key.mjs cg_live_YOURKEY
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ENV_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
const key = process.argv[2];

if (!key || !key.startsWith("cg_")) {
  console.log("Give me the key. Usage:\n  node scripts/set-partner-key.mjs cg_live_YOURKEY");
  process.exit(1);
}

let existing = "";
try { existing = readFileSync(ENV_PATH, "utf8"); } catch {}
const cleaned = existing
  .split(/\n/)
  .filter((l) => !l.trim().startsWith("CORGI_PARTNER_TOKEN="))
  .join("\n")
  .replace(/\n+$/, "");
writeFileSync(ENV_PATH, `${cleaned}\nCORGI_PARTNER_TOKEN=${key}\n`);
console.log(`✓ Saved CORGI_PARTNER_TOKEN (prefix ${key.slice(0, 12)}…) to .env.local.`);
