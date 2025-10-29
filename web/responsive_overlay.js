import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { $el } from "../../scripts/ui.js";
import { summarizeWorkflow, mapNodeToDisplay, getWidgetDescriptor } from "./utils/responsive_overlay_utils.js";
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
} from "./utils/responsive_overlay_storage.js";
import {
    configureMediaTargets,
    handleExecutionOutput,
    renderOutputs,
    openLightboxMedia,
    closeLightboxMedia,
    createPreviewElement
} from "./utils/responsive_overlay_media.js";
import { collectNodeMediaPreviews } from "./utils/responsive_overlay_node_media.js";

const EXTENSION_NAME = "ComfyUI.ResponsiveOverlay";
const TOGGLE_ID = "responsive-overlay-toggle";
const OVERLAY_ID = "responsive-overlay-root";
const LIST_ID = "responsive-overlay-nodes";
const DETAILS_ID = "responsive-overlay-details";
const OUTPUTS_ID = "responsive-overlay-outputs";
const RESULTS_GRID_ID = "responsive-overlay-results-grid";
const CURRENT_OUTPUT_ID = "responsive-overlay-current-output";
const CURRENT_MEDIA_ID = "responsive-overlay-current-media";
const HIDDEN_TOGGLE_ID = "responsive-overlay-hidden-toggle";
const PROGRESS_BAR_ID = "responsive-overlay-progress";
const PROGRESS_FILL_ID = "responsive-overlay-progress-fill";
const PROGRESS_TEXT_ID = "responsive-overlay-progress-text";

const ACTIVE_CLASS = "responsive-overlay-is-open";
const SELECTED_CLASS = "responsive-overlay__node--selected";
const LAYOUT_STORAGE_KEY = `${EXTENSION_NAME}.layout.v1`;
const MIN_REGION_RATIO = 0.18;
const STACK_LAYOUT_BREAKPOINT = 1100;
const DEFAULT_LAYOUT_SIZES = {
    outputs: 0.36,
    details: 0.32,
    nodes: 0.32
};

let selectedNodeId = null;
let lastWorkflowSignature = "";
let currentWorkflowKey = "";
let scheduledRefresh = false;
let pendingRefreshForce = false;
let draggedNodeId = null;
let draggedSectionId = null;

const nodeStatuses = new Map();
const nodeTitleCache = new Map();
let regionLayoutSizes = loadLayoutSizes();
let layoutResizeListenerBound = false;
let isLayoutDragging = false;
let focusScrollListenerBound = false;
let showHiddenItems = false;
normalizeLayoutSizes();

const executionTracking = {
    active: false,
    promptId: null,
    totalNodes: 0,
    completed: 0,
    currentNodeId: null,
    currentNodeLabel: '',
    currentNodeProgress: { value: 0, max: 1 },
    percent: 0,
    errorNodeId: null
};

function loadLayoutSizes() {
    if (typeof window === "undefined") {
        return { ...DEFAULT_LAYOUT_SIZES };
    }
    try {
        const stored = window.localStorage?.getItem(LAYOUT_STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            const normalized = { ...DEFAULT_LAYOUT_SIZES };
            Object.keys(DEFAULT_LAYOUT_SIZES).forEach((key) => {
                const value = Number(parsed?.[key]);
                if (Number.isFinite(value) && value > 0) {
                    normalized[key] = value;
                }
            });
            return normalized;
        }
    } catch (error) {
        console.warn(`[${EXTENSION_NAME}] Failed to load layout settings`, error);
    }
    return { ...DEFAULT_LAYOUT_SIZES };
}

function persistLayoutSizes() {
    if (typeof window === "undefined") {
        return;
    }
    try {
        window.localStorage?.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(regionLayoutSizes));
    } catch (error) {
        console.warn(`[${EXTENSION_NAME}] Failed to persist layout settings`, error);
    }
}

