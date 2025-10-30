import { app, api, $el } from "./comfy_context.js";
import { summarizeWorkflow, mapNodeToDisplay, getWidgetDescriptor } from "../utils/responsive_overlay_utils.js";
import {
    computeWorkflowKey,
    ensureGroupOrder,
    ensureNodeOrder,
    setGroupOrder,
    setNodeOrder,
    isGroupCollapsed,
    setGroupCollapsed,
    getWorkflowState,
    isGroupHidden,
    setGroupHidden,
    isNodeHidden,
    setNodeHidden
} from "../utils/responsive_overlay_storage.js";
import {
    openLightboxMedia,
    closeLightboxMedia,
    createPreviewElement
} from "../utils/responsive_overlay_media.js";
import { collectNodeMediaPreviews } from "../utils/responsive_overlay_node_media.js";
import {
    EXTENSION_NAME,
    HIDDEN_TOGGLE_ID,
    LIST_ID,
    DETAILS_ID,
    OVERLAY_ID,
    SELECTED_CLASS
} from "./constants.js";
import {
    executionTracking,
    ensureNodeStatus,
    getNodeStatus,
    applyStatusClasses,
    setNodeTitleCache
} from "./execution_tracking.js";
import { getGraphNodes } from "./graph_state.js";
import {
    getActiveRegion,
    registerHiddenToggleUpdater,
    rootIsStacked,
    setActiveRegion
} from "./layout_manager.js";

let selectedNodeId = null;
let lastWorkflowSignature = "";
let currentWorkflowKey = "";
let scheduledRefresh = false;
let pendingRefreshForce = false;
let draggedNodeId = null;
let draggedSectionId = null;
let showHiddenItems = false;

// Track previous fixed seeds per widget so we can restore with the "previous seed" action
const previousSeedByWidget = new WeakMap();

registerHiddenToggleUpdater(() => updateHiddenToggleButton());

