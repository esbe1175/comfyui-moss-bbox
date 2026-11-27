import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePrompt, createState, resolveDimensions } from '../web/state.js';
import { importPrompt } from '../web/prompt_import.js';
import { listEntries, moveListRegions } from '../web/list.js';

// Legacy fixtures explicitly choose the current canvas; bare prompts now need a source choice.
const importAtCurrentCanvas = (text, state = createState(), megapixels = 1) =>
    importPrompt(text, state, megapixels, 'current');


const current = () => ({
    ...createState(), width: 3, height: 2, scene: 'Old scene',
    image: { filename: 'reference.png', type: 'input' },
    groups: [{ id: 'old-folder', name: 'Old', collapsed: false }],
    regions: [{ id: 'old-box', label: 'object', caption: 'Old', text: '', bbox: [0, 0, 1, 1], groupId: 'old-folder' }],
    summary: { meta: ['old'] },
});
const native = () => ({
    summary: { caption: 'A warm studio.' },
    items: [
        { label: 'object', caption: 'A ceramic cup.', bbox: [-208, -312, 208, 312] },
        { label: 'text', caption: 'Green lettering.', bbox: [-104, -156, 104, 156], text: '  CAF\u00c9 "\u00c9T\u00c9"\n\u4f60\u597d  ' },
    ],
    bbox_coord_space: 'abs_centralized', bbox_format: 'yxyx',
});
const draft = () => ({
    width: 1536, height: 1024, bbox_coord_space: 'abs', bbox_format: 'xyxy',
    summary: { caption: 'A studio scene.', meta: ['product campaign'], canvas: 'single', palette: ['ivory', 'green'] },
    items: [
        { label: 'object', caption: ' A ceramic cup.\n ', bbox: [176, 224, 800, 864], tags: ['ceramic', 'soft shadow'], palette: ['ivory'] },
        { label: 'text', caption: 'Green lettering.', text: '\u4e00\u676f\u6e29\u6696\n\u4e00\u523b\u4ece\u5bb9', bbox: [928, 512, 1376, 656] },
    ],
});

function rejects(modify, pattern, source = native()) {
    modify(source);
    assert.throws(() => importAtCurrentCanvas(JSON.stringify(source), current()), pattern);
}

test('native prompt import explicitly uses the current canvas and retains the reference', () => {
    const state = current();
    const before = structuredClone(state);
    const source = native();
    const result = importAtCurrentCanvas(JSON.stringify(source), state);
    assert.deepEqual(resolveDimensions(state), { width: 1248, height: 832 });
    assert.equal(result.state.width, 3);
    assert.equal(result.state.height, 2);
    assert.equal(result.state.scene, source.summary.caption);
    assert.strictEqual(result.state.image, state.image);
    assert.deepEqual(result.state.regions[0].bbox, [0.25, 0.25, 0.75, 0.75]);
    assert.deepEqual(result.state.groups, []);
    assert.deepEqual(result.state.summary, {});
    assert.deepEqual(result.repairs, []);
    assert.deepEqual(state, before);
    assert.notEqual(result.state.regions[0].id, result.state.regions[1].id);
    assert.notEqual(result.state.regions[0].id, state.regions[0].id);
    assert.equal(result.state.regions[1].text, source.items[1].text);
    assert.equal(compilePrompt(result.state), JSON.stringify(source));
});

test('node output roundtrips at different ratios and megapixel values without edge drift', () => {
    for (const [width, height, megapixels] of [[1, 1, 1], [37, 19, 4], [9, 16, 1.5], [1041, 1301, 0.75]]) {
        const state = {
            ...createState(), width, height, scene: 'An artwork with \u4f60\u597d.\nOn blue paper.',
            regions: [
                { id: 'a', label: 'character', caption: 'A woman in a linen coat.', text: '', bbox: [0.123, 0.047, 0.891, 0.977] },
                { id: 'b', label: 'object', caption: 'A room with warm lighting.', text: '', bbox: [0, 0, 1, 1] },
                { id: 'c', label: 'text', caption: 'Neon lettering.', text: '  \u4e00\u676f "\u00c9T\u00c9"\n\u4e00\u523b  ', bbox: [0.1, 0.2, 0.9, 0.4] },
            ],
        };
        const prompt = compilePrompt(state, megapixels);
        const restored = importAtCurrentCanvas(prompt, state, megapixels).state;
        assert.equal(compilePrompt(restored, megapixels), prompt);
        assert.deepEqual(restored.regions.map(region => region.label), ['character', 'object', 'text']);
        assert.equal(restored.regions[2].text, state.regions[2].text);
    }
});