function normalizeLayoutSizes() {
    const keys = Object.keys(DEFAULT_LAYOUT_SIZES);
    let total = 0;
    keys.forEach((key) => {
        const value = Number(regionLayoutSizes?.[key]);
        regionLayoutSizes[key] = Number.isFinite(value) && value > 0 ? value : DEFAULT_LAYOUT_SIZES[key];
        total += regionLayoutSizes[key];
    });
    if (total <= 0) {
        keys.forEach((key) => {
            regionLayoutSizes[key] = DEFAULT_LAYOUT_SIZES[key];
        });
        total = keys.reduce((sum, key) => sum + regionLayoutSizes[key], 0);
    }
    keys.forEach((key) => {
        regionLayoutSizes[key] = regionLayoutSizes[key] / total;
    });

    let deficit = 0;
    keys.forEach((key) => {
        if (regionLayoutSizes[key] < MIN_REGION_RATIO) {
            deficit += MIN_REGION_RATIO - regionLayoutSizes[key];
            regionLayoutSizes[key] = MIN_REGION_RATIO;
        }
    });

    if (deficit > 0) {
        const adjustableKeys = keys.filter((key) => regionLayoutSizes[key] > MIN_REGION_RATIO);
        let pool = adjustableKeys.reduce((sum, key) => sum + (regionLayoutSizes[key] - MIN_REGION_RATIO), 0);
        if (pool <= 0) {
            keys.forEach((key) => {
                regionLayoutSizes[key] = DEFAULT_LAYOUT_SIZES[key];
            });
            normalizeLayoutSizes();
            return;
        }
        adjustableKeys.forEach((key) => {
            const extra = regionLayoutSizes[key] - MIN_REGION_RATIO;
            const reduction = (extra / pool) * deficit;
            regionLayoutSizes[key] = Math.max(MIN_REGION_RATIO, regionLayoutSizes[key] - reduction);
        });
    }

    const finalTotal = keys.reduce((sum, key) => sum + regionLayoutSizes[key], 0);
    keys.forEach((key) => {
        regionLayoutSizes[key] = regionLayoutSizes[key] / finalTotal;
    });
}

function applyLayoutSizes(root = document.getElementById(OVERLAY_ID), options = {}) {
    const { skipNormalize = false } = options;
    if (!root) {
        return;
    }
    if (!isStackedLayout(root)) {
        clearRegionFlexStyles(root);
        return;
    }
    if (!skipNormalize) {
        normalizeLayoutSizes();
    }
    const body = root.querySelector(".responsive-overlay__body");
    if (!body) {
        return;
    }
    Object.entries(regionLayoutSizes).forEach(([key, value]) => {
        const region = body.querySelector(`[data-region="${key}"]`);
        if (region) {
            region.style.flexGrow = value;
            region.style.flexBasis = `${(value * 100).toFixed(2)}%`;
        }
    });
}

