// Folders and selection only affect editing. Regions keep their authoring order.
export function ensureGroups(state) {
    if (state.groups == null) state.groups = [];
    if (!Array.isArray(state.groups)) throw new Error("Folders must be a list.");
    return state.groups;
}

function selectedRegions(state, ids) {
    const selected = new Set(typeof ids === "string" ? [ids] : ids || []);
    return state.regions.filter((region) => selected.has(region.id));
}

function boundsOf(regions) {
    if (!regions.length) return null;
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    for (const region of regions) {
        const box = region.bbox;
        if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) {
            throw new Error("Box coordinates must be four numbers.");
        }
        bounds[0] = Math.min(bounds[0], box[0]);
        bounds[1] = Math.min(bounds[1], box[1]);
        bounds[2] = Math.max(bounds[2], box[2]);
        bounds[3] = Math.max(bounds[3], box[3]);
    }
    return bounds;
}

function clampedOffset(bounds, dx, dy) {
    if (![dx, dy].every(Number.isFinite)) throw new Error("Movement must be two numbers.");
    return [
        Math.min(1 - bounds[2], Math.max(-bounds[0], dx)),
        Math.min(1 - bounds[3], Math.max(-bounds[1], dy)),
    ];
}

function translate(regions, dx, dy) {
    for (const region of regions) {
        const [left, top, right, bottom] = region.bbox;
        region.bbox = [left + dx, top + dy, right + dx, bottom + dy];
    }
    return regions;
}

export function createGroup(state, ids, name = "Folder") {
    const groups = ensureGroups(state);
    const group = { id: crypto.randomUUID(), name: String(name).trim() || "Folder", collapsed: false };
    groups.push(group);
    assignGroup(state, ids, group.id);
    return group;
}

export function removeGroup(state, id) {
    const groups = ensureGroups(state);
    const index = groups.findIndex((group) => group.id === id);
    const regions = state.regions.filter((region) => region.groupId === id);
    if (index !== -1) groups.splice(index, 1);
    for (const region of regions) delete region.groupId;
    return regions;
}

export function assignGroup(state, ids, groupId = null) {
    const groups = ensureGroups(state);
    if (groupId != null && !groups.some((group) => group.id === groupId)) {
        throw new Error("That folder no longer exists.");
    }
    const regions = selectedRegions(state, ids);
    for (const region of regions) {
        if (groupId == null) delete region.groupId;
        else region.groupId = groupId;
    }
    return regions;
}

export function groupRegionIds(state, groupId) {
    return state.regions.filter((region) => region.groupId === groupId).map((region) => region.id);
}

export function selectionBounds(state, ids) {
    return boundsOf(selectedRegions(state, ids));
}

export function moveRegions(state, ids, dx, dy) {
    const regions = selectedRegions(state, ids);
    const bounds = boundsOf(regions);
    if (!bounds) return regions;
    const [x, y] = clampedOffset(bounds, dx, dy);
    return translate(regions, x, y);
}

function resizeBounds(bounds) {
    if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) {
        throw new Error("Selection bounds must be four numbers.");
    }
    if (bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) {
        throw new Error("Selection bounds must have positive width and height.");
    }
    return bounds;
}

// Call with the original region geometry on every drag update, not the previous result.
export function resizeRegions(state, ids, originalBounds, nextBounds, { snapBox } = {}) {
    const regions = selectedRegions(state, ids);
    if (!regions.length) return regions;
    const [left, top, right, bottom] = resizeBounds(originalBounds);
    const target = resizeBounds(resizeBounds(nextBounds).map((value) => Math.min(1, Math.max(0, value))));
    const scaleX = (target[2] - target[0]) / (right - left);
    const scaleY = (target[3] - target[1]) / (bottom - top);
    const boxes = regions.map((region) => {
        const [x0, y0, x1, y1] = resizeBounds(region.bbox);
        let box = [
            target[0] + (x0 - left) * scaleX,
            target[1] + (y0 - top) * scaleY,
            target[0] + (x1 - left) * scaleX,
            target[1] + (y1 - top) * scaleY,
        ];
        if (snapBox) box = snapBox(box);
        return resizeBounds(resizeBounds(box).map((value) => Math.min(1, Math.max(0, value))));
    });
    regions.forEach((region, index) => { region.bbox = boxes[index]; });
    return regions;
}
export function duplicateRegions(state, ids) {
    return pasteRegions(state, selectedRegions(state, ids));
}

export function pasteRegions(state, regions) {
    const bounds = boundsOf(regions);
    if (!bounds) return [];
    const [dx, dy] = clampedOffset(bounds, 0.025, 0.025);
    const copies = regions.map((region) => ({ ...structuredClone(region), id: crypto.randomUUID() }));
    translate(copies, dx, dy);
    state.regions.push(...copies);
    return copies;
}
