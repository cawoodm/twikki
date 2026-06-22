import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

// A minimal <script>/<link>-aware DOM stub. createElement returns a fake
// element; appendChild records it and, after a tick, fires onload (or onerror
// when the url is flagged to fail). querySelector resolves data-lib lookups
// against appended scripts so loadScript's dedup-by-title path is exercised.
function makeDom() {
  const appended = [];
  const failUrls = new Set();
  function makeEl(tag) {
    const el = {
      tagName: tag,
      dataset: {},
      _attrs: {},
      setAttribute(k, v) {
        this._attrs[k] = v;
      },
      onload: null,
      onerror: null,
    };
    return el;
  }
  const head = {
    appendChild(el) {
      appended.push(el);
      if (el.tagName === 'script') {
        // Fire async, like a real network fetch.
        setTimeout(() => {
          if (failUrls.has(el.src)) el.onerror && el.onerror();
          else el.onload && el.onload();
        }, 1);
      }
      return el;
    },
  };
  const document = {
    head,
    createElement: makeEl,
    querySelector(sel) {
      const m = sel.match(/script\[data-lib="(.+)"\]/);
      if (!m) return null;
      return appended.find(e => e.tagName === 'script' && e.dataset.lib === m[1]) || null;
    },
  };
  return {document, appended, failUrls};
}

// Eval core.dom the way the platform does: invoke its IIFE with `tw`. The
// module installs tw.lib.require as a side effect and returns meta whose
// exports carry loadScript.
function freshDom(globals) {
  // Strip the leading block comment and the trailing semicolon so the module
  // IIFE is a clean expression we can `return`.
  const code = readFileSync(join(root, 'src/modules/core.dom.js'), 'utf8')
    .replace(/^\s*\/\*\*[\s\S]*?\*\/\s*/, '')
    .replace(/;\s*$/, '');
  const tw = {events: {send() {}}};
  // Provide document/window into the module's scope via a Function wrapper so
  // we don't have to mutate Node globals.
  // eslint-disable-next-line no-new-func
  const factory = new Function('tw', 'document', 'window', `return (${code})(tw);`);
  const meta = factory(tw, globals.document, globals.window);
  return {tw, exports: meta.exports};
}

test('loadScript resolves to window[global] on load', async () => {
  const dom = makeDom();
  const win = {hljs: {name: 'hljs-instance'}};
  const {exports} = freshDom({document: dom.document, window: win});
  const result = await exports.loadScript('hljs', 'https://cdn/hljs.js', {global: 'hljs'});
  assert.deepEqual(result, {name: 'hljs-instance'});
  const scripts = dom.appended.filter(e => e.tagName === 'script');
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].dataset.lib, 'hljs');
  assert.equal(scripts[0].src, 'https://cdn/hljs.js');
});

test('loadScript is idempotent: same title returns the same promise, one tag', async () => {
  const dom = makeDom();
  const {exports} = freshDom({document: dom.document, window: {}});
  const p1 = exports.loadScript('lib-a', 'https://cdn/a.js');
  const p2 = exports.loadScript('lib-a', 'https://cdn/a.js');
  assert.equal(p1, p2, 'second call reuses the cached promise');
  await Promise.all([p1, p2]);
  // Even after resolution, asking again returns the resolved cached promise
  // and never appends a second <script> (the soft-reload case).
  const p3 = exports.loadScript('lib-a', 'https://cdn/a.js');
  await p3;
  const scripts = dom.appended.filter(e => e.tagName === 'script');
  assert.equal(scripts.length, 1, 'only one <script> across repeat calls');
});

test('loadScript rejects on error with a descriptive message', async () => {
  const dom = makeDom();
  dom.failUrls.add('https://cdn/broken.js');
  const {exports} = freshDom({document: dom.document, window: {}});
  await assert.rejects(
    () => exports.loadScript('broken', 'https://cdn/broken.js'),
    /Failed to load 'broken' from https:\/\/cdn\/broken\.js/,
  );
});

test('loadScript sets integrity + crossOrigin when integrity is given', async () => {
  const dom = makeDom();
  const {exports} = freshDom({document: dom.document, window: {}});
  await exports.loadScript('lib-sri', 'https://cdn/sri.js', {integrity: 'sha384-abc'});
  const el = dom.appended.find(e => e.dataset.lib === 'lib-sri');
  assert.equal(el.integrity, 'sha384-abc');
  assert.equal(el.crossOrigin, 'anonymous');
});

test('tw.lib.require runs the loader once and shares the promise', async () => {
  const dom = makeDom();
  const {tw} = freshDom({document: dom.document, window: {}});
  let calls = 0;
  const loader = () => {
    calls++;
    return Promise.resolve('value');
  };
  const a = tw.lib.require('thing', loader);
  const b = tw.lib.require('thing', loader);
  assert.equal(a, b, 'same memoised promise');
  assert.equal(await a, 'value');
  await tw.lib.require('thing', loader); // post-resolution call
  assert.equal(calls, 1, 'loader invoked exactly once');
});
