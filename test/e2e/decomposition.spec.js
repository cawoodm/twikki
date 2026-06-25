// Guards for the platform decomposition (plans/platform-rework.md):
//  - every shipped plugin still loads/inits/starts cleanly against the new
//    module layout (a broken tw.call or missing tw.run entry shows up here),
//  - tw.call still resolves names that used to live in the platform closure,
//  - ?safemode: extension packages are skipped but the base package (and its
//    plugins) still load; TWikki can create, edit, validate, save and navigate.

import {expect, test} from '@playwright/test';
import {bootApp, card, seedTiddlers} from './helpers.js';

test('metaInfo lives in TiddlerMetaInfo plugin: normal boot shows pck: pill', async ({page}) => {
  await bootApp(page);
  const plugin = await page.evaluate(() => tw.plugin('TiddlerMetaInfo'));
  expect(plugin).toBeTruthy();
  expect(plugin.meta.dependencies).toEqual(['Picker']);
  expect(plugin.missingDependencies).toBeUndefined(); // Picker is loaded in normal boot
  // Show any tiddler that has a .package field (set by core.packaging on import).
  const title = await page.evaluate(() => {
    const t = tw.tiddlers.all.find(x => x.package);
    if (!t) return null;
    tw.run.showTiddler(t.title);
    return t.title;
  });
  expect(title).toBeTruthy();
  // The metaInfo plugin renders a pck: pill button into the .meta region of the card.
  await expect(
    page.locator(`.tiddler[data-tiddler-title="${title}"] .meta .pck-pill`),
  ).toContainText('pck:');
});

test('meta.dependencies: missing dep yields missingDependencies + console warn; plugin still runs', async ({
  page,
}) => {
  const warnings = [];
  page.on('console', msg => {
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  // Seed a $Plugin tiddler that declares an impossible dep into the store; it
  // loads with the workspace and loadPlugins() picks it up.
  await seedTiddlers(page, [
    {
      title: '$DepProbe',
      type: 'script/js',
      tags: ['$Plugin'],
      package: 'test',
      text: `(function () {
        window.__depProbeInitRan = true;
        return {meta: {name: 'DepProbe', version: '1.0.0', dependencies: ['DoesNotExist']}, init() {}};
      })()`,
    },
  ]);
  await bootApp(page);
  const entry = await page.evaluate(() => {
    const p = tw.plugin('DepProbe');
    return p
      ? {missing: p.missingDependencies, ran: !!window.__depProbeInitRan, error: p.error}
      : null;
  });
  expect(entry).toBeTruthy();
  expect(entry.error).toBeNull();
  expect(entry.missing).toEqual(['DoesNotExist']);
  expect(entry.ran).toBe(true); // soft check: plugin still runs
  expect(warnings.some(w => w.includes('DepProbe') && w.includes('DoesNotExist'))).toBe(true);
});

test('all shipped plugins load, init and start without errors', async ({page}) => {
  await bootApp(page);
  const plugins = await page.evaluate(() =>
    tw.plugins.map(p => ({name: p.meta?.name || p.source, error: p.error})),
  );
  expect(plugins.length).toBeGreaterThan(5);
  const broken = plugins.filter(p => p.error);
  expect(broken, JSON.stringify(broken)).toHaveLength(0);
});

test('meta.dependencies reorders init: dependent listed first still inits after its dep', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__order = [];
  });
  const mk = (title, name, deps) => ({
    title,
    type: 'script/js',
    tags: ['$Plugin'],
    package: 'test',
    text: `(function () { return {meta: {name: '${name}', version: '1.0.0'${
      deps ? `, dependencies: ${JSON.stringify(deps)}` : ''
    }}, init() { window.__order.push('${name}'); }}; })()`,
  });
  // B is seeded BEFORE A; B declares it depends on A.
  await seedTiddlers(page, [mk('$DepB', 'DepB', ['DepA']), mk('$DepA', 'DepA', null)]);
  await bootApp(page);
  const order = await page.evaluate(() => window.__order);
  expect(order.indexOf('DepA')).toBeGreaterThanOrEqual(0);
  expect(order.indexOf('DepA')).toBeLessThan(order.indexOf('DepB'));
});

