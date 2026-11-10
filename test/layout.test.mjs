// The results block on a phone: findings first, and that order is also the keyboard order. The code under test is the
// real block from src/app.js, run against a small DOM stub, so a change there is caught here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const START = "/* Findings lead on phones";
const END = 'phoneLayout.addEventListener("change", arrangeResults);';
const from = app.indexOf(START), to = app.indexOf(END);
assert.ok(from >= 0 && to > from, "the results layout block is in src/app.js");
const block = app.slice(from, to + END.length);
const css = await readFile(new URL("../src/style.css", import.meta.url), "utf8");

// A DOM only as large as the block uses: two columns, a focusable button in the exits' column, and a parent that
// reparents (prepend) while remembering whether the browser dropped the focus.
function harness(phone) {
  const doc = { activeElement: null, body: { name: "body" } };
  const node = (name, manual = []) => {
    const n = {
      name, manual, children: [], onclick: null,
      get firstElementChild() { return this.children[0] || null; },
      contains(x) { return x === this || this.children.some(c => c.contains(x)); },
      focus(opts) { this.focused = (this.focused || 0) + 1; this.lastFocus = opts; doc.activeElement = this; },
      prepend(x) {
        this.prependCalls = (this.prependCalls || 0) + 1;
        const i = this.children.indexOf(x);
        if (i >= 0) this.children.splice(i, 1);
        this.children.unshift(x);
        if (x.contains(doc.activeElement)) doc.activeElement = doc.body;  // the browser blurs a moved focused node
      }
    };
    n.children.push(...manual);
    return n;
  };
  const eye = node("eye"), exitsCol = node("exits-col", [eye]), findsCol = node("finds-col");
  const heroBody = node("hero-b", [exitsCol, findsCol]);
  const media = { matches: !!phone, fns: [], addEventListener(t, fn) { if (t === "change") this.fns.push(fn); } };
  const sandbox = {
    document: {
      get activeElement() { return doc.activeElement; },
      querySelector: s => ({ ".hero-b": heroBody, ".exits-col": exitsCol, ".finds-col": findsCol })[s] || null
    },
    matchMedia: () => media
  };
  sandbox.$ = s => sandbox.document.querySelector(s);
  vm.runInNewContext(block + "\n__out = { arrangeResults, phoneLayout, heroBody, exitsCol, findsCol };", sandbox);
  return { ...sandbox.__out, sandbox, doc, media, eye, exitsCol, findsCol, heroBody };
}

test("results order: findings first on a phone, exits first on a desktop", () => {
  const h = harness(true);
  assert.deepEqual(h.heroBody.children.map(x => x.name), ["finds-col", "exits-col"]);
  assert.equal(h.heroBody.prependCalls, 1, "one move at start, not more");
  const d = harness(false);
  assert.deepEqual(d.heroBody.children.map(x => x.name), ["exits-col", "finds-col"]);
  assert.equal(d.heroBody.prependCalls, undefined, "a desktop start moves nothing");
});

test("only crossing the breakpoint moves: same nodes, same handlers, focus kept", () => {
  const h = harness(false);                                   // a desktop start: nothing moves
  const order = [...h.heroBody.children];
  const handler = () => {};
  h.eye.onclick = handler;
  const fire = () => h.media.fns.forEach(f => f());
  h.media.matches = true; fire();                             // desktop → phone: findings first
  assert.deepEqual(h.heroBody.children.map(x => x.name), ["finds-col", "exits-col"]);
  assert.equal(h.heroBody.prependCalls, 1, "the change moves once");
  // the code reparents the existing nodes: no clone, no innerHTML; the handler is still the one that was set
  assert.ok(order.includes(h.heroBody.children[0]) && order.includes(h.heroBody.children[1]));
  assert.equal(h.heroBody.children[0], h.findsCol);
  assert.equal(h.eye.onclick, handler);
  assert.equal(h.exitsCol.children[0], h.eye, "the button stayed inside its column");
  // the same state announced again: nothing moves
  fire();
  assert.equal(h.heroBody.prependCalls, 1, "no move without a real change");
  // crossing back while the exits' button has the focus keeps it, across the reparenting of its own column
  h.eye.focus();
  h.media.matches = false; fire();
  assert.equal(h.heroBody.prependCalls, 2);
  assert.deepEqual(h.heroBody.children.map(x => x.name), ["exits-col", "finds-col"]);
  assert.equal(h.doc.activeElement, h.eye, "focus survives the move");
  assert.equal(h.eye.lastFocus && h.eye.lastFocus.preventScroll, true);
  // a focus outside the results is not stolen
  const outside = { focus() { throw new Error("must not steal the focus"); } };
  h.doc.activeElement = outside;
  h.media.matches = true; fire();
  assert.equal(h.doc.activeElement, outside);
});

test("the code does not move on resize, and the markup and the landing-page rule carry the classes", async () => {
  assert.doesNotMatch(block, /resize/, "a resize listener would move the columns on every event");
  assert.doesNotMatch(block, /innerHTML|cloneNode/, "the columns are moved, not rebuilt");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /<div class="col exits-col">/);
  assert.match(html, /<div class="col finds-col">/);
  // a landing page hides its findings by name, independent of where the column sits in the DOM
  assert.ok(css.includes(".focus ~ .hero-b > .finds-col { display: none; }"));
  assert.doesNotMatch(css, /\.focus ~ \.hero-b > \.col:last-child/);
  for (const slug of ["index", "zh-cn/index", "de/chatgpt-ip/index"]) {
    const h = await readFile(new URL(`../public/${slug}.html`, import.meta.url), "utf8");
    assert.match(h, /class="col finds-col"/, slug);
  }
});
