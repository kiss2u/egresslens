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
  const K = { theme: "egress:theme", lang: "egress:lang", mask: "egress:mask", auto: "egress:auto" };
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
  $("#lang").onchange = e => { const l = e.target.value; store.set(K.lang, l); location.href = D.paths[l] + location.hash; };

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

  async function httpProbe(p) {
    const r = await fetch(bust(p.url), { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(7000) });
    if (!r.ok) throw new Error(r.status);
    const text = await r.text();
    let body = text;
    if (p.read !== "text" && p.read !== "trace") body = JSON.parse(text);
    const res = readProbe(p, body);
    return res ? [res] : [];
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
  const S = { res: {}, ok: {}, ms: {}, geo: {}, warp: "off", exits: [], finds: [], done: false, gen: 0 };
  const masked = () => store.get(K.mask) === "1";
  const ipTxt = ip => masked() ? maskIp(ip) : ip;
  const eye = $("#eye");
  function applyMask() {
    eye.textContent = t(masked() ? "show" : "hide"); eye.setAttribute("aria-pressed", masked());
    for (const p of PROBES) if (S.res[p.id]) renderRow(p);
    if (S.done) renderExits();
  }
  eye.onclick = () => { store.set(K.mask, masked() ? "0" : "1"); applyMask(); };

  // A row keeps its size from the start: only its text changes. Before a result, a row is reset to waiting.
  function renderRow(p) {
    const row = $("#p-" + p.id); if (!row) return;
    const res = S.res[p.id], ip = row.querySelector(".pip"), ms = row.querySelector(".pms"), co = row.querySelector(".pco");
    row.classList.toggle("fail", S.ok[p.id] === false); row.classList.toggle("wait", S.gen > 0 && S.ok[p.id] == null);
    ms.textContent = ""; co.textContent = ""; ip.title = "";
    if (S.ok[p.id] == null) { ip.textContent = S.gen ? t("wait") : "–"; return; }
    if (S.ok[p.id] === false) { ip.textContent = t("fail"); return; }
    ip.textContent = res.map(r => ipTxt(r.ip)).join(" · ");
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
      if (c) c.innerHTML = (of[p.id] || []).map(l => chip(l)).join("");
    }
  }
  const whereOf = e => [e.city, e.cc && country(e.cc)].filter(Boolean).join(", ") || "?";
  // in a sentence an exit is its chip and country: short, and the card above has the rest
  const exRef = l => { const e = S.exits.find(x => x.letter === l); return e ? `${chip(l)} ${esc(e.cc ? country(e.cc) : whereOf(e))}` : esc(l); };
  // While probes answer, the exits fill two slots drawn at the start (most visitors have a local line and a proxy);
  // an address shows once its network is known. The final sort, numbering and any extra exit come at the end.
  const exCard = e => {
    const ips = [4, 6].map(f => [f, e.ips.filter(ip => fam(ip) === f)]).map(([f, l]) => l.length ? `<span><em>IPv${f}</em>${l.map(ip => esc(ipTxt(ip))).join(" · ")}</span>` : "").join("");
    return `<li class="ex">${chip(e.letter, true)}<div class="ex-b">` +
      `<div class="where">${flag(e.cc)}<b>${esc(whereOf(e))}</b>${e.org ? `<span class="m">${esc(e.org)}${e.asn ? " · AS" + e.asn : ""}</span>` : ""}</div>` +
      `<div class="ips">${ips}</div></div></li>`;
  };
  const slot = () => `<li class="ex sk"><i class="lt big k-none">?</i><span class="blink">${esc(t("sniff"))}</span></li>`;
  function renderExits() {
    const ul = $("#exList"), E = S.exits;
    if (S.done && !E.length) { ul.innerHTML = `<li class="ex sk">${esc(t("no_net"))}</li>`; return; }
    ul.innerHTML = E.map(exCard).join("") + (S.done ? "" : slot().repeat(Math.max(0, 2 - E.length)));
  }
  // While running, each probe group's heading in the list counts its answers, and the findings column holds five
  // skeleton lines (about the size of the findings); the findings fade in over them once every probe is in.
  function renderGroups() {
    for (const g of GROUPS) {
      const ids = PROBES.filter(p => p.g === g).map(p => p.id), d = ids.filter(id => S.ok[id] != null).length;
      const el = document.querySelector(`[data-g="${g}"] .pg-n`);
      if (el) el.textContent = S.gen ? `${d} / ${ids.length}` : "";
    }
  }
  const skeleton = () => { const ul = $("#finds"); ul.classList.remove("in"); ul.innerHTML = `<li class="fd sk"><i></i><span></span></li>`.repeat(5); };
  function renderFinds() {
    const isExit = x => S.exits.some(e => e.letter === x);
    const ul = $("#finds");
    ul.innerHTML = S.finds.map(f => {
      const v = {};
      for (const [k, x] of Object.entries(f.v)) v[k] = k === "list" ? esc(list(x.map(NAME_OF))) : isExit(x) ? exRef(x) : /^[A-Z]{2}$/.test(x) ? esc(country(x)) : esc(x);
      if (f.key === "f_fail") v.n = f.v.list.length;
      // a warning's lead-in (up to the first colon) is set in bold
      const txt = t(f.key, v).replace(/^([^:：<]{2,30}[:：])/, f.level === "warn" ? "<b>$1</b>" : "$1");
      return `<li class="fd lv-${f.level}"><i></i><span>${txt}</span></li>`;
    }).join("");
    void ul.offsetWidth; ul.classList.add("in");
  }
  function setProg(d, n) { $("#prog").classList.toggle("end", S.done); $("#prog i").style.transform = `scaleX(${n ? d / n : 0})`; $("#progTxt").textContent = !S.gen ? "" : S.done ? t("done", { n }) : t("progress", { d, n }); }

  /* ---------- a run ---------- */
  const seenAll = () => PROBES.flatMap(p => (S.res[p.id] || []).map(r => ({ ip: r.ip, probe: p.id })));
  // live view: only addresses whose network is known, so an address never shows as an exit of its own and then merges
  let raf = 0;
  const live = () => { if (raf) return; raf = requestAnimationFrame(() => {
    raf = 0; if (S.done) return;
    S.exits = groupExits(seenAll().filter(s => geoOf(S.geo, s.ip)), S.geo, GROUP_OF, S.warp);
    renderExits(); renderChips(); renderGroups();
  }); };
  async function run() {
    const gen = ++S.gen;
    // clear everything the last run showed: exits, findings, and every probe row
    Object.assign(S, { res: {}, ok: {}, ms: {}, geo: {}, warp: "off", exits: [], finds: [], done: false });
    renderExits(); renderGroups(); skeleton();
    $("#run").disabled = true; $("#run").classList.add("busy"); $("#copy").disabled = true; $("#run span").textContent = t("running");
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
      try { res = await (p.read === "stun" ? stunProbe(p) : httpProbe(p)); } catch (e) { res = []; }
      if (gen !== S.gen) return;
      S.ms[p.id] = p.read === "stun" ? null : performance.now() - t0;
      S.ok[p.id] = res.length > 0; S.res[p.id] = res;
      for (const r of res) if (r.geo && (r.geo.cc || r.geo.asn) && !S.geo[r.ip]) S.geo[r.ip] = r.geo;
      // geo-aware answers first, so a lookup isn't spent on a network another probe is about to name
      setTimeout(() => { if (gen === S.gen) for (const r of res) lookup(r.ip); }, 1200);
      renderRow(p); setProg(++d, PROBES.length); live();
    }));
    if (gen !== S.gen) return;
    for (const { ip } of seenAll()) lookup(ip);
    await Promise.allSettled(lookups);
    if (gen !== S.gen) return;
    S.exits = groupExits(seenAll(), S.geo, GROUP_OF, S.warp);
    S.finds = findings(PROBES, S.exits, S.ok, tzCc());
    S.done = true;
    renderExits(); renderChips(); renderFinds(); setProg(PROBES.length, PROBES.length);
    $("#run").disabled = false; $("#run").classList.remove("busy"); $("#run span").textContent = t("rerun"); $("#copy").disabled = !S.exits.length;
  }

  /* ---------- copy as text ---------- */
  function report() {
    const lines = [`${t("name")} · ${new Date().toLocaleString(LANG)}`, ""];
    for (const e of S.exits) lines.push(`${e.letter}  ${t("k_" + e.kind)}  ${whereOf(e)}${e.org ? " · " + e.org : ""}${e.asn ? " AS" + e.asn : ""}  ${e.ips.map(ipTxt).join(", ")}`);
    lines.push("");
    const tmp = document.createElement("div");
    for (const li of $("#finds").children) { tmp.innerHTML = li.innerHTML; lines.push("- " + tmp.textContent.trim()); }
    lines.push("");
    const of = exitOfProbe(S.exits);
    for (const g of GROUPS) {
      lines.push(t("g_" + g));
      for (const p of PROBES.filter(x => x.g === g)) lines.push(`  ${(of[p.id] || ["-"]).join("/").padEnd(3)} ${NAME_OF(p.id).padEnd(20)} ${S.ok[p.id] ? S.res[p.id].map(r => ipTxt(r.ip)).join(", ") : t("fail")}`);
    }
    return lines.join("\n") + "\n" + location.origin + location.pathname + "\n";
  }
  $("#copy").onclick = async () => {
    const b = $("#copy"), lbl = b.querySelector("span");
    try { await navigator.clipboard.writeText(report()); lbl.textContent = t("copied"); } catch (e) { lbl.textContent = t("copy_fail"); }
    setTimeout(() => { lbl.textContent = t("copy"); }, 1600);
  };
  $("#run").onclick = () => run();

  /* ---------- run on open (remembered in this browser) ---------- */
  const autoBox = $("#auto");
  autoBox.checked = store.get(K.auto) !== "0";
  autoBox.onchange = () => store.set(K.auto, autoBox.checked ? "1" : "0");

  /* ---------- questions: a dialog behind the ? button ---------- */
  const help = $("#help");
  $("#helpBtn").onclick = () => help.showModal ? help.showModal() : help.setAttribute("open", "");
  help.addEventListener("click", e => { if (e.target === help || e.target.closest("[data-close]")) help.close(); });

  applyMask();
  if (autoBox.checked) run();
  else {
    // waiting for Start: the placeholders say so, and the button reads Start until the first run
    $("#exList").innerHTML = `<li class="ex sk">${esc(t("idle"))}</li>`;
    skeleton();
    $("#run span").textContent = t("start"); $("#run").disabled = false;
  }
})();
