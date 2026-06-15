import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

// Minimal tw harness for evaluating core.tiddlers.js. The IIFE touches
// RegExp.compose at eval time (line ~23) and writes Object.assign(tw.run, ...),
// tw.util = {...}, Object.assign(tw.extensions, {registerValidator}) — so we
// stub those surfaces. validateTiddlerText only reaches into tw.run.executeText
// when the tiddler has code blocks; the tests use type:'text/plain' tiddlers
// so the code-block path is empty.
function loadTiddlersModule() {
  // RegExp.compose is provided by core.common.js. We don't need its real
  // composition — the eval just needs the call to succeed for module init.
  if (!RegExp.compose) RegExp.compose = (re) => new RegExp(re.source, re.flags);

  const tw = {
    run: {},
    tiddlers: {all: [], visible: [], trashed: []},
    events: {subscribe() {}, send() {}, filter(_e, v) { return v; }},
    extensions: {},
    tmp: {},
    core: {sections: {parseSections: () => ({order: [], sections: {}})}},
    storage: {get: () => null, set: () => {}},
  };
  const code = readFileSync(join(root, 'src/modules/core.tiddlers.js'), 'utf8');
  const meta = (0, eval)(code)(tw);
  return {tw, meta};
}

test('registerValidator requires {name, match, validate}', () => {
  const {meta} = loadTiddlersModule();
  const reg = meta.exports.registerValidator;
  assert.throws(() => reg({}), /required/);
  assert.throws(() => reg({name: 'x'}), /required/);
  assert.throws(() => reg({name: 'x', match: () => true}), /required/);
  assert.throws(() => reg({name: 'x', validate: () => {}}), /required/);
});

test('registerValidator is idempotent by name (re-register replaces)', () => {
  const {meta} = loadTiddlersModule();
  const calls = [];
  meta.exports.registerValidator({
    name: 'v1',
    match: () => true,
    validate: () => calls.push('first'),
  });
  meta.exports.registerValidator({
    name: 'v1',
    match: () => true,
    validate: () => calls.push('second'),
  });
  meta.exports.validateTiddlerText({type: 'text/plain', text: '', tags: []});
  assert.deepEqual(calls, ['second']);
});

test('validator throw is rewrapped as `<name>: <message>`', () => {
  const {meta} = loadTiddlersModule();
  meta.exports.registerValidator({
    name: 'always-fails',
    match: () => true,
    validate: () => {
      throw new Error('oops');
    },
  });
  assert.throws(
    () => meta.exports.validateTiddlerText({type: 'text/plain', text: '', tags: []}),
    /^Error: always-fails: oops$/,
  );
});

test('non-matching validators are skipped (validate not called)', () => {
  const {meta} = loadTiddlersModule();
  let called = 0;
  meta.exports.registerValidator({
    name: 'template',
    match: t => t.tags?.includes('$Template'),
    validate: () => {
      called++;
    },
  });
  meta.exports.validateTiddlerText({type: 'text/plain', text: '', tags: []});
  assert.equal(called, 0);
  meta.exports.validateTiddlerText({type: 'text/plain', text: '', tags: ['$Template']});
  assert.equal(called, 1);
});

test('inline json check runs and throws (without reaching validators)', () => {
  const {meta} = loadTiddlersModule();
  let ranAfterJson = false;
  meta.exports.registerValidator({
    name: 'sentinel',
    match: () => true,
    validate: () => {
      ranAfterJson = true;
    },
  });
  assert.throws(
    () => meta.exports.validateTiddlerText({type: 'json', text: '{', tags: []}),
    /Unexpected|JSON/i,
  );
  assert.equal(ranAfterJson, false, 'inline JSON parse throws before validators iterate');
});

test('validators iterate in registration order; first throw wins', () => {
  const {meta} = loadTiddlersModule();
  const calls = [];
  meta.exports.registerValidator({
    name: 'first',
    match: () => true,
    validate: () => {
      calls.push('first');
    },
  });
  meta.exports.registerValidator({
    name: 'second',
    match: () => true,
    validate: () => {
      calls.push('second');
      throw new Error('stop');
    },
  });
  meta.exports.registerValidator({
    name: 'third',
    match: () => true,
    validate: () => {
      calls.push('third');
    },
  });
  assert.throws(
    () => meta.exports.validateTiddlerText({type: 'text/plain', text: '', tags: []}),
    /^Error: second: stop$/,
  );
  assert.deepEqual(calls, ['first', 'second']);
});
