// Egress: asks probes at many kinds of destinations which address they see, then groups the answers into exits and
// says what they mean (split routing, WebRTC and IPv6 leaks). Everything runs in the browser; nothing is sent to this
// site. The build prepends `const PROBES, GROUPS` (src/probes.mjs) and inlines src/lib.mjs at the @lib marker below.
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const D = JSON.parse($("#data").textContent);
  const L = window.LEGRESS || {}, LANG = D.lang;              // strings: /assets/l.<lang>.<hash>.js, loaded first
  const t = (k, v) => { let s = L[k] ?? k; if (v) for (const x in v) s = s.split("{" + x + "}").join(v[x]); return s; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const K = { theme: "egress:theme", lang: "egress:lang", mask: "egress:mask" };
  const country = cc => { try { return new Intl.DisplayNames([LANG], { type: "region" }).of(cc); } catch (e) { return cc; } };
  const flag = cc => /^[A-Z]{2}$/.test(cc || "") ? `<img class="flag" src="/flags/${cc.toLowerCase()}.svg" alt="" width="20" height="15">` : "";
  const list = a => a.join(t("join"));
  /* @lib */
  const bust = u => u + (u.includes("?") ? "&" : "?") + "_eg=" + Math.random().toString(36).slice(2, 10);

  /* ---------- theme and language ---------- */
  const thBtn = $("#theme"), TH = ["system", "light", "dark"];
  const applyTheme = th => {
    if (th === "light" || th === "dark") document.documentElement.setAttribute("data-theme", th); else document.documentElement.removeAttribute("data-theme");
    thBtn.dataset.th = th; thBtn.title = t("th_" + th); thBtn.setAttribute("aria-label", t("th_" + th));
  };
  applyTheme(TH.includes(store.get(K.theme)) ? store.get(K.theme) : "system");
  thBtn.onclick = () => { const n = TH[(TH.indexOf(thBtn.dataset.th) + 1) % 3]; store.set(K.theme, n); applyTheme(n); };
  // a shared result keeps its link (and its preview page) in the other language
  $("#lang").onchange = e => { const l = e.target.value; store.set(K.lang, l); location.href = (S.shared ? D.paths : D.home)[l] + location.hash; };

  /* ---------- probes ---------- */
  const TZ_CC = Object.fromEntries(("Asia/Shanghai:CN Asia/Chongqing:CN Asia/Harbin:CN Asia/Urumqi:CN Asia/Hong_Kong:HK Asia/Macau:MO Asia/Taipei:TW Asia/Tokyo:JP " +
    "Asia/Seoul:KR Asia/Singapore:SG Asia/Kuala_Lumpur:MY Asia/Bangkok:TH Asia/Jakarta:ID Asia/Manila:PH Asia/Ho_Chi_Minh:VN Asia/Saigon:VN " +
    "Asia/Kolkata:IN Asia/Calcutta:IN Asia/Dubai:AE Asia/Riyadh:SA Asia/Qatar:QA Asia/Jerusalem:IL Asia/Tel_Aviv:IL Asia/Karachi:PK Asia/Tehran:IR " +
    "Europe/London:GB Europe/Dublin:IE Europe/Paris:FR Europe/Berlin:DE Europe/Amsterdam:NL Europe/Brussels:BE Europe/Zurich:CH Europe/Rome:IT " +
    "Europe/Madrid:ES Europe/Lisbon:PT Europe/Stockholm:SE Europe/Oslo:NO Europe/Helsinki:FI Europe/Copenhagen:DK Europe/Warsaw:PL Europe/Vienna:AT " +
    "Europe/Prague:CZ Europe/Moscow:RU Europe/Istanbul:TR Europe/Kiev:UA Europe/Kyiv:UA Europe/Athens:GR Europe/Bucharest:RO Europe/Budapest:HU " +
    "Australia/Sydney:AU Australia/Melbourne:AU Australia/Brisbane:AU Australia/Perth:AU Australia/Adelaide:AU Pacific/Auckland:NZ " +
    "America/New_York:US America/Chicago:US America/Denver:US America/Los_Angeles:US America/Phoenix:US America/Anchorage:US Pacific/Honolulu:US " +
    "America/Toronto:CA America/Vancouver:CA America/Montreal:CA America/Edmonton:CA America/Mexico_City:MX America/Sao_Paulo:BR America/Santiago:CL " +
    "America/Bogota:CO America/Lima:PE America/Argentina/Buenos_Aires:AR Africa/Johannesburg:ZA Africa/Cairo:EG Africa/Lagos:NG Africa/Nairobi:KE")
    .split(" ").map(p => p.split(":")));
  const tzCc = () => { try { return TZ_CC[Intl.DateTimeFormat().resolvedOptions().timeZone] || ""; } catch (e) { return ""; } };
  const GROUP_OF = Object.fromEntries(PROBES.map(p => [p.id, p.g]));
  const NAME_OF = id => { const p = PROBES.find(x => x.id === id); return p.g === "stack" ? p.name + " IPv" + p.fam : p.g === "udp" ? "STUN " + p.name : p.name; };

  // A probe that gives no address says why, as { why, n }: "timeout", "http" (n = status), "net" (no connection:
  // blocked by the network, the proxy or an ad blocker), "parse" (an answer without a usable address), "stun".
  const fail = (why, n) => Object.assign(new Error(why), { why, n });
  async function httpProbe(p) {
    let r;
    try { r = await fetch(bust(p.url), { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(7000) }); }
    catch (e) { throw fail(e && e.name === "TimeoutError" ? "timeout" : "net"); }
    if (!r.ok) throw fail("http", r.status);
    let res = null;
    try { const text = await r.text(); res = readProbe(p, p.read === "text" || p.read === "trace" ? text : JSON.parse(text)); } catch (e) {}
    if (!res) throw fail("parse");
    return [res];
  }
  // one peer connection per STUN server, so each server's answer is its own
  async function stunProbe(p) {
    if (!window.RTCPeerConnection) return [];
    let pc;
    try {
      pc = new RTCPeerConnection({ iceServers: [{ urls: p.url }] });
      pc.createDataChannel("x");
      const ips = new Set();
      const done = new Promise(res => {
        pc.onicecandidate = e => { if (!e.candidate) return res(); const ip = srflxOf(e.candidate.candidate); if (ip) ips.add(ip); };
        setTimeout(res, 4000);
      });
      await pc.setLocalDescription(await pc.createOffer());
      await done;
      return [...ips].map(ip => ({ ip }));
    } finally { try { pc && pc.close(); } catch (e) {} }
  }

  /* ---------- state and rendering ---------- */
  // shared: a result from a link being shown (no addresses; nothing is tested until the visitor asks)
  const S = { res: {}, ok: {}, ms: {}, why: {}, geo: {}, warp: "off", exits: [], finds: [], odd: {}, done: false, gen: 0, shared: null };
  const masked = () => store.get(K.mask) === "1";
  const ipTxt = ip => masked() ? maskIp(ip) : ip;
  const eye = $("#eye");
  function applyMask() {
    eye.textContent = t(masked() ? "show" : "hide"); eye.setAttribute("aria-pressed", masked());
    for (const p of PROBES) if (S.res[p.id]) renderRow(p);
    if (S.done) renderExits();
    renderFocus();
  }
  eye.onclick = () => { store.set(K.mask, masked() ? "0" : "1"); applyMask(); };

  // A row keeps its size from the start: only its text changes. Before a result, a row is reset to waiting.
  function renderRow(p) {
    const row = $("#p-" + p.id); if (!row) return;
    const res = S.res[p.id], ip = row.querySelector(".pip"), ms = row.querySelector(".pms"), co = row.querySelector(".pco");
    row.classList.toggle("fail", S.ok[p.id] === false); row.classList.toggle("wait", S.gen > 0 && S.ok[p.id] == null);
    // a row that stands out (no answer, another exit than its kind, a WebRTC leak) is tinted and says why on hover
    const o = S.done && S.odd[p.id], w = S.why[p.id];
    row.classList.toggle("odd", !!o && o.k === "odd"); row.classList.toggle("leak", !!o && o.k === "leak");
    const why = S.ok[p.id] === false && w ? t("why_" + w.why, { n: w.n }) : o ? t("why_" + o.k, { x: exTxt(o.x), y: exTxt(o.y) }) : "";
    if (why) { row.dataset.why = why; row.tabIndex = 0; } else { delete row.dataset.why; row.removeAttribute("tabindex"); }
    ms.textContent = ""; co.textContent = ""; ip.title = "";
    if (S.ok[p.id] == null) { ip.textContent = S.gen ? t("wait") : "–"; return; }
    if (S.ok[p.id] === false) { ip.textContent = t("fail"); return; }
    ip.textContent = S.shared ? "•••" : res.map(r => ipTxt(r.ip)).join(" · ");
    if (!masked()) ip.title = ip.textContent;
    if (S.ms[p.id] != null) ms.textContent = Math.round(S.ms[p.id]) + " ms";
    const cf = res[0] && res[0].cf;
    if (cf && cf.colo) co.textContent = cf.colo;
  }
  const kindOf = l => (S.exits.find(e => e.letter === l) || {}).kind || "proxy";
  // each numbered exit has its own shade: D1/D2 greens, P1…P4 orange, violet, pink, red
  const chip = (l, big) => `<i class="lt k-${kindOf(l)} n${(/\d+$/.exec(l) || [1])[0]}${big ? " big" : ""}">${esc(l)}</i>`;
  function renderChips() {
    const of = exitOfProbe(S.exits);
    for (const p of PROBES) {
      const c = document.querySelector("#p-" + p.id + " .pl");
      // the exit's label and its country's flag
      if (c) c.innerHTML = (of[p.id] || []).map(l => chip(l) + flag((S.exits.find(e => e.letter === l) || {}).cc)).join("");
    }
  }
  const whereOf = e => [e.city, e.cc && country(e.cc)].filter(Boolean).join(", ") || "?";
  // an exit in plain text (the tooltip): its label and country
  const exTxt = l => { const e = S.exits.find(x => x.letter === l); return e ? `${l} ${e.cc ? country(e.cc) : whereOf(e)}` : l || ""; };
  // in a sentence an exit is its chip and country: short, and the card above has the rest
  const exRef = l => { const e = S.exits.find(x => x.letter === l); return e ? `${chip(l)} ${esc(e.cc ? country(e.cc) : whereOf(e))}` : esc(l); };
  // While probes answer, the exits fill two slots drawn at the start (most visitors have a local line and a proxy);
  // an address shows once its network is known. The final sort, numbering and any extra exit come at the end.
  // a host can announce an IP quality check with <meta name="ipqs" content="https://…">: each address links to it
  // (not while addresses are hidden)
  const IPQS = (document.querySelector('meta[name="ipqs"]') || {}).content || "";
  // other 1ms.dog tools the host announces as <meta name="<tool>" content="https://…">; a link to one is shown only then.
  // Their pages share this page's language folders.
  const meta = n => (document.querySelector(`meta[name="${n}"]`) || {}).content || "";
  const ASN = meta("asn"), IPV6 = meta("ipv6");
  const toolHref = (base, at) => base + D.home[LANG] + at;
  // an AS number links to its page on ASN Lookup
  // a link to another 1ms.dog tool ends in the external-link icon (the shared tool contract: no arrows); a value that is
  // itself the link (an address, an AS number) has no icon: a dotted underline, and a title saying where it goes
  const EXT = '<svg class="xi" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 10v3.5H2.5V4H6"/></svg>';
  const asRef = n => ASN ? `<a class="asl" href="${esc(toolHref(ASN, "AS" + n))}" title="${esc(t("asn_title"))}" target="_blank" rel="noopener">AS${n}</a>` : "AS" + n;
  const ipQ = ip => IPQS && !masked() ? `<a class="ipq" href="${esc(IPQS)}/?ip=${encodeURIComponent(ip)}" title="${esc(t("ipq_title"))}" target="_blank" rel="noopener">${esc(ip)}</a>` : esc(ipTxt(ip));
  const exCard = e => {
    // a shared result has no addresses: only which IP versions the exit has
    const ips = [4, 6].map(f => [f, e.ips.filter(ip => fam(ip) === f)]).map(([f, l]) => l.length ? `<span><em>IPv${f}</em>${l.map(ipQ).join(" · ")}</span>`
      : S.shared && e["v" + f] ? `<span><em>IPv${f}</em>•••</span>` : "").join("");
    return `<li class="ex">${chip(e.letter, true)}<div class="ex-b">` +
      `<div class="where">${flag(e.cc)}<b>${esc(whereOf(e))}</b>${e.org || e.asn ? `<span class="m">${esc(e.org)}${e.asn ? (e.org ? " · " : "") + asRef(e.asn) : ""}</span>` : ""}</div>` +
      `<div class="ips">${ips}</div></div></li>`;
  };
  const slot = () => `<li class="ex sk"><i class="lt big k-none">?</i><span class="blink">${esc(t("sniff"))}</span></li>`;
  function renderExits() {
    const ul = $("#exList"), E = S.exits;
    if (S.done && !E.length) { ul.innerHTML = `<li class="ex sk">${esc(t("no_net"))}</li>`; return; }
    ul.innerHTML = E.map(exCard).join("") + (S.done ? "" : slot().repeat(Math.max(0, 2 - E.length)));
  }
  // While running, each probe group's heading in the list counts its answers.
  function renderGroups() {
    for (const g of GROUPS) {
      const ids = PROBES.filter(p => p.g === g).map(p => p.id), d = ids.filter(id => S.ok[id] != null).length;
      const el = document.querySelector(`[data-g="${g}"] .pg-n`);
      if (el) el.textContent = S.gen ? `${d} / ${ids.length}` : "";
    }
  }
  // The check table: six rows drawn by the build, each a label and a value. While running a value is a skeleton bar;
  // when every probe is in, each row gets its status mark and its value.
  const ST = { ok: "✓", warn: "!", bad: "✕", info: "•", none: "–" };
  // a host can announce its privacy check with <meta name="who" content="https://…">
  const WHO = (document.querySelector('meta[name="who"]') || {}).content || "";
  // and its streaming & AI unlock check with <meta name="unlock" content="https://…">: it tests the visitor's own route, so not on a shared result
  const UNLOCK = (document.querySelector('meta[name="unlock"]') || {}).content || "";
  function renderChecks() {
    const isExit = x => S.exits.some(e => e.letter === x);
    for (const row of CHECKS) {
      const li = document.querySelector(`#finds [data-r="${row}"]`); if (!li) continue;
      const st = li.querySelector(".st"), val = li.querySelector(".fr-v");
      li.className = "fr";
      if (!S.done) { li.classList.add("wait"); st.textContent = ""; val.innerHTML = "<span class=\"bar\"></span>"; continue; }
      const f = S.finds[row], v = {};
      for (const [k, x] of Object.entries(f.v)) {
        if (k === "list") v[k] = esc(list(x.map(NAME_OF)));
        else if (k === "groups") v[k] = x.map(g => t("v_except_some", { list: esc(list(g.list.map(id => id === "@v6" ? t("v6_sites") : NAME_OF(id)))), x: exRef(g.x) })).join(" · ");
        else if (k === "x" && f.v.c) v[k] = `${chip(x)} ${esc(country(f.v.c))}`;
        else if (typeof x === "string") v[k] = isExit(x) ? exRef(x) : /^[A-Z]{2}$/.test(x) ? esc(country(x)) : esc(x);
      }
      li.classList.add("st-" + f.s); st.textContent = ST[f.s];
      li.classList.toggle("focus", row === D.focus);
      val.innerHTML = (f.s === "none" ? esc(t("v_none")) : f.k === "some" ? v.groups : t(`v_${row}_${f.k}`, v) + (f.v.dc ? esc(t("v_dc")) : "")) +
        // a WebRTC leak or split routing: the privacy check shows what else gives the visitor away
        (WHO && ((row === "rtc" && f.s === "bad") || (row === "route" && f.k === "split")) ? ` <a class="xl" href="${esc(WHO + D.home[LANG])}" target="_blank" rel="noopener">${esc(t("who_link"))}${EXT}</a>` : "") +
        // the AI region: the unlock check tries each AI service from this route
        (UNLOCK && row === "ai" && f.s !== "none" && !S.shared ? ` <a class="xl" href="${esc(toolHref(UNLOCK, "ai/"))}" target="_blank" rel="noopener">${esc(t("unlock_link"))}${EXT}</a>` : "");
    }
  }
  // A landing page's lead panel (WebRTC leak test, what ChatGPT and Claude see): one row per probe it is about,
  // filled as each answers, and the verdict on top once every probe is in.
  const foEl = $("#focus");
  // The IPv6 row links to the IPv6 test when there is no IPv6 exit, or IPv6 leaves by another exit than websites abroad
  function linkChecks() {
    if (!S.done || !IPV6) return;
    const f = S.finds.v6, r = S.finds.route, li = document.querySelector('#finds [data-r="v6"] .fr-v');
    if (!f || !li || li.querySelector(".v6l")) return;
    const abroad = r && r.s !== "none" ? (r.k === "split" ? r.v.b : r.v.a) : null;
    if (f.k === "none" || f.s === "bad" || (f.v.a && f.v.a !== abroad))
      li.insertAdjacentHTML("beforeend", ` <a class="xl v6l" href="${esc(toolHref(IPV6, ""))}" target="_blank" rel="noopener">${esc(t("ipv6_link"))}${EXT}</a>`);
  }
  // links the build leaves hidden: [data-m] names the tool's meta, [data-at] the path after the language folder
  for (const a of document.querySelectorAll("a[data-m]")) { const m = meta(a.dataset.m); if (m) { a.href = toolHref(m, a.dataset.at); a.hidden = false; } }
  function renderFocus() {
    linkChecks();
    if (!foEl) return;
    const of = exitOfProbe(S.exits), ex = l => S.exits.find(e => e.letter === l);
    const place = cc => cc ? flag(cc) + `<span>${esc(country(cc))}</span>` : "";
    for (const li of foEl.querySelectorAll(".fo-r")) {
      const id = li.dataset.p, x = li.querySelector(".fo-x"), m = li.querySelector(".fo-m");
      let bad = false;
      m.textContent = "";
      if (S.ok[id] == null) x.innerHTML = S.gen ? `<span class="m blink">…</span>` : `<span class="m">–</span>`;
      else if (!S.ok[id]) x.innerHTML = `<span class="m">${esc(t("fail"))}</span>`;
      else if (D.focus === "ai") {
        // the country the AI site itself sees (its Cloudflare trace), and the exit that took the request
        const cf = (S.res[id][0] || {}).cf || {};
        // the region list is OpenAI's and Anthropic's, so only their sites are marked
        bad = ["chatgpt", "openai", "sora", "claude", "anthropic"].includes(id) && AI_BLOCKED.includes(cf.loc);
        x.innerHTML = (of[id] || []).map(l => chip(l)).join("") + place(cf.loc);
        m.textContent = cf.colo || "";
      } else {
        bad = !!(S.done && S.odd[id] && S.odd[id].k === "leak");
        x.innerHTML = (of[id] || []).map(l => chip(l) + place(ex(l).cc)).join(" ");
        m.textContent = S.shared ? "•••" : S.res[id].map(r => ipTxt(r.ip)).join(" · ");
      }
      li.classList.toggle("bad", bad);
    }
    const head = foEl.querySelector(".fo-t"), st = foEl.querySelector(".st"), d = foEl.querySelector(".fo-d");
    foEl.className = "focus";
    if (!S.done) { head.textContent = t("sniff"); st.textContent = ""; d.innerHTML = "<span class=\"bar\"></span>"; foEl.classList.add("wait"); return; }
    const f = S.finds[D.focus] || { s: "none" };
    const k = f.s === "bad" ? "vh_ai" : f.s === "ok" ? "fh_ai_ok" : "fh_ai_none";
    head.textContent = t(k); st.textContent = ST[f.s]; foEl.classList.add("st-" + f.s);
    // the detail is the check table's own value for this check, without its links
    const v = document.querySelector(`#finds [data-r="${D.focus}"] .fr-v`).cloneNode(true);
    v.querySelectorAll(".xl").forEach(a => a.remove());
    d.innerHTML = f.s === "none" ? "" : v.innerHTML;
  }
  function setProg(d, n) { $("#prog").classList.toggle("end", S.done); $("#prog i").style.transform = `scaleX(${n ? d / n : 0})`; $("#progTxt").textContent = !S.gen ? "" : S.done ? t("done", { n }) : t("progress", { d, n }); }

  /* ---------- a run ---------- */
  const seenAll = () => PROBES.flatMap(p => (S.res[p.id] || []).map(r => ({ ip: r.ip, probe: p.id })));
  // live view: only addresses whose network is known, so an address never shows as an exit of its own and then merges
  let raf = 0;
  const live = () => { if (raf) return; raf = requestAnimationFrame(() => {
    raf = 0; if (S.done) return;
    S.exits = groupExits(seenAll().filter(s => geoOf(S.geo, s.ip)), S.geo, GROUP_OF, S.warp);
    renderExits(); renderChips(); renderFocus();
  }); };
  async function run() {
    leaveShared();
    const gen = ++S.gen;
    // clear everything the last run showed: exits, findings, and every probe row
    Object.assign(S, { res: {}, ok: {}, ms: {}, why: {}, geo: {}, warp: "off", exits: [], finds: {}, odd: {}, done: false });
    renderExits(); renderGroups(); renderChecks(); renderFocus();
    $("#run").disabled = true; $("#run").classList.add("busy"); $("#run span").textContent = t("running"); $("#share").disabled = true;
    for (const p of PROBES) { renderRow(p); const c = document.querySelector("#p-" + p.id + " .pl"); if (c) c.innerHTML = ""; }
    // this site's own Cloudflare trace says whether WARP carries the traffic (absent when self-hosted elsewhere)
    fetch("/cdn-cgi/trace", { cache: "no-store", signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r.text() : "")
      .then(x => { S.warp = parseTrace(x).warp || "off"; }).catch(() => {});
    // an address no geo-aware probe has seen (text-only probes, WebRTC) is looked up right away, once per network
    const lookups = [], looked = new Set();
    const lookup = ip => {
      if (geoOf(S.geo, ip) || looked.has(netOf(ip)) || looked.size >= 8) return;
      looked.add(netOf(ip));
      lookups.push(fetch("https://api.ip.sb/geoip/" + encodeURIComponent(ip), { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(6000) })
        .then(r => r.ok ? r.json() : Promise.reject()).then(b => { const r = READERS.ipsb(b); if (gen === S.gen && r.geo) { S.geo[ip] = r.geo; live(); } }).catch(() => {}));
    };
    let d = 0; setProg(0, PROBES.length);
    await Promise.all(PROBES.map(async p => {
      const t0 = performance.now();
      let res = [];
      try { res = await (p.read === "stun" ? stunProbe(p) : httpProbe(p)); } catch (e) { res = []; S.why[p.id] = { why: e.why || "net", n: e.n }; }
      if (!res.length && !S.why[p.id]) S.why[p.id] = { why: "stun" };
      if (gen !== S.gen) return;
      S.ms[p.id] = p.read === "stun" ? null : performance.now() - t0;
      S.ok[p.id] = res.length > 0; S.res[p.id] = res;
      for (const r of res) if (r.geo && (r.geo.cc || r.geo.asn) && !S.geo[r.ip]) S.geo[r.ip] = r.geo;
      // geo-aware answers first, so a lookup isn't spent on a network another probe is about to name
      setTimeout(() => { if (gen === S.gen) for (const r of res) lookup(r.ip); }, 1200);
      renderRow(p); renderGroups(); setProg(++d, PROBES.length); live();
    }));
    if (gen !== S.gen) return;
    for (const { ip } of seenAll()) lookup(ip);
    await Promise.allSettled(lookups);
    if (gen !== S.gen) return;
    S.exits = groupExits(seenAll(), S.geo, GROUP_OF, S.warp);
    const cf = Object.fromEntries(PROBES.map(p => [p.id, ((S.res[p.id] || [])[0] || {}).cf]).filter(([, c]) => c));
    S.finds = findings(PROBES, S.exits, cf, tzCc());
    S.odd = oddProbes(PROBES, S.exits);
    S.done = true;
    renderExits(); renderChips(); renderChecks(); renderFocus(); for (const p of PROBES) renderRow(p); setProg(PROBES.length, PROBES.length);
    $("#run").disabled = false; $("#run").classList.remove("busy"); $("#run span").textContent = t("rerun"); $("#share").disabled = !S.exits.length;
  }

  // leaving a shared result's page (/r/…, whose title is the verdict) opens the language's own page, which tests at once
  $("#run").onclick = () => { if (S.shared && location.pathname !== D.home[LANG]) location.href = D.home[LANG]; else run(); };

  /* ---------- a row's reason, on hover or focus ---------- */
  const tip = document.body.appendChild(Object.assign(document.createElement("div"), { className: "tip", role: "tooltip" }));
  const showTip = row => {
    tip.textContent = row.dataset.why;
    const r = row.getBoundingClientRect(), w = Math.min(tip.offsetWidth, innerWidth - 16);
    tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + 120)) + "px"; tip.style.top = r.bottom + 4 + "px";
    tip.classList.add("on");
  };
  const list_ = $(".pgroups");
  list_.addEventListener("mouseover", e => { const row = e.target.closest(".pr[data-why]"); row ? showTip(row) : tip.classList.remove("on"); });
  list_.addEventListener("mouseleave", () => tip.classList.remove("on"));
  list_.addEventListener("focusin", e => { const row = e.target.closest(".pr[data-why]"); if (row) showTip(row); });
  list_.addEventListener("focusout", () => tip.classList.remove("on"));
  addEventListener("scroll", () => tip.classList.remove("on"), { passive: true });

  /* ---------- questions: a dialog behind the ? button ---------- */
  const help = $("#help");
  $("#helpBtn").onclick = () => help.showModal ? help.showModal() : help.setAttribute("open", "");
  help.addEventListener("click", e => { if (e.target === help || e.target.closest("[data-close]")) help.close(); });

  /* ---------- a shared result ---------- */
  // Opening a result link shows that result, worked out again from what the link carries, and tests nothing until the
  // visitor asks for their own (the run button). Format and parsing: src/lib.mjs.
  function showShared(R) {
    Object.assign(S, { res: {}, ok: {}, ms: {}, why: {}, geo: {}, exits: R.exits, shared: R, done: true, gen: 0 });
    for (const p of PROBES) {
      const r = R.rows[p.id]; if (!r) continue;
      S.ok[p.id] = !r.why; S.ms[p.id] = r.ms;
      if (r.why) S.why[p.id] = r.why; else S.res[p.id] = [{ ip: "", cf: r.cf }];
    }
    const cf = Object.fromEntries(Object.entries(R.rows).filter(([, r]) => r.cf && !r.why).map(([id, r]) => [id, r.cf]));
    S.finds = findings(PROBES, S.exits, cf, R.tz);
    S.odd = oddProbes(PROBES, S.exits);
    eye.hidden = true;
    $("#sharedTxt").textContent = t("shared_from", { where: S.exits[0] ? whereOf(S.exits[0]) : "?", date: new Date(R.ts).toLocaleString(LANG, { dateStyle: "medium", timeStyle: "short" }) });
    renderExits(); renderChips(); renderChecks(); renderGroups(); renderFocus(); for (const p of PROBES) renderRow(p);
    $("#run span").textContent = t("test_mine"); $("#run").disabled = false; $("#share").disabled = false;
  }
  function leaveShared() {
    if (!S.shared) return;
    S.shared = null; eye.hidden = false; document.documentElement.removeAttribute("data-shared");
    history.replaceState(null, "", D.home[LANG]);
  }

  /* ---------- share: the shared dialog (/assets/share/, copied verbatim from 1ms-shell), a link that carries the result ---------- */
  const verdict = () => verdictOf(S.finds, S.exits) || "split";
  // The link opens the verdict's own page (/<lang>/r/<verdict>/), whose preview card states the verdict;
  // the result itself is in the hash, which never reaches a server
  function shareLink(withPlace) {
    const of = exitOfProbe(S.exits), rows = {};
    for (const p of PROBES) {
      if (S.ok[p.id] == null) continue;
      rows[p.id] = S.ok[p.id] ? { l: of[p.id] || [], ms: S.ms[p.id], cf: ((S.res[p.id] || [])[0] || {}).cf } : { why: S.why[p.id] };
    }
    const hash = encodeShare({ ts: S.shared ? S.shared.ts : Date.now(), tz: S.shared ? S.shared.tz : tzCc(), exits: S.exits, rows, place: withPlace });
    return location.origin + D.home[LANG] + "r/" + verdict() + "/" + hash;
  }
  $("#share").onclick = async () => {
    if (!S.done || !S.exits.length) return;
    const { share } = await import("/assets/share/share.js");
    share({
      lang: LANG, name: t("name"), file: "egresslens", show: ["city", "isp"], never: ["ip"],
      link: shareLink, home: location.origin + D.home[LANG], text: () => t("share_text", { v: t("vh_" + verdict()) }),
      height: (m, kit) => measure(m, kit).H, draw: drawCard, ts: S.shared ? S.shared.ts : Date.now(),
    }).open();
  };

  // The result on the card, in the page's theme: the verdict, the exits (country; city and network only when the
  // visitor ticks the box; never addresses) and the check table as the page shows it, exit chips in their colors.
  // The dialog draws the frame: logo, name, QR code and date.
  const img = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const EH = 54;
  function measure(m, kit) {
    const { W, P, F } = kit, VW = W - P - (P + 210);
    m.font = `700 44px ${F}`;
    const hLines = wrap(m, t("vh_" + verdict()), W - P * 2);
    // the check rows: each value as the page shows it, as tokens (a piece of text, or an exit chip)
    const rows = CHECKS.map(r => {
      const li = document.querySelector(`#finds [data-r="${r}"]`), toks = [];
      for (const n of li.querySelector(".fr-v").childNodes) {
        if (n.nodeType === 1 && n.classList.contains("xl")) continue;          // links stay on the page
        if (n.nodeType === 1 && n.classList.contains("lt")) toks.push({ chip: n.textContent });
        else for (const w of (n.textContent || "").match(TOK) || []) toks.push({ w });
      }
      return { label: li.querySelector(".fr-l").textContent, s: (S.finds[r] || {}).s || "none", lines: layout(m, kit, toks, VW) };
    });
    const hTop = kit.top + 44, eTop = hTop + hLines.length * 56 + 40, cTop = eTop + S.exits.length * EH + 20;
    return { hLines, rows, hTop, eTop, cTop, H: cTop + rows.reduce((a, r) => a + 20 + r.lines.length * 34, 0) + 24 + 70 };
  }
  async function drawCard(x, kit) {
    const { W, P, F, v, dark, clip } = kit, VX = P + 210, { hLines, rows, hTop, eTop, cTop } = measure(x, kit);
    const C = { line: v("line"), fg: v("fg"), muted: v("muted"), ok: v("ok"), bad: v("bad"), warn: v("e-p1") };
    const colorOf = l => {
      const e = S.exits.find(x => x.letter === l), n = +((/\d+$/.exec(l) || [1])[0]);
      return !e ? C.muted : e.kind === "local" ? v(n === 2 ? "e-d2" : "e-d") : v("e-p" + (n >= 2 && n <= 4 ? n : 1));
    };
    x.textBaseline = "alphabetic";
    x.fillStyle = C.fg; x.font = `700 44px ${F}`; hLines.forEach((l, i) => x.fillText(l, P, hTop + i * 56));
    // exits
    let y = eTop;
    for (const e of S.exits) {
      chipAt(x, kit, e.letter, P, y - 30, 40, colorOf(e.letter));
      let xx = P + 56;
      if (e.cc) { try { x.drawImage(await img(`/flags/${e.cc.toLowerCase()}.svg`), xx, y - 22, 30, 22); xx += 42; } catch (er) {} }
      const where = (kit.show ? [e.city, e.cc && country(e.cc)] : [e.cc ? country(e.cc) : ""]).filter(Boolean).join(", ") || "?";
      x.fillStyle = C.fg; x.font = `600 24px ${F}`; x.fillText(where, xx, y - 2); xx += x.measureText(where).width + 14;
      x.fillStyle = C.muted; x.font = `400 20px ${F}`;
      x.fillText(clip(x, t(e.kind === "local" ? "k_local" : "k_proxy") + (kit.show && e.org ? " · " + e.org + (e.asn ? " · AS" + e.asn : "") : ""), W - P - xx), xx, y - 2);
      y += EH;
    }
    // the check table
    y = cTop;
    const MARK = { ok: "✓", warn: "!", bad: "✕", info: "•", none: "–" };
    for (const r of rows) {
      x.fillStyle = C.line; x.fillRect(P, y, W - P * 2, 1);
      y += 20;
      const cx = P + 13, cy = y + 13;
      x.beginPath(); x.arc(cx, cy, 13, 0, Math.PI * 2);
      if (["ok", "bad", "warn"].includes(r.s)) { x.fillStyle = C[r.s]; x.fill(); x.fillStyle = dark ? "#111" : "#fff"; }
      else { x.strokeStyle = C.line; x.lineWidth = 2; x.stroke(); x.fillStyle = C.muted; }
      x.font = `700 15px ${F}`; x.textAlign = "center"; x.fillText(MARK[r.s] || "–", cx, cy + 5); x.textAlign = "left";
      x.fillStyle = C.muted; x.font = `400 20px ${F}`; x.fillText(clip(x, r.label, VX - P - 54), P + 40, y + 20);
      r.lines.forEach((line, i) => {
        let xx = VX;
        for (const tk of line) {
          if (tk.chip) chipAt(x, kit, tk.chip, xx + 2, y + i * 34 + 1, 26, colorOf(tk.chip));
          else { x.fillStyle = r.s === "bad" ? C.bad : C.fg; x.font = `400 22px ${F}`; x.fillText(tk.w, xx, y + 21 + i * 34); }
          xx += tk.wd;
        }
      });
      y += r.lines.length * 34;
    }
    x.fillStyle = C.line; x.fillRect(P, y, W - P * 2, 1);
  }
  // an exit chip on the card: the page's tinted square, the label in the exit's color
  const chipW = (x, kit, l, h) => { x.font = `700 ${Math.round(h * .46)}px ${kit.M}`; return Math.max(h, x.measureText(l).width + h * .5); };
  function chipAt(x, kit, l, x0, y0, h, col) {
    const w = chipW(x, kit, l, h);
    x.fillStyle = col + "22"; kit.roundRect(x, x0, y0, w, h, h * .26); x.fill();
    x.strokeStyle = col + "55"; x.lineWidth = 1.5; x.stroke();
    x.fillStyle = col; x.textAlign = "center"; x.fillText(l, x0 + w / 2, y0 + h * .68); x.textAlign = "left";
  }
  // words, or single CJK characters, with the space after them
  const TOK = /[　-鿿가-힯＀-￯]|[^\s　-鿿가-힯＀-￯]+\s*|\s+/g;
  function wrap(x, s, w) {
    const out = []; let line = "";
    for (const tok of s.match(TOK) || []) {
      if (line && x.measureText(line + tok).width > w) { out.push(line.trimEnd()); line = tok.trimStart(); } else line += tok;
    }
    if (line.trim()) out.push(line.trimEnd());
    return out;
  }
  // tokens into lines of width w, each token with its width (a chip: its square and a little space around it)
  function layout(x, kit, toks, w) {
    const lines = [[]]; let lw = 0;
    for (const tk of toks) {
      if (tk.chip) tk.wd = chipW(x, kit, tk.chip, 26) + 6;
      else { x.font = `400 22px ${kit.F}`; tk.wd = x.measureText(tk.w).width; }
      if (lw && lw + tk.wd > w && !(tk.w && !tk.w.trim())) {
        lines.push([]); lw = 0;
        if (tk.w) { tk.w = tk.w.trimStart(); tk.wd = x.measureText(tk.w).width; }
      }
      lines[lines.length - 1].push(tk); lw += tk.wd;
    }
    return lines;
  }

  applyMask();
  const shared = parseShare(location.hash, PROBES.map(p => p.id));
  if (shared && shared.exits.length) showShared(shared);
  else { document.documentElement.removeAttribute("data-shared"); run(); }
})();
