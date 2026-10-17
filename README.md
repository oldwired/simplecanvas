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
or move your work elsewhere. Sketch/workspace JSON retains placed smart-shape scripts, saved state,
and connections. A workspace contains all open sketch tabs; it excludes the library, pins, and
category organization. Use the separate **Export library…** action to retain those.

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
**Working collection** of pinned shortcuts. Click a shape, then click the canvas to place it.
Open the expanded library browser with the **Browse** icon: search by name or
keywords, choose a category, and use the **Source** filter for **Built-in** or **My shapes**.
**Collapse library** closes the expanded browser and leaves the quick picker available.

| Default category | Examples |
| --- | --- |
| Controls | Number control, Toggle, Constant, Trigger |
| Logic | Boolean gates, Tri-state buffer, Compare, Inverter (×−1), Math, Clamp, Range mapper, Number function, numeric/Boolean selectors, stepped switches, and shift registers |
| Displays | Gauge, Value label, Status indicator, Seven-segment display, LED matrix (8×8), Chart |
| Tools & time | Clock, Live clock, Stopwatch, Timer, Ruler, Delay, Counter, Random integer, Sample & hold (integer/Boolean), Pulse generator, Edge to pulse |
| Drawing | Rectangle, Ellipse, Arrow, Arc, Minimal, Blank |

The catalog includes 59 entries, including 50 connected API v2 components. Every smart-shape
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
Exporting one shape does not mark the whole library as saved.

Categories are named tags: an entry can belong to several, including built-in entries. Create,
rename, and remove categories through **Library actions**, and assign memberships to entries.
An entry's **Edit categories…** dialog also offers **New category…** while choosing memberships.
Removing a category removes that membership, while preserving shapes, pins, and other categories.
Empty categories remain available; entries with no memberships appear under **Uncategorized**.
Search **Keywords** are separate from category membership.

**Export library…** downloads a self-contained `shapes-library.json`, including the working
collection, every entry in My shapes, category organization, and the definitions they need.
Pinned built-ins are included as snapshots, so the file does not depend on another installation
having the same built-in version. Library format 2
preserves entry IDs, category memberships (including built-in overrides and empty categories),
keywords, and working-collection membership. Older flat libraries and single-category entries
still import; personal entries appear in **My shapes**. **Import library…** replaces the current user library
and its organization and pins, while leaving the built-in definitions available.

Library edits, category organization, and pins last only for the current visit, separately from
sketch saves and autosave. An indicator shows unexported changes; importing another library or
leaving the page warns before those changes are discarded. Export and reimport the file to
retain your collection for another visit.

Libraries include PNG thumbnails, which display without running shape scripts. Ordinary missing
previews are generated automatically. Imported smart shapes with missing previews show placeholders
and ask before running scripts to generate pictures; **Use placeholders** still loads the library.
**Generate missing previews…** lets you generate them later. Export the library to retain new previews.

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
**File → Open workspace…** to explore fifteen connected examples. Opening a workspace replaces
all current tabs; use **Save workspace…** first if you want to keep them. The JSON workspace is
editable. [The exported HTML](examples/smart-components-workspace.html) runs offline as a reader.

| Tab | Try it |
| --- | --- |
| Basics | Change one number and watch a gauge and value label follow. |
| Threshold logic | Combine a comparison with an enable toggle. |
| Numeric tools | Scale and clamp a decimal value. |
| Countdown | Turn **Run** on to count down from 9 on a seven-segment display. |
| Delayed pulses | Follow a pulse through a delay. |
| Routing | Step through four values with pulse and reset controls. |
| Shift memory | Move a bit through two cascaded registers. |
| LED patterns | Drive matrices with Boolean lines and row bytes. |
| Self-reset | Let completion reset its own countdown; count every completed cycle. |
| Stop at zero | Disable a pulse generator when its counter reaches zero. |
| Reset and stop | Reset the counter and retain the stop command in an SR latch. |
| Latch laboratory | Compare a dedicated SR latch with cross-connected NOR and NAND gates. |
| Shared-edge storage | Clock two flip-flops together and sample a numeric value. |
| Sequences | Circulate a bit, construct a Johnson sequence, and clock a decoded decade counter. |
| Delayed feedback | Watch a NOT/Delay loop alternate with a real time boundary. |

In the editor, double-click a component to use its controls. Number controls support a slider,
step buttons, and clicking the displayed value to type a number. In HTML, use the controls
directly. Select a component and open **Inputs…** in the editor to inspect or change its actual
bindings. The illustrative arrows are ordinary drawing objects. Each tab is independent;
timing pauses while that tab is inactive. Reader changes survive tab switches, and reloading
the HTML restores the exported snapshot.

