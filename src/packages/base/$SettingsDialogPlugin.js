/**
 * ## Description
 * Renders an editable FORM in place of the raw JSON whenever the
 * `$GeneralSettings` tiddler is displayed. The object maps to the UI:
 *   - each top-level key whose value is an object  → a TAB
 *   - each child object inside a tab               → a SECTION
 *   - each leaf value                              → a FORM FIELD
 * Top-level scalar values (and a tab's own scalar children) are gathered into
 * an implicit "General" tab/section. The normal raw-JSON editor (the title-bar
 * Edit button) is untouched — saving from it re-renders the form.
 *
 * Field controls and help text are driven by an OPTIONAL descriptor stored in a
 * companion key suffixed with `~`. e.g. alongside `"accessToken": "..."` add
 *   "accessToken~": "GitHub PAT (secret, max:100)"
 * Grammar:  Human description (type, max:N, options:A|B|C)
 *   type ∈ string | text | number | boolean | date | secret | option | selection
 *   max     → maxlength (string/text/secret) or max attribute (number)
 *   options → choices for `option` (radios, single value) / `selection`
 *             (checkboxes, array value)
 * With no descriptor the control is inferred from the value type; objects/arrays
 * fall back to a JSON textarea. `~` keys are hidden from the form and preserved
 * on save, so existing readers (GistBackup, Synch, …) keep reading raw scalars.
 *
 * Interception is via `tiddler.element.created` (fires for show / re-render /
 * preview, BEFORE DOM insertion → no flash of raw JSON). The handler is a named
 * function so re-evaluating this code tiddler does not register duplicates.
 */
/**
 * ## Data
 * ```json
 * {
 *   "version": 1.0.0
 * }
 * ```
 */
