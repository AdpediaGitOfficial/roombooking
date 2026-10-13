// Usage: npm run loadtest:simulate   (env: BASES, RESIDENTS, OPS, DURATION, THINK_MIN, THINK_MAX)
// Needs tokens.json from `npm run loadtest:tokens`.
// Simulates N people using the system: each loops "open a page, read it, think", for a fixed time.
// A page view is the API calls the web server makes to render it (shell + the page's own data).
import { readFileSync } from "node:fs";
const BASES = (process.env.BASES ?? "http://127.0.0.1:4100").split(",");
const RESIDENTS = Number(process.env.RESIDENTS ?? 500), OPS = Number(process.env.OPS ?? 6);
const DURATION = Number(process.env.DURATION ?? 40) * 1000;
const THINK_MIN = Number(process.env.THINK_MIN ?? 2000), THINK_MAX = Number(process.env.THINK_MAX ?? 6000);
const tokens = JSON.parse(readFileSync(new URL("./tokens.json", import.meta.url)));
let rr = 0;
const base = () => BASES[rr++ % BASES.length];
const stats = new Map(); const errors = new Map();
let calls = 0;
async function call(label, token, path, init = {}) {
  const t = performance.now();
  let status = 0;
  try {
    const res = await fetch(base() + path, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
    status = res.status;
    await res.arrayBuffer();
  } catch { status = -1; }
  const ms = performance.now() - t;
  calls++;
  const s = stats.get(label) ?? []; s.push(ms); stats.set(label, s);
  if (status < 200 || status >= 300) errors.set(`${label} ${status}`, (errors.get(`${label} ${status}`) ?? 0) + 1);
  return status;
}
const pages = {
  resident: [
    [45, "home", (t) => Promise.all([call("shell", t, "/v1/me/shell"), call("home", t, "/v1/me/home")])],
    [20, "stay", (t) => Promise.all([call("shell", t, "/v1/me/shell"), call("stay", t, "/v1/me/stay"), call("heldKeys", t, "/v1/me/keys"), call("heldItems", t, "/v1/me/items")])],
    [15, "my tickets", (t) => Promise.all([call("shell", t, "/v1/me/shell"), call("mine", t, "/v1/maintenance/mine")])],
    [10, "facilities", (t) => Promise.all([call("shell", t, "/v1/me/shell"), call("facilities.mine", t, "/v1/facilities/mine")])],
    [5, "announcements", (t) => Promise.all([call("shell", t, "/v1/me/shell"), call("announcements", t, "/v1/me/announcements")])],
    [3, "report a problem", async (t) => { await Promise.all([call("shell", t, "/v1/me/shell"), call("myRooms", t, "/v1/maintenance/my-rooms")]); await call("ticket.create", t, "/v1/maintenance/orders", { method: "POST", body: JSON.stringify({ category: "Plumbing", description: "Load test: tap dripping in the kitchen", locationNote: "Kitchen" }) }); }],
    [2, "requests", (t) => Promise.all([call("shell", t, "/v1/me/shell"), call("requests.mine", t, "/v1/requests/mine")])],
  ],
  ops: [
    [25, "dashboard", (t) => Promise.all([call("shell", t, "/v1/me/shell"), call("dashboard", t, "/v1/reports/dashboard")])],
    [20, "allocations", (t) => Promise.all([call("shell", t, "/v1/me/shell"), call("allocations.list", t, "/v1/allocations?filter=active")])],
    [20, "maintenance queue", (t) => Promise.all([call("shell", t, "/v1/me/shell"), call("queue", t, "/v1/maintenance/queue?filter=open")])],
    [10, "accommodation", (t) => Promise.all([call("shell", t, "/v1/me/shell"), call("accommodation", t, "/v1/accommodation/sites")])],
    [10, "keys", (t) => Promise.all([call("shell", t, "/v1/me/shell"), call("keys", t, "/v1/keys")])],
    [10, "approvals", (t) => Promise.all([call("shell", t, "/v1/me/shell"), call("approvals", t, "/v1/approvals")])],
    [5, "search", (t) => Promise.all([call("shell", t, "/v1/me/shell"), call("search", t, "/v1/search?q=load")])],
  ],
};
const pick = (list) => { let r = Math.random() * list.reduce((s, x) => s + x[0], 0); for (const x of list) { if ((r -= x[0]) <= 0) return x; } return list[0]; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let views = 0;
async function person(kind, token, until) {
  await sleep(Math.random() * THINK_MAX); // spread the start
  while (performance.now() < until) {
    const [, , run] = pick(pages[kind]);
    await run(token); views++;
    await sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));
  }
}
const start = performance.now(); const until = start + DURATION;
const people = [];
for (let i = 0; i < RESIDENTS; i++) people.push(person("resident", tokens.residents[i % tokens.residents.length], until));
for (let i = 0; i < OPS; i++) people.push(person("ops", tokens.ops.find((o) => o.email === "admin@example.com").token, until));
await Promise.all(people);
const secs = (performance.now() - start) / 1000;
const q = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const rows = [...stats.entries()].map(([k, a]) => ({ call: k, n: a.length, p50: Math.round(q(a, 0.5)), p95: Math.round(q(a, 0.95)), p99: Math.round(q(a, 0.99)), max: Math.round(Math.max(...a)) })).sort((a, b) => b.n - a.n);
console.table(rows);
console.log(JSON.stringify({ people: RESIDENTS + OPS, bases: BASES.length, seconds: Math.round(secs), pageViews: views, viewsPerSec: +(views / secs).toFixed(1), apiCalls: calls, apiCallsPerSec: +(calls / secs).toFixed(1), errors: Object.fromEntries(errors) }));