For a smaller starting point, open [the control-and-gauge sketch](examples/connected-components.json)
with **File → Open sketch…**. **Export HTML** keeps its connection working offline.

To build your own pair, place **Number control** and **Gauge** from the built-in library.
Their script templates also remain available for authoring. Select the gauge, click **Inputs…**,
choose **Number control · value** for its
`value` input, and save. The same dialog can name an instance or set a literal input value.
It lists compatible outputs from components in the active sketch.
When several sources share a name, the picker adds qualifiers such as **#1 (left)** and
**#2 (right)**. These drawing-order and position hints help identify the source; they do not
rename instances or change their connections. You can still give instances distinct names.
After changing a source or literal, the dialog previews the proposed outputs and reports errors.
**Save** applies the changes; **Cancel** leaves the drawing unchanged. This is a paused preview:
it does not advance timers, consume pulse edges, or change component state.
Every built-in API v2 component displays that instance name as its caption, separately from its
operation, value, or state. This includes Number control, Constant, Gauge, and all logic gates.
Long names fit within the caption area, and names persist in saved sketches and exports.

**Number control** has `min`, `max`, and `step` inputs, initially 0, 100, and 1. Set literals or
connect these values through **Inputs…**. Negative bounds and fractional steps work. The slider,
step buttons, and direct entry stay within the bounds and snap to the step grid anchored at `min`;
the maximum remains reachable even when it is between grid points. The step must be positive,
and `min` must not exceed `max`. Direct number entry also works in exported HTML.

**Seven-segment display**, in **Displays**, has two **Input mode** settings in **Inputs…**.
**Number** (the default) takes a required integer `value` from 0 to 9. **Segments** exposes boolean
`a`…`g` inputs, each initially false, for direct control of the conventional seven segments.
Both modes accept `decimalPoint` (initially false) and `enable` (initially true). The fixed boolean
outputs `a`…`g` and `decimalPoint` report the visible segments; disabling the display makes them
all false. Dim segments mean off; amber means an unavailable input, not the digit zero.

**LED matrix (8×8)** has two **Input mode** settings:

- **Boolean** (the default): `row1`…`row8` and `col1`…`col8`, all initially false. Row 1 is at the
  top and column 1 at the left. An LED lights when both its row and column are true. Every active
  crossing is shown: two active rows and two active columns light four LEDs.
- **Rows**: numeric `r1`…`r8`, each initially 0 and restricted to integers 0–255. `r1` is the top
  row; bit 128 is at the left and bit 1 at the right. A row value of 129 lights both ends, 255
  lights all eight LEDs, and 0 leaves the row dark.

Both modes have `enable`, initially true. The fixed numeric outputs `r1`…`r8` report the visible
row bytes in every mode; disabling blanks the display and sets these outputs to zero. Changing
Input mode exposes its own input ports while preserving those output names. Both displays show
their instance name and work in offline HTML. They show current inputs directly, with no scanning
clock or stored frame.

The built-in logic components use the same typed connections. **AND**, **NAND**, **OR**, **NOR**,
**XOR**, **XNOR**, **NOT**, and **Buffer** use traditional logic-gate shapes and boolean ports.
**Compare** takes two numbers: `value` (A) and `b` (B, initially 70). Both can be connected or set
as literals. Choose **>**, **≥**, **<**, **≤**, **=**, or **≠** in **Inputs…**; the boolean output
reports the selected comparison. Equality compares the actual numbers without a tolerance.
**Inverter (×−1)** takes and returns a number; **NOT** takes and returns a boolean.
For example, **Compare** and **Toggle** can feed **AND**, whose output drives a **Status indicator**.

**Tri-state buffer** has boolean `value` and `enable` inputs. When `enable` is true, the output
follows `value`; when false, it is **Z (high impedance)**, not an inverted value. Its separate enable
pin and purple Z indicator distinguish it from ordinary Buffer and NAND. A boolean consumer connected
to Z shows an unavailable state until the buffer is enabled; you can save that connection while it
is disabled. Missing connections still show amber, not Z. Each input has one source; shared-bus
resolution and electrical simulation are outside this component's behavior.

**Math** takes two numeric inputs, `a` and `b`, and outputs `value`. In **Inputs…**, connect each
input or enter a number, then choose **+**, **−**, **×**, **÷**, **min**, or **max** in the `operation` dropdown.
Subtraction means `a − b`; division means `a ÷ b`. Each instance keeps its own operation.
You can connect its result to another Math block, Compare, Gauge, or Value label. Division by
zero and overflow report an error and leave the result unavailable; correcting the input
restores the connected calculation, including in exported HTML.