function initializeLayoutResizers(root) {
    if (!root || root.dataset.layoutInitialized === "true") {
        return;
    }
    const body = root.querySelector(".responsive-overlay__body");
    if (!body) {
        return;
    }

    const handlePointerDown = (event) => {
        if (typeof window === "undefined") {
            return;
        }
        if (!isStackedLayout(root)) {
            return;
        }
        const divider = event.currentTarget;
        const prevKey = divider?.dataset?.prevRegion;
        const nextKey = divider?.dataset?.nextRegion;
        if (!prevKey || !nextKey) {
            return;
        }
        const bodyRect = body.getBoundingClientRect();
        const totalHeight = bodyRect.height;
        if (totalHeight <= 0) {
            return;
        }

        event.preventDefault();
        divider.setPointerCapture?.(event.pointerId);
        root.classList.add("responsive-overlay--resizing");

        const prevStartRatio = regionLayoutSizes[prevKey];
        const nextStartRatio = regionLayoutSizes[nextKey];
        const combinedRatio = prevStartRatio + nextStartRatio;
        if (combinedRatio <= MIN_REGION_RATIO * 2) {
            divider.releasePointerCapture?.(event.pointerId);
            root.classList.remove("responsive-overlay--resizing");
            return;
        }

        isLayoutDragging = true;

        const startY = event.clientY;
        const minRatio = MIN_REGION_RATIO;

        const onPointerMove = (moveEvent) => {
            if (moveEvent.buttons === 0) {
                onPointerUp();
                return;
            }
            const deltaY = moveEvent.clientY - startY;
            const deltaRatio = deltaY / totalHeight;
            let newPrevRatio = clamp(prevStartRatio + deltaRatio, minRatio, combinedRatio - minRatio);
            if (!Number.isFinite(newPrevRatio)) {
                return;
            }
            const newNextRatio = combinedRatio - newPrevRatio;
            regionLayoutSizes[prevKey] = newPrevRatio;
            regionLayoutSizes[nextKey] = newNextRatio;
            applyLayoutSizes(root, { skipNormalize: true });
        };

        const onPointerUp = () => {
            if (!isLayoutDragging) {
                return;
            }
            divider.releasePointerCapture?.(event.pointerId);
            root.classList.remove("responsive-overlay--resizing");
            isLayoutDragging = false;
            normalizeLayoutSizes();
            applyLayoutSizes(root);
            persistLayoutSizes();
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
            window.removeEventListener("pointercancel", onPointerUp);
        };

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp, { once: true });
        window.addEventListener("pointercancel", onPointerUp, { once: true });
    };

    body.querySelectorAll(".responsive-overlay__divider").forEach((divider) => {
        divider.addEventListener("pointerdown", handlePointerDown, { passive: false });
    });

    root.dataset.layoutInitialized = "true";

    if (!layoutResizeListenerBound && typeof window !== "undefined") {
        window.addEventListener("resize", () => {
            const rootEl = document.getElementById(OVERLAY_ID);
            if (!rootEl) {
                return;
            }
            if (!isStackedLayout(rootEl)) {
                clearRegionFlexStyles(rootEl);
                return;
            }
            if (isLayoutDragging) {
                return;
            }
            applyLayoutSizes(rootEl);
        });
        layoutResizeListenerBound = true;
    }
}

function clamp(value, min, max) {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.max(min, Math.min(max, value));
}

function isStackedLayout(root = document.getElementById(OVERLAY_ID)) {
    if (typeof window === "undefined") {
        return true;
    }
    const width = root?.offsetWidth || window.innerWidth;
    return width < STACK_LAYOUT_BREAKPOINT;
}

function clearRegionFlexStyles(root) {
    const body = root.querySelector(".responsive-overlay__body");
    if (!body) {
        return;
    }
    body.querySelectorAll(".responsive-overlay__region").forEach((region) => {
        region.style.removeProperty("flex-grow");
        region.style.removeProperty("flex-basis");
    });
}

function toggleHiddenFilter() {
    showHiddenItems = !showHiddenItems;
    updateHiddenToggleButton();
    renderWorkflow(true);
}

function updateHiddenToggleButton() {
    const button = document.getElementById(HIDDEN_TOGGLE_ID);
    if (!button) {
        return;
    }
    if (showHiddenItems) {
        button.textContent = "Hide Hidden";
        button.classList.add("responsive-overlay__filter--active");
    } else {
        button.textContent = "Show Hidden";
        button.classList.remove("responsive-overlay__filter--active");
    }
    button.setAttribute("aria-pressed", String(showHiddenItems));
}

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

function setupFocusScrollHandling(root) {
    if (!root || focusScrollListenerBound) {
        return;
    }

    const handleFocus = (event) => {
        const target = event.target;
        if (!target || !(target instanceof HTMLElement)) {
            return;
        }
        const tagName = target.tagName;
        if (!["INPUT", "TEXTAREA", "SELECT"].includes(tagName)) {
            return;
        }

        requestAnimationFrame(() => {
            ensureFieldVisible(target);
        });
    };

    root.addEventListener("focusin", handleFocus, true);
    focusScrollListenerBound = true;
}