test('stable order: two non-base plugins with no deps keep their insertion order', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__order = [];
  });
  const mk = (title, name) => ({
    title,
    type: 'script/js',
    tags: ['$Plugin'],
    package: 'test',
    text: `(function () { return {meta: {name: '${name}', version: '1.0.0'}, init() { window.__order.push('${name}'); }}; })()`,
  });
  await seedTiddlers(page, [mk('$StableFirst', 'StableFirst'), mk('$StableSecond', 'StableSecond')]);
  await bootApp(page);
  const order = await page.evaluate(() => window.__order);
  expect(order.indexOf('StableFirst')).toBeGreaterThanOrEqual(0);
  expect(order.indexOf('StableFirst')).toBeLessThan(order.indexOf('StableSecond'));
});

test('dependency cycle: warn, both plugins still run, length unchanged', async ({page}) => {
  const warnings = [];
  page.on('console', msg => {
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  await page.addInitScript(() => {
    window.__cycleRan = {};
  });
  const mk = (title, name, deps) => ({
    title,
    type: 'script/js',
    tags: ['$Plugin'],
    package: 'test',
    text: `(function () { return {meta: {name: '${name}', version: '1.0.0', dependencies: ${JSON.stringify(
      deps,
    )}}, init() { window.__cycleRan['${name}'] = true; }}; })()`,
  });
  await seedTiddlers(page, [mk('$CycX', 'CycX', ['CycY']), mk('$CycY', 'CycY', ['CycX'])]);
  await bootApp(page);
  const result = await page.evaluate(() => ({
    ran: window.__cycleRan,
    hasX: !!tw.plugin('CycX'),
    hasY: !!tw.plugin('CycY'),
  }));
  expect(result.ran).toEqual({CycX: true, CycY: true});
  expect(result.hasX).toBe(true);
  expect(result.hasY).toBe(true);
  expect(warnings.some(w => w.includes('cycle') && w.includes('CycX') && w.includes('CycY'))).toBe(
    true,
  );
});

test('base batch precedes non-base: a test-package plugin with no deps sorts after all base plugins', async ({
  page,
}) => {
  // Seeded into the store, this non-base plugin loads ahead of every base
  // (package) plugin — only the batch rule can sort it after them.
  await seedTiddlers(page, [
    {
      title: '$AaaaTestPlugin',
      type: 'script/js',
      tags: ['$Plugin'],
      package: 'test',
      text: `(function () { return {meta: {name: 'AaaaTestPlugin', version: '1.0.0'}, init() {}}; })()`,
    },
  ]);
  await bootApp(page);
  const result = await page.evaluate(() => {
    const idxTest = tw.plugins.findIndex(p => p.meta?.name === 'AaaaTestPlugin');
    const baseIdxs = tw.plugins.map((p, i) => (p.package === 'base' ? i : -1)).filter(i => i >= 0);
    return {idxTest, maxBaseIdx: Math.max(...baseIdxs)};
  });
  expect(result.idxTest).toBeGreaterThan(result.maxBaseIdx);
});

test('declared deps order within the base batch: BaseMarkdown before OpenLinksInNewWindow', async ({
  page,
}) => {
  await bootApp(page);
  const result = await page.evaluate(() => {
    const idxMd = tw.plugins.findIndex(p => p.meta?.name === 'BaseMarkdown');
    const idxOl = tw.plugins.findIndex(p => p.meta?.name === 'OpenLinksInNewWindow');
    const ol = tw.plugin('OpenLinksInNewWindow');
    return {idxMd, idxOl, missing: ol?.missingDependencies, error: ol?.error};
  });
  expect(result.idxMd).toBeGreaterThanOrEqual(0);
  expect(result.idxOl).toBeGreaterThan(result.idxMd);
  expect(result.missing).toBeUndefined();
  expect(result.error).toBeNull();
});

test('renderer.override: a synthetic plugin claims a custom type', async ({page}) => {
  await seedTiddlers(page, [
    {
      title: '$FooRenderer',
      type: 'script/js',
      tags: ['$Plugin'],
      package: 'test',
      text: `(function () { return {
        meta: {name: 'FooRenderer', version: '1.0.0'},
        start() {
          tw.events.subscribe('renderer.override', function fooRender({tiddler, text}) {
            if (tiddler.type !== 'foo') return null;
            return '<div class="foo">' + text + '</div>';
          });
        }
      }; })()`,
    },
  ]);
  await bootApp(page);
  const html = await page.evaluate(() =>
    tw.core.render.makeTiddlerText({title: 'X', type: 'foo', text: 'hi'}),
  );
  expect(html).toBe('<div class="foo">hi</div>');
});

test('renderer.pre and renderer.post chain transforms around the core renderer', async ({page}) => {
  await seedTiddlers(page, [
    {
      title: '$PrePostProbe',
      type: 'script/js',
      tags: ['$Plugin'],
      package: 'test',
      text: `(function () { return {
        meta: {name: 'PrePostProbe', version: '1.0.0'},
        start() {
          tw.events.subscribe('renderer.pre', function preMark(text) { return '«' + text + '»'; });
          tw.events.subscribe('renderer.post', function postMark(html) { return '<wrap>' + html + '</wrap>'; });
        }
      }; })()`,
    },
  ]);
  await bootApp(page);
  const html = await page.evaluate(() =>
    tw.core.render.makeTiddlerText({title: 'X', type: 'unknown-type', text: 'hello'}),
  );
  expect(html.startsWith('<wrap>')).toBe(true);
  expect(html.endsWith('</wrap>')).toBe(true);
  expect(html).toContain('«hello»');
});

test('renderer.override returning empty string claims the call (null is the only no-op)', async ({
  page,
}) => {
  await seedTiddlers(page, [
    {
      title: '$EmptyClaim',
      type: 'script/js',
      tags: ['$Plugin'],
      package: 'test',
      text: `(function () { return {
        meta: {name: 'EmptyClaim', version: '1.0.0'},
        start() {
          tw.events.subscribe('renderer.override', function claimEmpty({tiddler}) {
            return tiddler.type === 'empty-type' ? '' : null;
          });
        }
      }; })()`,
    },
  ]);
  await bootApp(page);
  const html = await page.evaluate(() =>
    tw.core.render.makeTiddlerText({title: 'X', type: 'empty-type', text: 'whatever'}),
  );
  expect(html).toBe('');
});

test('shipped CsvRenderer renders type=csv tiddlers as an HTML table', async ({page}) => {
  await bootApp(page);
  const result = await page.evaluate(() => {
    const t = tw.tiddlers.all.find(x => x.title === 'ExampleCsv');
    const html = t ? tw.core.render.makeTiddlerText(t) : null;
    return {found: !!t, type: t?.type, html};
  });
  expect(result.found).toBe(true);
  expect(result.type).toBe('csv');
  expect(result.html).toContain('<table class="csv">');
  expect(result.html).toContain('<th>Name</th>');
  expect(result.html).toContain('<th>Age</th>');
  // Bare field with embedded space.
  expect(result.html).toContain('<td>james dean</td>');
  // Quoted field with embedded space — proves the RFC 4180 parser is active on the shipped demo.
  expect(result.html).toContain('<td>John Smith</td>');
});

test('CsvRenderer: RFC 4180 quoted field with embedded comma renders as one cell', async ({
  page,
}) => {
  await bootApp(page);
  const html = await page.evaluate(() =>
    tw.core.render.makeTiddlerText({
      title: 'X',
      type: 'csv',
      text: 'City,Pop\n"New York, NY",8000000\n"He said ""hi""",1',
    }),
  );
  // Embedded comma stays in one cell.
  expect(html).toContain('<td>New York, NY</td>');
  // Escaped "" collapses to single ", then HTML-escaped to &quot;.
  expect(html).toContain('<td>He said &quot;hi&quot;</td>');
  // No spurious extra cells from naive splitting.
  expect(html.match(/<td>/g).length).toBe(4); // 2 rows × 2 cells
});

test('CsvRenderer: empty body renders an empty table, no crash, no <pre> fallback', async ({
  page,
}) => {
  await bootApp(page);
  const cases = await page.evaluate(() => ({
    empty: tw.core.render.makeTiddlerText({title: 'X', type: 'csv', text: ''}),
    nullish: tw.core.render.makeTiddlerText({title: 'X', type: 'csv', text: undefined}),
  }));
  expect(cases.empty).toBe('<table class="csv"></table>');
  expect(cases.nullish).toBe('<table class="csv"></table>');
});

test('markdown still renders via the core fallback after the pipeline change', async ({page}) => {
  await bootApp(page);
  const html = await page.evaluate(() =>
    tw.core.render.makeTiddlerText({title: 'X', type: 'markdown', text: '# Hi'}),
  );
  expect(html).toContain('<h1>');
  expect(html).toContain('Hi');
});

test('CsvRenderer registers "csv" type in the new-tiddler picker datalist', async ({page}) => {
  await bootApp(page);
  // Plugin registers via tw.extensions.registerType in start().
  const registered = await page.evaluate(() => tw.types?.csv);
  expect(registered).toBe('CSV Data');
  // The new-tiddler dialog merges $TiddlerTypes shadow with tw.types when opened.
  await page.evaluate(() => tw.events.send('tiddler.new'));
  const options = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#new-types option')).map(o => ({
      value: o.value,
      label: o.textContent,
    })),
  );
  const csv = options.find(o => o.value === 'csv');
  expect(csv).toBeTruthy();
  expect(csv.label).toBe('CSV Data');
  // Sanity: a built-in shadow type is also present (merge keeps shadow entries).
  expect(options.some(o => o.value === 'markdown')).toBe(true);
});

