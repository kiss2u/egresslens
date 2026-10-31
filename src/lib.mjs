// The page's pure logic: no DOM, no network. test/lib.test.mjs imports it as a module; scripts/build.mjs drops the
// `export` keywords and inlines it into the page bundle at the /* @lib */ marker in src/app.js.

/* ---------- addresses ---------- */
export const fam = x => x.includes(":") ? 6 : 4;
const V4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export const isIp = x => typeof x === "string" && (V4.test(x) || (/^[0-9a-f:]+$/i.test(x) && x.includes(":") && x.length <= 39));
const v6g = a => {
  const [h, tl = ""] = a.toLowerCase().split("::"), H = h ? h.split(":") : [], T = tl ? tl.split(":") : [];
  return [...H, ...Array(Math.max(0, 8 - H.length - T.length)).fill("0"), ...T].map(g => g.padStart(4, "0"));
};
// CGNAT pools and temporary IPv6 addresses move around inside a /16 or /64: same network
export const netOf = x => fam(x) === 6 ? v6g(x).slice(0, 4).join(":") : x.split(".").slice(0, 2).join(".");
export const sameNet = (a, b) => fam(a) === fam(b) && netOf(a) === netOf(b);
export const asnNum = v => { const m = /(\d+)/.exec(String(v ?? "")); return m ? +m[1] : null; };
// for "hide IPs": keep the network part, so two exits can still be told apart
export const maskIp = x => fam(x) === 6 ? v6g(x).slice(0, 2).map(g => g.replace(/^0+(?=.)/, "")).join(":") + ":…" : x.split(".").slice(0, 2).join(".") + ".•.•";

/* ---------- reading the probes' answers ---------- */
// Each reader gets the response body (JSON parsed when it parses) and returns { ip, geo?, cf? }
// geo = { cc, city, asn, org }; cf = { colo, loc, warp } from a Cloudflare trace
const geo = (cc, city, asn, org) => ({ cc: /^[A-Z]{2}$/.test(cc || "") ? cc : "", city: city || "", asn: asnNum(asn), org: String(org || "").replace(/^AS\d+\s*/, "") });
export const parseTrace = text => Object.fromEntries(String(text).split("\n").map(l => l.split("=")).filter(p => p.length >= 2).map(([k, ...v]) => [k.trim(), v.join("=").trim()]));
export const READERS = {
  text: b => ({ ip: String(b).trim().split(/\s+/)[0] }),
  trace: b => { const t = parseTrace(b); return { ip: t.ip, cf: { colo: t.colo || "", loc: t.loc || "", warp: t.warp || "off" } }; },
  ipip: b => ({ ip: b.data && b.data.ip }),
  iqiyi: b => ({ ip: (/(\d+\.\d+\.\d+\.\d+|[0-9a-f:]{3,})$/i.exec(String(b.t || "")) || [])[1] }),
  ipsb: b => ({ ip: b.ip, geo: geo(b.country_code, b.city, b.asn, b.isp || b.asn_organization) }),
  ipinfo: b => ({ ip: b.ip, geo: geo(b.country, b.city, b.org, b.org) }),
  ipapico: b => ({ ip: b.ip, geo: geo(b.country_code, b.city, b.asn, b.org) }),
  ipwho: b => ({ ip: b.ip, geo: b.success === false ? null : geo(b.country_code, b.city, b.connection && b.connection.asn, b.connection && (b.connection.isp || b.connection.org)) }),
  geojs: b => ({ ip: b.ip, geo: geo(b.country_code, b.city, b.asn, b.organization_name) }),
  ipleak: b => ({ ip: b.ip, geo: geo(b.country_code, b.city_name, b.as_number, b.isp_name) }),
  identme: b => ({ ip: b.ip, geo: geo(b.cc, b.city, b.asn, b.aso) }),
  ipguide: b => { const a = (b.network || {}).autonomous_system || {}; return { ip: b.ip, geo: a.asn ? geo("", (b.location || {}).city, a.asn, a.organization || a.name) : null }; },
  radar: b => ({ ip: b.ip_address, geo: geo(b.country, b.city, b.asn, "") }),
  ipify: b => ({ ip: b.ip }),
  bdc: b => ({ ip: b.ipString }),
};
// a reader's result, or null when the answer has no usable address (or the host has one IP version and it is not it)
export function readProbe(probe, body) {
  let r;
  try { r = READERS[probe.read](body); } catch (e) { return null; }
  if (!r || !isIp(r.ip)) return null;
  if (probe.fam && fam(r.ip) !== probe.fam) return null;
  if (r.geo && !r.geo.cc && !r.geo.asn) delete r.geo;
  return r;
}
// ICE candidate line → the server-reflexive address (what the STUN server saw), or null
export const srflxOf = line => { const p = String(line || "").split(" "); return / typ srflx /.test(line) && isIp(p[4]) ? p[4] : null; };

