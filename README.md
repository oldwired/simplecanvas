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

Sketches and tabs are saved automatically to this browser's local storage and restored on the
next visit. This storage is local to the browser; downloadable JSON files let you keep a backup
or move your work elsewhere. Sketch/workspace JSON retains placed smart-shape scripts, saved state,
and connections. A workspace contains all open sketch tabs; it excludes the library, pins, and
category organization. The library is saved separately in this browser. **Export library…** makes
a portable backup of it.

The File menu groups actions into **Workspace** and **Current sketch**. Exports live under the
scope they capture: **Workspace → Export HTML** includes every tab, while **Current sketch**
contains JSON, PNG, SVG, and HTML exports of the active drawing, plus Print.

| File action | Scope |
| --- | --- |
| **New workspace…** | Replaces all tabs with one blank **Sketch 1**, with an option to save the current workspace first |
| **Add sketch** | Adds a blank sketch to the current workspace |
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

| Category | Examples |
| --- | --- |
| Controls | Number control, Text input, Number input, Dropdown, Spreadsheet, Dataset editor, Toggle, Constant, Trigger, Download table, Go to tab, Sketch settings, Workspace settings |
| Logic | Boolean gates, Tri-state buffer, Compare, Text compare, selectors, stepped switches, registers, latches, counters, pulse tools, Publish, Receive |
| Numbers | Numeric controls, Math, Inverter (×−1), Clamp, Range mapper, Number function, numeric selectors/registers, text/number conversion, Spreadsheet, Table aggregate, Gauge, and charts |
| Text | Text input, Text label, Memo, Dropdown, Text lookup, text operations, text/number conversion, JSON extract/build/edit, URL parameter |
| Displays | Gauge, Value label, Text label, Memo, Status indicator, Seven-segment display, LED matrix (8×8), Chart, Data bar chart, Dataset editor, and clocks/timers |
| Tools & time | Clock, Live clock, Stopwatch, Timer, Ruler, Delay, Counter, Random integer, Sample & hold (integer/Boolean), Pulse generator, Edge to pulse, Signal → event, Event → pulse, Date parse, Date format, Date difference, Sketch settings, Workspace settings |
| Data | Dataset, Capture row, Table filter, Table sort, Table aggregate, Dataset editor, Spreadsheet, Data bar chart, Download table, Dropdown, Text lookup, JSON extract/build/edit, URL parameter, Publish, Receive |
| Drawing | Rectangle, Ellipse, Arrow, Arc, Ruler, Minimal, Blank |

The catalog includes 96 entries, including 87 connected API v2 components. Every smart-shape
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

Open [the smart-components workspace](examples/smart-components-workspace.json) with
**File → Open workspace…** to explore thirty-eight connected examples. Opening a workspace replaces
all current tabs; use **Save workspace…** first if you want to keep them. The JSON workspace is
editable. [The exported HTML](examples/smart-components-workspace.html) runs offline as a reader.

For a small application spanning sketches, use the separate
[workspace-runtime example](examples/workspace-runtime.json) and its
[offline HTML reader](examples/workspace-runtime.html). It starts on **Dashboard**. **Services**
is hidden from the reader's tab bar, but its clock, shared Dataset, row capture and message log
keep running. Submit a fruit name twice to capture two distinct rows, then open **Data editor**
to change the same records. The submission block carries separate fruit and quantity endpoints;
the clock block carries time and its second tick. Change Quantity before submitting to sample
both values into the new row. **Inspect hidden Services** demonstrates that hidden tabs are still
reachable through Go to tab; `?page=0` also opens Services. The Data editor overrides the window
title while inheriting other workspace presentation defaults. All sketches remain accessible in
the editor. This example is separate from the component-by-component catalog below.

| Tab | Try it |
| --- | --- |
| Basics | Change one number and watch a gauge and value label follow. |
| Threshold logic | Combine a comparison with an enable toggle. |
| Numeric tools | Scale and clamp a decimal value; try 2.8 to see the gauge show 56%. |
| Countdown | Turn **Run** on to count down from 9 on a seven-segment display. |
| Delayed pulses | Follow a pulse through a delay. |
| Routing | Step through four values with pulse and reset controls. |
| Shift memory | Move a bit through two cascaded registers. |
| LED patterns | Compare Boolean, Rows, and Columns modes; change **Top row byte** and watch the row-driven matrix feed the same pattern to a column-driven matrix. |
| Self-reset | Let completion reset its own countdown; count every completed cycle. |
| Stop at zero | Disable a pulse generator when its counter reaches zero. |
| Reset and stop | Reset the counter and retain the stop command in an SR latch. |
| Latch laboratory | Compare a dedicated SR latch with cross-connected NOR and NAND gates. |
| Shared-edge storage | Clock two flip-flops together and sample a numeric value. |
| Sequences | Circulate a bit, construct a Johnson sequence, and clock a decoded decade counter. |
| Delayed feedback | Watch a NOT/Delay loop alternate with a real time boundary. |
| Text and notes | Submit text to a label and memo, replace or clear the memo, and enter a numeric value. |
| Embedded data | Filter sailing results by boat and update a table and bar chart, entirely offline. |
| Reader data and results | Load or reload race data, switch sorting and aggregation on/off, and download a CSV or JSON report. |
| Choices and text lookup | Choose a named value, select dataset rows by number, and find the index/key for matching text. |
| Connected spreadsheet | Feed number and Boolean signals into formulas, then publish numeric, Boolean, and text results. |
| Dataset spreadsheet | Connect live rows, calculate over full columns, or copy data into editable cells. |
| Shared dataset | Capture live values into one table, edit its rows in a spreadsheet, and update connected views. |
| Source to dataset | Explicitly replace or append a filtered source into independent stored data. |
| Live dataset editor | Edit a working copy, then refresh its source to overwrite those edits. |
| Spreadsheet result tables | Publish calculated cells as a table and store an independently editable result. |
| Views and stored results | Compare edits through a filtered/sorted view with edits to a stored copy of aggregate results. |
| Text matching and extraction | Compare strings without case sensitivity, validate a full pattern, and extract a capture or Unicode range. |
| Text processing and formatting | Clean and parse an amount, format and compose its label, choose an invalid-input fallback, and replace literal or regex matches. |
| JSON messages | Build a typed JSON message, replace selected values while preserving other fields, and extract typed or nested values. |
| Date and time | Parse explicit dates/timestamps, format the same instant in different timezones, and calculate elapsed duration. |
| URL inputs and visible characters | Read a name from the reader URL, compare visible-character/code-point processing, and use a button to open another tab. |
| Sketch settings | Set the browser title, hide or show navigation and simulation controls, and inspect read-only wiring in the HTML reader. |
| Events and signals | Use one hybrid value connection or separate value/pulse connections, and carry number events through Number to text. |
| Hybrid transformations | Submit text through an extractor, change range parameters without appending, then Reprocess or sample the current result with a trigger. |
| Shared event origins | Split one submission into name and city, then compose one complete log line; combine independent edits explicitly with Apply. |
| Selection events | Choose a city and its automatically selected country, then forward only a selector’s chosen message. |
| Adapters and completion | Sample values on a signal edge, turn repeated events into separate pulses, and log Counter/Timer completion. |
| Dataset action results | Log accepted file imports/reloads and captured rows, and inspect failures without confusing them with successful updates. |

In the editor, double-click a component to use its controls. Number controls support a slider,
step buttons, and clicking the displayed value to type a number. In HTML, use the controls
directly. Select a component and open **Edit…** in the editor to inspect or change its actual
bindings, or enable **Wiring** to see and edit them on the canvas. The examples' illustrative
arrows remain ordinary drawing objects. Each tab is independent;
timing pauses while that tab is inactive. Reader changes survive tab switches, and reloading
the HTML restores the exported snapshot.

**Text input** and **Number input** provide a hybrid **Value** output: its current value and an
event carrying each accepted text or number. Their **Submitted** Boolean pulse remains available.
Click their entry field, type directly on the canvas, and press **Enter** or **Submit**. The field
stays focused for the next entry. **Tab** submits and moves focus normally. Accepting the same value
again produces another event and pulse. **Escape**
or clicking outside discards an unsubmitted draft; invalid entries stay open with an error.
Editing leaves the simulation running unless you have paused it. Text input has maximum-length,
required-value, and placeholder settings. Number input has minimum, maximum, and step settings;
its output is a number, while Text input preserves a string such as `0012`. Input masks and
additional text-validation rules are deferred. These are separate from the slider-based Number control.

