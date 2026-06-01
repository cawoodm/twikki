/**
 * Sections
 * A foundational, tiddler-wide feature (independent of the plugin layer):
 * any tiddler's `.text` can expose addressable sections so that
 *   - `[[Title/Section]]` links/includes render only that section, and
 *   - `getTiddlerTextRaw('Title/Section')` (in code or a theme's list) returns
 *     only that section's text — e.g. a packed theme's CSS.
 *
 * Grammar:
 *   - A `.text` is an optional preamble (everything before the first `# `)
 *     followed by zero or more sections.
 *   - A section is a `# Name` heading plus the lines up to the next `# ` heading.
 *     A section is a mini-tiddler: optional leading `key: value` metadata lines
 *     (parsed exactly like a tiddler source file — `tags:` is comma-split,
 *     true/false coerced) followed by a body.
 *   - `#`-detection tracks ``` fence state, so a `#`-line inside a fenced block
 *     is never a section boundary.
 *   - If the body is exactly one fenced ```lang block, the fence is stripped and
 *     the type comes from the info-string (fenceToType). Otherwise the body is
 *     kept raw; type falls back to an explicit `type:` meta line or null (the
 *     caller then substitutes the parent tiddler's type).
 *
 * Pure and DOM-free so it can be unit-tested by eval'ing this module with a stub
 * `tw` and reading `.exports` (mirrors how the runtime itself loads modules).
 */
(function() {

  // Meta
  const name = 'core.sections';
  const version = '0.0.1';

  // Fence info-string → tiddler type. Unknown info-strings are used verbatim.
  const FENCE_TYPES = {
    js: 'script/js',
    javascript: 'script/js',
    css: 'css',
    json: 'json',
    html: 'html/template',
    md: 'markdown',
    markdown: 'markdown',
    'x-twikki': 'x-twikki',
    keyval: 'keyval',
    list: 'list',
    table: 'table',
  };

  // Exports
  const exports = {parseSections, getSection, fenceToType};

  const run = () => {};

  return {name, version, exports, run};

  function fenceToType(info) {
    let key = String(info || '').trim().toLowerCase();
    if (!key) return null; // bare ``` fence → inherit parent type
    return FENCE_TYPES[key] || key;
  }

  // text → {preamble, order:[names], sections:{lowerName:{name,type,text}}}
  function parseSections(text) {
    const lines = String(text || '').split('\n');
    const preamble = [];
    const order = [];
    const sections = {};
    let current = null; // {name, lines:[]}
    let inFence = false;

    for (const line of lines) {
      const isFence = /^```/.test(line);
      if (!inFence && !isFence) {
        const m = /^# (.+)$/.exec(line);
        if (m) {
          if (current) commit(current);
          current = {name: m[1].trim(), lines: []};
          continue;
        }
      }
      if (isFence) inFence = !inFence;
      (current ? current.lines : preamble).push(line);
    }
    if (current) commit(current);

    return {preamble: trimBlank(preamble).join('\n'), order, sections};

    function commit(sec) {
      const key = sec.name.toLowerCase();
      if (sections[key]) console.warn(`core.sections: duplicate section '${sec.name}' (last wins)`);
      else order.push(sec.name);
      sections[key] = parseSection(sec.name, sec.lines);
    }
  }

  // text, name → {name,tags,type,text,...meta} | null  (case-insensitive match)
  function getSection(text, sectionName) {
    if (!sectionName) return null;
    const parsed = parseSections(text);
    return parsed.sections[String(sectionName).toLowerCase()] || null;
  }

  // A section is a mini-tiddler: optional leading `key: value` meta lines, then a
  // body. A body that is a single fenced block becomes typed (fence stripped);
  // otherwise type falls back to an explicit `type:` meta or null (inherit parent).
  function parseSection(name, lines) {
    let tags = [];
    const meta = {};
    let i = 0;
    while (i < lines.length && lines[i].trim() === '') i++; // skip blank lines after heading
    while (i < lines.length && /^[a-z]+: /.test(lines[i])) {
      const line = lines[i];
      const colon = line.indexOf(':');
      const field = line.slice(0, colon).trim();
      let value = line.slice(colon + 1).trim();
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      if (field === 'tags') tags = String(value).split(',').map(v => v.trim()).filter(Boolean);
      else meta[field] = value;
      i++;
    }
    const body = trimBlank(lines.slice(i));
    let type = null;
    let text = body.join('\n');
    if (body.length >= 2) {
      const open = /^```(.*)$/.exec(body[0]);
      const closes = body[body.length - 1].trim() === '```';
      if (open && closes) {
        const inner = body.slice(1, -1);
        if (!inner.some(l => /^```/.test(l))) { // no nested fence → it's a single block
          type = fenceToType(open[1]);
          text = inner.join('\n');
        }
      }
    }
    if (!type && meta.type) type = meta.type;
    delete meta.type;
    return {name, tags, ...meta, type, text};
  }

  function trimBlank(lines) {
    let start = 0;
    let end = lines.length;
    while (start < end && lines[start].trim() === '') start++;
    while (end > start && lines[end - 1].trim() === '') end--;
    return lines.slice(start, end);
  }

});