function ensureFieldVisible(element) {
    if (!element || typeof window === "undefined") {
        return;
    }

    const scrollParent = findScrollableParent(element);
    if (!scrollParent) {
        element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        return;
    }

    const parentRect = scrollParent.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const buffer = 32;

    if (elementRect.bottom > parentRect.bottom - buffer) {
        const delta = elementRect.bottom - parentRect.bottom + buffer;
        const targetTop = scrollParent.scrollTop + delta;
        if (typeof scrollParent.scrollTo === "function") {
            scrollParent.scrollTo({ top: targetTop, behavior: "smooth" });
        } else {
            scrollParent.scrollTop = targetTop;
        }
    } else if (elementRect.top < parentRect.top + buffer) {
        const delta = parentRect.top - elementRect.top + buffer;
        const targetTop = Math.max(0, scrollParent.scrollTop - delta);
        if (typeof scrollParent.scrollTo === "function") {
            scrollParent.scrollTo({ top: targetTop, behavior: "smooth" });
        } else {
            scrollParent.scrollTop = targetTop;
        }
    }
}

function findScrollableParent(element) {
    let current = element.parentElement;
    while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        const overflowY = style.overflowY;
        const isScrollable = overflowY === "auto" || overflowY === "scroll";
        if (isScrollable && current.scrollHeight > current.clientHeight + 4) {
            return current;
        }
        current = current.parentElement;
    }
    return document.scrollingElement || document.documentElement;
}

function normalizeNodeId(value) {
    if (value === undefined || value === null) {
        return null;
    }
    const str = String(value);
    const colonIndex = str.indexOf(':');
    return colonIndex === -1 ? str : str.slice(0, colonIndex);
}

function getNodeTitle(nodeId) {
    if (nodeTitleCache.has(nodeId)) {
        return nodeTitleCache.get(nodeId);
    }
    const graph = app.graph;
    let node = null;
    if (graph) {
        node = graph.getNodeById?.(Number(nodeId)) || graph._nodes?.find((n) => String(n.id) === nodeId) || null;
    }
    const title = node?.title || node?.type || `Node ${nodeId}`;
    nodeTitleCache.set(nodeId, title);
    return title;
}

function setNodeTitleCache(nodeId, title) {
    if (!nodeId) {
        return;
    }
    nodeTitleCache.set(String(nodeId), title || getNodeTitle(String(nodeId)));
}

function initializeNodeStatuses(nodes) {
    nodeStatuses.clear();
    nodes.forEach((node) => {
        const id = String(node.id);
        nodeStatuses.set(id, { state: executionTracking.active ? 'pending' : 'idle', progress: null });
    });
    updateNodeStatusDisplayAll();
}

function setNodeStatus(nodeId, state, progress) {
    if (!nodeId) {
        return;
    }
    const id = String(nodeId);
    const current = nodeStatuses.get(id) || { state: 'idle', progress: null };
    const next = {
        state: state ?? current.state,
        progress: progress !== undefined ? progress : current.progress
    };
    nodeStatuses.set(id, next);
    updateNodeStatusDisplay(id);
    if (next.state === 'completed' || next.state === 'error' || current.state === 'completed' || current.state === 'error') {
        recalculateCompletedCount();
    } else if (next.state === 'running') {
        updateOverallProgress();
    }
}

function updateNodeStatusDisplayAll() {
    nodeStatuses.forEach((_value, nodeId) => updateNodeStatusDisplay(nodeId));
}

function updateNodeStatusDisplay(nodeId) {
    const selector = `[data-node-id="${CSS.escape(String(nodeId))}"]`;
    document.querySelectorAll(selector).forEach((button) => {
        applyStatusClasses(button, nodeStatuses.get(String(nodeId)) || { state: 'idle', progress: null });
    });
}

function applyStatusClasses(button, status) {
    if (!button) {
        return;
    }
    button.classList.remove('responsive-overlay__node--running', 'responsive-overlay__node--completed', 'responsive-overlay__node--error');
    if (!status) {
        removeNodeProgressBar(button);
        return;
    }
    switch (status.state) {
        case 'running':
            button.classList.add('responsive-overlay__node--running');
            updateNodeProgressBar(button, status.progress);
            break;
        case 'completed':
            button.classList.add('responsive-overlay__node--completed');
            removeNodeProgressBar(button);
            break;
        case 'error':
            button.classList.add('responsive-overlay__node--error');
            removeNodeProgressBar(button);
            break;
        case 'pending':
        default:
            removeNodeProgressBar(button);
            break;
    }
}

