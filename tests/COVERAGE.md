# Regression coverage catalog

[Testing guide](README.md) describes setup, commands and test conventions. This catalog records
the detailed scenarios protected by the suites.

## Drawing, clipboard and deployment

`regressions.test.cjs` covers core drawing, clipboard, export, library and deployment interactions.
Clipboard tests intercept the browser's clipboard write and replay its real JSON/PNG payloads through
paste events, so they do not change the OS clipboard. HTML tests open actual exported files and check
embedded assets, tab switching, group transforms, and current document data after storage failures.
Markdown checks cover cropped PNG/SVG/clipboard output and editor alignment. Native Office paste
still requires a manual integration check.

An iPad-sized touch scenario exercises endpoint cycling and double-tap point editing in Chromium
and WebKit. Mouse checks cover undo/reload/import, curve tangents, and preserving heads during drags.
Raw touch-drag and library-hold scenarios use Chromium's CDP interface and are skipped in WebKit. A physical iPad
Safari pass is still needed before release to check native touch behavior and the on-screen keyboard.

For the smart-shape rendering and library-preview benchmark, run
`node tests/performance.cjs 0e557fe` (replace the argument to compare another Git revision).
It compares the current file with that revision using ten race timers over 200 warmed repaints,
then 40 preview completions and ten picker reopens. It reports drawing rebuilds, serialized data,
PNG decodes, grid rebuilds, and elapsed time; timings depend on hardware and are not pass/fail limits.
The preview scenario supplies synthetic PNG jobs to isolate picker work from script execution and
rasterization. The normal regression suite covers actual generation, consent, source-edit races,
canvas/SVG/PNG output, and retaining focus while previews complete.
It also checks the shipped demo under a GitHub Pages subpath, inert bundled previews, smart-shape
editing and undo, drawing with only the HTML file deployed, and an import arriving before a delayed
library response.
The contributor shapes bundled into the demo must match their `.js` example sources; their actual
handles, undo/redo, sketch exports, and saved state are exercised from the shipped library file.
Demo checks retain thirteen pins while distinguishing eight personal definitions from five reused
canonical built-ins, including category overrides and import/export without duplicate catalog entries.
Timed-shape checks cover autonomous redraws, interval bounds, hidden/inactive document cleanup,
unchanged history/storage for presentation-only refreshes, live clock updates, stopwatch controls and timestamp recovery, matching
example/template sources, and ruler units and resizing. Physical-scale checks measure full-inch
tick spacing in an actual 2× PNG and preserve fractional SVG dimensions for actual-size printing.
Print-preview checks cover the Actual size/Landscape defaults, actual-size units, fitting and the
oversize clipping override, paper/orientation and margin changes, reference marks, image assets and
pending text, frozen smart shapes, retained drawing and history/storage, and close/reopen races.
Tiled-print checks cover physical scale, repeated overlap, matching alignment coordinates, page
navigation and labels, exact tile boundaries, zero overlap, calibration on every sheet, excessive
page counts, and including all sheets in actual Chromium PDF output. Native printer-driver scaling still requires a physical
print check at 100% / Actual size.

Deployment-settings checks cover the feature switches independently, native browser printing when
custom printing is disabled, fixed-library smart handles, preservation and recovery of hidden tabs,
active-sketch exports, delayed and invalid settings,
timeout recovery, custom titles, the Really Simple deployment, and opening the actual standalone
HTML directly from disk.

## Connected components and wiring

Connected-component regressions in `tests/components.test.cjs` cover the Number control → Gauge
input-picker workflow, scalar computation, actual drawing/SVG results, JSON and undo/redo,
duplicate/clipboard binding remapping, cross-tab UID isolation, and downloaded offline HTML.
They check rapid changes, unsupported-version recovery, legacy raw-state compatibility, missing
or incompatible ports, source deletion, non-settling loops, and isolation of failed computations. Native files
retain component API markers and wiring; earlier drawing formats remain readable.
The `smartComponents` deployment switch is checked for disabled authoring, preserved legacy
authoring, and working saved connections, copies, deployed-library placements, and offline HTML.

`tests/component-wiring-contracts.test.cjs` and `tests/component-wiring-runtime.test.cjs` cover
visual wiring's typed flow/Dataset distinction and its use of existing bindings: bidirectional
drag gestures, incompatible types, replacement/disconnection with Undo, and omission of the
authoring overlay from exports. Sketch settings separately enables an optional read-only reader layer.
Component double-click/double-tap interaction remains available with wiring visible, alongside
overlap selection, control use, and port/link gestures.
Wire selection checks reacquire detached SVG geometry after graph settlement and confirm the
intended selection before Delete; they never retry the mutating click or deletion.
`tests/component-wire-reconnect-runtime.test.cjs` covers moving a wire from its connected input,
atomic replacement and Undo/Redo, cancellation, hybrid/event inputs, stored Dataset associations,
and stale asynchronous validation.
They also check explicit data/control roles and side overrides, rotated four-sided port banks,
LED matrix column placement, and self-feedback paths that stay outside the component.

## Geometry, icons and exported interaction

Icon-import regressions compare the browser-rendered source SVG with native canvas, SVG and PNG
output after library/sketch roundtrips and point-edit conversion. They also exercise delayed
imports across Close, Escape and library replacement. Sketch format 3 retains polygon fill rules;
format 1 and 2 drawings remain readable.

Icon search checks cover multicolor imports, filtered pagination with retry/stale responses,
animation exclusion, and confirmation/cancellation of simplified static imports. Preview checks
verify that the confirmed native geometry is what library export preserves.

Point-edit checks cover off-center insertion on straight, diagonal and rotated outlines;
mouse/touch double-click exit; held Delete/Backspace; Undo/Redo preservation including a full
history stack; intervening edits; and retaining unrelated smart-instance execution state.

Live HTML regressions open actual downloads from disk with no network dependencies. They cover live
clocks and stopwatch controls, locked layouts, ruler permission controls and persistence, rotated
movement, independent rotation permissions, rotation cancellation, absolute Shift-to-15° snapping
shared with the editor, independent height resizing, and width extension at fixed scale,
editor-only visuals/actions, static script permissions,
state across tabs with colliding UIDs, script/source escaping, and hung-script fallback and isolation.
Rotated-interaction checks use the pointer coordinates delivered by the browser. WebKit's injected
native mouse events use whole CSS pixels, so fractional requested coordinates are not an exact reference.
Movement, free rotation, resize amounts, and scripted values are checked against the delivered
events; anchoring, snapped angles, and vector scale keep their strict numerical assertions.

