import importlib.util
from pathlib import Path
import sys
import unittest


NODE_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(NODE_DIRECTORY.parents[1]))
SPEC = importlib.util.spec_from_file_location("moss_bbox_resolution", NODE_DIRECTORY / "resolution.py")
RESOLUTION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RESOLUTION)

from comfy_extras.nodes_resolution import ASPECT_RATIOS, ResolutionSelector


class ResolutionTests(unittest.TestCase):
    def test_accepts_custom_and_labeled_ratios(self):
        cases = {
            "1:1": (1, 1),
            " 2 : 3 (Portrait Photo) ": (2, 3),
            "1.5:1": (1.5, 1),
            ".75:1": (0.75, 1),
            "1041:1301": (1041, 1301),
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(RESOLUTION.parse_aspect_ratio(text), expected)
        self.assertEqual(RESOLUTION.aspect_ratio_string(1536, 1024), "3:2")
        self.assertEqual(RESOLUTION.resolve_dimensions("1.5:1"), RESOLUTION.resolve_dimensions("3:2"))

    def test_rejects_invalid_ratio_values(self):
        for text in (None, True, 1.5, "", "square", "16/9", "1:1:1", "1:1 garbage", "0:1", "-1:1", "1:nan", "1:inf", "1:1e999"):
            with self.subTest(text=text):
                with self.assertRaisesRegex(ValueError, "aspect ratio"):
                    RESOLUTION.parse_aspect_ratio(text)

    def test_matches_core_presets_at_multiple_16(self):
        for ratio in ASPECT_RATIOS:
            for megapixels in (0.25, 1.0, 1.5, 2.0, 4.0):
                with self.subTest(ratio=ratio, megapixels=megapixels):
                    self.assertEqual(RESOLUTION.resolve_dimensions(ratio, megapixels), ResolutionSelector.execute(ratio, megapixels, 16).result)

    def test_custom_resolutions_are_positive_multiples_of_16(self):
        for ratio in ("7:5", "1041:1301", "19.5:10", "1:100", "100:1"):
            with self.subTest(ratio=ratio):
                width, height = RESOLUTION.resolve_dimensions(ratio, 1.5)
                self.assertGreaterEqual(width, 16)
                self.assertGreaterEqual(height, 16)
                self.assertEqual((width % 16, height % 16), (0, 0))

    def test_rounding_matches_python_ties_even(self):
        self.assertEqual(RESOLUTION.resolve_dimensions("1:1", (1000 / 1024) ** 2), (992, 992))

    def test_megapixels_must_be_finite_positive_numbers(self):
        for megapixels in (0, -1, True, "1", None, float("nan"), float("inf")):
            with self.subTest(megapixels=megapixels):
                with self.assertRaisesRegex(ValueError, "megapixels"):
                    RESOLUTION.resolve_dimensions("1:1", megapixels)


if __name__ == "__main__":
    unittest.main()
