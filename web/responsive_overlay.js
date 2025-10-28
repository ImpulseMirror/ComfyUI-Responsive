import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { $el } from "../../scripts/ui.js";
import { summarizeWorkflow, mapNodeToDisplay, getWidgetDescriptor } from "./utils/responsive_overlay_utils.js";

const EXTENSION_NAME = "ComfyUI.ResponsiveOverlay";
const TOGGLE_ID = "responsive-overlay-toggle";
const OVERLAY_ID = "responsive-overlay-root";
const LIST_ID = "responsive-overlay-nodes";
const DETAILS_ID = "responsive-overlay-details";
const OUTPUTS_ID = "responsive-overlay-outputs";
const RESULTS_GRID_ID = "responsive-overlay-results-grid";
const CURRENT_OUTPUT_ID = "responsive-overlay-current-output";
const CURRENT_MEDIA_ID = "responsive-overlay-current-media";

const ACTIVE_CLASS = "responsive-overlay-is-open";
const SELECTED_CLASS = "responsive-overlay__node--selected";
const ORDER_STORAGE_KEY = "comfyui-responsive.nodeOrder";

let selectedNodeId = null;
let lastWorkflowSignature = "";
let currentWorkflowKey = "";
let scheduledRefresh = false;
let pendingRefreshForce = false;
let draggedNodeId = null;
let draggedSectionId = null;
const MAX_OUTPUT_ITEMS = 16;
const latestOutputs = [];
const workflowOrderCache = loadOrderMap();

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
        console.warn(`[${EXTENSION_NAME}] Unable to parse stored order`, error);
    }
    return {};
}

function persistWorkflowStates() {
    try {
        localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(workflowOrderCache));
    } catch (error) {
        console.warn(`[${EXTENSION_NAME}] Unable to persist order`, error);
    }
}

function computeWorkflowKey(nodes) {
    if (!Array.isArray(nodes) || !nodes.length) {
        return "";
    }
    return nodes
        .map((node) => `${node?.id ?? "?"}:${node?.type ?? "?"}`)
        .sort()
        .join("|");
}

function getWorkflowState(key) {
    if (!key) {
        return createEmptyState();
    }
    if (!workflowOrderCache[key]) {
        workflowOrderCache[key] = createEmptyState();
        persistWorkflowStates();
    }
    return workflowOrderCache[key];
}