test('editable draft imports its dimensions, strings, item order and creative metadata', () => {
    const state = current();
    const source = draft();
    const restored = importAtCurrentCanvas(JSON.stringify(source), state, 4).state;
    assert.equal(restored.width, 1536);
    assert.equal(restored.height, 1024);
    assert.strictEqual(restored.image, state.image);
    assert.equal(restored.scene, source.summary.caption);
    assert.deepEqual(restored.summary, { meta: ['product campaign'], canvas: 'single', palette: ['ivory', 'green'] });
    assert.deepEqual(restored.regions[0].bbox, [176 / 1536, 224 / 1024, 800 / 1536, 864 / 1024]);
    assert.equal(restored.regions[0].caption, ' A ceramic cup.\n ');
    assert.deepEqual(restored.regions[0].tags, ['ceramic', 'soft shadow']);
    assert.deepEqual(restored.regions[0].palette, ['ivory']);
    assert.equal(restored.regions[1].text, source.items[1].text);
    restored.summary.meta.push('editor');
    restored.regions[0].tags.push('new');
    assert.deepEqual(source.summary.meta, ['product campaign']);
    assert.deepEqual(source.items[0].tags, ['ceramic', 'soft shadow']);
});

test('native metadata and non-text wording are preserved rather than discarded', () => {
    const source = native();
    source.summary.meta = ['photography', 'warm studio'];
    source.summary.canvas = 'collage';
    source.summary.palette = ['red', 'blue'];
    source.items[0].tags = ['handmade', 'soft'];
    source.items[0].palette = ['ivory'];
    source.items[0].text = 'Exact wording\n  stays here';
    const restored = importAtCurrentCanvas(JSON.stringify(source), current()).state;
    assert.deepEqual(restored.summary.meta, source.summary.meta);
    assert.deepEqual(restored.summary.palette, source.summary.palette);
    assert.equal(restored.summary.canvas, 'collage');
    assert.equal(restored.regions[0].text, source.items[0].text);
    assert.deepEqual(restored.regions[0].tags, source.items[0].tags);
    assert.deepEqual(restored.regions[0].palette, source.items[0].palette);
});

test('saved editor layouts import normalized boxes and validated folder membership', () => {
    const source = {
        version: 1, width: 1041, height: 1301, scene: 'An unfinished portrait.', image: { filename: 'different.png' },
        summary: { meta: ['portrait'] },
        groups: [{ id: 'folder', name: 'Figure', collapsed: true }],
        regions: [
            { id: 'source-box', label: 'character', caption: '', text: '', bbox: [0.1, 0.2, 0.8, 0.9], groupId: 'folder' },
            { id: 'loose-box', label: 'object', caption: 'A chair.', text: '', bbox: [0, 0, 0.2, 0.4], groupId: null },
        ],
    };
    const state = current();
    const imported = importAtCurrentCanvas(JSON.stringify(source), state).state;
    assert.equal(imported.width, 1041);
    assert.equal(imported.height, 1301);
    assert.deepEqual(imported.groups, source.groups);
    assert.equal(imported.regions[0].groupId, 'folder');
    assert.notEqual(imported.regions[0].id, 'source-box');
    assert.strictEqual(imported.image, state.image);
    assert.deepEqual(imported.summary, { meta: ['portrait'] });
    assert.equal(imported.regions[0].caption, '');
});