Toolbar checks cover table and mixed-selection font edits, Undo/Redo and file persistence;
exclusive popovers; custom-color panel cleanup; and file-menu keyboard focus and accessibility state.

## Workspace authoring

`tests/new-workspace.test.cjs` checks the Workspace and Current sketch menu groups,
keyboard navigation on a small screen, and **New workspace…** confirmation. Cancel preserves tabs
and history; **Save & start new** produces a complete workspace JSON download, including an active
text draft, before resetting to one blank **Sketch 1**. Download setup failures leave the dialog
and workspace available for retry. Reset checks cover fresh histories, browser-storage write
ordering and recovery, stale workspace-import cancellation, and preservation of personal library
entries and Working collection pins across reload. **Clear current sketch** stays limited to the
active tab and supports Undo. Confirmation pauses simulation; Cancel restores its prior pause state.
Creation shortcuts respect typing, key repeats, and workspace settings. Open/save shortcuts and
HTML-export checks distinguish workspace scope from the current sketch, including
when workspace mode is disabled. Disabled workspace controls cannot reset the preserved tabs.
Automated download checks validate the emitted file; the browser still controls whether a real
user's download finishes.

`tests/tabbar-overflow.test.cjs` covers tab scrolling controls and edge fades, responsive overflow,
full names in All tabs, keyboard navigation and focus after tab changes, and active-tab visibility.
It exercises the editor and actual offline HTML downloads, including live-component activation.

## Library placement and persistence

Library browser regressions in `tests/library-browser.test.cjs` exercise direct placement from the
expanded catalog, inert browsing, pin membership and format 2 export/import, legacy libraries,
metadata edits, preserved built-in snapshots, and authoring-disabled placements. They build the
threshold/AND/indicator example through Edit and operate the actual downloaded HTML offline.
`tests/library-organization.test.cjs` covers multiple memberships, create/rename/remove, built-in organization overrides,
empty-category preservation, legacy single-category imports, and separate search Keywords.
Removing a category preserves shapes, pins, and other memberships. Shared Library actions,
Source filtering, and Collapse library are checked without changing the compact picker workflow.
Workspace saves retain placed scripts/state/connections but exclude library entries, pins, and
category organization; those have separate browser persistence and library export/import.
Individual transfer checks in `tests/library-transfer.test.cjs` use real shape downloads and
file imports. They cover source-aware Copy/Duplicate actions, additive imports and name
collisions, preserved categories and attribution, inert smart previews, independently wired
group placements, unresolved external connections, invalid-file rejection, and feature guards.
Exporting one shape leaves the library's unexported-change status intact.

`tests/library-drag.test.cjs` covers thumbnail dragging from the Working collection and full
library browser, release coordinates, grouped ordinary shapes and connected smart components,
fresh initialization and wiring identities, one-step Undo/Redo, and cancellation without running
scripts or changing the drawing. Click-to-place and keyboard placement remain available. Chromium
touch-event coverage checks hold-to-drag placement and quick swipes for scrolling in both views.
It also checks first drags across harmless grid refreshes and delayed text alignment, while
filtered-out entries still cancel. Dataset reload coverage checks that a background refresh
cannot swallow a drag or an accepted drop waiting for component initialization.

`tests/library-persistence.test.cjs` checks automatic IndexedDB storage of personal definitions,
scripts, inert previews, categories, built-in overrides, and Working collection pins across reloads.
It covers restored-library precedence over hosted starters, URL-path isolation, fixed/disabled
library settings, and visible save-failure recovery. Export status remains separate from browser
save status; restoring library data does not execute smart scripts or bypass preview consent.

