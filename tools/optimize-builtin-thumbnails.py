"""Shrink bundled PNG previews in place (optional development tool; requires Pillow).

Keeps the existing PNG data URL contract and dimensions. The palette has up to
256 colors, including alpha; the original is retained whenever it is smaller.
Run after regenerating previews, then inspect the library visually.
"""
import base64
import io
import json
from pathlib import Path
from PIL import Image

path = Path(__file__).resolve().parent.parent / "index.html"
html = path.read_text()
marker = "const BUILTIN_LIBRARY_THUMBNAILS = "
start = html.index(marker) + len(marker)
thumbnails, length = json.JSONDecoder().raw_decode(html[start:])
end = start + length
before = after = 0
for key, url in thumbnails.items():
    original = base64.b64decode(url.split(",", 1)[1])
    image = Image.open(io.BytesIO(original))
    optimized = io.BytesIO()
    image.save(optimized, format="PNG", optimize=True)
    candidates = [original, optimized.getvalue()]
    # Re-quantizing an existing palette would progressively alter its colors on
    # repeated runs. Optimize that PNG losslessly instead.
    if image.mode != "P":
        palette = io.BytesIO()
        image.convert("RGBA").quantize(colors=256, method=Image.Quantize.FASTOCTREE).save(palette, format="PNG", optimize=True)
        candidates.append(palette.getvalue())
    result = min(candidates, key=len)
    thumbnails[key] = "data:image/png;base64," + base64.b64encode(result).decode()
    before += len(original)
    after += len(result)
path.write_text(html[:start] + json.dumps(thumbnails, separators=(",", ":"), ensure_ascii=False) + html[end:])
print(f"{len(thumbnails)} PNG previews: {before:,} → {after:,} bytes")