**Clamp** limits a number to `min`…`max` (initially 0…100). **Range mapper** converts `inMin`…`inMax`
into `outMin`…`outMax`, initially 0…100 → 0…1. It clamps to the input range by default; set `clamp`
false to extrapolate. Input bounds must increase; reversed output bounds are supported.
**Number function** applies **abs**, **round**, **floor**, or **ceil** to a number. `round` uses
nearest-integer rounding with half values toward positive infinity. All settings are in **Inputs…**.

**Selector (number)** and **Selector (Boolean)** choose between `a` and `b`: `select=false`
chooses A, and `select=true` chooses B. Both data inputs must be valid, including the unselected
one. These are value-routing components; they do not pause or disable an upstream branch.

**Stepped switch** and **Stepped distributor** each have number and Boolean variants. Set
**Channels** in **Inputs…** to 2–16 (initially 4); this changes the available ports. Connect a
Trigger or Pulse generator to `pulse`. Every false → true pulse advances from channel 1 through
N and wraps to 1; holding true does not advance again. A true `reset` holds channel 1. The numeric
`position` output reports the selected channel.

- A stepped selector has `in1`…`inN` and one `value` output. Unconnected channels default to 0 or
  false; every declared channel must have a valid value, even when unselected.
- A stepped distributor has one required `value` input and `out1`…`outN`. Only the selected
  output follows the input; every inactive output is **0 for numbers** or **false for Booleans**.

Selection is saved, and reload/copy/undo preserves it without advancing for an already-high pulse.
Changing the channel count resets to channel 1 and starts fresh pulse observation. Data continues
to flow through the selected route between pulses. Reducing the channel count can leave connections
to removed outputs unavailable until they are rewired.

**Shift register (Boolean)** and **Shift register (number)**, in **Logic**, store a sequence of
values. Set **Stages** in **Inputs…** to 1–16 (initially 4), connect data to `value`, and connect
Trigger or Pulse generator to `pulse`. Each false → true pulse stores the data in `q1` and moves
the previous contents of `q1` to `q2`, and so on, using the same snapshot of the old cells. Holding
true does not shift again. Each stage has its own output and visible value; `value` also exposes
the current last stage, `qN`. The numeric variant accepts finite numbers, including fractions.

`shiftedOut` holds the last value removed from the end of the register. To cascade registers on
**the same pulse**, connect **value → value** (or `qN → value`) and share pulse/reset. All registers
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
1–16 configurable stages; ring starts with only `q1` true and repeats after N clocks, while Johnson
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
Counter's `value` input through **Inputs…**. In exported HTML, click the button directly.
Queued presses are transient; reopening, copying, or undoing never replays old presses.

The **Tools & time** category includes **Live clock**, which follows wall time in the selected
timezone. In **Inputs…**, set its string `timezone` input to `local` (the default), `UTC`, or an
IANA name such as `Europe/Berlin` or `America/New_York`. Invalid timezones show an error.
Its hands, digital readout, and string `time` output share the same `HH:mm:ss` snapshot.
Place a fresh Live clock from the built-in library to use these ports; existing instances retain
their embedded scripts.

Four boolean outputs emit nominal 100 ms pulses: `second` on each observed consecutive second,
`minute` at second 00, `hour` at minute/second 00, and `halfDay` at noon and midnight in the
selected timezone. For example, connect **Live clock · second** to **Counter · value** through
**Inputs…** to count observed seconds. The `time` output is a string, so it cannot connect to the
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

**Timer** keeps its red countdown wedge and adds connected controls. In **Inputs…**, choose
**Unit** (**minutes** by default, or **seconds**) and **Starting duration** (0–60, initially 45).
Dragging the dial hand also sets the starting duration, refills the timer, and stops it. The top
of the dial means 0; set a full 60 through **Inputs…**. Changing either setting refills and stops.

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

Configure and connect them in **Inputs…**. For example, connect Random integer → Sample & hold
(integer) → Value label, or Toggle → Delay → Counter → Status indicator using `reached`.
The controls, names, indicators, and connections work in exported HTML too.
Interval timing uses active document time: hidden/inactive documents and the open **Inputs…**
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
operands and operation are configured in **Inputs…**.

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
and working collection alongside the built-in catalog.
The file is read only at startup; opening the picker never reloads it. File imports work when
hosted or opened locally, including importing the demo file via **Actions → Import library…**.
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
| `shapeLibraryManagement` | Hides library actions and disables pins, category organization, copying/duplication, shape and library import/export, rename, replace, and delete. The browser and direct placement remain available. |
| `smartShapeAuthoring` | Disables creating and editing scripts, copying smart definitions into My shapes, and adding them through pins, imports, or selections. Existing smart shapes remain browsable and placeable, with working interactive handles. |
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
