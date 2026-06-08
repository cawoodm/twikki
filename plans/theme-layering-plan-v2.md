# Theme Stylesheet Layering — Plan (v2)

Restructure how TWikki composes a theme's stylesheets, replacing implicit ordered concatenation with CSS @layer-based named layers (base, theme and user).

Goal: make themes structurally valid by construction, and incapable of clobbering each other in the wrong order. Three cascade layers. Theme authors work in the theme layer; the runtime guarantees a foundation and a user-override slot the theme cannot lock out.

All themes must have a $Theme tag.

Dark themes no longer need to be named "Dark" but must have a $ThemeDark tag. Ensure the logic for disabling hljs stylesheets respects this.

Themes have separate stylesheets for layout/structure and colors/palette (e.g. $CoreThemeLayout and $CoreThemePalette)

The default theme is CoreThemeLight, ObsidianThemeDark gets moved to the themes/ package

---

## Layers

```css
@layer base, theme, user;
```

| Layer |  Contents | Core Default Tiddlers |
|---|---|---|
| **base** |  Reset rules + `:root` token declarations | $BaseReset & $BaseVariables |
| **theme** | Whatever the active `$Theme` tiddler's bullet list points to | $CoreThemeLayout, $CoreThemeAppearance, $CoreThemePalette |
| **user** | `$StyleSheetUser` | Delivered empty |

Two guarantees from `@layer`:
- Theme rules beat base rules regardless of selector specificity.
- User rules beat both regardless of selector specificity.

Everything else is plain list-of-stylesheets composition — concatenation order within a layer is exactly today's pre-PR behaviour.

---

## Tiddlers

### Foundation (loaded by runtime, every theme)

| Tiddler | Contents |
|---|---|
| `$BaseReset` | Browser normalization. Box-sizing, default margins, list/image/link resets. |
| `$BaseVariables` | The `:root` block declaring every CSS variable used anywhere, with light defaults. |

These are hard-coded into `$CoreThemeManager` as the base layer. A theme cannot opt out. A user with a strong stomach can edit the tiddlers themselves; that's deliberate.

### Default Themes
TiddlyWiki delivers 2 standard themes: CoreTheme and CoreThemeDark.

The default shadow tiddler $Theme is set to CoreThemeLight.

CoreThemeLight lists the following tiddlers:

| Tiddler | Contents |
|---|---|
| `$CoreThemeLayout` | App-shell grid, flex internals, responsive drawer. Structural rules. |
| `$CoreThemeAppearance` | Token-driven component appearance. Sidebar, buttons, dialogs, forms, typography. |
| `$CoreThemePalette` | Token-driven colors. |

The $CoreThemeDark has a different palette:
  * `$CoreThemeDarkPalette`: Token overrides for dark mode. `:root { --colbg1: …; … }`

These are theme-layer content. Third-party themes can list them, replace them, or ignore them.

### Core Themes

```
title: CoreThemeLight
tags: $Theme

* [[$CoreThemeLayout]]
* [[$CoreThemeAppearance]]
* [[$CoreThemePalette]]

```
title: $CoreThemeDark
tags: $Theme, $ThemeDark

* [[$CoreThemeLayout]]
* [[$CoreThemeAppearance]]
* [[$CoreThemeDarkPalette]]
```

## Demo Themes

A theme may opt to just change colors by specifying a new palette

```
title: AuroraTheme
tags: $Theme, $ThemeDark

* [[$CoreThemeLayout]]
* [[$CoreThemeAppearance]]
* [[AuroraTheme::AuroraPalette]]
```

Or, it may specify multiple stylesheets in order to change the layout
```
title: BroadsheetTheme
tags: $Theme