test('tw.call resolves functions that moved out of the platform closure', async ({page}) => {
  await bootApp(page);
  const results = await page.evaluate(() => ({
    tiddlerExists: tw.call('tiddlerExists', '$MainLayout'),
    getTiddler: tw.call('getTiddler', '$MainLayout')?.title,
    renderTWikki: typeof tw.call('renderTWikki', {text: 'plain', title: 'x'}),
    getJSONObject: typeof tw.call('getJSONObject', '$GeneralSettings'),
  }));
  expect(results.tiddlerExists).toBe(true);
  expect(results.getTiddler).toBe('$MainLayout');
  expect(results.renderTWikki).toBe('string');
  expect(results.getJSONObject).toBe('object');
});

test('module eval failure: one error page, names the failing module(s)', async ({page}) => {
  // Serve core.dom.js with a syntax error → its eval throws, every downstream
  // module that touches tw.core.dom errors too. This is the exact path that
  // used to produce <h1>Module Errors Occurred</h1> twice (handleModuleErrors
  // returned undefined → caller's early return never fired → start() pushed
  // more errors and re-invoked it).
  await page.route('**/modules/core.dom.js', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/\(function\s*\(\s*tw\s*\)/, '(function(tw-)');
    await route.fulfill({response, body});
  });
  await page.goto('/?reload');
  await expect(page.locator('h1')).toHaveCount(1);
  const heading = await page.locator('h1').textContent();
  expect(heading).toMatch(/core\.dom/);
  // The per-module error paragraphs bold each name and include the JS message.
  await expect(page.locator('p.error').first()).toContainText('core.dom.js');
});

