# Browser regression checks

The application still runs by opening `index.html`; these dependencies are only for development.

Install the test tools with `npm install` and `npx playwright install chromium`, then run `npm test`.
To use an existing Chromium-based browser, set `BROWSER_EXECUTABLE` to its executable path.
For WebKit, install `npx playwright install webkit`, then run `BROWSER_ENGINE=webkit npm test`.

Tests run the complete application in isolated browser profiles. A diagnostic evaluator is added
to the served test copy to seed scenes and inspect state. Interactions and rendering use the actual
application functions; no diagnostic hooks are shipped in `index.html`.

Clipboard tests intercept the browser's clipboard write and replay its real JSON/PNG payloads through
paste events, so they do not change the OS clipboard. HTML tests open actual exported files and check
embedded assets, tab switching, group transforms, and current document data after storage failures.
Markdown checks cover cropped PNG/SVG/clipboard output and editor alignment. Native Office paste
still requires a manual integration check.

Tablet tests exercise touch events and viewport sizes in Chromium and WebKit. The raw touch-drag
test uses Chromium's CDP interface and is skipped in WebKit. A physical iPad Safari pass is still
needed before release to check native touch behavior and the on-screen keyboard.
