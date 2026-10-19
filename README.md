<div align="center">

# <img src="umatrix/img/icon_128.png" alt="" height="45" align="top"> uCanvasAuthority

<img src="https://img.shields.io/badge/version-1.0.0-4a9eff?style=flat-square" alt="Version">
<a href="LICENSE"><img src="https://img.shields.io/badge/new%20code-MIT-4a9eff?style=flat-square" alt="New code: MIT"></a>
<img src="https://img.shields.io/badge/manifest-v2-4a9eff?style=flat-square" alt="Manifest V2">
<img src="https://img.shields.io/badge/platform-Firefox-4a9eff?style=flat-square&logo=firefoxbrowser&logoColor=white" alt="Platform: Firefox">
<img src="https://img.shields.io/badge/no%20build%20step-raw%20source-4a9eff?style=flat-square" alt="No build step">

**Three privacy/security Firefox extensions merged into one: canvas-fingerprint
protection, a request firewall, and port-scan/tracker blocking — one toolbar
icon, one popup, one dashboard.**

</div>

---

> [!WARNING]
> There is no signed Firefox `.xpi` yet — it comes with the addons.mozilla.org listing. Until
> then Firefox loads uCanvasAuthority from the zip in [Releases](../../releases) as a temporary
> add-on, which lasts until Firefox restarts.

### Why uCanvasAuthority

Running CanvasBlocker, uMatrix and a port-scan blocker side by side used to
mean three toolbar icons, three popups, and three options pages that don't
agree on a look. uCanvasAuthority merges all three into one extension: one
`manifest.json`, one background page, one popup with three tabs, and one
dark theme.

