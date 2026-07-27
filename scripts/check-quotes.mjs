// Test what the current CORGI_PARTNER_TOKEN can read.
// Usage:  node scripts/check-quotes.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ENV_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
const env = readFileSync(ENV_PATH, "utf8");
const m = env.match(/^CORGI_PARTNER_TOKEN=(.+)$/m);
const key = m ? m[1].trim() : null;
if (!key) { console.log("No CORGI_PARTNER_TOKEN in .env.local yet."); process.exit(1); }

const base = "https://api.corgi.insure/api/external/v1";
(async () => {
  for (const path of ["/quotes", "/policies"]) {
    const r = await fetch(`${base}${path}?limit=3`, { headers: { Authorization: `Bearer ${key}` } });
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { j = null; }
    const d = (j && j.data) || {};
    if (r.status !== 200) {
      console.log(`${path} → HTTP ${r.status}  ${text.slice(0, 120)}`);
    } else {
      console.log(`${path} → HTTP 200  total: ${d.total}  (showing ${(d.results || []).length})`);
      if ((d.results || []).length) console.log("   sample:", JSON.stringify(d.results[0]).slice(0, 300));
    }
  }
})();
