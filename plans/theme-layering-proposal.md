# Theme Stylesheet Layering — Proposal & Implementation Plan

Restructure how TWikki composes a theme's stylesheets, replacing implicit ordered concatenation with CSS `@layer`-based named layers. Goal: make themes minimal, structurally valid by construction, and incapable of clobbering each other in the wrong order.

---

## 1. Problem

Themes today list stylesheet tiddlers in a `$Theme` tiddler:

```
tags: $Theme

* [[$StyleSheetCore]]
* [[$ThemeBase]]
* [[AuroraStyleSheet]]
```

`$CoreThemeManager` reads the list, concatenates each tiddler's text, and adopts one constructable stylesheet. Two structural issues:

1. **Cascade order is author-enforced.** Every theme has to remember Core → ThemeBase → self, in that order. Forgetting or reordering breaks silently.
2. **Files mix concerns.**
   - `$StyleSheetCore` contains: reset + grid layout + responsive drawer + `:root` token defaults + Settings-form visuals.
   - `$ThemeBase` contains: token-driven component looks, *plus* hardcoded `#fff` and `#c0392b` (error red).
   - Themes can't cleanly override just colours, or just structure, without touching unrelated rules.

Symptoms of this:
- Dark mode required a special-cased `$StyleSheetCoreDark` slotted between Core and ThemeBase.
- Themes that just want a recolour have to duplicate the full `:root` block.

---

## 2. Proposed layer model

Six named layers, cascade order fixed by `@layer` declaration:

| # | Layer        | Contents                                                  | Overridable by themes? |
|---|--------------|-----------------------------------------------------------|------------------------|
| 1 | `reset`      | Browser normalization only (box-sizing, margins, lists)   | No                     |
| 2 | `structure`  | App-shell grid, flex internals, responsive drawer         | Theme layer can win    |
| 3 | `tokens`     | Single `:root { … }` declaring every CSS variable + light defaults | Theme layer overrides  |
| 4 | `components` | All token-driven component styling (sidebar, buttons, dialogs, forms, etc.) | Theme layer can win    |
| 5 | `theme`      | The active theme's contribution — usually only token overrides | —                      |
| 6 | `user`       | `$StyleSheetUser`                                         | Always last            |

Final assembled stylesheet looks like:

```css
@layer reset, structure, tokens, components, theme, user;

@layer reset      { /* $Reset body */ }
@layer structure  { /* $Structure body */ }
@layer tokens     { /* $Tokens body */ }
@layer components { /* $Components body */ }
@layer theme      { /* active theme's body */ }
@layer user       { /* $StyleSheetUser body, if any */ }
```

Cascade is guaranteed by the spec, not by string-concatenation order.

---

## 3. File-by-file changes

### New tiddlers (in `src/modules/core.defaults/`)

| File                  | Tag             | Role                                 |
|-----------------------|-----------------|--------------------------------------|
| `$Reset.css`          | `$LayerReset`   | Pulled from top of current `$StyleSheetCore.css` |
| `$Structure.css`      | `$LayerStructure` | Grid + responsive from `$StyleSheetCore.css` |
| `$Tokens.css`         | `$LayerTokens`  | `:root { … }` block extracted from Core; expanded to cover every variable used anywhere |
| `$Components.css`     | `$LayerComponents` | Renamed `$ThemeBase.css`, with hardcoded colours replaced by tokens; plus the Settings-form rules moved here |

### Deleted / replaced

- `$StyleSheetCore.css` — split into the three files above
- `$ThemeBase.css` — renamed to `$Components.css`
- `$StyleSheetCoreDark.css` — removed (Dark becomes a tokens-only theme)
- `$CoreThemeLight.tid` — body becomes empty or minimal (defaults are already light)
- `$CoreThemeDark.tid` — body becomes a single reference to a `DarkTokens` tiddler

### Theme files (every theme in `src/packages/themes/`)

Each `*StyleSheet.css` splits into:
- `*Tokens.css` — `:root` overrides only (tag `$StyleSheet` — wraps into `theme` layer)
- `*Layout.css` (optional) — component or structure tweaks, for themes that genuinely rearrange (Broadsheet, Nocturne, Kontrast)

The `*Theme.tid` body becomes a short list of these contributions:

```
tags: $Theme

* [[AuroraTokens]]
```

The manager auto-prepends layers 1–4. Theme authors no longer reference Core, ThemeBase, or order anything.

