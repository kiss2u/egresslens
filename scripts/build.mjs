#!/usr/bin/env node
// Builds the static site in public/ from src/:
//   index.html, <lang>/index.html                 the page per language
//   assets/app.<hash>.js, assets/app.<hash>.css   app code and styles, shared and cached by every page
//   assets/l.<lang>.<hash>.js                     the strings the browser code needs, per language
//   sitemap.xml, robots.txt, llms.txt, _headers   SEO and security headers (CSP)
// Usage: node scripts/build.mjs          write the files
//        node scripts/build.mjs --check  exit 1 if anything is out of date, or the app code does not parse (CI)
// SITE_URL sets the address used in canonical links and the sitemap (default https://egress.1ms.dog).
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import { PROBES, GROUPS } from "../src/probes.mjs";

const SITE = (process.env.SITE_URL || "https://egress.1ms.dog").replace(/\/+$/, "");
const pub = new URL("../public/", import.meta.url), src = new URL("../src/", import.meta.url);
// language, URL folder, og:locale, name in its own language; the first is the root
export const LANGS = [["en", "", "en_US", "English"], ["zh-CN", "zh-cn", "zh_CN", "简体中文"], ["zh-TW", "zh-tw", "zh_TW", "繁體中文"],
  ["ja", "ja", "ja_JP", "日本語"], ["ko", "ko", "ko_KR", "한국어"], ["es", "es", "es_ES", "Español"], ["fr", "fr", "fr_FR", "Français"],
  ["de", "de", "de_DE", "Deutsch"], ["pt", "pt", "pt_BR", "Português"], ["ru", "ru", "ru_RU", "Русский"]];

// Runs before first paint: apply the saved theme. On the English root, send visitors to their language's page
// (a saved choice first, then the browser languages); crawlers and English readers stay.
export const PREPAINT = `(function(){var d=document.documentElement,th=null,s=null;try{th=localStorage.getItem("egress:theme");s=localStorage.getItem("egress:lang")}catch(e){}if(th==="light"||th==="dark")d.setAttribute("data-theme",th);if(!d.hasAttribute("data-root"))return;var P=JSON.parse(d.getAttribute("data-paths")||"{}"),l=null;try{var q=new URLSearchParams(location.search).get("lang");if(P[q])l=q}catch(e){}if(!l&&P[s])l=s;for(var ls=navigator.languages||[navigator.language||"en"],i=0;!l&&!s&&i<ls.length;i++){var x=String(ls[i]).toLowerCase(),b=x.split("-")[0];l=b==="zh"?(/tw|hk|mo|hant/.test(x)?"zh-TW":"zh-CN"):P[b]?b:null}if(l&&l!=="en")location.replace(P[l]+location.hash)})();`;

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fill = (s, v) => { for (const k in v) s = s.split("{" + k + "}").join(v[k]); return s; };
const hash = s => createHash("sha256").update(s).digest("hex").slice(0, 10);
const sha = s => createHash("sha256").update(s).digest("base64");

// Windows sometimes holds a just-written file for a moment (antivirus, the preview server): retry before failing
async function writeRetry(url, text) {
  for (let i = 0; ; i++) {
    try { return await writeFile(url, text); }
    catch (e) { if (i >= 4 || !["UNKNOWN", "EBUSY", "EPERM"].includes(e.code)) throw e; await new Promise(r => setTimeout(r, 150 * (i + 1))); }
  }
}

export async function loadI18n() {
  const out = {};
  for (const f of (await readdir(new URL("i18n/", src))).filter(f => f.endsWith(".mjs")))
    out[f.slice(0, -4)] = (await import(new URL("i18n/" + f, src).href + "?" + Date.now())).default;
  return out;
}

