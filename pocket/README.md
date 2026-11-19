# FM-1 Pocket Player: what this fork adds

This repository is a fork of Jake Handy's [FM-1 Browser Simulator](https://github.com/jakehandy/fm1-browser-simulator)
(MIT). It adds a firmware library: a searchable picker over a catalogue of `.rfm1` builds that is refreshed
nightly. Everything Jake's simulator does is kept as it was.

## New files

| Path | What it is |
| --- | --- |
| `src/pocket-picker.js`, `src/pocket-picker.css` | The picker: search, favourites, New badges, categories, a preview with a Play button, the credits footer. |
| `pocket/catalog.mjs` | Builds `data/catalog.json` and `data/fw/` from a folder of approved `.rfm1` files and RemoteFM1FW's card text. |
| `pocket/tests/` | Tests for the above (`npm run test:pocket`). |

`data/` is generated (by the nightly job, Stage 2) and is never committed.

## Changes to Jake's files

Kept small so GitHub's **Sync fork** keeps working. Each is marked with a `pocket:` comment.

**`src/app.js`**
1. `bytesOf()`: a catalogue download runs only if its SHA-256 matches the catalogue.
2. `renderList()`: hands the list to `window.FM1Pocket.render` when the picker is loaded.
3. `removeEntry()` and `window.FM1Sim`: the remove action as a function, and the few things the picker may use.
4. Startup: the catalogue's entries join the library before the first firmware is picked; `?fw=<id>` also finds catalogue ids.
5. `describe()`: the tab title uses `window.FM1_SITE_NAME` when set.

**`index.html`**: the page title and link-preview text say FM-1 Pocket Player; the picker's CSS and JS are
linked; `window.FM1_SITE_NAME` is set on its own line (so `tools/build.js` still finds the `FM1_BUILTIN` line).

**`package.json`**: a `test:pocket` script. **`.gitignore`**: `data/`.

If a merge from upstream conflicts, keep Jake's new code and re-apply the marked lines above.

## Trying it locally

```
node pocket/catalog.mjs --rfm1 <folder of .rfm1 files> --meta <RemoteFM1FW>/catalog/catalog.json --out data
python3 -m http.server 8000      # then open http://localhost:8000
```
