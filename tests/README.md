# Browser regression checks

SimpleCanvas runs by opening `index.html`. Dependencies and the commands below are for development.
See the [coverage catalog](COVERAGE.md) for detailed scenarios and
[project notes](../CLAUDE.md) for implementation constraints.

## Install and run

Use Node.js 24, then install the locked dependencies and both test browsers:

```sh
npm ci
npx playwright install chromium webkit
```

Run the whole suite with bounded file concurrency, matching CI:

```sh
node --test --test-concurrency=2 tests/*.test.cjs
BROWSER_ENGINE=webkit node --test --test-concurrency=2 tests/*.test.cjs
```

`npm test` runs the same bounded Chromium command. Use `BROWSER_ENGINE=webkit npm test` for WebKit.
Focus a change before starting a full run:

```sh
node --test tests/feedback-controls.test.cjs tests/runtime-stability.test.cjs
BROWSER_ENGINE=webkit node --test --test-name-pattern='offline' tests/dataset-editor.test.cjs
```

`BROWSER_ENGINE` accepts `chromium` (default) or `webkit`. `BROWSER_EXECUTABLE` optionally selects
an installed compatible browser executable. Existing browser suites use
[`helpers/browser.cjs`](helpers/browser.cjs) to share these launch settings; each suite still owns
its browser, isolated contexts and cleanup. Keep custom launch options explicit at the call site.

## Test changes

Tests serve the full application in isolated profiles. A diagnostic evaluator is inserted only
into the served fixture; it is never shipped in `index.html`. Prefer actual controls, downloaded
artifacts and independently checked results. Keep tests for lost drawings, broken transfer/export
or distinct interaction failures; avoid tests that only mirror helper implementation or routine
styling. Do not multiply the same gesture across viewport sizes without a separate failure path.

- Wait for accepted graph results and completed paints. Reader `data-smart-ready` is paired with
  `data-smart-graph-revision`; a previous ready frame is not proof that Step has finished painting.
- Await `persistWorkspace()` before reloads that depend on durable saves. Inspect
  `readSavedWorkspace()` for document assertions; include its revision when checking that redraws
  do not autosave. Keep intentional sandbox sentinels and legacy fixtures in localStorage.
- Workspace editing ownership is separate from library revisions. A second same-path window must
  explicitly take over before testing edits; do not bypass the read-only UI gate.
- Use deterministic delayed replies for async races. Do not fix a race by increasing arbitrary
  sleeps, weakening an assertion, or retrying a mutating action.
- Keep accepted event delivery separate from page visibility: a captured transaction finishes
  while hidden or during Whole workspace navigation; page departure, ownership loss, and leaving
  its Active sketch only scope still cancel it. See the
  [visibility tests](event-visibility.test.cjs). An ordinary repaint can replace wiring SVG nodes;
  reacquire detached geometry before a click and assert selection before testing Delete.
- Extract app declarations and insert fixture hooks through
  [`helpers/app-source.cjs`](helpers/app-source.cjs), which uses the JavaScript AST. Avoid finding
  function ends by the formatting of the next declaration. Export dependency checks inspect
  dormant branches as well as exercised code; the parser is development-only.
- Catalog caption checks use disjoint batches so every eligible built-in still exercises the real
  name inspector, canvas paint, SVG and offline HTML without one ever-growing graph.

## Generated examples and benchmarks

After runtime or bundled component changes, regenerate both editable/HTML pairs through the app:

```sh
node tools/update-builtin-catalog.cjs
node tools/update-builtin-catalog.cjs --check
node tools/update-example-workspace.cjs
node tools/update-workspace-runtime-example.cjs
node --test tests/builtin-catalog-source.test.cjs tests/example-workspace-generator.test.cjs tests/workspace-runtime-example-contracts.test.cjs
```

The generators preserve sketch IDs and publish each JSON/HTML pair only after successful export.
The main demo disambiguates dataset IDs deterministically; repeated generation must leave both
JSON and HTML byte-identical when sources have not changed.
Catalog scripts use explicit source filenames; main-demo instances carry `exampleSource` metadata,
which is removed on runtime import. The workspace-runtime builder names its source files directly.
Keep generated HTML self-contained and verify actual shipped readers after regeneration. Optional PNG palette optimization uses
`python3 tools/optimize-builtin-thumbnails.py` (Pillow, development only); inspect previews afterward.
The [detailed catalog](COVERAGE.md#workspace-execution-and-cross-sketch-ownership) links their coverage.

For the rendering/library-preview benchmark:

```sh
node tests/performance.cjs 0e557fe
```

Replace the revision to compare another baseline. It measures warmed paints, previews and picker
reopens; timings are hardware-dependent observations, not pass/fail limits. Synthetic preview jobs
isolate picker work; browser regressions separately verify real sandbox execution and rasterization.

For a larger connected workspace, including real Run preview startup:

```sh
node tests/workspace-performance.cjs 0e557fe 5
BROWSER_ENGINE=webkit node tests/workspace-performance.cjs working-only 5
```

This benchmark uses the same deterministic 119-component, three-sketch fixture in each version,
including shared data, numeric chains and cross-sketch events. JSONL output separates initial load,
unchanged/changed evaluation and Worker counts, real submission acceptance/paint, storage, actual
exports and reader startup. Preview startup is measured only when that version supports Run.
`working-only` omits a baseline; the final argument selects 1–20 updates. Timing and storage-character
counts are observations, not CI thresholds or physical on-disk allocation measurements.

A local macOS/arm64 run on 2026-10-21 compared `0e557fe` with the Run preview working tree,
using Chromium 151 and WebKit 26.5. The table shows medians across five updates; startup values
are single measurements. These are hardware-dependent observations from one run per engine,
with the baseline measured first, rather than performance guarantees.

| Measurement | Chromium, baseline → working | WebKit, baseline → working |
| --- | --- | --- |
| Unchanged graph evaluation | 285 → 66 ms | 316 → 101 ms |
| Changed graph and visible paint | 361 → 137 ms | 416 → 216 ms |
| Sandbox calls per unchanged / changed update | 120 / 131 → 1 / 13 | 120 / 131 → 1 / 13 |
| Exported reader startup, including visible paint | 815 → 591 ms | 929 → 780 ms |
| Run preview startup, public ready signal | unavailable → 2.04 s | unavailable → 2.60 s |

The actual native export shrank from 693,528 to about 196,976 bytes; the Chromium HTML export
from 1,286,218 to 800,539 bytes. These changes include earlier declaration caching and script
pooling work, not just Run preview. Reduced request counts provide firmer evidence of avoided
work than one local timing run. The benchmark reports its public preview-ready signal separately
from exported-reader startup, which also waits for completed visible paints.

## CI and remaining manual checks

[Browser tests](../.github/workflows/browser-tests.yml) run for feature-branch pushes and pull
requests, and are reused by Pages and tag releases. Chromium and WebKit jobs run two test files at
a time, with 30 minutes for installation and execution. Newer runs cancel obsolete runs for the
same branch/workflow; publication workflows require both browser jobs to pass.

Tests intercept clipboard writes and inspect actual JSON/PNG/SVG/HTML output without changing the
OS clipboard. Chromium-only CDP touch cases are skipped under WebKit. Before release, still check
physical iPad Safari and its on-screen keyboard, native Office paste, and physical printing at
100% / Actual size. Automation does not certify those integrations.
