import { app } from "./comfy_context.js";
import { EXTENSION_NAME, PROGRESS_BAR_ID, PROGRESS_FILL_ID, PROGRESS_TEXT_ID } from "./constants.js";
import { getGraphNodes } from "./graph_state.js";

const nodeStatuses = new Map();
const nodeTitleCache = new Map();

export const executionTracking = {
    active: false,
    promptId: null,
    totalNodes: 0,
    completed: 0,
    currentNodeId: null,
    currentNodeLabel: "",
    currentNodeProgress: { value: 0, max: 1 },
    percent: 0,
    errorNodeId: null
};

export function initializeNodeStatuses(nodes) {
    nodeStatuses.clear();
    nodes.forEach((node) => {
        const id = String(node.id);
        nodeStatuses.set(id, { state: executionTracking.active ? "pending" : "idle", progress: null });
    });
    updateNodeStatusDisplayAll();
}

export function ensureNodeStatus(nodeId, defaultState) {
    const key = String(nodeId);
    if (!nodeStatuses.has(key)) {
        nodeStatuses.set(key, {
            state: defaultState?.state ?? "idle",
            progress: defaultState?.progress ?? null
        });
    }
    return nodeStatuses.get(key);
}

export function getNodeStatus(nodeId) {
    return nodeStatuses.get(String(nodeId)) || null;
}

export function setNodeStatus(nodeId, state, progress) {
    if (!nodeId) {
        return;
    }
    const id = String(nodeId);
    const current = nodeStatuses.get(id) || { state: "idle", progress: null };
    const next = {
        state: state ?? current.state,
        progress: progress !== undefined ? progress : current.progress
    };
    nodeStatuses.set(id, next);
    updateNodeStatusDisplay(id);
    if (
        next.state === "completed" ||
        next.state === "error" ||
        current.state === "completed" ||
        current.state === "error"
    ) {
        recalculateCompletedCount();
    } else if (next.state === "running") {
        updateOverallProgress();
    }
}

export function forEachNodeStatus(callback) {
    nodeStatuses.forEach((value, key) => {
        callback(value, key);
    });
}

export function updateNodeStatusDisplayAll() {
    nodeStatuses.forEach((_value, nodeId) => updateNodeStatusDisplay(nodeId));
}

export function updateNodeStatusDisplay(nodeId) {
    const selector = `[data-node-id="${CSS.escape(String(nodeId))}"]`;
    document.querySelectorAll(selector).forEach((button) => {
        applyStatusClasses(button, nodeStatuses.get(String(nodeId)) || { state: "idle", progress: null });
    });
}

export function applyStatusClasses(button, status) {
    if (!button) {
        return;
    }
    button.classList.remove(
        "responsive-overlay__node--running",
        "responsive-overlay__node--completed",
        "responsive-overlay__node--error"
    );
    if (!status) {
        removeNodeProgressBar(button);
        return;
    }
    switch (status.state) {
        case "running":
            button.classList.add("responsive-overlay__node--running");
            updateNodeProgressBar(button, status.progress);
            break;
        case "completed":
            button.classList.add("responsive-overlay__node--completed");
            removeNodeProgressBar(button);
            break;
        case "error":
            button.classList.add("responsive-overlay__node--error");
            removeNodeProgressBar(button);
            break;
        case "pending":
        default:
            removeNodeProgressBar(button);
            break;
    }
}

export function updateNodeProgressBar(button, progress) {
    const percent = progress && progress.max ? Math.min(1, Math.max(0, progress.value / progress.max)) : 0;
    let bar = button.querySelector(".responsive-overlay__node-progress");
    if (percent <= 0) {
        if (bar) {
            bar.remove();
        }
        return;
    }
    if (!bar) {
        bar = document.createElement("div");
        bar.className = "responsive-overlay__node-progress";
        button.prepend(bar);
    }
    bar.style.width = `${percent * 100}%`;
}