Connect **Text input · value** to **Text label · value** to display the current string. Connect
that same **value** output to **Memo · line** to append each accepted submission, including
repeated identical text. The typed port carries both its current value and discrete events.
For numbers, use **Number input → Number to text → Memo**; transformations preserve occurrences
while converting their captured payloads.

For traditional triggered sampling, turn **Receive events** off on Memo's Line input in **Edit…**.
Connect the desired text to Line and a Boolean trigger to Append. Text input's existing Submitted
pulse can drive Append. Its bounded queue retains up to 64 submissions and their values while
paused; Step or Resume processes them. Connecting both event receipt and a separate Append
trigger intentionally makes two requests. [Tab 33 · Events and signals](examples/smart-components-workspace.html?page=32)
compares these styles in separate Memos.

Scalar transformations pass a driving event through their calculation. Parameter changes only
update the current output. Their **Reprocess** input samples the current data and parameters to
emit a fresh result, from either a command event or a Boolean rising edge. A hybrid Trigger
connection uses its event once, without also counting its subsequent pulse. Try
[tab 34 · Hybrid transformations](examples/smart-components-workspace.html?page=33): submit
`Hello World` then `Another Test` with Start 2 / Length 3 to append `llo` and `oth`. Change Start to 3
and Length to 5: the current output becomes `"ther "`, but Memo stays unchanged until Reprocess
or a new text submission.

Text compose accepts events on every text input (A through H). **One submission remains one
event when it travels through several branches.** If two extractors take a name and city from
one submitted string, Compose waits for both related results and emits one complete line.
The order or placement of those components does not change the result. Inputs that did not
receive an event provide their current values; they do not have to emit. A values-only branch
changed by the same submission is also updated before Compose samples it.

Independent submissions remain separate, even when their text is identical or they arrive
close together. To edit several fields before producing one result, turn **Receive events**
off on those Compose inputs and connect an **Apply** button to **Reprocess**. Try both patterns
in [tab 35 · Shared event origins](examples/smart-components-workspace.html?page=34):
submit `Anna;Berlin` to append `Anna / Berlin` once, then submit it again to append another line.
In the lower example, editing Name or City changes the preview; Apply appends their current values.

Connecting Live clock to either Compose input updates the current result without appending a
line; submitting connected Text input emits a composed line using the current time. A hybrid
source can also supply values only by disabling Receive events on its receiving input.
Separator and Template remain value-only parameters.

User events run while simulation is paused; Boolean pulses follow simulation time. Events are
not saved for replay: Undo/Redo restores outcomes, and reopening does not submit them again.

**Wiring** distinguishes enabled event reception (purple lightning) from **Values only** (muted,
crossed lightning). Accepted occurrences briefly glow amber. Select an event wire, or hover/focus
a port, to inspect its occurrence count and last payload. Exported HTML offers the same read-only
inspection when wiring is shown. Activity is session-only and is never saved or replayed.

**Dropdown** sends its Index, Key, Text, and Valid results together when a choice is accepted or
an event arrives at Select. List/dataset refreshes and value-only Select changes only update the
current result; Reprocess explicitly sends it again. **Text, Number, and Boolean selectors** pass
an event from the selected A/B input and ignore occurrences on the other data input. Select events
and Reprocess send the current chosen value; a plain Select signal only changes the preview.
Try [tab 36 · Selection events](examples/smart-components-workspace.html?page=35).

Two adapters connect these workflows to traditional Boolean logic:

- **Signal → event:** choose text, number, or Boolean. Trigger’s rising edge captures the current
  Value as an event, including repeated equal values.
- **Event → pulse:** every received event queues one 100 ms Boolean pulse, separated by at least
  10 ms low. Paused simulation retains queued events until Step or Resume; reopening does not
  replay them. The queue holds at most 64 pending pulses.

**Counter** emits a completion event once when a counted edge first reaches its threshold or
zero; reset re-arms it. **Timer** emits once at an observed natural finish. Both keep their Reached
signals, and neither invents completion events on reset, configuration changes, or restoration.
Try [tab 37 · Adapters and completion](examples/smart-components-workspace.html?page=36): submit the
same text three times, watch three separate pulses reach the Counter, and log one completion.

**Dataset** reports a successful file import/reload through **Loaded** (resulting row count) or a
failure through **Failed** (message). **Capture row** reports the inserted row’s zero-based index
through **Captured**, or its failure message through **Failed**. These are dedicated events;
current dataset signals keep working as before. Cancelled dialogs, stale work, redraws, and
reopening do not emit. Try [tab 38 · Dataset action results](examples/smart-components-workspace.html?page=37)
with [the example CSV](examples/event-readings.csv).

Text input also has a Boolean **Clear** input. A false-to-true pulse empties the field and cancels
pending submissions without emitting Submitted. Connect a Trigger button to Clear for a separate
reset, or connect the Text input's own **submitted** output to its **clear** input to empty the field
after submission. Memo still captures the accepted text before the field clears. A Clear input
already high when the drawing starts establishes a baseline without erasing the saved value.

**Memo** accepts captured strings on its hybrid **Content** and **Line** inputs, plus command
events on **Clear**, alongside its existing signal inputs. Use Number to text to append a numeric
event. Both paths use the same bounded operations. For signals, a rising edge on **Set**,
**Append**, or **Clear** acts once. Set replaces it with
**Content**; Append adds **Line** as a new line; Clear empties it. If several triggers rise together,
Clear wins over Set, then Append. Outputs are the complete **Text** and **Line count**. An empty memo
has zero lines; appending an empty line creates one blank line. Limits default to 100 lines and
2,000 UTF-16 units; a rejected update leaves the previous contents intact and shows a notice. A long
memo displays its latest lines while its output retains the full text. Text label and Memo display
incoming text literally. Text label starts as plain text without a frame; Memo uses a compact
content area. Enable Text label's normal stroke controls to add an outline using the selected
color, thickness, and line style. In **Edit…**, enable **Show submission state** or **Show hints** for the input
controls, **Show counts** or **Show hints** for Memo, and **Show name** or **Show hints** for Text
label. These optional details start hidden; errors and rejected-update notices remain visible.

**Text compare** accepts two strings, **Text** and **Compare**, and publishes a Boolean **Value**.
Choose Equals, Not equals, Starts with, Ends with, Contains, or Matches regex; turn off **Case-sensitive
matching** to ignore case. Matches regex validates the entire input, including any final newline.

**Text extract** publishes **Text** and Boolean **Found**. **Range** takes a zero-based **Start**
and **Length**. **Range units** defaults to **Visible characters**, keeping combined emoji such as
👩‍👩‍👧‍👦, flags, and letters with combining accents together. Choose **Code points** for individual
Unicode code points instead. Both modes are zero-based. The end is clipped
to the available text; a start beyond the end gives empty text and Found off. A valid zero-length
range gives empty text and Found on. **Regex match** extracts the first match anywhere in the
text; **Regex capture** extracts a selected group, with **Capture 0** meaning the first parenthesized
group. For example, `Order-(\d+)` extracts `1042` from `Order-1042 🚀`.

Enter regex patterns directly, without surrounding `/…/`. Regex uses JavaScript's built-in engine
with Unicode matching and optional case insensitivity; there is no external dependency or network
request. No match gives Found off and empty text; an invalid pattern or capture selection shows a
component error. Evaluation uses the same bounded Worker calls as other components, including in
HTML exports. **Show indicators** controls the optional output readouts. Tab 27, **Text matching
and extraction**, connects both components to editable inputs and status/text displays.

**Text to number** converts **Text** into numeric **Value** and Boolean **Valid**. It accepts a
complete decimal number, optionally with an exponent, using the selected decimal point or comma.
Whitespace is trimmed by default. Empty text, grouping separators, hexadecimal, trailing junk,
and non-finite results produce Value `0` and Valid off; connect Valid to a Text selector when you
want a friendly fallback message. `12abc` never silently becomes `12`.

**Number to text** converts numeric **Value** into string **Text**. **Full precision**, the default,
uses the number's complete JavaScript representation: decimal point, exponential notation where
needed, and `0` for negative zero. **Fixed decimals** enables **Decimal places** (0–20),
**Minimum integer digits** (1–20, padding with leading zeros), and **Decimal separator** (point or
comma). These three settings apply only in fixed mode. Rounding changes the resulting text,
leaving the original numeric signal intact; a result rounded to zero has no minus sign.