Focused template-catalog checks cover the seven added entries: Clock, Arrow, Arc, Timer,
Chart, Minimal, and Blank. They verify source parity and
availability for direct placement and pinning in the current offline catalog.
`tests/library-components.test.cjs` checks bundled/example source parity, sandboxed boolean truth
tables for all eight gates, numeric inversion, threshold boundaries, Math operations and arithmetic
errors, visible unavailable inputs, and editor-only configuration controls. Indicator and naming
tests cover per-instance choices, save/reload, and HTML behavior. Component tests validate string
input choices from literals and bindings in the editor and offline exports. Failure tests ensure
unavailable views replace stale results, recover correctly, and leave independent controls usable.
`tests/numeric-formatting-contracts.test.cjs` checks consistent display rounding, exact safe
integers, extreme finite values, literal strings, explicit Spreadsheet formats, and preservation
of calculated signals and editable values. `tests/numeric-formatting-runtime.test.cjs` checks
the 2.8 → 56% example through real Workers in the editor and offline HTML, unchanged numeric
edits, and full-precision Dataset/Spreadsheet values in CSV/JSON downloads.
`tests/text-input-contracts.test.cjs` and `tests/text-memo-contracts.test.cjs` cover typed
submission queues, validation, literal text, Memo trigger priority, blank lines, and bounded storage.
`tests/text-components.test.cjs` checks editor and offline-reader entry, repeated submissions,
Pause/Resume, independent instances, restoration without replay, and literal rendering. Text and
Number input entry happens in place, with Enter/Submit keeping focus and Escape/outside-click
discarding drafts. Appearance settings control optional submission state, counts, names, and hints;
errors remain visible when those details are hidden.
`tests/memo-scrollbar-runtime.test.cjs` checks the optional Memo scrollbar input in Edit and a connected Toggle,
dragging through stored text without changing outputs, persisted reading position, following
new lines only at the bottom, and the same interactions in downloaded offline HTML with wiring visible.
`tests/memo-log-contracts.test.cjs` covers optional rolling line retention, normalized and blank
lines, limits checked after eviction, atomic rejection, and retained scroll anchors.
`tests/memo-log-runtime.test.cjs` checks the Edit setting, hybrid events and Append triggers,
Undo/reload without replay, and the same logging behavior in downloaded offline HTML.
`tests/component-event-contracts.test.cjs` covers typed transient payloads, deterministic event
ordering, staged atomic delivery, cancellation, and bounded feedback. Shared-origin contracts cover
unequal branches, multiple outputs, receiver port ordering, stored-value boundaries, later occurrences,
required value-only companions, pruning unrelated failures, and the calculation budget. `tests/component-events.test.cjs`
uses real Workers and inline controls in the editor and offline HTML: repeated text and precise
numeric submissions, immediate delivery while signals are paused, preserved traditional triggers,
intentional duplicate operations when both paths are connected, one-step Undo, copy remapping,
reload without replay, Memo limits, and receiver failures without partial edits.
`tests/component-event-wiring-contracts.test.cjs` and `tests/component-event-wiring-runtime.test.cjs`
check unified hybrid pins, typed connections, Receive events
choices in Edit, dedicated custom event ports, and the read-only HTML wiring layer. `tests/component-event-lifecycle.test.cjs`
covers custom click and modal input handles, error rollback with timer resumption, retained user
Pause, and switching tabs during a committed event's refresh.
`tests/event-visibility.test.cjs` holds accepted event delivery across browser hiding and sketch
navigation in both editor and HTML reader. Whole workspace navigation preserves the captured
transaction; leaving Active sketch only execution, pagehide (including a cached-page return),
ownership loss, or participant deletion cancels it atomically. Hidden pages pause new activity and
clocks, and deferred follow-up actions wait for visibility.
`tests/component-hybrid-events.test.cjs` covers captured payloads through text/numeric transform chains,
parameter changes that only update current values, Boolean/event Reprocess modes, current-value Memo
sampling, equal-result occurrences, strict types, atomic failures, Undo/reload without replay, command
pulse suppression, and incremental evaluation that skips unrelated or unchanged branches. The extractor
walkthrough runs in both editor and offline HTML. Text compose tests submit through either input
with Live clock on the other, retain repeated equal submissions, and verify that clock ticks do
not append. Unequal branches rejoin once in both scene orders, including Pause, Undo/Redo, reload,
and offline HTML. Inspector mode/count changes preserve hybrid inputs and individual Receive events
choices. `tests/hybrid-builtin-contracts.test.cjs` checks each built-in's driving inputs, event
outputs, Reprocess declaration, and pure computation contract.
`tests/event-builtins-contracts.test.cjs` and `tests/component-event-builtins-runtime.test.cjs`
cover Dropdown and selector events, repeated choices, dataset-backed lists, both adapters,
paused queues, first events before initial simulation, queue limits, and Counter/Timer completion
in editor and offline HTML. `tests/component-transition-events.test.cjs` checks captured completion
through self-reset feedback, Step followed by a later edit, cancellation, and invalid emissions.
Rejected completion notifications roll back their event receivers while retaining the accepted
simulation state and downstream signals; editor and reader expose a delivery error.
`tests/component-action-events-contracts.test.cjs` and `tests/component-action-events-runtime.test.cjs`
cover typed Dataset import/reload and Capture row results, failures, cancellation, and Undo.
`tests/component-wire-activity-contracts.test.cjs` checks bounded transient wire inspection records;
the event wiring runtime tests verify committed activity, safe payload text, failure rollback,
values-only appearance, and read-only HTML inspection.
`tests/text-operations-contracts.test.cjs` covers all comparison modes, whole-input regex semantics,
zero-based Unicode ranges and capture groups, empty/unmatched results, validation limits, and
literal rendering. It verifies that capability discovery and drawing never compile user-supplied patterns,
and Number to text preserves finite numeric values without display rounding in its default mode.
`tests/text-operations-runtime.test.cjs` exercises library placement, mode-specific Edit inputs,
real Worker computations, independent instances, error recovery, and inline controls in downloaded
offline HTML, including Number input → Number to text → Text label. Clicking another control while Enter is pending must preserve the submitted value
in both hosts, including SVG repaint during acceptance; removal must not redirect the click to
a replacement component. A pathological regex verifies Worker termination while unrelated components and
the main thread remain responsive.
## Shipped examples

The Text matching and extraction tab in `tests/example-workspace.test.cjs` exercises connected
case-insensitive comparisons, whole-input regex validation, capture selection, Unicode range
extraction, edited values, and no-match recovery in both the editor and offline reader.
The Text processing and formatting tab covers strict comma-decimal parsing, fixed formatting,
template composition, the selector's invalid-input fallback, and literal/regex replacement after
editing either source, in the editor and offline HTML. `tests/text-processing-contracts.test.cjs`
also covers all composition/replacement modes, bounds, Unicode case conversion and lengths, and
native replacement references. `tests/text-conversion-contracts.test.cjs` covers strict parsing and
formatting without changing numeric source signals. Split/join collection outputs remain deferred
in the brief.
`tests/components-inputs.test.cjs` covers readable choices for repeated source names and live
unsaved output/error feedback for bindings and typed literals. It checks Save/Cancel isolation,
late replies, dynamic port changes, and pure inspection of a stateful selector without stepping it.
`tests/component-edit-layout.test.cjs` checks dense and simple inspectors, narrow choice lists,
fixed footer actions during pending previews/errors, focus retention, and independent Save/Cancel drafts.
A catalog-wide naming check renames captioned built-in API v2 components through Edit and verifies each
caption on canvas, in SVG, and in offline HTML.
Tri-state checks distinguish healthy Z from missing inputs and false, validate output metadata,
connect consumers while disabled, and exercise recovery in the editor and offline HTML. Other
invalid inputs and non-settling loops must not be hidden by a Z input.

## Timing, logic and numeric components

`tests/live-clock.test.cjs` checks timezone inputs, second pulses connected to Counter, synchronized
time-string consumers, independent instances, invalid-zone validation, reload, and offline HTML.
The browser-independent `tests/live-clock-contracts.test.cjs` controls wall and active-document time
separately to check local/IANA formatting, DST and noon/midnight boundaries, pulse widths, missed
ticks, timezone changes, fresh observation, and pure snapshots.

`tests/stopwatch.test.cjs` checks run/reset input connections, manual Start/Pause and Reset,
published elapsed seconds, independent instances, saved timestamp recovery, and offline HTML.
The browser-independent `tests/stopwatch-contracts.test.cjs` uses controlled wall time to check
pause/resume totals, milliseconds, command/manual precedence, held reset, and pure computation.
The tests distinguish the live display from the single stopped-result output: presentation
refreshes do not publish running elapsed time, schedule tick transitions, or autosave each tick.

