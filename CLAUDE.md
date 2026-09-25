# SimpleCanvas — Project Notes

Single-file HTML/CSS/JS canvas drawing app. Everything lives in `index.html` —
no build step, no dependencies.

## Provenance

- Upstream: https://github.com/oldwired/simplecanvas (maintainer: oldwired)
- This repo (`regattahero/simplecanvas`) is a fork with a large feature branch
  built on top of oldwired's `main` (as of the "Bugfixes" commit, ~2575 lines).
- The pull request with this branch's changes was merged into
  `oldwired/simplecanvas:main` (merge commit `672ce14`, "Merge pull request #1
  from regattahero/feature/toolbar-overhaul").
- oldwired kept committing directly to upstream `main` after that merge —
  touch/dblclick handling reworked into a shared `onDoubleClick(e, fromTap)`
  (real dblclick and a manually-detected double-tap both call it), the color
  picker rewritten as an app-drawn rainbow tile + hidden `input[type=color]`
  (`PRESETS` is now one `{hex:name}` map, not two parallel arrays), felt-tip
  draws with a chisel nib, a toolbar brand/logo. Latest upstream commit as of
  this note: `8132811` ("Double tap on touch closes the polygon cleanly and
  raises the keyboard").
- **Current branch (`feature/next`) is based directly on that upstream
  `main` (`8132811`)**, not on the old `feature/toolbar-overhaul` lineage —
  treat upstream `main` as the source of truth going forward and rebase new
  work on top of it, not on `Update-2`/old `feature/toolbar-overhaul`.
- The dblclick-on-empty-canvas → select-tool feature (from `Update-2`) was
  deliberately **not** ported onto this new base — left for oldwired to add
  upstream if/when they want it, since it would need reworking against the
  new shared `onDoubleClick` function anyway.

## What this branch adds on top of upstream

- **Text tool**: drag-to-create (like rect), own fill/stroke/border (default
  both off for new text), own text color (separate attribute from stroke),
  left/center/right alignment (click a selected text in the left/middle/right
  third to set it; a dblclick within 300ms cancels the alignment change and
  only opens the editor), precise vertical centering via
  `actualBoundingBoxAscent/Descent` (not the `middle` baseline, which sits
  visually high). Resizable via corner handles like a rect — font size stays
  fixed on resize.
- **Table tool**: deliberately still **click-to-place** (not drag) — this was
  an explicit choice, don't "fix" it back to drag. Cells can hold their own
  text + own alignment (`it.texts[r][c]`, `it.aligns[r][c]`), edited via
  double-click or long-press on a cell. Own font + text color, shared across
  the whole table (not per-cell).
- **Polygon**: can be finished "open" (no closing edge back to the first
  point) via a second toolbar button next to Finish/Cancel — `it.closed`
  (default `true` for old files).
- **Click-without-drag on a draw tool** (line/arrow/rect/ellipse/text) falls
  back to the select tool and selects whatever's under the cursor, instead of
  silently discarding. **Table is deliberately excluded** from this — a plain
  click there is the normal way to place one.
- **Rotation handle**: 30% bigger circle, 30% longer stem, hit-radius scaled
  to match (three call sites: drag-start, dblclick-reset, both in `onDown`/
  dblclick handler).
- Toolbar: icon+color-bar design for Fill/Stroke/Text-color (neutral glyph,
  separate colored bar underneath — not a tinted glyph). Vertical slider for
  stroke width (real native vertical range input via
  `-webkit-appearance:slider-vertical` + `writing-mode:vertical-lr`, not a
  rotated horizontal one — the rotate-hack doesn't reliably fill its declared
  length in Chrome/Windows). App starts on the select tool if the canvas
  already has content, pen otherwise.
- SVG export updated to match: text/table now export fill+stroke+textColor+
  alignment (SVG `text-anchor` needs `start/middle/end`, not our internal
  `left/center/right` — see `svgAnchor()`).

# Änderungen seit upstream `8132811`

- Shape-Library: Auswahl als wiederverwendbare Form speichern, per Klick aus Toolbar-Popover platzieren
- Edit Points: Linie/Pfeil/Rechteck/Ellipse/Polygon per Doppelklick in editierbare Bézier-Kurve umwandeln
- Polygon: Fertigstellen landet jetzt im Select-Modus mit ausgewähltem Polygon; Doppelklick-Schließen fügt keine überflüssige Ecke mehr hinzu
- Linien-Strichelung: Muster-Auswahl (durchgezogen/eng/weit) im Stiftbreite-Popover, Pfeilspitzen bleiben immer durchgezogen
- Snap-Ziele einblenden: beim Ziehen eines Linien-/Pfeil-Endpunkts zeigt das gehoverte Objekt seine Magnetpunkte an
- Shape-Library-Fixes: ein gerade gespeichertes Shape verschwindet nicht mehr aus der Liste beim erneuten Öffnen; das Werkzeug bleibt nicht mehr hängen (bzw. platziert kein altes Shape erneut), wenn das Popover ohne Auswahl geschlossen wird
- Strg/Cmd-Resize um den Mittelpunkt, kombinierbar mit der bestehenden Shift-Proportional-Sperre

**Warum das Doppelklick-Verhalten beim Polygon geändert wurde**: Am Desktop ließ das Schließen eines Polygons per Doppelklick beide Klicks des Doppelklicks als „Punkt setzen" durchgehen, wodurch noch eine überflüssige Ecke an der Klickposition entstand — nur beim Touch-Doppeltipp war das bereits abgefangen. Der Fix gleicht Maus und Touch an: Der Klick, der das Polygon schließt, setzt keinen eigenen Punkt mehr, sondern schließt direkt zur zuletzt bewusst gesetzten Ecke.

## Branch `experiments`

Local-only, not pushed into `oldwired`'s PR #2 — created off `feature/next`
at `ce8afcb` specifically so further work here does **not** flow into that
PR automatically. Rebase future upstream-tracking work onto `feature/next`,
not this branch.

- **Copy (Ctrl+C) also writes to the real OS clipboard**: `text/plain`
  carries our own JSON (what our own paste handler looks for first);
  `image/png` is a universally-supported fallback so pasting into another
  app (Word, PowerPoint, ...) shows the actual graphic instead of nothing.
  A `text/html` entry with inline `<svg>` was tried and then removed —
  Office's paste-special never picked it up as vector content anyway
  (showed an empty box), so `image/png` alone covers this now.
- **HTML export** (`exportHtml()`, new menu item) — a standalone `.html`
  file that opens in any browser, no SimpleCanvas needed. Reproduces the
  canvas **1:1** at its current `cssW`×`cssH` viewport size (no auto-crop) —
  deliberately different from SVG export/copy, which still tight-crop to
  the items' own bbox + margin. `itemsToSVGMarkup(itemList, {width, height})`
  is the shared builder behind both: the opt-in full-canvas mode skips all
  bbox/crop math; the default (no `{width,height}`) stays the original
  tight-crop, used by `saveSvg()`/copy.
- **Markdown in a plain text item**: recognized only when the item's first
  line is bare `---` (matches YAML front-matter, deliberately not
  `---markdown`). Supports `#`/`##`/`###` headings (forced bold, sized
  1.6/1.3/1.15× the item's own font size), `**bold**`, `*italic*`/
  `_italic_`, `- `/`* ` unordered lists, `[label](url)` links (styled, not
  clickable — v1 limitation: one style per run, no nested bold-links), and
  a `---` line *inside* the body (never the first physical line, which is
  the marker) as a horizontal rule. Forces left+top alignment — both saved
  and LIVE while editing, the instant the first 3 typed characters are
  `---` — regardless of the item's own chosen alignment. Table cells are
  explicitly excluded; Markdown only ever applies to plain text items. No
  new per-item field — detection is fully derived from `it.text` at render
  time (`markdownBodyOf`), so `normalizeItem` needed no changes.
  - Horizontal rule's vertical alignment: sized to the font's own cap-height
    (`actualBoundingBoxAscent`), not the full `1.2×fontSize` line-height a
    real text line needs (that also carries descent + leading a rule
    doesn't), and positioned at 15% down that footprint rather than
    dead-center — the block preceding a rule already carries its own
    trailing line-height slack, which would otherwise stack with the rule's
    own top-padding and read as too much gap above vs. below it.

## Kept from upstream, worth knowing about

- **UID-based selection** (`ensureUids`, `selectByUids`, `selectedUids`):
  selection survives undo/redo correctly even when the items array reorders.
  Our new interaction code still uses plain array indices during a live
  gesture (`selection = [idx]`) — that's fine, upstream's UID resolution only
  kicks in at undo/redo boundaries.
- **`normalizeItem`/`normalizeScene`**: strict validation on load (rejects
  malformed saved files instead of crashing). Any new per-item field
  (`textColor`, `align`, `texts`, `aligns`, `closed`, `strokeOn`, table's
  `fontFamily`/`fontSize`/`font`) **must be added here explicitly** or it
  gets silently dropped on save/reload.
- **`segCircleCuts`**: the eraser does real segment↔circle intersection, not
  just per-vertex distance — it correctly splits a stroke erased mid-segment
  even when neither endpoint is near the eraser. Don't regress this to a
  naive vertex-only check.
- Autosave writes the whole scene (incl. base64 images) to `localStorage` on
  every change — has a hard ~5-10MB browser quota, shows a toast on failure.
  Discussed but not yet implemented: moving to IndexedDB (much higher quota)
  and/or JPEG compression for photos would fix this properly.

## Testing approach used this session

No formal test suite — verified interactively via a Node + jsdom harness
(`npm install jsdom` in a scratch dir, load `index.html` with
`runScripts:'dangerously'`, dispatch synthetic `PointerEvent`/`MouseEvent`s,
read back canvas pixels via `getImageData` or inspect `localStorage`). Useful
gotchas hit repeatedly:
- jsdom needs a `url` option (e.g. `http://localhost/`) or `localStorage`
  throws.
- `canvas.getBoundingClientRect` must be stubbed (jsdom returns all-zero
  rects otherwise), before firing any pointer events.
- Selection-outline pixels are `#6366f1`ish and will contaminate color
  sampling near a selected item — deselect before sampling fill/stroke/text
  colors from pixels.
- Prefer reading `localStorage` (`JSON.parse(...).items`) over pixel-sampling
  when checking data correctness — much less fragile than guessing exact
  glyph/cell pixel coordinates.

## Known open items (not yet done)

- IndexedDB storage / JPEG compression for the localStorage-quota issue
  (discussed, not implemented).
- No formal automated test suite checked into the repo — the jsdom checks
  above were ad hoc, run in a scratch dir outside the project.