> [!NOTE]
> This isn't a wrapper around three separate add-ons. CanvasBlocker and
> uMatrix keep their original code almost unchanged as subtrees; the glue
> (namespaced shared storage, the merged popup/dashboard, the composited
> toolbar badge) and Port Guard are new code written for this project — see
> [Licensing](#licensing) for why Port Guard isn't just a copy of its
> inspiration.

### What's merged

- **[CanvasBlocker](https://github.com/kkapsner/CanvasBlocker)** — blocks or
  randomizes canvas, WebGL, audio, history, navigator and other
  fingerprinting-prone APIs, per site.
- **Port Guard** (`portguard/`) — blocks JavaScript-based local port
  scanning and LexisNexis/ThreatMetrix tracking scripts, with an allowlist
  and a Block / Allow Once / Always Allow prompt for local navigations.
- **[uMatrix](https://github.com/gorhill/uMatrix)** — a point-and-click
  matrix firewall for blocking requests per site and per type (scripts,
  frames, cookies, XHR, …).

### Features

- **Matrix tab** — uMatrix's full request matrix, dashboard, and logger.
- **Canvas tab** — CanvasBlocker's protection status and settings.
- **Ports tab** — Port Guard's blocking toggle and allowlist.
- **Import / Export** (dashboard tab) — import a CanvasBlocker settings
  export, a uMatrix full backup, or a uMatrix "my rules" text export from
  the original, separate extensions.
- One shared dark theme and one composited toolbar icon showing both
  uMatrix's per-tab blocked-request count and CanvasBlocker's protected-API
  status at once, instead of three icons fighting over the same toolbar
  slot.
- No telemetry, nothing phones home — same as the three originals. The only
  outgoing requests are uMatrix downloading updates of the hosts files /
  public suffix list you have enabled in its "Assets" tab.

### Install

Download the zip from [Releases](../../releases), unzip, then:

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…**.
3. Select `manifest.json` in the unzipped folder.

Or clone the repo and load the raw source the same way — no build step needed.

> [!TIP]
> Temporary add-ons are removed when Firefox restarts. See
> [Licensing](#licensing) below before considering a permanent/store
> install.

### Project layout

- `canvasblocker/`, `umatrix/` — the original codebases, kept as
  near-verbatim subtrees.
- `portguard/` — port-scan/tracker blocking, written fresh for this
  project (`lib/` for the filtering logic, `popup/`/`settings/`/`prompt/`
  for its UI).
- `shared/` — storage-namespacing shim and the composited toolbar
  icon/badge.
- `import/` — the unified Import/Export panel.
- `popup.html` / `popup.js` / `background.html` / `manifest.json` — the
  rest of the glue tying all three into one extension.

See [CLAUDE.md](CLAUDE.md) for the full technical breakdown: file layout,
the storage-namespacing shim, the `getURL()` path gotcha, and the shared
theme variables.

### Release

Bump `version` in `manifest.json`, commit, and push a matching tag. The
[Release workflow](.github/workflows/release.yml) builds the zip with
`web-ext` and publishes it as a GitHub Release:

```bash
git tag v1.0.0
git push --tags
```

### Licensing

> [!IMPORTANT]
> This isn't legal advice — if you plan to redistribute this, verify it
> yourself or ask a lawyer.

| Component | License | Modification allowed? |
|---|---|---|
| CanvasBlocker | MPL-2.0 | Yes — and MPL-2.0 files here carry no "Incompatible With Secondary Licenses" notice, so they're combinable with GPL code. |
| uMatrix | GPL-3.0-or-later | Yes, standalone. |
| Port Guard (`portguard/`) + merge glue (`shared/`, `import/`, `popup.*`, `background.html`, `manifest.json`) | [MIT](LICENSE) | Yes — it's ours, and MIT is about as permissive as it gets. |
| uMatrix bundled assets (`assets/`) | Each list's own terms (see the files / `assets/thirdparties/*/README.md`) | Shipped unmodified, same as upstream uMatrix. |

The extension **as a whole** (the combined work, as distributed on
addons.mozilla.org) is released under **GPL-3.0-or-later**, since it
includes uMatrix; the MIT grant above still applies to the new code on its
own.

Port Guard wasn't the original plan — the idea was to port-scan-block the
same way CanvasBlocker and uMatrix are handled here: copy
[Port Authority](https://github.com/ACK-J/Port_Authority)'s code in
near-verbatim and wire it up. That fell apart on licensing: Port Authority
turned out to be **GPL-2.0-only** (confirmed via its LICENSE file and
GitHub's own license detection — no "or later" language anywhere in the
source or docs), and GPL-2.0-only doesn't stack with uMatrix's
GPL-3.0-or-later. GPLv2 doesn't permit relicensing under GPLv3 terms, and
GPLv3 only accepts GPLv2 code that explicitly says "or later version" —
Port Authority's code says neither, so combining it with uMatrix in one
distributed extension was a real license conflict, not a technicality.

With Port Authority's own issue tracker quiet and the author unreachable in
any reliable timeframe, `portauthority/` was dropped and replaced with
`portguard/`: an independent reimplementation of the same functionality
(port-scan blocking, ThreatMetrix/LexisNexis tracker blocking, allowlist,
the Selective Allow prompt), written from a behavioral spec rather than
from Port Authority's source. **This repo contains no Port Authority code,
text, or assets.**

What's left is the ordinary GPL-3.0/MPL-2.0 obligations that applied to
CanvasBlocker and uMatrix all along: keep their `LICENSE*` files and
per-file copyright headers intact, and make the corresponding source
available to anyone you distribute the built extension to (trivially true
here — nothing is bundled or minified). The new code — Port Guard and the
rest of the merge glue — is under the [MIT license](LICENSE) in the repo
root, so it (and only it) can be reused, modified, and redistributed
independently of the rest of this project too.

### Credits

- CanvasBlocker — © Korbinian Kapsner ([kkapsner](https://github.com/kkapsner))
- uMatrix — © Raymond Hill ([gorhill](https://github.com/gorhill))
- Port Guard (`portguard/`) is original code for this project, written
  after [Port Authority](https://github.com/ACK-J/Port_Authority)
  (© [ACK-J](https://github.com/ACK-J)) turned out to be license-incompatible
  with the rest of this extension (see [Licensing](#licensing) above); it
  reimplements the same idea, not the same code.

This repository adds the glue code described above — plus Port Guard — to
run everything as one extension.
