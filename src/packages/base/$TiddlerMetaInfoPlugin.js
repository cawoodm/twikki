// tags: $Plugin

/**
 * ## Description
 * Populates the `{{=metaInfo}}` slot in $TiddlerDisplay: a `pck:<package>`
 * pill plus `doNotSave ✅` / `isRawShadow ✅` indicators. The package pill
 * is PickerPlugin markup — clicking it lists every tiddler in the package
 * via `data-source="package"`.
 *
 * Without this plugin the slot renders empty and the card still renders —
 * a degradation the no-plugin invariant requires.
 */
(function () {
  const meta = {
    name: 'TiddlerMetaInfo',
    version: '1.0.0',
    platform: '0.26.0',
    description: 'Per-tiddler details: package pill, doNotSave / isRawShadow flags.',
    // Soft dependency: the pill still renders as a button without Picker, just inert.
    dependencies: ['Picker'],
  };

  return {
    meta,
    init() {
      tw.extend.tiddlerDetails.metaInfo = function (t) {
        const parts = [];
        if (t.package) {
          const arg = String(t.package).replace(/"/g, '&quot;');
          const label = tw.core.common.escapeHtml(t.package);
          parts.push(
            `<span class="picker pck-picker" data-event="tiddler.show" data-source="package" data-source-arg="${arg}">` +
              `<button class="picker-trigger pck-pill">pck:${label}</button>` +
              '<div class="picker-menu" hidden></div>' +
              '</span>',
          );
        }
        if (t.doNotSave) parts.push('doNotSave ✅');
        if (t.isRawShadow) parts.push('isRawShadow ✅');
        return parts.join(' ');
      };
    },
  };
})();
