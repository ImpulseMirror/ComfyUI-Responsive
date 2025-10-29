import { app } from "./comfy_context.js";

export function getGraph() {
    return app.graph || null;
}

export function getGraphNodes() {
    const graph = getGraph();
    if (!graph) {
        return [];
    }
    return Array.isArray(graph._nodes) ? [...graph._nodes] : [];
}
