import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

// Eval src/modules/core.js the way the platform does, against a stubbed tw.
// The module is an IIFE returning {name, version, platform}; the bus is
// installed on tw.events as a side effect.
function freshEvents() {
  const src = readFileSync(join(root, 'src/modules/core.js'), 'utf8');
  const tw = {};
  const dp = () => {}; // suppress debug-print noise
  // The module wrapper is `(function (tw) { ... })` — invoke it as a value.
  const factory = new Function('tw', 'dp', `return ${src.replace(/^\s*\/\*\*[\s\S]*?\*\/\s*/, '')}`);
  const mod = factory(tw, dp);
  mod(tw); // call the IIFE explicitly with our stub
  tw.events.init();
  return tw.events;
}

test('events.request: first non-null result wins; later subscribers do not run', () => {
  const events = freshEvents();
  const order = [];
  events.subscribe('q', function first() { order.push('first'); return null; });
  events.subscribe('q', function second() { order.push('second'); return 'B'; });
  events.subscribe('q', function third() { order.push('third'); return 'C'; });
  assert.equal(events.request('q'), 'B');
  assert.deepEqual(order, ['first', 'second']);
});

test('events.request: empty string claims (only null/undefined are "no claim")', () => {
  const events = freshEvents();
  events.subscribe('q', function emptyish() { return ''; });
  events.subscribe('q', function fallback() { return 'fallback'; });
  assert.equal(events.request('q'), '');
});

test('events.request: with no subscribers returns undefined', () => {
  const events = freshEvents();
  assert.equal(events.request('nobody'), undefined);
});

test('events.request: a throwing subscriber is skipped, not fatal', () => {
  const events = freshEvents();
  events.subscribe('q', function boom() { throw new Error('nope'); });
  events.subscribe('q', function ok() { return 'survived'; });
  assert.equal(events.request('q'), 'survived');
});

test('events.filter: chains transformations through subscribers in order', () => {
  const events = freshEvents();
  events.subscribe('f', function upper(v) { return v.toUpperCase(); });
  events.subscribe('f', function wrap(v) { return `[${v}]`; });
  assert.equal(events.filter('f', 'hello'), '[HELLO]');
});

test('events.filter: with no subscribers returns the original value', () => {
  const events = freshEvents();
  assert.equal(events.filter('nobody', 'unchanged'), 'unchanged');
});

test('events.filter: throwing subscriber is skipped; previous value propagates', () => {
  const events = freshEvents();
  events.subscribe('f', function step1(v) { return v + '-a'; });
  events.subscribe('f', function boom() { throw new Error('nope'); });
  events.subscribe('f', function step3(v) { return v + '-c'; });
  assert.equal(events.filter('f', 'x'), 'x-a-c');
});

test('events.filter: passes ctx through to handlers as the second arg', () => {
  const events = freshEvents();
  let seenCtx;
  events.subscribe('f', function capture(v, ctx) {
    seenCtx = ctx;
    return v;
  });
  events.filter('f', 'ignored', {tiddler: {title: 'T'}});
  assert.deepEqual(seenCtx, {tiddler: {title: 'T'}});
});
