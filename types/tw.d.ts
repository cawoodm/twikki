// Ambient type declarations for the TWikki `tw` global API — for editor
// autocomplete in plugin/module source (src/packages, src/modules). NOT used at
// runtime or by the build; purely an IDE aid.
//
// Scope: the BASE API — core modules + base package (what loads under
// `?safemode`). Members are real, enumerated from a clean safemode boot; most
// params/returns are typed `any` to keep this lightweight — the value is member
// + parameter-name discovery. Extension/plugin-provided globals (e.g. demo
// macros) are intentionally NOT declared; they fall through the `[key]: any`
// index signatures. When you add/rename a core export, update the matching
// interface here.

export {};

declare global {
  /** The global TWikki namespace. Available to every module and plugin. */
  const tw: TWikki;
  /** Debug print — no-op unless `?debug`/`?logfilter` is active. */
  const dp: (...args: any[]) => void;
}

/** A TWikki tiddler. Extra fields are allowed (free-form metadata). */
interface Tiddler {
  title: string;
  text?: string;
  type?: string;
  tags?: string[];
  created?: string | Date;
  updated?: string | Date;
  doNotSave?: boolean;
  [field: string]: any;
}

/** A `$Plugin` tiddler's returned metadata (single source of truth). */
interface PluginMeta {
  name: string;
  version: string;
  platform?: string;
  description?: string;
  author?: string;
  url?: string;
  dependencies?: string[];
}

/** One entry in the `tw.plugins` registry. */
interface PluginEntry {
  meta: PluginMeta;
  init?: () => void;
  start?: () => void;
  unload?: () => void;
  source: string;
  package?: string;
  compat?: any;
  error?: any;
  missingDependencies?: string[];
}

interface TWikki {
  /** Pub/sub event bus. */
  events: TwEvents;
  /** Action API — tiddler CRUD, navigation, save (merged from core.tiddlers). */
  run: TwRun;
  /** UI builders, layout, notifications, navigation. */
  ui: TwUi;
  /** Workspace-scoped persistence (`/ws/<name>/…`). Use this, not `tw.storage`. */
  store: TwStore;
  /** Raw localStorage primitive (platform). Prefer `tw.store`. */
  storage: TwStorage;
  /** Extension registries — macros, commands, types, validators. */
  extensions: TwExtensions;
  /** Core subsystem exports. */
  core: TwCore;
  /** Legacy predicates (also on core.tiddlers). */
  util: TwUtil;
  /** Bundled libraries (markdown, highlight, dynamic require). */
  lib: TwLib;

  /** In-memory tiddler store. */
  tiddlers: {all: Tiddler[]; visible: string[]; trashed: Tiddler[]};
  /** Frozen snapshot of the shadow (core/default) tiddlers taken at boot. */
  shadowTiddlers: ReadonlyArray<Tiddler>;
  /** Flat plugin registry. */
  plugins: PluginEntry[];
  /** Look up a loaded plugin by `meta.name`. */
  plugin(name: string): PluginEntry | undefined;

  /** Registered macros, keyed by namespace. */
  macros: Record<string, any>;
  /** Registered commands. */
  commands: any;
  /** Registered tiddler types. */
  types: Record<string, any>;
  /** Loaded layout/render templates. */
  templates: Record<string, any>;
  /** Active workspace name. */
  workspace: string;
  /** Active theme tiddler title. */
  theme: string;
  /** Loaded core modules (build-bundled). */
  modules: Array<{name: string; factory?: (tw: TWikki) => any; tiddlers?: Tiddler[]; meta?: any}>;
  /** Transient per-session scratch state (not persisted). */
  tmp: Record<string, any>;
  /** Logging config (debug/trace/logfilter). */
  logging: any;

  [key: string]: any;
}

interface TwEvents {
  /** Register `handler` for every `event`. `owner` dedupes + enables teardown. */
  subscribe(event: string, handler: (...args: any[]) => any, owner?: string): void;
  /** Broadcast to all subscribers; returns each handler's result. */
  send(event: string, params?: any): any[];
  /** First non-null subscriber result wins (later subscribers don't run). */
  request(event: string, params?: any): any;
  /** Chain `value` through subscribers, each returning the next value. */
  filter(event: string, value: any, ctx?: any): any;
  /** Replace all handlers for `event` with a single one. */
  override(event: string, handler: (...args: any[]) => any, owner?: string): void;
  /** Remove every handler registered under `owner`; returns count. */
  unsubscribeByOwner(owner: string): number;
  init(): void;
  clear(): void;
  handlers(): any[];
  decode(params: any): any;
  [key: string]: any;
}