function updateNodeProgressBar(button, progress) {
    const percent = progress && progress.max ? Math.min(1, Math.max(0, progress.value / progress.max)) : 0;
    let bar = button.querySelector('.responsive-overlay__node-progress');
    if (percent <= 0) {
        if (bar) {
            bar.remove();
        }
        return;
    }
    if (!bar) {
        bar = document.createElement('div');
        bar.className = 'responsive-overlay__node-progress';
        button.prepend(bar);
    }
    bar.style.width = `${percent * 100}%`;
}

function removeNodeProgressBar(button) {
    const bar = button.querySelector('.responsive-overlay__node-progress');
    if (bar) {
        bar.remove();
    }
}

function resetExecutionTracking() {
    executionTracking.active = false;
    executionTracking.promptId = null;
    executionTracking.totalNodes = 0;
    executionTracking.completed = 0;
    executionTracking.currentNodeId = null;
    executionTracking.currentNodeLabel = '';
    executionTracking.currentNodeProgress = { value: 0, max: 1 };
    executionTracking.percent = 0;
    executionTracking.errorNodeId = null;
    updateProgressBar();
}

function updateProgressBar() {
    const bar = document.getElementById(PROGRESS_BAR_ID);
    const fill = document.getElementById(PROGRESS_FILL_ID);
    const label = document.getElementById(PROGRESS_TEXT_ID);
    if (!bar || !fill || !label) {
        return;
    }
    if (!executionTracking.active) {
        bar.classList.add('hidden');
        fill.style.width = '0%';
        label.textContent = '';
        return;
    }
    bar.classList.remove('hidden');
    const percent = Math.max(0, Math.min(1, executionTracking.percent || 0));
    fill.style.width = `${percent * 100}%`;
    label.textContent = executionTracking.currentNodeLabel ? `${Math.round(percent * 100)}% — ${executionTracking.currentNodeLabel}` : `${Math.round(percent * 100)}%`;
}