/* ---------- exits ---------- */
export const DC_RE = /amazon|google|microsoft|azure|digitalocean|vultr|choopa|constant company|linode|akamai|ovh|hetzner|oracle|alibaba|aliyun|tencent|huawei|m247|datacamp|cloudflare|leaseweb|contabo|hostinger|it7|racknerd|colocrossing|psychz|zenlayer|g-core|gcore|hostwinds|scaleway|ionos|kamatera|upcloud|bandwagon|dmit|cogent|quadranet|servers\.com|packet|equinix|fastly|cdn77|datapacket|tzulo|hostdare|greencloud|nexeon|frantech|buyvm|hosting|vps|data ?cent|mullvad|proton|nord|express ?vpn|surfshark|private internet|ucloud|kingsoft|baidu cloud|bytedance|volcano/i;
// geo for an address: its own, or that of an address on the same network
export function geoOf(geo, ip) {
  if (geo[ip]) return geo[ip];
  const y = Object.keys(geo).find(x => sameNet(x, ip));
  return y ? geo[y] : null;
}
// seen: [{ ip, probe }] (probe = its id); geo: ip → { cc, city, asn, org }; groupOf: probe id → group; warp: trace's warp.
// One exit per network (ASN when known), so an ISP's IPv4 and IPv6 addresses are one exit, labeled D or P.
// Order: local first (the network mainland-China sites and WebRTC tend to see), then by how many probes saw it.
export function groupExits(seen, geo, groupOf, warp) {
  const E = [];
  for (const { ip, probe } of seen) {
    const g0 = geoOf(geo, ip), key = g0 && g0.asn ? "as" + g0.asn : "net" + netOf(ip);
    let e = E.find(x => x.key === key);
    if (!e) { e = { key, ips: [], probes: [], cc: "", city: "", asn: null, org: "" }; E.push(e); }
    if (!e.ips.includes(ip)) e.ips.push(ip);
    if (!e.probes.includes(probe)) e.probes.push(probe);
    if (g0) { e.cc = e.cc || g0.cc || ""; e.city = e.city || g0.city || ""; e.asn = e.asn || g0.asn || null; e.org = e.org || g0.org || ""; }
  }
  for (const e of E) {
    e.dc = !!(e.org && DC_RE.test(e.org));
    e.warp = e.asn === 13335 && !!warp && warp !== "off";
    const gs = e.probes.map(p => groupOf[p]);
    e.score = (gs.includes("cn") ? 2 : 0) + (gs.includes("udp") ? 1 : 0);
  }
  E.sort((a, b) => (a.dc || a.warp) - (b.dc || b.warp) || b.score - a.score || b.probes.length - a.probes.length || (a.key < b.key ? -1 : 1));
  // Direct (D) or proxy (P): an exit on a datacenter network or WARP is a proxy, any other is the visitor's own line.
  // The label is D or P alone, numbered D1, D2… only when there is more than one of that kind.
  for (const e of E) {
    e.kind = e.dc || e.warp ? "proxy" : "local";
    for (const ip of e.ips) e.v6 = e.v6 || fam(ip) === 6, e.v4 = e.v4 || fam(ip) === 4;
  }
  for (const [kind, ch] of [["local", "D"], ["proxy", "P"]]) {
    const of = E.filter(e => e.kind === kind);
    of.forEach((e, i) => { e.letter = of.length > 1 ? ch + (i + 1) : ch; });
  }
  return E;
}
// probe id → the labels of the exits it saw
export function exitOfProbe(exits) {
  const m = {};
  for (const e of exits) for (const p of e.probes) (m[p] = m[p] || []).push(e.letter);
  return m;
}

