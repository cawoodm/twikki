
/**
 * TestFramework
 * Provides some macros and functions to run UI/E2E tests
 * Tests are typically instructions to click and element, wait, and then check if other elements appear
 * The macro <<tests.clear>> prepares a new run
 *  whilst <<tests.queue>> adds tests to be run sequentially
 * The macro <<tests.run>> provides a button to start the tests
 * While a test is running the macros clear and queue are disabled (see isRunning)
 *  because the tests may open the same tiddler which contains them and thus interfere
 */

// TODO: tw.extensions.registerPlugin(...code..., meta{version, etc...})

(function() {
  const WAIT = 300;
  const queue = [];
  const results = [];
  let isRunning = false;
  tw.tmp.tests = {queue, results};
  Object.freeze(tw.tmp.tests);
  tw.extensions.registerMacro('tests', 'queue', (options) => {
    if (isRunning) return '';
    // TODO: Save currentTiddler and visibleTiddlers
    let id = randstr();
    let name = options.name;
    if (options.expect) options.expect = options.expect.split(/,\s?/);
    if (options.expectSome) options.expectSome = options.expectSome.split(/,\s?/);
    if (options.click) queueTest(name, () => clickTest({id, ...options}));
    else if (options.type) queueTest(name, () => typingTest({id, ...options}));
    else if (options.comment) queueTest(name, () => '');
    else throw new Error('Unknown test type');
    if (!name) return `<i>// ${options.comment}</i>`; // Comment
    return `<div id="${id}">Preparing test '${name}'...</div>`;
  });
  function queueTest(name, test) {
    queue.push({name, test});
  }

  async function clickTest({name, click, find, expect, expectNone, expectSome}) {
    await sleep(WAIT);
    doClick({click});
    checkExpectations({find, expect, expectNone, expectSome});
    return name;
  }
  function doClick({click}) {
    if (!click) return;
    let src = document.querySelector(click);
    if (!src?.click) throw new Error(`Failed to find clickable element matching '${click}!`);
    src.click();
  }
  async function typingTest({name, type, input, find, expect, expectNone, expectSome}) {
    await sleep(WAIT);
    doTyping({type, input});
    checkExpectations({find, expect, expectNone, expectSome});
    return name;
  }
  function doTyping({type, input}) {
    if (!type) return;
    let src = document.querySelector(type);
    if (!src || typeof src.value === 'undefined') throw new Error(`Failed to find input element matching '${type}!`);
    src.value = input;
    src.dispatchEvent(new KeyboardEvent('keyup', {'keyCode': 13}));
  }
  function checkExpectations({find, expect, expectNone, expectSome}) {
    if (!find) return;
    let target = document.querySelectorAll(find);
    let targetIds = target?.length ? Array.from(target).map(t => t.getAttribute('data-tiddler-title')) : [];
    if (!target?.length && !expectNone) throw new Error(`Failed to find target element matching selector '${find}!`);
    else if (expect && expect?.length && target?.length !== expect.length) throw new Error(`Failed to find correct number of elements (got ${target?.length || 0} expected ${expect.length})!`);
    else if (expectSome && expectSome.every(t => targetIds.indexOf(t) > 0)) throw new Error(`Failed to find some elements (expected ${expectSome.join(', ')} missing ${expectSome.find(t => targetIds.indexOf(t) < 0)})!`);
    // TODO: expect.all(id => target.find
  }

  tw.extensions.registerMacro('tests', 'clear', () => {
    if (isRunning) return '';
    queue.length = 0;
    return 'Tests Cleared';
  });
  tw.extensions.registerMacro('tests', 'run', ({suite}) => {
    let id = randstr();
    return `<div id="${id}">${tw.ui.button(`Run ${suite}`, 'tests.run', {suite, id})}</div>`;
  });
  tw.extensions.registerMacro('tests', 'results', () => {
    let tests = results.filter(t => !!t.name);
    let success = tests.filter(t => t.success).length;
    let error = tests.filter(t => t.error).length;
    let res = `## ${success} passed, ${error} failed: 
* ${tests.map(t => `${t.success ? '✅' : '❌'} ${t.name} ${t.success || t.error}`).join('\n* ')}
    `;
    return res;
  });

  tw.events.subscribe('tests.run', async({suite}) => {
    results.length = 0;
    isRunning = true;
    for (let t of queue.filter(t => !!t.name)) {
      try {
        let res = await t.test();
        results.push({suite, name: t.name, success: res});
      } catch (e) {
        results.push({suite, name: t.name, error: e.message});
      }
    }
    isRunning = false;
    tw.events.send('tiddler.preview', {title: `TestResults: ${suite} (${new Date().toLocaleString()})`, text: '<<tests.results>>', type: 'x-twikki', tags: []});
  }, 'tests.run');

  function sleep(ms) {return new Promise(r => setTimeout(r, ms));}
  function randstr() {return Math.random().toString(36).replace('0.', '');}

})();