`tests/timer.test.cjs` checks the countdown's settings and dial controls, run/reset bindings,
manual actions, connected tick/reached outputs, saved progress, and offline HTML.
The browser-independent `tests/timer-contracts.test.cjs` uses controlled time for unit boundaries,
short tick pulses, pause/resume, zero/restart, held reset/run, configuration resets, missed ticks,
reload observation, and pure settled snapshots.

`tests/temporal-components.test.cjs` exercises the bounded transition contract, transport Delay,
rising-edge Counter/reset, Random integer, both typed Sample & hold entries, and Trigger pushbutton
pulses. Trigger checks cover rapid clicks, held presses, idle output, restoration, and offline use. It covers per-instance
memory, active-document time, stale evaluation rejection, pure snapshot paths, and ordered editor/
offline interaction. Run it with `node --test tests/temporal-components.test.cjs`; prefix with
`BROWSER_ENGINE=webkit` for WebKit.

`tests/counter-modes.test.cjs` checks up/down counting, configurable countdown starts, zero clamping,
reset and held-input behavior, and configuration changes that coincide with rising edges. It uses
the real Edit dialog and Trigger controls, then verifies saved progress, undo/redo, reload, and
offline HTML countdown/reset behavior. Run with `node --test tests/counter-modes.test.cjs`, optionally
prefixed with `BROWSER_ENGINE=webkit`.

`tests/shift-register.test.cjs` checks Boolean and numeric cascades using a shared pulse and
current `value`, independent stored stages, pure inspection, and restoration without phantom shifts.
Editor checks configure stages through Edit, connect a parallel output, and exercise Trigger
sampling, JSON reload, and actual offline HTML shifting/reset. Run with
`node --test tests/shift-register.test.cjs`, optionally prefixed with `BROWSER_ENGINE=webkit`.
The browser-independent `node --test tests/shift-register-contracts.test.cjs` checks stage
limits, simultaneous shifts, held reset, reconfiguration, finite numeric values, and state isolation.

`tests/led-displays.test.cjs` exercises both seven-segment input modes and Boolean/row-byte matrix modes
through the real Edit dialog and sandbox. It checks segment/pixel positions, enable masking,
mode changes, unavailable inputs, saving, and interaction in offline HTML. Run with
`node --test tests/led-displays.test.cjs`, optionally prefixed with `BROWSER_ENGINE=webkit`.
The browser-independent `tests/seven-segment-contracts.test.cjs` and
`tests/led-matrix-contracts.test.cjs` cover digit patterns, every pixel, input bounds, and pure rendering,
including row/column byte conversion and all sixteen matrix outputs.
`tests/led-matrix-runtime.test.cjs` adds column mode editing, save/reload, top/bottom wiring,
and offline HTML orientation and connected column-value updates. Run with
`node --test tests/led-matrix-runtime.test.cjs`, optionally prefixed with `BROWSER_ENGINE=webkit`.

`tests/catalog-extensions.test.cjs` checks configurable channel counts through the real Edit
dialog, library placement, undo/redo, removed-output errors, pulse-driven stepped routing,
and typed numeric entry in the editor and downloaded offline HTML. It also checks dialog
cancellation when visibility changes and connects the new pulse sources to counters.
Run it with `node --test tests/catalog-extensions.test.cjs`, or prefix with
`BROWSER_ENGINE=webkit` for WebKit.

The browser-independent `tests/numeric-extensions.test.cjs`, `tests/routing-components.test.cjs`,
and `tests/signal-generators.test.cjs` exercise arithmetic boundaries, all routing positions,
reset/re-prime semantics, and pulse scheduling with controlled time. The library suites also
verify that every API v2 catalog definition matches its editable source file. Captioned components
retain their instance names in canvas, SVG, and offline HTML; Spreadsheet deliberately uses its
whole box for the cell grid and is excluded from the caption check.


## Feedback and simulation

`tests/feedback-runtime.test.cjs` exercises bounded settling, simultaneous stored-state publication,
unknown Boolean logic, and gate-built memory through the real sandbox.
`tests/feedback-controls.test.cjs` checks the editor and exported Pause/Step/Resume controls.
`tests/feedback-review.test.cjs` checks compact retained wiring keys, stored outputs through Z
in the graph, Edit preview and offline reader, and per-tab Pause/time across Undo/Redo.
`tests/import-integrity.test.cjs` checks Import sketch ownership across asynchronous file/picker
steps and tab switches, plus bounded geometry that cannot overflow during import rounding.
`tests/sandbox-lifecycle.test.cjs` checks that returned hooks cannot leave timer, microtask, or
async work running indefinitely, including in standalone HTML, and that realm reuse stays bounded.
`tests/feedback-deadlines.test.cjs` verifies chronological overdue deadlines, prevents later data
from reaching an earlier clock edge, and checks atomic cancellation and bounded-backlog recovery.
`tests/temporal-wake-policies.test.cjs` checks queued/latest metadata and confirms that periodic,
phase-based, and wall-clock components preserve their no-catch-up behavior during historical replay.
`tests/sequential-components.test.cjs` checks the dedicated latch/register/counter contracts,
three-valued gate truth tables, pure publication, rendering, and bundled source parity.

## Datasets and transformations

`tests/data-import-contracts.test.cjs` checks quoted/multiline CSV/TSV, comma/semicolon/tab parsing and detection,
type inference, exact numeric-looking identifiers, flat JSON rows, nullable typed cells, reference
validation, and import budgets without a browser. `tests/data-component-contracts.test.cjs` covers
typed filtering, chained row references,
missing values, literal table rendering, and positive/negative chart data. The browser suite
`tests/data-components.test.cjs` exercises real import controls, delimiter selection and preview refresh,
atomic Save/Cancel, malformed and oversized imports, independent instances, dataset persistence/copying,
and the offline HTML slice.