**Text compose** joins two to eight strings with a **Separator**, or fills a **Template** with
`{a}`, `{b}`, and the other enabled input names. For example, `Total: {a} €` can use a formatted
number. Write `{{` or `}}` for literal braces; unknown placeholders or malformed braces show an error.
This combines scalar strings; splitting/joining lists or tables remains later work.

**Text transform** trims whitespace or converts text to lowercase or uppercase. It publishes
the transformed **Text**, its **Length**, and Boolean **Empty**. **Character counting** defaults
to **Visible characters**; choose **Code points** when that is the unit your connections need.
**Text replace** replaces the first or all occurrences of literal text or a raw regex pattern,
with optional case insensitivity. Its outputs are **Text** and replacement **Count**. Literal
replacement treats dollar signs literally; regex replacement uses JavaScript's `$1` for the first
capture (`$0` stays literal). This is regex syntax; Text extract's numeric capture selector remains
zero-based. An empty literal search leaves the text unchanged.
**Text selector** chooses **A** when Boolean **Select** is off, and **B** when it is on.

These components follow the usual **Show indicators** setting and work in offline HTML exports.
Tab 28, **Text processing and formatting**, connects all five additions and fixed number formatting
to editable inputs, a validity-driven fallback, and ordinary Text labels.

Text previews, Text label, and Memo also keep visible characters together when wrapping or clipping;
Memo's optional character count uses the same segmentation. This uses native `Intl.Segmenter`.
In a browser without it, range extraction/counting in visible-character mode reports an error with
the option to select Code points. Regex retains JavaScript's Unicode matching rules. Text input,
Memo, and string-port capacity limits still count UTF-16 units, independently of visible length.

**JSON extract** reads one value from **Text** using a **Pointer**. For example, `/items/0/name`
selects the first item's name; an empty pointer selects the root. In a key, use `~1` for `/` and
`~0` for `~`. Choose a **Result type** of String, Number, Boolean, or JSON; JSON returns serialized
text, including for objects and arrays. **Found** distinguishes an existing field from a missing
one, while **Valid** also requires the selected type. A wrong type gives Found on and Valid off;
invalid JSON or a pointer that does not resolve gives both off. Invalid results use empty text,
`0`, or `false` according to the output type; no automatic coercion is performed.

**JSON build** assembles an object from one to eight named, typed inputs. In **Edit…**, enter one
field per line, such as `name:string`, `amount:number`, or `active:boolean`. Use `details:json`
to include parsed JSON as a nested value. Input labels show the configured field names. Their
connection IDs remain **field0**, **field1**, and so on in line order, so renaming a field without
moving it or changing its type preserves its connections. Reordering or removing lines changes
which fields those slots represent; review the wiring after those edits or a type change.
Renaming changes the emitted JSON key, so update downstream JSON paths or parameter readers
that refer to its old name.
Outputs are serialized **Text** and Boolean **Valid**. Invalid nested JSON returns
empty text and Valid off; oversized output reports an error instead of truncating the message.
Fields update the current result without submitting it. **Emit / Reprocess** captures all current
fields and emits one Text/Valid occurrence; repeated identical requests remain distinct.

**JSON edit** changes selected values in an incoming JSON string while preserving the other
parsed fields. Configure one to eight `pointer:type` lines, such as `/name:string`,
`/score:number`, or `/items/0/active:boolean`, and connect the replacement values to their
path-labelled inputs. Types are String, Number, Boolean, or `json` for a parsed nested value.
The **Text** input is the original message; outputs are the changed **Text** and **Valid**.
Every path must already exist: a missing path, malformed input JSON, or invalid nested JSON
returns empty text and Valid off, without a partial result. Paths must be distinct and cannot
overlap (for example `/customer` and `/customer/name`). Use `:json` by itself to replace the root.
Input IDs remain `field0`, `field1`, and so on, so a same-slot, same-type path change keeps its
wire; review wiring after reordering, removal, or type changes. Changes are serialized with
`JSON.stringify`, so original whitespace/number spelling is not retained. Oversized output is
an error instead of a truncated message. Demo tab 29 changes amount 10 to the current replacement
amount while leaving the original name and active flag intact.

**Date parse** converts an ISO date such as `2026-10-19` to midnight UTC, or a timestamp such as
`2026-10-19T14:30:00+02:00` to Unix milliseconds. A timestamp must include `Z` or an explicit UTC
offset. Invalid dates produce **Timestamp** `0` and **Valid** off; ambiguous local date formats
are not guessed. **Date format** takes that timestamp plus a **Timezone** such as `Europe/Berlin`
(default `UTC`). Choose Date, Time, Date and time, or ISO (UTC). Date/time output uses Gregorian
`YYYY-MM-DD` and 24-hour `HH:mm:ss`; ISO always represents UTC. **Date difference** subtracts
**Start** from **End** and outputs signed **Value** in milliseconds, seconds, minutes, hours, or
days. A day is exactly 24 hours, not a count of calendar dates crossed. All three have **Valid** outputs.

**URL parameter** lets an exported HTML take inputs from its own URL. Set **Key** to `name` and
connect **Value** to a Text label; opening `drawing.html?name=Anna` then displays Anna. **Index**
selects a zero-based occurrence when a key repeats, and **Count** reports the number of matches.
Missing occurrences use **Fallback** with **Found** off; a present empty value stays empty with
Found on. Values are decoded using normal URL query rules (`+` means a space). Use separate
instances for different keys, or connect the value to Text to number, JSON extract, or Date parse.
The editor and HTML reader initially read their own URL query. A Go to tab action can then update
that query and immediately refresh connected URL parameters. The query source does not save values into its own state or bake them into the HTML's initial
SVG or library thumbnails. Connected storage components can deliberately retain received values.

A reader URL can also select its opening tab: `drawing.html?page=1&name=Anna` opens the second
tab. Tab indexes are zero-based; a missing, invalid, or out-of-range `page` opens the first tab.
Clicking tabs in the tab bar does not rewrite the URL. To try the URL demo, open
[URL inputs and navigation](examples/smart-components-workspace.html?page=30&name=Anna&target=28).
**Go to tab** changes tabs and can pass parameters to the destination. Set **Page** to a zero-based
tab index, then click its **Go** button or connect a false-to-true pulse to **Go**. Connect **JSON
build · text** to **Parameters**, or enter an object such as `{"name":"Anna","count":3}` directly.
Parameters defaults to `{}`. String, number, and Boolean values replace matching query keys;
`null` removes a key. Other query parameters and the URL fragment are preserved. Nested objects
and arrays are rejected, and `page` is reserved: the host sets it from **Page**.

The editor uses current tab order; an HTML reader uses exported tab order. The host validates the
target, JSON, and size limits before changing anything. It then replaces the current URL without
reloading or adding a browser history entry, and updates URL parameter components on the target
tab. A same-tab request can update parameters too; it is a no-op only if the query is also unchanged.
Other tabs see the updated parameters when revisited. If the browser refuses the URL update, the
action reports an error and leaves the current tab and parameters intact. Browser Back/Forward is
not a component-navigation interface.

A signal already high on opening or revisiting a tab establishes a baseline rather than immediately
navigating away. Turn off **Show button** for a signal-only component: the HTML reader hides its
button, while the editor retains an outline/caption for selection and configuration. The action
stays within the current document; it cannot open an arbitrary URL. Demo tab 31 reads an
optional `target` parameter and includes a jump to the JSON example.

Parameters JSON is limited to 2,000 UTF-16 units. The resulting query is bounded to 16,000 units
and 128 parameter pairs; each selected value still fits the usual 2,000-unit string limit. These JSON, date/time, and URL tools work offline in the
editor and exported HTML and add no dependencies or network requests. Advanced mathematical
functions and further locale-aware formatting/comparison remain planned extensions.

**Workspace settings** supplies the default browser/window title, tab-bar visibility, read-only
wiring visibility and simulation-control visibility. Place one per workspace. Its Edit inspector
also configures **Active sketch only / Whole workspace**, the initial sketch and individual tab
visibility. Execution mode and the initial sketch are configuration choices, with no live inputs.
Hidden tabs remain reachable through URL parameters and Go to tab; the editor keeps them accessible.

