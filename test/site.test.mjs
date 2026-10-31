// The built pages keep the 1ms.dog tool contract (see the README): what the shared top bar relies on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LANGS, loadI18n } from "../scripts/build.mjs";

const I = await loadI18n();
const page = async slug => readFile(new URL(`../public/${slug ? slug + "/" : ""}index.html`, import.meta.url), "utf8");

test("every language has every string, with the same placeholders", () => {
  for (const [l] of LANGS) {
    assert.ok(I[l], "missing language " + l);
    for (const [k, v] of Object.entries(I.en)) {
      assert.ok(k in I[l], `${l}: missing ${k}`);
      if (typeof v === "string") assert.deepEqual((I[l][k].match(/\{\w+\}/g) || []).sort(), (v.match(/\{\w+\}/g) || []).sort(), `${l}: placeholders of ${k}`);
    }
    assert.equal(I[l].faq.length, I.en.faq.length, l + ": faq");
  }
});

test("pages: charset first, standard lang, no inline styles, every probe listed", async () => {
  for (const [l, slug] of LANGS) {
    const h = await page(slug);
    assert.match(h, /^<!doctype html>\n<html lang="[a-zA-Z-]+"/);
    assert.equal(h.match(/<html lang="([^"]+)"/)[1], l);
    assert.match(h, /<head>\n<meta charset="utf-8">\n<script>/);
    assert.ok(!/\sstyle="/.test(h), l + ": inline style attribute");
    assert.ok(/<body>/.test(h) && /<\/head>/.test(h));
    assert.ok(/select option, ?select optgroup/.test(await readFile(new URL("../public/assets/" + /app\.[0-9a-f]+\.css/.exec(h)[0], import.meta.url), "utf8")));
    assert.ok(h.length < 60_000, l + ": page too big");
  }
});

// Visible text that is not in the strings files is a brand (the same everywhere) or a gap: on every other language's
// page, an aria-label, title or alt that reads exactly like the English page's must be one of these.
const BRANDS = new Set(["", "1ms", "GitHub", "EgressLens"]);
test("no English left on other languages' pages (aria-label, title, alt)", async () => {
  const attrs = h => [...h.matchAll(/s(aria-label|title|alt)="([^"]*)"/g)].map(m => m[2]).filter(v => !/^https?:/.test(v));
  const en = new Set(attrs(await page("")));
  for (const [l, slug] of LANGS.slice(1)) {
    const leaks = attrs(await page(slug)).filter(v => en.has(v) && !BRANDS.has(v) && !/^[w.-]+.[a-z]{2,}$/.test(v));
    assert.deepEqual([...new Set(leaks)], [], l + ": untranslated");
  }
});
