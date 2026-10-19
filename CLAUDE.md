# uCanvasAuthority

A single Firefox (Manifest V2) extension merging three previously-separate
extensions, each kept as a near-verbatim subtree:

- `canvasblocker/` — CanvasBlocker (canvas/WebGL/audio/history/navigator
  fingerprinting protection). Upstream: https://github.com/kkapsner/CanvasBlocker
- `portguard/` — Port Guard (port-scan + LexisNexis/ThreatMetrix tracker
  blocking, plus a Block/Allow Once/Always Allow prompt for local
  navigations). Original code written for this project — see
  "Licensing" below for why.
- `umatrix/` — uMatrix (matrix-based request firewall). Upstream:
  https://github.com/gorhill/uMatrix

Plus new glue code tying them together:

- `manifest.json`, `background.html` — one manifest, one background page
  listing all three subsystems' scripts (uMatrix's `<script>` list first,
  then CanvasBlocker's, then Port Guard's ES module last).
- `shared/storage-namespace.js` (classic script) / `storage-namespace.mjs`
  (ES module) — `browser.storage.local` key-prefixing shim (`cb:`/`pg:`/`um:`)
  so the three subsystems, which each assumed they owned the whole storage
  area, can't collide or clear each other's data.
- `shared/badge-composer.js` — draws the one shared browser-action
  icon/badge/tooltip (uMatrix's count top-right, CanvasBlocker's status
  bottom-right, Port Guard's block count bottom-left, tooltip messages
  concatenated), since only one subsystem could otherwise win each
  `setIcon`/`setBadgeText`/`setTitle` call. It clears the native badge on
  every redraw, so never call `browserAction.setBadgeText` directly.
- `assets/` — uMatrix's bundled assets (`assets.json` registry, public
  suffix list, default hosts files, recipes). Upstream uMatrix's build
  script (`tools/make-assets.sh`) adds these, they're not in its source
  tree; copied from `uMatrix-master/assets/assets.json` + uBlockOrigin/uAssets
  @ `84dc2761`. Must stay at the extension root: uMatrix fetches them via
  root-relative `vAPI.getURL("assets/...")`. Without them uMatrix has no
  PSL and no hosts lists, silently.
- `web-ext-config.mjs` — packaging: `npx web-ext build -c web-ext-config.mjs`
  produces the AMO upload in `web-ext-artifacts/`, minus dev-only files.
- `popup.html`/`popup.js`/`popup.css` — the merged popup: three tabs
  (Matrix/Canvas/Ports), each an `<iframe>` onto the original popup page.
  The container only grows to fit whichever tab needs the most room and
  never shrinks — switching tabs must not resize the popup.
- `import/` — unified Import/Export panel (CanvasBlocker JSON settings
  export, uMatrix full backup, uMatrix "my rules" text import), reachable
  as a dashboard tab. Reuses each subsystem's own existing logic
  (`settings`/`settingsMigration` modules, `vAPI.messaging` messages) rather
  than reimplementing parsers. Port Guard has no export format of its own
  (neither did Port Authority) and isn't covered.
- `umatrix/dashboard.html` — uMatrix's own dashboard shell (generic
  hash-routed iframe tabs), extended with Canvas/Ports/Import tabs pointing
  at `../canvasblocker/options/options.html`, `../portguard/settings/
  settings.html`, `../import/import.html`.

No build step: everything is loaded by the browser as-is (no bundler,
transpiler, or minifier). Load it via `about:debugging#/runtime/this-firefox`
→ "Load Temporary Add-on" → select `manifest.json`.

## The one thing to never forget: `getURL()`/root-relative paths

`browser.runtime.getURL(path)` / `vAPI.getURL(path)` and any WebExtension API
that takes a bare resource path (`browser.tabs.create({url})`,
`browser.contentScripts.register`, `browserAction.setIcon({path})`, etc.)
**always resolve relative to the extension root**, never relative to the
calling page. Since each subsystem used to *be* the extension root and now
lives in a subfolder (`canvasblocker/`, `umatrix/`, `portguard/`), any
such call needs that subfolder prefixed explicitly
(`"canvasblocker/options/options.html"`, not `"options/options.html"`).

