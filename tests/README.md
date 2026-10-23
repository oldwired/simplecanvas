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
- Observe committed library placements (expected items and no pending placement requests) and
  completed downloads instead of returning their long-lived task promises through `page.evaluate`.
  Chromium's DevTools promise observation can fail with “Resulting promise was garbage collected”
  after the application has already finished. Start each action once and retain all result checks;
  a missing item, stuck placement or absent download must still fail. The
  [investigation](../docs/smart-components-brief.md#browser-test-promise-observation--2026-10-23)
  records the reproduction and stress verification.
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

After runtime or bundled component changes, regenerate the editable/HTML pairs through the app:

```sh
node tools/update-builtin-catalog.cjs
node tools/update-builtin-catalog.cjs --check
node tools/update-example-workspace.cjs
node tools/update-workspace-runtime-example.cjs
node tools/update-http-integrations-example.cjs
node tools/update-mqtt-integrations-example.cjs
node --test tests/builtin-catalog-source.test.cjs tests/example-workspace-generator.test.cjs tests/workspace-runtime-example-contracts.test.cjs tests/http-integrations-example-contracts.test.cjs
```

The generators preserve sketch IDs and publish each JSON/HTML pair only after successful export.
The main demo disambiguates dataset IDs deterministically; repeated generation must leave both
JSON and HTML byte-identical when sources have not changed.
Catalog scripts use explicit source filenames; main-demo instances carry `exampleSource` metadata,
which is removed on runtime import. The workspace-runtime builder names its source files directly.
Keep generated HTML self-contained and verify actual shipped readers after regeneration. Optional PNG palette optimization uses
`python3 tools/optimize-builtin-thumbnails.py` (Pillow, development only); inspect previews afterward.
The [detailed catalog](COVERAGE.md#workspace-execution-and-cross-sketch-ownership) links their coverage.

The HTTP example has three sketches: manual reads, automatic reads/event logs and explicit JSON POST. Run
`node tools/serve-http-example.cjs` to serve the repository root with CORS enabled only for its
`/examples/http-reading.json`, alternate, and `/examples/api/reading`/`echo` endpoints, including
CORS for Run's isolated origin and POST preflights. API writes/idempotency records live only in
the server process; `?delay=2500`, `?status=503` and POST `?status=204` exercise request outcomes.
Browser local-network permissions still apply. `http-local-network.test.cjs` uses the real
loopback server and grants the native permission only inside Chromium's isolated test context;
WebKit makes the same request without that platform permission. It verifies opaque-origin CORS,
permission delegation, interaction while a response is pending, and discarding Run changes.
The browser integration suite intercepts controlled endpoints to test pending requests, errors,
superseding responses, credentials, automated reads and captured POST bodies without relying on an external API:

```sh
node --test tests/integration-foundation.test.cjs tests/http-scheduling.test.cjs tests/http-integration-runtime.test.cjs tests/http-automation-runtime.test.cjs tests/http-integrations-example-contracts.test.cjs tests/http-example-server.test.cjs tests/http-local-network.test.cjs
BROWSER_ENGINE=webkit node --test tests/http-integration-runtime.test.cjs tests/http-automation-runtime.test.cjs tests/http-local-network.test.cjs
```

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


## MQTT integration tests

The MQTT example has three sketches sharing a Config: numeric/JSON and text readings, an event log,
and explicit JSON commands with separate broker-acknowledgement and device-response logs.
After `npm ci`, run `node tools/serve-mqtt-example.cjs` and open
`http://127.0.0.1:8001/examples/mqtt-integrations.html`. The helper runs a loopback WebSocket broker,
serves the editor and self-contained reader, publishes retained baselines, and sends fresh readings
once per second. It permits only a bounded non-retained JSON command on `simplecanvas/demo/command`
and simulates its separate device response on `simplecanvas/demo/reply`; other client publications
are rejected. It is development-only; the browser client is already bundled in the app and HTML.
The automated broker fixture never contacts an external service. Startup is manual unless explicitly
enabled for Run/HTML. Stop/restart the helper to inspect reconnect and stale-reading behavior.
The browser regressions also queue wildcard messages to check captured value/topic pairing, and
keep publishing every 35 ms while a control click is accepted in a workspace with 80 Gauges.
`mqtt-event-receivers.test.cjs` verifies event-receiver discovery and per-pass snapshot stability,
so value-only dashboards avoid unnecessary event work without dropping enabled event consumers.

```sh
node --test tests/mqtt-foundation.test.cjs tests/mqtt-publish-foundation.test.cjs tests/mqtt-event-receivers.test.cjs tests/mqtt-example-server.test.cjs tests/mqtt-integrations-example-contracts.test.cjs tests/mqtt-runtime-browser.test.cjs tests/mqtt-publish-browser.test.cjs
BROWSER_ENGINE=webkit node --test tests/mqtt-runtime-browser.test.cjs tests/mqtt-publish-browser.test.cjs
```

The optional Mosquitto suite checks the same bundled browser client against a separate system
broker, with native TCP publishers feeding its WebSocket listener. Supply executable paths to
enable it; ordinary test runs skip it and never install or start a system service.

```sh
MOSQUITTO_BIN=/opt/homebrew/sbin/mosquitto MOSQUITTO_PASSWD=/opt/homebrew/bin/mosquitto_passwd node --test tests/mqtt-mosquitto-browser.test.cjs tests/mqtt-publish-browser.test.cjs
BROWSER_ENGINE=webkit MOSQUITTO_BIN=/opt/homebrew/sbin/mosquitto MOSQUITTO_PASSWD=/opt/homebrew/bin/mosquitto_passwd node --test tests/mqtt-mosquitto-browser.test.cjs tests/mqtt-publish-browser.test.cjs
```

Adjust those paths for your installation. The fixture creates temporary configuration and password
files, binds both listeners to localhost, and removes its files and processes afterward. It checks
editor, isolated Run and freshly downloaded HTML, including shared connections, typed/JSON values,
retained baselines, live events, reconnection and credentials. These checks use `ws://`; deployment
TLS certificates, `wss://` reverse proxies and their origin policies require separate validation.
Verified on 2026-10-23 with Mosquitto 2.1.2: 4/4 scenarios passed in Chromium and 4/4 in WebKit,
with no skips or application changes. The later Publish suite passed 10/10 in Chromium and 10/10
in WebKit, including real-Mosquitto acknowledged/retained publication and authenticated Run/HTML sends.