function updateOverallProgress() {
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

function recalculateCompletedCount() {
    let count = 0;
    nodeStatuses.forEach((status) => {
        if (status.state === 'completed') {
            count += 1;
        }
    });
    executionTracking.completed = count;
    updateOverallProgress();
}

function setCurrentRunningNode(nodeId, progress) {
    if (!nodeId) {
        executionTracking.currentNodeId = null;
        executionTracking.currentNodeLabel = '';
        executionTracking.currentNodeProgress = { value: 0, max: 1 };
        updateOverallProgress();
        return;
    }
    executionTracking.currentNodeId = String(nodeId);
    executionTracking.currentNodeLabel = getNodeTitle(String(nodeId));
    executionTracking.currentNodeProgress = progress || { value: 0, max: 1 };
    updateOverallProgress();
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
            $el("div", { id: PROGRESS_BAR_ID, className: "responsive-overlay__progress hidden" }, [
                $el("div", { className: "responsive-overlay__progress-track" }, [
                    $el("div", { className: "responsive-overlay__progress-fill", id: PROGRESS_FILL_ID }, []),
                    $el("span", { className: "responsive-overlay__progress-label", id: PROGRESS_TEXT_ID }, [])
                ])
            ]),
                $el("div", {
                id: "responsive-overlay-lightbox",
                className: "responsive-overlay__lightbox hidden",
                onclick: (event) => {
                    if (event.target === event.currentTarget) {
                        closeLightbox();
                    }
                }
            }, [
                $el("div", { className: "responsive-overlay__lightbox-content" }, [
                    $el("button", {
                        className: "responsive-overlay__lightbox-close",
                        onclick: (event) => {
                            event.preventDefault();
                            closeLightbox();
                        }
                    }, ["✕"]),
                    $el("div", { id: "responsive-overlay-lightbox-media", className: "responsive-overlay__lightbox-media" }, []),
                    $el("div", { id: "responsive-overlay-lightbox-meta", className: "responsive-overlay__lightbox-meta" }, [])
                ])
            ]),
        $el("header", { className: "responsive-overlay__header" }, [
                $el("div", { className: "responsive-overlay__header-group" }, [
                    $el("h2", {}, ["Workflow Overview"]),
                    $el("span", { className: "responsive-overlay__summary", id: "responsive-overlay-summary" }, ["No workflow loaded"])
                ]),
                $el("div", { className: "responsive-overlay__header-actions" }, [
                    $el("button", {
                        id: HIDDEN_TOGGLE_ID,
                        className: "responsive-overlay__filter",
                        "aria-pressed": "false",
                        onclick: (event) => {
                            event.preventDefault();
                            toggleHiddenFilter();
                        }
                    }, ["Show Hidden"]),
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
                $el("section", { className: "responsive-overlay__region responsive-overlay__region--outputs", dataset: { region: "outputs" } }, [
                    $el("div", { className: "responsive-overlay__region-content" }, [
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
                ]),
                $el("div", { className: "responsive-overlay__divider", dataset: { prevRegion: "outputs", nextRegion: "details" } }, [
                    $el("span", { className: "responsive-overlay__divider-handle" })
                ]),
                $el("section", { className: "responsive-overlay__region responsive-overlay__region--details", dataset: { region: "details" } }, [
                    $el("div", { className: "responsive-overlay__region-content" }, [
                        $el("main", { className: "responsive-overlay__content" }, [
                            $el("section", { id: DETAILS_ID, className: "responsive-overlay__panel" }, [
                                $el("h3", {}, ["Node Details"]),
                                $el("p", { id: "responsive-overlay-placeholder" }, ["Select a node from the list to view and edit its widgets."])
                            ])
                        ])
                    ])
                ]),
                $el("div", { className: "responsive-overlay__divider", dataset: { prevRegion: "details", nextRegion: "nodes" } }, [
                    $el("span", { className: "responsive-overlay__divider-handle" })
                ]),
                $el("section", { className: "responsive-overlay__region responsive-overlay__region--nodes", dataset: { region: "nodes" } }, [
                    $el("div", { className: "responsive-overlay__region-content" }, [
                        $el("aside", { className: "responsive-overlay__sidebar", id: LIST_ID }, [])
                    ])
                ])
            ])
        ])
    ]);

    document.body.appendChild(root);
    initializeLayoutResizers(root);
    setupFocusScrollHandling(root);
    applyLayoutSizes(root);
    updateHiddenToggleButton();
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
        if (!nodeStatuses.has(idStr)) {
            nodeStatuses.set(idStr, { state: executionTracking.active ? "pending" : "idle", progress: null });
        }
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
                    }, [groupHidden ? "👁‍🗨" : "👁"])
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
            setNodeTitleCache(nodeId, display.title || display.type);
            const button = $el("button", {
                className: "responsive-overlay__node",
                dataset: { nodeId: String(nodeId), sectionId },
                draggable: section.type === "group" ? !collapsed : true,
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

            if (section.type === "group" && !collapsed) {
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
            } else if (section.type === "single") {
                button.addEventListener("dragstart", (event) => {
                    draggedSectionId = sectionId;
                    draggedNodeId = null;
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", sectionId);
                });
                button.addEventListener("dragend", () => {
                    draggedSectionId = null;
                });
                button.addEventListener("dragover", (event) => {
                    if (!draggedSectionId || draggedSectionId === sectionId) {
                        return;
                    }
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    button.classList.add("responsive-overlay__node--dragover");
                });
                button.addEventListener("dragleave", () => {
                    button.classList.remove("responsive-overlay__node--dragover");
                });
                button.addEventListener("drop", (event) => {
                    if (!draggedSectionId || draggedSectionId === sectionId) {
                        return;
                    }
                    event.preventDefault();
                    button.classList.remove("responsive-overlay__node--dragover");
                    reorderSections(draggedSectionId, sectionId);
                    draggedSectionId = null;
                });
            }

            if (nodeHidden) {
                button.classList.add("responsive-overlay__node--hidden");
                button.dataset.hidden = "true";
            }

            const visibilityToggle = $el("span", {
                className: "responsive-overlay__visibility responsive-overlay__visibility--node",
                role: "button",
                tabIndex: 0,
                title: nodeHidden ? "Show node" : "Hide node"
            }, [nodeHidden ? "👁‍🗨" : "👁"]);

            const handleToggle = (event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleNodeVisibility(nodeId, !nodeHidden);
            };

            visibilityToggle.addEventListener("click", handleToggle);
            visibilityToggle.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    handleToggle(event);
                }
            });

            button.appendChild(visibilityToggle);

            if (nodeId === selectedNodeId) {
                button.classList.add(SELECTED_CLASS);
            }

            applyStatusClasses(button, nodeStatuses.get(String(nodeId)) || { state: executionTracking.active ? "pending" : "idle", progress: null });

            itemsContainer.appendChild(button);
            if (!firstVisibleNodeId && (!nodeHidden || showHiddenItems)) {
                firstVisibleNodeId = nodeId;
            }
        });

        listEl.appendChild(sectionEl);
        renderedAnySection = true;
    });

    if (!renderedAnySection) {
        listEl.innerHTML = `
            <div class="responsive-overlay__empty">
                <p>No visible nodes. Toggle "Show Hidden" to manage hidden items.</p>
            </div>
        `;
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
                case "image": {
                    input = createImageWidgetControls(node, widget, descriptor);
                    break;
                }
                default:
                    input = $el("textarea", {
                        className: "responsive-overlay__widget-input responsive-overlay__widget-textarea",
                        value: descriptor.value ?? ""
                    });
                    input.addEventListener("input", (event) => {
                        updateWidgetValue(node, widget, event.target.value);
                    });
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

function openLightbox(item) {
    if (item) {
        openLightboxMedia(item);
    }
}

function closeLightbox() {
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
        updateHiddenToggleButton();
        applyLayoutSizes(root);
        renderWorkflow(true);
        renderOutputs();
    }
}

