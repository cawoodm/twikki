# Mobile Responsive & PWA — UI Issue List

Issues that make TWikki hard to use on phones/tablets, grounded in the current CSS. Most are CSS-only and concentrate in two files: `src/modules/core.defaults/$CoreThemeLayout.css` (structure/responsive) and `src/modules/core.defaults/$CoreThemeAppearance.css` (sizes/touch). Line refs are against `main` as reviewed.

Priority key: **P0** = the reported bug · **P1** = viewport/layout fundamentals · **P2** = touch & interaction · **P3** = content & dialogs · **P4** = PWA polish.

---

## P0 — The reported bug

### 1. Search results capped at the 280px sidebar width and trapped in the drawer

`#search-results` is `position:absolute; left:0; right:0` inside `#explorer-search`, which lives in `#sidebar` (`$CoreThemeLayout.css:36-45`). The sidebar is `var(--sidebar-w, 280px)`, and on mobile becomes a `min(85vw, 280px)` slide-in drawer (`:160-179`). So results can never exceed ~280px, and you must open the drawer to see them.

**Fix:** on ≤600px render `#search-results` as a full-width fixed overlay (`position:fixed; left:0; right:0; width:100vw; max-height:70dvh`), and/or move the search box into `#main-topbar` so it's reachable without opening the drawer. The `layout-header` variant already puts search in a wide `flex:1` column (`:143-150`) — reuse that pattern.

---

## P1 — Viewport / layout fundamentals

### 2. `#app { height: 100vh }` clips under mobile browser chrome

`$CoreThemeLayout.css:10`. Mobile browsers' dynamic toolbars make `100vh` taller than the visible area → bottom content/scroll jank. Use `100dvh` with a `100vh` fallback.

### 3. No safe-area handling (notch / home indicator)

Viewport meta lacks `viewport-fit=cover` (`src/index.html:6`) and there is no `env(safe-area-inset-*)` padding anywhere in the CSS. In standalone PWA mode the header/footer overlap the notch and home indicator. Add `viewport-fit=cover` and safe-area padding on header, sidebar, and footer.

### 4. Only one breakpoint (600px)

`$CoreThemeLayout.css:160`. Tablets (601–1024px) get the fixed 280px sidebar and a cramped content pane. Add an intermediate tier and make `--sidebar-w` a `clamp()` so it scales.

---

## P2 — Touch & interaction

### 5. Tab strip `overflow-x: hidden` hides tabs off-screen

`$CoreThemeLayout.css:76-77`. Tabs past the edge are unreachable on a phone. Use `overflow-x:auto` with momentum scroll (`-webkit-overflow-scrolling:touch`), or collapse to a dropdown on mobile.

### 6. Drawer has no backdrop and no tap-outside / swipe to close

`$CoreThemeLayout.css:181` only toggles the `.open` transform. Add a dimming scrim overlay that closes the drawer on tap; optional swipe-to-close.

### 7. Touch targets below ~44px

Toolbar/icon buttons use small padding (`padding:4px`, `2px 10px`) and `0.72rem` pills (`$CoreThemeAppearance.css:204-246`). Bump interactive controls to ~44px minimum under `@media (pointer:coarse)`.

### 8. iOS input-zoom on focus

Search/edit inputs don't pin `font-size ≥16px`, so iOS auto-zooms the whole page when an input is focused. Force `font-size:16px` on inputs on mobile.

### 9. Hover-only affordances are invisible on touch

Actions revealed on `:hover` (tiddler/toolbar controls) can't be triggered on touch (no hover state). Make them always-visible or tap-visible under `@media (hover:none)`.

---

## P3 — Content & dialogs

### 10. Wide-content horizontal overflow

`pre` is handled (`overflow-x:auto`, `$CoreThemeAppearance.css:485`), but tables likely lack a scroll wrapper and long URLs need `overflow-wrap:anywhere`/`word-break` — otherwise they force horizontal page scroll on mobile.

### 11. Multi-column dialog bodies don't collapse

The core `tw-dialog` chrome is already responsive (`min/max-width: min(…,92vw)`, `max-height:80vh` — `$CoreThemeAppearance.css:320-322`) — good. But 2-column dialog _bodies_ (e.g. the GithubRepoSync conflict-reconcile compare grid) should collapse to one column under ~600px.

### 12. Plugin modals may use fixed px widths

Verify `CommandPalettePlugin/CommandPalette.css` and `PickerPlugin/Picker.css` use vw-based widths (e.g. `min(…, 92vw)`), not fixed pixel widths that overflow small screens.

---

## P4 — PWA polish

### 13. Standalone status-bar metas

Add a `theme-color` meta and `mobile-web-app-capable` / `mobile-web-app-status-bar-style` to `index.html`. The manifest sets `theme_color`, but iOS also reads the metas for the standalone status bar.

### 14. Use `dvh` for viewport-relative heights

`#search-results { max-height: 60vh }` (`$CoreThemeLayout.css:42`) and the drawer should use `dvh` so they behave in landscape and with dynamic toolbars.

### 15. `touch-action` on drag handles

Check `DragAndDropTiddlersPlugin/DragAndDropTiddlers.css` — set an explicit `touch-action` on drag handles so dragging a tiddler doesn't fight page scroll on touch.

---

## Suggested order

1. **#1** — full-width mobile search overlay (the actual complaint).
2. **#2 / #3** — `dvh` + `viewport-fit=cover` + safe-area insets (fixes clipping and notch overlap app-wide).
3. **#5** — tab-strip horizontal scroll.
4. **#6 / #7 / #8** — drawer scrim, 44px touch targets, 16px inputs.
5. Remaining P3/P4 polish.

All of #1–#9 are CSS-only (plus one `index.html` meta change) and localized to the two theme files, so they can land as a single reviewable patch without touching platform or plugin logic. The 600px breakpoint and `layout-header` search pattern already in `$CoreThemeLayout.css` give a foundation to build on.
