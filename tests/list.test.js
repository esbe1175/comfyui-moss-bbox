import assert from 'node:assert/strict';
import test from 'node:test';
import { groupListRegions, listEntries, moveListFolder, moveListRegions } from '../web/list.js';
import { parseState } from '../web/state.js';

const fixture = () => ({
    version: 1,
    groups: [{ id: 'a', name: 'A', collapsed: false }, { id: 'b', name: 'B', collapsed: true }, { id: 'empty', name: 'Empty' }],
    // Deliberately interleaved authoring order differs from the initial visual order.
    regions: [
        { id: 'loose-1', caption: 'Loose first', bbox: [0, 0, .2, .2], muted: true },
        { id: 'b1', groupId: 'b', caption: 'B first', bbox: [.2, .2, .4, .4] },
        { id: 'a1', groupId: 'a', caption: 'A first', bbox: [.4, .4, .6, .6], tags: ['keep'] },
        { id: 'a2', groupId: 'a', caption: 'A last', bbox: [.6, .6, .8, .8], muted: false },
        { id: 'loose-2', caption: 'Loose last', bbox: [.8, .8, 1, 1] },
    ],
});
const roots = (state) => listEntries(state).map((entry) => entry.id);
const regions = (state) => state.regions.map((region) => region.id);
const children = (state, id) => state.regions.filter((region) => region.groupId === id).map((region) => region.id);

test('top-level entries restore mixed saved order and tolerate stale, duplicate and missing entries', () => {
    const state = fixture(), original = structuredClone(state);
    assert.deepEqual(listEntries(state), [
        { id: 'a', kind: 'folder' }, { id: 'b', kind: 'folder' }, { id: 'empty', kind: 'folder' },
        { id: 'loose-1', kind: 'region' }, { id: 'loose-2', kind: 'region' },
    ]);
    assert.deepEqual(state, original);
    state.listOrder = ['loose-2', 'missing', 'b', 'b', 'a1'];
    assert.deepEqual(roots(state), ['loose-2', 'b', 'a', 'empty', 'loose-1']);
    state.regions.push({ id: 'orphan', groupId: 'deleted' });
    assert.equal(roots(state).at(-1), 'orphan');
    assert.deepEqual(listEntries({ regions: [{ id: 'legacy' }] }), [{ id: 'legacy', kind: 'region' }]);
});

test('moving boxes across folders preserves geometry, mute, content and object identities', () => {
    const state = fixture(), originals = new Map(state.regions.map((region) => [region.id, region]));
    const content = state.regions.map(({ groupId, ...region }) => structuredClone(region));
    assert.equal(moveListRegions(state, ['loose-1', 'a2'], 'b', 'b1'), true);
    assert.deepEqual(children(state, 'b'), ['a2', 'loose-1', 'b1']);
    assert.deepEqual(children(state, 'a'), ['a1']);
    assert.deepEqual(roots(state), ['a', 'b', 'empty', 'loose-2']);
    assert.deepEqual(regions(state), ['a1', 'a2', 'loose-1', 'b1', 'loose-2']);
    assert.deepEqual(state.listOrder, roots(state));
    for (const expected of content) {
        const actual = state.regions.find((region) => region.id === expected.id);
        assert.strictEqual(actual, originals.get(actual.id));
        const { groupId, ...rest } = actual;
        assert.deepEqual(rest, expected);
    }
});

test('multiple boxes move as a block in mixed visual order rather than selection or authoring order', () => {
    const state = fixture();
    state.listOrder = ['loose-2', 'b', 'a', 'empty', 'loose-1'];
    assert.equal(moveListRegions(state, ['a2', 'b1', 'loose-2', 'a1'], 'empty'), true);
    assert.deepEqual(children(state, 'empty'), ['loose-2', 'b1', 'a1', 'a2']);
    assert.deepEqual(regions(state), ['loose-2', 'b1', 'a1', 'a2', 'loose-1']);
    assert.deepEqual(state.groups.map((group) => group.id), ['b', 'a', 'empty']);
});

test('boxes can be ungrouped before a folder and reordered among loose boxes', () => {
    const state = fixture();
    assert.equal(moveListRegions(state, ['b1', 'a2'], null, 'b'), true);
    assert.deepEqual(roots(state), ['a', 'a2', 'b1', 'b', 'empty', 'loose-1', 'loose-2']);
    assert.deepEqual(regions(state), ['a1', 'a2', 'b1', 'loose-1', 'loose-2']);
    assert.equal(Object.hasOwn(state.regions[1], 'groupId'), false);
    assert.equal(moveListRegions(state, ['loose-2'], null, 'loose-1'), true);
    assert.deepEqual(roots(state).slice(-2), ['loose-2', 'loose-1']);
    assert.equal(moveListRegions(state, ['a1']), true);
    assert.equal(roots(state).at(-1), 'a1');
    assert.deepEqual(children(state, 'a'), []);
});

