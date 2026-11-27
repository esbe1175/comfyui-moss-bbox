import assert from "node:assert/strict";
import test from "node:test";
import { addRegion, compilePrompt, createState } from "../web/state.js";
import {
    assignGroup, createGroup, duplicateRegions, ensureGroups, groupRegionIds,
    moveRegions, removeGroup, resizeRegions, selectionBounds,
} from "../web/groups.js";

const rounded = (box) => box.map((value) => Math.round(value * 1e9) / 1e9);
const fixture = () => {
    const state = createState();
    const first = addRegion(state, [0.1, 0.2, 0.3, 0.4]);
    const middle = addRegion(state, [0.6, 0.1, 0.7, 0.2]);
    const last = addRegion(state, [0.4, 0.5, 0.8, 0.9]);
    [first, middle, last].forEach((region, index) => { region.caption = `Object ${index + 1}.`; });
    return { state, first, middle, last };
};

test("folders initialize legacy layouts without replacing existing metadata", () => {
    const state = { regions: [] };
    const groups = ensureGroups(state);
    assert.deepEqual(groups, []);
    assert.strictEqual(state.groups, groups);
    const existing = { id: "kept", name: "Furniture", collapsed: true, custom: { keep: true } };
    groups.push(existing);
    assert.strictEqual(ensureGroups(state), groups);
    assert.strictEqual(state.groups[0], existing);
    assert.throws(() => ensureGroups({ groups: "Furniture" }), /list/);
});

test("grouping and assignment preserve all boxes and prompt authoring order", () => {
    const { state, first, middle, last } = fixture();
    const order = state.regions.map((region) => region.id);
    const prompt = compilePrompt(state);
    const group = createGroup(state, [last.id, first.id], "  Subject  ");
    assert.deepEqual(group, { id: group.id, name: "Subject", collapsed: false });
    assert.deepEqual(groupRegionIds(state, group.id), [first.id, last.id]);
    assert.equal(middle.groupId, undefined);
    assert.deepEqual(state.regions.map((region) => region.id), order);
    assert.equal(compilePrompt(state), prompt);
    assert.strictEqual(state.regions[0], first);
    assignGroup(state, [middle.id], group.id);
    assert.deepEqual(groupRegionIds(state, group.id), order);
    assignGroup(state, [first.id], null);
    assert.equal(Object.hasOwn(first, "groupId"), false);
    assert.deepEqual(groupRegionIds(state, group.id), [middle.id, last.id]);
    assert.throws(() => assignGroup(state, order, "missing"), /no longer exists/);
    assert.equal(first.groupId, undefined);
    assert.equal(middle.groupId, group.id);
});

test("deleting a folder ungroups its contents and keeps every box intact", () => {
    const { state, first, middle, last } = fixture();
    const firstGroup = createGroup(state, [first.id, last.id], "Subject");
    const otherGroup = createGroup(state, [middle.id], "Background");
    const boxes = state.regions.map((region) => [...region.bbox]);
    const order = state.regions.map((region) => region.id);
    assert.deepEqual(removeGroup(state, firstGroup.id), [first, last]);
    assert.deepEqual(state.groups, [otherGroup]);
    assert.deepEqual(state.regions.map((region) => region.id), order);
    assert.deepEqual(state.regions.map((region) => region.bbox), boxes);
    assert.equal(first.groupId, undefined);
    assert.equal(last.groupId, undefined);
    assert.equal(middle.groupId, otherGroup.id);
    assert.deepEqual(removeGroup(state, "missing"), []);
});

test("selection bounds include nonadjacent boxes without changing selection or region order", () => {
    const { state, first, middle, last } = fixture();
    const ids = new Set([last.id, first.id, "missing"]);
    assert.deepEqual(selectionBounds(state, ids), [0.1, 0.2, 0.8, 0.9]);
    assert.deepEqual(selectionBounds(state, middle.id), middle.bbox);
    assert.notStrictEqual(selectionBounds(state, middle.id), middle.bbox);
    assert.equal(selectionBounds(state, ["missing"]), null);
    assert.equal(selectionBounds(state, []), null);
    assert.deepEqual([...ids], [last.id, first.id, "missing"]);
    assert.deepEqual(state.regions, [first, middle, last]);
});