test('saved layouts remap box IDs in mixed list order and retain folder contents after copy and import', () => {
    const source = {
        ...createState(),
        groups: [{ id: 'folder', name: 'Figure', collapsed: false }, { id: 'empty', name: 'Empty', collapsed: true }],
        regions: [
            { id: 'first', label: 'object', caption: 'First.', text: '', bbox: [0, 0, .2, .2] },
            { id: 'child', label: 'character', caption: 'Figure.', text: '', bbox: [.2, .2, .4, .4], groupId: 'folder' },
            { id: 'last', label: 'object', caption: 'Last.', text: '', bbox: [.4, .4, .6, .6] },
        ],
    };
    moveListRegions(source, ['last'], null, 'folder');
    const original = structuredClone(source), state = current();
    state.listOrder = ['old-folder', 'old-box'];
    const imported = importAtCurrentCanvas(JSON.stringify(source), state).state;
    const remapped = new Map(source.regions.map((region, index) => [region.id, imported.regions[index].id]));
    assert.deepEqual(imported.listOrder, source.listOrder.map((id) => remapped.get(id) || id));
    assert.deepEqual(listEntries(imported).map((entry) => entry.kind), ['region', 'folder', 'folder', 'region']);
    assert.equal(imported.regions.find((region) => region.caption === 'Figure.').groupId, 'folder');
    assert.deepEqual(imported.groups, source.groups);
    assert.ok(imported.regions.every((region) => !source.regions.some((old) => old.id === region.id)));
    assert.deepEqual(source, original);
    assert.deepEqual(state.listOrder, ['old-folder', 'old-box']);
});

test('imported list order validates strings, filters stale entries and appends missing roots', () => {
    const source = {
        ...createState(), groups: [{ id: 'folder', name: 'Figure' }],
        regions: [
            { id: 'child', label: 'object', caption: '', bbox: [0, 0, .2, .2], groupId: 'folder' },
            { id: 'loose', label: 'object', caption: '', bbox: [.2, .2, .4, .4] },
        ],
        listOrder: ['loose', 'stale', 'loose', 'child'],
    };
    const imported = importAtCurrentCanvas(JSON.stringify(source), current()).state;
    assert.deepEqual(imported.listOrder, [imported.regions[1].id, 'folder']);
    for (const invalid of [null, {}, 'folder', ['folder', 1]]) {
        source.listOrder = invalid;
        assert.throws(() => importAtCurrentCanvas(JSON.stringify(source), current()), /List order must be a list of text values/);
    }
});

test('imports without saved list order clear the previous layout order', () => {
    const state = current();
    state.listOrder = ['old-folder'];
    const saved = { ...createState(), regions: [{ id: 'new', label: 'object', caption: '', bbox: [0, 0, 1, 1] }] };
    assert.equal(Object.hasOwn(importAtCurrentCanvas(JSON.stringify(saved), state).state, 'listOrder'), false);
    assert.equal(Object.hasOwn(importAtCurrentCanvas(JSON.stringify(native()), state).state, 'listOrder'), false);
    assert.equal(Object.hasOwn(importAtCurrentCanvas(JSON.stringify(draft()), state).state, 'listOrder'), false);
    assert.deepEqual(state.listOrder, ['old-folder']);
});

test('clipboard whitespace, BOM, JSON fences and JSON-encoded strings repair conservatively', () => {
    const prompt = JSON.stringify(native());
    for (const wrapper of [value => '\uFEFF \r\n' + value + ' \n', value => '```json\n' + value + '\n```', value => JSON.stringify(value)]) {
        const result = importAtCurrentCanvas(wrapper(prompt), current());
        assert.ok(result.repairs.length);
        assert.equal(compilePrompt(result.state), prompt);
    }
});

test('one missing opening or closing brace is repaired without touching braces inside strings', () => {
    const source = native();
    source.summary.caption = 'An image of { braces [ and ] } plus a quote: " and slash: \\.';
    source.items[1].text = '}{][\n  "brackets" \\';
    const prompt = JSON.stringify(source);
    for (const broken of [prompt.slice(1), prompt.slice(0, -1)]) {
        const result = importAtCurrentCanvas(broken, current());
        assert.equal(result.repairs.length, 1);
        assert.match(result.repairs[0], /missing .* brace/);
        assert.equal(compilePrompt(result.state), prompt);
    }
});