**Publish** and **Receive** connect sketches in Whole workspace mode. Each block contains up to
16 named, typed endpoints with separate wiring pins. Publish exposes local inputs; Receive imports
chosen published endpoints and offers local outputs. A Receive block can use endpoints from
different publishers and import only the ones it needs. The Receive picker offers endpoints from
other sketches only; use direct wiring within a sketch. Edit the names, descriptions and order
without breaking connections: each row keeps a stable ID. Removing a published row leaves its
receivers visibly unresolved until you choose another source. Text, number and Boolean endpoints
carry values and events; tables carry values, and event-only rows carry scalar/null occurrences.
Dataset sharing remains a separate association to an owner's editable records.

**Sketch settings** overrides those presentation defaults for one sketch. Each property starts
with **Inherit**; enable its override to use the local literal or connection. An explicitly
overridden empty title is empty, while an empty workspace title uses the original export title.
The host settles dependencies and applies workspace defaults followed by sketch overrides before
revealing the destination, then follows connected changes. Unavailable settings fall back to the
inherited defaults. Both settings blocks remain visible while authoring and disappear in HTML.
Reader wiring shows typed, directed flows and distinct Dataset links without allowing connection
edits. Hiding simulation controls only hides the panel; it does not pause execution.

Try [tab 32 · Sketch settings](examples/smart-components-workspace.html?page=31): submit a new title,
change the visibility toggles, and use **Open Basics** even while the tab bar is hidden. Basics has no
Sketch settings component and inherits the workspace defaults. When hiding the tab bar in your own
application, provide Go to tab buttons for navigation. Page background, initial fit/zoom, and initial
keyboard focus are planned extensions.

**Embedded data** adds Dataset, Table filter, Dataset editor, and Data bar chart to the built-in
library. Place Dataset, select it, and open **Edit…**. Its **Owned dataset** section selects or creates
the table this component owns; it is not a signal connection. Choose **Import CSV/TSV/JSON…** to
load a file. Inspect the first rows and column types, then **Save**.
**New dataset…** creates an empty table: name it, add columns with string, number, or Boolean types,
then choose **Use new dataset** and **Save**. All columns accept null values.
For CSV/TSV, **Delimiter** defaults to **Automatic**; choose **Comma**, **Semicolon**, or **Tab** to override it.
The preview refreshes when you change the delimiter, and ambiguous detection shows a notice.
Cancel leaves the drawing and its datasets unchanged. Connect Dataset's **data** output to Table
filter, then connect the filter's **data** output to Dataset editor and Data bar chart.

CSV and TSV use the first row as unique column headers and support quoted delimiters, escaped quotes,
and multiline cells. Automatic detection compares comma, semicolon, and tab parsing while respecting quoted
cells. Each column becomes text, number, or Boolean; empty cells become null. Decimal-comma values
remain text; choosing semicolon does not change number parsing. Numeric-looking identifiers with
leading zeroes and integers outside JavaScript's exact range remain text.
JSON imports an array of flat objects with scalar or null values; missing properties become null,
and a column cannot mix non-null types. Nested objects and arrays are rejected. Try the matching
[sailing-results CSV](examples/sailing-results.csv) or [JSON](examples/sailing-results.json).

In Table filter's **Edit…**, choose a column key and operation, then set or connect the matching
**text**, **number**, or **boolean** comparison input. A blank column passes every row. Connect a
Text input's **value** to **text** for live search; the example starts with `Aurora`, and a blank
search shows all boats. Numeric columns support comparisons; text supports contains/equality;
all types support empty/nonempty checks. Data bar chart uses a category column and a numeric value
column, with one bar per row. Column dropdowns show the connected table's columns; the stored values use their exact keys.

A sketch accepts up to 16 datasets, with 1,000 rows, 32 columns, and 2,000 characters per text cell.
Each dataset is limited to 500,000 serialized characters; the combined active datasets are limited
to 2,000,000. Oversized or malformed imports leave existing data intact. Table views and charts show
a bounded preview and report when more data exists; filtering still evaluates the whole dataset.
Data travels with sketch/workspace JSON, copied components, saved library entries, and HTML exports.
The HTML reader needs no network or source file. Enable **Allow file import and reload** on a Dataset
component to give readers a **Load data…** control. The same delimiter and preview controls check
replacement data before it is accepted. Existing column keys and types must match; additional
columns are allowed. Replacement keeps the dataset's identity, so every component using that dataset
in the sketch sees the accepted rows. The loaded data belongs to that reader session, survives tab switches,
and is discarded when the HTML page reloads. **Allow file import and reload** controls the file-import action;
bound-cell edits and row capture have their own reader permissions.

Dataset also has a Boolean **reload** input. Connect a Trigger: each false → true pulse rereads the
last file accepted through **Load data…**, using its accepted delimiter. This works when the browser
provides a reusable file handle, such as Chromium's file picker. Safari and ordinary file-input
imports require choosing the updated file again through **Load data…**; the app explains this and
keeps the accepted data. SimpleCanvas keeps file handles only in the current session and never stores or exports file
access. An initially high signal, opening a drawing, Undo, or reconnecting a wire does not reload
a file. **Allow file import and reload** controls both loading and triggered reloading.

**Table aggregate** groups rows by a selected column and calculates Count, Sum, Average, Minimum,
or Maximum. Leave Group blank for one summary over the entire table. Count includes every row;
numeric operations ignore missing values. The result contains a `group` column when grouping is
selected, plus a numeric `result` column. **Table sort** orders rows by a selected column in ascending
or descending order, keeping equal values stable and missing values last. Both use every accepted
row, so the output can feed another filter, table, chart, or download.

**Dataset stores records; Filter, Sort, and Aggregate transform table values.** The same transform
components work before storage and between stored data and its displays:

| Flow | Purpose |
| --- | --- |
| Source → Filter / Sort / Aggregate → Dataset | Prepare incoming data before storing it. |
| Dataset → Filter / Sort / Aggregate → Dataset editor or chart | Present selected, ordered, or calculated views of the current records. |
| Dataset A → Filter / Sort / Aggregate → Dataset B | Store an independent result, updated by explicit Replace/Append or by Live mode. |

Filter and Sort preserve record identity. When their input belongs to an editable Dataset, editing
or deleting through the resulting view changes the original record and every view of it. Adding a
record requires the whole stored table. Aggregate calculates new rows, so its results are read-only;
store them in another Dataset to edit an independent copy. Such edits never write back upstream.
In Manual mode the copy stays unchanged until Replace/Append; in Live mode the next source publication
overwrites its local edits.

The table flow carries **successive table snapshots**, not individual arriving-row events. Aggregate
recalculates over the current selected rows; it does not accumulate events, history, or time windows.
Use Capture row to explicitly record scalar samples before aggregating them.

Table sort and Table aggregate have an **enabled** Boolean input and a visible on/off switch. Without a connection,
clicking the switch changes that input directly; the editor records one undo step. With a connected
signal, the switch reflects it and is read-only. Turn off **Show on/off switch** in **Edit…** to
hide it while keeping the input active. Off bypasses the transform and passes the original rows
and columns through unchanged. In particular, disabling Aggregate restores the original schema;
downstream column choices must work with that schema too.

Connect a **Download table** component to the final table. Its **CSV** and **JSON** buttons open a
preview of the selected result rows in their current order. Confirm **Download** to save the file; opening,
redrawing, or restoring a document does not trigger one. These files are data results rather than
editable workspace or HTML snapshots. Try **Reader data and results**, the eighteenth example tab,
with the replacement [CSV](examples/sailing-results-updated.csv) or
[TSV](examples/sailing-results-updated.tsv). It sorts race rows by boat name, totals points per boat,
and exports `sailing-report.csv` or `.json`. Its table and automatic chart columns also work when
either transform is bypassed. **Reload file** demonstrates the Dataset trigger.
Additional chart types and unrestricted table feedback remain later work. A Dataset can explicitly
apply a transformed view of its own records with a Replace or Append pulse.

**Component indices start at zero.** Lists, selected channels, storage taps, and matrix rows/columns
use `0…N−1`. A missing choice or lookup returns `-1` plus `valid=false` or `found=false`.
Counts remain quantities: four channels have indices 0–3. Keys stay attached to choices when
their order changes. Tab numbers and ordinary numbered instructions remain human-readable ordinals.

