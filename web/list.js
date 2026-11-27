// Top-level folders and loose boxes share one order. Folder contents follow regions.
export function listEntries(state) {
    const groups = state.groups || [];
    const groupIds = new Set(groups.map((group) => group.id));
    const entries = [
        ...groups.map((group) => ({ id: group.id, kind: 'folder' })),
        ...state.regions.filter((region) => !groupIds.has(region.groupId))
            .map((region) => ({ id: region.id, kind: 'region' })),
    ];
    const remaining = new Map(entries.map((entry) => [entry.id, entry]));
    const ordered = [];
    for (const id of Array.isArray(state.listOrder) ? state.listOrder : []) {
        if (!remaining.has(id)) continue;
        ordered.push(remaining.get(id));
        remaining.delete(id);
    }
    return [...ordered, ...remaining.values()];
}

function structure(state) {
    return {
        entries: listEntries(state),
        children: new Map((state.groups || []).map((group) => [
            group.id, state.regions.filter((region) => region.groupId === group.id).map((region) => region.id),
        ])),
    };
}

function flatten({ entries, children }) {
    return entries.flatMap((entry) => entry.kind === 'folder' ? children.get(entry.id) : [entry.id]);
}

function sameIds(first, second) {
    return first.length === second.length && first.every((id, index) => id === second[index]);
}

function applyStructure(state, before, after) {
    if (sameIds(before.entries.map((entry) => entry.id), after.entries.map((entry) => entry.id))
        && [...before.children].every(([id, ids]) => sameIds(ids, after.children.get(id)))) return false;
    const regions = new Map(state.regions.map((region) => [region.id, region]));
    const groups = new Map((state.groups || []).map((group) => [group.id, group]));
    for (const entry of after.entries) {
        if (entry.kind === 'region') delete regions.get(entry.id).groupId;
        else for (const id of after.children.get(entry.id)) regions.get(id).groupId = entry.id;
    }
    state.listOrder = after.entries.map((entry) => entry.id);
    state.groups = after.entries.filter((entry) => entry.kind === 'folder').map((entry) => groups.get(entry.id));
    state.regions = flatten(after).map((id) => regions.get(id));
    return true;
}

/** Move selected boxes in their current visual order, independent of selection order. */
export function moveListRegions(state, ids, groupId = null, beforeId = null) {
    const before = structure(state);
    if (groupId != null && !before.children.has(groupId)) return false;
    const requested = new Set(typeof ids === 'string' ? [ids] : ids || []);
    const moving = flatten(before).filter((id) => requested.has(id));
    if (!moving.length || moving.includes(beforeId)) return false;
    const target = groupId == null ? before.entries.map((entry) => entry.id) : before.children.get(groupId);
    if (beforeId != null && !target.includes(beforeId)) return false;
    const selected = new Set(moving);
    const after = {
        entries: before.entries.filter((entry) => entry.kind === 'folder' || !selected.has(entry.id)),
        children: new Map([...before.children].map(([id, children]) => [id, children.filter((child) => !selected.has(child))])),
    };
    if (groupId == null) {
        const index = beforeId == null ? after.entries.length : after.entries.findIndex((entry) => entry.id === beforeId);
        after.entries.splice(index, 0, ...moving.map((id) => ({ id, kind: 'region' })));
    } else {
        const children = after.children.get(groupId);
        children.splice(beforeId == null ? children.length : children.indexOf(beforeId), 0, ...moving);
    }
    return applyStructure(state, before, after);
}

/** Folders remain flat and can be placed before any top-level box or folder. */
export function moveListFolder(state, id, beforeId = null) {
    const before = structure(state);
    const moving = before.entries.find((entry) => entry.kind === 'folder' && entry.id === id);
    if (!moving || beforeId === id || (beforeId != null && !before.entries.some((entry) => entry.id === beforeId))) return false;
    const after = { entries: before.entries.filter((entry) => entry.id !== id), children: before.children };
    after.entries.splice(beforeId == null ? after.entries.length : after.entries.findIndex((entry) => entry.id === beforeId), 0, moving);
    return applyStructure(state, before, after);
}

/** Dropping onto a box creates a flat folder at that box's top-level position. */
export function groupListRegions(state, ids, targetId, name = 'Folder') {
    const before = structure(state);
    const target = state.regions.find((region) => region.id === targetId);
    const requested = new Set(typeof ids === 'string' ? [ids] : ids || []);
    if (!target || requested.has(targetId)) return false;
    const moving = flatten(before).filter((id) => requested.has(id));
    if (!moving.length) return false;
    const selected = new Set([...moving, targetId]);
    const members = flatten(before).filter((id) => selected.has(id));
    const anchorId = before.children.has(target.groupId) ? target.groupId : targetId;
    const anchorIndex = before.entries.findIndex((entry) => entry.id === anchorId);
    const kept = (entry) => entry.kind === 'folder' || !selected.has(entry.id);
    const index = before.entries.slice(0, anchorIndex).filter(kept).length;
    const group = { id: crypto.randomUUID(), name: String(name).trim() || 'Folder', collapsed: false };
    const after = {
        entries: before.entries.filter(kept),
        children: new Map([...before.children].map(([id, children]) => [id, children.filter((child) => !selected.has(child))])),
    };
    after.entries.splice(index, 0, { id: group.id, kind: 'folder' });
    after.children.set(group.id, members);
    state.groups = [...(state.groups || []), group];
    return applyStructure(state, before, after);
}
