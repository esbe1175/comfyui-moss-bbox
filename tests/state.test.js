import assert from "node:assert/strict";
import test from "node:test";
import {
    addRegion, clamp, colorFor, compilePrompt, createState, formatAspectRatio, moveBox,
    parseAspectRatio, parseState, resizeBox, resolveDimensions, setAspectRatio,
} from "../web/state.js";

const rounded = (box) => box.map((value) => Math.round(value * 1e9) / 1e9);

test("layouts restore descriptions, region identities and imported images", () => {
    const state = createState();
    const bbox = [0.1, 0.2, 0.4, 0.8];
    const region = addRegion(state, bbox);
    region.caption = "Woman in a linen coat.";
    state.scene = "A window-lit portrait.";
    state.image = { filename: "portrait.png", subfolder: "moss-bbox", type: "input" };
    const restored = parseState(JSON.stringify(state));
    assert.deepEqual(restored, state);
    assert.equal(restored.regions[0].id, region.id);
    assert.equal(restored.width, 1024);
    assert.deepEqual(createState().regions, []);
    assert.notStrictEqual(region.bbox, bbox);
    assert.notEqual(addRegion(state, bbox).id, region.id);
    assert.deepEqual(parseState('{"scene":"A room."}'), { ...createState(), scene: "A room." });
    assert.throws(() => parseState("{broken"), SyntaxError);
    assert.throws(() => parseState("null"), /object/);
    assert.throws(() => parseState("[]"), /object/);
});

test("aspect ratios reduce whole reference images without snapping their shape", () => {
    const state = { ...createState(), width: 1041, height: 1301 };
    assert.equal(formatAspectRatio(state), "1041:1301");
    assert.deepEqual(resolveDimensions(state), { width: 912, height: 1152 });
    assert.equal(formatAspectRatio({ width: 1536, height: 1024 }), "3:2");
    assert.deepEqual(parseAspectRatio(" 2:3 (Portrait Photo) "), { width: 2, height: 3 });
    assert.deepEqual(parseAspectRatio("1.5:1"), { width: 3, height: 2 });
    assert.deepEqual(parseAspectRatio("0.125 : 0.0625"), { width: 2, height: 1 });
    assert.deepEqual(parseAspectRatio("0003:0002"), { width: 3, height: 2 });
    assert.deepEqual(parseAspectRatio("0.000000001:0.000000002"), { width: 1, height: 2 });
});

test("changing the ratio preserves image, regions and descriptions", () => {
    const state = { ...createState(), width: 1041, height: 1301, scene: "A portrait." };
    state.image = { filename: "portrait.png", subfolder: "moss-bbox", type: "input" };
    addRegion(state, [0.1, 0.2, 0.8, 0.9]).caption = "A woman in a linen coat.";
    const image = state.image;
    const regions = structuredClone(state.regions);
    assert.strictEqual(setAspectRatio(state, "1.5:1 (Landscape)"), state);
    assert.equal(formatAspectRatio(state), "3:2");
    assert.strictEqual(state.image, image);
    assert.equal(state.scene, "A portrait.");
    assert.deepEqual(state.regions, regions);
});

test("legacy dimensions remain reference units and output dimensions follow megapixels", () => {
    const state = parseState('{"version":1,"width":1536,"height":1024,"scene":"A room.","image":null,"regions":[]}');
    assert.equal(state.width, 1536);
    assert.equal(state.height, 1024);
    assert.equal(formatAspectRatio(state), "3:2");
    assert.deepEqual(resolveDimensions(state, 1.5), { width: 1536, height: 1024 });
    assert.deepEqual(resolveDimensions(state), { width: 1248, height: 832 });
    assert.equal(state.width, 1536);
    assert.equal(state.height, 1024);
    assert.deepEqual(resolveDimensions({ width: 37, height: 19 }), { width: 1424, height: 736 });
});

