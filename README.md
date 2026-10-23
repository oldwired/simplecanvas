# SimpleCanvas

A self-contained browser sketching canvas. Open `index.html` directly; no build step or runtime
installation is needed. MQTT support includes a bundled browser client, with no CDN dependency.

Try the [public demo](https://oldwired.github.io/simplecanvas/) or the
[Really Simple demo](https://oldwired.github.io/simplecanvas/reallysimple/), which uses the same
app with all optional features disabled and the page title **Really SimpleCanvas**.

- [Get started](#get-started)
- [Draw and edit](#draw-and-edit)
- [Save and reopen](#save-and-reopen)
- [Run a workspace preview](#run-a-workspace-preview)
- [Export and print](#export-and-print)
- [Shape libraries and smart shapes](#shape-libraries-and-smart-shapes)
- [Deployment and settings](#deployment-and-settings)
- [Development and releases](#development-and-releases)

## Get started

1. Open the demo or download `index.html` and open it in a browser.
2. Choose a drawing tool, then drag on the canvas to draw. Use **Select** to move or edit objects.
3. Use **File → Export sketch…** to download an editable JSON file. **Add sketch** starts another drawing;
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
  New image insertions are limited to 16 MiB and 40 megapixels and reduce accepted large images
  to a maximum dimension of 1,800 pixels. Saved/imported assets retain the 16 MiB per-image and
  64 MiB per-sketch byte limits; their existing resolution is preserved.

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
| Ctrl/Cmd+S / Ctrl/Cmd+O | Save / open the workspace; export / import the current sketch when workspace mode is disabled |
| N / Shift+N | Add sketch / New workspace (when workspace mode is enabled) |
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

Sketches and tabs are saved automatically as one atomic IndexedDB workspace snapshot and restored
on the next visit. This storage is local to the browser; downloadable JSON files let you keep a backup
or move your work elsewhere. Sketch/workspace JSON retains placed smart-shape scripts, saved state,
and connections. A workspace contains all open sketch tabs; it excludes the library, pins, and
category organization. The library is saved separately in this browser. **Export library…** makes
a portable backup of it.

Repeated smart-shape scripts are stored once per native workspace/sketch file and once in an HTML
reader payload. Instances keep independent state, geometry and connections; editing one instance
does not change another. Older inline-script files remain readable.

Only one editor window can write the current workspace for a browser profile, site and application
path. Other windows stay read-only. **Take over editing** loads the latest saved workspace and
transfers editing ownership; download unsaved work before taking over. If a saved record cannot be
read, the app preserves it and offers a recovery download before an explicit fresh start. Legacy
localStorage drawings remain as a backup after migration. Exported HTML readers do not share this
editor storage or ownership.

The File menu groups actions into **Workspace** and **Current sketch**. Exports live under the
scope they capture: **Workspace → Export HTML** includes every tab, while **Current sketch**
contains JSON, PNG, SVG, and HTML exports of the active drawing, plus Print.

| File action | Scope |
| --- | --- |
| **New workspace…** | Replaces all tabs with one blank **Sketch 1**, with an option to save the current workspace first |
| **Add sketch** | Adds a blank sketch to the current workspace |
| **Duplicate sketch** | Copies the current sketch and its owned datasets with independent IDs; internal connections follow the copy |
| **Export sketch…** | Downloads the active sketch as JSON, including its images |
| **Save workspace…** | Downloads all open tabs as one JSON file |
| **Import sketch…** | Replaces the active sketch; when given a workspace file, lets you choose one sketch |
| **Open workspace…** | Replaces all open tabs; a single-sketch file becomes one tab |
| **Workspace → Export HTML** | Exports all tabs as an interactive HTML file |
| **Current sketch → Export HTML** | Exports only the active sketch as an interactive HTML file |
| **Clear current sketch** | Empties only the active sketch, keeps its tab name, and supports Undo |

When the workspace contains work, **New workspace…** offers **Save & start new**, **Start new**,
and **Cancel**. The save option starts a workspace JSON download before replacing the tabs; your
browser controls where the file is saved and whether the download completes. Starting a new
workspace discards the old tabs and their Undo histories. It keeps your shape library, categories,
and pinned Working collection. Use **Clear current sketch** when you want an undoable reset of
just the current drawing.

Closing a tab deletes its contents from the workspace; save a file first if you want to keep it.
The app asks before closing a tab that contains objects.

When tabs overflow, arrow buttons scroll the bar and faded edges indicate hidden tabs.
**All tabs** lists their full names and lets you jump directly to a drawing. With a tab focused,
**Left/Right** switches tabs and **Home/End** selects the first/last tab. The active tab is brought
into view when selected. These controls also work in exported HTML and hide when all tabs fit.

Working drawings stay in memory when browser storage is full or unavailable. A persistent warning
offers **Save workspace…** if automatic saving fails; save the file before leaving the page.
Library changes are saved separately in this browser, including the Working collection and
categories. If that save is pending or fails, the app warns before leaving; a visible failure banner
offers **Retry** and **Export library…**. Export also provides a backup if browser data is cleared.

## Run a workspace preview

Click **Run** in the toolbar to use a separate copy of your workspace with the same interaction
and permissions as an HTML export. Controls work directly; dataset imports, permitted edits,
navigation and result downloads work inside the preview. With workspace controls disabled, Run
previews only the current sketch. It is also available when component authoring is disabled or
the authoring workspace is read-only.

Preview uses a regular file chooser for dataset imports. To read later disk changes, choose the
file again; its isolated frame cannot retain native reload handles. Standalone HTML exports can
use those handles in browsers that support them. Markdown links still open in a separate tab.

Finish or cancel an active drawing first. Run commits ordinary text editing, cancels unsubmitted
smart-input drafts and unfinished file imports, and waits for already accepted component actions
or placements before capturing the copy.

**Return to editing** discards the preview copy. Its changes do not merge into your drawings,
history or autosave; authoring simulation pauses during preview and resumes its previous
running/paused status afterward. Existing wall-clock behavior is preserved: a running stopwatch
still measures real elapsed time. Each Run starts fresh from the authoring workspace. Use the
preview's **Download table** controls to keep results as CSV or JSON before returning; downloaded
files remain available after the copy is discarded.

The opening sketch follows HTML export rules: a valid zero-based `?page=N` parameter wins,
otherwise Workspace settings chooses the initial sketch, falling back to the first. Preview
starts with the editor URL's query parameters. Go to tab changes them inside the preview without
rewriting the editor's browser URL. The reader's window title appears in the preview header; the
editor's browser title stays unchanged.

Return to editing stays above the reader even when Sketch settings hides its navigation. Escape
in that header returns to editing or cancels startup; Escape inside the reader keeps its ordinary
control behavior. If startup fails, the header remains available to return safely.

## Export and print

**Export PNG** and **Export SVG** capture the active sketch, cropped to its painted content with
margins. Both capture a static reading of live smart shapes. PNG exports use 2× resolution;
SVG preserves vector geometry.

**Workspace → Export HTML** creates a self-contained copy of all working tabs at the current canvas size,
with live smart-shape controls. Images are embedded in the file, and each tab retains its own
content and group rotations, including changes that could not be saved automatically.
**Current sketch → Export HTML** exports only the active sketch with the same live controls.
When workspace controls are disabled, only current-sketch exports are shown.

### Interactive HTML

Exported HTML keeps clocks live and smart controls interactive, directly on the page, offline.
Shape positions and sizes stay fixed unless the script's `exportBehavior` permits moving,
rotating, or resizing either dimension. In the ruler's edit mode, **HTML: move / rotate** enables
both moving and rotating; **HTML: extend** enables width changes for that instance. These
authoring controls stay out of the export. Changes in an exported page stay in memory across
its tab switches; reloading or reopening the file restores the exported state.
Click a shape to show its rotation handle; click elsewhere or press **Escape** to hide it.
Hold **Shift** while rotating to snap to 15° increments, just as in the editor.
**Workspace settings** selects **Active sketch only** or **Whole workspace** execution. Whole
workspace mode keeps components active across sketches, including sketches hidden from the tab bar.
Hiding the browser page pauses clocks and new activity, while already accepted events finish.
Leaving or reloading the page cancels unfinished work.
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
**Working collection** of pinned shortcuts. Drag a thumbnail onto the canvas, or click a shape
and then click the canvas to place it. Both methods work in the Working collection and the full
library browser, including grouped shapes and smart components. A drag shows a floating preview
and closes the popup; release on the canvas to place the shape centered there. Escape or releasing
outside the canvas cancels without changing the drawing. Each placement is one Undo step.
On touchscreens, press and hold a thumbnail before dragging; a quick swipe still scrolls the library.
Open the expanded library browser with the **Browse** icon: search by name or
keywords, choose a category, and use the **Source** filter for **Built-in** or **My shapes**.
**Collapse library** closes the expanded browser and leaves the quick picker available.

Built-ins can appear in several categories according to their purpose. Numbers and Text bring
related controls, operations, and displays together; Data covers tables and structured data.
Network groups HTTP and MQTT connections; Workspace groups settings, navigation and cross-sketch
communication. These are additional memberships, so the components remain discoverable in Data,
Controls or Logic where appropriate.

| Category | Examples |
| --- | --- |
| Controls | Number control, Text input, Number input, Dropdown, Spreadsheet, Dataset editor, Toggle, Constant, Trigger, Download table, Go to tab, Sketch settings, Workspace settings |
| Logic | Boolean gates, Tri-state buffer, Compare, Text compare, selectors, stepped switches, registers, latches, counters, pulse tools, Publish, Receive |
| Numbers | Numeric controls, Math, Inverter (×−1), Clamp, Range mapper, Number function, numeric selectors/registers, text/number conversion, Spreadsheet, Table aggregate, Gauge, and charts |
| Text | Text input, Text label, Memo, Dropdown, Text lookup, text operations, text/number conversion, JSON extract/build/edit, URL parameter |
| Displays | Gauge, Value label, Text label, Memo, Status indicator, Seven-segment display, LED matrix (8×8), Chart, Data bar chart, Dataset editor, and clocks/timers |
| Tools & time | Clock, Live clock, Stopwatch, Timer, Ruler, Delay, Counter, Random integer, Sample & hold (integer/Boolean), Pulse generator, Edge to pulse, Signal → event, Event → pulse, Date parse, Date format, Date difference |
| Data | Dataset, Capture row, Table filter, Table sort, Table aggregate, Dataset editor, Spreadsheet, Data bar chart, Download table, Dropdown, Text lookup, JSON extract/build/edit, HTTP GET, HTTP POST, MQTT Config/Subscribe/Publish, URL parameter, Publish, Receive |
| Network | HTTP GET, HTTP POST, MQTT Config, MQTT Subscribe, MQTT Publish |
| Workspace | Workspace settings, Sketch settings, Go to tab, URL parameter, Publish, Receive |
| Drawing | Rectangle, Ellipse, Arrow, Arc, Ruler, Minimal, Blank |

The catalog includes 101 entries, including 92 connected API v2 components. Every smart-shape
template is available in **Built-in**. Drill template and Race start timer remain in the
importable [demo library](examples/demo-shapes-library.json) and as standalone example scripts.

You can place an entry directly from the browser without adding it to the working collection.
Each browser entry has a pin: filled means it is in the working collection; outline means it
is outside. Click the pin to toggle membership, or use **Pin to working collection** / **Unpin from
working collection** in the entry details. Unpinning only removes the shortcut; its catalog entry and
already-placed objects remain available. Keeping a built-in entry references the same definition
rather than creating a user copy.

Built-in shape definitions are available offline and read-only. Use **Copy to My shapes**
to customize one. This creates a separate entry in My shapes and pins it to the working collection.
For an entry already in My shapes, the same action is called **Duplicate**.
**Edit details** changes a personal entry's name, description, and search **Keywords**. Personal
entries also offer **Edit script…** and **Delete from library** in their browser details, including when unpinned.
**Add selection** adds selected canvas objects to My shapes and pins the new entry.
The **Actions** buttons in the compact picker and browser open the same **Library actions**
surface, including **Import shape…**, **Import library…**, **Export library…**, and
**Add smart shape…**, on desktop and mobile.
Library edits never update already-placed objects. Images cannot be included in library entries.

**Export shape…** in an entry's browser details or compact Actions downloads a `name.shape.json`
file for that entry. It supports ordinary shapes, smart shapes, connected components, and grouped
items, retaining their internal connections, categories, keywords, description, preview, and source
credits. **Actions → Import shape…** adds it to My shapes with a fresh ID and unique name, then pins
it. This adds to the current library; even an exported built-in becomes an editable personal copy.
Exporting one shape does not clear the whole library’s unexported-change indicator.

Categories are named tags: an entry can belong to several, including built-in entries. Create,
rename, and remove categories through **Library actions**, and assign memberships to entries.
An entry's **Edit categories…** dialog also offers **New category…** while choosing memberships.
Removing a category removes that membership, while preserving shapes, pins, and other categories.
Empty categories remain available; entries with no memberships appear under **Uncategorized**.
Search **Keywords** are separate from category membership.
Built-in category assignments start from the bundled defaults; your own assignments, including
removing every category, take precedence and survive reloads and exports.

**Export library…** downloads a self-contained `shapes-library.json`, including the working
collection, every entry in My shapes, category organization, and the definitions they need.
Pinned built-ins are included as snapshots, so the file does not depend on another installation
having the same built-in version. Library format 2
preserves entry IDs, category memberships (including built-in overrides and empty categories),
keywords, and working-collection membership. Older flat libraries and single-category entries
still import; personal entries appear in **My shapes**. **Import library…** replaces the current user library
and its organization and pins, while leaving the built-in definitions available.

Your personal library, scripts, PNG previews, category organization (including built-in overrides),
and Working collection pins are saved automatically in IndexedDB. They survive reloads and closing
the tab in the same browser/profile at the same site and application URL path. Sketch/workspace
files remain separate; importing a library also saves its replacement contents to this browser.
Built-ins are saved by ID and use the installed definitions on restore; personal scripts are retained.
If another tab saves a newer library, the conflict banner asks you to export your changes and reload
before continuing, preventing this tab from silently overwriting that newer copy.

An indicator tracks changes since the last **Export library…**; it does not mean the browser copy
is unsaved. Leaving the page warns only while a browser save is pending or has failed. A failure
banner offers **Retry** and **Export library…**, and the library remains usable in memory. Export
is for backups and sharing, rather than a prerequisite for the next visit. Keep a downloaded copy
when the collection matters: clearing site data or ending a private-browsing session can remove
the browser copy.

Libraries include PNG thumbnails, which display without running shape scripts. Ordinary missing
previews are generated automatically. Imported smart shapes with missing previews show placeholders
and ask before running scripts to generate pictures; **Use placeholders** still loads the library.
**Generate missing previews…** lets you generate them later. Browser saves retain previews with
your personal library, and library exports include them. Restoring the library does not execute
shape scripts or grant permission to generate missing smart previews.

### Smart shapes

**Actions → Add smart shape…** creates script-defined shapes from templates such as Clock,
Live clock, Stopwatch, Ruler, Timer, Arrow, Arc, and Chart. Double-click a placed smart shape to
edit its handles, then double-click again or click outside to leave. If it belongs to a group,
the first double-click enters group editing and the second opens its smart controls. Clicks
and drags support undo/redo.

When shapes overlap, separate clicks cycle through the layers for selection and moving.
A double-click keeps the smart shape the gesture started on and opens its controls, including
a smart shape you already selected underneath another shape. Double-tapping works the same way.

You can also place any template directly from **Built-in** or pin it to your working collection;
the authoring dialog remains available for source authoring. **Clock** has manually adjusted
hands, **Timer** is a connected countdown, and **Chart** retains its editable bars. **Minimal** is the circle starter;
**Blank** is an intentionally empty authoring starter. All are bundled for offline use.

Scripts run in an isolated Worker with blocked network access, and generated shapes are
validated before rendering or export. The app still works as a single local HTML file.
Authoring details are in [SMART_SHAPES.md](SMART_SHAPES.md).

### Connected components

Smart components turn a sketch into a small interactive application. Typed connections carry
numbers, text, Boolean signals, events and table views. Controls, logic, text tools, spreadsheets
and dataset editors work in the editor and in self-contained HTML exports.

Select a component and open **Edit…** to change its name, settings, or connections. Each input
shows its source and a paused value or diagnostic. Open a source dropdown and type to filter
compatible outputs by component or output name. The current selection changes only when you
choose a result. Compact **Go to source** and **Disconnect** icons have tooltips. **Disconnect** stages removal of a
connection; **Save** applies the draft and **Cancel** discards it. **Go to source** selects the
source component, switching to its publishing sketch for a Receiver and asking before discarding
any unsaved inspector changes. Invalid values are
identified beside their fields, and Save focuses the first invalid field.
Spreadsheet keeps its cell and formula editor; its inspector binds already-declared inputs and
previews outputs without adding a second formula or layout editor.

- [Component reference](docs/components.md): built-ins, ports, configuration, timing and data behavior.
- [Editable catalog workspace](examples/smart-components-workspace.json) and
  [offline HTML](examples/smart-components-workspace.html): thirty-eight examples to explore.
- [Workspace application example](examples/workspace-runtime.json) and its
  [offline reader](examples/workspace-runtime.html): a hidden Services sketch shares data and
  signals with Dashboard and Data editor through explicit Publish/Receive endpoints.
- [HTTP integration example](examples/http-integrations.json) and its
  [self-contained reader](examples/http-integrations.html): independent manual JSON requests,
  automated reads, explicit POSTs, and table responses feeding both a live flow and an editable Dataset.
- [MQTT integration example](examples/mqtt-integrations.json) and its
  [self-contained reader](examples/mqtt-integrations.html): shared broker connections, typed
  readings, retained-message baselines, fresh-message events, and explicit commands with separate
  device replies across three sketches.
- [Scripting API](SMART_SHAPES.md#connected-components-api-v2) and
  [design brief](docs/smart-components-brief.md): custom components and the development roadmap.

Open example JSON with **File → Open workspace…**; save your current workspace first if you want
to keep it. JSON is the editable format. HTML readers retain changes during the session and restore
the exported state when reopened.

Table downloads offer CSV and JSON in both the editor and HTML reader. CSV defaults to
**Spreadsheet-safe**, which prefixes formula-like text with an apostrophe; numeric values remain
numeric. Choose **Raw (exact text)** when you need the original strings without that prefix.

### Read an HTTP endpoint

Place **HTTP GET**, open **Edit…**, and set its **URL**, **JSON pointer** (for example `/value`),
and **Response type**. Click **Refresh** to make one GET request. The mapped `value` and complete
compact `json` text can feed existing components, including JSON extract. Loading, availability,
error and last-updated outputs describe the request. Requests run asynchronously: clocks,
controls, other sources and the rest of the workspace keep processing while a response is pending.
Refresh again supersedes that instance's earlier request; an older response cannot overwrite it.

Edit groups the request, response mapping, automatic refresh and trigger wiring separately.
Automatic refresh, triggers and appearance can be expanded when needed. HTTP POST bodies and
MQTT Publish payloads have multiline editors; switching modes preserves unfinished input values.

Optional settings add **Refresh at intervals** (1–86,400 seconds), debounced URL/JSON-pointer
changes, and **Refresh on startup in Run / HTML**. The startup setting makes one immediate read
per reader session; it does not read immediately on editor import, reload or Undo. Configured
polling also runs in the editor after its interval, with at most one pending poll per source.
Polling pauses with simulation/page visibility and resumes without a catch-up burst.
The **Automatic reads enabled** input gates polling, change/startup reads and connected Refresh
pulses/events; clicking the component's own **Refresh** remains available when it is false.
Automatic requests are limited to 30 per source in 10 seconds; manual Refresh is independent.

Connect a pulse or event to **Refresh** for one deliberate read. A restored high Boolean value
only establishes the trigger baseline. Every successful scalar request emits the captured `value` and
`json` through their hybrid outputs, plus a `completed` event carrying JSON text; failures emit
`failed` error text. Equal responses are separate occurrences, so a Memo log can record each one.

Choose **Table** as the Response type to fetch records instead of a scalar. The same `value` output,
labelled **Table** in this mode, connects directly to Filter, Sort, Aggregate, Dataset editor,
Spreadsheet, charts and table downloads. Connect it to **Dataset → Source** when you need an
editable stored copy. Dataset's **Manual** mode copies on Replace or Append; **Live** mode replaces
the copy on a successful source update, including overwriting local edits. Source errors leave the
stored copy intact. In Run/HTML, enable **Allow source updates in HTML export** on the Dataset and
**Allow reader edits** on its Dataset editor independently. Editing the copy never writes to HTTP.

The pointer selects a nonempty array of flat records, such as
`[{"item":"Apples","quantity":12},{"item":"Pears","quantity":8}]`. Columns are inferred from the
complete response; cells must be consistently typed text, numbers, Booleans or null. Missing fields
become null. A typed `{columns,rows}` object also works, including zero rows:

```json
{"columns":[{"key":"item","type":"string"},{"key":"quantity","type":"number"}],"rows":[]}
```

A bare `[]` has no column definitions and reports a mapping error. Nested objects/arrays inside
cells require preprocessing; this version does not flatten them. Tables stay within 64 KiB per
HTTP response and the existing 1,000-row / 32-column dataset limits. Their `rowCount` output
reports the current size. Table connections carry values; use `completed` for occurrence triggers.
If the complete response exceeds the 2,000-character text-port limit, the table still succeeds:
`jsonAvailable` is false, `json` is withheld, and `completed` carries empty text. Smaller responses
retain the complete JSON text. HTTP results stay transient until explicitly copied into a Dataset
or another storing component; existing Dataset schema checks still apply.

**Authentication** in HTTP GET/POST Edit selects **Session credentials** (default),
**No authentication**, **Bearer token input**, or **Basic auth inputs**. Bearer mode adds a text
`token` input; Basic mode adds text `username` and `password` inputs. Wire these like other controls,
then Refresh or Send. Enter the token without the `Bearer` prefix. Input modes never fall back to
session credentials; No authentication sends neither. Credentials supplied through inputs are
ordinary data: literal values and saved upstream state are included in normal saves, autosave,
copies and exports. The session-credential inclusion chooser does not remove those authored values.
Each POST captures its credentials when Send is accepted; later input changes prepare the next
request. GET uses current credentials on its next read; changing only credentials does not itself
trigger a request.

In **Session credentials** mode, **Credentials…** is available in Edit and on the cards, with
no authentication, a Bearer token or HTTP Basic username/password.
Credential changes made through Edit apply with **Save**; **Cancel** discards the draft.
Changing the target origin requires updating or removing its session credentials. These credentials
stay in a host-owned session store by default; autosave and component copies omit them. Saving a
sketch/workspace or exporting HTML offers a separate, unchecked choice for each source whose
credentials should be included in that particular file. Included credentials are readable from
the file. Credential inclusion does not enable polling or startup; those are separate settings.
Redraw, Undo and restoration never replay an old trigger or Send. Run inherits configured session credentials for convenience, but
starts with its own live-result lifetime; returning cancels its requests and discards its results.

**JSON pointer** chooses the response value for the typed `value` output. For
`{"sensor":{"temperature":21.5},"readings":[10,20]}`, `/sensor/temperature` selects `21.5` and
`/readings/0` selects `10`. Empty selects the root, which must match the chosen Response type.
The `json` output carries the complete response after successful mapping when `jsonAvailable` is true. Pointer syntax is shared
with JSON extract; property names containing `/` use `~1`, and names containing `~` use `~0`.

Responses are limited to 64 KiB of received bytes. Scalar mode also requires the complete compact
JSON to fit 2,000 characters; Table mode can publish rows independently of that text-port limit.
Requests time out after the configured 1–30 seconds
and do not retry automatically. The endpoint must permit browser requests; CORS still applies.
Run keeps its isolated origin, so even a server beside the editor must allow its `Origin: null`
request (or use `Access-Control-Allow-Origin: *` for public, credential-free responses).
[Browser local-network permissions](https://developer.chrome.com/blog/local-network-access)
also apply. Run delegates the browser's local-network
permission to its isolated frame, so Chromium can ask for access to localhost or private-network
endpoints; the user or deployment policy can still deny it. CORS remains required. If local
preview access is unavailable, test in the editor or exported HTML, or use a reachable HTTPS
endpoint that permits Run's origin.
HTTP response snapshots and session credentials stay outside source state, undo history and ordinary
autosave. An explicitly connected consumer can store an event payload, for example in a Memo.
Unavailable results do not silently flow downstream as zero or empty text.

**HTTP POST** sends a JSON **Body**, for example from JSON build. Only **Send**, a connected
false → true Send pulse, or an accepted Send event issues a write. Changing the body, opening
the document, polling, Undo and redraw do not send it. The host captures the body and optional
**Idempotency key** for that action, and never retries automatically. Idempotency depends on the
server honoring the key; a timeout or cancellation cannot prove the write did not happen.

POST exposes the same scalar, JSON and completion outputs. A successful 204/205 response emits
`completed` with empty text and shows **Sent**, without inventing a scalar result. **HTTP status**
lets you distinguish a received HTTP response from an unavailable response; a JSON/mapping error
after HTTP 2xx is a response problem and does not undo the write. MQTT commands use the separate
MQTT Publish component described below.

To try the supplied endpoint files, serve the repository root and open the HTTP example:

```sh
node tools/serve-http-example.cjs
```

Open `http://127.0.0.1:8000/examples/http-integrations.html`, or open the editor at
`http://127.0.0.1:8000/index.html` and import `examples/http-integrations.json`. The development
server enables CORS only for the example JSON/API endpoints. Run can use them where the
browser also permits its isolated frame to access the local network.
Add `?delay=2500` to a source URL to see the clock and slider continue during a slow request.
The four sketches cover manual reads, automatic reads/event logs, JSON build → POST, and HTTP tables.
The first reads `/examples/http-reading.json` and `/examples/http-reading-alternate.json`;
change a file, then Refresh. `/examples/api/reading` changes its reading on each request, and
`/examples/api/stock` changes the first stock quantity on each request. Its fourth sketch compares
a direct table flow with an editable Live Dataset; `/examples/http-stock.json` supplies the same
records as a fixed fixture. Add `?empty=1` to the stock endpoint for a typed empty table.
`/examples/api/echo` accepts POSTs in memory only. Add `?status=503` for a controlled failure or
`?status=204` to the POST endpoint for an empty acknowledgement. A reused idempotency key returns
the original response for the same body and HTTP 409 for a different body. Demo records/keys
disappear on server restart; this helper is not a production service. If deployed under `/canvas/`, change these URLs to
`/canvas/examples/…`. Downloaded HTML contains its runtime; live reads still need a reachable
endpoint. Its drawing remains usable offline, with visible request errors rather than saved
readings presented as fresh data.

### MQTT readings and commands

Place **MQTT Config** and set its broker WebSocket URL in **Edit…** (`ws://` locally or `wss://`
for a secure deployment). Place **MQTT Subscribe**, choose that Config in its Edit inspector,
and set the topic/filter, payload format and value type. JSON payloads also use a JSON pointer,
for example `/value`. The Config is a specific component reference, not a name lookup or an
ordinary value wire. Subscribe and Publish components can share it, including across sketches in
Whole workspace mode.

Click **Connect** on the Config to connect. Editing its URL or client ID prepares a draft;
**Apply** activates those changes. An unchanged active connection offers **Reconnect**.
**Disconnect** stops reconnection until you connect again. **Connect on opening in Run / HTML**
is a separate opt-in setting, off by default.
The editor never connects merely because a workspace was opened. Leave Client ID empty for a
fresh per-instance, per-document-session ID; use explicit IDs only when their broker identity
is intentional.

Subscribe exposes a typed hybrid `value`, complete compact `json` in JSON mode, availability,
stale/error/status, the last topic and a timestamp. Initial readings after subscribe/reconnect
and all retained messages establish current values without firing events. Later live messages
emit captured hybrid events, including equal readings. A connected Memo can therefore log new
messages without treating reopening or reconnecting as a new action. Received values stay outside
undo and autosave; a consumer that deliberately stores a payload, such as Memo, can retain it.

Connections retry with bounded increasing delays and visible status. A disconnected reading
becomes unavailable and stale, rather than silently supplying zero. Hiding the browser or pausing
the simulation suspends connections; resuming reconnects the configurations that were connected.
Whole workspace mode keeps a Config active while switching sketches. Active sketch mode retires
it when its sketch is left; returning requires Connect. The first version subscribes with QoS 0
and clean sessions, without an offline message queue. Each runtime
allows 16 connections; payloads are bounded at 64 KiB, text/JSON outputs at 2,000 characters, and
a connection exceeding 60 messages/second is disconnected with a visible error.

**Credentials…** stores broker username/password in the same host-owned session store used by
HTTP. Credentials stay out of scripts, autosave and copies. Saving JSON or HTML offers explicit
per-Config inclusion; included credentials are readable from that file. Run gets a separate
connection lifetime and fresh default client IDs. Its isolated browser origin still applies;
a broker or reverse proxy must permit that WebSocket origin. Browser local-network and mixed-content
rules still apply. The MQTT client is bundled into the editor and exported HTML, with no CDN request.

**MQTT Publish** uses the same Config picker. Set an exact **Topic** (no wildcards), connect a
text or JSON **Payload**, and press **Send** or use a Send pulse/event. Changing the payload,
opening, Undo, redraw and reconnect never send it. Each accepted action captures its topic, payload,
format and Retain choice. Later topic/payload edits prepare the next send; changing the component
definition or Config relationship cancels pending work. JSON is validated and compacted before sending. A disconnected Config
rejects the action immediately; nothing waits in an offline queue or replays on reconnect.

Delivery uses **QoS 1**. **Broker acknowledged** and the `completed` event mean the broker received
the message, not that a device executed it. A subscriber to a separate response topic can confirm
what the device did. QoS 1 can produce duplicates; commands that must avoid duplicate effects need
an application-level identifier or idempotent behavior. **Retain** is off by default. The acknowledgement
timeout defaults to 10 seconds (configurable from 1–30). Timeout/disconnect can leave the outcome
unknown: the broker may already have received the message. Failed sends emit `failed`; they never
retry automatically. The last acknowledgement timestamp and status are transient, like readings.
Hiding the browser or pausing suspends MQTT: an unacknowledged send fails with an unknown outcome.
Failure events wait while the page is hidden and are delivered once it is visible. Resuming never
replays the send. Already-issued HTTP requests can instead complete while hidden.

Try the three-sketch example with the development broker:

```sh
npm ci
node tools/serve-mqtt-example.cjs
```

Open `http://127.0.0.1:8001/examples/mqtt-integrations.html`, or import
`examples/mqtt-integrations.json` into the editor at `http://127.0.0.1:8001/index.html`.
Click **Connect**. The helper sends a JSON reading and a text status once per second,
with retained initial values. Stop/restart it to try reconnect behavior, or switch to the second
sketch to see another Subscribe sharing the same Config. The third, **Commands & replies**, connects
Number control → JSON build → MQTT Publish and logs broker acknowledgements separately from device
responses. Its helper accepts only non-retained `{"value": 0–100}` commands on
`simplecanvas/demo/command`, then simulates a device reply on `simplecanvas/demo/reply`. It refuses
other client writes. This is a local testing broker, not a production service. A downloaded reader
is self-contained but live operations still need a reachable broker. Saved offline reading snapshots
remain later work.

### Demo library

The public demo working collection contains thirteen entries: eight demo-specific shapes and
five pinned built-ins (**Clock**, **Chart**, **Live clock**, **Stopwatch**, and **Ruler**). The five
reuse their existing catalog entries; the eight appear under **My shapes**. Open the shape library,
choose a shape, then click the canvas to place it. All demo entries include saved previews.
You can also import [examples/demo-shapes-library.json](examples/demo-shapes-library.json)
through **Actions → Import library…** when using the app locally.

**Sailing** groups the boats, course shapes, and race-start timer; **Workshop** groups the drilling
template and ruler. These also appear in **Drawing** or **Tools & time**. The clocks and stopwatch
share **Tools & time** and **Displays**, while the chart appears in **Displays**. The format 2 file
preserves stable entry IDs and category tags, with all thirteen entries pinned in the working collection.
Built-in category overrides keep the demo grouping, and full built-in snapshots keep the file portable.

| Shapes | What they do |
| --- | --- |
| Six sailing shapes | Two boats, start and finish lines, a course mark, and a wind arrow |
| **Clock** | Manually adjustable clock; double-click to drag its hands |
| **Chart** | Drag bars and add/remove them with the +/− controls in edit mode |
| **[Drill template](examples/drill-template.js)** | Handles adjust hole diameter and position; resizing changes hole spacing while diameter stays fixed in millimeters |
| **[Race start timer](examples/race-start-timer.js)** | A draggable clock hand and clickable mast controls for changing flags |
| **[Live clock](examples/live-clock.js)** | Local or selected timezone, synchronized hands/readout, and connected second/minute/hour/half-day pulse outputs |
| **[Stopwatch](examples/stopwatch.js)** | Live millisecond display, run/reset inputs, and an elapsed-seconds result published on pause; manual controls and running time survive tab switches and reloads |
| **[Ruler](examples/ruler.js)** | Extends its markings at fixed spacing; in edit mode, click the unit label to cycle cm with mm divisions, inches with sixteenth-inch divisions, and pixels |

Live clock, Stopwatch, and Ruler are also templates under **Actions → Add smart shape…**.
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
and working collection alongside the built-in catalog. A personal library already saved in this
browser takes precedence, so changing the hosted starter file does not replace your collection.
An unchanged starter is not cached merely by loading it; the first library edit or import creates
the personal browser copy. The starter is read only at startup; opening the picker never reloads
it. File imports work when hosted or opened locally, including importing the demo file via
**Actions → Import library…**.
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
| `workspace` | Hides tabs and the Workspace menu group. Open/save shortcuts import/export the active sketch; its HTML export stays available. Previously saved tabs are preserved and return when enabled again. |
| `shapeLibrary` | Hides the entire library and skips its starter file and browser storage. Objects in existing drawings still render and remain editable. |
| `shapeLibraryManagement` | Hides library actions and disables pins, category organization, copying/duplication, shape and library import/export, rename, replace, and delete. Bypasses saved personal-library storage and uses the fixed deployment starter. The browser and direct placement remain available. |
| `smartShapeAuthoring` | Disables creating and editing scripts, copying smart definitions into My shapes, and adding them through pins, imports, or selections. Existing smart shapes remain browsable and placeable, with working interactive handles. |
| `smartComponents` | Hides component templates, source editing, and Edit; blocks adding component definitions through pins, copies, scripts, imports, or selections. Ordinary smart-shape authoring stays available. Existing components remain browsable and placeable; their controls, connections, and HTML exports keep working. |
| `networkIntegrations` | Disables host-managed HTTP requests and MQTT connections independently of component authoring. Ordinary controls, embedded data and drawing keep working. |
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
**Import sketch…** still lets users choose a single sketch from that file.

### GitHub Pages

The **Deploy demo to Pages** workflow in `.github/workflows/pages.yml` first runs the complete
Chromium and WebKit regression suites. Deployment proceeds only after both pass, then prepares a
directory with
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
either settings file, test dependencies, regression tests, the example generator, or workflow on
`main` run the test gate before deploying automatically.

## Development and releases

Developer checks, browser setup, and regression-test commands are described in
[tests/README.md](tests/README.md). Node dependencies support tests and the development-only
example broker. The app requires no build step or runtime installation. The pinned MQTT.js browser
client and its MIT license are documented in [vendor/README.md](vendor/README.md).

### Update the demo library

Import `examples/demo-shapes-library.json`, edit its eight demo-specific entries, export the library,
and save the download back as `examples/demo-shapes-library.json`. To customize one of its five
read-only built-ins, use **Copy to My shapes** for an editable personal variant. Keep the shipped
demo's built-in snapshots identical to their canonical catalog definitions, and store demo category
memberships in `builtinCategoryTags`. The contributor shapes embed their
complete `.js` example scripts: keep the drilling template and race-start timer examples and
library sources in sync. Each scripted built-in names its canonical example source in the catalog;
authoring templates reuse that catalog script instead of storing another copy. Update the source,
catalog and saved preview together when changing a script, then regenerate the example workspaces.
The catalog updater also synchronizes matching built-in source/preview snapshots in the shipped
demo library while preserving custom entries.
Workspace generators read canonical example scripts. After editing a canonical script:

```sh
node tools/update-builtin-catalog.cjs
node tools/update-builtin-catalog.cjs --check
node tools/update-example-workspace.cjs
node tools/update-workspace-runtime-example.cjs
node tools/update-http-integrations-example.cjs
node tools/update-mqtt-integrations-example.cjs
```

The main demo uses an explicit `exampleSource` filename on smart items instead of inferring a
script from an instance UID. The workspace-runtime builder names its source files directly.
Generator-only `exampleSource` metadata is removed when a document enters the runtime.
After changing previews, `python3 tools/optimize-builtin-thumbnails.py` can reduce their PNG size;
it is optional development tooling requiring Pillow. Inspect the optimized previews before
accepting the changes.

### Releases

Push a version tag beginning with `v` followed by a digit, such as `v1.0.0`, to create
a GitHub release with automatically generated release notes after the Chromium and WebKit suites pass:

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