test('ambiguous structure and multiple missing delimiters are never guessed', () => {
    const prompt = JSON.stringify(native());
    const cases = [
        prompt.slice(0, -2),
        prompt.replace('"items":[{', '"items":{'),
        prompt.replace('"summary":{', '"summary":'),
        prompt.replace('"caption":"A warm studio."', '"caption":"A warm studio.'),

    ];
    for (const text of cases) assert.throws(() => importAtCurrentCanvas(text, current()), /valid JSON/);
});

test('unrelated clipboard content gives a short error', () => {
    for (const text of ['{}', '[]', 'null', '123', '{"caption":"A room."}']) {
        assert.throws(() => importAtCurrentCanvas(text, current()), /No MOSS boxes found/);
    }
    assert.throws(() => importAtCurrentCanvas('  '), /clipboard is empty/);
    assert.throws(() => importAtCurrentCanvas('A photograph of a woman.', current()), /not valid JSON/);
    rejects(source => source.items = [], /No MOSS boxes found/);
});

test('unknown creative fields fail instead of disappearing', () => {
    rejects(source => source.style = 'watercolor', /Unsupported field: style/);
    rejects(source => source.summary.camera = '35mm', /Unsupported field: summary.camera/);
    rejects(source => source.items[0].pose = 'seated', /Unsupported field: Box 1.pose/);
    rejects(source => source.items[0].children = [], /Unsupported field: Box 1.children/);
});

test('coordinates need four finite numbers, positive area and valid bounds', () => {
    rejects(source => source.items[1].bbox = [0, 1, 2], /Box 2 needs four coordinates/);
    rejects(source => source.items[1].bbox = [0, '1', 2, 3], /Box 2 coordinates must be finite numbers/);
    rejects(source => source.items[1].bbox = [0, 0, 0, 10], /Box 2 must have a positive width and height/);
    rejects(source => source.items[1].bbox = [0, 10, 10, 0], /Box 2 must have a positive width and height/);
    rejects(source => source.items[1].bbox = [-1000, 0, 1, 1], /Box 2 is outside the source canvas. Check its aspect ratio and Megapixels/);
    assert.throws(() => importAtCurrentCanvas(JSON.stringify(native()).replace('[-208,-312,208,312]', '[0,0,1e999,1]'), current()), /finite numbers/);
    rejects(source => source.items[0].bbox = [-1, 0, 10, 10], /Box 1 is outside its canvas/, draft());
});

test('canvas coordinates and required dimensions must match supported MOSS conventions', () => {
    rejects(source => source.bbox_format = 'xywh', /Use MOSS abs\/xyxy or abs_centralized\/yxyx/);
    rejects(source => source.bbox_coord_space = 'normalized', /Use MOSS/);
    rejects(source => delete source.width, /positive whole numbers/, draft());
    rejects(source => { delete source.width; delete source.height; }, /needs its canvas width and height/, draft());
    rejects(source => source.width = 1537, /divisible by 16/, draft());
    rejects(source => source.width = '1536', /positive whole numbers/, draft());
});

test('labels, descriptions, visible text and metadata are validated precisely', () => {
    rejects(source => source.items[1].label = 'person', /Box 2 type must be object, character, or text/);
    rejects(source => source.items[1].caption = 12, /Box 2 description must be text/);
    rejects(source => source.summary.caption = null, /scene description must be text/);
    rejects(source => source.items[1].text = 12, /Box 2 text must be text/);
    rejects(source => delete source.items[1].text, /Box 2 needs its visible text/);
    rejects(source => source.summary.meta = 'photography', /Scene meta must be a list of text values/);
    rejects(source => source.summary.canvas = 12, /Scene canvas must be text/);
    const customCanvas = native();
    customCanvas.summary.canvas = 'panorama';
    assert.equal(importAtCurrentCanvas(JSON.stringify(customCanvas), current()).state.summary.canvas, 'panorama');
    rejects(source => source.items[1].palette = ['green', 12], /Box 2 palette must be a list of text values/);
});

test('failed import cannot partially overwrite the current scene, boxes, folders or image', () => {
    const state = current();
    const before = structuredClone(state);
    const source = native();
    source.items[1].bbox = [0, 0, 0, 0];
    assert.throws(() => importAtCurrentCanvas(JSON.stringify(source), state), /Box 2/);
    assert.deepEqual(state, before);
});