export function renderWorkflow(force = false) {
    const nodes = getGraphNodes();
    const summaryEl = document.getElementById("responsive-overlay-summary");
    const listEl = document.getElementById(LIST_ID);

    if (!summaryEl || !listEl) {
        return;
    }

    updateHiddenToggleButton();

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
    nodes.forEach((node) => {
        const idStr = String(node.id);
        setNodeTitleCache(idStr, node.title || node.type);
        ensureNodeStatus(idStr, { state: executionTracking.active ? "pending" : "idle", progress: null });
    });
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

    ungroupedIds.forEach((nodeId, index) => {
        const node = nodeById.get(nodeId);
        sections.push({
            id: `node:${nodeId}`,
            type: "single",
            title: null,
            group: null,
            nodeIds: [nodeId],
            orderHint: node?.pos?.[1] ?? index
        });
    });

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

    const hiddenNodesMap = new Map();
    nodes.forEach((node) => {
        hiddenNodesMap.set(node.id, isNodeHidden(currentWorkflowKey, node.id));
    });

    const availableNodeIds = new Set(
        nodes
            .filter((node) => showHiddenItems || !hiddenNodesMap.get(node.id))
            .map((node) => node.id)
    );

    if (selectedNodeId !== null && !availableNodeIds.has(selectedNodeId)) {
        selectedNodeId = null;
    }

    let firstVisibleNodeId = null;
    let renderedAnySection = false;

    groupOrder.forEach((sectionId) => {
        const section = sectionMap.get(sectionId);
        if (!section) {
            return;
        }

        const nodesOrdered = (section.type === "group"
            ? ensureNodeOrder(currentWorkflowKey, sectionId, section.nodeIds)
            : section.nodeIds
        ).map((id) => nodeById.get(id)).filter(Boolean);

        const groupHidden = section.type === "group" ? isGroupHidden(currentWorkflowKey, sectionId) : false;

        if (!showHiddenItems && groupHidden) {
            if (section.nodeIds.includes(selectedNodeId)) {
                selectedNodeId = null;
            }
            return;
        }

        const visibleNodes = nodesOrdered.filter((node) => !hiddenNodesMap.get(node.id));
        const nodesToRender = showHiddenItems ? nodesOrdered : visibleNodes;

        if (!nodesToRender.length) {
            if (section.nodeIds.includes(selectedNodeId)) {
                selectedNodeId = null;
            }
            return;
        }

        const collapsed = section.type === "group" ? isGroupCollapsed(currentWorkflowKey, sectionId) : false;

        const sectionClasses = ["responsive-overlay__group"];
        if (section.type === "single") {
            sectionClasses.push("responsive-overlay__group--single");
        }
        if (groupHidden && showHiddenItems) {
            sectionClasses.push("responsive-overlay__group--hidden");
        }

        const sectionEl = $el("div", {
            className: sectionClasses.join(" "),
            dataset: { sectionId, hidden: groupHidden ? "true" : "false" }
        });

        // Apply group background color to match graph
        try {
            const groupColor = toRgbaString(getGroupAccentColor(section.group), 0.14);
            if (groupColor) {
                sectionEl.style.backgroundColor = groupColor;
            }
        } catch (_) {
            // ignore
        }

        const enableSectionDrop = (target) => {
            target.addEventListener("dragover", (event) => {
                if (!draggedSectionId || draggedSectionId === sectionId) {
                    return;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                sectionEl.classList.add("responsive-overlay__group--dragover");
            });
            target.addEventListener("dragleave", () => {
                sectionEl.classList.remove("responsive-overlay__group--dragover");
            });
            target.addEventListener("drop", (event) => {
                if (!draggedSectionId || draggedSectionId === sectionId) {
                    return;
                }
                event.preventDefault();
                sectionEl.classList.remove("responsive-overlay__group--dragover");
                reorderSections(draggedSectionId, sectionId);
                draggedSectionId = null;
            });
        };

        let itemsContainer = sectionEl;

        if (section.type === "group") {
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
                $el("div", { className: "responsive-overlay__group-header-tools" }, [
                    $el("span", { className: "responsive-overlay__group-count" }, [
                        showHiddenItems && visibleNodes.length !== nodesOrdered.length
                            ? `${visibleNodes.length}/${nodesOrdered.length}`
                            : `${visibleNodes.length}`
                    ]),
                    groupHidden && showHiddenItems
                        ? $el("span", { className: "responsive-overlay__group-hidden-indicator" }, ["Hidden"])
                        : null,
                    $el("button", {
                        className: "responsive-overlay__visibility responsive-overlay__visibility--group",
                        title: groupHidden ? "Show group" : "Hide group",
                        onclick: (event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            toggleGroupVisibility(sectionId, !groupHidden);
                        }
                    }, [groupHidden ? "👁‍🗨" : "👁"]),
                    (() => {
                        const allBypassed = nodesOrdered.length > 0 && nodesOrdered.every((n) => isNodeBypassed(n));
                        const btn = $el("button", {
                            className: `responsive-overlay__bypass responsive-overlay__bypass--group${allBypassed ? " responsive-overlay__bypass--active" : ""}`,
                            title: allBypassed ? "Unbypass group" : "Bypass group",
                            onclick: (event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                toggleGroupBypass(sectionId, !allBypassed, section.nodeIds);
                            }
                        }, ["✕"]);
                        if (!allBypassed) {
                            btn.style.backgroundColor = "rgba(15, 23, 42, 0.35)";
                        }
                        return btn;
                    })()
                ].filter(Boolean))
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

            enableSectionDrop(sectionEl);

            itemsContainer = $el("div", {
                className: `responsive-overlay__group-items${collapsed ? " responsive-overlay__group-items--collapsed" : ""}`
            });

            sectionEl.appendChild(headerEl);
            sectionEl.appendChild(itemsContainer);
        } else {
            enableSectionDrop(sectionEl);
        }

        nodesToRender.forEach((node) => {
            const display = mapNodeToDisplay(node);
            const nodeId = node.id;
            const nodeHidden = !!hiddenNodesMap.get(nodeId);

            if (firstVisibleNodeId === null && !nodeHidden) {
                firstVisibleNodeId = nodeId;
            }

            const buttonClasses = ["responsive-overlay__node"];
            if (nodeHidden) {
                buttonClasses.push("responsive-overlay__node--hidden");
            }
            if (nodeId === selectedNodeId) {
                buttonClasses.push(SELECTED_CLASS);
            }

            const button = $el("button", {
                className: buttonClasses.join(" "),
                dataset: { nodeId },
                draggable: true,
                onclick: (event) => {
                    event.preventDefault();
                    if (selectedNodeId === nodeId) {
                        scheduleOverlayRefresh(true);
                        return;
                    }
                    selectedNodeId = nodeId;
                    setActiveRegion("details");
                    renderNodeDetails(node);
                    setSelectedNode(nodeId);
                },
                onfocus: () => {
                    selectedNodeId = nodeId;
                    setActiveRegion("details");
                    renderNodeDetails(node);
                    setSelectedNode(nodeId);
                }
            }, [
                $el("span", { className: "responsive-overlay__node-title" }, [display.title]),
                $el("span", { className: "responsive-overlay__node-type" }, [`${display.type} · #${display.id}`]),
                $el("div", { className: "responsive-overlay__node-counts" }, [
                    $el("span", { className: "responsive-overlay__node-inputs" }, [`${display.inputCount} input${display.inputCount === 1 ? "" : "s"}`]),
                    $el("span", { className: "responsive-overlay__node-outputs" }, [`${display.outputCount} output${display.outputCount === 1 ? "" : "s"}`])
                ])
            ]);

            // Apply node background color to match graph
            try {
                const nodeColor = toRgbaString(getNodeAccentColor(node), 0.22);
                if (nodeColor) {
                    button.style.backgroundColor = nodeColor;
                }
            } catch (_) {
                // ignore
            }

            button.addEventListener("dragstart", (event) => {
                draggedNodeId = nodeId;
                draggedSectionId = sectionId;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(nodeId));
            });
            button.addEventListener("dragend", () => {
                draggedNodeId = null;
                draggedSectionId = null;
            });

            button.addEventListener("drop", (event) => {
                if (!draggedNodeId || draggedNodeId === nodeId || draggedSectionId !== sectionId) {
                    return;
                }
                event.preventDefault();
                reorderNodes(sectionId, draggedNodeId, nodeId, section.nodeIds);
            });

            const toggleButton = $el("button", {
                className: "responsive-overlay__visibility",
                title: nodeHidden ? "Show node" : "Hide node",
                onclick: (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleNodeVisibility(nodeId, !nodeHidden);
                }
            }, [nodeHidden ? "👁‍🗨" : "👁"]);

            button.appendChild(toggleButton);

            // Add bypass control
            const nodeBypassed = isNodeBypassed(node);
            if (nodeBypassed) {
                button.classList.add("responsive-overlay__node--bypassed");
            }
            const bypassButton = $el("button", {
                className: `responsive-overlay__bypass${nodeBypassed ? " responsive-overlay__bypass--active" : ""}`,
                title: nodeBypassed ? "Unbypass node" : "Bypass node",
                onclick: (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleNodeBypass(nodeId, !nodeBypassed);
                }
            }, ["✕"]);

            if (!nodeBypassed) {
                bypassButton.style.backgroundColor = "rgba(15, 23, 42, 0.45)";
            }

            button.appendChild(bypassButton);

            const status = getNodeStatus(nodeId) || { state: executionTracking.active ? "pending" : "idle", progress: null };
            applyStatusClasses(button, status);

            itemsContainer.appendChild(button);
        });

        renderedAnySection = true;
        listEl.appendChild(sectionEl);
    });

    if (!renderedAnySection) {
        listEl.innerHTML = `
            <div class="responsive-overlay__empty">
                <p>No visible nodes remaining.</p>
            </div>
        `;
        selectedNodeId = null;
        renderNodeDetails(null);
        return;
    }

    if (!selectedNodeId) {
        selectedNodeId = firstVisibleNodeId ?? null;
    }
    const selectedNode = nodeById.get(selectedNodeId) ?? null;
    if (selectedNode) {
        renderNodeDetails(selectedNode);
        setSelectedNode(selectedNodeId);
    } else {
        renderNodeDetails(null);
        setSelectedNode(null);
    }
}

