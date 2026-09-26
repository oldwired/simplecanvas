# SimpleCanvas

A small, zero-dependency browser sketching canvas.

Demo: https://oldwired.github.io/simplecanvas/

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

Select a line or curve and open the **line-style** button (the stroke-width value) to toggle its
start/end arrowheads or choose **Edit points / Done**. The popover works with mouse or touch and
does not move the canvas. In normal Select mode, clicking an endpoint also toggles its arrowhead.
Each end also has **Filled** and **Inverted** options, which can be combined. Inverted heads point
back along the line; turning a head off and on remembers its style.
Double-clicking or double-tapping the shape remains a shortcut for point editing.

Developer checks are described in [tests/README.md](tests/README.md).

The shape library is optional. Select canvas objects and choose **Add selection to library…**
from the menu, or choose **Import library…** to open your own library file. The library button
appears once a library is available. Click a shape to place it; **Manage** lets you rename,
delete, or replace a shape with the current canvas selection. Images cannot be included.

**Export library…** downloads the entire active library as `shapes-library.json`. Library
changes last only for the current visit and are separate from sketch saves and autosave.
An indicator shows unexported changes; importing another library or leaving the page warns
before those changes are discarded. Import your exported file to use it on another visit.

When hosted, an optional `shapes-library.json` beside the HTML supplies the initial library.
It is read only once at startup. Opening the picker never reloads it, and custom file imports
work whether the page is hosted or opened locally. The HTML works on its own without this file.

Licensed under the MIT License.
