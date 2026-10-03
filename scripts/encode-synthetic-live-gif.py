"""Optional Pillow development encoder. Inputs are real WebM-decoded PNGs only.

No CAD runtime dependency, provider requests, overlays, generated images or
interpolation. One shared palette keeps CAD colours stable across all cuts.
"""
import hashlib
import json
import sys
from pathlib import Path

from PIL import Image


def ensure(condition):
    if not condition:
        raise ValueError("real-video frame evidence invalid")


def main():
    path = Path(sys.argv[1]).resolve()
    cache = Path(__file__).resolve().parents[1] / ".cache"
    ensure(path.is_relative_to(cache.resolve()) and path.parent != cache.resolve())
    evidence = json.loads(path.read_text(encoding="utf-8"))
    ensure(evidence["schema"] == "com.kanjie.kjdraw.synthetic-live-gif@1")
    ensure(evidence["status"] == "encoding" and evidence["synthetic"] is True)
    ensure(evidence["source"] == "original-public-synthetic-facts")
    ensure(evidence["framesInterpolated"] is False and evidence["modelProseAltered"] is False)
    ensure(evidence["maximumBytes"] == 10000000 and len(evidence["cuts"]) == 24)
    ensure(1000 <= evidence["requested"]["width"] <= 1152)
    ensure(96 <= sum(len(cut["frames"]) for cut in evidence["cuts"]) <= 180)
    frames, durations = [], []
    carry = 0.0
    for cut in evidence["cuts"]:
        for frame in cut["frames"]:
            file = (path.parent / "frames" / frame["file"]).resolve()
            ensure(file.parent == path.parent / "frames")
            ensure(hashlib.sha256(file.read_bytes()).hexdigest() == frame["sha256"])
            with Image.open(file) as decoded:
                frames.append(decoded.convert("RGB"))
            # GIF delay units are 10ms. Accumulate rather than introduce drift.
            carry += frame["durationMs"]
            delay = int(round(carry / 10)) * 10
            durations.append(delay)
            carry -= delay
    ensure(frames and len({frame.size for frame in frames}) == 1)
    ensure(24000 <= sum(durations) <= 30000)
    output = path.parent / "synthetic-live-model-highlights.gif"
    requested = evidence["requested"]["width"]
    for width, colours in [(requested, 256), (requested, 128), (1000, 128), (1000, 64)]:
        scaled = [frame if frame.width == width else frame.resize(
            (width, round(frame.height * width / frame.width)), Image.Resampling.LANCZOS) for frame in frames]
        # Representative real-frame thumbnails only determine the global
        # palette; no montage/thumbnail becomes a displayed GIF frame.
        strip = Image.new("RGB", (128, 80 * len(scaled)))
        for index, frame in enumerate(scaled):
            thumbnail = frame.copy()
            thumbnail.thumbnail((128, 80), Image.Resampling.LANCZOS)
            strip.paste(thumbnail, (0, index * 80))
        palette = strip.quantize(colors=colours, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        quantized = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in scaled]
        quantized[0].save(output, format="GIF", save_all=True, append_images=quantized[1:],
                          duration=durations, loop=0, optimize=False, disposal=1)
        size = output.stat().st_size
        if size <= evidence["maximumBytes"]:
            with Image.open(output) as verified:
                actual_duration = 0
                for index in range(verified.n_frames):
                    verified.seek(index)
                    actual_duration += verified.info.get("duration", 0)
                ensure(actual_duration == sum(durations))
                ensure(verified.width == width and 1000 <= width <= 1152)
                print(json.dumps({"bytes": size, "width": width, "height": scaled[0].height,
                                  "paletteColours": colours, "sourceFrameCount": len(frames),
                                  "encodedFrameCount": verified.n_frames, "durationMs": actual_duration}))
                return
    raise ValueError("real-frame GIF exceeds the 10MB publication limit")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Never dump manifest text, model prose, file contents or private paths.
        print("PILLOW_GIF_REJECTED: real-frame integrity, duration or byte limit failed", file=sys.stderr)
        sys.exit(1)