**Dropdown** maps a choice to its **index**, **key**, and **text** outputs, with **valid** indicating
whether the selection exists. In **Edit…**, choose **List** to edit rows of text and optional keys,
or **Dataset** to connect a table and choose its text and optional key columns. Indices start at 0
and follow the list or selected dataset row order. A connected **select** input controls the choice;
the dropdown then becomes read-only. Without a connection, choose directly on the control.
Turn off **Show dropdown** for a plain automatic text display. A missing or out-of-range
selection produces index `-1`, empty key/text, and `valid=false`.

**Text lookup** searches the same list or dataset in the other direction: its **text** input produces
**index**, **key**, and **found**. Exact, case-sensitive matching is the default; optional settings
ignore case or trim surrounding whitespace. The first matching row wins, including repeated labels.
No match produces index `-1`, an empty key, and `found=false`. Keys are optional; nonempty keys must
be unique and stay stable when rows are reordered. Local lists allow up to 64 rows within 2,000
serialized characters; dataset mode uses all selected rows within the existing dataset limits.
Switching sources preserves the editable list. The nineteenth tab, **Choices and text lookup**,
shows a manual list plus a shared dataset driving automatic selection and reverse lookup.

**Spreadsheet** is a small formula sheet in the library's **Data**, **Controls**, and **Numbers** categories. New sheets start
with an empty 6×6 grid. Double-click it in the editor, then click a cell to edit a value or formula.
Enter saves and finishes; Tab/Shift+Tab saves and moves right/left; clicking away saves; Escape discards the draft. While entering a formula,
click or drag over cells to insert references. Right-click a cell or header for insertion/deletion,
functions, formatting, alignment, and column widths. A cell can retain an invalid formula and display
its error for correction.

`=INPUT("amount")` declares a numeric input; `=INPUT("enabled",3)` declares a Boolean input.
Use `=INPUT("message",2)` for text. Type codes are `0` auto/default, `1` number, `2` string,
and `3` Boolean; the names `"number"`, `"string"`, and `"boolean"` also work.
`=OUTPUT(B2*B3,"total")` publishes a formula argument as a typed output. Connect these ports through
**Edit…**, just like other components. Functions include IF, IFERROR, SUM, AVERAGE, VLOOKUP,
Boolean operations, rounding, and text operations; commas or semicolons separate arguments.
Spreadsheet A1 row references, VLOOKUP column numbers, and MID character positions conventionally
start at 1. Component selection indices and indexed ports remain zero-based. Output types are
fixed by the saved formulas: all possible branches or lookup results must have one scalar type.
Use IFERROR to recover from calculation errors, including deleted cell references.

The twentieth tab, **Connected spreadsheet**, connects a Number control and Toggle to a sheet and
shows its three result types. Try changing B3 from 2 to 3 in the editor. In exported HTML, cells are
read-only, but controls still drive the formulas and connected output displays entirely offline.

To display a dataset, put `=INPUT("data",A1:C6,INPUT("startRow"),0)` in a cell **outside A1:C6**.
Use the cell context menu's **Insert function → Datasets** to insert a declaration, then edit its
arguments in the cell.
It declares a table input named **data** and a numeric **startRow** input. Connect them in **Edit…**
or Wiring mode. The range's first row displays column headers; subsequent rows show records from
zero-based `startRow`. Omit the last two arguments to start at record 0 with read-only access.
A start position can also be a fixed number or a cell reference. Multiple nonoverlapping INPUT
rectangles can display independently connected tables anywhere on the sheet; ordinary cells beside
them remain editable. **Edit…** shows the component type and editable instance name, binds the named
inputs already declared by formulas, and previews their outputs. Ranges and access are edited in
the formulas themselves.

The fourth argument controls each rectangle: `0` read-only, `1` edit shared records in the editor,
`2` also allow those edits in exported HTML. Headers, absent rows, derived results, and tables
without a live, unique Dataset owner stay read-only. Invalid declarations remain editable and report
errors; linked areas cannot overlap authored content or another linked area. Insert/delete operations
around a linked area move its references; operations that would change its mapped rows or columns
are rejected. Formula declarations remain blank in calculated values and show INPUT/OUTPUT markers
only while editing.

`=SUM(COLUMN("data","Points"))` calculates across the complete selected column, even beyond the visible
rows. `=DATA("data",0,"Boat","string")` reads the first selected boat; `=ROWS("data")` counts all selected
rows. Other port names declare additional dataset inputs. To publish a dataset cell directly, specify
its type, for example `=OUTPUT(A2,"boat","string")`.

For independent editing, choose **Copy dataset to editable cells** beside the table input, then
**Save**. This replaces the grid with an editable copy and disconnects its former inputs; the original
dataset stays unchanged. You can change values and add formulas. Imported strings stay literal,
including strings starting with `=`. Copies must fit the small sheet's grid and 4,000-character state
limits; larger data can remain connected and be used in formulas. The twenty-first tab,
**Dataset spreadsheet**, demonstrates the live grid, paging, calculations, and copy workflow.

To edit the shared data itself, connect the Dataset owner's output to **Dataset editor** and enable
**Edit dataset records** in **Edit…**, or use access `1`/`2` in a Spreadsheet's INPUT range.
A table without a live, unique owner remains read-only.
Edits change the original typed cells, so other sheets, tables, charts, and choices using that dataset
update together. Sorting and filtering preserve row identity: an edit targets the displayed source
record even when its position has changed. Aggregate results remain read-only. Dataset text is literal,
including a leading `=`; spreadsheet formulas stay in the sheet's ordinary cells. **Allow reader edits**
separately enables Dataset editor changes in HTML; a Spreadsheet enables them per range with access `2`.
Editing is disabled by default.

**Capture row** records connected live values into a whole dataset. In **Fields (column:type)**,
enter one mapping per line, such as `label:string`, `value:number`, and `active:boolean`.
The first line declares `field0`, the next `field1`, and so on, up to 24 fields. Connect those scalar
inputs, connect the destination Dataset owner through **data**, and connect a Trigger or submission pulse to
**capture**. Each false → true pulse appends one sampled row; unmapped columns receive null.
Keep capture connected to the complete source dataset, rather than a filtered or aggregate result.
Opening, Undo, and reconnecting do not replay a capture. Enable **Allow capture in HTML export**
explicitly when readers should record rows; it defaults off.

Datasets live once in the document, outside the small spreadsheet state. Accepted changes use the same
validation and revision rules in the editor and HTML. The editor autosaves them and supports Undo/Redo.
HTML edits and captures stay in that reader session; use **Download table** to retain the results as
CSV or JSON before reloading. The twenty-second tab, **Shared dataset**, demonstrates the complete flow.
**Dataset owns stored records; sources supply possible replacements.** Connect any table output to
its optional **source** input. A **replace** pulse copies the selected source rows into the owned table;
an **append** pulse adds them. Editing the source or changing a filter does not change the stored rows
until you apply one of those actions in the default **Manual** update mode. Editing stored rows never writes upstream. Each stored table has
one Dataset owner, while any number of sheets, charts, and other components can consume its output.
Duplicating or pasting an owner creates an independent dataset; copying only a view within the same
document keeps it linked to the existing owner. Library entries and copies across documents carry their data.

Enable **Allow source updates in HTML export** on the Dataset when readers should use these pulses;
it defaults off and is separate from file loading, cell editing, and capture permissions. Updates keep
the destination dataset ID, validate its schema and limits, and assign new row IDs to copied rows.
The twenty-third tab, **Source to dataset**, demonstrates source editing, filtering, Replace/Append,
and independent destination editing. File import and reload remain conveniences on the owner.

**Dataset editor** follows its connected table's schema and records. Its row and column controls page
through large tables. With editing enabled, click a cell to edit its typed value; **+ Record** appends
a blank record and each row's delete control removes that record. Adding requires the whole stored
dataset; filtered or sorted views can still edit/delete the displayed source records. Derived tables
are read-only until materialized into a Dataset. Spreadsheet keeps its authored layout and formulas,
so record growth does not rearrange its cells.

On Dataset, select **Source update mode: Live** to replace working records whenever the connected Source
publishes refreshed data. Local edits remain until that refresh, then are overwritten. A successful
reload of identical source data also counts. Source failures preserve accepted records, and reopening
or Undo does not replay a refresh. Enable **Allow source updates in HTML export** for this behavior
in the reader. Tab 24, **Live dataset editor**, makes the source/working-copy distinction visible.