test("native generation dimensions use ties-to-even rounding and a sixteen pixel minimum", () => {
    assert.deepEqual(resolveDimensions(createState(), 1000 ** 2 / 1024 ** 2), { width: 992, height: 992 });
    assert.deepEqual(resolveDimensions(createState(), 1016 ** 2 / 1024 ** 2), { width: 1024, height: 1024 });
    assert.deepEqual(resolveDimensions(createState(), 0.000001), { width: 16, height: 16 });
    for (const megapixels of [0, -1, Infinity, NaN, "1", true, null]) {
        assert.throws(() => resolveDimensions(createState(), megapixels), /Megapixels/);
    }
});

test("malformed or nonpositive aspect ratios fail without changing the layout", () => {
    const state = createState();
    for (const value of ["", "3", "3/2", "3:2:1", "0:1", "1:0", "-1:2", "1:NaN", "Infinity:1", "1:2 trailing", "1:2 (broken", "1:2 (a) (b)", "1.1234567891:1", "9007199254740992:1", null, 1]) {
        assert.throws(() => parseAspectRatio(value), /aspect ratio/i, String(value));
        assert.throws(() => setAspectRatio(state, value), /aspect ratio/i, String(value));
        assert.equal(formatAspectRatio(state), "1:1");
    }
    for (const value of [0, -1, 1.5, "3", true, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => formatAspectRatio({ width: value, height: 1 }), /positive integers/);
    }
});

test("prompt exports centered absolute yxyx pixels at the generation dimensions", () => {
    const state = { ...createState(), width: 3, height: 2, scene: "  A quiet room.  " };
    addRegion(state, [0.25, 0.125, 0.75, 0.875]).caption = "A green velvet sofa.";
    assert.equal(compilePrompt(state, 1.5), JSON.stringify({
        summary: { caption: "A quiet room." },
        items: [{ label: "object", caption: "A green velvet sofa.", bbox: [-384, -384, 384, 384] }],
        bbox_coord_space: "abs_centralized",
        bbox_format: "yxyx",
    }));
    assert.deepEqual(JSON.parse(compilePrompt(state, 6)).items[0].bbox, [-768, -768, 768, 768]);
    assert.equal(formatAspectRatio(state), "3:2");
});

test("nonmultiple source dimensions place boxes using the resolved canvas", () => {
    const state = { ...createState(), width: 1041, height: 1301 };
    addRegion(state, [0, 0, 1, 1]).caption = "A whole portrait.";
    assert.deepEqual(JSON.parse(compilePrompt(state)).items[0].bbox, [-576, -456, 576, 456]);
    assert.equal(formatAspectRatio(state), "1041:1301");
});

test("coordinate rounding contains fractional pixels without floating point edge drift", () => {
    const state = { ...createState(), width: 1008, height: 1024 };
    addRegion(state, [13 / 1008, 23.4 / 1024, 104 / 1008, 300.1 / 1024]).caption = "A vase.";
    const item = JSON.parse(compilePrompt(state, 1008 * 1024 / 1024 ** 2)).items[0];
    assert.deepEqual(item.bbox, [-489, -491, -211, -400]);
});

test("plain scenes stay plain until a region has a description", () => {
    const state = { ...createState(), scene: "  A room.  " };
    assert.equal(compilePrompt(state), "A room.");
    addRegion(state, [0, 0, 1, 1]);
    assert.equal(compilePrompt(state), "A room.");
    state.regions[0].caption = "  \n ";
    assert.equal(compilePrompt(state), "A room.");
    state.scene = "";
    state.regions[0].caption = "A carved chair.";
    assert.equal(JSON.parse(compilePrompt(state)).summary.caption, "An image.");
});

test("text regions preserve Unicode, quotation marks and newlines in native JSON", () => {
    const state = createState();
    const region = addRegion(state, [0.1, 0.2, 0.9, 0.4], "text");
    region.text = '  CAFÉ "ÉTÉ"\n你好  ';
    const prompt = compilePrompt(state);
    const item = JSON.parse(prompt).items[0];
    assert.equal(item.caption, "Text lettering.");
    assert.equal(item.text, region.text);
    assert.ok(prompt.includes("你好"));
    region.text = "";
    region.caption = "An empty neon sign.";
    assert.equal(JSON.parse(compilePrompt(state)).items[0].text, "");
});

