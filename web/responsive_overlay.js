import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { $el } from "../../scripts/ui.js";
import { summarizeWorkflow, mapNodeToDisplay, getWidgetDescriptor } from "./utils/responsive_overlay_utils.js";

const EXTENSION_NAME = "ComfyUI.ResponsiveOverlay";
const TOGGLE_ID = "responsive-overlay-toggle";
const OVERLAY_ID = "responsive-overlay-root";
const LIST_ID = "responsive-overlay-nodes";
const DETAILS_ID = "responsive-overlay-details";

const ACTIVE_CLASS = "responsive-overlay-is-open";
const SELECTED_CLASS = "responsive-overlay__node--selected";

let selectedNodeId = null;

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
                        onclick: () => renderWorkflow()
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

function renderWorkflow() {
    const nodes = getGraphNodes();
    const summaryEl = document.getElementById("responsive-overlay-summary");
    const listEl = document.getElementById(LIST_ID);

    if (!summaryEl || !listEl) {
        return;
    }

    summaryEl.textContent = summarizeWorkflow(nodes);

    if (!nodes.length) {
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

    const nodeIds = nodes.map((node) => node.id);
    if (selectedNodeId === null || !nodeIds.includes(selectedNodeId)) {
        selectedNodeId = nodes[0]?.id ?? null;
    }

    nodes.forEach((node) => {
        const display = mapNodeToDisplay(node);
        const nodeId = node.id;

        const item = $el("button", {
            className: "responsive-overlay__node",
            dataset: { nodeId: String(nodeId) },
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

        if (nodeId === selectedNodeId) {
            item.classList.add(SELECTED_CLASS);
        }

        listEl.appendChild(item);
    });

    const selected = nodes.find((node) => node.id === selectedNodeId) ?? null;
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
        renderWorkflow();
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

let scheduledRefresh = false;
function scheduleOverlayRefresh() {
    if (scheduledRefresh) {
        return;
    }
    scheduledRefresh = true;
    requestAnimationFrame(() => {
        scheduledRefresh = false;
        const root = document.getElementById(OVERLAY_ID);
        if (root && !root.classList.contains("hidden")) {
            renderWorkflow();
            setSelectedNode(selectedNodeId);
        }
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

        const observer = new MutationObserver((mutations) => {
            if (root.classList.contains("hidden")) {
                return;
            }

            for (const mutation of mutations) {
                const target = mutation.target;
                if (!root.contains(target) && target !== root) {
                    scheduleOverlayRefresh();
                    break;
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        if (api?.addEventListener) {
            api.addEventListener("workflowLoaded", () => {
                scheduleOverlayRefresh();
            });
        }

        return () => {
            observer.disconnect();
            window.removeEventListener("keydown", handleKeyboardShortcuts);
        };
    }
});