export function removeNodeProgressBar(button) {
    const bar = button.querySelector(".responsive-overlay__node-progress");
    if (bar) {
        bar.remove();
    }
}

export function resetExecutionTracking() {
    executionTracking.active = false;
    executionTracking.promptId = null;
    executionTracking.totalNodes = 0;
    executionTracking.completed = 0;
    executionTracking.currentNodeId = null;
    executionTracking.currentNodeLabel = "";
    executionTracking.currentNodeProgress = { value: 0, max: 1 };
    executionTracking.percent = 0;
    executionTracking.errorNodeId = null;
    updateProgressBar();
}

export function updateProgressBar() {
    const bar = document.getElementById(PROGRESS_BAR_ID);
    const fill = document.getElementById(PROGRESS_FILL_ID);
    const label = document.getElementById(PROGRESS_TEXT_ID);
    if (!bar || !fill || !label) {
        return;
    }
    if (!executionTracking.active) {
        bar.classList.add("hidden");
        fill.style.width = "0%";
        label.textContent = "";
        return;
    }
    bar.classList.remove("hidden");
    const percent = Math.max(0, Math.min(1, executionTracking.percent || 0));
    fill.style.width = `${percent * 100}%`;
    label.textContent = executionTracking.currentNodeLabel
        ? `${Math.round(percent * 100)}% — ${executionTracking.currentNodeLabel}`
        : `${Math.round(percent * 100)}%`;
}

export function updateOverallProgress() {
    if (!executionTracking.active) {
        executionTracking.percent = 0;
        updateProgressBar();
        return;
    }
    const total = executionTracking.totalNodes || 0;
    const completed = executionTracking.completed || 0;
    let percent = total > 0 ? completed / total : 0;
    const progress = executionTracking.currentNodeProgress;
    if (executionTracking.currentNodeId && progress && progress.max) {
        percent += (progress.value / progress.max) / Math.max(total, 1);
    }
    executionTracking.percent = percent;
    updateProgressBar();
}

export function recalculateCompletedCount() {
    let count = 0;
    nodeStatuses.forEach((status) => {
        if (status.state === "completed") {
            count += 1;
        }
    });
    executionTracking.completed = count;
    updateOverallProgress();
}

export function setCurrentRunningNode(nodeId, progress) {
    if (!nodeId) {
        executionTracking.currentNodeId = null;
        executionTracking.currentNodeLabel = "";
        executionTracking.currentNodeProgress = { value: 0, max: 1 };
        updateOverallProgress();
        return;
    }
    executionTracking.currentNodeId = String(nodeId);
    executionTracking.currentNodeLabel = getNodeTitle(String(nodeId));
    executionTracking.currentNodeProgress = progress || { value: 0, max: 1 };
    updateOverallProgress();
}

export function normalizeNodeId(value) {
    if (value === undefined || value === null) {
        return null;
    }
    const str = String(value);
    const colonIndex = str.indexOf(":");
    return colonIndex === -1 ? str : str.slice(0, colonIndex);
}

export function getNodeTitle(nodeId) {
    if (nodeTitleCache.has(nodeId)) {
        return nodeTitleCache.get(nodeId);
    }
    const graph = app.graph;
    let node = null;
    if (graph) {
        node =
            graph.getNodeById?.(Number(nodeId)) ||
            graph._nodes?.find((n) => String(n.id) === nodeId) ||
            null;
    }
    const title = node?.title || node?.type || `Node ${nodeId}`;
    nodeTitleCache.set(nodeId, title);
    return title;
}

export function setNodeTitleCache(nodeId, title) {
    if (!nodeId) {
        return;
    }
    nodeTitleCache.set(String(nodeId), title || getNodeTitle(String(nodeId)));
}

