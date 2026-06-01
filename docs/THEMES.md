# TWikki Themes

TWikki's look is driven entirely by **data, not a build step**. A theme is just a
tiddler tagged `$Theme` whose body lists the stylesheet tiddlers to apply:

```
tags: $Theme

* [[$StyleSheetCore]]
* [[$ThemeBase]]
* [[AuroraStyleSheet]]
```

`$CoreThemeManager` concatenates those stylesheets into a single
[constructable stylesheet](https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet)
and adopts it at runtime, so switching or editing a theme re-paints instantly with no
reload. Colours, radii and spacing are exposed as CSS custom properties
(`--col*`, `--colbg*`, `--rad*`), and a theme simply overrides the ones it cares about
plus any structural rules it wants.

The themes below live in the `themes` package (`src/packages/themes/`). Switch between
them with the theme selector in the sidebar, or from the console:

```js
tw.events.send('theme.switch', 'AuroraTheme');
```

---

## Token themes

These use system font stacks, so they work offline with zero network dependency.

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

---

## Web-font themes

These pull a display + body font over `@font-face` from the
[Fontsource](https://fontsource.org) CDN, and also rework the layout — reordering the
header, trimming the toolbar and centring the reading column.

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

---

## Creating your own

1. Add a stylesheet tiddler to `src/packages/themes/`, e.g. `MyStyleSheet.css`
   (`.css` files are auto-tagged `$StyleSheet`). Override the tokens you want and add
   any structural rules.
2. Add a theme tiddler `MyTheme.tid` tagged `$Theme` that lists
   `$StyleSheetCore`, `$ThemeBase` and your stylesheet (in that order, so your rules
   win).
3. Run `npm run dev` (the compile plugin regenerates `public/packages/themes.json`
   automatically) and pick your theme from the selector.

> **Note:** theme and stylesheet tiddlers are hidden from normal search by default —
> the `$Theme` and `$StyleSheet` tags are in the `excludeTags` list on the **Search**
> tab of `$GeneralSettings`. They still appear in the theme selector and in an explicit
> `tag:$Theme` / `$`-prefixed search. Edit `includeTags`/`excludeTags` to change which
> tags are hidden — no renaming required.

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
* { font-family: 'Outfit', system-ui, sans-serif; }
```

For a fully offline theme, embed the font as a base64 `data:` URI in the `src` instead
of a CDN URL — the font then travels with the wiki and syncs like any other tiddler.
