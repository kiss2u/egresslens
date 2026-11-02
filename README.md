# EgressLens (出口照妖镜)

**English** · [简体中文](README.zh-CN.md)

Which IP addresses does the internet see you as? Rule-based proxies and VPNs pick a route per website, so one "what is my IP" check only sees its own route. [EgressLens](https://egress.1ms.dog) asks 51 probes at once and groups what they see into exits: **D** for your own line (direct), **P** for a proxy, numbered D1, D2, P1, P2… when there is more than one.

**Live:** https://egress.1ms.dog

## Probes

| Group | What it shows |
|---|---|
| Sites in mainland China | IPIP.NET, iQIYI, ipify.cn, DNSPod (IPv4 and IPv6): the route rules usually send direct |
| IP lookup services | this site (the 1ms.dog shell's `/_ms/me`, Cloudflare's view of the connection; `/cdn-cgi/trace` when self-hosted), IP.SB, ipinfo.io, ipapi.co, ipwho.is, GeoJS, ipleak.net, ident.me, ip.guide, icanhazip, BigDataCloud |
| AI services | ChatGPT, OpenAI, Sora, Claude, Anthropic, Grok, Perplexity, Copilot, Mistral, Poe, Character.AI, DeepL |
| Popular sites | Cloudflare, 1.1.1.1, GitLab, npm, Notion, Linear, Zoom, Medium, Coinbase, Crunchyroll, Patreon, Shopify |
| IPv4 only / IPv6 only | IP.SB, Cloudflare Radar, ipify, icanhazip on single-stack hosts |
| WebRTC (UDP) | STUN servers of Cloudflare, Google, Twilio, Xiaomi, Bilibili and Mango TV |

AI services and popular sites are read through Cloudflare's `/cdn-cgi/trace` on each site's own domain: it returns the address that connected, with `Access-Control-Allow-Origin: *`. So the page sees exactly which exit chatgpt.com or claude.ai gets under your rules.

From the answers the page reports split routing (mainland sites vs. abroad), services that take their own route, WebRTC leaks (UDP leaves through your own line while websites see a proxy), the NAT type (cone or symmetric, from one connection that asks every STUN server), IPv6 leaks, a time zone that doesn't match the exit country, and Cloudflare WARP.

**Private by design:** the site is static files. Your browser talks to each probe directly; no result is sent to the site. "Hide IPs" masks addresses for screenshots.

## Self-hosting

`public/` is committed, so nothing needs building unless you change the code.

```bash
git clone https://github.com/yt1988/egresslens
cd egresslens
npx wrangler login
npx wrangler deploy        # a static-assets Worker: no script, free and unmetered
```

`wrangler.toml` turns off `*.workers.dev` and preview URLs; bind your own domain under **Workers & Pages → egress → Settings → Domains & Routes**, or set `workers_dev = true` for a quick test. Any static host works; `public/_headers` holds the security headers in Cloudflare's format. The WARP check reads `/cdn-cgi/trace` on the page's own host, so it only works behind Cloudflare.

On 1ms.dog the page can also run inside the connection checkup (check.1ms.dog): opened with `?embed=checkup` from the origin the host names in `<meta name="check">`, it shows only the exits and the findings (not the link to the checkup that the intro carries once the host announces it), starts at once and posts its progress and result to that origin. Without that meta, as when self-hosted, `?embed` is ignored.

To put your own domain into canonical links and the sitemap:

```bash
npm install
SITE_URL=https://egress.example.com npm run build
```

## Development

```bash
npm install
npm run dev        # http://localhost:8787, with the production headers
npm run build      # regenerate public/ after changing src/ (commit public/)
npm test           # public/ up to date, page contract, and the logic tests
npm run verify     # check every HTTPS probe: no redirect, CORS, readable answer
npm run og         # redraw the link-preview images in public/og/ after changing a headline (commit them)
```

```
src/probes.mjs       the probes: group, URL and how to read each answer
src/lib.mjs          pure logic (readers, exit grouping and D/P labels, findings), unit-tested
src/app.js           browser code: runs the probes, renders exits, findings and rows
src/page.html        page template; src/i18n/*.mjs strings for 10 languages (en is the reference)
scripts/build.mjs    builds public/: pages per language, hashed assets, sitemap, robots, llms.txt, _headers
```

A new probe must answer one GET with no redirect, allow CORS for any origin, and return the client address in a form a reader in `src/lib.mjs` understands. Run `npm run verify` from a dual-stack network.

## License

MIT