test('folder reordering includes empty folders and placement before loose boxes', () => {
    const state = fixture(), folder = state.groups[2];
    assert.equal(moveListFolder(state, 'empty', 'a'), true);
    assert.strictEqual(state.groups[0], folder);
    assert.deepEqual(roots(state), ['empty', 'a', 'b', 'loose-1', 'loose-2']);
    assert.equal(moveListFolder(state, 'a', 'loose-2'), true);
    assert.deepEqual(roots(state), ['empty', 'b', 'loose-1', 'a', 'loose-2']);
    assert.deepEqual(regions(state), ['b1', 'loose-1', 'a1', 'a2', 'loose-2']);
    assert.equal(moveListFolder(state, 'empty'), true);
    assert.deepEqual(roots(state), ['b', 'loose-1', 'a', 'loose-2', 'empty']);
    assert.deepEqual(state.groups.map((group) => group.id), ['b', 'a', 'empty']);
});

test('serialized layouts restore mixed root and folder content ordering', () => {
    const state = fixture();
    moveListRegions(state, ['a2'], null, 'a');
    moveListRegions(state, ['loose-2'], 'b', 'b1');
    moveListFolder(state, 'empty', 'a');
    const restored = parseState(JSON.stringify(state));
    assert.deepEqual(listEntries(restored), listEntries(state));
    assert.deepEqual(restored.listOrder, state.listOrder);
    assert.deepEqual(regions(restored), regions(state));
    assert.deepEqual(children(restored, 'b'), ['loose-2', 'b1']);
});

test('dropping on a loose box creates a folder at its root slot in original visual order', () => {
    const state = fixture();
    state.listOrder = ['loose-1', 'a', 'loose-2', 'b', 'empty'];
    assert.equal(groupListRegions(state, ['b1', 'a2'], 'loose-2', '  New group  '), true);
    const folder = state.groups.find((group) => group.name === 'New group');
    assert.ok(folder);
    assert.equal(folder.collapsed, false);
    assert.deepEqual(roots(state), ['loose-1', 'a', folder.id, 'b', 'empty']);
    assert.deepEqual(children(state, folder.id), ['a2', 'loose-2', 'b1']);
    assert.deepEqual(children(state, 'a'), ['a1']);
    assert.deepEqual(children(state, 'b'), []);
    assert.deepEqual(regions(state), ['loose-1', 'a1', 'a2', 'loose-2', 'b1']);
});

test('dropping on a grouped box creates a flat folder before its parent', () => {
    const state = fixture();
    assert.equal(groupListRegions(state, ['loose-2', 'a2'], 'b1'), true);
    const folder = state.groups.find((group) => group.name === 'Folder');
    assert.deepEqual(roots(state), ['a', folder.id, 'b', 'empty', 'loose-1']);
    assert.deepEqual(children(state, folder.id), ['a2', 'b1', 'loose-2']);
    assert.deepEqual(children(state, 'b'), []);
    assert.equal(Object.hasOwn(folder, 'groupId'), false);
});

test('invalid, self and unchanged drops return false without mutating state', () => {
    const attempts = [
        (state) => moveListRegions(state, ['missing']),
        (state) => moveListRegions(state, []),
        (state) => moveListRegions(state, ['a1'], 'missing'),
        (state) => moveListRegions(state, ['a1'], 'a', 'b1'),
        (state) => moveListRegions(state, ['a1'], null, 'a2'),
        (state) => moveListRegions(state, ['a1', 'a2'], 'a', 'a2'),
        (state) => moveListRegions(state, ['a1', 'a2'], 'a'),
        (state) => moveListRegions(state, ['a2'], 'a'),
        (state) => moveListRegions(state, ['loose-2']),
        (state) => moveListRegions(state, ['loose-1'], null, 'loose-2'),
        (state) => moveListFolder(state, 'missing'),
        (state) => moveListFolder(state, 'a', 'a'),
        (state) => moveListFolder(state, 'a', 'a1'),
        (state) => moveListFolder(state, 'a', 'b'),
        (state) => moveListFolder(state, 'empty', 'loose-1'),
        (state) => groupListRegions(state, ['a1'], 'a1'),
        (state) => groupListRegions(state, ['a1', 'b1'], 'b1'),
        (state) => groupListRegions(state, ['a1'], 'missing'),
        (state) => groupListRegions(state, ['missing'], 'b1'),
    ];
    for (const attempt of attempts) {
        const state = fixture(), before = structuredClone(state), groupArray = state.groups, regionArray = state.regions;
        assert.equal(attempt(state), false, attempt.toString());
        assert.deepEqual(state, before);
        assert.strictEqual(state.groups, groupArray);
        assert.strictEqual(state.regions, regionArray);
    }
});
