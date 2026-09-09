// Verify selective grounding round-trip:
// - source + node_source rows persist
// - grounded verification survives import
// - sensitive-unverified count surfaces on dashboard
// - no placeholder/fake URLs are accepted in fixture checks
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "../lib/db";
import { ensureDefaultSettings } from "../lib/settings";
import { importMap } from "../lib/import";
import type { ContractMap } from "../lib/import/contract";
import { getDashboard } from "../lib/dashboard";
import { getNodeDetail } from "../lib/graph";

const TEST_DB = path.join(process.cwd(), "data", "_verify-m7.db");
const cleanup = () => {
  for (const s of ["", "-shm", "-wal"]) if (existsSync(TEST_DB + s)) rmSync(TEST_DB + s);
};

cleanup();
const db = new Database(TEST_DB);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
applySchema(db);
ensureDefaultSettings(db);

const map = JSON.parse(
  readFileSync(path.join(process.cwd(), "data", "seed-topic.json"), "utf8")
) as ContractMap;

for (const n of map.nodes) {
  if (n.ref === "n_router") {
    n.grounding_sensitive = true;
    n.verification = "grounded";
    n.source_refs = ["s_router_docs"];
  }
  if (n.ref === "n_validation") {
    n.grounding_sensitive = true;
    n.verification = "unverified";
  }
}
map.sources = [
  {
    ref: "s_router_docs",
    url: "https://www.django-rest-framework.org/api-guide/routers/",
    title: "DRF Routers",
    publisher: "django-rest-framework.org",
    retrieved_at: "2026-07-31T00:00:00Z",
    quote: "Routers provide an easy way of automatically determining URL conf.",
  },
];
map.node_sources = [
  {
    node_ref: "n_router",
    source_ref: "s_router_docs",
    support: "supports",
  },
];

const result = importMap(map, db);
const checks: [string, boolean][] = [];

const sourceCount = (
  db.prepare("SELECT COUNT(*) c FROM sources").get() as { c: number }
).c;
const linkCount = (
  db.prepare("SELECT COUNT(*) c FROM node_sources").get() as { c: number }
).c;
const groundedRouter = (
  db.prepare("SELECT verification FROM nodes WHERE name = ?")
    .pluck()
    .get("Router (DRF)") as string | undefined
) === "grounded";
const fakeUrlCount = (
  db
    .prepare(
      "SELECT COUNT(*) c FROM sources WHERE url LIKE '%example.com%' OR url LIKE 'https://example.%'"
    )
    .get() as { c: number }
).c;

const routerId = (
  db.prepare("SELECT id FROM nodes WHERE name = ?").get("Router (DRF)") as
    | { id: number }
    | undefined
)?.id;
const detail = routerId ? getNodeDetail(routerId, db) : null;
const dashboard = getDashboard(db);

checks.push(["M7: importer persists sources", sourceCount >= 1]);
checks.push(["M7: importer persists node-source links", linkCount >= 1]);
checks.push(["M7: importer keeps grounded verification", groundedRouter]);
checks.push(["M7: fixture has no fake placeholder URLs", fakeUrlCount === 0]);
checks.push([
  "M7: node detail exposes source links",
  !!detail && detail.sources.some((s) => s.url.includes("django-rest-framework.org")),
]);
checks.push([
  "M7: dashboard surfaces sensitive unverified count",
  dashboard.grounding.sensitiveUnverified >= 1,
]);
checks.push([
  "M7: import result reports source counts",
  result.counts.sources >= 1 && result.counts.nodeSources >= 1,
]);

let ok = true;
console.log("\n--- checks ---");
for (const [name, pass] of checks) {
  console.log(pass ? "PASS" : "FAIL", name);
  if (!pass) ok = false;
}

db.close();
cleanup();
console.log("\nTemp verify DB cleaned up.");
process.exit(ok ? 0 : 1);
