# SimpleCanvas — Project Notes

Single-file HTML/CSS/JS canvas drawing app. Everything lives in `index.html` —
no build step or external runtime fetches. The MQTT.js browser client is vendored inline;
Node.js tooling and the local example broker are development-only.

## Current implementation

The branch/provenance notes below describe earlier development. The current app includes the merged
PR #2 changes: complete working documents and image/history state live in `tabDocuments`, independently
of browser storage. The current workspace autosaves as an atomic IndexedDB snapshot, with one
writable editor per browser profile, origin and application path. Other windows stay read-only;
**Take over editing** loads the latest saved workspace and retires the previous writer. Failed
autosave preserves the working documents and shows a persistent warning with a workspace-download
action. Corrupt snapshots stay protected until explicit recovery; imported legacy localStorage
data remains as a backup. Small session/localStorage ownership handoff receipts support reload
and graceful close/reopen; they contain no drawing data. The library uses its own separate
IndexedDB store. HTML readers keep session-local changes only and do not participate in editor
storage or ownership.

Native format 6 pools repeated scripts at storage/export boundaries: one `scripts` dictionary and
per-item `scriptRef` fields in sketch/workspace files, IndexedDB workspace snapshots and HTML
payloads. Live items stay hydrated with inline scripts; clipboard and library transfers remain
inline. Never walk arbitrary state to replace strings or keys. Reject invalid references/pools
atomically and preserve corrupt autosaves for recovery.

HTML export retains smart-shape scripts/state in an offline SVG runtime using the same Worker
sandbox, validators, and primitive/SVG renderers. Scripted controls run directly with `editing=true`;
`editorOnly:true` marks authoring-only children AND handles. Static exports filter marked children too.
`exportBehavior` is either `{move,rotate,resizeWidth,resizeHeight}` or a function of state returning
that object; all permissions default off. The ruler's marked editor controls set per-instance state
permissions, binding move and rotate to one toggle. The editor and export share Shift-to-15° rotation
snapping, including original group/own angles.
Rotation preserves script-local hit testing; resizing anchors the opposite edge.
Keep the canonical example sources, built-in catalog, and generated demo library scripts in sync.
Run `tools/update-builtin-catalog.cjs` after editing a source (use `--check` in validation).
Authoring templates reuse catalog scripts; main-demo instances carry validated `exampleSource` filenames
instead of a UID lookup table. Runtime normalization drops that generator-only metadata.
Previews remain inert PNG data URLs; their optional Pillow optimizer is development-only.

Validated smart capabilities use a bounded cache keyed by API marker, source and state; callers
receive independent copies. Stateful declarations must invalidate with state. Feedback faults
survive unrelated graph changes and recover on relevant definition/input changes or a new timeline.
Reader `data-smart-ready` identifies a completed paint for `data-smart-graph-revision`, not merely
an earlier successful render; clear it when invalidation/Step is requested. Unchanged reader
drawings may be reused only until their refresh deadline. See `tests/runtime-stability.test.cjs`
and `tests/feedback-controls.test.cjs` before changing these paths.

Workspace settings selects Active sketch only or Whole workspace execution at startup. Cross-sketch
signals/events use explicit Publish/Receive endpoints; shared datasets appear in other sketches'
pickers only when their owner exposes them in the workspace catalog. Accepted events own a captured
payload and baseline graph: they finish atomically while the page is hidden or the visible sketch
changes in Whole workspace mode. New activity and clocks pause while hidden. Page departure,
ownership loss, invalidated participants, or leaving an Active sketch only execution scope still
cancel pending work. Both editor and HTML reader follow these rules; see
[event visibility tests](tests/event-visibility.test.cjs).

