# Browser regression checks

SimpleCanvas opens directly from `index.html`; dependencies are only for development.

```sh
npm ci
npx playwright install chromium webkit
npm test
BROWSER_ENGINE=webkit npm test
```

`BROWSER_EXECUTABLE` optionally selects a compatible local executable. Tests serve the real app
in isolated browser profiles and expose diagnostic access only in the test copy.

Retain coverage for file/clipboard output, preserving work after storage failures, selecting and
transforming the intended objects, and entering text/table editing. The suite also checks the
retained static libraries, icon import, Markdown, and custom printing. Avoid tests that mirror
helpers, removed features, or cosmetic permutations.

Reusable static shapes must survive library export/import and place as independent copies.
Legacy scripted sketch objects must remain inert, clearly labelled, and recoverable in JSON.
Native Office paste, physical iPad input, and printer scaling still require manual checks.
