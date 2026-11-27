import json
import math

from comfy_api.latest import ComfyExtension, io

from .resolution import aspect_ratio_string, resolve_dimensions


WEB_DIRECTORY = "./web"
DEFAULT_LAYOUT = '{"version":1,"width":1024,"height":1024,"scene":"","image":null,"regions":[]}'


def _prompt_metadata(source, location: str, list_fields: tuple[str, ...], with_canvas: bool = False) -> dict:
    if not isinstance(source, dict):
        raise ValueError(f"{location} metadata must be an object.")
    metadata = {}
    for key in list_fields:
        if key not in source:
            continue
        if not isinstance(source[key], list) or any(not isinstance(value, str) for value in source[key]):
            raise ValueError(f"{location} {key} must be a list of text values.")
        metadata[key] = source[key].copy()
    if with_canvas and "canvas" in source:
        if not isinstance(source["canvas"], str):
            raise ValueError(f"{location} canvas must be text.")
        metadata["canvas"] = source["canvas"]
    return metadata


def compile_layout(layout_json: str, megapixels: float = 1.0) -> tuple[str, str]:
    if not isinstance(layout_json, str):
        raise ValueError("MOSS layout must be a JSON string.")
    try:
        layout = json.loads(layout_json)
    except json.JSONDecodeError as error:
        raise ValueError(f"MOSS layout contains invalid JSON: {error.msg}.") from error
    if not isinstance(layout, dict):
        raise ValueError("MOSS layout must be a JSON object.")
    if type(layout.get("version")) is not int or layout["version"] != 1:
        raise ValueError("MOSS layout version must be 1.")

    source_width, source_height = layout.get("width"), layout.get("height")
    for name, value in (("width", source_width), ("height", source_height)):
        if type(value) is not int or value <= 0:
            raise ValueError(f"MOSS layout {name} must be a positive integer.")
    aspect_ratio = aspect_ratio_string(source_width, source_height)
    width, height = resolve_dimensions(aspect_ratio, megapixels)
    scene = layout.get("scene")
    if not isinstance(scene, str):
        raise ValueError("MOSS layout scene must be text.")
    regions = layout.get("regions")
    if not isinstance(regions, list):
        raise ValueError("MOSS layout regions must be an array.")

    summary_metadata = _prompt_metadata(layout.get("summary", {}), "MOSS scene", ("meta", "palette"), with_canvas=True)
    items = []
    for index, region in enumerate(regions, 1):
        location = f"MOSS region {index}"
        if not isinstance(region, dict):
            raise ValueError(f"{location} must be an object.")
        if "muted" in region and type(region["muted"]) is not bool:
            raise ValueError(f"{location} mute must be true or false.")
        label = region.get("label")
        if label not in ("object", "character", "text"):
            raise ValueError(f"{location} type must be object, character, or text.")
        metadata = _prompt_metadata(region, location, ("tags", "palette"))
        caption, wording = region.get("caption", ""), region.get("text", "")
        if not isinstance(caption, str) or not isinstance(wording, str):
            raise ValueError(f"{location} description and text must be strings.")
        box = region.get("bbox")
        if not isinstance(box, list) or len(box) != 4 or any(type(value) not in (int, float) or not math.isfinite(value) for value in box):
            raise ValueError(f"{location} box must contain four finite coordinates.")
        x0, y0, x1, y1 = box
        if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
            raise ValueError(f"{location} box must have positive area and stay inside the canvas (0-1).")

        if region.get("muted", False):
            continue
        caption = caption.strip()
        if not caption and not (label == "text" and wording.strip()):
            continue
        item = {
            "label": label,
            "caption": caption or "Text lettering.",
            "bbox": [
                math.floor(round(y0 * height, 9)) - height // 2,
                math.floor(round(x0 * width, 9)) - width // 2,
                math.ceil(round(y1 * height, 9)) - height // 2,
                math.ceil(round(x1 * width, 9)) - width // 2,
            ],
        }
        item.update(metadata)
        if label == "text" or wording:
            item["text"] = wording
        items.append(item)

    if not items and not summary_metadata:
        return scene.strip(), aspect_ratio
    prompt = {
        "summary": {"caption": scene.strip() or "An image.", **summary_metadata},
        "items": items,
        "bbox_coord_space": "abs_centralized",
        "bbox_format": "yxyx",
    }
    return json.dumps(prompt, ensure_ascii=False, separators=(",", ":"), allow_nan=False), aspect_ratio


class MOSSBBoxStudio(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="MOSSBBoxStudio",
            display_name="MOSS-Image BBOX editor",
            category="model/conditioning/moss_image",
            description="Draw and describe regions to create a MOSS-Image layout prompt and aspect ratio.",
            inputs=[
                io.String.Input("layout_json", default=DEFAULT_LAYOUT, multiline=False, dynamic_prompts=False, socketless=True),
                io.Float.Input("megapixels", default=1.0, min=0.01, max=16.0, step=0.25, tooltip="Match the workflow megapixels to keep boxes aligned."),
            ],
            outputs=[io.String.Output("prompt"), io.String.Output("aspect_ratio")],
        )

    @classmethod
    def execute(cls, layout_json: str, megapixels: float = 1.0) -> io.NodeOutput:
        return io.NodeOutput(*compile_layout(layout_json, megapixels))


class MOSSAspectRatioResolution(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="MOSSAspectRatioResolution",
            display_name="MOSS Aspect Ratio Resolution",
            category="model/conditioning/moss_image",
            description="Convert any positive W:H aspect ratio to MOSS-Image dimensions aligned to 16 pixels.",
            inputs=[
                io.String.Input("aspect_ratio", default="1:1", tooltip="Any positive W:H ratio, including decimal values."),
                io.Float.Input("megapixels", default=1.0, min=0.01, max=16.0, step=0.25, tooltip="Target image area. Match MOSS-Image BBOX editor."),
            ],
            outputs=[io.Int.Output("width"), io.Int.Output("height")],
        )

    @classmethod
    def execute(cls, aspect_ratio: str, megapixels: float = 1.0) -> io.NodeOutput:
        return io.NodeOutput(*resolve_dimensions(aspect_ratio, megapixels))


class MOSSBBoxExtension(ComfyExtension):
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [MOSSBBoxStudio, MOSSAspectRatioResolution]


async def comfy_entrypoint() -> MOSSBBoxExtension:
    return MOSSBBoxExtension()