**Run** opens a disposable workspace copy in an isolated iframe using the HTML export reader.
The parent editor is inert and its simulation pauses until **Return to editing**; returning
destroys the reader and restores authoring rather than merging reader state/history/data.
Result downloads remain explicit reader actions. Keep the return control outside the reader,
including during export failure or startup cancellation. Preview starts with the editor query,
but reader navigation must never rewrite the parent URL. Current-sketch scope applies when
workspace controls are disabled; read-only authoring can still be previewed. See
[Run preview](README.md#run-a-workspace-preview) before adding a second reader path or state merge.
At the Run boundary, cancel deferred editor clicks and unfinished native file imports, including
late image decodes; already accepted component actions and released placements settle before copying.
Keep parent keyboard, paste and import callbacks from mutating the suspended source.
Preview startup cancellation must also abort snapshot rendering jobs and release temporary script
executions; ordinary PNG/SVG/HTML exports retain their independent lifetimes.

HTTP GET/POST components declare `integrationApi:1` and use a detached host service. Never await
network completion in the graph, gesture queue or action dispatcher; Workers remain network-blocked.
GET supports bounded non-overlapping polling, debounced changes, pulse/event Refresh and opt-in
Run/HTML startup. Enabled gates automatic origins, while the direct Refresh button remains usable.
Restored signals establish baselines; configured polling can resume after its interval. POST requires
an accepted Send and captures its body/key/configuration; input changes, startup and Undo never write.
Do not retry automatically or imply that aborting a request reverses a server-side write.
Successful responses emit captured hybrid/completion events, including equal values; empty204/205
POST responses emit only completed('') without inventing mapped values. HTTP status stays available
when JSON/mapping fails after2xx. Schedules pause while hidden/paused without catch-up bursts.
Response snapshots and credentials stay outside source state/history/autosave. Unavailable source
data is withheld before evaluation, including through pure transforms; independently stored outputs
remain usable. Explicit consumers can retain event payloads. Credentials enter a saved artifact only
through its inclusion dialog, separately from polling/startup choices. Run owns a separate service
lifetime and credential store; opaque-origin CORS and native local-network permissions still apply.
See `tests/integration-foundation.test.cjs`, `tests/http-integration-runtime.test.cjs` and
`tests/http-automation-runtime.test.cjs`.
MQTT Config/Subscribe share host-owned connections through explicit `mqttBinding` sketch/component
references. Draft URL/client-ID changes apply only on Connect; retained/initial messages establish
readings without events. Keep generation checks, bounded reconnect, stale/unavailable value handling
and separate Run lifetimes. Credentials stay in the shared host store and only enter explicitly
selected saved artifacts. Worker scripts never receive a socket or credential.
Each graph pass captures its integration readings; incoming packets cannot change a later settling
round of that pass. Shared network redraw tasks coalesce behind accepted gestures, and MQTT
value-only consumers skip event preparation. Captured events retain their original topic/timestamp
as well as payload. See `tests/mqtt-event-receivers.test.cjs` and the continuous-telemetry and
queued-topic regressions in `tests/mqtt-runtime-browser.test.cjs`.
Regenerate all four self-contained demo readers after shared runtime changes.

**Duplicate sketch** creates a new sketch with independent component and owned-dataset IDs.
Connections within the copy follow its copied objects; references to other sketches remain external.
The singleton Workspace settings component stays in the original sketch. Export/import uses the same
identity-remapping rules; missing external sources remain visibly broken rather than silently retargeted.

PR #3 adds structured JSON plus PNG clipboard output, whole-workspace HTML export, and Markdown.
Paste validates SimpleCanvas JSON before using the PNG fallback. HTML export reads working documents
and passes each document's items/assets to SVG serialization; do not clear or swap the live asset pool.
Painted export bounds cover plain text and Markdown separately from geometry/pivot bounds. Markdown
requires an exact `---` first line in a text item; table cells are excluded in both renderer and editor.

In Select mode, endpoint clicks/taps cycle each line or open curve head through None, Open, Filled,
Open inverted, Filled inverted, then None. Endpoint drags retain the head style. Double-click/tap
the shape body to enter/leave point editing; anchor taps select points in that mode. A press on
the outline inserts an anchor (exact de Casteljau split, `insertAnchor`); Delete/Backspace, Alt-click or the × button
remove one (`removeAnchor`, min 3 closed / 2 open). A double-click on the outline must still leave the mode: its second
click withdraws the just-inserted anchor (`lastInsert`) and restores its prior Undo/Redo stacks.
The pending insertion belongs to its original document/item and is invalidated by another edit.
Delete/Backspace never delete the whole shape while Point-Edit is active, including auto-repeat. Keep rapid
endpoint/anchor taps out of double-tap detection. The line-style popover only controls width/dashes.

Group edit mode (double-click a grouped item; `editingGroupId`) browses one group's members
individually without ungrouping. The scene encoding never changes for it: a member of a ROTATED group
is drawn and hit-tested in its on-screen frame (`worldFrameOf`), and each gesture on it (drag, resize,
rotate, endpoint drag, nudge, delete, duplicate) folds the group's `groupRotation` into the members for its own
duration only (`bakeForGesture` / `unbakeAfterGesture`, `withGroupBaked`) -- the pivot is derived from
the members' union box, so editing one member with the rotation live would swing every sibling, while
leaving it folded in permanently would change how the whole group resizes afterwards. `unbakeMembers`
is the exact inverse (fixed-point pivot). Exits (`exitGroupEdit`, Escape, a click outside the box, a
tool switch) re-expand the selection to the whole group. Duplicates made inside the mode join the
group; a lone member on the clipboard is detached (`clonesOf`).

On a Mac, Control+click is treated as a secondary click everywhere on the canvas (`isSecondaryPress`):
it never starts a gesture and only finishes a polygon in progress via the always-suppressed
`contextmenu` handler. Duplicate-drag is therefore Cmd+drag on a Mac and Ctrl+drag elsewhere.

Automated Playwright regressions are checked in under `tests/`; see `tests/README.md` for Chromium
and WebKit commands and the remaining manual Office/iPad checks. They are development dependencies
only; opening `index.html` still requires no build step or runtime dependency.

## Review status

The current `feature/smart-components` stabilization pass covers runtime scheduling and fault
recovery, history ownership, atomic workspace persistence, browser tests, and generated-reader
contracts. [The design brief](docs/smart-components-brief.md) records the delivery decisions;
[the testing guide](tests/README.md) gives reproducible commands and
[the component reference](docs/components.md) documents the authoring controls.
The brief's 2026-10-21 review follow-up records final full-suite counts and the separately verified
wiring test-helper correction; keep that distinction when citing the validation result.
Automated checks do not substitute for physical iPad Safari, native Office paste, or physical print
verification. Historical branch notes below are background, not evidence of current review status.

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
- The historical `feature/next` branch was based directly on upstream
  `main` (`8132811`), rather than the old `feature/toolbar-overhaul` lineage.
  These commit references describe that development stage, not the current branch tip.
- The dblclick-on-empty-canvas → select-tool feature (from `Update-2`) was
  deliberately **not** ported onto this new base — left for oldwired to add
  upstream if/when they want it, since it would need reworking against the
  new shared `onDoubleClick` function anyway.

## Historical additions on top of upstream

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

The historical local `experiments` branch was created off `feature/next` at
`ce8afcb` so its work would not enter PR #2 automatically. Its implementation notes
below remain useful, but are not instructions about the current branch or merge base.

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
  `_italic_`, `- `/`* ` unordered lists, and `[label](url)` links. Links are styled
  on the editor canvas and clickable in SVG/HTML exports; PNG contains pixels only.
  Allowed targets are HTTP(S) and mailto, with bare domains treated as HTTPS.
  Runs still use one style each, without nested bold links. Also supported is
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
- Autosave writes complete workspace snapshots (including image assets) to IndexedDB. Wait for
  `persistWorkspace()` before reloads that must observe durable data; `readSavedWorkspace()` reads
  the stored record. Writes are atomic and fenced by owner/revision, so an older window cannot
  overwrite newer work. Quota/storage failures retain working tabs in memory and keep a visible
  recovery-download action. Legacy localStorage documents are retained, not rewritten on edits.

## Historical testing approach

Early development, before the checked-in Playwright suite, was verified via a Node + jsdom harness
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
- The old harness read `localStorage` for document assertions. Current browser tests instead await
  the IndexedDB save and read `readSavedWorkspace()`; use pixels when the rendering itself matters.

## Known open items (not yet done)

- Optional JPEG compression for photos remains deferred. IndexedDB workspace storage is implemented;
  browser quota failures still require the explicit download/retry workflow above.
