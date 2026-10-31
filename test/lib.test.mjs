import { test } from "node:test";
import assert from "node:assert/strict";
import { readProbe, srflxOf, groupExits, exitOfProbe, findings, maskIp, parseTrace, sameNet } from "../src/lib.mjs";
import { PROBES, GROUPS } from "../src/probes.mjs";

const P = id => PROBES.find(p => p.id === id);
const GROUP_OF = Object.fromEntries(PROBES.map(p => [p.id, p.g]));

test("probes: unique ids, known groups and readers, https or stun", () => {
  const ids = new Set();
  for (const p of PROBES) {
    assert.ok(!ids.has(p.id), "duplicate " + p.id); ids.add(p.id);
    assert.ok(GROUPS.includes(p.g), p.id);
    assert.ok(p.read === "stun" ? p.url.startsWith("stun:") : p.url.startsWith("https://"), p.id);
    assert.ok(p.host && p.name, p.id);
  }
});

test("readers", () => {
  assert.deepEqual(readProbe(P("ipip"), { ret: "ok", data: { ip: "114.254.73.157", location: [] } }), { ip: "114.254.73.157" });
  assert.equal(readProbe(P("iqiyi"), { t: "CNC|BeiJing-114.254.73.157" }).ip, "114.254.73.157");
  assert.equal(readProbe(P("icanhazip"), "2406:da14::1\n").ip, "2406:da14::1");
  const tr = readProbe(P("chatgpt"), "fl=1\nh=chatgpt.com\nip=3.115.99.91\ncolo=NRT\nloc=JP\nwarp=off\n");
  assert.deepEqual(tr, { ip: "3.115.99.91", cf: { colo: "NRT", loc: "JP", warp: "off" } });
  assert.deepEqual(readProbe(P("ipinfo"), { ip: "3.115.99.91", city: "Tokyo", country: "JP", org: "AS16509 Amazon.com, Inc." }).geo,
    { cc: "JP", city: "Tokyo", asn: 16509, org: "Amazon.com, Inc." });
  assert.equal(readProbe(P("ipwho"), { ip: "1.2.3.4", success: true, country_code: "US", connection: { asn: 7922, isp: "Comcast" } }).geo.asn, 7922);
  // a single-version host answering with the other version, or garbage, is no answer
  assert.equal(readProbe(P("ipsb6"), { ip: "1.2.3.4" }), null);
  assert.equal(readProbe(P("icanhazip"), "<html>"), null);
  assert.equal(readProbe(P("ipip"), null), null);
});

test("STUN candidates", () => {
  assert.equal(srflxOf("candidate:1 1 udp 1677729535 114.254.73.157 51234 typ srflx raddr 0.0.0.0 rport 0 generation 0"), "114.254.73.157");
  assert.equal(srflxOf("candidate:1 1 udp 2122260223 abc.local 51234 typ host"), null);
});

test("addresses", () => {
  assert.equal(maskIp("114.254.73.157"), "114.254.•.•");
  assert.equal(maskIp("2408:8207:265b:52d0::1"), "2408:8207:…");
  assert.ok(sameNet("2408:8207:265b:52d0::1", "2408:8207:265b:52d0:aaaa::2"));
  assert.equal(parseTrace("a=1\nb=x=y\n").b, "x=y");
});

// A typical Chinese setup: mainland sites and WebRTC direct on China Unicom, everything abroad through AWS Tokyo,
// and the IPv6-only hosts bypassing the proxy.
const LOCAL4 = "114.254.73.157", LOCAL6 = "2408:8207:265b:52d0::1", PROXY4 = "3.115.99.91", PROXY6 = "2406:da14:3c2:6400::1";
const GEO = { [LOCAL4]: { cc: "CN", city: "Beijing", asn: 4808, org: "China Unicom" }, [PROXY4]: { cc: "JP", city: "Tokyo", asn: 16509, org: "Amazon.com" } };
function scenario() {
  const seen = [], ok = {};
  for (const p of PROBES) {
    const ip = p.g === "cn" ? (p.fam === 6 ? LOCAL6 : LOCAL4) : p.g === "udp" ? LOCAL4 : p.g === "stack" ? (p.fam === 6 ? LOCAL6 : PROXY4) : PROXY6;
    seen.push({ ip, probe: p.id }); ok[p.id] = true;
  }
  return { seen, ok };
}

test("exits: grouped by network, local first, labeled D/P", () => {
  const { seen } = scenario();
  const E = groupExits(seen, { ...GEO, [LOCAL6]: GEO[LOCAL4], [PROXY6]: GEO[PROXY4] }, GROUP_OF, "off");
  assert.equal(E.length, 2);
  assert.deepEqual(E.map(e => [e.letter, e.kind, e.asn]), [["D", "local", 4808], ["P", "proxy", 16509]]);
  assert.ok(E[0].v4 && E[0].v6 && E[1].v4 && E[1].v6);
  assert.deepEqual(exitOfProbe(E).chatgpt, ["P"]);
  // two proxies are numbered, a single local line is not
  const E2 = groupExits([...seen, { ip: "47.76.29.28", probe: "cloudflare" }], { ...GEO, [LOCAL6]: GEO[LOCAL4], [PROXY6]: GEO[PROXY4], "47.76.29.28": { cc: "HK", asn: 45102, org: "Alibaba (US) Technology" } }, GROUP_OF, "off");
  assert.deepEqual(E2.map(e => e.letter), ["D", "P1", "P2"]);
});

test("findings: split routing, WebRTC and IPv6 leaks, time zone", () => {
  const { seen, ok } = scenario();
  const E = groupExits(seen, { ...GEO, [LOCAL6]: GEO[LOCAL4], [PROXY6]: GEO[PROXY4] }, GROUP_OF, "off");
  const F = findings(PROBES, E, ok, "CN"), keys = F.map(f => f.key);
  assert.deepEqual(F.find(f => f.key === "f_split").v, { a: "D", b: "P" });
  assert.ok(keys.includes("f_rtc_leak"));
  assert.ok(keys.includes("f_v6_leak"));
  assert.deepEqual(F.find(f => f.key === "f_tz").v, { a: "CN", b: "JP" });
  assert.ok(!keys.includes("f_fail") && !keys.includes("f_one"));
});

test("findings: one exit, a service on its own route, failures", () => {
  const seen = PROBES.filter(p => p.g !== "udp").map(p => ({ ip: p.fam === 6 ? "2001:db8::1" : "1.2.3.4", probe: p.id }));
  const ok = Object.fromEntries(PROBES.map(p => [p.id, p.g !== "udp"]));
  const geo = { "1.2.3.4": { cc: "US", city: "Austin", asn: 7922, org: "Comcast" }, "2001:db8::1": { cc: "US", city: "Austin", asn: 7922, org: "Comcast" } };
  let F = findings(PROBES, groupExits(seen, geo, GROUP_OF, "off"), ok, "US");
  assert.deepEqual(F.map(f => f.key), ["f_one", "f_rtc_none", "f_fail"]);
  // ChatGPT and Claude through a US server, the rest local
  const seen2 = seen.map(s => ["chatgpt", "claude"].includes(s.probe) ? { ip: "5.6.7.8", probe: s.probe } : s);
  F = findings(PROBES, groupExits(seen2, { ...geo, "5.6.7.8": { cc: "US", city: "Ashburn", asn: 14618, org: "Amazon.com" } }, GROUP_OF, "off"), ok, "US");
  assert.deepEqual(F.find(f => f.key === "f_dest").v, { list: ["chatgpt", "claude"], x: "P", y: "D" });
});