Write a table formula, directly or through **Insert function → Datasets**:
`=OUTPUT(A1:C4,"Energy costs")` creates an
output port **Energy_costs**. The range's first row names the columns and the rows below are the
records, so the range needs a header row and at least one data row. Headers may be formulas.
Column types follow the calculated values, or use explicit types such as
`=OUTPUT(A1:C4,"Energy costs",2,1,1)` (`"string","number","number"` also works).
Use explicit types for empty or ambiguous columns. The range follows permitted row/column edits,
and a sheet may publish several independent tables. Only calculated values leave the sheet; formulas
and formatting stay with it. Blank cells
become null, and formula/type errors reject the table result. Connect the output directly to a chart
or download, or to another Dataset's **source** to store an editable result. Tab 25, **Spreadsheet result
tables**, demonstrates this in the editor and offline HTML; it also exposes a separate **Source_readings**
output for the visible source rows. A formula referring to a linked cell is
positional: paging or sorting can change which record that cell displays.

Tab 26, **Views and stored results**, compares these behaviors using the same source records:

1. Edit a value through the filtered/sorted view. The original record and aggregate result update.
2. Click **Copy current total** to copy the aggregate result into the separate Dataset, then edit that stored copy.
   The source records and calculated aggregate stay unchanged.
3. Edit a source value again. The views and aggregate update, but the stored Manual copy keeps its
   edits until you click **Copy current total** again. Tab 24 demonstrates the Live alternative, where refresh overwrites edits.

Dedicated remote providers, coordinated current-record controls, and calculated dataset columns remain future work.

To build a small data workflow from a blank canvas:

1. Place **Dataset**, **Text input**, **Table filter**, **Dataset editor**, and **Data bar chart** from the library.
2. Open the Dataset's **Edit…**, name it **Results**, and import the
   [sailing-results CSV](examples/sailing-results.csv). Inspect its preview and **Save**.
3. Enable **Wiring**. Connect Results **data** → Table filter **data**, then the filter's **data**
   output → both the Dataset editor's and chart's **data** inputs. Connect Text input **value** → filter **text**.
4. In the filter's **Edit…**, select column **Boat** and operation **contains**. In the chart,
   choose category **Boat** and value **Points**. Save each configuration.
5. Turn Wiring off. Double-click the Text input, enter a boat name, and press Enter.
   The table and chart show matching records; submitting empty text restores all records.
6. Optionally enable **Edit dataset records** in the Dataset editor. Double-click that view and
   edit a Points cell: the chart and original stored record update together. Enable **Allow reader edits**
   separately if readers should have the same editing permission.
7. Save the editable workspace and export HTML. Open the HTML file to use the filter and permitted
   controls offline. Add **Download table** connected to the filter to retain current result rows;
   reloading the HTML itself restores the exported snapshot.

For a smaller starting point, open [the control-and-gauge sketch](examples/connected-components.json)
with **File → Import sketch…**. **Export HTML** keeps its connection working offline.

To build your own pair, place **Number control** and **Gauge** from the built-in library.
Enable **Wiring**, then drag Number control's **value** output to Gauge's **value** input;
starting at the input and dropping on the output works too. Their script templates also remain
available for authoring. Alternatively, select the gauge, click **Edit…**,
choose **Number control · value** for its
`value` input, and save. The same dialog can name an instance or set a literal input value.
It lists compatible outputs from components in the active sketch.
When several sources share a name, the picker adds qualifiers such as **#1 (left)** and
**#2 (right)**. These drawing-order and position hints help identify the source; they do not
rename instances or change their connections. You can still give instances distinct names.

**Wiring** starts off and is available when component authoring is enabled. Ports show their
names and types. Directed flow links carry **Boolean**, **Number**, **Text**, or **Table** markers;
Dataset associations use a dashed line and a **Dataset** marker. This difference also works
without color. A Dataset publishing its owned records to a view shows an association, as does
a view selecting that owned dataset directly. Filter, Sort, and Aggregate connections remain
directed table flows, and a Dataset's **source** input is a flow of incoming snapshots to copy.
Dataset associations identify shared records; they do not claim read or write permission.

Data inputs sit on the left and data outputs on the right; control inputs sit on top and control
outputs below. A script declares which ports are controls and can override a port's side when
the component benefits from a different arrangement. Boolean signals are not automatically
controls: a logic gate's operands and result remain data on the left and right. Placement does
not restrict connections; a matching data output can drive a control input. In the editor, ports and links
are visible only while **Wiring** is on.

Drag between an input and a compatible output to connect them. Types must match exactly;
one output can feed several inputs, and each input has one source. Dropping a new compatible
output on an already connected input replaces its binding in one undo step. Select a link and
use **Disconnect** or **Delete** to remove it; **Escape** cancels a drag. An owner's **Owned dataset**
setting remains in Edit rather than becoming a connectable port. Scalar feedback connections
use the existing simulation rules.

Links follow their components and are an overlay, not drawing objects. They stay out of PNG,
SVG, and print. HTML hides them by default; **Sketch settings · Show wiring** enables a read-only
reader view of the same connections. The saved bindings execute independently of visibility.
**Edit…** opens the component inspector for its name, settings, literal values, and connections.
Its fixed header identifies the component type (for example, **URL parameter**) independently
of the editable instance name, so renamed components remain recognizable.
The dialog groups configuration, data inputs, control inputs, and the output preview so that
mode switches and connections are easier to distinguish. Its body scrolls independently of
**Save** and **Cancel**, and fields stack on narrow screens.

After changing a source or literal, the dialog previews the proposed outputs and reports errors.
**Save** applies the changes; **Cancel** leaves the drawing unchanged. This is a paused preview:
it does not advance timers, consume pulse edges, or change component state.
Built-in API v2 components display that instance name as their caption, separately from their
operation, value, or state. This includes Number control, Constant, Gauge, and all logic gates.
Long names fit within the caption area, and names persist in saved sketches and exports. Spreadsheet deliberately uses its whole box for cells and omits a caption;
its instance name remains available in Edit and connection choices.

Built-in numeric readouts use up to eight significant digits and keep safe integers exact.
This is display formatting only: editing fields, saved values, connections, calculations, and
CSV/JSON downloads retain the original numeric precision. Spreadsheet formats you select,
clock readouts, and measurement labels keep their chosen precision. Numeric-looking strings
remain literal text.

**Number control** has `min`, `max`, and `step` inputs, initially 0, 100, and 1. Set literals or
connect these values through **Edit…**. Negative bounds and fractional steps work. The slider,
step buttons, and direct entry stay within the bounds and snap to the step grid anchored at `min`;
the maximum remains reachable even when it is between grid points. The step must be positive,
and `min` must not exceed `max`. Direct number entry also works in exported HTML.

**Seven-segment display**, in **Displays**, has two **Input mode** settings in **Edit…**.
**Number** (the default) takes a required integer `value` from 0 to 9. **Segments** exposes boolean
`a`…`g` inputs, each initially false, for direct control of the conventional seven segments.
Both modes accept `decimalPoint` (initially false) and `enable` (initially true). The fixed boolean
outputs `a`…`g` and `decimalPoint` report the visible segments; disabling the display makes them
all false. Dim segments mean off; amber means an unavailable input, not the digit zero.

**LED matrix (8×8)** has three **Input mode** settings:

- **Boolean** (the default): `row0`…`row7` and `col0`…`col7`, all initially false. Row 0 is at the
  top and column 0 at the left. An LED lights when both its row and column are true. Every active
  crossing is shown: two active rows and two active columns light four LEDs.
- **Rows**: numeric `r0`…`r7`, each initially 0 and restricted to integers 0–255. `r0` is the top
  row; bit 7 (128) is at the left and bit 0 (1) at the right. A row value of 129 lights both ends, 255
  lights all eight LEDs, and 0 leaves the row dark.
- **Columns**: numeric `c0`…`c7`, each initially 0 and restricted to integers 0–255. `c0` is the
  leftmost column; bit 7 (128) is at the top and bit 0 (1) at the bottom. A column value of 129
  lights its top and bottom LEDs.

All modes have `enable`, initially true. The fixed numeric outputs `r0`…`r7` and `c0`…`c7`
report the visible row and column bytes simultaneously in every mode, using the same bit order as
their inputs. Disabling blanks the display and sets all sixteen outputs to zero. Changing
Input mode exposes its own input ports while preserving those output names. Both displays show
their instance name and work in offline HTML. They show current inputs directly, with no scanning
clock or stored frame. In Wiring mode, Boolean and numeric column inputs sit on top, row inputs
on the left, row-byte outputs on the right, and column-byte outputs on the bottom. Column ports
remain data ports despite their top/bottom placement. The `enable` control is on top in all modes.