`tests/data-transform-contracts.test.cjs` covers stable typed sorting, missing values, grouped and
whole-table aggregates, numeric limits, and bypass behavior. `tests/data-transform-switches.test.cjs`
checks manual/connected/hidden switches, Undo and independent copies, plus offline controls and reload.
`tests/component-input-switch-contracts.test.cjs` validates the host Boolean-input handle guard. `tests/data-transform-runtime.test.cjs` exercises the
bounded derived-table contract, downstream propagation, and persistence through the real sandbox.
`tests/reader-data-actions.test.cjs` checks replacement-schema rules, filename validation, and CSV/JSON
serialization, shared dataset identity, and separate current/committed revision ownership.
`tests/dataset-schema-replacement-contracts.test.cjs` covers explicit column replacement, retained
dataset identity, fresh row identities, type/storage validation, reader permission, and scoped
consumer errors while protecting the owner and unrelated components.
`tests/dataset-schema-import-runtime.test.cjs` exercises the import-mode preview, stale asynchronous
previews, retained links, adapted tables, Undo, and HTML author permission in Chromium and WebKit.
Reload continues to require the last accepted structure. Demo tab 18 enables reader column changes.
`tests/data-workflow.test.cjs` covers explicit import/download controls in the editor
and offline HTML, including cancellation, invalid replacements, and no automatic action replay.
`tests/phase3-closeout.test.cjs` builds a data workflow from an empty canvas through the actual
library, Edit/import dialogs, and drag-to-connect ports. It checks both drag directions,
incompatible-link rejection, sorted shared-record editing and history, saved workspace data,
and the downloaded offline reader with explicit result downloads and session-local edits.
`tests/dataset-reload-host.test.cjs` checks fresh file reads, remembered delimiters, missing handles,
schema/permission failures, stale ownership, and competing reads. Reload declaration/edge tests in
`tests/data-transform-contracts.test.cjs` cover baseline suppression, queue bounds, and settled dispatch.
`tests/dataset-reload-runtime.test.cjs` exercises actual editor/reader reload controls, native-handle
and file-input fallback behavior, competing imports, shared views, queued replacements, and separate
Undo transactions when a pending reload overlaps a library drag or accepted placement.

`tests/choice-components.test.cjs` covers zero-based Dropdown selection, Text lookup matching,
optional keys, invalid selections returning −1, editable-list limits, complete dataset rows, null cells, and
read-only/hidden controls. `tests/component-choice-host.test.cjs` validates choice descriptors,
independent input edits, source snapshots, and stale/connected-input guards.
`tests/component-choice-runtime.test.cjs` exercises native selection, keyboard cancellation,
Undo/copies, full dataset labels, and offline reader behavior through the real sandbox.
`tests/choice-list-editor.test.cjs` covers row editing and validation, Save/Cancel/Undo, and switching
between editable lists and dataset column selectors without losing the saved list.

`tests/component-indexing.test.cjs` audits every indexed built-in port family for contiguous
zero-based names at default/minimum/maximum sizes, including all three matrix modes. It also verifies
choice index 0 is valid and missing selections/lookups return −1.

## Spreadsheet formulas and shared records

`tests/spreadsheet-contracts.test.cjs` checks independent/nested OUTPUT arguments, deleted and
out-of-bounds references handled by lazy IF/IFERROR, blank-cell counting, computed VLOOKUP column
types, explicit mixed-type rejection, bounded shared dependency analysis, cycles, and the unified
inline edit descriptors used by Spreadsheet and the standalone Countdown timer.
`tests/spreadsheet-worker.test.cjs` runs a shared lookup chain through the real Worker deadline,
repairs an ambiguous output type through cell editing, and follows independent OUTPUT values
through connected consumers in the editor and offline HTML.
`tests/spreadsheet-dataset-contracts.test.cjs` covers dataset formulas, stable port types, read-only cells,
literal copying, and import limits. `tests/spreadsheet-data-host.test.cjs` validates full table presentation
and shared read-only inline behavior across the editor and reader. `tests/spreadsheet-datasets.test.cjs`
exercises full/selected dataset values, live replacement, reference picking, and staged editable copies
from connected tables or CSV, including Cancel, Undo, source isolation, and rotated grouped resizing.

`tests/dataset-model-contracts.test.cjs` covers immutable append/update/delete/replace commands,
stable row identities and revisions, type/conflict validation, selection remapping, and replay using
the committed data revision. `tests/dataset-model-runtime.test.cjs` checks shared cache invalidation,
in-flight cancellation, history ownership, and Undo/Redo without resuming a paused simulation.
`tests/shared-dataset-editing.test.cjs` exercises empty typed dataset creation, shared bound-cell edits,
sorted source identity, literal text, stale-edit rejection, and reader editing permissions.
`tests/capture-row-contracts.test.cjs` covers field declarations and destination/type validation.
`tests/shared-dataset-capture.test.cjs` follows real Trigger/Text/Number signals through row capture,
sampled queued values, held-high suppression, Undo/Redo, row limits, and opted-in offline capture.
It also keeps saved row selections aligned when a dataset change commits during another history transaction.
`tests/dataset-owner-copy.test.cjs` checks independent stores for duplicated or pasted owners,
shared links for consumer-only copies, cross-document/library placement, validated ownership hints,
and atomic rejection when a copied store would exceed dataset limits.
`tests/dataset-source-actions.test.cjs` covers owner/action declarations, optional-source isolation,
explicit owner → transform → owner updates, settled source snapshots, definition-change re-priming,
simultaneous-action rejection, reader permission, stale replacement revisions, and ownership revocation.
It also checks paused Step snapshots across later edits, the 64-command queue with a bounded overflow
notice, and the shared 2,000,000-character snapshot budget.
`tests/dataset-source-browser.test.cjs` runs actual Workers and host dispatch for source Replace/Append,
Undo/Redo without replay, self-sorting updates, visible failures, and session-local offline HTML updates.
Run this browser suite with both Chromium and `BROWSER_ENGINE=webkit`.

`tests/example-workspace.test.cjs` validates all thirty-eight shipped tabs and preserves the original
control/HTML walkthrough, including the alphabetical grouped report, reader-result workflow, manual Dropdown, automatic
dataset selection, reverse Text lookup, and a connected Spreadsheet with editable authoring cells
and read-only live reader results, plus shared-dataset capture/editing and explicit source-to-owner
Replace/Append examples. `tests/dataset-owner-source.test.cjs` checks Dataset ownership declarations,
owned-only publication, and the separate source-update reader permission.
All affected walkthroughs use zero-based selections,
channels, storage taps, and matrix rows/columns, while tab numbering stays ordinal. `tests/feedback-workspace.test.cjs` verifies the three practical counter
loops, dedicated/NOR/NAND latches, shared-edge storage, ring/Johnson/decoded-decade sequences,
positive-delay feedback, and the offline reader. Run both browser suites with Chromium and WebKit:

```sh
node --test tests/example-workspace.test.cjs tests/feedback-workspace.test.cjs
BROWSER_ENGINE=webkit node --test tests/example-workspace.test.cjs tests/feedback-workspace.test.cjs
```