test("moving preserves box size and clamps the complete box to the image", () => {
    const bbox = [0.2, 0.3, 0.6, 0.8];
    assert.deepEqual(rounded(moveBox(bbox, -3, -3)), [0, 0, 0.4, 0.5]);
    assert.deepEqual(rounded(moveBox(bbox, 3, 3)), [0.6, 0.5, 1, 1]);
    assert.deepEqual(rounded(moveBox(bbox, 0.1, -0.1)), [0.3, 0.2, 0.7, 0.7]);
    assert.deepEqual(bbox, [0.2, 0.3, 0.6, 0.8]);
});

test("each resize handle changes its own edges without inversion", () => {
    const bbox = [0.2, 0.3, 0.6, 0.8];
    const cases = [
        ["nw", 0.1, 0.1, [0.1, 0.1, 0.6, 0.8]],
        ["n", 0.9, 0.1, [0.2, 0.1, 0.6, 0.8]],
        ["ne", 0.7, 0.1, [0.2, 0.1, 0.7, 0.8]],
        ["e", 0.7, 0.9, [0.2, 0.3, 0.7, 0.8]],
        ["se", 0.7, 0.9, [0.2, 0.3, 0.7, 0.9]],
        ["s", 0.9, 0.9, [0.2, 0.3, 0.6, 0.9]],
        ["sw", 0.1, 0.9, [0.1, 0.3, 0.6, 0.9]],
        ["w", 0.1, 0.9, [0.1, 0.3, 0.6, 0.8]],
    ];
    for (const [handle, x, y, expected] of cases) {
        assert.deepEqual(rounded(resizeBox(bbox, handle, x, y)), expected);
    }
    assert.deepEqual(rounded(resizeBox(bbox, "nw", 1, 1, 0.1)), [0.5, 0.7, 0.6, 0.8]);
    assert.deepEqual(rounded(resizeBox(bbox, "se", -1, -1, 0.1)), [0.2, 0.3, 0.3, 0.4]);
    assert.deepEqual(resizeBox(bbox, "nw", -1, -1), [0, 0, 0.6, 0.8]);
    assert.deepEqual(resizeBox(bbox, "se", 3, 3), [0.2, 0.3, 1, 1]);
    assert.deepEqual(bbox, [0.2, 0.3, 0.6, 0.8]);
});

test("region colors repeat and numeric clamping respects its limits", () => {
    assert.equal(clamp(-4, 0, 1), 0);
    assert.equal(clamp(5, 0, 1), 1);
    assert.equal(colorFor(0), "#7bdcb5");
    assert.equal(colorFor(6), colorFor(0));
    assert.notEqual(colorFor(0), colorFor(1));
});

test("native metadata and wording survive compilation without folder metadata leaking", () => {
    const state = createState();
    state.scene = "  A painted storefront.  ";
    state.summary = { caption: "This stale caption must not win.", meta: ["\u00c9t\u00e9", "ink"], canvas: "custom_panorama", palette: [] };
    state.groups = [{ id: "folder", name: "Signs", collapsed: true }];
    const first = addRegion(state, [0.1, 0.2, 0.4, 0.8], "object");
    first.caption = "A red sign.";
    first.text = "\u4f60\u597d\nCAF\u00c9";
    first.tags = ["painted", "\u590f"];
    first.palette = ["red", "warm white"];
    first.groupId = "folder";
    const second = addRegion(state, [0.4, 0.2, 0.9, 0.8], "character");
    second.caption = "A painter.";
    second.tags = [];
    second.palette = [];
    const result = JSON.parse(compilePrompt(state));
    assert.deepEqual(result.summary, { caption: "A painted storefront.", meta: ["\u00c9t\u00e9", "ink"], palette: [], canvas: "custom_panorama" });
    assert.deepEqual(result.items.map((item) => item.caption), ["A red sign.", "A painter."]);
    assert.equal(result.items[0].text, first.text);
    assert.deepEqual(result.items[0].tags, first.tags);
    assert.deepEqual(result.items[0].palette, first.palette);
    assert.deepEqual(result.items[1].tags, []);
    assert.deepEqual(result.items[1].palette, []);
    assert.equal(Object.hasOwn(result.items[1], "text"), false);
    assert.equal(Object.hasOwn(result, "groups"), false);
    assert.equal(Object.hasOwn(result.items[0], "groupId"), false);
    assert.equal(Object.hasOwn(result.items[0], "id"), false);
    assert.ok(compilePrompt(state).includes("\u4f60\u597d"));
});