The built-in logic components use the same typed connections. **AND**, **NAND**, **OR**, **NOR**,
**XOR**, **XNOR**, **NOT**, and **Buffer** use traditional logic-gate shapes and boolean ports.
**Compare** takes two numbers: `value` (A) and `b` (B, initially 70). Both can be connected or set
as literals. Choose **>**, **≥**, **<**, **≤**, **=**, or **≠** in **Edit…**; the boolean output
reports the selected comparison. Equality compares the actual numbers without a tolerance.
**Inverter (×−1)** takes and returns a number; **NOT** takes and returns a boolean.
For example, **Compare** and **Toggle** can feed **AND**, whose output drives a **Status indicator**.

**Tri-state buffer** has boolean `value` and `enable` inputs. When `enable` is true, the output
follows `value`; when false, it is **Z (high impedance)**, not an inverted value. Its separate enable
pin and purple Z indicator distinguish it from ordinary Buffer and NAND. A boolean consumer connected
to Z shows an unavailable state until the buffer is enabled; you can save that connection while it
is disabled. Missing connections still show amber, not Z. Each input has one source; shared-bus
resolution and electrical simulation are outside this component's behavior.

**Math** takes two numeric inputs, `a` and `b`, and outputs `value`. In **Edit…**, connect each
input or enter a number, then choose **+**, **−**, **×**, **÷**, **min**, or **max** in the `operation` dropdown.
Subtraction means `a − b`; division means `a ÷ b`. Each instance keeps its own operation.
You can connect its result to another Math block, Compare, Gauge, or Value label. Division by
zero and overflow report an error and leave the result unavailable; correcting the input
restores the connected calculation, including in exported HTML.

**Clamp** limits a number to `min`…`max` (initially 0…100). **Range mapper** converts `inMin`…`inMax`
into `outMin`…`outMax`, initially 0…100 → 0…1. It clamps to the input range by default; set `clamp`
false to extrapolate. Input bounds must increase; reversed output bounds are supported.
**Number function** applies **abs**, **round**, **floor**, or **ceil** to a number. `round` uses
nearest-integer rounding with half values toward positive infinity. All settings are in **Edit…**.

**Selector (number)** and **Selector (Boolean)** choose between `a` and `b`: `select=false`
chooses A, and `select=true` chooses B. Both data inputs must be valid, including the unselected
one. These are value-routing components; they do not pause or disable an upstream branch.

**Stepped switch** and **Stepped distributor** each have number and Boolean variants. Set
**Channels** in **Edit…** to 2–16 (initially 4); this changes the available ports. Connect a
Trigger or Pulse generator to `pulse`. Every false → true pulse advances from channel 0 through
N−1 and wraps to 0; holding true does not advance again. A true `reset` holds channel 0. The numeric
`position` output reports the selected channel.

- A stepped selector has `in0`…`in(N−1)` and one `value` output. Unconnected channels default to 0 or
  false; every declared channel must have a valid value, even when unselected.
- A stepped distributor has one required `value` input and `out0`…`out(N−1)`. Only the selected
  output follows the input; every inactive output is **0 for numbers** or **false for Booleans**.

Selection is saved, and reload/copy/undo preserves it without advancing for an already-high pulse.
Changing the channel count resets to channel 0 and starts fresh pulse observation. Data continues
to flow through the selected route between pulses. Reducing the channel count can leave connections
to removed outputs unavailable until they are rewired.

**Shift register (Boolean)** and **Shift register (number)**, in **Logic**, store a sequence of
values. Set **Stages** in **Edit…** to 1–16 (initially 4), connect data to `value`, and connect
Trigger or Pulse generator to `pulse`. Each false → true pulse stores the data in `q0` and moves
the previous contents of `q0` to `q1`, and so on, using the same snapshot of the old cells. Holding
true does not shift again. Each stage has its own output and visible value; `value` also exposes
the current last stage, `q(N−1)`. The numeric variant accepts finite numbers, including fractions.

`shiftedOut` holds the last value removed from the end of the register. To cascade registers on
**the same pulse**, connect **value → value** (or `q(N−1) → value`) and share pulse/reset. All registers
sample the pre-edge values together before any publishes its next state, so one pulse advances
exactly one cell across a register boundary. `shiftedOut` is available for observing removed data;
it is not the shared-clock cascade connection.

Reset clears all stages and `shiftedOut` to false or 0; hold the `reset` input true or use **Reset**
in the component controls, also available in exported HTML. An initial high pulse and reset release
during high do not shift. Changing Stages clears the stored sequence and starts fresh pulse
observation. Reload, copying canvas instances, and undo preserve contents without replaying a pulse;
fresh placement from the library starts empty. Instance names and optional indicators work as for
other logic components. Feedback can circulate stored data through a register or an explicit delay.

**Feedback and memory.** Connections may form loops. The runtime processes changed signals in
bounded settling rounds: each round reads one consistent snapshot and commits state changes
together. A counter can connect its own `reached` output to `reset`; downstream components still
observe the brief completion pulse. To stop at zero, connect `reached → NOT → Pulse generator.enable`.
To reset and remain stopped, also set an SR latch and use its stored output to disable the generator.

**SR latch** has `set`/`reset` inputs and `q`, `notQ`, and `value` outputs. **D latch** follows `d`
while `enable` is true. **D flip-flop** captures `d` on a rising `clock`. **Register (Boolean)** and
**Register (number)** capture `value` on a rising `pulse` when enabled. Reset wins over clock and
clears storage; a held-high clock never repeatedly captures. Boolean memory can display **X** for
unknown state; the SR latch also becomes X if set and reset are asserted together.
Cross-connected NOR/NAND gates can also form latches; an explicit set/reset command
establishes their initial state. X is distinct from **Z**, which means no driven signal.

**Ring counter**, **Johnson counter**, and **Decoded decade counter (4017-style)** advance on rising
`clock` while `enable` is true. Reset wins and returns to the initial pattern. Ring and Johnson have
1–16 configurable stages; ring starts with only `q0` true and repeats after N clocks, while Johnson
starts all false and repeats after 2N. The decade counter exposes `q0`–`q9`, a zero-based `position`,
and `carry` high for positions 0–4. These are logical models with explicit saved state.

**Pause / Step / Resume** controls appear when the drawing contains components, in both editor
and exported HTML. Pause stops active simulation time and keeps the visible signals. Step advances
one propagation round; if the circuit is settled, it moves to the next scheduled event. The status
shows time, round, and a recent signal change. Resume continues the simulation. Pause belongs to
the current tab/session; it is not saved as part of the drawing. Step advances the active-document
schedule; Live clock, Stopwatch, and Timer still read real wall time and are not fast-forwarded.

A loop that cannot settle reports an error instead of hanging the drawing. Use a positive Delay
when a loop should advance over time; zero delay is still subject to the settling limit. Each input
continues to have one source. Combine signals with gates, arithmetic, or selectors; shared buses
and multiple drivers remain deferred.

**Trigger**, in **Controls**, is a pushbutton with a boolean `value` output. Double-click it to
enter its controls, then click **Press**: each completed click emits `true` for 0.1 seconds and
returns to `false`. Holding the button does not repeat. Rapid clicks queue distinct pulses,
separated by at least 0.01 seconds of `false`, so a Counter can register every press. Each instance
holds up to 64 waiting presses and reports an error if full. Connect **Trigger · value** to a
Counter's `value` input through **Edit…**. In exported HTML, click the button directly.
Queued presses are transient; reopening, copying, or undoing never replays old presses.

The **Tools & time** category includes **Live clock**, which follows wall time in the selected
timezone. In **Edit…**, set its string `timezone` input to `local` (the default), `UTC`, or an
IANA name such as `Europe/Berlin` or `America/New_York`. Invalid timezones show an error.
Its hands, digital readout, and string `time` output share the same `HH:mm:ss` snapshot.
Place a fresh Live clock from the built-in library to use these ports; existing instances retain
their embedded scripts.

Four boolean outputs emit nominal 100 ms pulses: `second` on each observed consecutive second,
`minute` at second 00, `hour` at minute/second 00, and `halfDay` at noon and midnight in the
selected timezone. For example, connect **Live clock · second** to **Counter · value** through
**Edit…** to count observed seconds. The `time` output is a string, so it cannot connect to the
existing numeric Value label. Optional LEDs labelled **1s**, **1m**, **1h**, and **12h** show the
pulses; the clock also displays its instance name.