export function toggleHiddenFilter() {
    showHiddenItems = !showHiddenItems;
    updateHiddenToggleButton();
    renderWorkflow(true);
}

export function updateHiddenToggleButton() {
    const button = document.getElementById(HIDDEN_TOGGLE_ID);
    if (!button) {
        return;
    }
    const visible = !rootIsStacked() || getActiveRegion() === "nodes";
    button.style.display = visible ? "inline-flex" : "none";
    if (showHiddenItems) {
        button.textContent = "Hide Hidden";
        button.classList.add("responsive-overlay__filter--active");
    } else {
        button.textContent = "Show Hidden";
        button.classList.remove("responsive-overlay__filter--active");
    }
    button.setAttribute("aria-pressed", String(showHiddenItems));
}

// Bypass helpers
function isNodeBypassed(node) {
    return !!node && node.mode === 2;
}

function toggleNodeBypass(nodeId, bypassed) {
    const nodes = getGraphNodes();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) {
        return;
    }
    node.mode = bypassed ? 2 : 0;
    if (app?.graph?.setDirtyCanvas) {
        app.graph.setDirtyCanvas(true, true);
    }
    renderWorkflow(true);
}

function toggleGroupBypass(sectionId, bypassed, nodeIds) {
    const nodes = getGraphNodes();
    if (!Array.isArray(nodeIds)) {
        return;
    }
    nodeIds.forEach((id) => {
        const node = nodes.find((n) => n.id === id);
        if (node) {
            node.mode = bypassed ? 2 : 0;
        }
    });
    if (app?.graph?.setDirtyCanvas) {
        app.graph.setDirtyCanvas(true, true);
    }
    renderWorkflow(true);
}

