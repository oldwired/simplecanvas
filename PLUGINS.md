# Plugins

SimpleCanvas can load an optional `plugins.js` beside `index.html`. Use it for integrations,
custom UI, and other deployment-specific behavior. No plugin file or build step is required
to use the canvas.

## Install and initialize

Copy [examples/plugins.js](examples/plugins.js) to `plugins.js` beside the HTML to try the
example. It adds **Plugin: sketch info…** and **Plugin: download snapshot…** to the File menu
and counts change and tab-change events. It makes no network requests.

A plugin entry point is a classic script that defines this global:

```js
window.SimpleCanvasPlugins = {
  init(api) {
    if (api.version !== 1) throw new Error('Unsupported SimpleCanvas plugin API');

    api.ui.addMenuItem({
      label: 'Show sketch name',
      onClick() {
        alert(api.getActiveTab().name);
      }
    });
  }
};
```

After settings and the saved tabs have been restored and the app is usable, SimpleCanvas
attempts to load `./plugins.js` once, then calls `init(api)` once. The hook may be async.
Startup does not wait for the plugin. Optional shape-library loading and image decoding may
still be in progress when the hook runs.

A missing file leaves the canvas usable without an in-app warning; the browser may show the
failed request in DevTools. Script loading or initialization failures do not stop the canvas.
Errors thrown by `init`, including rejected promises, are reported in the console. The loader
does not undo partial plugin setup after a failure.

To disable the system in a hosted deployment, put this in `settings.json` beside the HTML:

```json
{
  "version": 1,
  "features": {
    "plugins": false
  }
}
```

This skips both loading the script and calling its hook. The default is `true`. Like other
deployment settings, this setting is read only when hosted over HTTP(S); opening `index.html`
through `file://` uses the defaults. The classic script can load locally, subject to the
browser's file permissions. See [deployment settings](README.md#optional-deployment-settings)
for invalid-file handling and other feature switches. Reload to apply settings or plugin changes.

## API version 1

`api.version` is the number `1`, independent of the sketch file format version.

| Member | Behavior |
| --- | --- |
| `getActiveTab()` | Returns a detached `{id, name}` describing the active tab. |
| `getSketch()` | Commits pending text edits and returns a deep detached snapshot of the active sketch: `{app: 'SimpleCanvas', version: 3, items, assets}`. Only image assets used by the sketch are included. |
| `loadSketch(data, options?)` | Validates and replaces the active sketch, with one undo entry and autosave. See below. |
| `on(event, handler)` | Subscribes to `change` or `tabchange`; returns a function that unsubscribes the handler, including queued delivery. |
| `ui.addMenuItem({label, onClick})` | Appends a File-menu action; returns a function that removes it. Labels are plain text. The callback may be async. |

Snapshots can be changed or serialized without modifying the canvas. Make drawing changes
through `loadSketch`; editing the DOM or a snapshot does not update drawing history.

### Load a sketch

Pass a supported single-sketch JSON object, such as the result of `getSketch()` or a parsed
**Save sketch…** download. Workspace files are not accepted. Invalid or unreadable input
throws before changing the drawing.

```js
const sketch = api.getSketch();
const replaced = api.loadSketch(sketch, {
  confirmReplace: true,            // Default: ask before replacing a nonempty sketch.
  tabId: api.getActiveTab().id      // Default: the active tab at call time.
});
```

The result is `true` after replacement, or `false` if the user cancels. Set `confirmReplace`
to `false` when your own UI has already obtained confirmation. Replacement preserves the
tab's identity and name, renders the new drawing, and is undoable, including image assets.
After validation, pending text is committed before the confirmation dialog; cancellation
keeps that text. Its undo step is separate from the replacement's undo step.

`tabId` is a guard, not a destination selector: if that tab is no longer active, the call
throws. Capture it before an asynchronous request to avoid replacing a different tab if the
user switches while waiting:

```js
api.ui.addMenuItem({
  label: 'Load from project…',
  async onClick() {
    const {id: tabId} = api.getActiveTab();
    const response = await fetch('/your-integration/sketch');
    if (!response.ok) throw new Error(`Load failed: ${response.status}`);
    const sketch = await response.json();
    api.loadSketch(sketch, {tabId});
  }
});
```

This guard checks the tab identity; it does not detect edits made within that same tab while
waiting. An integration that needs conflict detection must track those changes itself.

### Subscribe to changes

```js
const unsubscribe = api.on('change', ({tabId, sketch}) => {
  // Store this snapshot for tabId, or send it to your integration.
  console.log('Committed sketch', tabId, sketch);
});

const unsubscribeTabs = api.on('tabchange', ({tabId}) => {
  console.log('Active tab changed', tabId);
});

// When your integration no longer needs the subscriptions:
// unsubscribe();
// unsubscribeTabs();
```

`change` reports committed edits, including undo, redo, and sketch imports. It does not fire
merely because autosave runs or a tool is selected. A commit can produce a notification even
when the resulting drawing is unchanged. Its `{tabId, sketch}` payload includes a detached
snapshot of the scene at the time of the event, including any gesture in progress when an
asynchronous edit finishes. Image imports completing in a background tab also report that
tab's updated scene. Use the payload rather than rereading the
active sketch: events are delivered asynchronously in a microtask, and the user may have
switched tabs by then. `tabchange` provides `{tabId}` for the newly active tab.

Handlers may be async. Their thrown errors and rejected promises are reported in the console
without stopping other handlers or the canvas. Menu callback failures are also contained and
reported. Keep handlers fast, debounce remote saves, and avoid unconditionally calling
`loadSketch` from a `change` handler, which would generate further changes.

## Scope and deployment

Plugins are trusted deployment code with the page's full privileges, including DOM, browser
storage, and network access. They are not sandboxed. Direct DOM manipulation and browser event
listeners are allowed, but the app's internal markup is not a stable API. Prefer the methods
above for drawing access and File-menu actions.

There is one entry point. Your `plugins.js` can initialize several integrations or load their
scripts itself. It is responsible for their ordering, cleanup, and additional files. The core
has no plugin registry, dependency manager, or unload lifecycle; retain the returned removal
functions if your own UI needs to disable an integration during the visit.

Plugins are not embedded in sketch/workspace JSON or **Export HTML** output. The Pages workflow
copies a root `plugins.js` when present, but does not activate the example or copy additional
integration files automatically. The Really Simple demo disables plugins in its settings.
