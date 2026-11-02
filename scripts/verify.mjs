#!/usr/bin/env node
// Checks every HTTPS probe the way the page uses it: one GET with an Origin header, no redirect, a CORS header that
// lets the page read the answer, and an answer the probe's reader turns into an address of the right IP version.
// Probes that only have one IP version fail on a machine without it; run from a dual-stack network.
// Usage: node scripts/verify.mjs [origin]      (default https://egress.1ms.dog)
import { PROBES } from "../src/probes.mjs";
import { readProbe } from "../src/lib.mjs";

const origin = process.argv[2] || "https://egress.1ms.dog";
const rows = await Promise.all(PROBES.filter(p => p.read !== "stun" && !p.self).map(async p => {
  const t0 = Date.now();
  try {
    const r = await fetch(p.url, { headers: { Origin: origin, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" }, redirect: "manual", signal: AbortSignal.timeout(10000) });
    const text = await r.text(), acao = r.headers.get("access-control-allow-origin");
    let body = text;
    if (p.read !== "text" && p.read !== "trace") try { body = JSON.parse(text); } catch (e) { body = null; }
    const res = body == null ? null : readProbe(p, body);
    const problem = r.status !== 200 ? "HTTP " + r.status : acao !== "*" && acao !== origin ? "no CORS" : !res ? "unreadable" : "";
    return [p.id, problem, res ? res.ip : "", Date.now() - t0];
  } catch (e) { return [p.id, e.cause?.code || e.name, "", Date.now() - t0]; }
}));
for (const [id, problem, ip, ms] of rows) console.log(`${problem ? "✗" : "✓"} ${id.padEnd(12)} ${String(ms).padStart(5)} ms  ${problem || ip}`);
const bad = rows.filter(r => r[1]);
console.log(`\n${rows.length - bad.length}/${rows.length} ok` + (bad.length ? ` · failing: ${bad.map(r => r[0]).join(", ")}` : ""));
process.exitCode = bad.length ? 1 : 0;