// Color helpers – compute CSS rgba from various LiteGraph color formats
function normalizeCssColor(value) {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value === "number") {
        const hex = (value >>> 0).toString(16).padStart(6, "0");
        return `#${hex.slice(-6)}`;
    }
    if (Array.isArray(value)) {
        const [r = 0, g = 0, b = 0, a = 1] = value;
        return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    if (typeof value === "string") {
        if (/^[0-9A-Fa-f]{6}$/.test(value)) {
            return `#${value}`;
        }
        return value;
    }
    return null;
}

function toRgbaString(color, fallbackAlpha = 0.2) {
    if (!color) {
        return null;
    }
    if (color.startsWith("#")) {
        const hex = color.slice(1);
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${fallbackAlpha})`;
    }
    const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (m) {
        const r = Number(m[1]);
        const g = Number(m[2]);
        const b = Number(m[3]);
        const a = m[4] !== undefined ? Number(m[4]) : fallbackAlpha;
        return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    return color;
}

function getNodeAccentColor(node) {
    const raw = node?.bgcolor ?? node?.color ?? node?.constructor?.bgcolor ?? node?.constructor?.color;
    return normalizeCssColor(raw);
}

function getGroupAccentColor(group) {
    const raw = group?.bgcolor ?? group?.color;
    return normalizeCssColor(raw);
}

// (duplicate helper block removed)

function toggleNodeVisibility(nodeId, hidden) {
    if (!currentWorkflowKey) {
        currentWorkflowKey = computeWorkflowKey(getGraphNodes());
    }
    setNodeHidden(currentWorkflowKey, nodeId, hidden);
    if (hidden && !showHiddenItems && selectedNodeId === nodeId) {
        selectedNodeId = null;
    }
    renderWorkflow(true);
}

function toggleGroupVisibility(sectionId, hidden) {
    if (!currentWorkflowKey) {
        currentWorkflowKey = computeWorkflowKey(getGraphNodes());
    }
    setGroupHidden(currentWorkflowKey, sectionId, hidden);
    if (hidden && !showHiddenItems) {
        selectedNodeId = null;
    }
    renderWorkflow(true);
}

function renderNodeDetails(node) {
    const panel = document.getElementById(DETAILS_ID);
    const placeholder = document.getElementById("responsive-overlay-placeholder");
    if (!panel) {
        return;
    }
    panel.innerHTML = "";

    if (!node) {
        if (placeholder) {
            panel.appendChild(placeholder);
        } else {
            panel.appendChild($el("p", { className: "responsive-overlay__empty" }, ["Select a node from the list to view and edit its widgets."]));
        }
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
        // Detect rgthree Seed button widgets and the actual seed widget
        const normalize = (s) => String(s || "").trim().toLowerCase();
        const isButtonLabel = (label) => {
            const t = normalize(label);
            return t.includes("randomize each time") || t.includes("new fixed random") || t.includes("previous seed") || t.includes("use last queued seed");
        };

        const seedWidget = widgets.find((w) => normalize(w?.name) === "seed" || (typeof w?.value === "number" && normalize(w?.name).includes("seed"))) || null;
        const hasRgthreeSeedButtons = widgets.some((w) => isButtonLabel(w?.name) || isButtonLabel(w?.label));

        widgets.forEach((widget, index) => {
            if (!widget) {
                return;
            }

            const descriptor = getWidgetDescriptor(widget, index);

            // Skip rendering of rgthree label-only rows; we will render a single seed row instead
            if (hasRgthreeSeedButtons && widget !== seedWidget && (isButtonLabel(descriptor.label) || isButtonLabel(widget?.name))) {
                return;
            }

            // Build widget label and optional rgthree Seed actions
            const row = $el("label", { className: "responsive-overlay__widget" }, []);

            const rawLabel = String(descriptor.label ?? "");
            const attachRgthreeButtons = hasRgthreeSeedButtons && widget === seedWidget;
            const baseLabelText = attachRgthreeButtons ? (normalize(seedWidget?.name) || "seed").replace(/^./, (c) => c.toUpperCase()) : rawLabel;

            row.appendChild($el("span", { className: "responsive-overlay__widget-label" }, [baseLabelText]));

            if (attachRgthreeButtons) {
                const actions = $el("div", { className: "responsive-overlay__widget-buttons" }, []);

                const makeBtn = (label, title, handler) => {
                    const btn = $el("button", { type: "button", className: "responsive-overlay__widget-button", title }, [label]);
                    btn.addEventListener("click", (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        handler();
                    });
                    return btn;
                };

                const asInt = (v) => {
                    const n = typeof v === "number" ? v : parseInt(String(v), 10);
                    return Number.isFinite(n) ? n : 0;
                };

                // 🎲 Randomize each time → set seed to -1 (ComfyUI convention for random each run)
                actions.appendChild(
                    makeBtn("🎲 Randomize each time", "Set seed to randomize on each execution", () => {
                        if (seedWidget) {
                            previousSeedByWidget.set(seedWidget, asInt(seedWidget.value));
                            updateWidgetValue(node, seedWidget, -1);
                            scheduleOverlayRefresh(true);
                        }
                    })
                );

                // 🎲 New Fixed Random → generate a new fixed random 32-bit int and set it
                actions.appendChild(
                    makeBtn("🎲 New Fixed Random", "Generate a new fixed random seed", () => {
                        if (seedWidget) {
                            const current = asInt(seedWidget.value);
                            if (current !== -1) {
                                previousSeedByWidget.set(seedWidget, current);
                            }
                            // Generate signed 32-bit integer
                            const newSeed = (Math.floor(Math.random() * 0xffffffff) | 0);
                            updateWidgetValue(node, seedWidget, newSeed);
                            scheduleOverlayRefresh(true);
                        }
                    })
                );

                // ♻️ {previous seed} → restore previously stored seed if available
                actions.appendChild(
                    makeBtn("♻️ previous seed", "Restore the previous fixed seed", () => {
                        if (seedWidget) {
                            const prev = previousSeedByWidget.get(seedWidget);
                            if (prev !== undefined) {
                                updateWidgetValue(node, seedWidget, prev);
                                scheduleOverlayRefresh(true);
                            }
                        }
                    })
                );

                // Add live seed display (read-only)
                const currentSeedGetter = () => {
                    return seedWidget?.value ?? "";
                };
                const seedDisplay = $el("span", { className: "responsive-overlay__seed-display" }, [String(currentSeedGetter())]);

                const refreshSeedDisplay = () => {
                    seedDisplay.textContent = String(currentSeedGetter());
                };

                actions.appendChild(seedDisplay);
                row.appendChild(actions);
                // Keep display in sync after overlay refresh
                const observer = new MutationObserver(() => refreshSeedDisplay());
                observer.observe(row, { childList: true, subtree: true });
            }

            let input;

            // For rgthree seed, we skip creating input and show only buttons + display
            const skipInputForRgthree = attachRgthreeButtons === true;

            switch (skipInputForRgthree ? "__skip__" : descriptor.control) {
                case "__skip__":
                    input = null; // only show buttons + display
                    break;
                case "select":
                    input = $el("select", {
                        className: "responsive-overlay__widget-input",
                        value: descriptor.value ?? ""
                    }, (descriptor.options || []).map((option) => $el("option", {
                        value: option?.value ?? option,
                        selected: (option?.value ?? option) === descriptor.value
                    }, [option?.label ?? String(option?.value ?? option ?? "")])));
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
                    if (!skipInputForRgthree) {
                        input.addEventListener("change", (event) => {
                            const parsed = parseFloat(event.target.value);
                            updateWidgetValue(node, widget, Number.isNaN(parsed) ? widget.value : parsed);
                        });
                    } else {
                        input.readOnly = true;
                    }
                    break;
                }
                case "checkbox":
                    input = $el("input", {
                        className: "responsive-overlay__widget-input",
                        type: "checkbox",
                        checked: !!descriptor.value,
                        disabled: skipInputForRgthree ? true : false
                    });
                    if (!skipInputForRgthree) {
                        input.addEventListener("change", (event) => {
                            updateWidgetValue(node, widget, event.target.checked);
                        });
                    }
                    break;
                case "image": {
                    input = createImageWidgetControls(node, widget, descriptor);
                    break;
                }
                default:
                    if (!skipInputForRgthree) {
                        input = $el("textarea", {
                            className: "responsive-overlay__widget-input responsive-overlay__widget-textarea",
                            value: descriptor.value ?? ""
                        });
                        input.addEventListener("input", (event) => {
                            updateWidgetValue(node, widget, event.target.value);
                        });
                    } else {
                        input = null; // skip seed button rows
                    }
            }

            if (input) {
                row.appendChild(input);
            }
            widgetContainer.appendChild(row);
        });
    }

    const mediaPreviews = collectNodeMediaPreviews(node);

    panel.appendChild(header);
    panel.appendChild(widgetContainer);

    if (mediaPreviews.length) {
        const previewList = $el("div", { className: "responsive-overlay__node-preview-grid" }, []);

        mediaPreviews.forEach((item) => {
            const figure = $el("figure", {
                className: "responsive-overlay__node-preview",
                dataset: { mediaKind: item.kind }
            }, []);

            const mediaAttributes = item.kind === "video"
                ? { preload: "metadata", playsinline: "true", muted: "true" }
                : { loading: "lazy" };

            const mediaEl = createPreviewElement(item, mediaAttributes);
            mediaEl.classList.add("responsive-overlay__node-preview-media");
            if (mediaEl.tagName === "VIDEO") {
                mediaEl.muted = true;
                mediaEl.controls = true;
                mediaEl.loop = false;
            }
            mediaEl.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                openLightboxMedia(item);
            });

            figure.appendChild(mediaEl);
            figure.appendChild($el("figcaption", { className: "responsive-overlay__node-preview-caption" }, [
                item.label || item.filename || "Preview"
            ]));

            figure.addEventListener("click", (event) => {
                event.preventDefault();
                openLightboxMedia(item);
            });

            previewList.appendChild(figure);
        });

        panel.appendChild($el("section", { className: "responsive-overlay__node-previews" }, [
            $el("h4", { className: "responsive-overlay__node-preview-heading" }, ["Node Preview"]),
            previewList
        ]));
    }
}

export function setSelectedNode(nodeId) {
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

export function openLightbox(item) {
    if (item) {
        openLightboxMedia(item);
    }
}

export function closeLightbox() {
    closeLightboxMedia();
}

function createImageWidgetControls(node, widget, descriptor) {
    const wrapper = $el("div", { className: "responsive-overlay__file-input" }, []);
    const value = typeof descriptor.value === "string" ? descriptor.value : "";

    const actions = $el("div", { className: "responsive-overlay__file-actions" }, []);
    const chooseButton = $el("button", { type: "button", className: "responsive-overlay__file-button" }, ["Choose File"]);
    const pasteButton = $el("button", { type: "button", className: "responsive-overlay__file-button" }, ["Paste URL"]);

    const fileInput = $el("input", {
        type: "file",
        accept: descriptor.attributes?.accept || "image/*",
        className: "responsive-overlay__file-hidden"
    });

    const urlInput = $el("input", {
        type: "text",
        className: "responsive-overlay__widget-input responsive-overlay__widget-input--readonly",
        placeholder: "No file selected",
        value
    });
    urlInput.classList.toggle("responsive-overlay__widget-input--empty", !value);

    const resetState = () => {
        fileInput.value = "";
    };

    chooseButton.addEventListener("click", () => {
        fileInput.click();
    });

    fileInput.addEventListener("change", async (event) => {
        const file = event.target?.files?.[0];
        if (!file) {
            return;
        }

        const originalText = chooseButton.textContent;
        chooseButton.disabled = true;
        chooseButton.textContent = "Uploading…";

        try {
            const uploadResult = await uploadImageFile(node, widget, file, descriptor);
            if (uploadResult && uploadResult.value !== undefined) {
                urlInput.value = uploadResult.displayValue ?? uploadResult.value ?? "";
                urlInput.classList.toggle("responsive-overlay__widget-input--empty", !urlInput.value);
                updateWidgetValue(node, widget, uploadResult.value);
                scheduleOverlayRefresh(true);
            }
        } catch (error) {
            console.error(`[${EXTENSION_NAME}] Failed to upload image`, error);
        } finally {
            chooseButton.disabled = false;
            chooseButton.textContent = originalText;
            resetState();
        }
    });

    pasteButton.addEventListener("click", async () => {
        let clipboardText = "";
        if (navigator.clipboard?.readText) {
            try {
                clipboardText = await navigator.clipboard.readText();
            } catch (error) {
                console.warn(`[${EXTENSION_NAME}] Unable to read clipboard`, error);
            }
        }

        const promptValue = window.prompt("Enter image URL or path", clipboardText || value || "");
        if (!promptValue) {
            return;
        }

        urlInput.value = promptValue;
        urlInput.classList.toggle("responsive-overlay__widget-input--empty", !promptValue);
        updateWidgetValue(node, widget, promptValue);
        scheduleOverlayRefresh(true);
    });

    actions.appendChild(chooseButton);
    actions.appendChild(pasteButton);

    wrapper.appendChild(urlInput);
    wrapper.appendChild(actions);
    wrapper.appendChild(fileInput);

    return wrapper;
}

async function uploadImageFile(node, widget, file, descriptor) {
    if (!file) {
        return null;
    }

    const form = new FormData();
    form.append("image", file, file.name);

    const uploadType = descriptor?.attributes?.uploadType || widget?.uploadType || widget?.typeDir || "input";
    if (uploadType) {
        form.append("type", uploadType);
    }

    const subfolder = descriptor?.attributes?.subfolder;
    if (subfolder) {
        form.append("subfolder", subfolder);
    }

    form.append("overwrite", "true");

    try {
        const response = await api.fetchApi("/upload/image", {
            method: "POST",
            body: form
        });
        if (response && typeof response === "object") {
            const value = response.filename || response.name || response.path || response.file || file.name;
            return {
                value,
                displayValue: value
            };
        }
    } catch (error) {
        console.error(`[${EXTENSION_NAME}] Upload request failed`, error);
        throw error;
    }

    return null;
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

export function scheduleOverlayRefresh(force = false) {
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

export function triggerGenerate() {
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