test.describe('?safemode (extension packages skipped, base plugins still load)', () => {
  test('boots with base plugins only and the full edit round-trip works', async ({page}) => {
    await page.goto('/?safemode&trace');
    await page.waitForFunction(
      () =>
        !!(
          window.tw &&
          tw.tiddlers?.all?.length &&
          tw.run &&
          tw.templates?.TiddlerDisplay &&
          document.querySelector('#visible-tiddlers')
        ),
      null,
      {timeout: 30000},
    );
    // safemode loads the base package (its plugins) but skips extension packages,
    // so every loaded plugin must come from the base package and there must be some.
    const plugins = await page.evaluate(() => tw.plugins.map(p => p.package));
    expect(plugins.length).toBeGreaterThan(0);
    expect(plugins.every(pkg => pkg === 'base')).toBe(true);

    // create / edit / save via the form (core.ui + core.tiddlers + core.store)
    await page.evaluate(() => tw.events.send('tiddler.new'));
    await expect(page.locator('#new-dialog')).toBeVisible();
    await page.fill('#new-title', 'SafemodeNote');
    await page.fill('#new-body', 'created in safemode');
    await page.fill('#new-type', 'markdown');
    await page.locator('[data-msg="form.done"]').click();
    await expect(page.locator('#new-dialog')).toBeHidden();
    await expect(card(page, 'SafemodeNote')).toBeVisible();
    // markdown renders via the base $BaseMarkdownPlugin (it loads under safemode)
    await expect(card(page, 'SafemodeNote').locator('.text')).toContainText(
      'created in safemode',
    );
    const stored = await page.evaluate(() =>
      (tw.store.get('tiddlers') || []).some(t => t.title === 'SafemodeNote'),
    );
    expect(stored).toBe(true);

    // navigate (hash link) still works
    await page.evaluate(() => tw.core.ui.navigateTo('SafemodeNote'));
    await expect(card(page, 'SafemodeNote')).toBeVisible();

    // search still works
    const found = await page.evaluate(() =>
      tw.core.search.search('SafemodeNote', tw.tiddlers.all).map(t => t.title),
    );
    expect(found).toContain('SafemodeNote');
  });
});
