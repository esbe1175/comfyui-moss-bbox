const COLORS = ["#7bdcb5", "#b5a1f4", "#f5b971", "#79c8ef", "#f28eab", "#e0db80"];
const MAX_RATIO_UNIT = BigInt(Number.MAX_SAFE_INTEGER);

export function createState() {
    return { version: 1, width: 1024, height: 1024, scene: "", image: null, regions: [] };
}

export function parseState(json) {
    const state = JSON.parse(json);
    if (!state || typeof state !== "object" || Array.isArray(state)) {
        throw new Error("The layout must be an object.");
    }
    return { ...createState(), ...state };
}

export function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

function gcd(a, b) {
    while (b) [a, b] = [b, a % b];
    return a;
}

function ratioUnits(state) {
    const { width, height } = state;
    if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0)) {
        throw new Error("Aspect ratio sides must be positive integers.");
    }
    const divisor = gcd(width, height);
    return { width: width / divisor, height: height / divisor };
}

export function formatAspectRatio(state) {
    const { width, height } = ratioUnits(state);
    return `${width}:${height}`;
}

export function parseAspectRatio(value) {
    const match = typeof value === "string" && value.match(/^\s*(\d+(?:\.\d{1,9})?)\s*:\s*(\d+(?:\.\d{1,9})?)\s*(?:\([^()\r\n]*\))?\s*$/);
    if (!match) throw new Error("Enter an aspect ratio such as 3:2.");
    const decimal = (token) => {
        const [integer, fraction = ""] = token.split(".");
        return { numerator: BigInt(integer + fraction), scale: 10n ** BigInt(fraction.length) };
    };
    const left = decimal(match[1]);
    const right = decimal(match[2]);
    let width = left.numerator * right.scale;
    let height = right.numerator * left.scale;
    if (width <= 0n || height <= 0n) throw new Error("Aspect ratio sides must be positive.");
    const divisor = gcd(width, height);
    width /= divisor;
    height /= divisor;
    if (width > MAX_RATIO_UNIT || height > MAX_RATIO_UNIT) throw new Error("Aspect ratio is too precise.");
    return { width: Number(width), height: Number(height) };
}

export function setAspectRatio(state, value) {
    Object.assign(state, parseAspectRatio(value));
    return state;
}

// Match the Python round() used by ComfyUI's aspect ratio dimensions.
function roundEven(value) {
    const lower = Math.floor(value);
    const fraction = value - lower;
    return fraction === 0.5 ? lower + lower % 2 : Math.round(value);
}

export function resolveDimensions(state, megapixels = 1) {
    const { width, height } = ratioUnits(state);
    if (typeof megapixels !== "number" || !Number.isFinite(megapixels) || megapixels <= 0) {
        throw new Error("Megapixels must be a positive number.");
    }
    const scale = Math.sqrt(megapixels * 1024 * 1024 / (width * height));
    const resolved = {
        width: Math.max(16, roundEven(width * scale / 16) * 16),
        height: Math.max(16, roundEven(height * scale / 16) * 16),
    };
    if (![resolved.width, resolved.height].every(Number.isFinite)) {
        throw new Error("Megapixels produce unsupported dimensions.");
    }
    return resolved;
}

export function moveBox(bbox, dx, dy) {
    const [left, top, right, bottom] = bbox;
    const x = clamp(dx, -left, 1 - right);
    const y = clamp(dy, -top, 1 - bottom);
    return [left + x, top + y, right + x, bottom + y];
}

export function resizeBox(bbox, handle, x, y, min = 0.002) {
    let [left, top, right, bottom] = bbox;
    if (handle.includes("w")) left = clamp(x, 0, Math.max(0, right - min));
    if (handle.includes("e")) right = clamp(x, Math.min(1, left + min), 1);
    if (handle.includes("n")) top = clamp(y, 0, Math.max(0, bottom - min));
    if (handle.includes("s")) bottom = clamp(y, Math.min(1, top + min), 1);
    return [left, top, right, bottom];
}

export function addRegion(state, bbox, label = "object") {
    const region = { id: crypto.randomUUID(), label, caption: "", text: "", bbox: [...bbox] };
    state.regions.push(region);
    return region;
}

export function colorFor(index) {
    return COLORS[index % COLORS.length];
}

function promptMetadata(source, location, listFields, withCanvas = false) {
    if (source === undefined) return {};
    if (!source || typeof source !== "object" || Array.isArray(source)) {
        throw new Error(`${location} metadata must be an object.`);
    }
    const metadata = {};
    for (const key of listFields) {
        if (!Object.hasOwn(source, key)) continue;
        if (!Array.isArray(source[key]) || !source[key].every((value) => typeof value === "string")) {
            throw new Error(`${location} ${key} must be a list of text values.`);
        }
        metadata[key] = [...source[key]];
    }
    if (withCanvas && Object.hasOwn(source, "canvas")) {
        if (typeof source.canvas !== "string") throw new Error(`${location} canvas must be text.`);
        metadata.canvas = source.canvas;
    }
    return metadata;
}

export function compilePrompt(state, megapixels = 1) {
    const { width, height } = resolveDimensions(state, megapixels);
    const scene = state.scene.trim();
    const summaryMetadata = promptMetadata(state.summary, "Scene", ["meta", "palette"], true);
    const pixel = (value, dimension) => Number((value * dimension).toFixed(9));
    const items = state.regions.flatMap((region) => {
        const metadata = promptMetadata(region, "Box", ["tags", "palette"]);
        if (Object.hasOwn(region, "muted") && typeof region.muted !== "boolean") {
            throw new Error("Box mute must be true or false.");
        }
        if (region.muted === true) return [];
        const text = region.text || "";
        const caption = region.caption.trim() || (region.label === "text" && text.trim() ? "Text lettering." : "");
        if (!caption) return [];
        const [left, top, right, bottom] = region.bbox;
        const item = {
            label: region.label,
            caption,
            bbox: [
                Math.floor(pixel(top, height)) - height / 2,
                Math.floor(pixel(left, width)) - width / 2,
                Math.ceil(pixel(bottom, height)) - height / 2,
                Math.ceil(pixel(right, width)) - width / 2,
            ],
        };
        Object.assign(item, metadata);
        if (region.label === "text" || text) item.text = text;
        return [item];
    });
    if (!items.length && !Object.keys(summaryMetadata).length) return scene;
    return JSON.stringify({
        summary: { caption: scene || "An image.", ...summaryMetadata },
        items,
        bbox_coord_space: "abs_centralized",
        bbox_format: "yxyx",
    });
}
