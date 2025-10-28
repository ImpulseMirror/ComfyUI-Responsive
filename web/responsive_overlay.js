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
const MAX_OUTPUT_ITEMS = 16;
const latestOutputs = [];
const workflowOrderCache = loadOrderMap();

function loadOrderMap() {
    try {
        const raw = localStorage.getItem(ORDER_STORAGE_KEY);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
            return parsed;
        }
    } catch (error) {
        console.warn(`[${EXTENSION_NAME}] Unable to parse stored order`, error);
    }
    return {};
}

function persistOrderMap() {
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

function getStoredOrder(key) {
    if (!key) {
        return [];
    }
    const order = workflowOrderCache[key];
    if (!Array.isArray(order)) {
        return [];
    }
    return order.map((value) => Number(value)).filter((value) => Number.isInteger(value));
}

function setStoredOrder(key, order) {
    if (!key) {
        return;
    }
    workflowOrderCache[key] = order;
    persistOrderMap();
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
    const storedOrder = getStoredOrder(currentWorkflowKey);

    const orderedNodes = [...nodes];
    if (storedOrder.length) {
        const orderIndex = new Map();
        storedOrder.forEach((id, index) => {
            orderIndex.set(id, index);
        });
        orderedNodes.sort((a, b) => {
            const aIndex = orderIndex.has(a.id) ? orderIndex.get(a.id) : storedOrder.length + nodes.indexOf(a);
            const bIndex = orderIndex.has(b.id) ? orderIndex.get(b.id) : storedOrder.length + nodes.indexOf(b);
            return aIndex - bIndex;
        });
    }

    const normalizedOrder = orderedNodes.map((node) => node.id);
    const persistedOrder = getStoredOrder(currentWorkflowKey);
    const orderChanged = normalizedOrder.length !== persistedOrder.length
        || normalizedOrder.some((id, index) => persistedOrder[index] !== id);
    if (orderChanged) {
        setStoredOrder(currentWorkflowKey, normalizedOrder);
    }

    if (!orderedNodes.length) {
        listEl.innerHTML = `
            <div class="responsive-overlay__empty">
                <p>Nothing to display yet. Build a workflow to see it here.</p>
            </div>
        `;
        selectedNodeId = null;
        renderNodeDetails(null);
        return;
    }

    listEl.innerHTML = "";

    const nodeIds = orderedNodes.map((node) => node.id);
    if (selectedNodeId === null || !nodeIds.includes(selectedNodeId)) {
        selectedNodeId = orderedNodes[0]?.id ?? null;
    }

    orderedNodes.forEach((node, index) => {
        const display = mapNodeToDisplay(node);
        const nodeId = node.id;

        const item = $el("button", {
            className: "responsive-overlay__node",
            dataset: { nodeId: String(nodeId) },
            draggable: true,
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

        item.addEventListener("dragstart", (event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", String(nodeId));
            draggedNodeId = nodeId;
        });
        item.addEventListener("dragend", () => {
            draggedNodeId = null;
        });
        item.addEventListener("dragover", (event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            item.classList.add("responsive-overlay__node--dragover");
        });
        item.addEventListener("dragleave", () => {
            item.classList.remove("responsive-overlay__node--dragover");
        });
        item.addEventListener("drop", (event) => {
            event.preventDefault();
            item.classList.remove("responsive-overlay__node--dragover");
            if (draggedNodeId === null || draggedNodeId === nodeId) {
                return;
            }
            reorderNodes(draggedNodeId, nodeId, orderedNodes.map((n) => n.id));
        });

        if (nodeId === selectedNodeId) {
            item.classList.add(SELECTED_CLASS);
        }

        listEl.appendChild(item);
    });

    const selected = orderedNodes.find((node) => node.id === selectedNodeId) ?? null;
    if (selected) {
        renderNodeDetails(selected);
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

function reorderNodes(sourceId, targetId, currentOrder) {
    if (!currentWorkflowKey) {
        return;
    }

    const order = currentOrder ? [...currentOrder] : getStoredOrder(currentWorkflowKey);
    if (!order.length) {
        order.push(...currentOrder);
    }

    const sourceIndex = order.indexOf(sourceId);
    let workingOrder = order;
    if (sourceIndex === -1) {
        workingOrder = [...order, sourceId];
    }

    const withoutSource = workingOrder.filter((id) => id !== sourceId);
    const targetIndex = withoutSource.indexOf(targetId);
    if (targetIndex === -1) {
        withoutSource.push(sourceId);
    } else {
        withoutSource.splice(targetIndex, 0, sourceId);
    }

    setStoredOrder(currentWorkflowKey, withoutSource);
    draggedNodeId = null;
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