After changing bundled scripts, the workspace JSON, or the export runtime, regenerate the shipped
reader with `node tools/update-example-workspace.cjs`. This refreshes each placed component from
its editable source file, imports the JSON through the real editor, and downloads its HTML export.
The JSON remains the editable layout and wiring source; new component UIDs must be added to the
generator's source map. Both artifacts are staged before either is replaced; an export failure
keeps the previous pair, and a failed publication rolls back replaced files. Concurrent edits abort
publication. If the filesystem also prevents rollback, the tool reports retained recovery copies.
`tests/example-workspace-generator.test.cjs` covers successful publication, export and second-file
failures, concurrent edits, and recovery-copy retention without launching a browser.

## Dataset editing and calculated tables

Dataset editing and calculated table checks:

- `tests/dataset-editor.test.cjs` exercises typed record edits, stable identities through sorting,
  full row/column paging, Add/Delete and Undo/Redo, stale drafts/actions, read-only results, and
  explicit HTML editing permission/session reset.
- `tests/spreadsheet-table-output.test.cjs` validates formula-declared table outputs, header/data
  ranges, result schemas, scalar-port collisions, nulls, literal values, formula/type errors, and
  dataset limits. Table types accept numeric codes and type names; declaration cells stay blank.
- Spreadsheet dataset tests cover named INPUT rectangles, zero-based start positions, access
  `0`/`1`/`2`, direct DATA/COLUMN/ROWS reads, shared editing, and independent editable copies.
  Declarations are authored in cells, directly or through **Insert function → Datasets**; Edit
  binds the existing named inputs and previews outputs. The demo uses these same formulas.
- `tests/spreadsheet-table-output-runtime.test.cjs` uses real Workers and the Edit dialog,
  materializes evaluated tables, and verifies the offline reader and linked-page results.
- The workspace tests exercise tabs 24 and 25 together: independent working edits, Live overwrite,
  source-to-formula-to-Dataset refresh, and current result downloads.
- Tab 26 compares editable filtered/sorted views, read-only aggregate results, and independent
  Manual Dataset copies. Editor and offline-reader tests edit a sorted row by its stable identity,
  verify the source order is preserved, copy an aggregate explicitly, edit that copy independently,
  and confirm later source edits wait for the next Copy pulse. Reader reload restores embedded data.
- `tests/dataset-live.test.cjs` checks publication provenance, same-data refreshes, initial setup,
  restored baselines, exact snapshots, failure recovery, chains/cycles, and paused stepping.
- `tests/dataset-live-browser.test.cjs` checks destination-edit persistence, Undo, actual same-data
  file reload through a Spreadsheet result, and reader refresh/permission behavior.


## Native JSON/date, URL navigation, and visible-character text

- `json-components-contracts.test.cjs`, `json-edit-contracts.test.cjs`, and `date-time-contracts.test.cjs` cover typed JSON
  Pointer extraction/building/editing, invalid values, ISO timestamps, daylight-saving boundaries,
  elapsed durations, and safe previews. `native-data-runtime.test.cjs` verifies library
  placement, dynamic Edit controls, real Worker execution and connected offline-reader edits.
  JSON edit checks cover existing nested paths, stable labelled field ports, atomic invalid results,
  overlapping paths, preserved fields, and editor/offline export parity.
- `text-segmentation-contracts.test.cjs` covers grapheme/code-point modes, emoji/combining
  characters, wrapping and bounded previews. `url-text-runtime.test.cjs` checks both modes
  through live editor and exported HTML connections.
- `url-parameter-contracts.test.cjs` covers decoding, repeats, empty/missing parameters,
  bounds and navigation merge rules. `url-text-runtime.test.cjs` exercises page deep links,
  query isolation from the authoring URL, JSON-build parameter passing, URL rewriting,
  same-tab changes and revisited tabs, including `file:` exports without network requests.
- `tab-navigation-contracts.test.cjs` and `tab-navigation-runtime.test.cjs` cover declared
  host actions, target validation, sampled pulses, initially high/revisited trigger priming,
  button navigation and invisible automatic navigation above another clickable control.
- The workspace suite covers all 38 tabs; tabs 29–31 demonstrate the native-data workflows and
  navigate with parameters from tab 31 to the JSON example. Tab 32 covers live reader Sketch settings,
  navigation with hidden tabs, and restoration of defaults on another tab. Tabs 33–34 compare hybrid
  events with traditional pulses and demonstrate Extractor → Memo, live range changes, and Reprocess.
  Tab 35 contrasts related branches that rejoin once with separately edited fields sampled on Apply.
  `stage4-demo.test.cjs` covers tabs 36–38: Dropdown/selector events, signal/event adapters,
  Counter/Timer completion, and dataset action results in the editor and offline HTML reader.

Run the browser suites with `BROWSER_ENGINE=webkit` for WebKit, or omit it for Chromium.

## Sketch settings and reader presentation

- `page-settings-contracts.test.cjs` covers the four typed inputs, validated capability mapping,
  literal defaults, bounded titles, and an authoring-only block including error states.
- `page-settings-authoring.test.cjs` checks built-in placement, one-controller-per-tab rules,
  duplicate import handling, persistence, inspector controls, and independent editor chrome.
- `page-settings-runtime.test.cjs` exercises dependency settlement before tab reveal, live reader
  title/visibility changes, default fallback and reset between tabs, and read-only typed wiring.
- The workspace suite covers tab 32 in both the editable workspace and standalone HTML: submit
  a title, toggle wiring, use normal controls beneath the overlay, hide tabs/simulation controls,
  navigate to Basics, return to retained settings, and reload the saved snapshot.

## Workspace execution and cross-sketch ownership

- `workspace-components-contracts.test.cjs` checks startup settings versus live presentation,
  stable sketch-visibility identities, inherited Sketch settings, mixed endpoint rows, stable
  port IDs, missing-source failures, and bounded endpoint declarations.
- `workspace-action-builtins-contracts.test.cjs` checks command/completion payloads, captured
  table actions, explicit JSON Emit/Reprocess, and shared-origin routing through Publish/Receive.
- `workspace-persistence-contracts.test.cjs` checks sketch/component identity remapping, independent
  copied dataset stores, retained external references, settings singleton transfer, and coherent
  history across visible and hidden sketches. Multi-endpoint references retain stable local/source
  port IDs through copy/import, and imported reference maps enforce port and row limits.