// ## Code
// ```javascript
(function() {

  const TIDDLER = '$GeneralSettings';
  const META = '~'; // companion descriptor key suffix
  const TYPES = ['string', 'text', 'number', 'boolean', 'date', 'secret', 'option', 'selection'];

  tw.events.subscribe('tiddler.element.created', settingsDialogOnElementCreated);

  function settingsDialogOnElementCreated({title, newElement}) {
    if (title !== TIDDLER) return;
    const textDiv = newElement.querySelector('.text');
    if (!textDiv || textDiv.querySelector('.settings-form')) return; // guard double-transform

    let settings;
    try {
      settings = JSON.parse(tw.run.getTiddlerTextRaw(TIDDLER));
    } catch (e) {
      // Invalid JSON: leave the raw <pre> in place so it can be fixed via the
      // Edit button, and prepend a small non-destructive notice.
      if (!textDiv.querySelector('.settings-error'))
        textDiv.insertAdjacentHTML('afterbegin',
          '<div class="settings-error">Settings form unavailable: invalid JSON. Use Edit to fix.</div>');
      return;
    }
    if (!isPlainObject(settings)) return;

    const formHtml = buildForm(settings);
    if (!formHtml) return; // nothing renderable → leave raw view
    textDiv.innerHTML = formHtml;
    wireForm(textDiv);
  }

  /* ---------- form construction ---------- */

  function buildForm(settings) {
    const keys = ownKeys(settings);
    const scalarRoot = keys.filter(k => !isSectionLike(settings, settings, k));
    const objectRoot = keys.filter(k => isSectionLike(settings, settings, k));

    const tabs = [];
    if (scalarRoot.length)
      tabs.push({id: '__general__', label: 'General', body: renderSection(null, settings, settings, '', scalarRoot)});
    objectRoot.forEach(k =>
      tabs.push({id: k, label: humanize(k), body: renderTabBody(settings[k], k)}));

    if (!tabs.length) return '';

    const strip = '<div class="settings-tabs">' + tabs.map((t, i) =>
      `<button type="button" class="settings-tab${i === 0 ? ' settings-tab-active' : ''}" data-tab="${esc(t.id)}">${esc(t.label)}</button>`,
    ).join('') + '</div>';

    const panels = tabs.map((t, i) =>
      `<div class="settings-tab-panel${i === 0 ? '' : ' is-hidden'}" data-tab="${esc(t.id)}">${t.body}</div>`,
    ).join('');

    return `<div class="settings-form">${strip}${panels}</div>`;
  }

  // A tab's body: scalar children → an implicit (title-less) section; each child
  // object → its own section. Sections never nest further (deeper objects become
  // JSON-textarea fields).
  function renderTabBody(node, prefix) {
    const keys = ownKeys(node);
    const sectionKeys = keys.filter(k => isSectionLike(node, node, k));
    const fieldKeys = keys.filter(k => !sectionKeys.includes(k));
    let html = '';
    if (fieldKeys.length) html += renderSection(null, node, node, prefix, fieldKeys);
    sectionKeys.forEach(k =>
      html += renderSection(humanize(k), node[k], node[k], `${prefix}.${k}`, ownKeys(node[k])));
    return html;
  }

  function renderSection(title, obj, descriptorObj, prefix, keys) {
    const fields = keys.map(k => {
      const path = prefix ? `${prefix}.${k}` : k;
      return renderField(k, obj[k], descriptorObj[k + META], path);
    }).join('');
    const header = title ? `<div class="settings-section-title">${esc(title)}</div>` : '';
    return `<div class="settings-section">${header}${fields}</div>`;
  }

  function renderField(key, value, descriptor, path) {
    const meta = parseDescriptor(descriptor);
    const type = meta.type || inferType(value);
    const help = meta.description ? `<div class="settings-field-help">${esc(meta.description)}</div>` : '';
    return `<div class="settings-field">
      <label class="settings-field-label">${esc(humanize(key))}${help}</label>
      <div class="settings-field-control">${renderControl(type, value, meta, path)}</div>
    </div>`;
  }

  function renderControl(type, value, meta, path) {
    const p = esc(path);
    switch (type) {
      case 'boolean':
        return `<input type="checkbox" class="settings-field-input" data-path="${p}" data-type="boolean"${value ? ' checked' : ''}>`;
      case 'number':
        return `<input type="number" class="settings-field-input" data-path="${p}" data-type="number" value="${esc(value ?? '')}"${meta.max ? ` max="${esc(meta.max)}"` : ''}>`;
      case 'date':
        return `<input type="date" class="settings-field-input" data-path="${p}" data-type="date" value="${esc(value ?? '')}">`;
      case 'secret':
        return `<input type="password" class="settings-field-input" data-path="${p}" data-type="string" value="${esc(value ?? '')}"${meta.max ? ` maxlength="${esc(meta.max)}"` : ''} autocomplete="off">`;
      case 'text':
        return `<textarea class="settings-field-input settings-text" data-path="${p}" data-type="text"${meta.max ? ` maxlength="${esc(meta.max)}"` : ''}>${esc(value ?? '')}</textarea>`;
      case 'option':
        return `<div class="settings-options">` + (meta.options || []).map(o =>
          `<label class="settings-option"><input type="radio" name="${p}" data-path="${p}" data-type="option" value="${esc(o)}"${value === o ? ' checked' : ''}> ${esc(o)}</label>`,
        ).join('') + `</div>`;
      case 'selection': {
        const arr = Array.isArray(value) ? value : [];
        return `<div class="settings-options">` + (meta.options || []).map(o =>
          `<label class="settings-option"><input type="checkbox" data-path="${p}" data-type="selection" value="${esc(o)}"${arr.includes(o) ? ' checked' : ''}> ${esc(o)}</label>`,
        ).join('') + `</div>`;
      }
      case 'json':
        return `<textarea class="settings-json" data-path="${p}" data-type="json">${esc(JSON.stringify(value, null, 2))}</textarea>`;
      case 'string':
      default:
        return `<input type="text" class="settings-field-input" data-path="${p}" data-type="string" value="${esc(value ?? '')}"${meta.max ? ` maxlength="${esc(meta.max)}"` : ''}>`;
    }
  }

  /* ---------- event wiring ---------- */

  function wireForm(textDiv) {
    const formRoot = textDiv.querySelector('.settings-form');
    if (!formRoot) return;
    formRoot.addEventListener('change', e => onChange(e, formRoot));
    formRoot.addEventListener('click', e => onTabClick(e, formRoot));
    // Keep the raw-JSON editor (document-level dblclick) from popping up while
    // interacting with the form; the title-bar Edit button still opens it.
    formRoot.addEventListener('dblclick', e => e.stopPropagation());
  }

  function onTabClick(e, formRoot) {
    const tab = e.target.closest('.settings-tab');
    if (!tab || !formRoot.contains(tab)) return;
    const name = tab.dataset.tab;
    formRoot.querySelectorAll('.settings-tab').forEach(t =>
      t.classList.toggle('settings-tab-active', t === tab));
    formRoot.querySelectorAll('.settings-tab-panel').forEach(p =>
      p.classList.toggle('is-hidden', p.dataset.tab !== name));
  }

  function onChange(e, formRoot) {
    const el = e.target;
    const path = el.dataset.path;
    if (!path) return;
    let value;
    switch (el.dataset.type) {
      case 'boolean':
        value = el.checked; break;
      case 'number':
        if (el.value === '') {value = null; break;}
        value = Number(el.value);
        if (Number.isNaN(value)) return tw.ui.notify(`'${el.value}' is not a number`, 'E');
        break;
      case 'json':
        try {value = JSON.parse(el.value);}
        catch (err) {return tw.ui.notify(`Invalid JSON for '${path}'`, 'E');}
        break;
      case 'option':
        value = el.value; break; // the changed radio is the selected one
      case 'selection':
        value = [...formRoot.querySelectorAll(`input[type="checkbox"][data-path="${cssEsc(path)}"]`)]
          .filter(b => b.checked).map(b => b.value);
        break;
      default: // string, text, secret, date
        value = el.value;
    }
    writeSetting(path, value);
  }

  function writeSetting(path, value) {
    const t = tw.run.getTiddler(TIDDLER);
    if (!t) return;
    let parsed;
    try {parsed = JSON.parse(t.text || '{}');}
    catch (e) {return tw.ui.notify('Settings JSON is invalid; use Edit to fix it', 'E');}
    setByPath(parsed, path, value);
    t.text = JSON.stringify(parsed, null, 2);
    delete t.doNotSave;
    tw.run.updateTiddlerHard(TIDDLER, t); // silent — no event, no re-render/flicker
    tw.events.send('save.silent');        // persist to localStorage
  }

  /* ---------- helpers ---------- */

  function ownKeys(obj) {
    return Object.keys(obj).filter(k => !k.endsWith(META));
  }

  // A key becomes a SECTION (or, at the root, a TAB) when its value is a plain
  // object AND it has no explicit descriptor (a descriptor forces it to a field,
  // e.g. a JSON-edited subtree).
  function isSectionLike(node, descriptorObj, k) {
    return isPlainObject(node[k]) && typeof descriptorObj[k + META] !== 'string';
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function inferType(value) {
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (value !== null && typeof value === 'object') return 'json'; // object or array
    return 'string';
  }

  // Descriptor grammar inside the trailing (...):  comma-separated parts, each of
  //   <type>                         bare type token,            e.g. `secret`
  //   <type>:<a>,<b>  / <type>:<a>|<b>  type + inline options,   e.g. `option:tabs,river`
  //   options:<a>|<b>|<c>            explicit option list
  //   max:<N>                        length/value bound
  // Options may be separated by `|` or `,`. The list itself is comma-split first,
  // so an inline `type:a,b` is reassembled before parsing.
  function parseDescriptor(str) {
    if (!str || typeof str !== 'string') return {};
    const m = str.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    if (!m) return {description: str.trim()};
    const meta = {description: m[1].trim()};
    // Re-join inline option lists: `option:tabs,river` was split into two parts.
    const parts = mergeParts(m[2].split(',').map(s => s.trim()).filter(Boolean));
    parts.forEach(part => {
      const kv = part.match(/^(\w+)\s*:\s*(.*)$/);
      if (kv) {
        const k = kv[1].toLowerCase();
        if (k === 'max') meta.max = kv[2].trim();
        else if (k === 'options') meta.options = splitOptions(kv[2]);
        else if (TYPES.includes(k)) {meta.type = k; meta.options = splitOptions(kv[2]);}
      } else if (TYPES.includes(part.toLowerCase())) {
        meta.type = part.toLowerCase();
      }
    });
    return meta;
  }

  // After splitting on ',', stitch a bare continuation back onto a preceding
  // `key:value` part so `option:tabs,river` survives as one `option:tabs,river`.
  function mergeParts(raw) {
    const out = [];
    raw.forEach(p => {
      if (!/:/.test(p) && out.length && /:/.test(out[out.length - 1])) out[out.length - 1] += ',' + p;
      else out.push(p);
    });
    return out;
  }

  function splitOptions(v) {
    return v.split(/[|,]/).map(o => o.trim()).filter(Boolean);
  }

  function setByPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!isPlainObject(cur[parts[i]])) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function humanize(key) {
    return String(key)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
  }

  function esc(v) {
    return tw.core.common.escapeHtml(String(v ?? ''));
  }

  function cssEsc(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
  }

})();
