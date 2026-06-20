/**
 * Tiddlers
 * Listing, getting, and changing tiddlers — anything that takes a tiddler or a
 * title and reads/filters/mutates the store lives here: CRUD, show/hide,
 * reference resolution (`Title::Section` — the text slicing itself is
 * core.sections), text/data accessors, predicates and validation, and
 * code-block selection/execution policy.
 * Merges the tiddler action API into `tw.run` and the legacy predicate
 * aliases into `tw.util` at eval time.
 */
(function (tw) {
  const name = 'core.tiddlers';
  const version = '0.1.0';
  const platform = '0.27.0'; // built for platform ^0.27.0

  // The section delimiter: a reference may address into a tiddler's sections as
  // `Title::Section`. ':' is NOT a valid title character, so the '::' in a
  // reference is unambiguous (see splitSectionRef — the single place that knows
  // the delimiter width).
  const SECTION_DELIM = '::';
  const reTiddlerTitle = /[a-z0-9_\-\.\(\)\s\$\ud83c\ud000-\udfff\ud83d\ud000-\udfff\ud83e\ud000-\udfff]+/gi;
  const reTiddlerTitleComplete = RegExp.compose(/^reTiddlerTitle$/gi, {reTiddlerTitle});
  const reInclusionParams = /\##([\$0-9a-z]+)\#([^\#]+)?#/gi;

  // Exports
  const exports = {
    SECTION_DELIM,
    addTiddler,
    addTiddlerHard,
    updateTiddler,
    updateTiddlerHard,
    updateTiddlerSilent,
    updateTiddlerText,
    deleteTiddler,
    getTiddler,
    tiddlerExists,
    getTiddlerElement,
    tiddlerList,
    getTiddlersByPackage,
    getTiddlersByTag,
    showTiddler,
    scrollToTiddler,
    hideTiddler,
    closeTiddler,
    showAllTiddlers,
    closeAllTiddlers,
    showTiddlerList,
    replaceInArray,
    upsertInArray,
    removeFromArray,
    resolveRef,
    getSection,
    sectionTiddler,
    splitSectionRef,
    getTiddlerTextRaw,
    getTiddlerTextReplaced,
    getTiddlerTextLines,
    getTiddlerList,
    getTiddlerTextList,
    getKeyValuesArray,
    getKeyValuesObject,
    getJSONObject,
    titleIs,
    titleMatch,
    tagMatch,
    isPackageList,
    isCoreTiddler,
    tiddlerIsATemplate,
    tiddlerIsValid,
    tiddlerValidation,
    validateTiddlerText,
    registerValidator,
    emptyTiddler,
    nonExistentTiddler,
    tiddlerCodeBlocks,
    isActiveCodeTiddler,
    isRunnableTiddler,
    runTiddlerCode,
    runCoreTiddlers,
    tiddlerToggleTag,
  };

  // The tiddler action API (tw.run) and the legacy predicate aliases (tw.util).
  Object.assign(tw.run, {
    updateTiddler,
    updateTiddlerHard,
    updateTiddlerSilent,
    addTiddler,
    addTiddlerHard,
    deleteTiddler,
    getTiddler,
    getSection,
    getTiddlerList,
    getTiddlersByTag,
    getTiddlersByPackage,
    getTiddlerTextList,
    getTiddlerTextRaw,
    getJSONObject,
    getKeyValuesArray,
    getKeyValuesObject,
    getTiddlerElement,
    tiddlerToggleTag,
    showTiddlerList,
    showTiddler,
    showAllTiddlers,
    closeAllTiddlers,
    closeTiddler,
    hideTiddler,
    tiddler: {
      getJSONObject,
      updateText: updateTiddlerText,
    },
  });
  tw.util = {tagMatch, titleMatch, titleIs, tiddlerValidation, tiddlerExists};

  // Stackable tiddler-save validators. validateTiddlerText() iterates this list
  // and rewraps any throw as `"<name>: <message>"` so the formDone UX can show
  // which validator complained. Base scripts register via tw.extensions.
  const validators = [];
  Object.assign(tw.extensions, {registerValidator});

  return {name, version, platform, exports};

  /* CRUD */
  function addTiddler(newTiddler, userEdit, forceSave) {
    if (userEdit) {
      const existingTiddler = getTiddler(newTiddler.title, false);
      if (existingTiddler) throw new Error(`Unable to add (overwrite) existent tiddler '${newTiddler.title}'!`);
      if (!newTiddler.created) newTiddler.created = newTiddler.updated || new Date(); // $Shadow tiddlers need this when saved
      delete newTiddler.doesNotExist;
      delete newTiddler.isRawShadow;
      if (!forceSave) validateTiddlerText(newTiddler);
    }
    addTiddlerHard(newTiddler);
  }
  function addTiddlerHard(newTiddler) {
    upsertInArray(tw.tiddlers.all, titleIs(newTiddler.title), newTiddler);
    // No need to add to top of story, handled by event => renderNewTiddler
  }

  function updateTiddler(currentTitle, newTiddler, userEdit, forceSave) {
    const existingTiddler = getTiddler(currentTitle, true);
    if (!existingTiddler) throw new Error(`Unable to update non-existent tiddler '${currentTitle}'!`);
    if (newTiddler.title !== currentTitle && getTiddler(newTiddler.title)) throw new Error(`Cannot overwrite existing tiddler '${newTiddler.title}!`);
    if (!forceSave && userEdit && existingTiddler.tags.includes('$NoEdit')) throw new Error(`Readonly tiddler '${currentTitle}' cannot be updated!`);
    if (userEdit) delete existingTiddler.doNotSave;
    if (!forceSave && userEdit) validateTiddlerText(newTiddler);
    delete newTiddler.isRawShadow;
    updateTiddlerHard(currentTitle, newTiddler);
    // Move to top of story
    if (userEdit) replaceInArray(tw.tiddlers.visible, title => title === currentTitle, newTiddler.title);
    tw.events.send('tiddler.modified', newTiddler.title);
  }
  function updateTiddlerHard(currentTitle, newTiddler) {
    upsertInArray(tw.tiddlers.all, titleIs(currentTitle), newTiddler);
  }
  // Like updateTiddlerHard (raw upsert: no validation, no $NoEdit guard, no story
  // reorder, no rerender) but DOES flag the store dirty, so the unsaved-changes
  // indicator reflects the edit and it persists on the next save. For programmatic
  // metadata edits (e.g. toggling a plugin's $CodeDisabled tag).
  function updateTiddlerSilent(currentTitle, newTiddler) {
    updateTiddlerHard(currentTitle, newTiddler);
    tw.run.setDirty?.(true); // setDirty lives in core.ui (loads later); call lazily
  }
  function updateTiddlerText(title, text) {
    let t = getTiddler(title);
    updateTiddler(title, {...t, text});
  }

  function deleteTiddler(title, automation) {
    let t = getTiddler(title);
    if (!automation && !confirm('Sure you want to delete me?')) return;
    const shadowTiddler = tw.shadowTiddlers.find(titleIs(title));
    if (shadowTiddler && !automation && !confirm('Deleting a shadow tiddler will simply restore the default content OK?')) return;
    if (!t) return hideTiddler(title);
    if (t.tags.includes('$NoEdit') && !automation && !confirm('This tiddler is marked as read-only. Deleting it may cause issues. Really delete?')) return;
    let tiddler = removeFromArray(tw.tiddlers.all, titleIs(title))?.[0];
    if (shadowTiddler) addTiddler({...shadowTiddler});
    if (shadowTiddler && !automation) tw.core.render.rerenderTiddler(title);
    else hideTiddler(title);
    tiddler.updated = new Date();
    // If we trash it without the doNotSave flag then a synch may delete it remotely
    // delete tiddler.doNotSave;
    tw.tiddlers.trashed.push(tiddler);
    if (automation) {
      tw.events.send('tiddler.removed', title);
      return;
    } else tw.events.send('tiddler.deleted', title);
    tw.core.store.autoSave();
  }

  function tiddlerToggleTag(title, tag) {
    let t = getTiddler(title);
    if (!t.tags.includes(tag)) upsertInArray(t.tags, tg => tg === tag, tag);
    else removeFromArray(t.tags, tg => tg === tag);
    updateTiddler(title, t, true);
    tw.events.send('tiddler.refresh', t.title);
  }

  /* Get / exists */
  function getTiddler(title, includeRawShadow = true) {
    // TODO: This is case-senstive and allows duplicates like AAA + aaa
    let result = tw.tiddlers.all.find(titleIs(title));
    if (includeRawShadow === false && result?.isRawShadow === true) return undefined;
    return result;
  }
  function tiddlerExists(title, includeRawShadow) {
    return !!getTiddler(title, includeRawShadow);
  }
  function getTiddlerElement(title) {
    let id = tw.core.common.hash(title);
    return tw.core.dom.divVisibleTiddlers.querySelector(`*[data-tiddler-id="${id}"]`);
  }
  function tiddlerList({title, tag, pck} = {}) {
    return tw.tiddlers.all
      .filter(titleMatch(title))
      .filter(tagMatch(tag))
      .filter(t => !pck || t.package === pck);
  }
  function getTiddlersByPackage(pck) {
    return tw.tiddlers.all.filter(t => t.package === pck);
  }
  function getTiddlersByTag(tag) {
    return tw.tiddlers.all.filter(t => t.tags.includes(tag));
  }

  /* Show / hide */
  function showTiddler(title) {
    if (getTiddlerElement(title)) {
      tw.events.send('tiddler.refocus', title); // already open: let the tabs layer focus it
      return scrollToTiddler(title);
    }
    let tiddler = getTiddler(title) || sectionTiddler(title);
    if (!tiddler) tiddler = nonExistentTiddler(title);
    let newElement = tw.core.render.createTiddlerElement(tiddler);
    tw.core.dom.divVisibleTiddlers.insertAdjacentElement('afterbegin', newElement);
    if (tw.tiddlers.visible.indexOf(tiddler.title) === -1) tw.tiddlers.visible.push(tiddler.title);
    tw.events.send('tiddler.rendered', {tiddler, newElement});
    tw.core.store.saveVisible();
  }
  function scrollToTiddler(title) {
    getTiddlerElement(title)?.scrollIntoView({behavior: 'smooth', block: 'start'});
  }
  function hideTiddler(title) {
    let visibleTiddlerElement = getTiddlerElement(title);
    if (visibleTiddlerElement) visibleTiddlerElement.outerHTML = '';
    tw.tiddlers.visible = tw.tiddlers.visible.filter(t => t !== title);
    tw.core.store.saveVisible();
    tw.events.send('story.changed', title);
  }
  function closeTiddler(title) {
    hideTiddler(title);
    tw.core.render.renderAllTiddlers();
  }
  function showAllTiddlers({tag, title, pck} = {}) {
    if (!title) title = '!^\\$';
    tiddlerList({title, tag, pck})
      .map(t => t.title)
      .forEach(showTiddler);
    tw.core.render.renderAllTiddlers();
  }
  function closeAllTiddlers({tag = '', title = '', pck} = {}) {
    if (!title) title = '!^\\$';
    tiddlerList({title, tag, pck})
      .map(t => t.title)
      .forEach(hideTiddler);
  }
  function showTiddlerList(list, title = 'unknown') {
    return tw.lib.markdown(tw.core.render.renderTWikki({text: list.map(t => `* [[${t.title}]]`).join('\n'), title}));
  }

  /* Array helpers */
  function replaceInArray(array, test, newItem) {
    let index = array.findIndex(test);
    if (index >= 0) array[index] = newItem;
  }
  function upsertInArray(array, test, newItem) {
    let index = array.findIndex(test);
    if (index >= 0) array[index] = newItem;
    else array.push(newItem);
  }
  function removeFromArray(array, test) {
    let index = array.findIndex(test);
    if (index >= 0) return array.splice(index, 1);
  }

  /* Reference resolution (title → tiddler; text slicing is core.sections) */

  // Split a `Title::Section` reference into {base, section}, or null when the ref
  // holds no section delimiter. The single place that knows the delimiter width.
  function splitSectionRef(ref) {
    if (typeof ref !== 'string') return null;
    let i = ref.indexOf(SECTION_DELIM);
    if (i < 0) return null;
    return {base: ref.slice(0, i), section: ref.slice(i + SECTION_DELIM.length)};
  }
  // For a `Title::Section` reference, synthesize a display-only tiddler holding
  // just that section (rendered by its own type via makeTiddlerText). Never added
  // to tw.tiddlers.all — the parent stays the single store entry.
  function sectionTiddler(title) {
    let ref = splitSectionRef(title);
    if (!ref) return null;
    let base = getTiddler(ref.base);
    if (!base) return null;
    let sec = tw.core.sections.getSection(base.text, ref.section);
    if (!sec) return null;
    // isSection drives the read-only UI: no delete, and edit redirects to the parent.
    return {
      title,
      text: sec.text,
      type: sec.type || base.type,
      tags: [],
      doNotSave: true,
      isSection: true,
    };
  }
  // Resolve a tiddler reference to {text, type}, honouring `Title::Section`
  // addressing into a tiddler's sections. Falls back to whole-tiddler text when
  // the `::`-form does not resolve, so it is a strict superset of getTiddler().
  function resolveRef(ref) {
    let parts = splitSectionRef(ref);
    if (parts) {
      let base = getTiddler(parts.base);
      if (base) {
        let sec = tw.core.sections.getSection(base.text, parts.section);
        if (sec) return {text: sec.text, type: sec.type || base.type};
      }
    }
    let t = getTiddler(ref);
    return {text: t?.text || '', type: t?.type};
  }
  // {name,type,text} | null — a section of a tiddler, with type filled from the
  // parent when the section is not a fenced (typed) block.
  function getSection(title, sectionName) {
    let base = getTiddler(title);
    if (!base) return null;
    let sec = tw.core.sections.getSection(base.text, sectionName);
    return sec ? {...sec, type: sec.type || base.type} : null;
  }

  /* Text accessors (take a title) */
  function getTiddlerTextRaw(title) {
    return resolveRef(title).text;
  }
  // 'this #$1# and that #$2#'[foo, bar] => 'this foo and that bar'
  function getTiddlerTextReplaced(title, params) {
    let res = resolveRef(title).text;
    Array.from(res.matchAll(reInclusionParams) || []).forEach(m => {
      let all = m[0];
      let key = m[1];
      let def = m[2] || '';
      res = res.replace(all, params[key] || def);
    });
    return res;
  }
  function getTiddlerTextLines(title) {
    return getTiddlerTextRaw(title).split('\n');
  }
  function getTiddlerList(title) {
    let inFence = false;
    return getTiddlerTextLines(title)
      .filter(l => {
        // Skip lines inside ``` fences (e.g. a `* { }` CSS selector is not a list item)
        if (/^```/.test(l)) {
          inFence = !inFence;
          return false;
        }
        return !inFence;
      })
      .filter(l => l.match(/^[-*] /)) // Only bullet-points
      .map(l => l.replace(/^[-*] /, '')) // Remove bullet-point prefix
      .map(l => l.replace(/[\[\]]/g, '')) // Remove possible [[links]]
      .filter(tw.core.common.notEmpty);
  }
  function getTiddlerTextList(title) {
    return getTiddlerTextLines(title)
      .map(l => l.replace(/^[-*] /, ''))
      .filter(tw.core.common.notEmpty);
  }

  /* Text → data (take a title) */
  function getKeyValuesArray(title) {
    return getTiddlerTextList(title)
      .map(t => {
        let s = t.indexOf(':');
        if (s < 0) return;
        let key = t.substring(0, s).trim();
        let value = t.substring(s + 1).trim();
        return {key, value};
      })
      .filter(tw.core.common.notEmpty);
  }
  function getKeyValuesObject(title) {
    let result = {};
    getKeyValuesArray(title).forEach(i => {
      result[i.key] = i.value;
    });
    return result;
  }
  function getJSONObject(title) {
    return JSON.parse(getTiddlerTextRaw(title));
  }

  /* Predicates & validation */
  function titleIs(title) {
    return t => t.title === title;
  }
  function titleMatch(title) {
    if (!title || title === '*') return () => true;
    const negate = title.match(/^!/);
    let re = new RegExp(negate ? title.substr(1) : title);
    return t => (negate ? !t.title.match(re) : t.title.match(re));
  }
  function tagMatch(tag) {
    if (!tag || tag === '*') return () => true;
    let re = new RegExp(tag.match(/^!/) ? tag.substr(1) : tag);
    return t => (tag.match(/^!/) ? !t.tags.find(tag => tag.match(re)) : t.tags.find(tag => tag.match(re)));
  }
  function isPackageList(t) {
    return ['$CorePackages', '$ExtensionPackages'].includes(t.title);
  }
  function isCoreTiddler(t) {
    return t.package === 'core';
  }
  function tiddlerIsATemplate(t) {
    return t.tags.includes('$Template');
  }
  function tiddlerIsValid(t) {
    let msg = tiddlerValidation(t);
    if (msg.length) console.warn('tiddlerValidation', t.title, msg.join('; '));
    return msg.length === 0;
  }
  function tiddlerValidation(t) {
    const msg = [];
    if (!t.title) msg.push('No title!');
    if (!t.title.match(reTiddlerTitleComplete)) msg.push('Invalid title!');
    if (!t.type) msg.push('No type!');
    // Convert old string tags to array
    if (!Array.isArray(t.tags)) msg.push('Invalid tags!');
    t.tags = typeof t.tags === 'string' ? (t.tags.length ? t.tags.split(' ') : []) : t.tags;
    if (!Array.isArray(t.tags)) msg.push('No tags array!');
    if (!t.created) msg.push('No created date!');
    if (!t.updated) msg.push('No updated date!');
    return msg;
  }
  function validateTiddlerText(t) {
    if (t.type === 'json') jsonValidator(t.text);
    tiddlerCodeBlocks(t).forEach(b => tw.run.executeText(b.text, b.title)); // validate by executing (as code tiddlers do)
    for (const v of validators) {
      if (!v.match(t)) continue;
      try {
        v.validate(t);
      } catch (e) {
        throw new Error(`${v.name}: ${e.message}`);
      }
    }
  }
  function registerValidator({name, match, validate}) {
    if (!name || typeof match !== 'function' || typeof validate !== 'function') throw new Error('registerValidator: {name, match, validate} required');
    const i = validators.findIndex(v => v.name === name);
    if (i >= 0)
      validators[i] = {name, match, validate}; // idempotent on soft reload
    else validators.push({name, match, validate});
  }
  function jsonValidator(text) {
    JSON.parse(text);
    return true;
  }
  function emptyTiddler() {
    return {title: '', text: '', type: 'x-twikki', tags: []};
  }
  function nonExistentTiddler(title) {
    let t = emptyTiddler();
    Object.assign(t, {title, text: `The tiddler '${title}' does not exist`, doesNotExist: true});
    return t;
  }

  /* Code-block selection & execution policy */
  // TODO: rename `$CodeDisabled` → `$Disabled`. The tag now gates more than code
  // execution (e.g. $CoreThemeManager skips CSS from $CodeDisabled plugins), so the
  // narrower name no longer fits. Rename in one pass across the platform, packages,
  // and docs; provide a migration for existing stores.
  function isActiveCodeTiddler(t) {
    return ['script/js'].includes(t.type) && !t.tags.includes('$CodeDisabled');
  }
  // The JS to execute for a tiddler: the whole text when it is a script/js
  // tiddler (as today), otherwise each of its `script/js` sections (a ```js /
  // ```javascript fenced section). Sections run exactly like code tiddlers; a
  // `$CodeDisabled` tag (on the tiddler or the section) opts out.
  function tiddlerCodeBlocks(t) {
    if (!t || t.tags?.includes('$CodeDisabled')) return [];
    if (t.type === 'script/js') return [{text: t.text || '', title: t.title}];
    if (!t.tags?.includes('$Plugin') && !t.tags?.includes('$Script')) return []; // multi-section code blocks only run for $Plugin or $Script tiddlers
    if (!t.text || !t.text.includes('# ')) return []; // fast path: no h1 sections
    const parsed = tw.core.sections.parseSections(t.text);
    return parsed.order
      .map(n => parsed.sections[n.toLowerCase()])
      .filter(s => s && isActiveCodeTiddler(s))
      .map(s => ({text: s.text, title: `${t.title}${SECTION_DELIM}${s.name}`}));
  }
  function runTiddlerCode(t) {
    tiddlerCodeBlocks(t).forEach(b => tw.run.executeCodeTiddler(b.text, b.title));
  }
  function isRunnableTiddler(t) {
    return tiddlerCodeBlocks(t).length > 0;
  }
  function runCoreTiddlers() {
    tw.tiddlers.all.filter(isCoreTiddler).forEach(runTiddlerCode);
  }
});