export async function build({ check = false } = {}) {
  const I = await loadI18n(), en = I.en;
  const langs = LANGS.filter(([l]) => I[l]);
  const tpl = await readFile(new URL("page.html", src), "utf8");

  // src/lib.mjs (the pure logic the tests import) goes inside the app's scope, at its /* @lib */ marker
  const lib = (await readFile(new URL("lib.mjs", src), "utf8")).replace(/^export /gm, "");
  const appSrc = await readFile(new URL("app.js", src), "utf8");
  if (!appSrc.includes("/* @lib */")) throw new Error("src/app.js has no /* @lib */ marker");
  const probes = PROBES.map(({ id, g, name, host, url, read, fam }) => ({ id, g, name, host, url, read, ...(fam ? { fam } : {}) }));
  const appFull = `const PROBES = ${JSON.stringify(probes)}, GROUPS = ${JSON.stringify(GROUPS)};\n` + appSrc.replace("/* @lib */", () => lib);
  new Function(appFull);                                                // must parse
  const cssFull = (await Promise.all(["fonts.css", "style.css"].map(f => readFile(new URL(f, src), "utf8")))).join("\n");
  // minified with esbuild (pinned version, so the output, and its hash, only changes when the source does)
  const js = (await transform(appFull, { loader: "js", minify: true, target: "es2020", legalComments: "none" })).code;
  const css = (await transform(cssFull, { loader: "css", minify: true, legalComments: "none" })).code;
  const jsName = `app.${hash(js)}.js`, cssName = `app.${hash(css)}.css`;

  // static text the page already shows is not needed at runtime
  const RUNTIME_SKIP = new Set(["seo_title", "seo_desc", "seo_kw", "h1", "intro", "faq", "faq_h", "foot", "lang_label", "probes_h", "exits_h", "finds_h"]);
  const path = slug => "/" + (slug ? slug + "/" : "");
  const N = PROBES.length;
  const pages = [], files = {};
  for (const [lang, slug, locale] of langs) {
    const d = I[lang], T = k => d[k] ?? en[k] ?? k;
    const strings = Object.fromEntries(Object.keys(en).filter(k => !RUNTIME_SKIP.has(k)).map(k => [k, T(k)]));
    const sjs = `window.LEGRESS=${JSON.stringify(strings).replace(/</g, "\\u003c")};\n`;
    const sName = `l.${lang.toLowerCase()}.${hash(sjs)}.js`;
    files["assets/" + sName] = sjs;

    const url = SITE + path(slug), title = T("seo_title"), desc = fill(T("seo_desc"), { n: N });
    const alts = langs.map(([l, sl]) => `<link rel="alternate" hreflang="${l}" href="${SITE + path(sl)}">`).join("\n") +
      `\n<link rel="alternate" hreflang="x-default" href="${SITE}/">`;
    const graph = { "@context": "https://schema.org", "@type": "WebApplication", name: T("name"), url, applicationCategory: "UtilitiesApplication",
      operatingSystem: "Any", browserRequirements: "Requires JavaScript", description: desc, inLanguage: lang, isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } };
    const head = [
      `<title>${esc(title)}</title>`,
      `<meta name="description" content="${esc(desc)}">`,
      `<meta name="keywords" content="${esc(T("seo_kw"))}">`,
      ...(lang === "zh-CN" ? [`<meta http-equiv="Cache-Control" content="no-transform">`, `<meta http-equiv="Cache-Control" content="no-siteapp">`, `<meta name="applicable-device" content="pc,mobile">`] : []),
      `<meta name="robots" content="index, follow">`,
      `<meta name="theme-color" content="#f6f6f7" media="(prefers-color-scheme: light)">`,
      `<meta name="theme-color" content="#1c1c1c" media="(prefers-color-scheme: dark)">`,
      `<link rel="canonical" href="${url}">`, alts,
      `<link rel="icon" href="/favicon.ico" sizes="any">`, `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">`, `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`,
      `<meta property="og:type" content="website">`, `<meta property="og:title" content="${esc(title)}">`, `<meta property="og:description" content="${esc(desc)}">`,
      `<meta property="og:url" content="${url}">`, `<meta property="og:locale" content="${locale}">`,
      `<meta name="twitter:card" content="summary">`,
      `<script type="application/ld+json">${JSON.stringify(graph).replace(/</g, "\\u003c")}</script>`,
    ].join("\n");

    // every probe is in the HTML from the start (crawlers see what is checked; rows never move when results arrive)
    // one line per probe: name (host on hover), the address it saw, the exit label, Cloudflare colo, time
    const row = p => `<li class="pr" id="p-${p.id}"><span class="pn" title="${esc(p.host)}">${esc(p.name)}${p.fam ? ` <span class="m">v${p.fam}</span>` : ""}</span>` +
      `<span class="pip">–</span><span class="pl"></span><span class="pco"></span><span class="pms"></span></li>`;
    const groups = GROUPS.map(g => `<div class="pg"><h3>${esc(T("g_" + g))}</h3><ul>${PROBES.filter(p => p.g === g).map(row).join("")}</ul></div>`).join("\n");
    const faq = T("faq").map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n");
    const langOpts = langs.map(([l, , , nm]) => `<option value="${l}"${l === lang ? " selected" : ""}>${esc(nm)}</option>`).join("");
    const paths = Object.fromEntries(langs.map(([l, sl]) => [l, path(sl)]));
    let html = tpl
      .replace(/(<(\w+)\b[^>]*\sdata-i="(\w+)"[^>]*>)([^<]*)(<\/\2>)/g, (m, open, tag, k, inner, close) => open + esc(T(k)) + close)
      .replace("{{lang}}", lang).replace("{{pathsAttr}}", esc(JSON.stringify(paths))).replace("{{rootAttr}}", slug ? "" : " data-root")
      .replace("{{prepaint}}", PREPAINT).replace("{{head}}", head).replace("{{css}}", cssName).replace("{{js}}", jsName).replace("{{strings}}", sName)
      .replace("{{homeHref}}", path(slug)).replace("{{langOpts}}", langOpts).replace("{{intro}}", esc(fill(T("intro"), { n: N })))
      .replace("{{groups}}", groups).replace("{{faq}}", faq).replace("{{foot}}", esc(T("foot")))
      .replace("{{data}}", JSON.stringify({ lang, paths }).replace(/</g, "\\u003c"));
    if (/\{\{\w+\}\}/.test(html)) throw new Error("unfilled placeholder in " + path(slug) + ": " + /\{\{\w+\}\}/.exec(html)[0]);
    pages.push({ file: (slug ? slug + "/" : "") + "index.html", url, html });
  }

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    pages.map(p => `  <url>\n    <loc>${p.url}</loc>\n` + langs.map(([l, s]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE + path(s)}"/>`).join("\n") +
      `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/"/>\n  </url>`).join("\n") + "\n</urlset>\n";
  const robots = `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`;
  const llms = `# Egress

> Free browser tool that shows every exit IP a visitor's traffic uses. ${N} probes are asked at once: sites in
> mainland China, IP lookup services, AI services and popular sites (Cloudflare /cdn-cgi/trace on each one's own domain),
> IPv4-only and IPv6-only hosts, and WebRTC STUN servers over UDP. The answers are grouped by network into exits
> (local line or proxy), and the page reports split routing, per-service routes, WebRTC leaks, IPv6 leaks and
> time-zone mismatches. Everything runs client-side; no results are sent to the site.

- Page: ${SITE}/ (also ${langs.slice(1).map(([, s]) => "/" + s + "/").join(", ")})
- Probes: ${GROUPS.map(g => `${en["g_" + g]}: ${PROBES.filter(p => p.g === g).map(p => p.host).join(", ")}`).join("; ")}
- Source: https://github.com/yt1988/egress
`;

  // The only inline script is the pre-paint snippet, identical on every page: one hash covers the site.
  // connect-src allows any https host: the probes are fetched from the browser.
  const csp = ["default-src 'self'", `script-src 'self' 'sha256-${sha(PREPAINT)}'`, "style-src 'self'",
    "font-src 'self'", "img-src 'self' data:", "connect-src 'self' https:", "manifest-src 'self'",
    "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");
  const headers = `# Generated by scripts/build.mjs
/*
  Content-Security-Policy: ${csp}
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
/assets/*
  Cache-Control: public, max-age=604800
/assets/app.*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/l.*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/fonts/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/flags/*
  Cache-Control: public, max-age=2592000
/llms.txt
  Access-Control-Allow-Origin: *
  Content-Type: text/plain; charset=utf-8
`;

  Object.assign(files, { ["assets/" + jsName]: js, ["assets/" + cssName]: css, "sitemap.xml": sitemap, "robots.txt": robots, "llms.txt": llms, "_headers": headers });
  for (const p of pages) files[p.file] = p.html;

  const stale = [];
  for (const [name, text] of Object.entries(files)) {
    const url = new URL(name, pub);
    const current = await readFile(url, "utf8").catch(() => null);
    if (current === text) continue;
    if (check) { stale.push(name); continue; }
    await mkdir(new URL(".", url), { recursive: true });
    await writeRetry(url, text);
  }
  // old bundles
  const old = (await readdir(new URL("assets/", pub))).filter(f => /^(app|l\.[a-z-]+)\.[0-9a-f]+\.(js|css)$/.test(f) && !files["assets/" + f]);
  if (check && old.length) stale.push(...old.map(f => f + " (old)"));
  else for (const f of old) await rm(new URL("assets/" + f, pub));
  return { stale, pages: pages.length, sizes: { html: Math.max(...pages.map(p => p.html.length)), js: js.length, css: css.length } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const r = await build({ check });
  if (check && r.stale.length) { console.error("out of date (run npm run build):\n  " + r.stale.join("\n  ")); process.exit(1); }
  console.log(`${r.pages} pages · largest HTML ${(r.sizes.html / 1024).toFixed(1)} KB · JS ${(r.sizes.js / 1024).toFixed(1)} KB · CSS ${(r.sizes.css / 1024).toFixed(1)} KB`);
}
