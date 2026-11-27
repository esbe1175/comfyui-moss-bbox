import math
import re


_NUMBER = r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?"
_ASPECT_RATIO = re.compile(rf"\s*({_NUMBER})\s*:\s*({_NUMBER})\s*(?:\([^()\r\n]*\))?\s*")


def parse_aspect_ratio(aspect_ratio: str) -> tuple[float, float]:
    match = _ASPECT_RATIO.fullmatch(aspect_ratio) if isinstance(aspect_ratio, str) else None
    if match is None:
        raise ValueError("MOSS aspect ratio must be positive numbers in W:H format.")
    width, height = map(float, match.groups())
    if not all(math.isfinite(value) and value > 0 for value in (width, height)):
        raise ValueError("MOSS aspect ratio sides must be finite and positive.")
    return width, height


def aspect_ratio_string(width: int, height: int) -> str:
    divisor = math.gcd(width, height)
    return f"{width // divisor}:{height // divisor}"


def resolve_dimensions(aspect_ratio: str, megapixels: float = 1.0) -> tuple[int, int]:
    width_ratio, height_ratio = parse_aspect_ratio(aspect_ratio)
    if type(megapixels) not in (int, float) or not math.isfinite(megapixels) or megapixels <= 0:
        raise ValueError("MOSS megapixels must be finite and positive.")
    scale = math.sqrt(megapixels * 1024 * 1024 / (width_ratio * height_ratio))
    return tuple(max(16, round(side * scale / 16) * 16) for side in (width_ratio, height_ratio))