---

## 4. `$CoreThemeManager` changes

Current shape (`themeUpdate`):

```js
let css = getThemeStyleSheets().map(tw.run.getTiddlerTextRaw).join('\n');
tw.theme.stylesheets.custom.replaceSync(css);
```

New shape:

```js
function buildLayeredCss() {
  const layers = {
    reset:      collectByTag('$LayerReset'),
    structure:  collectByTag('$LayerStructure'),
    tokens:     collectByTag('$LayerTokens'),
    components: collectByTag('$LayerComponents'),
    theme:      getThemeStyleSheets().map(tw.run.getTiddlerTextRaw),
    user:       [tw.run.getTiddlerTextRaw('$StyleSheetUser') || ''],
  };

  const header = '@layer reset, structure, tokens, components, theme, user;\n\n';
  const body = Object.entries(layers)
    .map(([name, bodies]) =>
      `@layer ${name} {\n${bodies.filter(Boolean).join('\n')}\n}`
    )
    .join('\n\n');

  return header + body;
}

tw.theme.stylesheets.custom.replaceSync(buildLayeredCss());
```

`collectByTag(tag)` returns the raw text of every tiddler carrying that tag, in deterministic order (alphabetical by title is fine — order within a layer doesn't matter much since intra-layer cascade still works normally).

---

## 5. Compile-plugin / tagging changes

`vite-plugin-tiddler-compile.js` already auto-tags files by extension. Extend the rules so a `.css` file's tag depends on filename prefix or an explicit metadata header:

**Option A (preferred): filename convention.**
- `$Reset.css` → tag `$LayerReset`
- `$Structure.css` → tag `$LayerStructure`
- `$Tokens.css` → tag `$LayerTokens`
- `$Components.css` → tag `$LayerComponents`
- Anything else → existing `$StyleSheet` tag (theme layer)

**Option B: metadata header.** Files start with `tags: $LayerTokens` etc. More verbose, more explicit. Loses zero magic but adds boilerplate.

Going with A means zero changes to theme authors; the layer is implied by what filename you pick. Going with B is what you'd do if you wanted to allow per-package layer files without name collisions.

---

## 6. Built-in theme migration

| Theme       | Current files                            | New files                                          | Notes |
|-------------|------------------------------------------|----------------------------------------------------|-------|
| Aurora      | `AuroraTheme.tid` + `AuroraStyleSheet.css` | `AuroraTheme.tid` + `AuroraTokens.css`             | Tokens-only |
| Manuscript  | `ManuscriptTheme.tid` + `ManuscriptStyleSheet.css` | `ManuscriptTheme.tid` + `ManuscriptTokens.css` | Tokens + webfont `@font-face` |
| Terminal    | `TerminalThemeDark.tid` + `TerminalStyleSheetDark.css` | `TerminalTheme.tid` + `TerminalTokens.css` | Also rename to drop "Dark" (see THEMES.md discrepancy) |
| Bubblegum   | `BubblegumTheme.tid` + `BubblegumStyleSheet.css` | `BubblegumTheme.tid` + `BubblegumTokens.css` | Tokens-only |
| Broadsheet  | `BroadsheetTheme.tid` + `BroadsheetStyleSheet.css` | `BroadsheetTheme.tid` + `BroadsheetTokens.css` + `BroadsheetLayout.css` | Has real structural tweaks |
| Nocturne    | `NocturneThemeDark.tid` + `NocturneStyleSheetDark.css` | `NocturneTheme.tid` + `NocturneTokens.css` + `NocturneLayout.css` | Rename + split |
| Kontrast    | `KontrastTheme.tid` + `KontrastStyleSheet.css` | `KontrastTheme.tid` + `KontrastTokens.css` | Tokens-only |

Renaming Terminal/Nocturne to drop "Dark" also closes the THEMES.md discrepancy where the prose calls them "Terminal" and "Nocturne" but the tiddler titles are `TerminalThemeDark` / `NocturneThemeDark`.

---

## 7. Implementation order

Do this on a branch — every step should leave the app rendering correctly.

1. **Audit token usage.** `grep -rE 'var\(--[a-z0-9_-]+\)' src/` and inventory every variable. Cross-reference with the `:root` block in `$StyleSheetCore.css`. Anything used but not declared with a default is a bug to fix as part of step 3.
2. **Audit hardcoded colours in `$ThemeBase.css`.** Each `#xxxxxx` (other than in `:root`) becomes a new token. Likely additions: `--col-on-accent`, `--col-error`, `--col-error-bg`.
3. **Author `$Tokens.css`.** Single source of truth for every variable, with light defaults. This is the most important file to get right — it's the contract every component depends on.
4. **Split `$StyleSheetCore.css` → `$Reset.css` + `$Structure.css`.** Move Settings-form rules out (they go to `$Components.css` in step 5).
5. **Rename `$ThemeBase.css` → `$Components.css`.** Replace hardcoded colours with the new tokens. Add the migrated Settings-form rules.
6. **Update auto-tagging in `vite-plugin-tiddler-compile.js`** for the new layer tags.
7. **Update `$CoreThemeManager`** to emit `@layer` wrapped output.
8. **Migrate one theme as proof.** Aurora is the simplest — copy its `:root` overrides into `AuroraTokens.css`, strip the bullet list down to one entry, verify it renders identically.
9. **Migrate the rest.** Track diffs against pre-change screenshots.
10. **Rename Terminal/Nocturne** to drop "Dark" suffix. Update `$CoreThemeDark.tid` to reference `DarkTokens` instead of the old structure.
11. **Delete `$StyleSheetCoreDark.css`** and any other dead files.
12. **Update `docs/THEMES.md`** — new authoring instructions, new screenshot for "tokens-only theme" example, fix the Terminal/Nocturne naming.
13. **Update `CLAUDE.md`** — the theme section currently describes the old model.

Each step (after #3) should be a separate commit. The visual regression check between steps is just "load the app, eyeball each theme."

---

## 8. Browser support

`@layer` baseline:
- Chrome/Edge 99 (Mar 2022)
- Firefox 97 (Feb 2022)
- Safari 15.4 (Mar 2022)

You're already using `document.adoptedStyleSheets` (Chrome 73, Firefox 101, Safari 16.4) and constructable stylesheets — Safari 16.4 is *stricter* than `@layer`, so adding `@layer` doesn't shift the floor.

---

## 9. Open questions

- **Tag vs. metadata for layer assignment** — filename convention (Option A) or explicit `tags:` header (Option B)? See §5.
- **Intra-layer ordering** — if two tiddlers carry `$LayerComponents`, alphabetical-by-title is the obvious default. Anyone need explicit ordering? If yes, add a `weight:` field; if no, leave it.
- **Should `$StyleSheetUser` be wrapped in `@layer user` or left raw?** Wrapping is consistent. Leaving it raw lets power-users use their own `@layer` declarations. Lean: wrap it, document that users can declare sub-layers inside.
- **Theme-layer structural overrides** — e.g. Broadsheet rearranges the header. Currently I'd put that in `BroadsheetLayout.css` and let the theme layer beat the structure layer via cascade. Alternative: introduce a `theme-structure` sub-layer between `structure` and `tokens`. Probably overkill, but worth a thought.

---

## 10. Risks & rollback

- **Risk:** A variable used somewhere isn't declared in `$Tokens.css`. Failure mode is invisible — the property just doesn't apply.
  - **Mitigation:** audit step (§7.1) and a CI grep that errors if any `var(--x)` reference has no matching declaration in `$Tokens.css`.
- **Risk:** Specificity surprises. `@layer` only affects cross-layer cascade; intra-layer specificity rules still apply. A high-specificity rule in `components` can still beat a low-specificity rule in `theme` — wait, no: `@layer` order beats specificity *between* layers. But a theme rule with `!important` and one in components without — both behave per spec. Read the MDN doc on `@layer + !important` if anyone hits this.
- **Rollback:** the whole change lives in `$CoreThemeManager`'s assembly function plus the file split. To roll back, revert that commit and the file split commits. No runtime data migration needed — tiddler tags can stay, they just become ignored.

---

## 11. Definition of done

- [ ] Every built-in theme renders identically to pre-change (eyeball each, screenshot-diff if you want to be rigorous).
- [ ] Dark mode works without any `$StyleSheetCoreDark`.
- [ ] Creating a new theme requires authoring only a `*Tokens.css` file and a 3-line `*Theme.tid`.
- [ ] `tw.events.send('theme.switch', 'TerminalTheme')` works (not `'TerminalThemeDark'`).
- [ ] `docs/THEMES.md` and `CLAUDE.md` updated.
- [ ] CI passes — including (new) check that all variable references resolve.
