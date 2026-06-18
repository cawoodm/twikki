/**
 * Parameters
 * When calling macros we need a way to deserialize paramezers
 * Some widgets expect positional parameters
 *    <<WidgetP "1 a" 2 false>>
 *    => WidgetP("1 a", 2, false)
 * Some Widgets expect named parameters (an object):
 *   <<WidgetO foo:"1 a" bar:2 baz:false>>
 *     => WidgetO({foo: "1 a", bar: 2, baz: false})
 * JSON payloads (starting with { or [) are parsed as-is:
 *   <<WidgetO {"foo": "1 a", "bar": 2}>>
 *     => WidgetO({foo: "1 a", bar: 2})
 *   <<WidgetP ["a b", 2]>> => WidgetP("a b", 2) (arrays spread as positional parameters)
 */
(function () {
  // Meta
  const name = 'core.params';
  const version = '0.24.0';
  const platform = '0.27.0'; // built for platform ^0.27.0

  // Constants
  const reDoubleQuoted = /^["](.+)["]$/g;
  const reSingleQuoted = /^['](.+)[']$/g;
  const reEvalExpression = /^\$\{([^}]+)\}$/g;

  // Exports
  const exports = {parseParams, evalParam};

  const run = () => {};

  return {name, version, platform, exports, run};

  /**
   * Always returns an object or an array of params to be spread:
   *   - foo:'1 a' bar:2 => {foo: '1 a', bar: 2}
   *   - foo 'bar 2' false => ['foo', 'bar 2', false]
   */
  function parseParams(params) {
    // We do not try/catch here to be consistent and inform the macro: Anything that starts with { or [ must be JSON
    if (params?.match(/^[\[\{]/)) return JSON.parse(params);
    if (params?.match(/^[a-z0-9_]+:/i)) return strToObject(params);
    if (reEvalExpression.test(params)) {
      let res = evalParam(params);
      if (typeof res === 'object') return res;
      else return [res]; // Primitives are wrapped as arrays to spread to function calls (...res)
    }
    return paramsToArray(params);
  }

  /**
   * "a:x, b:2,c:true, d:'1'" => {a: "x", b: 2, c: true, d: "1"}
   */
  function strToObject(str) {
    let obj = {};
    paramsToArray(str) // .split(',')
      .map(k => k.trim())
      .forEach(k => {
        let val = getKeyVal(k, ':');
        let prop = Object.keys(val)[0];
        val[prop] = getTypedParam(val[prop]);
        Object.assign(obj, val);
      });
    return obj;
  }
  /**
   * 'foo "or bar" 2 true'  => ["foo", "or bar", 2, true]
   */
  function paramsToArray(str) {
    if (typeof str === 'undefined' || str === '') return [];
    let res = str.match(/\\?.|^$/g).reduce(
      (p, c) => {
        // TODO: Support unquoted eval with spaces: {1 + 'a'}
        // TODO: Support quotes inside eval: {fcn('a')}
        // TODO: Support quoteed booleans/numbers '"true" "1"' => ["true", "1"]
        if (c === '"') {
          // || c === '\''){
          p.quote ^= 1;
        } else if (!p.quote && c === ' ') {
          p.a.push('');
        } else {
          p.a[p.a.length - 1] += c.replace(/\\(.)/, '$1');
        }
        return p;
      },
      {a: ['']},
    ).a;
    return getTypedParams(res);
  }

  /* Utilities */

  function getKeyVal(x, delim) {
    // Split on the FIRST delimiter only, so values may contain it (e.g. URLs: url:https://x.com).
    const i = x.indexOf(delim);
    if (i < 0) return {[x.trim()]: ''}; // no delimiter => empty value (don't throw on a stray token)
    return {[x.slice(0, i).trim()]: x.slice(i + 1).trim()};
  }

  function getTypedParams(arr) {
    return arr.map(getTypedParam) || [];
  }

  // 'true' => true
  function getTypedParam(val) {
    if (val === 'null') return null; // Null
    if (strIsBoolean(val)) return val === 'true'; // Boolean
    if (strIsNumber(val)) return parseFloat(val); // Number
    if (reDoubleQuoted.test(val)) return val.replace(reDoubleQuoted, '$1');
    if (reSingleQuoted.test(val)) return val.replace(reSingleQuoted, '$1');
    if (reEvalExpression.test(val)) return evalParam(val);
    return val;
  }

  function evalParam(param) {
    return eval(param.replace(reEvalExpression, '$1'));
  }

  // 'false' => true
  function strIsBoolean(str) {
    return ['true', 'false'].includes(str);
  }

  // '1' => true
  function strIsNumber(str) {
    return !isNaN(str) && !isNaN(parseFloat(str));
  }
});