test("moving several boxes clamps them as a unit and preserves their sizes and spacing", () => {
    for (const [dx, dy, expectedFirst, expectedLast] of [
        [4, 4, [0.3, 0.3, 0.5, 0.5], [0.6, 0.6, 1, 1]],
        [-4, -4, [0, 0, 0.2, 0.2], [0.3, 0.3, 0.7, 0.7]],
        [0.05, -0.05, [0.15, 0.15, 0.35, 0.35], [0.45, 0.45, 0.85, 0.85]],
    ]) {
        const { state, first, middle, last } = fixture();
        const middleBox = [...middle.bbox];
        const group = createGroup(state, [first.id, last.id]);
        const moved = moveRegions(state, groupRegionIds(state, group.id), dx, dy);
        assert.deepEqual(moved, [first, last]);
        assert.deepEqual(rounded(first.bbox), expectedFirst);
        assert.deepEqual(rounded(last.bbox), expectedLast);
        assert.deepEqual(middle.bbox, middleBox);
        assert.equal(rounded([last.bbox[0] - first.bbox[0]])[0], 0.3);
        assert.equal(rounded([last.bbox[1] - first.bbox[1]])[0], 0.3);
        assert.deepEqual(state.regions, [first, middle, last]);
    }
});

test("a full-canvas group cannot shift or distort", () => {
    const state = createState();
    const left = addRegion(state, [0, 0, 0.2, 0.3]);
    const right = addRegion(state, [0.8, 0.7, 1, 1]);
    const before = structuredClone(state.regions);
    moveRegions(state, [left.id, right.id], 0.5, -0.5);
    assert.deepEqual(state.regions, before);
    assert.deepEqual(moveRegions(state, [], 1, 1), []);
    assert.throws(() => moveRegions(state, [left.id], NaN, 0), /Movement/);
    assert.deepEqual(state.regions, before);
});

test("duplicating a folder preserves descriptions, group membership, topology and original order", () => {
    const { state, first, middle, last } = fixture();
    first.details = { notes: ["Keep this metadata"] };
    const group = createGroup(state, [first.id, last.id], "Figure");
    const originals = structuredClone(state.regions);
    const copies = duplicateRegions(state, [last.id, first.id, first.id]);
    assert.equal(copies.length, 2);
    assert.deepEqual(state.regions.slice(0, 3), originals);
    assert.strictEqual(state.regions[1], middle);
    assert.deepEqual(state.regions.slice(3), copies);
    assert.deepEqual(copies.map((region) => region.caption), [first.caption, last.caption]);
    assert.deepEqual(copies.map((region) => rounded(region.bbox)), [[0.125, 0.225, 0.325, 0.425], [0.425, 0.525, 0.825, 0.925]]);
    assert.deepEqual(copies.map((region) => region.groupId), [group.id, group.id]);
    assert.equal(new Set(state.regions.map((region) => region.id)).size, 5);
    assert.notStrictEqual(copies[0].bbox, first.bbox);
    assert.notStrictEqual(copies[0].details, first.details);
    copies[0].details.notes.push("New note");
    assert.deepEqual(first.details.notes, ["Keep this metadata"]);
    assert.equal(state.groups.length, 1);
});

test("duplicates near an edge use the same clamped offset for every selected box", () => {
    const state = createState();
    const first = addRegion(state, [0.5, 0.5, 0.7, 0.6]);
    const second = addRegion(state, [0.8, 0.7, 0.99, 1]);
    const copies = duplicateRegions(state, [first.id, second.id]);
    assert.deepEqual(copies.map((region) => rounded(region.bbox)), [[0.51, 0.5, 0.71, 0.6], [0.81, 0.7, 1, 1]]);
    assert.deepEqual(duplicateRegions(state, ["missing"]), []);
});