- `workspace-dispatcher-contracts.test.cjs` checks per-occurrence execution, generation/source
  cancellation, survival across navigation, ordered reentrancy, bounded action/failure cascades,
  and rejection containment when a completion receiver itself fails.
- `workspace-runtime-context-contracts.test.cjs` checks stable timer ownership across navigation,
  ordinary component changes and dataset revisions; fresh ownership after history/workspace
  replacement; qualified dataset and per-row endpoint lookup; independent scalar/event/table
  channels; and explicit inactive or missing sources.
- `workspace-value-endpoints-contracts.test.cjs` checks independent row dependencies, real feedback
  faults, isolation of broken imports, healthy feedback-state retention, per-row Live Dataset
  provenance, and bounded table presentation without interrupting routing.
- `workspace-execution-ownership-contracts.test.cjs` checks that execution survives tab changes
  and paint-cache retirement, while deleting an instance, editing its script or replacing its
  runtime cancels old work.
- `workspace-runtime-example-contracts.test.cjs` checks the separate three-sketch application
  fixture and atomic JSON/HTML publication, including failed exports and concurrent edits.
- `workspace-runtime.test.cjs` exercises hidden processing, repeated cross-sketch events, static
  exports, shared edits/history, queued Worker ownership, table endpoints, and offline operations
  with more datasets across the workspace than one sketch's limit. Actual SVG/PNG downloads
  retain captured state and geometry during live updates, including rotated-group PNG pixels.
- `workspace-runtime-authoring.test.cjs` exercises settings inheritance, endpoint selection,
  endpoint addition/reordering/removal with stable references, dataset catalog visibility,
  and the editor's actual wiring overlay. Its integrated acceptance check authors an imported
  endpoint, edits a shared record, and submits a captured row through the actual controls, then
  verifies autosave reload, workspace JSON reopening, and a freshly exported offline HTML file.
  Restoring does not replay prior submissions; repeated equal submissions still append separate rows.
- `workspace-actions.test.cjs` checks captured service actions across navigation, repeated
  equal event commands, and cancellation when their owner is deleted.
- `workspace-multi-endpoints.test.cjs` checks mixed scalar/table/event rows, imports from several
  publishers, repeated submissions, and shared-origin reconvergence through one Publish/Receive
  pair in the editor and offline HTML.

Regenerate the separate **Services / Dashboard / Data editor** example with
`node tools/update-workspace-runtime-example.cjs`. It does not add tabs to the main component
catalog. The JSON is editable; the HTML is produced by the app's real standalone exporter.
The generators retain stable sketch IDs across rebuilds. The main catalog assigns missing IDs
once and preserves them through renaming/reordering; the runtime fixture uses explicit IDs for its
cross-sketch references. `example-workspace-generator.test.cjs` checks repeatability and atomic
publication, including rollback and concurrent-edit protection.

## External integrations

- `integration-foundation.test.cjs` covers host-managed transient results, request generations,
  response limits and validation, independent source instances, cancellation, stale delivery,
  captured writes, rate limits and completion retention across visibility changes.
- `http-scheduling.test.cjs` uses a deterministic clock to check debounce, startup baselines,
  non-overlapping polls, pause/resume without catch-up, and queued timer invalidation when a
  manual request starts or configuration, scope or Enabled changes.
- `http-integration-runtime.test.cjs` exercises manual GET, typed and JSON text outputs, no
  implicit requests on restoration/export, credentials, errors and independent sources in the
  editor, Run and HTML. Delayed responses verify that local controls and timed processing continue
  while a GET is pending.
- `http-automation-runtime.test.cjs` covers polling/enable gates, debounced URL changes, restored
  trigger baselines, scalar action events, repeated completion payloads, captured-body POST,
  no automatic write retries, empty successful responses, coherent response fan-in and Run/HTML
  behavior. Empty visible sketches and visibility changes during completion preparation verify
  that background sources keep working without lost or duplicated occurrences.
- `http-integrations-example-contracts.test.cjs` checks stable example identities, resolvable
  local endpoint files, independent sources, JSON extract wiring, unrelated clock/slider controls,
  transient component presentation, automation/POST wiring, empty-response presentation and
  atomic publication of the three-sketch JSON/HTML example pair.
- `http-example-server.test.cjs` covers the development server's fixture-only CORS responses,
  controllable delay/failures, changing readings, method restrictions, path confinement and
  in-memory JSON POST/idempotency behavior. Accepted writes can precede delayed responses.
- `http-local-network.test.cjs` uses the real loopback fixture server in Run, with a native
  Chromium permission grant confined to the test context. It checks opaque-origin CORS and
  iframe permission delegation, controls working before a held response completes, JSON
  extraction after completion, and discarding preview changes on Return. It also runs in WebKit.

Regenerate this dedicated example with `node tools/update-http-integrations-example.cjs`.
Its HTML contains the runtime; live reads require the configured endpoints. A repository-root
HTTP server supplies two deterministic JSON files, changing readings and in-memory POST without a third-party service. Use
`node tools/serve-http-example.cjs` to enable their CORS responses for Run's isolated origin too.

## Stabilization, edit history, and browser storage

- `runtime-stability.test.cjs` checks bounded capability caching, state/script invalidation,
  persistent feedback diagnostics and explicit recovery, timeout cooldown, and rendering while
  unchanged graph work is pending. Reader checks distinguish permanent component errors from
  retryable Worker failures.
- `feedback-controls.test.cjs` ties each painted Step result to the status graph revision. It holds
  evaluation and real drawing replies independently, checks readiness is absent while pending,
  permits valid unchanged drawings to be reused, and inspects completion before feedback resets it.
- `editor-history.test.cjs` checks polygon/paste history, mutations during drags, rotated-group
  erasing, anchor deletion, deferred text alignment cancellation, and native select keyboard input.
- `workspace-storage.test.cjs` checks atomic IndexedDB snapshots, large image data, writes arriving
  during an in-flight save, one writable window, explicit ownership takeover, stale-writer fencing,
  reload and cached-page lifecycle, application-path isolation, corrupt-record recovery, legacy
  backups and orphaned legacy documents, graceful close/reopen without Web Locks, stale ownership
  receipts, and download fallback when storage is unavailable. Library persistence remains covered
  by its separate suite; standalone readers still keep session-local state only.

