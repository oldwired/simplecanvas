# Browser regression checks

The application still runs by opening `index.html`; these dependencies are only for development.

Install the test tools with `npm install` and `npx playwright install chromium`, then run `npm test`.
To use an existing Chromium-based browser, set `BROWSER_EXECUTABLE` to its executable path.
For WebKit, install `npx playwright install webkit`, then run `BROWSER_ENGINE=webkit npm test`.

Tests run the complete application in isolated browser profiles. A diagnostic evaluator is added
to the served test copy to seed scenes and inspect state. Interactions and rendering use the actual
application functions; no diagnostic hooks are shipped in `index.html`.

Keep a test when it protects against lost drawings, broken file/clipboard output, or a distinct
editing regression. Prefer user actions and downloaded artifacts with independently checked results.
Cover shared behavior once; add another case only when it exercises a different failure path.
Avoid tests for removed buttons, routine styling, internal object identities, or two helpers
agreeing with one another. Do not multiply the same gesture sequence across viewport sizes.

Clipboard tests intercept the browser's clipboard write and replay its real JSON/PNG payloads through
paste events, so they do not change the OS clipboard. HTML tests open actual exported files and check
embedded assets, tab switching, group transforms, and current document data after storage failures.
Markdown checks cover cropped PNG/SVG/clipboard output and editor alignment. Native Office paste
still requires a manual integration check.

An iPad-sized touch scenario exercises endpoint cycling and double-tap point editing in Chromium
and WebKit. Mouse checks cover undo/reload/import, curve tangents, and preserving heads during drags.
The raw touch-drag test uses Chromium's CDP interface and is skipped in WebKit. A physical iPad
Safari pass is still needed before release to check native touch behavior and the on-screen keyboard.

For the smart-shape rendering and library-preview benchmark, run
`node tests/performance.cjs b95efd1` (replace the argument to compare another Git revision).
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
Timed-shape checks cover autonomous redraws, interval bounds, hidden/inactive document cleanup,
unchanged history/storage, live clock updates, stopwatch controls and timestamp recovery, matching
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

Connected-component regressions in `tests/components.test.cjs` cover the Number control → Gauge
input-picker workflow, scalar computation, actual drawing/SVG results, JSON and undo/redo,
duplicate/clipboard binding remapping, cross-tab UID isolation, and downloaded offline HTML.
They check rapid changes, unsupported-version recovery, legacy raw-state compatibility, missing
or incompatible ports, source deletion, cycles, and isolation of failed computations. Format 4
retains component API markers and wiring; earlier drawing formats remain readable.
The `smartComponents` deployment switch is checked for disabled authoring, preserved legacy
authoring, and working saved connections, copies, deployed-library placements, and offline HTML.

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

Toolbar checks cover table and mixed-selection font edits, Undo/Redo and file persistence;
exclusive popovers; custom-color panel cleanup; and file-menu keyboard focus and accessibility state.

Library browser regressions in `tests/library-browser.test.cjs` exercise direct placement from the
expanded catalog, inert browsing, pin membership and format 2 export/import, legacy libraries,
metadata edits, preserved built-in snapshots, and authoring-disabled placements. They build the
threshold/AND/indicator example through Inputs and operate the actual downloaded HTML offline.
`tests/library-components.test.cjs` checks bundled/example source parity, sandboxed boolean truth
tables for all eight gates, numeric inversion, threshold boundaries, Math operations and arithmetic
errors, visible unavailable inputs, and editor-only configuration controls. Indicator and naming
tests cover per-instance choices, save/reload, and HTML behavior. Component tests validate string
input choices from literals and bindings in the editor and offline exports. Failure tests ensure
unavailable views replace stale results, recover correctly, and leave independent controls usable.
A catalog-wide naming check renames every built-in component through Inputs and verifies its
caption on canvas, in SVG, and in offline HTML.
Tri-state checks distinguish healthy Z from missing inputs and false, validate output metadata,
connect consumers while disabled, and exercise recovery in the editor and offline HTML. Other
invalid inputs and cycles must not be hidden by a Z input.

`tests/temporal-components.test.cjs` exercises the bounded transition contract, transport Delay,
rising-edge Counter/reset, Random integer, both typed Sample & hold entries, and Trigger pushbutton
pulses. Trigger checks cover rapid clicks, held presses, idle output, restoration, and offline use. It covers per-instance
memory, active-document time, stale evaluation rejection, pure snapshot paths, and ordered editor/
offline interaction. Run it with `node --test tests/temporal-components.test.cjs`; prefix with
`BROWSER_ENGINE=webkit` for WebKit.

`tests/catalog-extensions.test.cjs` checks configurable channel counts through the real Inputs
dialog, library placement, undo/redo, removed-output errors, pulse-driven stepped routing,
and typed numeric entry in the editor and downloaded offline HTML. It also checks dialog
cancellation when visibility changes and connects the new pulse sources to counters.
Run it with `node --test tests/catalog-extensions.test.cjs`, or prefix with
`BROWSER_ENGINE=webkit` for WebKit.

The browser-independent `tests/numeric-extensions.test.cjs`, `tests/routing-components.test.cjs`,
and `tests/signal-generators.test.cjs` exercise arithmetic boundaries, all routing positions,
reset/re-prime semantics, and pulse scheduling with controlled time. The library suites also
verify that all 35 API v2 catalog definitions match their editable source files and retain
their instance names in canvas, SVG, and offline HTML.
