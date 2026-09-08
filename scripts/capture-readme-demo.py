"""Assemble deterministic Playwright screenshots into an optimized README GIF."""

from argparse import ArgumentParser
from json import loads
from pathlib import Path
from typing import Iterable, Sequence

try:
    from PIL import Image, ImageChops
except ImportError as error:
    raise SystemExit("Pillow is required: python -m pip install Pillow") from error


# Keep identity and high-contrast drafting colors exact. The remaining slots are
# learned once from every resized capture so animation frames never drift between
# unrelated local palettes.
RESERVED_COLORS: tuple[tuple[int, int, int], ...] = (
    (8, 16, 22),  # Canvas background; GIF disposal uses palette index zero.
    (255, 255, 255),
    (240, 242, 245),
    (41, 47, 54),
    (241, 243, 246),
    (48, 54, 62),
    (36, 42, 49),
    (223, 226, 230),
    (0, 0, 0),
    (189, 248, 120),  # KJDraw green (#bdf878)
    (188, 248, 120),  # Previous KJDraw green (#bcf878)
    (40, 99, 223),  # KJDraw blue (#2863df)
)
BRAND_COLORS = RESERVED_COLORS[-3:]
PALETTE_SIZE = 256


def build_shared_palette(images: Sequence[Image.Image]) -> Image.Image:
    """Return one 256-color palette learned from all frames plus fixed UI colors."""
    if not images:
        raise ValueError("At least one frame is required to build a GIF palette")
    width = max(image.width for image in images)
    height = sum(image.height for image in images)
    palette_source = Image.new("RGB", (width, height))
    top = 0
    for image in images:
        palette_source.paste(image, (0, top))
        top += image.height
    learned = palette_source.quantize(
        colors=PALETTE_SIZE,
        method=Image.Quantize.MEDIANCUT,
        dither=Image.Dither.NONE,
    )
    learned_palette = learned.getpalette()
    learned_counts = sorted(learned.getcolors(maxcolors=PALETTE_SIZE) or [], reverse=True)

    # Put deterministic identity/background colors first, then fill the table with
    # the most-used colors learned from the complete animation. Dedupe so every
    # slot remains useful instead of letting reserved colors displace one another.
    colors: list[tuple[int, int, int]] = []
    seen: set[tuple[int, int, int]] = set()

    def add(color: tuple[int, int, int]) -> None:
        if color in seen or len(colors) == PALETTE_SIZE:
            return
        colors.append(color)
        seen.add(color)

    for color in RESERVED_COLORS:
        add(color)
    for _, index in learned_counts:
        offset = index * 3
        add(tuple(learned_palette[offset : offset + 3]))

    # Tiny fixtures may contain fewer than 256 unique learned colors. Stable
    # neutral/rgb fillers keep the carrier a complete GIF palette in that case.
    for value in range(256):
        add((value, value, value))
    for red in range(0, 256, 17):
        for green in range(0, 256, 17):
            for blue in range(0, 256, 17):
                add((red, green, blue))

    palette = Image.new("P", (1, 1))
    palette.putpalette([channel for color in colors for channel in color])
    return palette


def quantize_with_shared_palette(
    images: Iterable[Image.Image], palette: Image.Image
) -> list[Image.Image]:
    palette_values = palette.getpalette()
    color_indexes = {
        tuple(palette_values[index : index + 3]): index // 3
        for index in range(0, len(palette_values), 3)
    }
    channel_matches = {
        value: [255 if sample == value else 0 for sample in range(256)]
        for color in BRAND_COLORS
        for value in color
    }
    frames = []
    for image in images:
        source = image.convert("RGB")
        frame = source.quantize(palette=palette, dither=Image.Dither.NONE)
        red, green, blue = source.split()
        for color in BRAND_COLORS:
            mask = ImageChops.multiply(
                red.point(channel_matches[color[0]]),
                green.point(channel_matches[color[1]]),
            )
            mask = ImageChops.multiply(mask, blue.point(channel_matches[color[2]]))
            frame.paste(color_indexes[color], mask=mask)
        frames.append(frame)
    return frames


def save_animation(
    images: Sequence[Image.Image],
    durations: Sequence[int],
    palette: Image.Image,
    output: Path,
) -> None:
    """Write frames with one global table instead of per-frame local palettes."""
    images[0].save(
        output,
        save_all=True,
        append_images=list(images[1:]),
        duration=list(durations),
        loop=0,
        disposal=2,
        palette=palette.getpalette(),
        optimize=False,
    )


def parse_options():
    parser = ArgumentParser()
    parser.add_argument("--frames", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def main() -> None:
    options = parse_options()
    frames_dir = Path(options.frames).resolve()
    output = Path(options.output).resolve()
    manifest = loads((frames_dir / "manifest.json").read_text(encoding="utf-8"))
    target_width = int(manifest.get("width", 1120))
    resized_images = []
    durations = []

    for entry in manifest["frames"]:
        with Image.open(entry["path"]) as capture:
            source = capture.convert("RGB")
        target_height = round(source.height * target_width / source.width)
        resized_images.append(
            source.resize((target_width, target_height), Image.Resampling.LANCZOS)
        )
        durations.append(int(entry["duration"]))

    if not resized_images:
        raise SystemExit("No capture frames were found")

    palette = build_shared_palette(resized_images)
    images = quantize_with_shared_palette(resized_images, palette)
    output.parent.mkdir(parents=True, exist_ok=True)
    save_animation(images, durations, palette, output)
    print(f"README demo written to {output} ({output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