export function handleExecutionStartEvent(event) {
    executionTracking.active = true;
    executionTracking.promptId = event?.detail?.prompt_id ?? null;
    const nodes = getGraphNodes();
    executionTracking.totalNodes = nodes.length || 0;
    executionTracking.completed = 0;
    executionTracking.currentNodeId = null;
    executionTracking.currentNodeLabel = "";
    executionTracking.currentNodeProgress = { value: 0, max: 1 };
    executionTracking.percent = 0;
    executionTracking.errorNodeId = null;
    initializeNodeStatuses(nodes);
    updateProgressBar();
}

export function handleExecutionCachedEvent(event) {
    const nodes = event?.detail?.nodes || [];
    nodes.forEach((nodeId) => {
        const normalized = normalizeNodeId(nodeId);
        if (normalized) {
            setNodeStatus(normalized, "completed");
        }
    });
    recalculateCompletedCount();
}

export function handleExecutionSuccessEvent() {
    setCurrentRunningNode(null);
    executionTracking.active = false;
    updateOverallProgress();
}

export function handleExecutionInterruptedEvent() {
    resetExecutionTracking();
}

export function handleExecutionErrorEvent(event) {
    const nodeId = normalizeNodeId(event?.detail?.node_id || event?.detail?.display_node_id);
    if (nodeId) {
        setNodeStatus(nodeId, "error");
        executionTracking.errorNodeId = nodeId;
    }
    setCurrentRunningNode(null);
    executionTracking.active = false;
    updateOverallProgress();
}

export function handleExecutingEvent(event) {
    const detail = event?.detail;
    if (typeof detail === "string" || typeof detail === "number") {
        const nodeId = normalizeNodeId(detail);
        if (nodeId) {
            forEachNodeStatus((status, id) => {
                if (status.state === "running" && id !== String(nodeId)) {
                    setNodeStatus(id, "completed");
                }
            });
            setCurrentRunningNode(nodeId, executionTracking.currentNodeProgress);
            setNodeStatus(nodeId, "running", executionTracking.currentNodeProgress);
        }
    } else {
        setCurrentRunningNode(null);
    }
}

export function handleProgressEvent(event) {
    const detail = event?.detail;
    if (!detail) {
        return;
    }
    const nodeId = normalizeNodeId(detail.node ?? detail.node_id ?? executionTracking.currentNodeId);
    const progress = { value: detail.value ?? 0, max: detail.max ?? 1 };
    if (nodeId) {
        setCurrentRunningNode(nodeId, progress);
        setNodeStatus(nodeId, "running", progress);
    } else if (executionTracking.currentNodeId) {
        setCurrentRunningNode(executionTracking.currentNodeId, progress);
        setNodeStatus(executionTracking.currentNodeId, "running", progress);
    } else {
        updateOverallProgress();
    }
}

export function handleProgressStateEvent(event) {
    const nodes = event?.detail?.nodes || {};
    let updated = false;
    for (const key in nodes) {
        const nodeState = nodes[key];
        const nodeId = normalizeNodeId(nodeState.display_node_id ?? nodeState.node_id ?? key);
        if (!nodeId) {
            continue;
        }
        switch (nodeState.state) {
            case "running": {
                const progress = { value: nodeState.value ?? 0, max: nodeState.max ?? 1 };
                setCurrentRunningNode(nodeId, progress);
                setNodeStatus(nodeId, "running", progress);
                updated = true;
                break;
            }
            case "success":
            case "completed":
            case "done":
                setNodeStatus(nodeId, "completed");
                updated = true;
                break;
            case "error":
                setNodeStatus(nodeId, "error");
                executionTracking.errorNodeId = nodeId;
                updated = true;
                break;
            default:
                break;
        }
    }
    if (updated) {
        recalculateCompletedCount();
    }
}

export function handleExecutedEvent(detail) {
    if (!detail) {
        return;
    }
    const nodeId = normalizeNodeId(detail.node_id || detail.display_node_id || detail.id);
    if (nodeId) {
        setNodeStatus(nodeId, "completed");
        if (executionTracking.currentNodeId === nodeId) {
            setCurrentRunningNode(null);
        }
        recalculateCompletedCount();
    }
}