Fresh placement, reload, and timezone changes start with all pulses false. Missed boundaries and
clock jumps never replay pulses. Live updates run in the active tab; returning to the tab realigns
the clock to current wall time. Static exports capture its last settled snapshot without advancing
it, while exported HTML keeps the clock live.

**Stopwatch** has boolean `run` and `reset` inputs and one numeric output, `elapsed`, in seconds
including milliseconds. Connect a Toggle to `run`: changing it to true starts or resumes timing;
changing it to false pauses and publishes the accumulated result. For example, connect
**Stopwatch · elapsed** to **Value label · value** to show the result after pausing. While timing
runs, the output holds the previous paused total; Reset clears it to zero and stops timing.

The live display uses `HH:mm:ss.mmm` and refreshes every 100 ms while running. It follows saved
wall timestamps, so a running stopwatch continues through tab switches, backgrounding, and
reloads. Double-click for **Start/Pause** and **Reset** in the editor, or use them directly in HTML.
Manual actions remain in effect until `run` changes again; a held true `reset` always keeps the
stopwatch cleared and stopped. Place a fresh Stopwatch to get these ports. Older instances keep
their embedded source, and new placements start stopped.

**Timer** keeps its red countdown wedge and adds connected controls. In **Edit…**, choose
**Unit** (**minutes** by default, or **seconds**) and **Starting duration** (0–60, initially 45).
Dragging the dial hand also sets the starting duration, refills the timer, and stops it. The top
of the dial means 0; set a full 60 through **Edit…**. Changing either setting refills and stops.

Boolean `run` and `reset` inputs default to false. A change to run=true starts/resumes; changing
to false pauses. **Start/Pause** and **Reset** also work directly in the component controls.
The latest manual action remains effective until run changes; held reset overrides it, refills,
and stops. Releasing reset alone does not start. At zero, the timer stops and holds `reached=true`.
An explicit Start or a new run rising edge refills and starts once; holding run true never loops.

The boolean `tick` output emits a nominal 100 ms pulse for each observed whole configured unit
elapsed. Connect it to Counter's `value`, or connect `reached` to a Status indicator. The instance
caption and optional LEDs show the timer's identity and outputs. A running Timer follows wall
time across hidden tabs and reloads. Missed ticks are not replayed; expiry while hidden sets
`reached` on return. Reload clears a stale tick. Static exports keep the last settled dial and
output snapshot; exported HTML runs the countdown. Place a fresh Timer to get the new ports.

Other connected signals use per-instance intervals or edge observation:

- **Pulse generator** publishes boolean `value` with configurable `seconds` (period, initially 1),
  `width` (high time, initially 0.1), and `enable` (initially true). It starts low and emits its
  first pulse after a full period. Periods are 0.02–3,600 seconds; high and low time must each be
  at least 0.01 seconds. Disabling forces low; re-enabling or changing timing restarts the period.
- **Edge to pulse** turns each rising, falling, or either edge of boolean `value` into a high pulse
  lasting `seconds` (0.01–3,600, initially 0.1). The first observed level never triggers. Up to 64
  waiting pulses are queued, separated by at least 0.01 seconds low; changing edge mode or duration
  discards the queue and starts fresh observation.
- **Delay** accepts a boolean `value` and `seconds` (0–3,600, including fractions). Every on/off
  transition appears at its output after that delay, including short pulses. Zero passes through
  immediately. Changing the duration clears pending transitions and starts again from the current
  input; each instance holds up to 64 pending transitions and shows an error if full.
- **Counter** accepts boolean `value` and `reset`, `direction` (**up** or **down**, initially up),
  numeric `start` (initially 3), and numeric `threshold` (initially 3). Up starts at zero, adds one
  per false → true edge, and sets `reached` when `count >= threshold`. Down starts at `start`,
  subtracts one per rising edge, stops at zero, and sets `reached` when `count === 0`; threshold
  applies only to up mode. Start and threshold must be nonnegative safe integers. Holding true
  does not repeat, and an initially high input never counts. Hold reset to keep the mode's
  starting count (zero for up, start for down), or double-click and use **Reset**, also available
  in HTML. Releasing reset during high does not count. Changing direction, or changing start
  while counting down, restarts at the appropriate baseline and observes the input afresh.
  Changing threshold, or start in up mode, keeps the current count. Saved counts survive reload
  and undo without phantom edges. An up/down arrow and target readout show the mode; down also
  displays its configured start.
- **Random integer** accepts inclusive integer `min` and `max`. It emits immediately, then once
  per second. The same number may be drawn twice. Negative bounds and a single-value range work.
- **Sample & hold (integer)** and **Sample & hold (Boolean)** accept `value` and `seconds`
  (0.01–3,600). They sample immediately, hold that value for the chosen duration, then sample again
  at the start of each new hold. Changing the duration samples immediately and restarts the period.
  The integer variant requires safe integers; the Boolean variant connects directly to gates.

Configure and connect them in **Edit…**. For example, connect Random integer → Sample & hold
(integer) → Value label, or Toggle → Delay → Counter → Status indicator using `reached`.
The controls, names, indicators, and connections work in exported HTML too.
Interval timing uses active document time: hidden/inactive documents and the open **Edit…**
dialog pause it. Live clock resumes at current wall time; running Stopwatch and Timer instances
retain elapsed wall time. Late wakes replay queued Delay transitions in timestamp order, so an
earlier clock edge samples the earlier data even when a later change is also overdue. Queued
pulses remain distinct. Pulse generator advances one phase at a time without a catch-up burst; Random and Sample & hold take one new sample,
without a burst of missed samples. These are browser-timed signals, not a real-time circuit simulator.
Counts and current outputs are saved. Pending Delay transitions and timing/edge memory are transient:
reload, copy, undo, rewiring, or recovery from unavailable inputs starts fresh observation without
counting an already-high input. Static exports and previews capture saved values without sampling.

Input/output indicators are on by default for these logic entries. Green means true, grey means
false, and blue means a numeric value is available, including zero. Amber means unavailable.
With valid inputs, double-click the shape and use **Indicators: on/off** to change that instance.
The indicator toggle stays out of exports, while the saved preference is retained. Compare's
operands and operation are configured in **Edit…**.

Missing or invalid inputs show an unavailable state rather than a false result. The built-in
logic entries keep their silhouette, display **—** for unavailable values, and show **Input
required** or **Input unavailable**. Custom components can provide their own unavailable drawing;
otherwise the app displays a status card. Their handles are inactive until the component recovers.

Connections survive sketch/workspace saves, autosave, and undo/redo. Copy or duplicate both
components to create an independently connected pair. Copying only a consumer leaves its
external source unresolved; use **Edit…** to reconnect it. Deleting a source also reports
a missing connection, and undo restores it. Static PNG/SVG/print capture the computed result.
Set `features.smartComponents` to `false` in `settings.json` to hide component templates and
the input picker and disable component authoring. Existing connected drawings and HTML exports
keep working. Component authoring also requires `smartShapeAuthoring` to be enabled.

Components support number, string, Boolean, and table values. In **Whole workspace** mode,
explicit **Publish** and **Receive** endpoints connect sketches, and shared Datasets keep
their records available across sketches. Declared local actions support navigation, dataset
commands and downloads, including event-driven requests. See the
[component scripting contract](SMART_SHAPES.md#connected-components-api-v2) for custom ports
and computations, including opt-in typed events for discrete interactions. HTTP/MQTT
integrations remain future work.

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
[tests/README.md](tests/README.md). Test dependencies are for development only; the app itself
requires no build step or runtime dependencies.

### Update the demo library

Import `examples/demo-shapes-library.json`, edit its eight demo-specific entries, export the library,
and save the download back as `examples/demo-shapes-library.json`. To customize one of its five
read-only built-ins, use **Copy to My shapes** for an editable personal variant. Keep the shipped
demo's built-in snapshots identical to their canonical catalog definitions, and store demo category
memberships in `builtinCategoryTags`. The contributor shapes embed their
complete `.js` example scripts: keep the drilling template and race-start timer examples and
library sources in sync. Live clock, Stopwatch, and Ruler also have embedded authoring templates
in `index.html`; update those copies, their `.js` examples, library sources, and saved previews
together when changing a script.
Keep [Timer's source](examples/timer.js), embedded authoring template, built-in catalog definition,
and preview in sync as well.

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
