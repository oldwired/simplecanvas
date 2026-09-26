# Browser regression checks

The application still runs by opening `index.html`; these dependencies are only for development.

Install the test tools with `npm install` and `npx playwright install chromium`, then run `npm test`.
To use an existing Chromium-based browser, set `BROWSER_EXECUTABLE` to its executable path.

Tests run the complete application in isolated browser profiles. A diagnostic evaluator is added
to the served test copy to seed scenes and inspect state. Interactions and rendering use the actual
application functions; no diagnostic hooks are shipped in `index.html`.

Tablet tests exercise touch events and viewport sizes in Chromium. A physical iPad Safari pass is
still needed before release to check native touch behavior and the on-screen keyboard.
