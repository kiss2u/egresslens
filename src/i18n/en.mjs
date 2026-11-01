// English: the reference. Other languages fall back to these strings key by key.
// Findings may contain {a}, {b}, {x}, {y} (an exit: its letter and place) and {list} (probe names); they are HTML.
export default {
  name: "EgressLens",
  lang_label: "Language",
  seo_title: "IP leak test: which IP each website sees (VPN, proxy, WebRTC, IPv6)",
  seo_desc: "See which IP address each website sees you as. {n} probes in mainland China and abroad, at AI services, over IPv4, IPv6 and WebRTC, find split routing and leaks. Runs in your browser.",
  seo_kw: "egress ip, what is my ip, exit ip, proxy check, vpn leak test, webrtc leak, ipv6 leak, split routing, chatgpt ip, claude ip",
  h1: "Which IP addresses does the internet see you as?",
  intro: "Rule-based proxies and VPNs pick a route per website. {n} probes, in mainland China and abroad, at AI services, over IPv4, IPv6 and WebRTC, show every exit your traffic takes.",
  exits_h: "Your exits",
  finds_h: "Findings",
  r_route: "Routing",
  r_except: "Exceptions",
  r_ai: "AI region",
  r_rtc: "WebRTC",
  r_v6: "IPv6",
  r_tz: "Time zone",
  v_none: "–",
  v_route_one: "Everything via {a}",
  v_route_split: "China {a}, abroad {b}",
  v_except_none: "None",
  v_except_some: "{list} → {x}",
  v6_sites: "IPv6-only sites",
  v_ai_ok: "{x}: ChatGPT and Claude are available",
  v_ai_bad: "{list} see {c}: not a supported region",
  v_dc: " · datacenter IP, more likely to be challenged",
  v_rtc_leak: "Leaks your local IP {a}",
  v_rtc_proxy: "Via proxy {a}, no leak",
  v_rtc_same: "{a}, same as websites",
  v_rtc_none: "No leak (UDP blocked)",
  v_v6_leak: "Bypasses the proxy, exposes {a}",
  v_v6_ok: "Via {a}",
  v_v6_none: "No IPv6 exit",
  v_tz_ok: "Matches the exit ({a})",
  v_tz_bad: "Browser says {a}, exit is in {b}: easy to spot as a proxy",
  hide: "Hide IPs",
  show: "Show IPs",
  sniff: "Asking the probes…",
  wait: "Waiting for every probe…",
  progress: "{d} / {n} probes",
  done: "{n} probes done",
  rerun: "Run again",
  running: "Checking…",
  fail: "no answer",
  why_timeout: "No answer within 7 seconds",
  why_http: "Answered HTTP {n}",
  why_net: "Couldn't connect: blocked by the network, the proxy or an ad blocker",
  why_parse: "Answered, but without a usable IP address",
  why_stun: "No STUN reply: UDP is blocked, or the browser disables WebRTC",
  why_odd: "Sees {x}; most similar sites see {y}",
  why_leak: "Sees your local exit {x} over UDP: the proxy doesn't carry WebRTC",
  no_net: "No probe answered. Are you offline?",
  join: ", ",
  k_local: "Local",
  k_proxy: "Proxy",
  th_system: "Theme: system",
  th_light: "Theme: light",
  th_dark: "Theme: dark",

  probes_h: "Every probe",
  g_cn: "Sites in mainland China",
  g_intl: "IP lookup services",
  g_ai: "AI services",
  g_web: "Popular sites",
  g_stack: "IPv4 only / IPv6 only",
  g_udp: "WebRTC (UDP)",


  faq_h: "Questions",
  close: "Close",
  faq: [
    ["Why do different sites see different IPs?", "Proxy and VPN apps with rules (Clash, Surge, Shadowrocket, sing-box and the like) choose a route by destination: sites in China direct, AI services through one server, everything else through another. A check that asks one site only sees that site's route. This page asks dozens of destinations at the same time and groups the answers by network."],
    ["How does it know what ChatGPT or Claude sees?", "Sites behind Cloudflare answer /cdn-cgi/trace on their own domain with the address that connected to them, and allow any page to read it. Your browser connects to chatgpt.com as usual, through whatever route your rules pick for it, and reads back the address chatgpt.com saw."],
    ["What is a WebRTC leak?", "WebRTC (video calls in the browser) finds your public address by asking a STUN server over UDP. Many proxies only carry TCP, so this UDP request leaves through your own line, and any web page can read the result without a permission prompt. If a STUN server sees your local address while websites see the proxy, the page reports a leak."],
    ["What is an IPv6 leak?", "If the proxy only handles IPv4 but your line also has IPv6, connections over IPv6 can skip the proxy. The IPv6-only probes show which exit IPv6 traffic really takes."],
    ["How are local and proxy exits told apart?", "By the network's owner: an address registered to a cloud or hosting company (Amazon, Google Cloud, Alibaba, DigitalOcean…) is labeled a proxy, the first one belonging to an ISP is your local line. A residential proxy or a VPN on an ISP network can't be told apart this way."],
    ["Is anything sent to this site?", "No. Your browser talks to each probe directly; this site only serves static files and never sees your results. Hide IPs before taking a screenshot."],
  ],
  share: "Share",
  share_h: "Share the result",
  share_place: "Show city and network in the image and link",
  link_label: "Result link",
  copy_link: "Copy link",
  copy_img: "Copy image",
  dl_img: "Download image",
  sys_share: "More ways to share",
  copied: "Copied",
  share_note: "The image and link are made in your browser and never contain IP addresses; city and network stay hidden unless you turn them on.",
  shared_from: "A result from {where} · {date}",
  test_mine: "Test my own",
  share_text: "My exit check: {v}. Does this routing look right?",
  r_desc: "See the full result: which exit each website sees, split routing and leaks. Then check your own.",
  vh_leak: "IP leak found: some traffic skips the proxy",
  vh_ai: "AI services see an unsupported region",
  vh_split: "Split routing works: sites use different exits",
  vh_proxy: "Every website sees the same proxy exit",
  vh_direct: "Direct: every website sees the local IP",
  who_link: "Your full profile and disguise check →",
  lp_rtc: {
    "nav": "WebRTC leak test",
    "title": "WebRTC leak test: does your VPN or proxy expose your real IP?",
    "desc": "Free WebRTC leak test. Four STUN servers over UDP are compared with what {n} probes over HTTPS see, to show whether your VPN or proxy leaks your real IP. Runs in your browser.",
    "kw": "webrtc leak test, webrtc leak, vpn leak test, ip leak test, stun ip, real ip leak, proxy webrtc",
    "h1": "WebRTC leak test: is your real IP exposed?",
    "intro": "Video calls in the browser ask STUN servers for your public address over UDP, and many proxies only carry TCP. Four STUN servers are asked at the same time as websites, along {n} probes in all, to see whether WebRTC gives away your own line.",
    "faq": [
      [
        "What does this WebRTC leak test check?",
        "It asks four STUN servers (Cloudflare, Google, Twilio, Xiaomi) for your public address over UDP, the way video-call sites do, and compares the answer with the exit websites see over HTTPS. If STUN sees your local line while websites see the proxy, any page can read your real IP."
      ],
      [
        "How do I fix a WebRTC leak?",
        "Make the proxy carry UDP too: turn on TUN or enhanced mode in Clash, sing-box, Surge or Shadowrocket, or use the VPN's full-tunnel mode. Blocking WebRTC in the browser (uBlock Origin's setting \"Prevent WebRTC from leaking local IP addresses\", or media.peerconnection.enabled = false in Firefox) also works, but can break video calls."
      ],
      [
        "The result says UDP is blocked. Is that safe?",
        "For WebRTC, yes: no STUN server answered, so a page can't learn an address this way. Video calls may still work through a relay server."
      ],
      [
        "Does every VPN stop WebRTC leaks?",
        "A VPN that tunnels all traffic does. A proxy set only in the browser or the system (HTTP or SOCKS) usually carries TCP alone, so WebRTC's UDP leaves directly. Check again after every change to your setup."
      ]
    ]
  },
  lp_ai: {
    "nav": "ChatGPT & Claude IP",
    "title": "What IP does ChatGPT see? Check the IP and region ChatGPT and Claude see",
    "desc": "See the IP address and country ChatGPT, OpenAI, Claude, Anthropic and 8 other AI services see you from, and whether that region is supported. {n} probes, runs in your browser.",
    "kw": "chatgpt ip, what ip does chatgpt see, claude ip, chatgpt region, chatgpt unsupported country, openai ip check, ai proxy check",
    "h1": "Which IP and region do ChatGPT and Claude see?",
    "intro": "Rule-based proxies often send AI services through a node of their own. ChatGPT, OpenAI, Claude, Anthropic and 8 other AI sites report the address and country they see, next to the exits {n} probes find.",
    "faq": [
      [
        "How does it know what ChatGPT and Claude see?",
        "chatgpt.com, openai.com, claude.ai, anthropic.com and the other AI sites here are behind Cloudflare and answer /cdn-cgi/trace on their own domain: the address that connected and the country Cloudflare places it in. Your browser asks each of them through whatever route your rules pick."
      ],
      [
        "Which regions are not supported?",
        "Neither OpenAI nor Anthropic serves mainland China, Hong Kong, Macau, Russia, Belarus, Iran, North Korea, Syria or Cuba. If an AI site sees one of these, signing up or using it can be blocked."
      ],
      [
        "Why does ChatGPT see a different IP from other sites?",
        "Proxy rules often route AI domains through a dedicated node. This page shows each AI service's exit next to the others, so you can check the rule does what you meant."
      ],
      [
        "Does a datacenter IP matter?",
        "Cloud and hosting addresses are shared by many users and get more challenges and limits. An exit on a home or mobile network is less likely to be flagged."
      ]
    ]
  },
  fh_rtc_leak: "WebRTC leaks your real IP",
  fh_rtc_safe: "No WebRTC leak",
  fh_rtc_none: "No WebRTC leak: UDP is blocked",
  fh_ai_ok: "ChatGPT and Claude see a supported region",
  fh_ai_none: "No AI service answered",
  fh_web: "Websites see",
  ipv6_link: "Check IPv6 in depth →",
  fp_link: "Check your browser fingerprint →",
  lat_link: "ChatGPT and Claude latency →",
  foot: "Open source, MIT license. Runs entirely in your browser.",
};
