const ORDER_STORAGE_KEY = "comfyui-responsive.nodeOrder";

let workflowOrderCache = loadOrderMap();

function createEmptyState() {
    return {
        groupOrder: [],
        nodeOrders: {},
        collapsed: {},
        hiddenGroups: {},
        hiddenNodes: {}
    };
}

function normalizeState(state) {
    if (!state || typeof state !== "object" || Array.isArray(state)) {
        return createEmptyState();
    }
    if (!Array.isArray(state.groupOrder)) {
        state.groupOrder = [];
    }
    if (!state.nodeOrders || typeof state.nodeOrders !== "object") {
        state.nodeOrders = {};
    }
    if (!state.collapsed || typeof state.collapsed !== "object") {
        state.collapsed = {};
    }
    if (!state.hiddenGroups || typeof state.hiddenGroups !== "object") {
        state.hiddenGroups = {};
    }
    if (!state.hiddenNodes || typeof state.hiddenNodes !== "object") {
        state.hiddenNodes = {};
    }
    return state;
}

function loadOrderMap() {
    try {
        const raw = localStorage.getItem(ORDER_STORAGE_KEY);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") {
            return {};
        }
        Object.keys(parsed).forEach((key) => {
            if (Array.isArray(parsed[key])) {
                parsed[key] = normalizeState({
                    groupOrder: parsed[key],
                    nodeOrders: { ungrouped: parsed[key] },
                    collapsed: {}
                });
            } else {
                parsed[key] = normalizeState(parsed[key]);
            }
        });
        return parsed;
    } catch (error) {
        console.warn("[ComfyUI.ResponsiveOverlay] Unable to parse stored order", error);
    }
    return {};
}

function persistWorkflowStates() {
    try {
        localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(workflowOrderCache));
    } catch (error) {
        console.warn("[ComfyUI.ResponsiveOverlay] Unable to persist order", error);
    }
}

export function computeWorkflowKey(nodes) {
    if (!Array.isArray(nodes) || !nodes.length) {
        return "";
    }
    return nodes
        .map((node) => `${node?.id ?? "?"}:${node?.type ?? "?"}`)
        .sort()
        .join("|");
}

export function getWorkflowState(key) {
    if (!key) {
        return createEmptyState();
    }
    if (!workflowOrderCache[key]) {
        workflowOrderCache[key] = createEmptyState();
        persistWorkflowStates();
    }
    return workflowOrderCache[key];
}

export function ensureGroupOrder(key, availableSections) {
    const state = getWorkflowState(key);
    const current = state.groupOrder || [];
    const filtered = current.filter((section) => availableSections.includes(section));
    availableSections.forEach((section) => {
        if (!filtered.includes(section)) {
            filtered.push(section);
        }
    });
    if (filtered.length !== current.length || filtered.some((id, index) => id !== current[index])) {
        state.groupOrder = filtered;
        persistWorkflowStates();
    }
    return filtered;
}

export function ensureNodeOrder(key, sectionId, nodeIds) {
    const state = getWorkflowState(key);
    const stored = Array.isArray(state.nodeOrders[sectionId]) ? state.nodeOrders[sectionId] : [];
    const filtered = stored.filter((id) => nodeIds.includes(id));
    nodeIds.forEach((id) => {
        if (!filtered.includes(id)) {
            filtered.push(id);
        }
    });
    if (filtered.length !== stored.length || filtered.some((id, index) => id !== stored[index])) {
        state.nodeOrders[sectionId] = filtered;
        persistWorkflowStates();
    }
    return filtered;
}

export function setGroupOrder(key, order) {
    const state = getWorkflowState(key);
    state.groupOrder = [...order];
    persistWorkflowStates();
}

export function setNodeOrder(key, sectionId, order) {
    const state = getWorkflowState(key);
    state.nodeOrders[sectionId] = [...order];
    persistWorkflowStates();
}

export function isGroupCollapsed(key, sectionId) {
    const state = getWorkflowState(key);
    return !!state.collapsed?.[sectionId];
}

export function setGroupCollapsed(key, sectionId, collapsed) {
    const state = getWorkflowState(key);
    state.collapsed[sectionId] = collapsed;
    persistWorkflowStates();
}

export function isGroupHidden(key, sectionId) {
    const state = getWorkflowState(key);
    return !!state.hiddenGroups?.[sectionId];
}

export function setGroupHidden(key, sectionId, hidden) {
    const state = getWorkflowState(key);
    if (!state.hiddenGroups) {
        state.hiddenGroups = {};
    }
    if (hidden) {
        state.hiddenGroups[sectionId] = true;
    } else {
        delete state.hiddenGroups[sectionId];
    }
    persistWorkflowStates();
}

export function isNodeHidden(key, nodeId) {
    const state = getWorkflowState(key);
    return !!state.hiddenNodes?.[String(nodeId)];
}

export function setNodeHidden(key, nodeId, hidden) {
    const state = getWorkflowState(key);
    if (!state.hiddenNodes) {
        state.hiddenNodes = {};
    }
    const id = String(nodeId);
    if (hidden) {
        state.hiddenNodes[id] = true;
    } else {
        delete state.hiddenNodes[id];
    }
    persistWorkflowStates();
}

export function resetWorkflowStates(cache) {
    workflowOrderCache = cache;
}

export { ORDER_STORAGE_KEY };