function handleExecutionStartEvent(event) {
    executionTracking.active = true;
    executionTracking.promptId = event?.detail?.prompt_id ?? null;
    const nodes = getGraphNodes();
    executionTracking.totalNodes = nodes.length || 0;
    executionTracking.completed = 0;
    executionTracking.currentNodeId = null;
    executionTracking.currentNodeLabel = '';
    executionTracking.currentNodeProgress = { value: 0, max: 1 };
    executionTracking.percent = 0;
    executionTracking.errorNodeId = null;
    initializeNodeStatuses(nodes);
    updateProgressBar();
}

function handleExecutionCachedEvent(event) {
    const nodes = event?.detail?.nodes || [];
    nodes.forEach((nodeId) => {
        const normalized = normalizeNodeId(nodeId);
        if (normalized) {
            setNodeStatus(normalized, 'completed');
        }
    });
    recalculateCompletedCount();
}

function handleExecutionSuccessEvent() {
    setCurrentRunningNode(null);
    executionTracking.active = false;
    updateOverallProgress();
}

function handleExecutionInterruptedEvent() {
    resetExecutionTracking();
}

function handleExecutionErrorEvent(event) {
    const nodeId = normalizeNodeId(event?.detail?.node_id || event?.detail?.display_node_id);
    if (nodeId) {
        setNodeStatus(nodeId, 'error');
        executionTracking.errorNodeId = nodeId;
    }
    setCurrentRunningNode(null);
    executionTracking.active = false;
    updateOverallProgress();
}

function handleExecutingEvent(event) {
    const detail = event?.detail;
    if (typeof detail === 'string' || typeof detail === 'number') {
        const nodeId = normalizeNodeId(detail);
        if (nodeId) {
            nodeStatuses.forEach((status, id) => {
                if (status.state === 'running' && id !== String(nodeId)) {
                    setNodeStatus(id, 'completed');
                }
            });
            setCurrentRunningNode(nodeId, executionTracking.currentNodeProgress);
            setNodeStatus(nodeId, 'running', executionTracking.currentNodeProgress);
        }
    } else {
        setCurrentRunningNode(null);
    }
}

function handleProgressEvent(event) {
    const detail = event?.detail;
    if (!detail) {
        return;
    }
    const nodeId = normalizeNodeId(detail.node ?? detail.node_id ?? executionTracking.currentNodeId);
    const progress = { value: detail.value ?? 0, max: detail.max ?? 1 };
    if (nodeId) {
        setCurrentRunningNode(nodeId, progress);
        setNodeStatus(nodeId, 'running', progress);
    } else if (executionTracking.currentNodeId) {
        setCurrentRunningNode(executionTracking.currentNodeId, progress);
        setNodeStatus(executionTracking.currentNodeId, 'running', progress);
    } else {
        updateOverallProgress();
    }
}