interface TwRun {
  addTiddler(newTiddler: Tiddler, userEdit?: boolean, forceSave?: boolean): any;
  addTiddlerHard(newTiddler: Tiddler): any;
  updateTiddler(currentTitle: string, newTiddler: Partial<Tiddler>, userEdit?: boolean, forceSave?: boolean): any;
  updateTiddlerHard(currentTitle: string, newTiddler: Partial<Tiddler>): any;
  updateTiddlerSilent(currentTitle: string, newTiddler: Partial<Tiddler>): any;
  deleteTiddler(title: string, automation?: boolean): any;
  getTiddler(title: string, includeRawShadow?: boolean): Tiddler | undefined;
  getTiddlerElement(title: string): HTMLElement | null;
  getTiddlerList(title: string): any;
  getTiddlerTextList(title: string): string[];
  getTiddlerTextRaw(title: string): string;
  getJSONObject(title: string): any;
  getKeyValuesArray(title: string): any;
  getKeyValuesObject(title: string): any;
  getSection(title: string, sectionName: string): string;
  getTiddlersByTag(tag: string): Tiddler[];
  getTiddlersByPackage(pck: string): Tiddler[];
  allTags(): string[];
  allProperty(test: (t: Tiddler) => boolean): Tiddler[];
  tiddler: any;
  tiddlerToggleTag(title: string, tag: string): any;
  showTiddler(title: string): void;
  showTiddlerList(list: any, title?: string): void;
  showAllTiddlers(opts?: {tag?: string; title?: string; pck?: string}): void;
  closeTiddler(title: string): void;
  closeAllTiddlers(opts?: {tag?: string; title?: string; pck?: string}): void;
  closePreview(): void;
  hideTiddler(title: string): void;
  previewTiddler(t: Tiddler, template?: string): any;
  renderAllTiddlers(): void;
  rerenderTiddler(title: string): void;
  save(): void;
  saveAll(): void;
  saveVisible(): void;
  autoSave(): void;
  setDirty(dirty: boolean): void;
  reload(): void;
  sendCommand(cmd: string, params?: any, currentTiddlerTitle?: string): any;
  executeText(text: string, title?: string, context?: any): any;
  executeCodeTiddler(text: string, title?: string): any;
  registerDropHandler(pattern: any, handler: (...args: any[]) => any): void;
  [key: string]: any;
}

interface DialogButton {
  text: string;
  msg?: string;
  payload?: any;
  close?: boolean;
}
interface DialogOpts {
  id?: string;
  title?: string;
  html?: string;
  buttons?: DialogButton[];
  onClose?: () => void;
  modal?: boolean;
}

interface TwUi {
  /** Toast notification. type: S(uccess)/E(rror)/W(arning)/D(ebug)/I(nfo). */
  notify(msg: string, type?: 'S' | 'E' | 'W' | 'D' | 'I', stack?: any): void;
  /** Open a (modal) dialog. */
  dialog(opts?: DialogOpts): any;
  /** Build a `<button data-msg>` HTML string. */
  button(text: string, message: string, payload?: any, id?: string, attr?: string, className?: string): string;
  section(opts: {name: string; content: string; id?: string; attr?: string}): string;
  expand(opts: {name: string; content: string; id?: string; attr?: string}): string;
  expose(opts: {name: string; content: string; message?: string; payload?: any; id?: string; attr?: string}): string;
  navigateTo(link: string): void;
  handleHashLink(hash: string): void;
  isCommand(str: string): boolean;
  isLocalLink(str: string): boolean;
  formEditTiddler(title: string): void;
  formNewTiddler(): void;
  renderLayout(): void;
  layoutTitleForTheme(theme: string): string;
  sendCommand(cmd: string, params?: any, currentTiddlerTitle?: string): any;
  setDirty(dirty: boolean): void;
  wireEvents(): void;
  wireUpEvents(): void;
  /** Whether there are unsaved changes. */
  readonly isDirty: boolean;
  [key: string]: any;
}

/** Workspace-scoped store. Keys are scoped under `/ws/<name>/` automatically. */
interface TwStore {
  get(key: string): any;
  set(key: string, value: any): void;
  delete(key: string): void;
  keys(): string[];
  exportRaw(key: string): string;
  importRaw(key: string, raw: string): void;
  /** Unscoped access (e.g. `/settings.json`). */
  global: TwStore;
  [key: string]: any;
}

/** Raw localStorage wrapper (platform). Prefer `tw.store`. */
interface TwStorage {
  get(key: string): any;
  set(key: string, value: any): void;
  remove(key: string): void;
  keys(prefix?: string): string[];
  getRaw(key: string): string | null;
  setRaw(key: string, raw: string): void;
  flush(): Promise<void>;
  clearWorkspace(name: string): void;
  [key: string]: any;
}

interface MacroSpec {
  description?: string;
  example?: string;
  [key: string]: any;
}
interface TwExtensions {
  registerMacro(namespace: string, name: string, fcn: (...args: any[]) => any, meta?: MacroSpec): void;
  registerCommand(command: any): void;
  registerCommandProvider(key: string, fn: () => any[]): void;
  registerType(key: string, label: string): void;
  registerValidator(v: {name: string; match: (t: Tiddler) => boolean; validate: (t: Tiddler) => void}): void;
  [key: string]: any;
}

interface TwCore {
  /** Resolve a path against the platform base URL. */
  buildUrl(path: string, base?: string): string;
  render: TwRender;
  tiddlers: TwTiddlers;
  dom: TwDom;
  sections: TwSections;
  common: TwCommon;
  store: TwCoreStore;
  workspaces: TwWorkspaces;
  packaging: TwPackaging;
  notifications: {notify: TwUi['notify']};
  search: {search(q: string, list?: any, options?: any): any; tagFilter(): any};
  params: {parseParams(params: string): any; evalParam(param: any): any; enc(param: any): any};
  templater: {Templater(template: string): any};
  markdown?: {md: any; render(text: string): string};
  [key: string]: any;
}

