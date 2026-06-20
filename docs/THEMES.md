# TWikki Themes

A theme in TWikki a tiddler tagged `$Theme` whose body lists the
stylesheet tiddlers to apply, plus an optional layout override. Switching themes
re-paints instantly.

`$CoreThemeManager` (in `src/packages/base/`) watches the `$Theme` pointer and rebuilds
one constructable stylesheet, wrapped in four [CSS cascade layers](https://developer.mozilla.org/en-US/docs/Web/CSS/@layer),
whenever the theme — or any tiddler it points at — changes.

## A worked example: `BroadsheetTheme.tid`

A single `.tid` under `src/packages/themes/` becomes one **parent** tiddler plus
addressable sub-sections (one tiddler per `# Heading`):

````
tags: $Theme

A light editorial theme with serif headlines and a centered reading column.

# BroadsheetTheme
tags: $Theme
* [[$CoreThemeLayout]]
* [[$CoreThemeAppearance]]
* [[BroadsheetTheme::BroadsheetPalette]]

# BroadsheetPalette
tags: $StyleSheet
```css
:root { --col6: #b5462f; … }
div.tiddler { padding: 2.6rem 3rem; … }
```

# MainLayout
[[$MainLayoutHeader]]
````

What you get from this single file:

- **`BroadsheetTheme`** — the parent tiddler, tagged `$Theme`; this is the name the
  theme picker and `theme.switch` use.
- **`BroadsheetTheme::BroadsheetPalette`** — a sub-section tagged `$StyleSheet`; holds
  the bespoke CSS for this theme.
- **`BroadsheetTheme::MainLayout`** — the optional layout override (see below).

### Bullet list → list of stylesheets

When the manager activates the theme it calls `tw.run.getTiddlerList('BroadsheetTheme')`,
which scans the parent tiddler's text for `* [[…]]` bullet lines (skipping anything
inside a fenced code block, so a CSS `* { }` selector is never mistaken for a bullet)
and strips the `[[]]` wrappers. From the file above the manager gets:

```
$CoreThemeLayout
$CoreThemeAppearance
BroadsheetTheme::BroadsheetPalette
```

Each name is resolved to a tiddler whose text is concatenated, in order, into the
`theme` cascade layer. The first two are shared shadow tiddlers — every theme can
re-use the core layout and appearance rules without copying them — and the third
points to this file's own `# BroadsheetPalette` section, where Broadsheet's fonts,
colours and component tweaks live.

### How a theme can change the layout

The page chrome (header, sidebar, main area) is rendered from the tiddler named by the
`$Layout` pointer — `$MainLayout` by default. A theme overrides that by shipping a
`# MainLayout` section whose body is a single `[[Reference]]`. Broadsheet wants the
alternative header-style layout, so its `# MainLayout` section reads
`[[$MainLayoutHeader]]`.

On `theme.switch` the manager calls `layoutTitleForTheme(name)`; if that differs from
the current `$Layout`, it persists the new pointer and triggers a hard reload so the
new chrome paints from the very first frame. A theme that omits `# MainLayout` (or
whose section already matches `$Layout`) gets the instant in-place repaint instead.

## How a theme is applied

End-to-end, a `theme.switch` event runs through `$CoreThemeManager` as:

1. **Update the `$Theme` pointer** to `[[BroadsheetTheme]]` and persist it.
2. **Resolve the bullet list** via `getTiddlerList(theme)` — the ordered list of
   stylesheet tiddlers.
3. **Concatenate CSS into four layers** (`base, plugin, theme, user`) — see "The four
   layers" below — and `replaceSync` the constructable stylesheet that's already
   adopted on `document.adoptedStyleSheets`. Browsers re-render immediately; no FOUC.
4. **Flip the syntax highlighter** if the theme tiddler carries the `$ThemeDark` tag
   (swaps `highlight-light` ↔ `highlight-dark`).
5. **Swap the layout** if `# MainLayout` named a different layout tiddler — by
   updating `$Layout` and triggering a hard reload; otherwise the switch stays
   reload-free.

A live edit to any stylesheet tiddler in the list (or to the bullet list itself) fires
`tiddler.updated`, which re-runs steps 2–3 and re-paints — so authoring a theme in the
editor feels like editing CSS in DevTools.

---

## The four layers

```css
@layer base, plugin, theme, user;
```

| Layer      | Contents                                                                                | Core default tiddlers                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **base**   | Reset rules + `:root` token declarations                                                | `$BaseReset`, `$BaseVariables`                                                                                         |
| **plugin** | `# StyleSheet` section of every `$Plugin`-tagged tiddler (auto-collected, alphabetical) | `$SettingsDialogPlugin`, `$PickerPlugin`, `$TabsPlugin`, `$ExplorerPlugin`, `$CommandPalette`, `$UnsavedChangesPlugin` |
| **theme**  | Whatever the active `$Theme` tiddler's bullet list points to                            | `$CoreThemeLayout`, `$CoreThemeAppearance`, `$CoreThemePalette`                                                        |
| **user**   | `$StyleSheetUser` (delivered empty)                                                     | —                                                                                                                      |

