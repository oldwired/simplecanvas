# SimpleCanvas

A small, zero-dependency browser sketching canvas.

Demo: https://oldwired.github.io/simplecanvas/

[Really Simple demo](https://oldwired.github.io/simplecanvas/reallysimple/): the same drawing app
with all five optional features disabled and the page title **Really SimpleCanvas**.

Open `index.html` in a browser to draw, add shapes or text, and save or load sketches as JSON.

Use **Add tab** for independent drawings and **Save workspace…** to download all open tabs.
Working drawings stay in memory when browser storage is full or unavailable. A persistent warning
offers **Save workspace…** if automatic saving fails; save the file before leaving the page.

**Export HTML** creates a self-contained, view-only copy of all working tabs at the current canvas
size. Images are embedded in the file, and each tab retains its own content and group rotations,
including changes that could not be saved automatically.

Copying a selection provides editable objects when pasted into SimpleCanvas and a PNG fallback for
other applications. A text item whose first line is exactly `---` supports Markdown headings,
emphasis, lists, links, and rules. Markdown stays left/top-aligned; cropped PNG/SVG exports include
the full rendered content. Table cells remain plain text.

Select a line or open curve, then click or tap either endpoint to cycle its arrowhead:
**None → Open → Filled → Open inverted → Filled inverted → None**. Each end cycles independently;
inverted heads point back along the line. Dragging an endpoint moves it without changing its style.
Double-click or double-tap the shape's body to enter or leave point editing. While editing points,
endpoint taps select anchors. Click or tap the outline between two anchors to add one there (the shape
keeps its form; drag right away to move it). To remove an anchor, select it and press Delete, Alt/Option-click
it, or tap the small × next to it. Delete/Backspace only target anchors while point editing; leave
this mode to delete the whole shape. Double-clicking the outline to leave point editing preserves
the drawing and its Undo/Redo history. The **line-style** popover (the stroke-width value) controls stroke
width and dashes without moving the canvas.

Developer checks are described in [tests/README.md](tests/README.md).

The public demo includes eight shapes: the six sailing shapes from [Bauka](https://bauka.com/)
(two boats, start and finish lines, a course mark, and a wind arrow), plus a smart **Clock** and
**Bar chart**. Open the shape library in the toolbar, choose a shape, then click the canvas to place
it. Double-click the clock to drag its hands, or the chart to drag bars and add/remove them with
the +/− controls. All demo entries include saved previews.

The shape library is optional. Open the library picker and choose **Add selection** to save
selected canvas objects, or **Manage → Import…** to open your own library file. **Manage** is
available even before a library exists, including **Add smart shape…**. Click a saved shape to
place it; **Manage** also lets you rename, delete, or replace an entry with the current selection.
For smart shapes, **Edit** opens their existing script in the authoring dialog. Save changes,
then export the library to keep the updated code and preview. Images cannot be included.

**Add icon** searches Iconify when online and imports a result as editable native polygons, with
its collection and license attached to the library entry. SVG cut-outs, curves and flat multicolor
artwork are preserved. **Load more** retrieves further matches even if the license filter hides a
page. Animated icons are excluded.
The license filter shows permissively licensed collections by default; each collection retains
its own terms. Closing the dialog cancels a pending import.

Static icons with unsupported features can be imported as a simplified drawing: compare the
original and converted previews, review the listed changes, then choose **Import simplified**.
Gradients become solid colors, masks/clipping and effects may be removed, and transparency is
approximated on white. Transforms are applied to the native geometry. Cancel keeps the library
unchanged; icons with no usable geometry cannot be imported.

**Export library…** downloads the entire active library as `shapes-library.json`. Library
changes last only for the current visit and are separate from sketch saves and autosave.
An indicator shows unexported changes; importing another library or leaving the page warns
before those changes are discarded. Import your exported file to use it on another visit.

Libraries include PNG thumbnails, which display without running shape scripts. Ordinary missing
previews are generated automatically. Smart shapes with missing previews show placeholders and ask
before running their scripts to generate pictures; **Use placeholders** still loads the library.
**Generate missing previews…** lets you generate them later. Export the library to retain new previews.

**Manage → Add smart shape…** creates script-defined shapes from templates such as Clock, Timer,
Arrow, Arc and Chart. Double-click a placed smart shape to edit its handles, then double-click again
or click outside to leave. Clicks and drags support undo/redo. Scripts run in an isolated Worker with
blocked network access, and generated shapes are validated before rendering or export. The app still
works as a single local HTML file. Authoring details are in [SMART_SHAPES.md](SMART_SHAPES.md).

When hosted, an optional `shapes-library.json` beside the HTML supplies the initial library.
The file is read only at startup; opening the picker never reloads it. File imports work when
hosted or opened locally, including importing the demo file via **Manage → Import…**.
For a standard deployment, copy just `index.html`. Add your own library as `shapes-library.json`
if needed. The HTML works on its own without a library file.

The **Deploy demo to Pages** workflow in `.github/workflows/pages.yml` prepares a directory with
`index.html` and `shapes-library.json`, plus `settings.json` if present. It copies the tracked
`demo-shapes-library.json` to that conventional library name, so the existing loader picks it up.
The workflow also publishes `reallysimple/index.html` (a copy of the same HTML) and
`reallysimple/settings.json`, with all five optional features disabled. The variant settings are
tracked in [reallysimple/settings.json](reallysimple/settings.json). Only the prepared directory
is uploaded to Pages.

To activate this workflow, merge it into `main`, then open the repository's **Settings → Pages**
and set **Build and deployment → Source** to **GitHub Actions**, replacing the branch-based source.
Run **Deploy demo to Pages** from the Actions tab. Subsequent changes to the HTML, demo library,
either settings file, or workflow on `main` deploy automatically.

To update the demo, import `demo-shapes-library.json`, edit it in **Manage**, export the library,
and save the download back as `demo-shapes-library.json`.

## Optional deployment settings

For a hosted deployment, copy [settings.example.json](settings.example.json) to `settings.json`
beside `index.html`, and change the feature switches you need. You can omit any switch: all five
default to `true`. Without a settings file, or when opening the HTML directly as a local file,
the standard features remain available. No settings file is required to run the app.

The optional top-level `title` sets the browser tab's `<title>` as plain text. It must be a
nonempty string; omit it to keep **SimpleCanvas — Quick Sketches**. For example:

```json
{
  "version": 1,
  "title": "My sketchpad",
  "features": {
    "workspace": false
  }
}
```

| Feature | Effect when `false` |
| --- | --- |
| `workspace` | Hides tabs, Add tab, and workspace open/save. Edits and HTML exports use the active sketch. Previously saved tabs are preserved and return when enabled again. |
| `shapeLibrary` | Hides the entire library and skips loading `shapes-library.json`. Objects in existing drawings still render and remain editable. |
| `shapeLibraryManagement` | Hides Manage and all library additions; blocks library import/export, rename, replace, and delete. Users can place shapes from the deployed library. |
| `smartShapeAuthoring` | Disables creating and editing scripts, including adding script-bearing library entries through imports or selections. Existing smart shapes remain placeable, with working interactive handles. |
| `iconify` | Disables Iconify search and import. Previously imported icons remain usable. |

Disabling `shapeLibrary` also disables its management. Disabling management also disables smart-shape
authoring and Iconify additions, regardless of their individual switches. A fixed library with a
single-sketch interface therefore needs only:

```json
{
  "version": 1,
  "features": {
    "workspace": false,
    "shapeLibraryManagement": false
  }
}
```

Settings load once before the app accepts input. A missing file (HTTP 404) quietly uses defaults.
An invalid file, unsupported version, invalid title, unknown switch, non-boolean switch, network
failure, or request taking more than two seconds uses defaults and shows a persistent warning. Reload after changing
settings. Deployment settings stay separate from saved sketches and workspaces.

The storage-failure warning still offers a workspace recovery download when workspace controls are
disabled, so existing tabs and unsaved changes can always be recovered. Opening a workspace through
**Open sketch…** still lets users choose a single sketch from that file.

## Releases

Push a version tag beginning with `v` followed by a digit, such as `v1.0.0`, to create
a GitHub release with automatically generated release notes:

```sh
git tag v1.0.0
git push origin v1.0.0
```

Tag a commit that includes `.github/workflows/release.yml`. Each release attaches
`README.md`, `index.html`, `settings.example.json`, and the demo library renamed to
`shapes-library.json`. GitHub also provides
the usual source archives as ZIP and tar.gz downloads. The workflow uses the built-in `GITHUB_TOKEN`;
no additional secrets or build step are needed.

Licensed under the MIT License.