test('saved layout folders and normalized boxes are validated before import', () => {
    const source = {
        version: 1, width: 1024, height: 1024, scene: '', groups: [{ id: 'a', name: 'A' }],
        regions: [{ id: 'box', label: 'object', caption: '', text: '', bbox: [0, 0, 1, 1], groupId: 'missing' }],
    };
    assert.throws(() => importAtCurrentCanvas(JSON.stringify(source), current()), /Box 1 refers to a missing folder/);
    source.regions[0].groupId = 'a';
    source.groups.push({ id: 'a', name: 'Duplicate' });
    assert.throws(() => importAtCurrentCanvas(JSON.stringify(source), current()), /Folders need unique IDs/);
    source.groups.pop();
    source.regions[0].bbox = [0, 0, 2, 1];
    assert.throws(() => importAtCurrentCanvas(JSON.stringify(source), current()), /outside its canvas/);
});



test('a uniquely obvious missing internal closing bracket or brace is repaired', () => {
    const source = native();
    source.summary.caption = 'An image with [ literal } brackets, and an escaped quote: ".';
    source.items[1].text = 'Literal ,} and ,] characters\n  stay as typed.';
    const prompt = JSON.stringify(source);
    const cases = [
        prompt.replace('208,312]}', '208,312}'),
        prompt.replace('}],"bbox_coord_space"', '],"bbox_coord_space"'),
    ];
    const itemsLast = JSON.stringify({ summary: source.summary, bbox_coord_space: source.bbox_coord_space, bbox_format: source.bbox_format, items: source.items });
    cases.push(itemsLast.slice(0, -2) + '}');
    for (const text of cases) {
        const restored = importAtCurrentCanvas(text, current());
        assert.equal(restored.repairs.length, 1);
        assert.match(restored.repairs[0], /missing closing (bracket|brace)/);
        assert.equal(compilePrompt(restored.state), prompt);
    }
});

test('one trailing comma outside strings is removed while visible commas and braces remain exact', () => {
    const source = native();
    source.summary.caption = 'Punctuation , } and , ] belongs in this caption.';
    source.items[1].text = '  ,}\n,] "quote" \\ ,}  ';
    const prompt = JSON.stringify(source);
    for (const text of [prompt.slice(0, -1) + ', \n }', prompt.replace('208,312]', '208,312, \t]')]) {
        const restored = importAtCurrentCanvas(text, current());
        assert.deepEqual(restored.repairs, ['Removed a trailing comma.']);
        assert.equal(compilePrompt(restored.state), prompt);
    }
    const plain = JSON.stringify(native());
    const twoCommas = plain.replace('studio."}', 'studio.",}').slice(0, -1) + ',}';
    assert.throws(() => importAtCurrentCanvas(twoCommas, current()), /not valid JSON/);
});

test('saved editor layouts preserve optional mute flags without changing boxes or folders', () => {
    const source = {
        version: 1, width: 1024, height: 1024, scene: 'A studio.',
        groups: [{ id: 'folder', name: 'Signs', collapsed: false }],
        regions: [
            { id: 'muted', label: 'text', caption: 'Lettering.', text: 'Closed', bbox: [0, 0, 0.3, 0.3], groupId: 'folder', muted: true },
            { id: 'enabled', label: 'object', caption: 'A cup.', text: '', bbox: [0.3, 0.3, 0.6, 0.6], muted: false },
            { id: 'default', label: 'object', caption: 'A chair.', text: '', bbox: [0.6, 0.6, 1, 1] },
        ],
    };
    const state = current();
    const before = structuredClone(state);
    const restored = importAtCurrentCanvas(JSON.stringify(source), state).state;
    assert.equal(restored.regions[0].muted, true);
    assert.equal(restored.regions[1].muted, false);
    assert.equal(Object.hasOwn(restored.regions[2], 'muted'), false);
    assert.deepEqual(restored.groups, source.groups);
    assert.equal(restored.regions[0].groupId, 'folder');
    assert.deepEqual(restored.regions.map(region => region.caption), source.regions.map(region => region.caption));
    assert.deepEqual(JSON.parse(compilePrompt(restored)).items.map(item => item.caption), ['A cup.', 'A chair.']);
    assert.deepEqual(state, before);
    for (const value of ['true', 'false', 1, 0, null, [], {}]) {
        source.regions[0].muted = value;
        assert.throws(() => importAtCurrentCanvas(JSON.stringify(source), state), /Box 1 mute must be true or false/);
        assert.deepEqual(state, before);
    }
});