Persistence assertions await `persistWorkspace()` before reload and inspect `readSavedWorkspace()`.
Compare the document for content assertions; compare the whole record, including its revision, when
checking that presentation-only redraws did not autosave. Intentional localStorage sandbox sentinels
and legacy-import fixtures remain localStorage checks.

## Run preview

`run-preview.test.cjs` operates the actual toolbar and isolated HTML reader. It checks scalar,
text and Dataset edits, explicit result downloads, fresh reruns, preserved source history,
selection and IndexedDB records, parent simulation suspension/resumption, hidden Services and
Whole workspace navigation. Plain drawings, `file:` execution, disabled workspace/component
features and read-only source windows keep a usable preview path. Keyboard return/startup
cancellation, failure recovery and the opaque-origin boundary are covered without exposing the
parent editor to reader code. Delayed alignment, header paste, pending image/sketch file reads and
image decodes released after Return must leave the source and its history unchanged.
An HTTPS preview uses a regular file input without attempting the sandbox-denied native picker;
Markdown links open in a separate page with no opener. Cancelling startup aborts its build signal,
and a later Run starts with a fresh signal. Escape during a held reader slider drag cancels that
interaction locally, native reader dialogs still dismiss with Escape, and Escape from the outer
preview header returns to editing.

`component-inspector-ux.test.cjs` exercises integrated filtering dropdowns with pointer/keyboard
selection, Escape/Tab cancellation, retained connections and compact tooltip icons. It covers
source values and diagnostics, draft disconnection, missing/incompatible source repair,
Go to source with unsaved-change protection, Receiver jumps to another sketch and persistence
after reload, table/event inputs, accessible field errors, narrow layouts, and Spreadsheet's
compact inspector.

`phase5-closeout.test.cjs` authors components through the library and Edit, then operates Run,
returns and verifies discard, reloads browser autosave, reopens a workspace file, and uses an
offline HTML export. Its second workflow preserves Spreadsheet's inline formulas and declared
input/output bindings through the same round trip.

`reader-slider.test.cjs` keeps pointer movement continuous while Worker drawing calls run, checking
that slider thumbs and values repaint before movement stops in Run and exported HTML. A delayed
drawing fixture verifies live downstream values, release-only stateful edges, cancellation rollback
and unchanged source state; the shipped fruit workspace covers the same drag on its Dashboard.

`reader-paint-progress.test.cjs` covers slower connected displays during continuous input,
independent displays under unrelated timer activity, and counters driven by rapid pulses in both Run and HTML. Completed
intermediate frames must not claim readiness for a newer graph. `editor-paint-progress.test.cjs`
checks actual canvas progress during smart-shape resizing, final dimensions, Undo/Redo, and
rejection of stale state/style replies. `choice-acceptance.test.cjs` checks that a quick next click
does not cancel a pending dropdown selection, including lifecycle and pointer cancellation.

`workspace-performance.cjs` is an observational benchmark, outside the correctness suite. Its
deterministic 119 components span three sketches with 256 shared records, numeric/data pipelines
and cross-sketch event receivers. It reports graph and Worker work alongside timings for authoring,
submission, storage, actual exports, reader startup and Run preview when available. It does not
increase runtime budgets or impose hardware-dependent pass/fail thresholds. See the
[benchmark commands](README.md#generated-examples-and-benchmarks).

## Structural review and export contracts

- `export-dependencies.test.cjs` parses the actual fresh export and all four shipped HTML readers. It
  checks free references, including dormant branches, against their supplied runtime and platform
  globals. This complements browser interaction tests rather than replacing them.
- `data-import-contracts.test.cjs` covers physically blank CSV records versus explicit empty cells.
  `data-export-correctness.test.cjs` covers Spreadsheet-safe and Raw CSV output through both manual and prepared-download controls, XML-safe
  exported text/attributes, inherited-property font lookups and imported identifier preservation.
- Named-function contract fixtures share the AST extractor in `helpers/app-source.cjs`; browser
  suites share launcher defaults in `helpers/browser.cjs`. The catalog's instance-name checks run
  in disjoint batches while retaining every eligible built-in's real edit/canvas/SVG/HTML assertions.

- `builtin-catalog-source.test.cjs` checks canonical source parity and literal replacement tokens in
  the catalog updater, including synchronized built-in snapshots in the demo library. Generator tests
  validate explicit source metadata, stable sketch IDs, and globally unique deterministic dataset IDs
  without rewriting arbitrary state or external references.
- `resource-limits.test.cjs` checks per-image and per-scene byte budgets, rejected oversized imports
  without history changes, sketch name limits, streamed Iconify response bounds and bounded caches.

- `script-pooling.test.cjs` checks deterministic source sharing across native files, IndexedDB and
  HTML payloads, hydration, independent instance state, unchanged state fields, and atomic rejection
  of malformed pools. Clipboard and library transfers retain their inline representation.

- `image-budget-transfer.test.cjs` checks that a clipboard batch exceeding the aggregate image
  budget is rejected before mutating either the drawing or image pool.


## MQTT integration increment

- `mqtt-foundation.test.cjs` exercises descriptor/request validation, shared versus independent
  Config connections, manual/startup policy, generation retirement, reconnect, retained/initial
  baselines, payload limits and message-rate bounds with controlled clients.
- `mqtt-example-server.test.cjs` exercises the loopback WebSocket broker and retained/live fixtures.
- `mqtt-integrations-example-contracts.test.cjs` checks transient component outputs, manual controls,
  explicit cross-sketch Config references, unchanged authored state and atomic JSON/HTML generation.
- `mqtt-runtime-browser.test.cjs` covers the real bundled client through the editor, Run and
  standalone export, using an isolated local broker rather than an external endpoint. It verifies
  queued wildcard values keep their original topics and that a released control click completes
  while continuous readings update 80 Gauges.
- `mqtt-event-receivers.test.cjs` checks enabled hybrid/explicit event receiver discovery, including
  transforms and cross-sketch endpoints, and stable integration snapshots within one graph pass.
- `mqtt-mosquitto-browser.test.cjs` optionally runs against a real Mosquitto executable through
  loopback TCP/WebSocket listeners. It exercises the editor, isolated Run and actual downloaded
  HTML, manual/startup policy, shared Configs, retained/live events, reconnect and authentication.
  Set `MOSQUITTO_BIN` and `MOSQUITTO_PASSWD`; ordinary runs do not require a system broker.
