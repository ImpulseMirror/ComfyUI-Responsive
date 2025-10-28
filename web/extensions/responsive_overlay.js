import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { $el } from "../../scripts/ui.js";
import { summarizeWorkflow, mapNodeToDisplay, getWidgetDescriptor } from "../utils/responsive_overlay_utils.js";

const EXTENSION_NAME = "ComfyUI.ResponsiveOverlay";
const TOGGLE_ID = "responsive-overlay-toggle";
const OVERLAY_ID = "responsive-overlay-root";

const ACTIVE_CLASS = "responsive-overlay-is-open";

function ensureStyleTag() {
    if (document.getElementById("responsive-overlay-styles")) {
        return;
    }

    const baseUrl = typeof app.getWebExtensionUrl === "function"
        ? app.getWebExtensionUrl(EXTENSION_NAME)
        : `/extensions/${EXTENSION_NAME}`;

    const linkEl = document.createElement("link");
    linkEl.id = "responsive-overlay-styles";
    linkEl.rel = "stylesheet";
    linkEl.href = `${baseUrl}/css/responsive_overlay.css`;
    document.head.appendChild(linkEl);
}

function getHeaderContainer() {
    if (app?.ui?.topBar) {
        return app.ui.topBar;
    }

    const managerButton = document.querySelector("#comfyui-manager-button");
    if (managerButton?.parentElement) {
        return managerButton.parentElement;
    }

    return document.querySelector("#top-bar-right") || document.querySelector("#top-bar") || document.body;
}

function buildToggleButton() {
    if (document.getElementById(TOGGLE_ID)) {
        return document.getElementById(TOGGLE_ID);
    }

    const button = $el("button.comfyui-header-button", {
        id: TOGGLE_ID,
        title: "Responsive overlay",
        onclick: () => toggleOverlay()
    }, [
        $el("span.material-symbols-outlined", {}, ["dashboard_customize"]),
        $el("span", { className: "responsive-overlay-label" }, ["Responsive"])
    ]);

    const header = getHeaderContainer();
    if (header) {
        header.appendChild(button);
    } else if (app.appendToHeader) {
        app.appendToHeader(button);
    } else {
        console.warn(`[${EXTENSION_NAME}] Unable to locate header container for toggle button.`);
    }

    return button;
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
                $el("aside", { className: "responsive-overlay__sidebar", id: "responsive-overlay-nodes" }, []),
                $el("main", { className: "responsive-overlay__content" }, [
                    $el("section", { id: "responsive-overlay-details", className: "responsive-overlay__panel" }, [
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
    const listEl = document.getElementById("responsive-overlay-nodes");

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
        return;
    }

    summaryEl.textContent = `${nodes.length} node${nodes.length > 1 ? "s" : ""}`;
    listEl.innerHTML = "";

    nodes.forEach((node) => {
        const display = mapNodeToDisplay(node);

        const item = $el("button", {
            className: "responsive-overlay__node",
            onclick: () => renderNodeDetails(node)
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

        listEl.appendChild(item);
    });

    // Automatically render the first node
    renderNodeDetails(nodes[0]);
}

function renderNodeDetails(node) {
    const panel = document.getElementById("responsive-overlay-details");
    if (!panel) {
        return;
    }

    panel.innerHTML = "";

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

    // Ensure graph redraws to reflect updates
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
        const toggle = buildToggleButton();

        if (!root || !toggle) {
            console.warn(`[${EXTENSION_NAME}] Unable to bootstrap overlay UI.`);
            return;
        }

        window.addEventListener("keydown", handleKeyboardShortcuts);

        const observer = new MutationObserver(() => {
            if (!root.classList.contains("hidden")) {
                renderWorkflow();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        if (api?.addEventListener) {
            api.addEventListener("workflowLoaded", () => {
                if (!root.classList.contains("hidden")) {
                    renderWorkflow();
                }
            });
        }

        return () => {
            observer.disconnect();
            window.removeEventListener("keydown", handleKeyboardShortcuts);
        };
    }
});