Three guarantees from `@layer`:

- **Plugin rules beat base rules** regardless of selector specificity (so a plugin's component CSS sits on top of the reset).
- **Theme rules beat plugin rules** regardless of selector specificity (so a theme can re-skin any plugin).
- **User rules beat everything** regardless of selector specificity.

The base and plugin layers are assembled by `$CoreThemeManager` — a theme cannot opt out. The user layer is wrapped automatically; a theme cannot lock it out. The theme layer is yours.

### What lives where

- `$BaseReset` — browser normalization (box-sizing, list/image resets).
- `$BaseVariables` — every CSS variable used anywhere, with light defaults
  (`--col*`, `--colbg*`, `--col-on-accent`, `--col-error`, `--rad*`, `--sidebar-w`,
  `--accent`, `--tab-bg`, …). The contract every component depends on; new tokens go
  here. Enforced by [`test/unit/tokens.test.js`](../test/unit/tokens.test.js), which
  fails if any `var(--x)` reference in `src/` has no matching declaration.
- **Plugin `# StyleSheet` sections** — every built-in interaction plugin (settings
  dialog, picker, tabs, explorer, command palette, unsaved-changes dialog) ships its
  own CSS in a `# StyleSheet` section inside its `.tid` file. The manager auto-collects
  them; plugins don't have to register anywhere. See "Shipping a stylesheet with a
  plugin" below.
- `$CoreThemeLayout` — app-shell grid, sidebar/main flex internals, responsive drawer,
  header-bar variant. Structural rules only.
- `$CoreThemeAppearance` — token-driven component appearance: body chrome, sidebar
  container, cards, dialog frame, buttons, forms, typography, code blocks, notifications.
  Reads tokens from the base layer.
- `$CoreThemePalette` — placeholder for the **light** palette; intentionally empty
  because the light defaults already live in `$BaseVariables`. Custom light themes can
  supply their own `*Palette` in its place.
- `$CoreThemeDarkPalette` — `:root` overrides that turn the UI dark.

### Light vs dark

The default `$Theme` is `$CoreThemeLight`. Dark mode is just a different bullet list:

```
title: $CoreThemeLight
tags: $Theme

* [[$CoreThemeLayout]]
* [[$CoreThemeAppearance]]
* [[$CoreThemePalette]]
```

```
title: $CoreThemeDark
tags: $Theme, $ThemeDark

* [[$CoreThemeLayout]]
* [[$CoreThemeAppearance]]
* [[$CoreThemeDarkPalette]]
```

The `$ThemeDark` tag is **not** part of the cascade. Its only job is to flip the
syntax highlighter between `highlight-light` and `highlight-dark`. Any dark theme
should carry it; light themes should not.

## Code Examples

Switch to a specific theme:

```js
tw.events.send('theme.switch', 'BroadsheetTheme');
```

Create a button to switch themes:
`<<button Aurora theme.switch AuroraTheme>>`

---

## Built-in themes

These live in `src/packages/themes/`. Switch between them with the theme selector
in the sidebar, or via `tw.events.send('theme.switch', 'AuroraTheme')`.

### Aurora — dark, cool, glassy

![Aurora](./screenshots/01-aurora.png)

Deep navy canvas with a cyan glow, gradient glass cards, soft drop-shadows and mint
accents. A modern dark-dashboard feel.

### Manuscript — light, editorial

![Manuscript](./screenshots/02-manuscript.png)

Warm parchment background, Georgia serif throughout, an oxblood accent rule on each
card and hairline borders. Reads like print.

### Terminal — brutalist / retro CRT

![Terminal](./screenshots/03-terminal.png)

Near-black surface, phosphor-green monospace, zero border radius, hard 1px borders,
uppercase titles and a subtle scanline texture.

### Bubblegum — soft, playful

![Bubblegum](./screenshots/04-bubblegum.png)

Pastel pink wash, candy accents, chunky 24px rounded cards and soft glow shadows.
Toy-like and friendly.

### Broadsheet — editorial, light

![Broadsheet](./screenshots/06-broadsheet.png)

**DM Serif Display** titles over an **Outfit** body. The header flattens to a hairline
bar with a centred pill search, the toolbar is trimmed to essentials, and content sits
in a centred 820px reading column. Terracotta accent.

### Nocturne — dark, tech

![Nocturne](./screenshots/07-nocturne.png)

**Syne** display titles with a **Sora** body. A floating glass header with a blurred
backdrop, the toolbar collapsed into a rounded pill of chartreuse icons, and dark
gradient cards. Lime `#c6f24e` accent.

### Kontrast — Swiss / neo-brutalist

![Kontrast](./screenshots/09-kontrast-fixed.png)

**Anton** condensed uppercase titles with an **IBM Plex Sans** body. Thick 2px black
borders, hard 6px offset shadows, a square search box and a segmented row of bordered
icon boxes. Red `#e5322d` accent.

### Obsidian — modern dark with violet accent

A dense dark theme used as TWikki's previous default. Now ships as a regular theme
in the same package.

---

## Creating your own

A theme is a `$Theme`-tagged tiddler whose bullet list names everything that should
end up in the `theme` cascade layer.

**Tokens-only theme** — change colours and radii without touching layout or component
CSS:

```
title: MyTheme
tags: $Theme

* [[$CoreThemeLayout]]
* [[$CoreThemeAppearance]]
* [[MyTheme::MyPalette]]
```

````
# MyPalette
tags: $StyleSheet

```css
:root {
  --colbg1: #1a1a2e;
  --colbg2: #16213e;
  --col6:   #e94560;
}
```
````

You don't have to copy every variable from `$BaseVariables` — only the ones you want
to change. The rest inherit from the base layer.

**Theme with custom layout** — Broadsheet, Nocturne and Kontrast restructure the
header. They ship their own structural CSS in the same palette section (which is fine
since the theme layer can win over the base layer), or in a separate `*Layout`
section. Either way, list it in the bullet list before the palette so the palette can
re-tweak it.

### Dark themes

Tag your dark theme `$Theme, $ThemeDark`. The runtime uses the tag (not the theme
name) to switch the syntax highlighter between light and dark sheets. No naming
convention required — you can call your dark theme `Midnight` or `Cthulhu` and it'll
work.

### Where things live

- A `.css` file in `src/packages/themes/` becomes a standalone `$StyleSheet`-tagged
  tiddler whose title is the filename.
- A `.tid` file with `# Section` markers inside it becomes one parent tiddler plus
  named sub-sections, addressable as `[[ParentName::SectionName]]`. Use this to ship
  a theme as a single file (theme tiddler + palette section), as the built-ins do.

---

## Shipping a stylesheet with a plugin

A plugin ships its CSS inside its own `.tid` file, in a `# StyleSheet` section. The
manager auto-collects every `# StyleSheet` section from `$Plugin`-tagged tiddlers and
wraps the result in `@layer plugin`, between the base and theme layers.

````
tags: $Plugin

# Description
A picker for foos.

# Code
```javascript
(function() {
  // … your plugin code …
})();
```

# StyleSheet
```css
/* Use the design tokens — your CSS will follow whatever theme is active. */
.my-plugin-thing {
  background: var(--colbg2);
  color: var(--colfg);
  border: 1px solid var(--col4);
  border-radius: var(--rad1);
}
```
````

What this gets you:

- **Inherits the design tokens** (`--col*`, `--colbg*`, `--rad*`, …) so your component
  recolours under every theme without you authoring per-theme overrides.
- **Themes can override your component** — a theme that wants `.my-plugin-thing` to be
  red simply ships that selector in its own palette; the theme layer beats the plugin
  layer cross-layer regardless of specificity.
- **Users can always win** — `$StyleSheetUser` overrides the plugin layer too.
- **Zero registration**: the manager walks `$Plugin`-tagged tiddlers and pulls each
  one's `::StyleSheet` section. Plugins without a section are skipped. Edits to the
  section repaint without a reload.

Namespace your selectors with a unique prefix (`.my-plugin-*`) so cross-plugin
collisions stay rare. The built-in plugins follow this convention (`.settings-*`,
`.picker-*`, `.tab*`, `.explorer-*`, `.palette-*`, `.tw-changes-*`).

### Web fonts

`@import` is stripped from constructable stylesheets, so the Google Fonts copy-paste
snippet won't work. Use `@font-face` directly instead — it loads fine:

```css
@font-face {
  font-family: 'Outfit';
  src: url('https://cdn.jsdelivr.net/npm/@fontsource/outfit/files/outfit-latin-400-normal.woff2') format('woff2');
  font-weight: 400;
  font-display: swap;
}
* {
  font-family: 'Outfit', system-ui, sans-serif;
}
```

For a fully offline theme, embed the font as a base64 `data:` URI in the `src` instead
of a CDN URL — the font then travels with the wiki and syncs like any other tiddler.

> **Search visibility:** theme and stylesheet tiddlers are hidden from normal search
> by default — the `$Theme` and `$StyleSheet` tags are in the `excludeTags` list on
> the **Search** tab of `$GeneralSettings`. They still appear in the theme selector
> and in an explicit `tag:$Theme` / `$`-prefixed search. Edit
> `includeTags`/`excludeTags` to change which tags are hidden — no renaming required.

---

## User overrides

Anything you put in `$StyleSheetUser` lands in the `user` layer and wins over the
active theme regardless of selector specificity. Use it for personal tweaks without
forking a theme:

```css
:root {
  --col6: hotpink; /* recolour every link */
}
div.tiddler {
  max-width: 1100px;
}
```