interface TwRender {
  renderTWikki(t: {text: string; title?: string; validation?: any}): string;
  renderTiddler(title: string): string;
  renderMarkdown(text: string): string;
  renderPlainText(text: string): string;
  makeTiddlerText(tiddler: Tiddler): string;
  makeTiddlerTagLinks(tags: string[]): string;
  createTiddlerElement(t: Tiddler, template?: any): HTMLElement;
  rerenderTiddler(title: string): void;
  renderAllTiddlers(): void;
  loadTemplates(): void;
  getInclusions(text: string): any;
  getMacros(text: string): any;
  getTiddlerLinks(text: string): any;
  maskCodeRegions(text: string): string;
  replaceFrom(text: string, index: number, search: string, replace: string): string;
  tagPickerHtml(tag: string): string;
  tiddlerDetails(t: Tiddler): any;
  tiddlerSpanInclude(el: Element): void;
  macroInclude(el: Element): void;
  [key: string]: any;
}

interface TwTiddlers {
  getTiddler(title: string, includeRawShadow?: boolean): Tiddler | undefined;
  tiddlerExists(title: string, includeRawShadow?: boolean): boolean;
  tiddlerIsValid(t: Tiddler): boolean;
  tiddlerValidation(t: Tiddler): any;
  validateTiddlerText(t: Tiddler): any;
  registerValidator(v: {name: string; match: (t: Tiddler) => boolean; validate: (t: Tiddler) => void}): void;
  getSection(title: string, sectionName: string): string;
  getTiddlersByTag(tag: string): Tiddler[];
  getTiddlersByPackage(pck: string): Tiddler[];
  tiddlerToggleTag(title: string, tag: string): any;
  resolveRef(ref: string): any;
  splitSectionRef(ref: string): any;
  isCoreTiddler(t: Tiddler): boolean;
  scrollToTiddler(title: string): void;
  SECTION_DELIM: string;
  [key: string]: any;
}

interface TwDom {
  /** document.getElementById. */
  $(id?: string): HTMLElement | null;
  /** document.querySelectorAll. */
  $$(selector?: string): NodeListOf<Element>;
  htmlToNode(html: string): Node;
  /** Tracked addEventListener (auto-removed on plugin unload via `owner`). */
  on(target: EventTarget, event: string, handler: (e: any) => any, owner: string, options?: any): void;
  offOwner(owner: string): void;
  nearestElement(el: Element, selector: string): Element | null;
  nearestAttribute(el: Element, attribute: string, selector?: string): string | null;
  nearestElementWithAttribute(el: Element, attribute: string): Element | null;
  addStyleSheet(title: string, url: string): void;
  addScript(title: string, url: string): void;
  loadScript(title: string, url: string, opts?: {integrity?: string; global?: string}): Promise<any>;
  enableStyleSheet(title: string): void;
  disableStyleSheet(title: string): void;
  [key: string]: any;
}

interface TwSections {
  parseSections(text: string): {order: string[]; sections: Record<string, any>};
  getSection(text: string, sectionName: string): string;
  fenceToType(info: string): string;
  [key: string]: any;
}

interface TwCommon {
  hash(val?: string): string;
  encoder(string: string): string;
  decoder(encoded: string): string;
  escapeHtml(unsafe: string): string;
  notEmpty(v: any): boolean;
  simpleSort(a: any, b: any): number;
  getSetting(path: string, def?: any): any;
  [key: string]: any;
}

interface TwCoreStore {
  loadStore(store?: any): void;
  save(): void;
  saveAll(): void;
  saveVisible(): void;
  autoSave(): void;
  tiddlersToSave(t: Tiddler[]): Tiddler[];
  [key: string]: any;
}

interface TwWorkspaces {
  workspaceCreate(name: string, clone?: boolean): any;
  workspaceLoad(name: string): any;
  workspaceSwitch(name: string): any;
  workspaceDelete(name: string): any;
  [key: string]: any;
}

interface TwPackaging {
  fetchPackage(opts: {url: string; name?: string}): Promise<any>;
  loadPackageFromURL(opts: {url: string; name?: string; filter?: string; overWrite?: boolean; doNotSave?: boolean; noOverWrite?: boolean}): Promise<any>;
  reloadPackageFromUrl(pck: any): Promise<any>;
  loadList(list: any, opts?: any): Promise<any>;
  [key: string]: any;
}

interface TwUtil {
  tiddlerExists(title: string, includeRawShadow?: boolean): boolean;
  tiddlerValidation(t: Tiddler): any;
  titleIs(title: string): any;
  titleMatch(title: string): any;
  tagMatch(tag: string): any;
  [key: string]: any;
}

interface TwLib {
  markdown(text: string): string;
  require(name: string, loader?: any): Promise<any>;
  highlight: any;
  [key: string]: any;
}