/* ---------- findings ---------- */
// the exit most of a set of probes saw (null when none answered)
function majority(ids, of) {
  const n = {};
  for (const id of ids) if (of[id]) for (const l of of[id]) n[l] = (n[l] || 0) + 1;
  const best = Object.entries(n).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  return best ? best[0] : null;
}
// probes: the PROBES list; exits: groupExits(); ok: probe id → answered; tzCc: country of the browser's time zone.
// Returns [{ key, level, v }]: level "ok" | "info" | "warn"; v holds the values the sentence needs (letters, ids, codes).
export function findings(probes, exits, ok, tzCc) {
  const F = [], of = exitOfProbe(exits), byL = Object.fromEntries(exits.map(e => [e.letter, e]));
  const ids = g => probes.filter(p => p.g === g).map(p => p.id);
  if (!exits.length) return [{ key: "f_none", level: "warn", v: {} }];
  const cn = majority(ids("cn"), of), abroad = majority([...ids("intl"), ...ids("ai"), ...ids("web")], of);
  if (exits.length === 1) F.push({ key: "f_one", level: "ok", v: { a: exits[0].letter } });
  else if (cn && abroad && cn !== abroad) F.push({ key: "f_split", level: "info", v: { a: cn, b: abroad } });
  // destinations whose exit is not the usual one abroad (a per-service rule, or a second proxy)
  if (abroad) {
    const odd = {};
    for (const p of probes) if ((p.g === "ai" || p.g === "web") && of[p.id] && !of[p.id].includes(abroad)) (odd[of[p.id][0]] = odd[of[p.id][0]] || []).push(p.id);
    for (const [l, list] of Object.entries(odd)) F.push({ key: "f_dest", level: "info", v: { list, x: l, y: abroad } });
  }
  // WebRTC: UDP sees an exit that no website abroad sees, while websites abroad go through a proxy
  const udp = ids("udp").filter(id => of[id]), udpL = [...new Set(udp.flatMap(id => [...of[id]]))];
  const webL = new Set([...ids("intl"), ...ids("ai"), ...ids("web")].filter(id => of[id]).flatMap(id => [...of[id]]));
  const leaked = udpL.filter(l => !webL.has(l) && byL[l].kind === "local");
  if (!udp.length) F.push({ key: "f_rtc_none", level: "info", v: {} });
  else if (leaked.length && abroad && byL[abroad].kind !== "local") F.push({ key: "f_rtc_leak", level: "warn", v: { a: leaked[0] } });
  else if (abroad && udpL.every(l => l === abroad)) F.push({ key: "f_rtc_ok", level: "ok", v: { a: abroad } });
  // IPv6: the IPv6-only hosts see the local line while the rest of the world sees a proxy
  const v4 = majority(probes.filter(p => p.g === "stack" && p.fam === 4).map(p => p.id), of);
  const v6 = majority(probes.filter(p => p.g === "stack" && p.fam === 6).map(p => p.id), of);
  if (!exits.some(e => e.v6)) F.push({ key: "f_no_v6", level: "info", v: {} });
  else if (v6 && v4 && v6 !== v4 && byL[v6].kind === "local" && byL[v4].kind !== "local") F.push({ key: "f_v6_leak", level: "warn", v: { a: v6 } });
  // time zone: sites abroad can compare it with the exit's country
  const main = abroad && byL[abroad];
  if (tzCc && main && main.cc && main.cc !== tzCc && !(tzCc === "CN" && ["HK", "MO"].includes(main.cc))) F.push({ key: "f_tz", level: "info", v: { a: tzCc, b: main.cc } });
  if (exits.some(e => e.warp)) F.push({ key: "f_warp", level: "info", v: {} });
  const failed = probes.filter(p => ok[p.id] === false).map(p => p.id);
  if (failed.length) F.push({ key: "f_fail", level: "info", v: { list: failed } });
  return F;
}