test("summary metadata survives even when a layout has no described boxes", () => {
    const state = createState();
    state.scene = "A collage.";
    state.summary = { meta: [], canvas: "collage", palette: ["\u9752"] };
    const result = JSON.parse(compilePrompt(state));
    assert.deepEqual(result.summary, { caption: "A collage.", meta: [], canvas: "collage", palette: ["\u9752"] });
    assert.deepEqual(result.items, []);
    state.summary = {};
    assert.equal(compilePrompt(state), "A collage.");
});

test("metadata type errors identify the field that needs correcting", () => {
    const state = createState();
    for (const [summary, message] of [[null, /Scene metadata.*object/], [{ meta: "ink" }, /Scene meta.*list of text/], [{ palette: ["red", 1] }, /Scene palette.*list of text/], [{ canvas: [] }, /Scene canvas.*text/]]) {
        state.summary = summary;
        assert.throws(() => compilePrompt(state), message);
    }
    delete state.summary;
    const region = addRegion(state, [0, 0, 1, 1]);
    region.caption = "A chair.";
    region.tags = [true];
    assert.throws(() => compilePrompt(state), /Box tags.*list of text/);
    delete region.tags;
    region.palette = "blue";
    assert.throws(() => compilePrompt(state), /Box palette.*list of text/);
});

test("muting boxes only removes them from output and unmuting restores their authoring order", () => {
    const state = createState();
    state.scene = "A storefront.";
    state.groups = [{ id: "signs", name: "Signs", collapsed: false }];
    const first = addRegion(state, [0, 0, 0.3, 0.3]);
    first.caption = "A red sign.";
    first.groupId = "signs";
    const wording = addRegion(state, [0.3, 0.3, 0.7, 0.7], "text");
    wording.caption = "White lettering.";
    wording.text = "Open";
    wording.muted = true;
    wording.groupId = "signs";
    const last = addRegion(state, [0.7, 0.7, 1, 1]);
    last.caption = "A doorway.";
    last.muted = false;
    const before = structuredClone(state);
    const result = JSON.parse(compilePrompt(state));
    assert.deepEqual(result.items.map((item) => item.caption), [first.caption, last.caption]);
    assert.equal(result.items.some((item) => Object.hasOwn(item, "muted")), false);
    assert.deepEqual(state, before);
    wording.muted = false;
    assert.deepEqual(JSON.parse(compilePrompt(state)).items.map((item) => item.caption), [first.caption, wording.caption, last.caption]);
    assert.deepEqual(state.regions.map((item) => item.id), before.regions.map((item) => item.id));
    assert.deepEqual(state.groups, before.groups);
});

test("all muted boxes fall back to scene output while retaining scene metadata", () => {
    const state = createState();
    state.scene = "  A studio.  ";
    const region = addRegion(state, [0, 0, 1, 1], "text");
    region.text = "A title";
    region.muted = true;
    assert.equal(compilePrompt(state), "A studio.");
    state.summary = { canvas: "collage", palette: [] };
    assert.deepEqual(JSON.parse(compilePrompt(state)), {
        summary: { caption: "A studio.", palette: [], canvas: "collage" },
        items: [], bbox_coord_space: "abs_centralized", bbox_format: "yxyx",
    });
});

test("mute flags must be actual booleans", () => {
    const state = createState();
    const region = addRegion(state, [0, 0, 1, 1]);
    region.caption = "A vase.";
    for (const value of ["true", "false", 1, 0, null, [], {}]) {
        region.muted = value;
        const before = structuredClone(state);
        assert.throws(() => compilePrompt(state), /Box mute must be true or false/);
        assert.deepEqual(state, before);
    }
});
