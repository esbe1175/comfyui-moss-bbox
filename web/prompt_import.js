import { createState, resolveDimensions } from './state.js';
import { listEntries } from './list.js';

const LABELS = new Set(['object', 'character', 'text']);
const own = (value, key) => Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function knownFields(value, fields, path = '') {
    for (const key of Object.keys(value)) {
        if (!fields.includes(key)) throw new Error(`Unsupported field: ${path}${key}.`);
    }
}

function string(value, message) {
    if (typeof value !== 'string') throw new Error(message);
    return value;
}

function stringArray(value, path) {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new Error(`${path} must be a list of text values.`);
    }
    return [...value];
}

function summaryFields(summary, withCaption) {
    if (!object(summary)) throw new Error('The scene must be an object.');
    knownFields(summary, withCaption ? ['caption', 'meta', 'canvas', 'palette'] : ['meta', 'canvas', 'palette'], 'summary.');
    if (withCaption) string(summary.caption, 'The scene description must be text.');
    const extras = {};
    for (const key of ['meta', 'canvas', 'palette']) {
        if (!own(summary, key)) continue;
        if (key === 'canvas') {
            extras.canvas = string(summary.canvas, 'Scene canvas must be text.');
        } else extras[key] = stringArray(summary[key], `Scene ${key}`);
    }
    return extras;
}

function dimensions(source) {
    if (![source.width, source.height].every(value => Number.isSafeInteger(value) && value > 0)) {
        throw new Error('Canvas width and height must be positive whole numbers.');
    }
    return { width: source.width, height: source.height };
}

function boxCoordinates(value, index) {
    if (!Array.isArray(value) || value.length !== 4) throw new Error(`Box ${index} needs four coordinates.`);
    if (value.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
        throw new Error(`Box ${index} coordinates must be finite numbers.`);
    }
    return value;
}

function validateBox(bbox, index, width, height, native) {
    const [left, top, right, bottom] = bbox;
    if (left >= right || top >= bottom) throw new Error(`Box ${index} must have a positive width and height.`);
    if (left < 0 || top < 0 || right > width || bottom > height) {
        throw new Error(native
            ? `Box ${index} is outside the source canvas. Check its aspect ratio and Megapixels.`
            : `Box ${index} is outside its canvas.`);
    }
}

function regionFields(item, index, saved = false) {
    if (!object(item)) throw new Error(`Box ${index} must be an object.`);
    knownFields(item, saved
        ? ['id', 'label', 'caption', 'text', 'bbox', 'groupId', 'tags', 'palette', 'muted']
        : ['label', 'caption', 'text', 'bbox', 'tags', 'palette'], `Box ${index}.`);
    if (!LABELS.has(item.label)) throw new Error(`Box ${index} type must be object, character, or text.`);
    const region = {
        id: crypto.randomUUID(),
        label: item.label,
        caption: string(item.caption, `Box ${index} description must be text.`),
        text: own(item, 'text') ? string(item.text, `Box ${index} text must be text.`) : '',
    };
    if (saved && own(item, 'muted')) {
        if (typeof item.muted !== 'boolean') throw new Error(`Box ${index} mute must be true or false.`);
        region.muted = item.muted;
    }
    if (item.label === 'text' && !own(item, 'text') && !saved) throw new Error(`Box ${index} needs its visible text.`);
    for (const key of ['tags', 'palette']) {
        if (own(item, key)) region[key] = stringArray(item[key], `Box ${index} ${key}`);
    }
    return region;
}

// Scan punctuation outside strings; never edit intended caption or lettering characters.
function punctuation(text, visit) {
    let quoted = false, escaped = false;
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (quoted) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') quoted = false;
        } else if (character === '"') quoted = true;
        else if (visit(character, index) === false) return;
    }
}

