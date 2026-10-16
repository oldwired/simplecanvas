# SimpleCanvas

A small, zero-dependency browser sketching canvas. Open `index.html` directly; no build step or
runtime installation is needed.

Try the [public demo](https://oldwired.github.io/simplecanvas/) or the
[Really Simple demo](https://oldwired.github.io/simplecanvas/reallysimple/), which uses the same
app with all optional features disabled and the page title **Really SimpleCanvas**.

- [Get started](#get-started)
- [Draw and edit](#draw-and-edit)
- [Save and reopen](#save-and-reopen)
- [Export and print](#export-and-print)
- [Shape libraries and smart shapes](#shape-libraries-and-smart-shapes)
- [Deployment and settings](#deployment-and-settings)
- [Development and releases](#development-and-releases)

## Get started

1. Open the demo or download `index.html` and open it in a browser.
2. Choose a drawing tool, then drag on the canvas to draw. Use **Select** to move or edit objects.
3. Use **File → Save sketch…** to download an editable JSON file. **Add tab** starts another drawing;
   **Save workspace…** downloads all open tabs.

The app automatically saves drawings in this browser. See [Save and reopen](#save-and-reopen)
for how autosave, downloaded files, and library files differ.

## Draw and edit

- **Select and transform:** click an object or drag a selection box from empty canvas. Shift-click
  adds or removes objects from the selection. Drag selected objects to move them, corner handles
  to resize, and the round handle above the selection to rotate. Shift constrains resize
  proportions; Ctrl/Cmd resizes from the center.
- **Groups:** select several objects and press Ctrl/Cmd+G to group them. Double-click a grouped
  object to edit individual members without ungrouping. Click outside the group, press Escape,
  or switch tools to leave group editing. A second double-click opens a member's text editor or
  smart-shape controls.
- **Text and tables:** drag with the Text tool to create a text box. Choose table dimensions and
  click to place a table. Double-click or long-press text or a table cell to edit it.
  **Shift+Enter** inserts a newline; **Enter**, **Escape**, or clicking away commits the text.
- **Images:** use **Insert image**, paste an image, or drag an image file onto the canvas.

### Text formatting and copying

A text item whose first line is exactly `---` supports Markdown headings, emphasis, lists,
links, and rules. Markdown stays left/top-aligned; cropped PNG/SVG exports include the full
rendered content. Table cells remain plain text.

Copying a selection keeps editable objects available for pasting within the app. When the
browser supports and permits clipboard writing, it also copies editable SimpleCanvas JSON
and a PNG fallback for other applications. External clipboard writing can fail independently
of the internal copy; use **Export PNG** if pasting into another application fails.

### Lines, arrowheads, and point editing

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

### Keyboard shortcuts

Use Ctrl on Windows/Linux and Cmd on macOS for the shortcuts below. Text fields keep their
own editing shortcuts.

| Shortcut | Action |
| --- | --- |
| Ctrl/Cmd+S / Ctrl/Cmd+O | Save / open the active sketch |
| Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z | Undo / redo (Ctrl/Cmd+Y also redoes) |
| Ctrl/Cmd+C / Ctrl/Cmd+V | Copy / paste |
| Ctrl/Cmd+D | Duplicate selection |
| Ctrl/Cmd+G / Ctrl/Cmd+Shift+G | Group / ungroup |
| Arrow keys / Shift+Arrow keys | Move selection by 1 px / 10 px |
| `[` / `]` | Send selection to back / bring to front |
| `,` / `.` | Rotate selection by −15° / +15° |
| Delete / Backspace | Delete selected objects, or the selected anchor during point editing |
| Escape | Leave editing or clear selection; while entering text, commit it |
| Ctrl/Cmd+P | Print |

Tool shortcuts: **V** Select, **P** Pen, **M** Highlighter, **B** Felt-tip, **E** Eraser, **L** Line,
**A** Arrow, **R** Rectangle, **O** Ellipse, **G** Polygon, **T** Text, **Y** Table.

## Save and reopen

Sketches and tabs are saved automatically to this browser's local storage and restored on the
next visit. This storage is local to the browser; downloadable JSON files let you keep a backup
or move your work elsewhere. Sketch/workspace JSON retains smart-shape scripts and saved state.

| File action | Scope |
| --- | --- |
| **Save sketch…** | Downloads the active sketch as JSON, including its images |
| **Save workspace…** | Downloads all open tabs as one JSON file |
| **Open sketch…** | Replaces the active sketch; when given a workspace file, lets you choose one sketch |
| **Open workspace…** | Replaces all open tabs; a single-sketch file becomes one tab |

Closing a tab deletes its contents from the workspace; save a file first if you want to keep it.
The app asks before closing a tab that contains objects.

Working drawings stay in memory when browser storage is full or unavailable. A persistent warning
offers **Save workspace…** if automatic saving fails; save the file before leaving the page.
Library changes are separate from sketch saves and autosave: use **Export library…** to retain them.

## Export and print

**Export PNG** and **Export SVG** capture the active sketch, cropped to its painted content with
margins. Both capture a static reading of live smart shapes. PNG exports use 2× resolution;
SVG preserves vector geometry.

**Export HTML** creates a self-contained copy of all working tabs at the current canvas size,
with live smart-shape controls. Images are embedded in the file, and each tab retains its own
content and group rotations, including changes that could not be saved automatically. When
workspace controls are disabled, HTML export includes only the active sketch.

### Interactive HTML

Exported HTML keeps clocks live and smart controls interactive, directly on the page, offline.
Shape positions and sizes stay fixed unless the script's `exportBehavior` permits moving,
rotating, or resizing either dimension. In the ruler's edit mode, **HTML: move / rotate** enables
both moving and rotating; **HTML: extend** enables width changes for that instance. These
authoring controls stay out of the export. Changes in an exported page stay in memory across
its tab switches; reloading or reopening the file restores the exported state.
Click a shape to show its rotation handle; click elsewhere or press **Escape** to hide it.
Hold **Shift** while rotating to snap to 15° increments, just as in the editor.
See [Smart Shapes](SMART_SHAPES.md#html-export-behavior) for script permissions and the
`editorOnly` marker.

### Print

**File → Print** or **Ctrl/Cmd+P** opens a paper preview of the active sketch, defaulting to
**Actual size (100%)** and **Landscape**. Select A4/Letter, orientation, and margins in millimeters,
or choose **Fit to page** to scale the drawing. If the actual-size drawing exceeds the printable
area, the preview shows what will be cut off. Change the settings, choose Fit to page, or check
**Print anyway at 100% and clip to the printable area** to print the visible portion on one page
without shrinking it. Clipping permission resets when you change the layout or reopen the dialog.
The optional 50 mm reference mark
lets you check the physical output. The preview is a frozen snapshot with editor controls removed.
In the browser print dialog, use the same paper and orientation, **100% / Actual size**, no extra
margins, and headers/footers off. The preview already includes margins and any Fit to page scaling;
browser or printer-driver scaling can still change the physical output. The custom print preview
also works when the app is opened directly from the local `index.html` file.
Deployments can set `features.customPrinting` to `false` in `settings.json` to use regular browser
printing for both the menu and keyboard shortcut.

Choose **Tile at actual size** to print a larger drawing across several sheets at **100%**.
The dialog shows the page count and grid dimensions; use the arrows below the preview to inspect
each sheet. Printing includes every sheet, regardless of which preview page is selected.
**Overlap (mm)** repeats part of the drawing on neighbouring sheets (10 mm by default, adjustable
from 0 to 50 mm). **Include alignment marks** adds matching crosses in the shared area.
Trim the paper margins, overlap the repeated artwork, and line up the crosses to assemble the drawing.
With zero overlap, trim to the printed edges and join them. Sheets are numbered left to right,
then top to bottom, with row and column labels below the artwork. The optional 50 mm reference mark
is repeated on each sheet. Layouts support up to 100 pages; choose larger paper, smaller margins
or overlap, or Fit to page if the drawing needs more.

### Physical scale

The ruler and drilling template share a scale of **96 canvas px = 1 inch = 25.4 mm**. Resizing the
drilling template changes hole spacing while its diameter stays fixed in millimeters. Export SVG
and print at **Actual size / 100%**, with page fitting disabled, for physical templates. SVG keeps
fractional dimensions to preserve this scale. PNG exports use 2× resolution: one inch spans 192
image pixels, so use **192 pixels per inch** when placing/printing them at the intended size.
Both exports include margins; the complete image width exceeds the ruler's marked length. Screen
display size does not guarantee physical dimensions.

## Shape libraries and smart shapes

The shape library is optional. The small toolbar popup remains a quick picker for your
**working collection**. Click a shape, then click the canvas to place it. Open the expanded
library browser with the **Browse** icon when you want to find more shapes: search by name or
tags, choose a category, and filter the collection with **All collections**, **Built-in**, or **Mine**.
**Back to collection** returns to the quick picker.

| Category | Examples |
| --- | --- |
| Controls | Number control, Toggle, Constant |
| Logic | AND, NAND, OR, NOR, XOR, XNOR, NOT, Buffer, Tri-state buffer, Compare, Inverter (×−1), Math |
| Displays | Gauge, Value label, Status indicator |
| Tools & time | Live clock, Stopwatch, Ruler |
| Drawing | Rectangle, Ellipse |

You can place an entry directly from the browser without adding it to the working collection.
Each browser entry has a pin: filled means it is in the working collection; outline means it
is outside. Click the pin to toggle membership, or use **Keep in collection** / **Remove from
collection** in the entry details. Unpinning only removes the shortcut; its catalog entry and
already-placed objects remain available. Keeping a built-in entry references the same definition
rather than creating a user copy.

Built-in entries are available offline and cannot be edited in place. Use **Copy to mine**
to customize one. This creates a separate entry in Mine and adds it to the working collection.
**Edit details** changes its name, category, description, and tags. Personal entries also offer
**Edit source…** and **Delete** from their browser details, including when they are unpinned.
**Add selection** saves selected canvas objects to your collection, and
**Manage → Import…** opens a library file. **Manage** also offers **Add smart shape…**, rename,
delete, and replacement with the current selection. For your smart shapes, **Edit** opens the
script authoring dialog. Library edits never update already-placed objects. Images cannot be
included in library entries.

**Export library…** downloads a self-contained `shapes-library.json`, including the working
collection, every entry in Mine, and the definitions they need. Kept built-ins are included as snapshots, so the
file does not depend on another installation having the same built-in version. Library format 2
preserves entry IDs, categories, tags, and working-collection membership. Older flat libraries
still import; their entries appear in **Mine** and initially populate the working collection.
Importing a user library leaves the built-in catalog available.

Library edits and working-collection changes last only for the current visit, separately from
sketch saves and autosave. An indicator shows unexported changes; importing another library or
leaving the page warns before those changes are discarded. Export and reimport the file to
retain your collection for another visit.

Libraries include PNG thumbnails, which display without running shape scripts. Ordinary missing
previews are generated automatically. Imported smart shapes with missing previews show placeholders
and ask before running scripts to generate pictures; **Use placeholders** still loads the library.
**Generate missing previews…** lets you generate them later. Export the library to retain new previews.

### Smart shapes

**Manage → Add smart shape…** creates script-defined shapes from templates such as Clock,
Live clock, Stopwatch, Ruler, Timer, Arrow, Arc, and Chart. Double-click a placed smart shape to
edit its handles, then double-click again or click outside to leave. If it belongs to a group,
the first double-click enters group editing and the second opens its smart controls. Clicks
and drags support undo/redo.

Scripts run in an isolated Worker with blocked network access, and generated shapes are
validated before rendering or export. The app still works as a single local HTML file.
Authoring details are in [SMART_SHAPES.md](SMART_SHAPES.md).

### Connected components

Open [examples/connected-components.json](examples/connected-components.json) with
**File → Open sketch…** to try a Number control connected to a separate Gauge. Double-click
the control, then drag its slider or click **−5 / +5**. The gauge follows its value. **Export HTML**
keeps that connection working offline; reopening the HTML restores the exported values.

To build your own pair, place **Number control** and **Gauge** from the built-in library.
Their script templates also remain available for authoring. Select the gauge, click **Inputs…**,
choose **Number control · value** for its
`value` input, and save. The same dialog can name an instance or set a literal input value.
It lists compatible outputs from components in the active sketch.
Give repeated instances distinct names in **Inputs…** so their outputs are easy to identify.
Every built-in component displays that instance name as its caption, separately from its
operation, value, or state. This includes Number control, Constant, Gauge, and all logic gates.
Long names fit within the caption area, and names persist in saved sketches and exports.

The built-in logic components use the same typed connections. **AND**, **NAND**, **OR**, **NOR**,
**XOR**, **XNOR**, **NOT**, and **Buffer** use traditional logic-gate shapes and boolean ports.
**Compare** outputs whether its numeric input is strictly greater than its configured threshold.
**Inverter (×−1)** takes and returns a number; **NOT** takes and returns a boolean.
For example, **Compare** and **Toggle** can feed **AND**, whose output drives a **Status indicator**.

**Tri-state buffer** has boolean `value` and `enable` inputs. When `enable` is true, the output
follows `value`; when false, it is **Z (high impedance)**, not an inverted value. Its separate enable
pin and purple Z indicator distinguish it from ordinary Buffer and NAND. A boolean consumer connected
to Z shows an unavailable state until the buffer is enabled; you can save that connection while it
is disabled. Missing connections still show amber, not Z. Each input has one source; shared-bus
resolution and electrical simulation are outside this component's behavior.

**Math** takes two numeric inputs, `a` and `b`, and outputs `value`. In **Inputs…**, connect each
input or enter a number, then choose **+**, **−**, **×**, or **÷** in the `operation` dropdown.
Subtraction means `a − b`; division means `a ÷ b`. Each instance keeps its own operation.
You can connect its result to another Math block, Compare, Gauge, or Value label. Division by
zero and overflow report an error and leave the result unavailable; correcting the input
restores the connected calculation, including in exported HTML.

**Trigger**, in **Controls**, is a pushbutton with a boolean `value` output. Double-click it to
enter its controls, then click **Press**: each completed click emits `true` for 0.1 seconds and
returns to `false`. Holding the button does not repeat. Rapid clicks queue distinct pulses,
separated by at least 0.01 seconds of `false`, so a Counter can register every press. Each instance
holds up to 64 waiting presses and reports an error if full. Connect **Trigger · value** to a
Counter's `value` input through **Inputs…**. In exported HTML, click the button directly.
Queued presses are transient; reopening, copying, or undoing never replays old presses.

The **Tools & time** category adds connected signals with per-instance timing:

- **Delay** accepts a boolean `value` and `seconds` (0–3,600, including fractions). Every on/off
  transition appears at its output after that delay, including short pulses. Zero passes through
  immediately. Changing the duration clears pending transitions and starts again from the current
  input; each instance holds up to 64 pending transitions and shows an error if full.
- **Counter** accepts boolean `value`, numeric `threshold`, and boolean `reset`. Each false → true
  transition adds one; holding true does not keep counting. Outputs are `count` and `reached`
  (`count >= threshold`). The threshold is a nonnegative integer. An initially high input does
  not count. Hold `reset` true to keep the count at zero, or double-click and use **Reset**.
- **Random integer** accepts inclusive integer `min` and `max`. It emits immediately, then once
  per second. The same number may be drawn twice. Negative bounds and a single-value range work.
- **Sample & hold (integer)** and **Sample & hold (Boolean)** accept `value` and `seconds`
  (0.01–3,600). They sample immediately, hold that value for the chosen duration, then sample again
  at the start of each new hold. Changing the duration samples immediately and restarts the period.
  The integer variant requires safe integers; the Boolean variant connects directly to gates.

Configure and connect them in **Inputs…**. For example, connect Random integer → Sample & hold
(integer) → Value label, or Toggle → Delay → Counter → Status indicator using `reached`.
The controls, names, indicators, and connections work in exported HTML too.
Timing uses active document time: hidden/inactive documents and the open **Inputs…** dialog pause
it. Late wakes replay Delay transitions in order; Random and Sample & hold take one new sample,
without a burst of missed samples. These are browser-timed signals, not a real-time circuit simulator.
Counts and current outputs are saved. Pending Delay transitions and timing/edge memory are transient:
reload, copy, undo, rewiring, or recovery from unavailable inputs starts fresh observation without
counting an already-high input. Static exports and previews capture saved values without sampling.

Input/output indicators are on by default for these logic entries. Green means true, grey means
false, and blue means a numeric value is available, including zero. Amber means unavailable.
With valid inputs, double-click the shape and use **Indicators: on/off** to change that instance.
Compare's editor controls also adjust its threshold. These controls stay out of exports, while
the saved indicator preference is retained.

Missing or invalid inputs show an unavailable state rather than a false result. The built-in
logic entries keep their silhouette, display **—** for unavailable values, and show **Input
required** or **Input unavailable**. Custom components can provide their own unavailable drawing;
otherwise the app displays a status card. Their handles are inactive until the component recovers.

Connections survive sketch/workspace saves, autosave, and undo/redo. Copy or duplicate both
components to create an independently connected pair. Copying only a consumer leaves its
external source unresolved; use **Inputs…** to reconnect it. Deleting a source also reports
a missing connection, and undo restores it. Static PNG/SVG/print capture the computed result.
Set `features.smartComponents` to `false` in `settings.json` to hide component templates and
the input picker and disable component authoring. Existing connected drawings and HTML exports
keep working. Component authoring also requires `smartShapeAuthoring` to be enabled.

This first version supports number, string, and boolean values within one sketch. See the
[component scripting contract](SMART_SHAPES.md#connected-components-api-v2) for custom ports
and computations. Datasets, events, and external actions remain future work.

### Demo library

The public demo library includes thirteen shapes. Open the shape library in the toolbar,
choose a shape, then click the canvas to place it. All demo entries include saved previews.
You can also import [examples/demo-shapes-library.json](examples/demo-shapes-library.json)
through **Manage → Import…** when using the app locally.

| Shapes | What they do |
| --- | --- |
| Six sailing shapes | Two boats, start and finish lines, a course mark, and a wind arrow |
| **Clock** | Manually adjustable clock; double-click to drag its hands |
| **Bar chart** | Drag bars and add/remove them with the +/− controls in edit mode |
| **[Drill template](examples/drill-template.js)** | Handles adjust hole diameter and position; resizing changes hole spacing while diameter stays fixed in millimeters |
| **[Race start timer](examples/race-start-timer.js)** | A draggable clock hand and clickable mast controls for changing flags |
| **[Live clock](examples/live-clock.js)** | Follows local time |
| **[Stopwatch](examples/stopwatch.js)** | Start/Pause and Reset controls in edit mode; a running stopwatch continues across tab switches and reloads |
| **[Ruler](examples/ruler.js)** | Extends its markings at fixed spacing; in edit mode, click the unit label to cycle cm with mm divisions, inches with sixteenth-inch divisions, and pixels |

Live clock, Stopwatch, and Ruler are also templates under **Manage → Add smart shape…**.
See [Physical scale](#physical-scale) for printing rulers and drilling templates.

### Import icons

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

## Deployment and settings

When hosted, an optional `shapes-library.json` beside the HTML supplies the initial user library
and working collection alongside the built-in catalog.
The file is read only at startup; opening the picker never reloads it. File imports work when
hosted or opened locally, including importing the demo file via **Manage → Import…**.
For a standard deployment, copy just `index.html`. Add your own library as `shapes-library.json`
if needed. The HTML works on its own without a library file.

### Optional deployment settings

For a hosted deployment, copy [examples/settings.example.json](examples/settings.example.json)
to `settings.json` beside `index.html`, and change the feature switches you need. You can omit any switch: all
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
| `shapeLibraryManagement` | Hides library management and disables pins, copying to Mine, library import/export, rename, replace, and delete. The browser and direct placement remain available. |
| `smartShapeAuthoring` | Disables creating and editing scripts, copying smart definitions into Mine, and adding them through pins, imports, or selections. Existing smart shapes remain browsable and placeable, with working interactive handles. |
| `smartComponents` | Hides component templates, source editing, and Inputs; blocks adding component definitions through pins, copies, scripts, imports, or selections. Ordinary smart-shape authoring stays available. Existing components remain browsable and placeable; their controls, connections, and HTML exports keep working. |
| `iconify` | Disables Iconify search and import. Previously imported icons remain usable. |
| `customPrinting` | Uses regular browser printing instead of the custom paper preview, for both File → Print and Ctrl/Cmd+P. |

Disabling `shapeLibrary` also disables its management. Disabling management also disables smart-shape
authoring and Iconify additions, regardless of their individual switches. Disabling smart-shape
authoring also disables component authoring. A fixed library with a
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

### GitHub Pages

The **Deploy demo to Pages** workflow in `.github/workflows/pages.yml` prepares a directory with
`index.html` and `shapes-library.json`, plus `settings.json` if present. It copies the tracked
`examples/demo-shapes-library.json` to that conventional library name, so the existing loader
picks it up.
The workflow also publishes `reallysimple/index.html` (a copy of the same HTML) and
`reallysimple/settings.json`, with all optional features disabled. The variant settings are
tracked in [reallysimple/settings.json](reallysimple/settings.json). Only the prepared directory
is uploaded to Pages.

For a new deployment or fork, ensure the workflow is present on `main`, then open the
repository's **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**.
Run **Deploy demo to Pages** from the Actions tab. Subsequent changes to the HTML, demo library,
either settings file, or workflow on `main` deploy automatically.

## Development and releases

Developer checks, browser setup, and regression-test commands are described in
[tests/README.md](tests/README.md). Test dependencies are for development only; the app itself
requires no build step or runtime dependencies.

### Update the demo library

Import `examples/demo-shapes-library.json`, edit it in **Manage**, export the library, and save
the download back as `examples/demo-shapes-library.json`. The contributor shapes embed their
complete `.js` example scripts: keep the drilling template and race-start timer examples and
library sources in sync. Live clock, Stopwatch, and Ruler also have embedded authoring templates
in `index.html`; update those copies, their `.js` examples, library sources, and saved previews
together when changing a script.

### Releases

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
