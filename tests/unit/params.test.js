import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

// Load the runtime module the way the platform does: eval the file (a
// parenthesised factory function) and read its exports (see sections.test.js).
const code = readFileSync(join(root, 'src/modules/core.params.js'), 'utf8');
const {parseParams} = (0, eval)(code)().exports;

/* Positional parameters (docs/PARAMETERS.md + MyParamsTestPlugin.tid) */

test('positional: space-separated tokens become an array', () => {
  assert.deepEqual(parseParams('John Smith'), ['John', 'Smith']); // <<foo.hello John Smith>>
  assert.deepEqual(parseParams('welcome'), ['welcome']);
});

test('positional: bare tokens are type-coerced, quotes protect spaces', () => {
  assert.deepEqual(parseParams('1 true "Car Wash"'), [1, true, 'Car Wash']); // <<foo.test 1 true "Car Wash">>
  assert.deepEqual(parseParams('foo "bar 2" false'), ['foo', 'bar 2', false]);
  assert.deepEqual(parseParams('null 3.14'), [null, 3.14]);
});

test('positional: {expr} single tokens are eval\'d', () => {
  assert.deepEqual(parseParams('{1+2}'), [3]);
});

test('positional: empty/missing input yields an empty array', () => {
  assert.deepEqual(parseParams(''), []);
  assert.deepEqual(parseParams(undefined), []);
});

test('positional: quoted booleans/numbers do NOT stay strings (known limitation, TODO in core.params)', () => {
  // The tokenizer strips quotes before coercion, so '"true"' arrives as a boolean.
  assert.deepEqual(parseParams('"true" "1"'), [true, 1]);
});

/* Named parameters */

test('named: key:value pairs become one object with typed values', () => {
  assert.deepEqual(parseParams('name:"John Smith" age:22'), {name: 'John Smith', age: 22}); // <<foo.object name:"John Smith" age:22>>
  assert.deepEqual(parseParams('foo:1 bar:x baz:true'), {foo: 1, bar: 'x', baz: true});
  assert.deepEqual(parseParams('pck:icons title:add'), {pck: 'icons', title: 'add'}); // #msg:search.advanced:pck:icons title:add
});

test('named: leading non-word char means NOT named params', () => {
  assert.deepEqual(parseParams('$pck:website'), ['$pck:website']); // stays one positional string
});

test('named: values are split at every colon (known limitation — use JSON for URLs)', () => {
  assert.deepEqual(parseParams('url:https://example.com'), {url: 'https'});
});

/* JSON parameters */

test('json: an object literal with quoted keys parses as one object', () => {
  assert.deepEqual(
    parseParams('{"name":"John Smith", "age":22}'), // <<foo.object {"name":"John Smith", "age":22}>>
    {name: 'John Smith', age: 22},
  );
});

test('json: an array parses as an array (spread as positional args by the caller)', () => {
  assert.deepEqual(parseParams('["a b", 2, true]'), ['a b', 2, true]);
});

test('json: wrap an array to pass it as a single argument', () => {
  assert.deepEqual(parseParams('[[1,2,3]]'), [[1, 2, 3]]); // <<add [[1,2,3]]>> => add([1,2,3])
});

test('json: nested structures survive', () => {
  assert.deepEqual(parseParams('{"tag":"Favorite","title":"*"}'), {tag: 'Favorite', title: '*'}); // #msg:ui.open.all:{...}
  assert.deepEqual(parseParams('{"url":"https://example.com"}'), {url: 'https://example.com'}); // colons are safe in JSON
});

/* Invalid JSON falls through to the legacy tokenizer */

test('invalid json (unquoted key) falls through and arrives mangled', () => {
  // <<foo.object {"name":"John Smith", age:22}>> — the cautionary example in MyParamsTestPlugin.tid
  assert.deepEqual(
    parseParams('{"name":"John Smith", age:22}'),
    ['{name:John Smith,', 'age:22}'],
  );
});

test('invalid json that matches the {expr} eval hatch throws a cryptic error', () => {
  assert.throws(() => parseParams('{name:"John"}'), /John is not defined/);
});

test('json branch does not eat legacy {expr} eval tokens', () => {
  // '{1+2}' is not valid JSON, so it falls through to the eval hatch unchanged.
  assert.deepEqual(parseParams('{1+2}'), [3]);
});