function removeTrailingComma(text, repairs) {
    const commas = [];
    punctuation(text, (character, index) => {
        if (character !== ',') return;
        let next = index + 1;
        while (next < text.length && /[ \t\r\n]/.test(text[next])) next++;
        if (text[next] === '}' || text[next] === ']') commas.push(index);
    });
    if (commas.length !== 1) return text;
    repairs.push('Removed a trailing comma.');
    return text.slice(0, commas[0]) + text.slice(commas[0] + 1);
}

function missingDelimiterCandidates(text) {
    const candidates = new Map([
        ['{' + text, 'Added a missing opening brace.'],
        ['[' + text, 'Added a missing opening bracket.'],
        [text + '}', 'Added a missing closing brace.'],
        [text + ']', 'Added a missing closing bracket.'],
    ]);
    const stack = [];
    punctuation(text, (character, index) => {
        if (character === '{' || character === '[') stack.push(character);
        else if (character === '}' || character === ']') {
            const expected = stack.at(-1) === '{' ? '}' : stack.at(-1) === '[' ? ']' : null;
            if (expected !== character) {
                if (expected) candidates.set(text.slice(0, index) + expected + text.slice(index),
                    expected === '}' ? 'Added a missing closing brace.' : 'Added a missing closing bracket.');
                return false;
            }
            stack.pop();
        }
    });
    return candidates;
}

function parseJSON(text, repairs) {
    text = removeTrailingComma(text, repairs);
    try { return JSON.parse(text); } catch { /* Try exactly one missing delimiter. */ }
    const candidates = [];
    for (const [candidate, repair] of missingDelimiterCandidates(text)) {
        try { candidates.push({ value: JSON.parse(candidate), repair }); } catch { /* Not a valid repair. */ }
    }
    if (candidates.length === 1) {
        repairs.push(candidates[0].repair);
        return candidates[0].value;
    }
    throw new Error('The clipboard is not valid JSON. Check its brackets and commas.');
}
function clipboardValue(text, repairs) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('The clipboard is empty.');
    let source = text.trim();
    if (source !== text) repairs.push(text.includes('\uFEFF') ? 'Removed clipboard whitespace and marker.' : 'Removed clipboard whitespace.');
    const fence = source.match(/^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i);
    if (fence) {
        source = fence[1].trim();
        repairs.push('Removed the JSON code fence.');
    }
    let value = parseJSON(source, repairs);
    if (typeof value === 'string') {
        value = parseJSON(value.trim(), repairs);
        repairs.push('Unwrapped the JSON text.');
    }
    return value;
}

function importSaved(source, current) {
    knownFields(source, ['version', 'width', 'height', 'scene', 'image', 'regions', 'groups', 'summary', 'listOrder']);
    if (source.version !== 1) throw new Error('This saved layout version is not supported.');
    const { width, height } = dimensions(source);
    const scene = string(source.scene, 'The scene description must be text.');
    if (!Array.isArray(source.regions)) throw new Error('The saved layout needs a list of boxes.');
    const groups = [];
    const groupIds = new Set();
    const listOrder = own(source, 'listOrder') ? stringArray(source.listOrder, 'List order') : null;
    const regionIds = new Map();
    if (own(source, 'groups')) {
        if (!Array.isArray(source.groups)) throw new Error('Folders must be a list.');
        for (const group of source.groups) {
            if (!object(group)) throw new Error('Each folder must be an object.');
            knownFields(group, ['id', 'name', 'collapsed'], 'Folder.');
            if (typeof group.id !== 'string' || !group.id || groupIds.has(group.id)) throw new Error('Folders need unique IDs.');
            string(group.name, 'Folder names must be text.');
            if (own(group, 'collapsed') && typeof group.collapsed !== 'boolean') throw new Error('Folder collapsed must be true or false.');
            groups.push({ ...group });
            groupIds.add(group.id);
        }
    }
    const regions = source.regions.map((item, offset) => {
        const index = offset + 1;
        const region = regionFields(item, index, true);
        const bbox = [...boxCoordinates(item.bbox, index)];
        validateBox(bbox, index, 1, 1, false);
        region.bbox = bbox;
        if (typeof item.id === 'string') regionIds.set(item.id, region.id);
        if (own(item, 'groupId') && item.groupId != null) {
            if (typeof item.groupId !== 'string' || !groupIds.has(item.groupId)) throw new Error(`Box ${index} refers to a missing folder.`);
            region.groupId = item.groupId;
        }
        return region;
    });
    const summary = own(source, 'summary') ? summaryFields(source.summary, false) : {};
    const imported = { ...current, version: 1, width, height, scene, summary, regions, groups };
    delete imported.listOrder;
    if (listOrder) {
        imported.listOrder = listOrder.map((id) => groupIds.has(id) ? id : regionIds.get(id)).filter((id) => id !== undefined);
        imported.listOrder = listEntries(imported).map((entry) => entry.id);
    }
    return imported;
}