test("resizing a selection maps every member proportionally without reordering or changing metadata", () => {
    const { state, first, middle, last } = fixture();
    const group = createGroup(state, [first.id, last.id], "Furniture");
    first.tags = ["wood"];
    first.details = { custom: true };
    const metadata = first.details;
    const untouched = structuredClone(middle);
    const bounds = selectionBounds(state, [last.id, first.id]);
    const target = [0.05, 0.1, 0.4, 0.8];
    const resized = resizeRegions(state, new Set([last.id, first.id]), bounds, target);
    assert.deepEqual(resized, [first, last]);
    assert.deepEqual(rounded(first.bbox), [0.05, 0.1, 0.15, 0.3]);
    assert.deepEqual(rounded(last.bbox), [0.2, 0.4, 0.4, 0.8]);
    assert.deepEqual(selectionBounds(state, [first.id, last.id]).map(value => Number(value.toFixed(9))), target);
    assert.deepEqual(middle, untouched);
    assert.deepEqual(state.regions, [first, middle, last]);
    assert.equal(first.groupId, group.id);
    assert.equal(last.groupId, group.id);
    assert.deepEqual(first.tags, ["wood"]);
    assert.strictEqual(first.details, metadata);
    assert.equal(first.caption, "Object 1.");
    assert.deepEqual(state.groups, [group]);
    assert.deepEqual(bounds, [0.1, 0.2, 0.8, 0.9]);
    assert.deepEqual(target, [0.05, 0.1, 0.4, 0.8]);
});

test("group resize clamps the new union to the canvas before transforming its contents", () => {
    const state = createState();
    const first = addRegion(state, [0.1, 0.1, 0.2, 0.2]);
    const second = addRegion(state, [0.4, 0.3, 0.5, 0.4]);
    const bounds = selectionBounds(state, [first.id, second.id]);
    resizeRegions(state, [first.id, second.id], bounds, [-0.5, -0.5, 1.5, 1.5]);
    assert.deepEqual(rounded(first.bbox), rounded([0, 0, 0.25, 1 / 3]));
    assert.deepEqual(rounded(second.bbox), rounded([0.75, 2 / 3, 1, 1]));
    assert.deepEqual(selectionBounds(state, [first.id, second.id]), [0, 0, 1, 1]);
});

test("resizing from restored drag snapshots avoids cumulative rounding and preserves the starting layout", () => {
    const { state, first, last } = fixture();
    const original = structuredClone(state);
    const ids = [first.id, last.id];
    const bounds = selectionBounds(state, ids);
    const intermediate = structuredClone(original);
    resizeRegions(intermediate, ids, bounds, [0, 0, 1, 1]);
    const nextFrame = structuredClone(original);
    resizeRegions(nextFrame, ids, bounds, [0.2, 0.1, 0.9, 0.45]);
    assert.deepEqual(rounded(nextFrame.regions[0].bbox), [0.2, 0.1, 0.4, 0.2]);
    assert.deepEqual(rounded(nextFrame.regions[2].bbox), [0.5, 0.25, 0.9, 0.45]);
    assert.deepEqual(state, original);
});

test("invalid resize geometry and snapping failures leave every selected region unchanged", () => {
    const { state, first, last } = fixture();
    const before = structuredClone(state);
    const ids = [first.id, last.id];
    const bounds = selectionBounds(state, ids);
    assert.deepEqual(resizeRegions(state, [], null, null), []);
    assert.throws(() => resizeRegions(state, ids, [0, 0, 0, 1], [0, 0, 1, 1]), /positive width/);
    assert.throws(() => resizeRegions(state, ids, bounds, [0, 0, NaN, 1]), /four numbers/);
    assert.throws(() => resizeRegions(state, ids, bounds, [2, 0, 3, 1]), /positive width/);
    let calls = 0;
    assert.throws(() => resizeRegions(state, ids, bounds, [0, 0, 1, 1], { snapBox(box) {
        if (++calls === 2) throw new Error("Snap failed");
        return box;
    } }), /Snap failed/);
    assert.deepEqual(state, before);
    assert.throws(() => resizeRegions(state, ids, bounds, [0, 0, 1, 1], { snapBox: () => [0, 0, 0, 1] }), /positive width/);
    assert.deepEqual(state, before);
});
