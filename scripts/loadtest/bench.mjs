// Per-endpoint throughput and latency with autocannon.
// Usage: BASE=http://127.0.0.1:4100 C=50 D=8 ONLY=dashboard,keys npm run loadtest:bench
import autocannon from "autocannon";
const BASE = process.env.BASE ?? "http://127.0.0.1:4100";
const C = Number(process.env.C ?? 50), D = Number(process.env.D ?? 8);
const login = async (email) => (await (await fetch(`${BASE}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "ChangeMe123!" }) })).json()).token;
const admin = await login("admin@example.com");
const resident = await login("load7@example.com");
const officer = await login("officer@example.com");
const only = process.env.ONLY?.split(",");
const targets = [
  ["me (auth only)", resident, "/v1/auth/me"],
  ["shell (resident)", resident, "/v1/me/shell"],
  ["home (resident)", resident, "/v1/me/home"],
  ["shell (admin)", admin, "/v1/me/shell"],
  ["accommodation overview", officer, "/v1/accommodation/sites"],
  ["allocations list", officer, "/v1/allocations?filter=active"],
  ["dashboard", admin, "/v1/reports/dashboard"],
  ["maintenance queue", officer, "/v1/maintenance/queue?filter=open"],
  ["my tickets", resident, "/v1/maintenance/mine"],
  ["keys register", officer, "/v1/keys?filter=all"],
  ["staff picker", officer, "/v1/lookups/staff"],
  ["audit log", admin, "/v1/admin/audit"],
  ["users list", admin, "/v1/admin/users"],
  ["reports overview", admin, "/v1/reports/overview"],
];
const rows = [];
for (const [name, token, path] of targets) {
  if (only && !only.some((o) => name.includes(o))) continue;
  const r = await autocannon({ url: BASE + path, connections: C, duration: D, headers: { authorization: `Bearer ${token}` } });
  const bad = r.non2xx + r.errors + r.timeouts;
  rows.push({ endpoint: name, rps: Math.round(r.requests.average), p50: r.latency.p50, p97_5: r.latency.p97_5, p99: r.latency.p99, max: r.latency.max, bad, kb: Math.round(r.throughput.average / 1024) });
  console.log(JSON.stringify(rows.at(-1)));
}
console.table(rows);