function importNative(source, current, megapixels, sourceCanvas) {
    knownFields(source, ['summary', 'items', 'bbox_coord_space', 'bbox_format', 'width', 'height']);
    const draft = source.bbox_coord_space === 'abs' && source.bbox_format === 'xyxy';
    const native = source.bbox_coord_space === 'abs_centralized' && source.bbox_format === 'yxyx';
    if (!draft && !native) throw new Error('Use MOSS abs/xyxy or abs_centralized/yxyx coordinates.');
    if (!Array.isArray(source.items) || !source.items.length) throw new Error('No MOSS boxes found in the clipboard.');
    const hasDimensions = own(source, 'width') || own(source, 'height');
    if (draft && !hasDimensions) throw new Error('This layout needs its canvas width and height.');
    const summary = summaryFields(source.summary, true);
    const prepared = source.items.map((item, offset) => {
        const index = offset + 1, region = regionFields(item, index);
        const coordinates = boxCoordinates(item.bbox, index);
        if (coordinates[0] >= coordinates[2] || coordinates[1] >= coordinates[3]) {
            throw new Error('Box ' + index + ' must have a positive width and height.');
        }
        return { region, coordinates };
    });
    const canvas = hasDimensions ? dimensions(source)
        : sourceCanvas === 'current' ? resolveDimensions(current, megapixels)
        : sourceCanvas ? dimensions(sourceCanvas) : null;
    if (!canvas) {
        const error = new Error('Choose the source aspect ratio and Megapixels for these pixel coordinates.');
        error.code = 'MOSS_SOURCE_CANVAS_REQUIRED';
        throw error;
    }
    if (canvas.width % 16 || canvas.height % 16) throw new Error('MOSS canvas sides must be divisible by 16.');
    const regions = prepared.map(({ region, coordinates }, offset) => {
        const bbox = draft ? [...coordinates] : [
            coordinates[1] + canvas.width / 2,
            coordinates[0] + canvas.height / 2,
            coordinates[3] + canvas.width / 2,
            coordinates[2] + canvas.height / 2,
        ];
        validateBox(bbox, offset + 1, canvas.width, canvas.height, native);
        region.bbox = bbox.map((value, position) => value / (position % 2 === 0 ? canvas.width : canvas.height));
        return region;
    });
    const imported = {
        ...current,
        ...(draft ? canvas : {}),
        version: 1,
        scene: source.summary.caption,
        summary,
        regions,
        groups: [],
    };
    delete imported.listOrder;
    return imported;
}

/** Parse and validate a whole prompt before replacing any authoring state. */
export function importPrompt(text, currentState = createState(), megapixels = 1, sourceCanvas = null) {
    const repairs = [];
    const source = clipboardValue(text, repairs);
    if (!object(source)) throw new Error('No MOSS boxes found in the clipboard.');
    if (own(source, 'version') || own(source, 'regions')) return { state: importSaved(source, currentState), repairs };
    if (!own(source, 'items')) throw new Error('No MOSS boxes found in the clipboard.');
    return { state: importNative(source, currentState, megapixels, sourceCanvas), repairs };
}