* [[BroadsheetTheme::BroadsheetHeaderLayout]]
* [[BroadsheetTheme::BroadsheetAppearance]]
* [[BroadsheetTheme::BroadsheetPalette]]
```

The convention: a theme's bullet list is *its theme-layer contents*, in concatenation order. The theme author owns ordering within the theme layer. The runtime owns the layer boundaries.

### User

Create shadow tiddler `$StyleSheetUser` empty but with a comment to users to add their styles here.
I will always exist (as an empty shadow tiddler). It will be wrapped in `@layer user` by the $CoreThemeManager.

---

## The manager

`src/packages/base/$CoreThemeManager.js` — the entire cascade-relevant code is:

```js
const BASE_SHEETS = ['$BaseReset', '$BaseVariables'];

function buildCss() {
  const layers = {
    base:  BASE_SHEETS.map(tw.run.getTiddlerTextRaw),
    theme: getThemeStyleSheets().map(tw.run.getTiddlerTextRaw),
    user:  [tw.run.getTiddlerTextRaw('$StyleSheetUser')],
  };
  const header = `@layer ${Object.keys(layers).join(', ')};`;
  const body = Object.entries(layers)
    .map(([name, bodies]) => `@layer ${name} {\n${bodies.filter(Boolean).join('\n')}\n}`)
    .join('\n\n');
  return header + '\n\n' + body;
}
```

No tag scanning, no `collectByTag`, no per-layer tag lookups. Three named buckets, one of which (`theme`) is the existing `getThemeStyleSheets()` call.

`$ThemeDark` tag survives because it does an unrelated job: flips the syntax highlighter between `highlight-light` and `highlight-dark`. Not part of cascade.

---

## What's explicitly NOT in this plan (vs PR #1)

- ❌ No `$LayerReset` / `$LayerStructure` / `$LayerTokens` / `$LayerComponents` tags
- ❌ No filename-to-layer-tag mapping in the compile plugin
- ❌ No runtime backward compatability.
- ❌ No five-layer or six-layer cascade

The compile plugin needs no changes for this plan.

---

## What's Included

- ✅ Existing themes are migrated to respect the new concept ($ThemeBase and $StyleSheetCore split into 3 layout/appearance/colors)
- ✅ Each theme has it's layout / appearance and palette (colors) as separate stylesheets inside a multi-section .tid file as today
- ✅ Hardcoded colors and values (e.g. `#fff` and `#c0392b`) should tokenised (e.g. `--col-on-accent` and `--col-error`) in `$BaseVariables`
- ✅ `tokens.test.js` — variable-resolution check (every `var(--x)` in `src/` resolves to a declaration in `$BaseVariables`)
- ✅ Rename themes (e.g. Terminal/Nocturne) to drop "Dark" suffix where theme names are unambiguous (closes the THEMES.md naming discrepancy)
- ✅ Core Light is the elegant default theme: `CoreThemeLight` just lists layout + appearance + colors, no dark overrides needed
- ✅ `$ThemeDark` tag for syntax highlighter switching
- ✅ Rename `*Dark` themes to drop the word "Dark" (except for CoreThemeDark). Themes should have "Theme" in their name.
- Split `$CoreThemeLayout`, `$CoreThemeAppearance` and `CoreThemePalette` into layout/appearance/palette (same for CoreThemeDark)

---

## Implementation order

Branch from `main` into a new worktree 'theme-layers-v2'.
Do NOT use the `theme-layering` branch.