test('native and draft MOSS prompts reject editor-only mute flags', () => {
    for (const source of [native(), draft()]) {
        for (const value of [true, false]) {
            source.items[0].muted = value;
            assert.throws(() => importAtCurrentCanvas(JSON.stringify(source), current()), /Unsupported field: Box 1.muted/);
        }
    }
});


test('bare native pixel prompts require a source canvas even when all boxes fit the target', () => {
    const state = current(), before = structuredClone(state);
    assert.throws(() => importPrompt(JSON.stringify(native()), state, 4), error =>
        error.code === 'MOSS_SOURCE_CANVAS_REQUIRED' && /source aspect ratio and Megapixels/.test(error.message));
    assert.deepEqual(state, before);
});

test('native source pixels normalize independently of the destination aspect ratio and megapixels', () => {
    const authored = {
        ...createState(), width: 3, height: 2, scene: 'A portrait in a studio.',
        regions: [{ id: 'a', label: 'character', caption: 'A woman in a white suit.', text: '', bbox: [.1,.2,.8,.9] }],
    };
    const sourceCanvas = resolveDimensions(authored, 4);
    const prompt = compilePrompt(authored, 4), pixels = JSON.parse(prompt).items[0].bbox;
    const target = { ...current(), width: 9, height: 16 };
    const before = structuredClone(target);
    const imported = importPrompt(prompt, target, 1, sourceCanvas).state;
    assert.equal(imported.width, 9);
    assert.equal(imported.height, 16);
    assert.strictEqual(imported.image, target.image);
    const expected = [
        (pixels[1]+sourceCanvas.width/2)/sourceCanvas.width,
        (pixels[0]+sourceCanvas.height/2)/sourceCanvas.height,
        (pixels[3]+sourceCanvas.width/2)/sourceCanvas.width,
        (pixels[2]+sourceCanvas.height/2)/sourceCanvas.height,
    ];
    assert.deepEqual(imported.regions[0].bbox, expected);
    assert.deepEqual(target, before);
    const geometry = structuredClone(imported.regions[0].bbox);
    const at1mp = compilePrompt(imported, 1), at4mp = compilePrompt(imported, 4);
    assert.notEqual(at1mp, at4mp);
    assert.deepEqual(imported.regions[0].bbox, geometry);
    assert.throws(() => importPrompt(prompt, target, 1, 'current'), /outside the source canvas/);
});

test('native prompts with source dimensions import without a guess and preserve the target canvas', () => {
    const source = native();
    source.width = 1728; source.height = 2432;
    source.items[0].bbox = [-1216,-864,1216,864];
    const target = current();
    const result = importPrompt(JSON.stringify(source), target, 1).state;
    assert.equal(result.width, target.width);
    assert.equal(result.height, target.height);
    assert.deepEqual(result.regions[0].bbox, [0,0,1,1]);
    assert.strictEqual(result.image, target.image);
    source.items[0].bbox = [-1217,-864,1216,864];
    assert.throws(() => importPrompt(JSON.stringify(source), target), /outside the source canvas/);
});

test('source canvas choices never hide malformed or out-of-range box data', () => {
    const source = native();
    source.items[0].bbox = [0,0,0,1];
    assert.throws(() => importPrompt(JSON.stringify(source), current()), /positive width and height/);
    source.items[0].bbox = [-1216,-864,1216,864];
    assert.throws(() => importPrompt(JSON.stringify(source), current(), 1, {width:1024,height:1024}), /outside the source canvas/);
    assert.throws(() => importPrompt(JSON.stringify(source), current(), 1, {width:1729,height:2432}), /divisible by 16/);
    assert.throws(() => importPrompt(JSON.stringify(source), current(), 1, {width:1728}), /positive whole numbers/);
});
