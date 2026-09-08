"""Focused regression tests for the README GIF palette."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import unittest

from PIL import Image


SCRIPT = Path(__file__).with_name("capture-readme-demo.py")
SPEC = spec_from_file_location("capture_readme_demo", SCRIPT)
assert SPEC and SPEC.loader
MODULE = module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SharedPaletteTest(unittest.TestCase):
    def test_frames_share_palette_and_keep_brand_colors_exact(self):
        first = Image.new("RGB", (16, 8), "#111820")
        second = Image.new("RGB", (16, 8), "#f7f9fc")
        first.paste("#bdf878", (0, 0, 8, 8))
        second.paste("#2863df", (0, 0, 8, 8))

        palette = MODULE.build_shared_palette([first, second])
        frames = MODULE.quantize_with_shared_palette([first, second], palette)

        self.assertEqual(frames[0].getpalette(), frames[1].getpalette())
        self.assertEqual(frames[0].convert("RGB").getpixel((2, 2)), (189, 248, 120))
        self.assertEqual(frames[1].convert("RGB").getpixel((2, 2)), (40, 99, 223))
        self.assertEqual(len(palette.getpalette()), 256 * 3)
        self.assertEqual(tuple(palette.getpalette()[:3]), (8, 16, 22))


if __name__ == "__main__":
    unittest.main()