function handleProgressStateEvent(event) {
    const nodes = event?.detail?.nodes || {};
    let updated = false;
    for (const key in nodes) {
        const nodeState = nodes[key];
        const nodeId = normalizeNodeId(nodeState.display_node_id ?? nodeState.node_id ?? key);
        if (!nodeId) {
            continue;
        }
        switch (nodeState.state) {
            case 'running': {
                const progress = { value: nodeState.value ?? 0, max: nodeState.max ?? 1 };
                setCurrentRunningNode(nodeId, progress);
                setNodeStatus(nodeId, 'running', progress);
                updated = true;
                break;
            }
            case 'success':
            case 'completed':
            case 'done':
                setNodeStatus(nodeId, 'completed');
                updated = true;
                break;
            case 'error':
                setNodeStatus(nodeId, 'error');
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

function handleExecutedEvent(detail) {
    if (!detail) {
        return;
    }
    const nodeId = normalizeNodeId(detail.node_id || detail.display_node_id || detail.id);
    if (nodeId) {
        setNodeStatus(nodeId, 'completed');
        if (executionTracking.currentNodeId === nodeId) {
            setCurrentRunningNode(null);
        }
        recalculateCompletedCount();
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

        configureMediaTargets({
            currentMediaId: CURRENT_MEDIA_ID,
            outputsContainerId: OUTPUTS_ID,
            resultsGridId: RESULTS_GRID_ID
        });

        if (!root || !toggle) {
            console.warn(`[${EXTENSION_NAME}] Unable to bootstrap overlay UI.`);
            return;
        }

        window.addEventListener("keydown", handleKeyboardShortcuts);

        const registeredHandlers = [];
        if (api?.addEventListener) {
            const workflowHandler = () => scheduleOverlayRefresh(true);
            const graphHandler = () => scheduleOverlayRefresh();
            const executionStartHandler = (event) => handleExecutionStartEvent(event);
            const executionSuccessHandler = () => handleExecutionSuccessEvent();
            const executionInterruptedHandler = () => handleExecutionInterruptedEvent();
            const executionErrorHandler = (event) => handleExecutionErrorEvent(event);
            const executionCachedHandler = (event) => handleExecutionCachedEvent(event);
            const executingHandler = (event) => handleExecutingEvent(event);
            const progressHandler = (event) => handleProgressEvent(event);
            const progressStateHandler = (event) => handleProgressStateEvent(event);
            const executedHandler = (event) => {
                const detail = event?.detail ?? event;
                handleExecutedEvent(detail);
                handleExecutionOutput(detail);
            };

            api.addEventListener("workflowLoaded", workflowHandler);
            api.addEventListener("graphChanged", graphHandler);
            api.addEventListener("execution_start", executionStartHandler);
            api.addEventListener("execution_success", executionSuccessHandler);
            api.addEventListener("execution_interrupted", executionInterruptedHandler);
            api.addEventListener("execution_error", executionErrorHandler);
            api.addEventListener("execution_cached", executionCachedHandler);
            api.addEventListener("executing", executingHandler);
            api.addEventListener("progress", progressHandler);
            api.addEventListener("progress_state", progressStateHandler);
            api.addEventListener("executed", executedHandler);

            registeredHandlers.push(["workflowLoaded", workflowHandler]);
            registeredHandlers.push(["graphChanged", graphHandler]);
            registeredHandlers.push(["execution_start", executionStartHandler]);
            registeredHandlers.push(["execution_success", executionSuccessHandler]);
            registeredHandlers.push(["execution_interrupted", executionInterruptedHandler]);
            registeredHandlers.push(["execution_error", executionErrorHandler]);
            registeredHandlers.push(["execution_cached", executionCachedHandler]);
            registeredHandlers.push(["executing", executingHandler]);
            registeredHandlers.push(["progress", progressHandler]);
            registeredHandlers.push(["progress_state", progressStateHandler]);
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