This has been the single most common bug class in this merge — a page that
renders completely blank with zero console errors is almost always this:
check `location.href` in its devtools console, and if it's missing the
subsystem's folder prefix, find whatever `getURL()`/`tabs.create()` call
constructed it and fix the path. Plain relative links/`<script src>`/`<link
href>` *within* one subsystem's own HTML are unaffected — those resolve
relative to the page itself and don't need the prefix.

## Storage

Don't call `browser.storage.local` or `vAPI.storage` directly from new code.
Use `cbStorage` (CanvasBlocker, classic scripts — global once
`shared/storage-namespace.js` has loaded), `umStorage` (same file; uMatrix's
`vAPI.storage` is already wired to it in `umatrix/js/vapi-background.js`),
or `pgStorage` (Port Guard, `import { pgStorage } from
".../shared/storage-namespace.mjs"` — `portguard/lib/storage.js` wraps it
with JSON (de)serialization; use `readValue`/`writeValue`/`updateValue`
from there instead of touching `pgStorage` directly). Any page that touches
CanvasBlocker's `lib/settings.js` (directly or via `require("./settings")`)
needs `shared/storage-namespace.js` loaded first, with a correct relative path.

## Theme

One shared dark palette, defined as CSS custom properties in
`umatrix/css/common.css`'s `:root` block (`--bg: #23222B`, `--fg: #BFBFC9`,
`--accent: #4a9eff`, plus `--block-strong-bg`/`--allow-strong-bg`/etc. for
the matrix's semantic red/green). `common.css` is linked on almost every
uMatrix page, so new uMatrix CSS can just use `var(--bg)` etc. directly.
CanvasBlocker's own theme system (`canvasblocker/lib/theme.js`) has its
`dark` theme's variables (`canvasblocker/themes/dark/layout.css`) set to the
same hex values, and is the default (`settingDefinitions.js`'s `theme`
setting). Port Guard's pages (`portguard/{popup,settings,prompt}/*.html`)
link `umatrix/css/common.css` directly instead of duplicating the palette.

Don't reach for `filter: invert()` tricks — an earlier pass tried that for
uMatrix and it broke icon visibility (SVG icons got counter-inverted back to
invisible-on-dark) and couldn't control saturation on already-saturated
colors. Write real color overrides using the shared variables instead.

## Testing a change

There's no automated test suite. After editing, at minimum:
- `node --check <file>.js` for any touched JS file.
- A quick brace-count sanity check for touched CSS
  (`grep -o "{" file.css | wc -l` vs `grep -o "}" file.css | wc -l`).
- For manifest/HTML path changes, confirm the referenced file actually
  exists at that path (`ls`), since Firefox silently serves nothing for a
  bad `moz-extension://` path instead of erroring.
- Real verification needs a human to reload the temporary add-on in Firefox
  and click through — ask the user to do this and report back; there's no
  way to drive Firefox's own WebExtension runtime from here.

## Licensing (read before publishing anywhere)

This is a combined work of MPL-2.0 (CanvasBlocker) and GPL-3.0-or-later
(uMatrix), both released under licenses that are compatible for combination
(MPL-2.0 without an "Incompatible With Secondary Licenses" notice combines
freely with GPL code). `portguard/` is **not** a copy or derivative of the
original Port Authority extension (which was GPL-2.0-only, and incompatible
with GPL-3.0-or-later uMatrix) — it was independently reimplemented from a
functional spec after that incompatibility was found (see README's Licensing
section for the history), so there is nothing GPL-2.0-only left anywhere in
this tree. `portguard/`, `shared/`, `import/`, and the top-level glue files
are original code written for this project, released under the [MIT
license](LICENSE) at the repo root (scoped to just that new code — it does
not cover `canvasblocker/` or `umatrix/`, which keep their own LICENSE
files). No known license blocker remains for publishing; this isn't legal
advice, so if in doubt get an independent opinion before shipping.
