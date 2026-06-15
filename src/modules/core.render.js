/**
 * Render
 * The TWikki render pipeline: wikitext transforms (macros `<<m>>`, inclusions
 * `{{T}}`, links `[[T]]`) via renderTWikki, element creation from templates
 * (createTiddlerElement + tw.templates via loadTemplates), markdown dispatch
 * (renderMarkdown → the overridable 'markdown.render' event, falling back to
 * escaped plain text under ?safemode), and the DOM inclusion attributes
 * (`tiddler-include`, `macro`). Consumes core.templater and core.params;
 * resolves tiddler text through core.tiddlers.
 */
(function (tw) {
  const name = 'core.render';
  const version = '0.1.0';
  const platform = '0.26.0'; // built for platform ^0.26.0

  // A reference is a title, optionally followed by ::Section, so links/inclusions
  // can address into a tiddler: [[Title::Section]] / {{Title::Section}}. ':' is
  // not a valid title char, so the delimiter can never be confused with a title.
  const reTiddlerTitle =
    /[a-z0-9_\-\.\(\)\s\$\ud83c\ud000-\udfff\ud83d\ud000-\udfff\ud83e\ud000-\udfff]+/gi;
  const reTiddlerRef = new RegExp(`${reTiddlerTitle.source}(?:::${reTiddlerTitle.source})?`, 'gi');
  const reMacros = /(?<!`)<<([a-z_][a-z_0-9\.]+)\s?([^>]+)?>>/gi;
  const reInclusion = RegExp.compose(/(?<!`)\{\{(reTiddlerRef)\|?([^\}]+)?}}/gi, {reTiddlerRef});
  const reLinks = RegExp.compose(/\[\[(reTiddlerRef)]]/gi, {reTiddlerRef});

  // Exports
  const exports = {
    renderTWikki,
    renderTiddler,
    renderAllTiddlers,
    rerenderTiddler,
    createTiddlerElement,
    tiddlerDetails,
    loadTemplates,
    maskCodeRegions,
    replaceFrom,
    getMacros,
    getTiddlerLinks,
    getInclusions,
    makeTiddlerText,
    makeTiddlerTagLinks,
    tagPickerHtml,
    tiddlerSpanInclude,
    macroInclude,
    renderMarkdown,
    renderPlainText,
  };

  Object.assign(tw.run, {
    renderAllTiddlers,
    rerenderTiddler,
  });
  // Extension point: contributors register functions onto tw.extend.tiddlerDetails;
  // each is called with the tiddler in createTiddlerElement and its return lands
  // in the template as {{=<key>}}. See $TiddlerMetaInfoPlugin (base) and
  // $FavoritesPlugin (demo) for examples. The `||` guard makes it idempotent
  // across soft reloads (which re-eval modules and would otherwise wipe
  // contributions that already-loaded plugins put on the registry).
  tw.extend = tw.extend || {tiddlerDetails: {}};

  // Legacy aliases
  tw.lib = {markdown: renderMarkdown};
  window.markdown = renderMarkdown;

  return {name, version, platform, exports};

  /* Render */
  function renderTiddler(title) {
    return renderTWikki({text: tw.core.tiddlers.getTiddlerTextRaw(title), title});
  }
  function renderTWikki({text, title, validation}) {
    // Hide fenced/inline code from the wikitext transforms below so their
    // contents render verbatim; restored before markdown parsing.
    const {masked, restore} = maskCodeRegions(text);
    let result = masked;
    try {
      // TODO: Label this tiddler to update when one of these macros change!

      getMacros(result).forEach(m => {
        let macroNameOrig = m[1];
        let macroName = macroNameOrig;
        const macroCommand = new RegExp(`(?<!\`)<<${macroNameOrig}`);
        const indexOfMacro = result.search(macroCommand);
        let dbg = 0;
        // eslint-disable-next-line no-debugger
        if (dbg) debugger;

        // Resolve Macro Function
        let err;
        let macroFunction;
        try {
          macroFunction = eval(`tw.macros.${macroName}`);
        } catch (e) {
          err = e;
        }
        if (!macroFunction)
          try {
            macroName = `core.${macroName}`;
            macroFunction = eval(`tw.macros.${macroName}`);
          } catch (e) {
            err = e;
          }
        if (!macroFunction) {
          let errmsg = `Unknown macro <<${m[1]}>> in tiddler '${title}'!`;
          console.warn(errmsg, err?.message || '', err?.stack);
          result = replaceFrom(
            result,
            indexOfMacro,
            m[0],
            `<span class="error">ERROR: Unknown macro &lt;&lt;${m[1]}>></span>`,
          );
          if (validation) throw new Error(errmsg);
          return;
        }
        if (m[2]?.match(/;/)) console.warn('Deprecated ";" in macroParams', macroName, title);
        let macroParams = m[2] || '';
        // TODO: Inclusions (pass {{DataTiddler}} as string/array/object) would be cool
        try {
          macroParams = tw.core.params.parseParams(macroParams);
        } catch (e) {
          // A parse error (e.g. a throwing {expr} eval token) must not kill the whole tiddler render
          let errmsg = `Macro '${macroName}' has invalid parameters '${m[2]}' in tiddler '${title}': ${e.message}`;
          console.warn(errmsg, e.stack);
          result = replaceFrom(result, indexOfMacro, m[0], `<span class="error">${errmsg}</span>`);
          if (validation) throw e;
          return;
        }
        if (dbg) {
          dp({macroName, macroParams});
        }
        if (tw.logging.trace) {
          let newText = Array.isArray(macroParams)
            ? macroFunction(...macroParams)
            : macroFunction(macroParams);
          result = replaceFrom(result, indexOfMacro, m[0], newText);
          return;
        }
        try {
          /* *** Run Macro *** */
          // TODO: Support async macros
          let newText = Array.isArray(macroParams)
            ? macroFunction(...macroParams)
            : macroFunction(macroParams);
          if (typeof newText === 'undefined')
            console.warn('Macro returned undefined!', macroName, 'in', title);
          result = replaceFrom(result, indexOfMacro, m[0], newText);
        } catch (e) {
          let errmsg = `Macro '${macroName}' failed in tiddler '${title}'!`;
          if (e.message === 'macroFunction is not a function')
            errmsg += ' The macro is unknown or not registered!';
          else errmsg += e.message;
          console.warn(errmsg, e.stack);
          result = result.replace(
            macroCommand,
            `<span class="error">${errmsg} (see console log)</span>`,
          );
          if (validation) throw e;
          return;
        }
      });
      // TODO: Support raw/wikified {{=}} inclusions
      getInclusions(result).forEach(m => {
        let includedTitle = m[1];
        try {
          const inclusionSearch = new RegExp(`(?<!\`)${escapeRegExp('{{' + includedTitle)}`);
          const indexOfInclusion = result.search(inclusionSearch);
          if (indexOfInclusion < 0)
            throw new Error(`Unable to locate inclusion of '${includedTitle}'!`);
          let params = m[2];
          params = tw.core.params.parseParams(params);
          let text = tw.core.tiddlers.getTiddlerTextReplaced(includedTitle, params);
          if (!text)
            text = `No tiddler '${includedTitle}' found - let's [create it](#${includedTitle})!`;
          result = replaceFrom(result, indexOfInclusion, m[0], text);
        } catch (e) {
          result = `<span class="error">ERROR: Inclusion of "${includedTitle}" Failed: ${e.message}</span>`;
          console.error(
            `getInclusions "${includedTitle}" inside "${title}" Failed: ${e.message}`,
            e.stack,
          );
        }
      });
      function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
      }
      getTiddlerLinks(result).forEach(m => {
        let linkName = m[1];
        let linkURL = m[1];
        let wikiLink = `[${linkName}](#${linkURL.replace(/ /g, '%20')})`;
        result = result.replace(m[0], wikiLink);
      });
      // TODO: Auto-link CamelCase words? except ~CamelCasedTilde?
    } catch (e) {
      console.warn(`renderTWikki "${title}" Failed: ${e.message}`, e.stack);
      if (validation) throw e;
      return `<span class="error">ERROR: renderTWikki '${title}' Failed: ${e.message}</span>`;
    }
    return restore(result);
  }
  function renderAllTiddlers() {
    tw.core.dom.divVisibleTiddlers.innerHTML = '';
    // TODO: Catch showTiddler exceptions and render an error span
    tw.tiddlers.visible.forEach(t => tw.run.showTiddler(t));
    tw.events.send('ui.ready', tw.tiddlers.visible);
  }
  function rerenderTiddler(title) {
    let el = tw.core.tiddlers.getTiddlerElement(title);
    if (!el) return;
    let tiddler = tw.core.tiddlers.getTiddler(title);
    if (!tiddler) throw new Error(`rerenderTiddler '${title}' failed!`, 'E');
    let newElement = createTiddlerElement(tiddler);
    el.replaceWith(newElement);
    tw.events.send('tiddler.rendered', {tiddler, newElement});
  }
  function createTiddlerElement(t, template) {
    template = template || tw.templates.TiddlerDisplay;
    let modified = t.updated
      ? new Date(t.updated).toDateString() + ' ' + new Date(t.updated).toLocaleTimeString()
      : '';
    let id = tw.core.common.hash(t.title);
    let html = new tw.core.templater.Templater(template).render({
      id,
      fullText: makeTiddlerText(t),
      editDisabled: t.tags.includes('$NoEdit') ? 'disabled' : '',
      notSection: !t.isSection, // template uses {{!isSection}} / {{!notSection}} (negation blocks only)
      tagLinks: makeTiddlerTagLinks(t.tags),
      modified,
      ...tiddlerDetails(t),
      ...t,
    });
    let newElement;
    try {
      newElement = tw.core.dom.htmlToNode(html);
    } catch (e) {
      // A malformed template (multi-root, comment-root) used to crash the page.
      // Render a per-tiddler error placeholder so the rest of the UI stays
      // interactive — the user can open and fix the offending template.
      console.error(`createTiddlerElement '${t.title}':`, e.message);
      newElement = tw.core.dom.htmlToNode(
        `<div class="tiddler error"><div class="title">${tw.core.common.escapeHtml(t.title)}</div>` +
          `<div class="text">Template error: ${tw.core.common.escapeHtml(e.message)}</div></div>`,
      );
    }
    newElement.setAttribute('data-tiddler-id', id);
    newElement.setAttribute('data-tiddler-title', t.title);
    tw.events.send('tiddler.element.created', {title: t.title, newElement});
    return newElement;
  }
  function tiddlerDetails(t) {
    let res = {};
    Object.keys(tw.extend.tiddlerDetails).forEach(k => {
      res[k] = tw.extend.tiddlerDetails[k](t);
    });
    return res;
  }
  function loadTemplates() {
    tw.templates.MainLayout = renderTiddler('$MainLayout');
    tw.templates.TiddlerDisplay = renderTiddler('$TiddlerDisplay');
    tw.templates.TiddlerPreview = renderTiddler('$TiddlerPreview');
    tw.templates.TiddlerTrashed = renderTiddler('$TiddlerTrashed');
    tw.templates.TiddlerSearchResult = renderTiddler('$TiddlerSearchResult');
  }

  /* Text munging */
  function replaceFrom(text, index, search, replace) {
    return text.substring(0, index) + text.substring(index).replace(search, replace);
  }
  // Mask fenced code blocks (```...```) and inline code spans (`...`) so the
  // macro/inclusion/wikilink transforms in renderTWikki leave their contents
  // verbatim; markdown-it renders the restored code literally. Sentinels use
  // the Unicode Private-Use Area so they contain no `[[`/`{{`/`<<` delimiters
  // and can never collide with real content (or stray digits) on restore.
  function maskCodeRegions(text) {
    const store = []; // holds masked code regions
    const stash = m => {
      const token = `${store.length}`;
      store.push(m);
      return token;
    };
    // Fenced blocks first — only when ``` is at the start of a line
    // (optionally indented up to 3 spaces, CommonMark style). A ``` nested
    // inside an inline code span (e.g. `` ` ```js ` `` used as a literal
    // example in prose) must NOT start a fence — otherwise it swallows
    // everything up to the next ``` into a single spurious mask. The leading
    // newline is captured and re-emitted so we don't eat the boundary.
    let masked = text.replace(
      /(^|\n)( {0,3}```[^\n]*\n[\s\S]*?\n {0,3}```)(?=\n|$)/g,
      (_, pre, fence) => pre + stash(fence),
    );
    // Inline spans next — single backticks, no embedded newlines.
    masked = masked.replace(/`[^`\n]*`/g, stash);
    const restore = s => s.replace(/(\d+)/g, (_, i) => store[Number(i)]);
    return {masked, restore};
  }
  function getMacros(text) {
    return Array.from(text.matchAll(reMacros));
  }
  function getTiddlerLinks(text) {
    return Array.from(text.matchAll(reLinks));
  }
  function getInclusions(text) {
    // {{SomeTiddlerTitle}} or {{SomeTiddlerTitle:Params}}
    // KNOWN ISSUE: We can't support JSON params here since the curly brackets interfere: {{FAQ|{"name":"John Smith", "age":22}}}
    return Array.from(text.matchAll(reInclusion));
  }

  /* Markup */
  function makeTiddlerText(tiddler) {
    const {title, text, type} = tiddler;
    // Three-stage render pipeline:
    //   renderer.pre       — filter, transforms text before rendering
    //   renderer.override  — request, first non-null wins; otherwise core fallback below
    //   renderer.post      — filter, transforms output after rendering
    // pre/post fire either way (around an override OR around the core fallback).
    // Only null/undefined signals "no claim" from an override handler; '' wins.
    const input = tw.events.filter('renderer.pre', text, {tiddler});
    // Note: override handlers receive post-`renderer.pre` text (not raw stored
    // text), so a pre-handler that transforms the input is visible to overrides.
    let output = tw.events.request('renderer.override', {tiddler, text: input});
    if (output == null) {
      const markdownTypes = ['markdown', 'keyval', 'list', 'table'];
      const codeTypes = ['macro', 'script/js', 'css', 'json', 'html/template'];
      if (type === 'x-twikki') {
        output = renderMarkdown(renderTWikki({text: input, title}));
      } else if (markdownTypes.includes(type)) {
        output = renderMarkdown(input);
      } else if (codeTypes.includes(type)) {
        output = `<pre><code>${tw.core.common.escapeHtml(input)}</code></pre>`;
      } else if (type === 'html') {
        output = input;
      } else {
        output = `<pre>${tw.core.common.escapeHtml(input)}</pre>`;
      }
    }
    return tw.events.filter('renderer.post', output, {tiddler});
  }
  function makeTiddlerTagLinks(tags) {
    return tags.map(tagPickerHtml).join('');
  }
  // A single tag rendered as a picker (see PickerPlugin): clicking it lists every
  // tiddler carrying that tag (built lazily from data-source="tag"); picking one
  // opens it. Used by the tag row at the bottom of notes and the <<Tag>> macro.
  function tagPickerHtml(tag) {
    if (!tag) return '';
    let label = tw.core.common.escapeHtml(tag);
    let arg = label.replace(/"/g, '&quot;');
    return (
      `<span class="picker tag-picker" data-event="tiddler.show" data-source="tag" data-source-arg="${arg}">` +
      `  <button class="picker-trigger pck-pill">${label}</button>` +
      '  <span class="picker-menu" hidden></span>' +
      '</span>'
    );
  }

  /* DOM inclusion attributes */
  function tiddlerSpanInclude(el) {
    let title = el.getAttribute('tiddler-include');
    try {
      let tiddler = tw.core.tiddlers.getTiddler(title);
      if (!tiddler) throw new Error(`Unknown tiddler '${title}' to include!`);
      // Render and convert paragraphs to divs for easier layouting
      el.innerHTML = makeTiddlerText(tiddler).replace(/<(\/)?p>/g, '<$1div>');
      if (el.firstElementChild.tagName === 'P') el.innerHTML = el.firstElementChild.innerHTML;
    } catch (e) {
      el.innerHTML = `<span class="error">ERROR: Include "${title}" Failed: ${e.message}</span>`;
      console.error(`tiddlerSpanInclude "${title}" Failed: ${e.message}`, e.stack);
    }
    tw.events.subscribe(
      'tiddler.refresh',
      t => {
        if (t === title) {
          tiddlerSpanInclude(el);
        }
      },
      'handle.tiddler.refresh.' + title,
    );
  }
  function macroInclude(el) {
    let macroName = el.getAttribute('macro');
    let macroParams = el.getAttribute('params');
    try {
      let params = tw.core.params.parseParams(macroParams);
      let macroFunction;
      let err;
      try {
        macroFunction = eval(`tw.macros.${macroName}`);
      } catch (e) {
        err = e;
      }
      if (!macroFunction)
        try {
          macroName = `core.${macroName}`;
          macroFunction = eval(`tw.macros.${macroName}`);
        } catch (e) {
          err = e;
        }
      if (!macroFunction) throw new Error(err);
      let result = Array.isArray(macroParams) ? macroFunction(...params) : macroFunction(params);
      el.innerHTML = result;
    } catch (e) {
      el.innerHTML = `<span class="error">ERROR: Include "${macroName}" Failed: ${e.message}</span>`;
      console.error(`tiddlerSpanInclude "${macroName}" Failed: ${e.message}`, e.stack);
    }
  }

  /* Glue / fallback */
  // Markdown rendering is pluggable: whoever subscribes to the 'markdown.render'
  // event provides the renderer ($BaseMarkdownPlugin ships markdown-it; a user
  // package can replace it via tw.events.override('markdown.render', fn)).
  // With no renderer installed (e.g. ?safemode) we fall back to plain text.
  function renderMarkdown(text) {
    const results = tw.events.send('markdown.render', text);
    if (results?.length > 1 && !renderMarkdown.warned) {
      console.warn(
        `${results.length} 'markdown.render' handlers subscribed (first one wins) — replacements should use tw.events.override()!`,
      );
      renderMarkdown.warned = true;
    }
    return results?.[0] ?? renderPlainText(text);
  }
  function renderPlainText(text) {
    return String(text ?? '')
      .split(/\n{2,}/)
      .map(p => `<p>${tw.core.common.escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
      .join('');
  }
});