1. **Author `$BaseReset.css`** — extract reset rules from current `$StyleSheetCore.css`.
2. **Author `$BaseVariables.css`** — extract `:root` block from current `$StyleSheetCore.css`; expand to cover every variable referenced anywhere, adding new tokens (`--col-on-accent`, `--col-error`) to replace hardcoded `#fff` / `#c0392b`.
3. **Author `$CoreThemeLayout.css`** — structural rules (grid, flex, responsive drawer) extracted from current `$ThemeBase.css` and `$StyleSheetCore.css`.
4. **Author `$CoreThemeAppearance.css`** — token-driven component appearance (sidebar, buttons, dialogs, forms, typography) extracted from current `$ThemeBase.css`.
5. **Author `$CoreThemePalette.css`** — token light defaults; move the Settings-form rules in from current `$StyleSheetCore.css`.
6. **Author `$CoreThemeDarkPalette.css`** — replaces current `$StyleSheetCoreDark.css`. Pure `:root` overrides.
7. **Update `$CoreThemeManager.js`** to the three-layer `buildCss` shown above. Hardcode `BASE_SHEETS = ['$BaseReset', '$BaseVariables']` and wrap `$StyleSheetUser` in `@layer user`.
8. **Update `CoreThemeLight.tid` and `$CoreThemeDark.tid`** bullet lists per the spec; edit the shadow `$Theme` so it defaults to `CoreThemeLight`; tag `$CoreThemeDark` with both `$Theme` and `$ThemeDark`.
9. **Ensure `$StyleSheetUser` exists as an empty shadow tiddler** so the user layer always has something to wrap.
10. **Switch hljs stylesheet-disable logic** to key on the `$ThemeDark` tag instead of the `"Dark"` name suffix.
11. **Move `ObsidianThemeDark`** from `src/packages/base/` to `src/packages/themes/`; tag it `$Theme, $ThemeDark`; rebuild its bullet list against the new layer model.
12. **Migrate built-in themes** (Aurora, Manuscript, Terminal, Bubblegum, Broadsheet, Nocturne, Kontrast):
    - Each `*Theme.tid` lists `[[$CoreThemeLayout]]` + `[[$CoreThemeAppearance]]` + `[[*Palette]]` (and optionally a `*Layout` for themes that genuinely restructure: Broadsheet, Nocturne).
    - Strip duplicated `:root` blocks down to just the deltas (variables that actually differ from `$BaseVariables`).
    - Add the `$ThemeDark` tag to dark themes.
13. **Delete** `$StyleSheetCore.css`, `$StyleSheetCoreDark.css`, `$ThemeBase.css`.
14. **Rename `*Dark` themes to remove the word "Dark" (e.g. `NocturneThemeDark` → `NocturneTheme`); update any `tw.events.send('theme.switch', …)` references.
15. **Add `tokens.test.js`** — variable-resolution check (every `var(--x)` in `src/` resolves to a declaration in `$BaseVariables`).
16. **Update `docs/THEMES.md`** — three-layer model, theme-author authoring guide, dark-theme `$ThemeDark`-tag convention.
17. **Update `CLAUDE.md`** — refresh the theme section.

Each step is a separate commit. The app should render correctly between steps 1–6 (the new files are present but unused). Step 7 flips the manager onto the new layered output; steps 8–10 then move the tiddler graph and runtime tag logic over. Step 11 removes the now-dead sources. Steps 12–14 migrate the rest of the themes.

---

## Browser support

`@layer` baseline: Chrome 99, Firefox 97, Safari 15.4 — all 2022. Already exceeded by the constructable-stylesheets baseline TWikki uses.

---

## Notes

- **Component-level CSS in palette files.** Aurora currently has ~40 lines of gradients and box-shadows beyond `:root` overrides. With three layers, that's fine — it lands in the theme layer and beats `CoreThemePalette` by `@layer`. But the line between "tokens only" and "creative theme CSS" is a documentation question, not a runtime constraint. Recommend documenting both approaches in `THEMES.md` and leaving the choice to the author.

---

## Definition of done

- [ ] All built-in themes render identically to pre-change. Eyeball each; screenshot-diff if you want rigour.
- [ ] Dark mode works via `$DarkPalette` in the theme layer; no `$StyleSheetCoreDark` exists.
- [ ] Creating a new tokens-only theme requires authoring one `*Palette.css` and one `*Theme.tid` listing layout + palette.
- [ ] User can override any theme rule from `$StyleSheetUser` regardless of the theme's selector specificity.
- [ ] `tokens.test.js` passes.
- [ ] `tw.events.send('theme.switch', 'TerminalTheme')` works (not `'TerminalThemeDark'`).
- [ ] `docs/THEMES.md` and `CLAUDE.md` updated.
- [ ] No `$Layer*` tags exist anywhere in source.
- [ ] No filename-to-tag rules in the compile plugin.
