"""Assemble deterministic Playwright screenshots into an optimized README GIF."""

from argparse import ArgumentParser
from json import loads
from pathlib import Path

try:
    from PIL import Image
except ImportError as error:
    raise SystemExit("Pillow is required: python -m pip install Pillow") from error


parser = ArgumentParser()
parser.add_argument("--frames", required=True)
parser.add_argument("--output", required=True)
options = parser.parse_args()

frames_dir = Path(options.frames).resolve()
output = Path(options.output).resolve()
manifest = loads((frames_dir / "manifest.json").read_text(encoding="utf-8"))
target_width = int(manifest.get("width", 1120))
images = []
durations = []

for entry in manifest["frames"]:
    source = Image.open(entry["path"]).convert("RGB")
    target_height = round(source.height * target_width / source.width)
    resized = source.resize((target_width, target_height), Image.Resampling.LANCZOS)
    images.append(resized.quantize(colors=96, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
    durations.append(int(entry["duration"]))

if not images:
    raise SystemExit("No capture frames were found")

output.parent.mkdir(parents=True, exist_ok=True)
images[0].save(
    output,
    save_all=True,
    append_images=images[1:],
    duration=durations,
    loop=0,
    disposal=2,
    optimize=True,
)
print(f"README demo written to {output} ({output.stat().st_size:,} bytes)")
