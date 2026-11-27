const FINAL_IMAGE_NODES = new Set(['SaveImage', 'PreviewImage']);
const nodeClass = node => node?.comfyClass || node?.type;
const nodesIn = graph => graph?.nodes || graph?._nodes || [];
const referenceKey = reference => JSON.stringify(reference);

function graphEntries(graph, path = '', ancestors = [], seen = new Set()) {
    if (!graph || seen.has(graph)) return [];
    const entries = [];
    for (const node of nodesIn(graph)) {
        const entry = { node, graph, id: `${path}${node.id}`, ancestors };
        entries.push(entry);
        if (node.subgraph) entries.push(...graphEntries(node.subgraph, `${entry.id}:`, [...ancestors, entry], new Set([...seen, graph])));
    }
    return entries;
}

// SaveImage wins over PreviewImage so a control-map preview cannot replace the final result.
export function downstreamImageNodes(graph, source) {
    const entries = graphEntries(graph);
    const queue = entries.filter(entry => entry.node === source);
    const reached = new Set();
    while (queue.length) {
        const entry = queue.shift();
        if (reached.has(entry)) continue;
        reached.add(entry);
        for (const output of entry.node.outputs || []) {
            for (const linkId of output.links || []) {
                const link = entry.graph.links?.get?.(linkId) || entry.graph.links?.[linkId];
                const target = entries.find(item => item.graph === entry.graph && item.ancestors === entry.ancestors && String(item.node.id) === String(link?.target_id));
                if (target) queue.push(target);
            }
        }
        if (entry.node.subgraph) queue.push(...entries.filter(item => item.ancestors.at(-1) === entry));
        if (entry.ancestors.length) queue.push(entry.ancestors.at(-1));
    }
    const candidates = [...reached].filter(entry => FINAL_IMAGE_NODES.has(nodeClass(entry.node)) && ![2, 4].includes(entry.node.mode));
    const saved = candidates.filter(entry => nodeClass(entry.node) === 'SaveImage');
    return saved.length ? saved : candidates;
}

export function generatedImageReference(output) {
    for (const image of [...(Array.isArray(output?.images) ? output.images : [])].reverse()) {
        if (!image || typeof image.filename !== 'string' || !image.filename || /[\\/\0]/.test(image.filename)) continue;
        if (!['output', 'temp'].includes(image.type)) continue;
        const subfolder = image.subfolder || '';
        if (typeof subfolder !== 'string' || /[:\0]/.test(subfolder) || /^[\\/]/.test(subfolder) || subfolder.split(/[\\/]/).includes('..')) continue;
        return { name: image.filename, subfolder, type: image.type };
    }
    return null;
}

export class GeneratedPreviewFollower {
    constructor({ getGraph, node, getOutputs, loadImage, applyImage, onError }) {
        Object.assign(this, { getGraph, node, getOutputs, loadImage, applyImage, onError });
        this.enabled = false;
        this.version = 0;
        this.pending = null;
        this.latest = null;
        this.promptId = null;
        this.rejected = new Set();
    }

    graphKey() {
        const graph = this.getGraph();
        return { graph, id: graph?.id };
    }

    sameGraph(key) {
        const graph = this.getGraph();
        return key?.graph === graph && key.id === graph?.id;
    }

    start(promptId) {
        this.promptId = promptId;
        this.pending = null;
        this.version++;
    }

    executed(detail, verifiedNode) {
        if (!detail?.prompt_id || (this.promptId && detail.prompt_id !== this.promptId)) return;
        const id = String(detail.display_node || detail.node);
        const candidate = downstreamImageNodes(this.getGraph(), this.node).find(entry => entry.id === id && entry.node === verifiedNode);
        if (!candidate) return;
        const reference = generatedImageReference(detail.output);
        if (!reference) return;
        this.promptId = detail.prompt_id;
        this.pending = { reference, promptId: detail.prompt_id, key: this.graphKey() };
    }

    finish(promptId, success) {
        const result = this.pending;
        if (!result || result.promptId !== promptId) return;
        this.pending = null;
        if (!success) {
            this.version++;
            this.rejected.add(referenceKey(result.reference));
            return;
        }
        if (!this.sameGraph(result.key)) return;
        this.rejected.delete(referenceKey(result.reference));
        this.latest = result;
        if (this.enabled) return this.show(result.reference, result.key);
    }

    async setEnabled(value) {
        this.enabled = Boolean(value);
        this.version++;
        if (!this.enabled) return;
        if (this.latest && this.sameGraph(this.latest.key)) return this.show(this.latest.reference, this.latest.key);
        const candidates = downstreamImageNodes(this.getGraph(), this.node);
        for (const candidate of [...candidates].reverse()) {
            const reference = generatedImageReference(this.getOutputs()?.[candidate.id]);
            if (reference && !this.rejected.has(referenceKey(reference))) return this.show(reference, this.graphKey());
        }
    }

    async show(reference, key) {
        const version = ++this.version;
        try {
            await this.loadImage(reference);
            if (this.enabled && this.version === version && this.sameGraph(key)) await this.applyImage(reference);
        } catch (error) {
            if (this.enabled && this.version === version && this.sameGraph(key)) this.onError?.(error);
        }
    }

    dispose() {
        this.enabled = false;
        this.version++;
        this.pending = null;
        this.latest = null;
        this.rejected.clear();
    }
}
