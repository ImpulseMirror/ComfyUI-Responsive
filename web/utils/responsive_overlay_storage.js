const ORDER_STORAGE_KEY = "comfyui-responsive.nodeOrder";

let workflowOrderCache = loadOrderMap();

function createEmptyState() {
    return {
        groupOrder: [],
        nodeOrders: {},
        collapsed: {}
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

export function resetWorkflowStates(cache) {
    workflowOrderCache = cache;
}

export { ORDER_STORAGE_KEY };
