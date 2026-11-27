import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import unittest


NODE_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(NODE_DIRECTORY.parents[1]))
SPEC = importlib.util.spec_from_file_location("moss_bbox_studio", NODE_DIRECTORY / "__init__.py")
NODE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = NODE
SPEC.loader.exec_module(NODE)


def layout(**changes):
    state = json.loads(NODE.DEFAULT_LAYOUT)
    state.update(changes)
    return json.dumps(state, ensure_ascii=False)


def region(**changes):
    item = {"id": "region-1", "label": "object", "caption": "An ivory ceramic cup.", "text": "", "bbox": [0.1, 0.2, 0.6, 0.8]}
    item.update(changes)
    return item


class PromptTests(unittest.TestCase):
    def test_rectangular_canvas_exports_centered_yxyx(self):
        prompt, aspect_ratio = NODE.compile_layout(layout(width=1536, height=1024, scene="A still life.", image="data:image/png;base64,ignored", regions=[region(bbox=[176 / 1536, 224 / 1024, 800 / 1536, 864 / 1024])]), megapixels=1.5)
        result = json.loads(prompt)
        self.assertEqual(aspect_ratio, "3:2")
        self.assertEqual(result, {
            "summary": {"caption": "A still life."},
            "items": [{"label": "object", "caption": "An ivory ceramic cup.", "bbox": [-288, -592, 352, 32]}],
            "bbox_coord_space": "abs_centralized",
            "bbox_format": "yxyx",
        })

    def test_fractional_edges_enclose_pixels(self):
        prompt, _ = NODE.compile_layout(layout(width=1536, height=1024, regions=[region(bbox=[176.2 / 1536, 224.8 / 1024, 799.1 / 1536, 863.2 / 1024])]), megapixels=1.5)
        self.assertEqual(json.loads(prompt)["items"][0]["bbox"], [-288, -592, 352, 32])

    def test_unicode_and_literal_line_breaks_survive(self):
        wording = "把日常，过成诗。\nÉté • 夏"
        prompt, _ = NODE.compile_layout(layout(regions=[region(label="text", caption="Dark-green brush lettering.", text=wording)]))
        self.assertEqual(json.loads(prompt)["items"][0]["text"], wording)
        self.assertIn("把日常", prompt)
        self.assertNotIn("\n", prompt)

    def test_no_regions_returns_plain_scene(self):
        self.assertEqual(NODE.compile_layout(layout(scene="  Warm side-lit portrait.  ")), ("Warm side-lit portrait.", "1:1"))
        self.assertEqual(NODE.compile_layout(NODE.DEFAULT_LAYOUT), ("", "1:1"))

    def test_blank_regions_are_omitted_and_text_only_is_retained(self):
        prompt, _ = NODE.compile_layout(layout(regions=[region(caption="   "), region(label="text", caption="", text="Hello")]))
        result = json.loads(prompt)
        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(result["items"][0]["caption"], "Text lettering.")
        self.assertEqual(result["items"][0]["text"], "Hello")
        plain, _ = NODE.compile_layout(layout(scene="A room.", regions=[region(caption=""), region(label="text", caption="", text="")]))
        self.assertEqual(plain, "A room.")

    def test_text_description_can_be_authored_before_its_wording(self):
        prompt, _ = NODE.compile_layout(layout(regions=[region(label="text", caption="Dark-green brush lettering.")]))
        self.assertEqual(json.loads(prompt)["items"][0]["text"], "")

    def test_overlapping_regions_and_order_are_preserved(self):
        regions = [region(id=str(index), caption=f"Object {index}.") for index in range(100)]
        prompt, _ = NODE.compile_layout(layout(regions=regions))
        self.assertEqual([item["caption"] for item in json.loads(prompt)["items"]], [item["caption"] for item in regions])

    def test_malformed_state_has_actionable_errors(self):
        cases = [
            ("{", "invalid JSON"),
            ("[]", "JSON object"),
            (layout(version=2), "version must be 1"),
            (layout(width=0), "width must be a positive integer"),
            (layout(height=True), "height must be a positive integer"),
            (layout(scene=None), "scene must be text"),
            (layout(regions={}), "regions must be an array"),
            (layout(regions=[None]), "region 1 must be an object"),
            (layout(regions=[region(label="background")]), "type must be"),
            (layout(regions=[region(caption=None)]), "must be strings"),
            (layout(regions=[region(bbox=[0, 0, 1])]), "four finite coordinates"),
            (layout(regions=[region(bbox=[0, 0, True, 1])]), "four finite coordinates"),
            (layout(regions=[region(bbox=[0, 0, float("nan"), 1])]), "four finite coordinates"),
            (layout(regions=[region(bbox=[-0.1, 0, 1, 1])]), "stay inside the canvas"),
            (layout(regions=[region(bbox=[0.5, 0, 0.5, 1])]), "positive area"),
        ]
        for value, error in cases:
            with self.subTest(error=error, value=value):
                with self.assertRaisesRegex(ValueError, error):
                    NODE.compile_layout(value)

    def test_v3_schema_and_execution(self):
        schema = NODE.MOSSBBoxStudio.define_schema()
        self.assertEqual(schema.node_id, "MOSSBBoxStudio")
        self.assertEqual([output.id for output in schema.outputs], ["prompt", "aspect_ratio"])
        self.assertEqual([item.id for item in schema.inputs], ["layout_json", "megapixels"])
        self.assertEqual(NODE.MOSSBBoxStudio.execute(NODE.DEFAULT_LAYOUT).result, ("", "1:1"))
        resolver_schema = NODE.MOSSAspectRatioResolution.define_schema()
        self.assertEqual(resolver_schema.node_id, "MOSSAspectRatioResolution")
        self.assertEqual([item.id for item in resolver_schema.inputs], ["aspect_ratio", "megapixels"])
        self.assertEqual([item.id for item in resolver_schema.outputs], ["width", "height"])
        self.assertEqual(NODE.MOSSAspectRatioResolution.execute("3:2", 1.5).result, (1536, 1024))
        self.assertEqual(asyncio.run(NODE.MOSSBBoxExtension().get_node_list()), [NODE.MOSSBBoxStudio, NODE.MOSSAspectRatioResolution])

    def test_source_image_dimensions_need_not_be_divisible_by_16(self):
        prompt, ratio = NODE.compile_layout(layout(width=1041, height=1301, regions=[region(bbox=[0, 0, 1, 1])]))
        width, height = NODE.MOSSAspectRatioResolution.execute(ratio, 1.0).result
        self.assertEqual(ratio, "1041:1301")
        self.assertEqual((width % 16, height % 16), (0, 0))
        self.assertEqual(json.loads(prompt)["items"][0]["bbox"], [-height // 2, -width // 2, height // 2, width // 2])

    def test_prompt_uses_same_megapixels_as_generation(self):
        state = layout(width=2, height=3, regions=[region(bbox=[0.25, 0.25, 0.75, 0.75])])
        for megapixels in (0.25, 1.0, 1.5, 4.0):
            with self.subTest(megapixels=megapixels):
                prompt, ratio = NODE.compile_layout(state, megapixels)
                width, height = NODE.MOSSAspectRatioResolution.execute(ratio, megapixels).result
                self.assertEqual(ratio, "2:3")
                self.assertEqual(json.loads(prompt)["items"][0]["bbox"], [-height // 4, -width // 4, height // 4, width // 4])

    def test_equivalent_source_sizes_preserve_normalized_geometry(self):
        regions = [region(bbox=[0.13, 0.27, 0.68, 0.89])]
        self.assertEqual(NODE.compile_layout(layout(width=2, height=3, regions=regions), 4.0), NODE.compile_layout(layout(width=1200, height=1800, regions=regions), 4.0))

    def test_invalid_megapixels_fail_before_compilation(self):
        for megapixels in (0, -1, True, "1", float("nan"), float("inf")):
            with self.subTest(megapixels=megapixels):
                with self.assertRaisesRegex(ValueError, "megapixels must be finite and positive"):
                    NODE.compile_layout(NODE.DEFAULT_LAYOUT, megapixels)


    def test_native_metadata_and_nontext_wording_survive_without_folder_metadata(self):
        summary = {"caption": "Stale caption", "meta": ["\u00c9t\u00e9", "ink"], "canvas": "custom_panorama", "palette": []}
        first = region(id="first", caption="A red sign.", text="\u4f60\u597d\nCAF\u00c9", tags=["painted", "\u590f"], palette=["red", "warm white"], groupId="folder")
        second = region(id="second", label="character", caption="A painter.", tags=[], palette=[], groupId="folder")
        prompt, _ = NODE.compile_layout(layout(scene="  A painted storefront.  ", summary=summary, groups=[{"id": "folder", "name": "Signs", "collapsed": True}], regions=[first, second]))
        result = json.loads(prompt)
        self.assertEqual(result["summary"], {"caption": "A painted storefront.", "meta": ["\u00c9t\u00e9", "ink"], "canvas": "custom_panorama", "palette": []})
        self.assertEqual([item["caption"] for item in result["items"]], ["A red sign.", "A painter."])
        self.assertEqual(result["items"][0]["text"], first["text"])
        self.assertEqual(result["items"][0]["tags"], first["tags"])
        self.assertEqual(result["items"][0]["palette"], first["palette"])
        self.assertEqual(result["items"][1]["tags"], [])
        self.assertEqual(result["items"][1]["palette"], [])
        self.assertNotIn("text", result["items"][1])
        self.assertNotIn("groups", result)
        self.assertNotIn("groupId", result["items"][0])
        self.assertNotIn("id", result["items"][0])
        self.assertIn("\u4f60\u597d", prompt)

    def test_scene_metadata_survives_without_described_boxes(self):
        prompt, _ = NODE.compile_layout(layout(scene="A collage.", summary={"meta": [], "canvas": "collage", "palette": ["\u9752"]}))
        result = json.loads(prompt)
        self.assertEqual(result["summary"], {"caption": "A collage.", "meta": [], "canvas": "collage", "palette": ["\u9752"]})
        self.assertEqual(result["items"], [])
        self.assertEqual(NODE.compile_layout(layout(scene="A collage.", summary={}))[0], "A collage.")

    def test_metadata_type_errors_name_the_field_to_correct(self):
        cases = [
            (layout(summary=None), "MOSS scene metadata must be an object"),
            (layout(summary={"meta": "ink"}), "MOSS scene meta must be a list of text"),
            (layout(summary={"palette": ["red", 1]}), "MOSS scene palette must be a list of text"),
            (layout(summary={"canvas": []}), "MOSS scene canvas must be text"),
            (layout(regions=[region(tags=[True])]), "MOSS region 1 tags must be a list of text"),
            (layout(regions=[region(palette="blue")]), "MOSS region 1 palette must be a list of text"),
        ]
        for value, error in cases:
            with self.subTest(error=error):
                with self.assertRaisesRegex(ValueError, error):
                    NODE.compile_layout(value)


    def test_muting_skips_output_and_unmuting_restores_original_order(self):
        source = json.loads(layout(scene="A storefront.", groups=[{"id": "signs", "name": "Signs", "collapsed": False}], regions=[
            region(id="first", caption="A red sign.", groupId="signs"),
            region(id="wording", label="text", caption="White lettering.", text="Open", muted=True, groupId="signs"),
            region(id="last", caption="A doorway.", muted=False),
        ]))
        encoded = json.dumps(source)
        prompt, _ = NODE.compile_layout(encoded)
        items = json.loads(prompt)["items"]
        self.assertEqual([item["caption"] for item in items], ["A red sign.", "A doorway."])
        self.assertTrue(all("muted" not in item for item in items))
        self.assertEqual(json.dumps(source), encoded)
        source["regions"][1]["muted"] = False
        prompt, _ = NODE.compile_layout(json.dumps(source))
        self.assertEqual([item["caption"] for item in json.loads(prompt)["items"]], ["A red sign.", "White lettering.", "A doorway."])
        self.assertEqual([item["id"] for item in source["regions"]], ["first", "wording", "last"])
        self.assertEqual(source["groups"], [{"id": "signs", "name": "Signs", "collapsed": False}])

    def test_all_muted_falls_back_to_scene_and_keeps_summary_metadata(self):
        regions = [region(label="text", caption="Lettering.", text="Title", muted=True)]
        self.assertEqual(NODE.compile_layout(layout(scene="  A studio.  ", regions=regions))[0], "A studio.")
        prompt, _ = NODE.compile_layout(layout(scene="A studio.", summary={"canvas": "collage", "palette": []}, regions=regions))
        self.assertEqual(json.loads(prompt), {
            "summary": {"caption": "A studio.", "canvas": "collage", "palette": []},
            "items": [], "bbox_coord_space": "abs_centralized", "bbox_format": "yxyx",
        })

    def test_mute_flags_must_be_actual_booleans(self):
        for value in ("true", "false", 1, 0, None, [], {}):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "MOSS region 1 mute must be true or false"):
                    NODE.compile_layout(layout(regions=[region(muted=value)]))


if __name__ == "__main__":
    unittest.main()