function ensureGroupOrder(key, availableSections) {
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

function ensureNodeOrder(key, sectionId, nodeIds) {
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

function setGroupOrder(key, order) {
    const state = getWorkflowState(key);
    state.groupOrder = [...order];
    persistWorkflowStates();
}

function setNodeOrder(key, sectionId, order) {
    const state = getWorkflowState(key);
    state.nodeOrders[sectionId] = [...order];
    persistWorkflowStates();
}

function isGroupCollapsed(key, sectionId) {
    const state = getWorkflowState(key);
    return !!state.collapsed?.[sectionId];
}

function setGroupCollapsed(key, sectionId, collapsed) {
    const state = getWorkflowState(key);
    state.collapsed[sectionId] = collapsed;
    persistWorkflowStates();
}

function ensureStyleTag() {
    if (document.getElementById("responsive-overlay-styles")) {
        return;
    }

    let cssHref;
    try {
        cssHref = new URL("./css/responsive_overlay.css", import.meta.url).href;
    } catch (error) {
        const baseUrl = typeof app.getWebExtensionUrl === "function"
            ? app.getWebExtensionUrl(EXTENSION_NAME)
            : `/extensions/${EXTENSION_NAME}`;

        const normalisedBase = baseUrl
            .replace(/\/[^/]+\.js$/, "")
            .replace(/\/$/, "");

        cssHref = `${normalisedBase}/css/responsive_overlay.css`;
    }

    const linkEl = document.createElement("link");
    linkEl.id = "responsive-overlay-styles";
    linkEl.rel = "stylesheet";
    linkEl.href = cssHref;
    document.head.appendChild(linkEl);
}

async function buildToggleButton() {
    const existing = document.getElementById(TOGGLE_ID);
    if (existing) {
        return existing;
    }

    const placeInMenu = (element) => {
        element.id = TOGGLE_ID;
        const modernTarget = app?.menu?.settingsGroup?.element;
        if (modernTarget?.parentElement) {
            modernTarget.before(element);
            return true;
        }

        const menu = document.querySelector(".comfy-menu")
            || document.querySelector("#top-bar-right")
            || document.querySelector("#top-bar");

        if (menu) {
            menu.appendChild(element);
            return true;
        }

        return false;
    };

    try {
        const { ComfyButton } = await import("../../scripts/ui/components/button.js");
        const comfyButton = new ComfyButton({
            tooltip: "Toggle responsive overlay",
            content: "Responsive",
            classList: "comfyui-button comfyui-menu-mobile-collapse",
            action: () => toggleOverlay()
        });

        const element = comfyButton.element;
        if (!placeInMenu(element)) {
            document.body.appendChild(element);
        }

        return element;
    } catch (error) {
        console.debug(`[${EXTENSION_NAME}] Falling back to legacy button placement`, error);
        const button = document.createElement("button");
        button.id = TOGGLE_ID;
        button.type = "button";
        button.className = "comfyui-button comfyui-menu-mobile-collapse";
        button.textContent = "Responsive";
        button.title = "Toggle responsive overlay";
        button.addEventListener("click", () => toggleOverlay());

        if (!placeInMenu(button)) {
            document.body.appendChild(button);
        }

        return button;
    }
}

function createOverlayRoot() {
    if (document.getElementById(OVERLAY_ID)) {
        return document.getElementById(OVERLAY_ID);
    }

    const root = $el("div", { id: OVERLAY_ID, className: "responsive-overlay hidden" }, [
        $el("div", { className: "responsive-overlay__shell" }, [
            $el("header", { className: "responsive-overlay__header" }, [
                $el("div", { className: "responsive-overlay__header-group" }, [
                    $el("h2", {}, ["Workflow Overview"]),
                    $el("span", { className: "responsive-overlay__summary", id: "responsive-overlay-summary" }, ["No workflow loaded"])
                ]),
                $el("div", { className: "responsive-overlay__header-actions" }, [
                    $el("button", {
                        className: "responsive-overlay__generate",
                        onclick: () => triggerGenerate()
                    }, ["Generate"]),
                    $el("button", {
                        className: "responsive-overlay__refresh",
                        onclick: () => renderWorkflow(true)
                    }, ["Refresh"]),
                    $el("button", {
                        className: "responsive-overlay__close",
                        onclick: () => setOverlayState(false)
                    }, ["Close"])
                ])
            ]),
            $el("div", { className: "responsive-overlay__body" }, [
                $el("aside", { className: "responsive-overlay__sidebar", id: LIST_ID }, []),
                $el("main", { className: "responsive-overlay__content" }, [
                    $el("section", { id: DETAILS_ID, className: "responsive-overlay__panel" }, [
                        $el("h3", {}, ["Node Details"]),
                        $el("p", { id: "responsive-overlay-placeholder" }, ["Select a node from the list to view and edit its widgets."])
                    ])
                ]),
                $el("div", { className: "responsive-overlay__output-column" }, [
                    $el("section", { id: CURRENT_OUTPUT_ID, className: "responsive-overlay__panel responsive-overlay__current-output" }, [
                        $el("div", { className: "responsive-overlay__panel-header" }, [
                            $el("h3", {}, ["Current Output"])
                        ]),
                        $el("div", { id: CURRENT_MEDIA_ID, className: "responsive-overlay__current-media" }, [
                            $el("p", { className: "responsive-overlay__empty" }, ["Generate to see the latest render here."])
                        ])
                    ]),
                    $el("section", { id: OUTPUTS_ID, className: "responsive-overlay__panel responsive-overlay__results hidden" }, [
                        $el("div", { className: "responsive-overlay__panel-header" }, [
                            $el("h3", {}, ["Latest Results"]),
                            $el("span", { className: "responsive-overlay__panel-subtitle", id: "responsive-overlay-results-meta" }, ["Run the workflow to see images or videos here."])
                        ]),
                        $el("div", { id: RESULTS_GRID_ID, className: "responsive-overlay__results-grid" }, [])
                    ])
                ])
            ])
        ])
    ]);

    document.body.appendChild(root);
    return root;
}

function getGraphNodes() {
    const graph = app.graph;
    if (!graph) {
        return [];
    }
    return graph._nodes ? [...graph._nodes] : [];
}

function renderWorkflow(force = false) {
    const nodes = getGraphNodes();
    const summaryEl = document.getElementById("responsive-overlay-summary");
    const listEl = document.getElementById(LIST_ID);

    if (!summaryEl || !listEl) {
        return;
    }

    summaryEl.textContent = summarizeWorkflow(nodes);
    const signature = nodes.map((node) => `${node?.id ?? "?"}:${node?.type ?? "?"}`).join("|");
    const unchanged = !force && signature === lastWorkflowSignature;

    if (unchanged) {
        return;
    }

    lastWorkflowSignature = signature;
    currentWorkflowKey = computeWorkflowKey(nodes);

    const graph = app.graph;
    const graphGroups = graph?._groups ? [...graph._groups] : [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const groupedNodeIds = new Set();
    const sections = [];

    graphGroups.forEach((group) => {
        if (typeof group.recomputeInsideNodes === "function") {
            try {
                group.recomputeInsideNodes();
            } catch (error) {
                console.warn(`[${EXTENSION_NAME}] Unable to recompute group nodes`, error);
            }
        }
        const nodeIds = (group._nodes ?? [])
            .map((node) => node.id)
            .filter((id) => nodeById.has(id));
        if (!nodeIds.length) {
            return;
        }
        nodeIds.forEach((id) => groupedNodeIds.add(id));
        sections.push({
            id: `group:${group.id}`,
            type: "group",
            title: group.title || `Group ${group.id}`,
            group,
            nodeIds,
            orderHint: group.pos?.[1] ?? group.boundingRect?.[1] ?? 0
        });
    });

    const ungroupedIds = nodes
        .map((node) => node.id)
        .filter((id) => !groupedNodeIds.has(id));

    if (ungroupedIds.length) {
        sections.push({
            id: "group:ungrouped",
            type: "ungrouped",
            title: "Ungrouped",
            group: null,
            nodeIds: ungroupedIds,
            orderHint: Number.MAX_SAFE_INTEGER
        });
    }

    if (!sections.length) {
        listEl.innerHTML = `
            <div class="responsive-overlay__empty">
                <p>Nothing to display yet. Build a workflow to see it here.</p>
            </div>
        `;
        selectedNodeId = null;
        renderNodeDetails(null);
        return;
    }

    const defaultSectionOrder = sections
        .slice()
        .sort((a, b) => a.orderHint - b.orderHint)
        .map((section) => section.id);

    const groupOrder = ensureGroupOrder(currentWorkflowKey, defaultSectionOrder);
    const sectionMap = new Map(sections.map((section) => [section.id, section]));

    listEl.innerHTML = "";

    const availableNodeIds = new Set(nodes.map((node) => node.id));
    if (selectedNodeId === null || !availableNodeIds.has(selectedNodeId)) {
        const firstSectionId = groupOrder.find((id) => {
            const section = sectionMap.get(id);
            return section && section.nodeIds.length;
        });
        if (firstSectionId) {
            const section = sectionMap.get(firstSectionId);
            selectedNodeId = section?.nodeIds?.[0] ?? null;
        }
    }

    groupOrder.forEach((sectionId) => {
        const section = sectionMap.get(sectionId);
        if (!section) {
            return;
        }

        const nodeOrderIds = ensureNodeOrder(currentWorkflowKey, sectionId, section.nodeIds);
        const nodesInSection = nodeOrderIds
            .map((id) => nodeById.get(id))
            .filter(Boolean);

        const collapsed = isGroupCollapsed(currentWorkflowKey, sectionId);

        const sectionEl = $el("div", {
            className: "responsive-overlay__group",
            dataset: { sectionId }
        });

        const toggleButton = $el("button", {
            className: `responsive-overlay__group-toggle${collapsed ? " collapsed" : ""}`,
            "aria-expanded": String(!collapsed),
            "aria-label": `${collapsed ? "Expand" : "Collapse"} ${section.title}`.trim(),
            onclick: (event) => {
                event.preventDefault();
                event.stopPropagation();
                const nextState = !isGroupCollapsed(currentWorkflowKey, sectionId);
                setGroupCollapsed(currentWorkflowKey, sectionId, nextState);
                scheduleOverlayRefresh(true);
            }
        }, [collapsed ? "►" : "▼"]);

        const headerEl = $el("div", {
            className: "responsive-overlay__group-header",
            draggable: true
        }, [
            toggleButton,
            $el("span", { className: "responsive-overlay__group-title" }, [section.title]),
            $el("span", { className: "responsive-overlay__group-count" }, [`${nodesInSection.length}`])
        ]);

        headerEl.addEventListener("dragstart", (event) => {
            draggedSectionId = sectionId;
            draggedNodeId = null;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", sectionId);
        });
        headerEl.addEventListener("dragend", () => {
            draggedSectionId = null;
        });

        sectionEl.addEventListener("dragover", (event) => {
            if (!draggedSectionId || draggedSectionId === sectionId) {
                return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            sectionEl.classList.add("responsive-overlay__group--dragover");
        });
        sectionEl.addEventListener("dragleave", () => {
            sectionEl.classList.remove("responsive-overlay__group--dragover");
        });
        sectionEl.addEventListener("drop", (event) => {
            if (!draggedSectionId || draggedSectionId === sectionId) {
                return;
            }
            event.preventDefault();
            sectionEl.classList.remove("responsive-overlay__group--dragover");
            reorderSections(draggedSectionId, sectionId);
            draggedSectionId = null;
        });

        const itemsContainer = $el("div", {
            className: `responsive-overlay__group-items${collapsed ? " responsive-overlay__group-items--collapsed" : ""}`
        });

        nodesInSection.forEach((node) => {
            const display = mapNodeToDisplay(node);
            const nodeId = node.id;
            const button = $el("button", {
                className: "responsive-overlay__node",
                dataset: { nodeId: String(nodeId), sectionId },
                draggable: !collapsed,
                onclick: () => {
                    setSelectedNode(nodeId);
                    renderNodeDetails(node);
                }
            }, [
                $el("div", { className: "responsive-overlay__node-head" }, [
                    $el("span", { className: "responsive-overlay__node-title" }, [display.title]),
                    $el("span", { className: "responsive-overlay__node-type" }, [display.type])
                ]),
                $el("div", { className: "responsive-overlay__node-meta" }, [
                    $el("span", {}, [`#${display.id}`]),
                    $el("span", {}, [
                        `${display.inputCount} in`,
                        " • ",
                        `${display.outputCount} out`
                    ])
                ])
            ]);

            if (!collapsed) {
                button.addEventListener("dragstart", (event) => {
                    draggedNodeId = nodeId;
                    draggedSectionId = null;
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", String(nodeId));
                });
                button.addEventListener("dragend", () => {
                    draggedNodeId = null;
                });
                button.addEventListener("dragover", (event) => {
                    if (draggedSectionId) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    button.classList.add("responsive-overlay__node--dragover");
                });
                button.addEventListener("dragleave", () => {
                    button.classList.remove("responsive-overlay__node--dragover");
                });
                button.addEventListener("drop", (event) => {
                    if (draggedSectionId) return;
                    event.preventDefault();
                    button.classList.remove("responsive-overlay__node--dragover");
                    if (draggedNodeId === null || draggedNodeId === nodeId) {
                        return;
                    }
                    reorderNodes(sectionId, draggedNodeId, nodeId, nodesInSection.map((n) => n.id));
                    draggedNodeId = null;
                });
            }

            if (nodeId === selectedNodeId) {
                button.classList.add(SELECTED_CLASS);
            }

            itemsContainer.appendChild(button);
        });

        sectionEl.appendChild(headerEl);
        sectionEl.appendChild(itemsContainer);
        listEl.appendChild(sectionEl);
    });

    const selectedNode = nodeById.get(selectedNodeId) ?? null;
    if (selectedNode) {
        renderNodeDetails(selectedNode);
        setSelectedNode(selectedNodeId);
    } else {
        renderNodeDetails(null);
    }
}

function renderNodeDetails(node) {
    const panel = document.getElementById(DETAILS_ID);
    if (!panel) {
        return;
    }

    panel.innerHTML = "";

    if (!node) {
        panel.appendChild($el("p", { className: "responsive-overlay__empty" }, ["Nothing selected. Pick a node to view its widgets."]));
        return;
    }

    const display = mapNodeToDisplay(node);

    const header = $el("div", { className: "responsive-overlay__panel-header" }, [
        $el("h3", {}, [display.title]),
        $el("span", { className: "responsive-overlay__panel-subtitle" }, [`Type: ${display.type} · ID: ${display.id}`])
    ]);

    const widgetContainer = $el("div", { className: "responsive-overlay__widgets" }, []);

    const widgets = node.widgets || [];
    if (!widgets.length) {
        widgetContainer.appendChild($el("p", { className: "responsive-overlay__empty" }, ["This node exposes no widgets to edit."]));
    } else {
        widgets.forEach((widget, index) => {
            if (!widget) {
                return;
            }

            const descriptor = getWidgetDescriptor(widget, index);

            const row = $el("label", { className: "responsive-overlay__widget" }, [
                $el("span", { className: "responsive-overlay__widget-label" }, [descriptor.label])
            ]);

            let input;

            switch (descriptor.control) {
                case "select":
                    input = $el("select", {
                        className: "responsive-overlay__widget-input",
                        value: descriptor.value ?? ""
                    }, (descriptor.options || []).map((option) => $el("option", {
                        value: option,
                        selected: option === descriptor.value
                    }, [option])));
                    input.addEventListener("change", (event) => {
                        updateWidgetValue(node, widget, event.target.value);
                    });
                    break;
                case "number": {
                    const attrs = {
                        className: "responsive-overlay__widget-input",
                        type: "number",
                        value: descriptor.value ?? ""
                    };
                    if (descriptor.attributes) {
                        if (descriptor.attributes.step !== undefined) {
                            attrs.step = descriptor.attributes.step;
                        }
                        if (descriptor.attributes.min !== undefined) {
                            attrs.min = descriptor.attributes.min;
                        }
                        if (descriptor.attributes.max !== undefined) {
                            attrs.max = descriptor.attributes.max;
                        }
                    }
                    input = $el("input", {
                        ...attrs
                    });
                    input.addEventListener("change", (event) => {
                        const parsed = parseFloat(event.target.value);
                        updateWidgetValue(node, widget, Number.isNaN(parsed) ? widget.value : parsed);
                    });
                    break;
                }
                case "checkbox":
                    input = $el("input", {
                        className: "responsive-overlay__widget-input",
                        type: "checkbox",
                        checked: !!descriptor.value
                    });
                    input.addEventListener("change", (event) => {
                        updateWidgetValue(node, widget, event.target.checked);
                    });
                    break;
                default:
                    input = $el("textarea", {
                        className: "responsive-overlay__widget-input responsive-overlay__widget-textarea",
                        value: descriptor.value ?? ""
                    });
                    input.addEventListener("input", (event) => {
                        updateWidgetValue(node, widget, event.target.value);
                    });
            }

            row.appendChild(input);
            widgetContainer.appendChild(row);
        });
    }

    panel.appendChild(header);
    panel.appendChild(widgetContainer);
}

function setSelectedNode(nodeId) {
    selectedNodeId = nodeId;
    const listEl = document.getElementById(LIST_ID);
    if (!listEl) {
        return;
    }
    listEl.querySelectorAll(".responsive-overlay__node").forEach((button) => {
        const id = Number(button.dataset.nodeId);
        button.classList.toggle(SELECTED_CLASS, id === selectedNodeId);
    });
}

function reorderNodes(sectionId, sourceId, targetId, sectionNodeIds) {
    if (!currentWorkflowKey || !sectionId) {
        return;
    }

    const baseOrder = ensureNodeOrder(currentWorkflowKey, sectionId, sectionNodeIds);
    const workingOrder = baseOrder.filter((id) => sectionNodeIds.includes(id));
    if (!workingOrder.includes(sourceId)) {
        workingOrder.push(sourceId);
    }

    const withoutSource = workingOrder.filter((id) => id !== sourceId);
    const targetIndex = withoutSource.indexOf(targetId);
    if (targetIndex === -1) {
        withoutSource.push(sourceId);
    } else {
        withoutSource.splice(targetIndex, 0, sourceId);
    }

    setNodeOrder(currentWorkflowKey, sectionId, withoutSource);
    draggedNodeId = null;
    renderWorkflow(true);
}

function reorderSections(sourceId, targetId) {
    if (!currentWorkflowKey || !sourceId || !targetId || sourceId === targetId) {
        return;
    }

    const state = getWorkflowState(currentWorkflowKey);
    const order = Array.isArray(state.groupOrder) ? [...state.groupOrder] : [];
    if (!order.includes(sourceId) || !order.includes(targetId)) {
        return;
    }

    const withoutSource = order.filter((id) => id !== sourceId);
    const targetIndex = withoutSource.indexOf(targetId);
    if (targetIndex === -1) {
        return;
    }

    withoutSource.splice(targetIndex, 0, sourceId);
    setGroupOrder(currentWorkflowKey, withoutSource);
    draggedSectionId = null;
    renderWorkflow(true);
}


function updateWidgetValue(node, widget, value) {
    if (widget === undefined) {
        return;
    }
    widget.value = value;
    if (widget.onChange) {
        widget.onChange(value);
    }

    if (node && typeof node.setProperty === "function" && widget.property) {
        node.setProperty(widget.property, value);
    }

    if (typeof node.onWidgetChanged === "function") {
        node.onWidgetChanged(widget, value);
    }

    if (app?.graph?.setDirtyCanvas) {
        app.graph.setDirtyCanvas(true, true);
    } else if (node && typeof node.setDirtyCanvas === "function") {
        node.setDirtyCanvas(true, true);
    }
}

function setOverlayState(open) {
    const root = document.getElementById(OVERLAY_ID);
    const toggle = document.getElementById(TOGGLE_ID);

    if (!root || !toggle) {
        return;
    }

    root.classList.toggle("hidden", !open);
    document.body.classList.toggle(ACTIVE_CLASS, open);
    toggle.classList.toggle("active", open);

    if (open) {
        renderWorkflow(true);
        renderOutputs();
    }
}

function toggleOverlay() {
    const root = document.getElementById(OVERLAY_ID);
    const isOpen = root && !root.classList.contains("hidden");
    setOverlayState(!isOpen);
}

function triggerGenerate() {
    if (!app?.queuePrompt) {
        console.warn(`[${EXTENSION_NAME}] queuePrompt unavailable; unable to trigger generation.`);
        return;
    }

    try {
        const result = app.queuePrompt(0, 1);
        if (result instanceof Promise) {
            result.catch((error) => {
                console.error(`[${EXTENSION_NAME}] Failed to queue prompt`, error);
            });
        }
    } catch (error) {
        console.error(`[${EXTENSION_NAME}] Failed to queue prompt`, error);
    }
}

function scheduleOverlayRefresh(force = false) {
    if (scheduledRefresh) {
        pendingRefreshForce = pendingRefreshForce || force;
        return;
    }
    scheduledRefresh = true;
    pendingRefreshForce = pendingRefreshForce || force;
    requestAnimationFrame(() => {
        scheduledRefresh = false;
        const root = document.getElementById(OVERLAY_ID);
        if (!root || root.classList.contains("hidden")) {
            pendingRefreshForce = false;
            return;
        }

        const activeElement = document.activeElement;
        if (activeElement && root.contains(activeElement) && ["INPUT", "TEXTAREA", "SELECT"].includes(activeElement.tagName)) {
            pendingRefreshForce = false;
            return;
        }

        renderWorkflow(pendingRefreshForce);
        setSelectedNode(selectedNodeId);
        pendingRefreshForce = false;
    });
}

function handleKeyboardShortcuts(event) {
    if (event.key === "Escape") {
        setOverlayState(false);
    }

    if (event.key.toLowerCase() === "r" && event.altKey) {
        event.preventDefault();
        toggleOverlay();
    }
}

app.registerExtension({
    name: EXTENSION_NAME,
    async setup() {
        ensureStyleTag();
        const root = createOverlayRoot();
        const toggle = await buildToggleButton();

        if (!root || !toggle) {
            console.warn(`[${EXTENSION_NAME}] Unable to bootstrap overlay UI.`);
            return;
        }

        window.addEventListener("keydown", handleKeyboardShortcuts);

        const registeredHandlers = [];
        if (api?.addEventListener) {
            const workflowHandler = () => scheduleOverlayRefresh(true);
            const graphHandler = () => scheduleOverlayRefresh();
            const executedHandler = (event) => {
                handleExecutionOutput(event?.detail);
            };

            api.addEventListener("workflowLoaded", workflowHandler);
            api.addEventListener("graphChanged", graphHandler);
            api.addEventListener("executed", executedHandler);

            registeredHandlers.push(["workflowLoaded", workflowHandler]);
            registeredHandlers.push(["graphChanged", graphHandler]);
            registeredHandlers.push(["executed", executedHandler]);
        }

        return () => {
            window.removeEventListener("keydown", handleKeyboardShortcuts);
            registeredHandlers.forEach(([name, handler]) => {
                api?.removeEventListener?.(name, handler);
            });
        };
    }
});

function handleExecutionOutput(detail) {
    if (!detail || !detail.output) {
        return;
    }

    const mediaItems = extractMediaFromOutput(detail.output);
    if (!mediaItems.length) {
        return;
    }

    mediaItems.forEach((item) => {
        const key = item.url;
        const existingIndex = latestOutputs.findIndex((entry) => entry.key === key);
        if (existingIndex !== -1) {
            latestOutputs.splice(existingIndex, 1);
        }

        latestOutputs.unshift({
            ...item,
            key,
            node: detail.node,
            promptId: detail.prompt_id,
            timestamp: Date.now()
        });
    });

    if (latestOutputs.length > MAX_OUTPUT_ITEMS) {
        latestOutputs.length = MAX_OUTPUT_ITEMS;
    }

    renderOutputs();
}

function extractMediaFromOutput(output) {
    const collected = [];

    const visit = (value) => {
        if (!value) {
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (typeof value === "object") {
            if (value.filename || value.file_name) {
                const filename = value.filename || value.file_name;
                const subfolder = value.subfolder || value.sub_folder || value.folder || "";
                const storageType = value.type || value.storage || "output";
                const url = buildMediaUrl(filename, subfolder, storageType);
                if (url) {
                    const ext = filename.split(".").pop()?.toLowerCase() || "";
                    const videoExts = ["mp4", "webm", "mov", "avi", "mkv"];
                    const kind = videoExts.includes(ext) ? "video" : "image";
                    collected.push({
                        url,
                        filename,
                        subfolder,
                        storageType,
                        kind
                    });
                }
                return;
            }
            Object.values(value).forEach(visit);
        }
    };

    visit(output);
    return collected;
}

function buildMediaUrl(filename, subfolder, storageType) {
    if (!filename) {
        return "";
    }
    const params = new URLSearchParams();
    params.set("filename", filename);
    params.set("type", storageType || "output");
    if (subfolder) {
        params.set("subfolder", subfolder);
    }
    params.set("preview", "1");
    return `/api/view?${params.toString()}`;
}

function renderOutputs() {
    const container = document.getElementById(OUTPUTS_ID);
    const grid = document.getElementById(RESULTS_GRID_ID);
    const meta = document.getElementById("responsive-overlay-results-meta");

    if (!container || !grid || !meta) {
        return;
    }

    if (!latestOutputs.length) {
        container.classList.add("hidden");
        grid.innerHTML = "";
        meta.textContent = "Run the workflow to see images or videos here.";
        renderCurrentMedia(null);
        return;
    }

    container.classList.remove("hidden");
    grid.innerHTML = "";
    meta.textContent = `Showing ${latestOutputs.length} recent file${latestOutputs.length > 1 ? "s" : ""}`;

    renderCurrentMedia(latestOutputs[0]);

    latestOutputs.forEach((item) => {
        const mediaElement = item.kind === "video"
            ? $el("video", {
                src: item.url,
                controls: true,
                loop: true,
                playsInline: true,
                preload: "metadata"
            })
            : $el("img", {
                src: item.url,
                loading: "lazy",
                alt: item.filename
            });

        const figure = $el("figure", { className: "responsive-overlay__result" }, [
            mediaElement,
            $el("figcaption", {}, [
                $el("span", { className: "responsive-overlay__result-name" }, [item.filename]),
                typeof item.node !== "undefined"
                    ? $el("span", { className: "responsive-overlay__result-node" }, [`Node #${item.node}`])
                    : null
            ].filter(Boolean))
        ]);

        figure.addEventListener("click", () => {
            window.open(item.url, "_blank", "noopener");
        });

        grid.appendChild(figure);
    });
}

function renderCurrentMedia(item) {
    const container = document.getElementById(CURRENT_MEDIA_ID);
    if (!container) {
        return;
    }

    container.innerHTML = "";

    if (!item) {
        container.appendChild($el("p", { className: "responsive-overlay__empty" }, ["Generate to see the latest render here."]));
        return;
    }

    const mediaElement = item.kind === "video"
        ? $el("video", {
            src: item.url,
            controls: true,
            autoplay: true,
            loop: true,
            playsInline: true,
            preload: "metadata"
        })
        : $el("img", {
            src: item.url,
            loading: "eager",
            alt: item.filename
        });

    container.appendChild(mediaElement);
}
