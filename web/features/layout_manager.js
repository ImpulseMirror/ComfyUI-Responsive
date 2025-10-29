import {
    DEFAULT_LAYOUT_SIZES,
    EXTENSION_NAME,
    LAYOUT_STORAGE_KEY,
    MIN_REGION_RATIO,
    OVERLAY_ID,
    SECTION_DEFINITIONS,
    SECTION_TABS_ID,
    STACK_LAYOUT_BREAKPOINT
} from "./constants.js";

let regionLayoutSizes = loadLayoutSizes();
let layoutResizeListenerBound = false;
let isLayoutDragging = false;
let activeRegion = SECTION_DEFINITIONS[0]?.id || "outputs";

let hiddenToggleUpdater = null;
let pullResetHandler = null;

normalizeLayoutSizes();

export function registerHiddenToggleUpdater(callback) {
    hiddenToggleUpdater = typeof callback === "function" ? callback : null;
}

export function registerPullResetHandler(callback) {
    pullResetHandler = typeof callback === "function" ? callback : null;
}

export function loadLayoutSizes() {
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

export function persistLayoutSizes() {
    if (typeof window === "undefined") {
        return;
    }
    try {
        window.localStorage?.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(regionLayoutSizes));
    } catch (error) {
        console.warn(`[${EXTENSION_NAME}] Failed to persist layout settings`, error);
    }
}

export function normalizeLayoutSizes() {
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

export function applyLayoutSizes(root = document.getElementById(OVERLAY_ID), options = {}) {
    if (!root) {
        return;
    }
    clearRegionFlexStyles(root);
}

export function initializeLayoutResizers(root) {
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
            applyLayoutSizes(root);
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
            updateLayoutMode(rootEl);
            if (isStackedLayout(rootEl)) {
                if (isLayoutDragging) {
                    return;
                }
                applyLayoutSizes(rootEl);
            } else {
                clearRegionFlexStyles(rootEl);
            }
        });
        layoutResizeListenerBound = true;
    }
}

export function setActiveRegion(regionId) {
    if (!SECTION_DEFINITIONS.some((entry) => entry.id === regionId)) {
        return;
    }
    activeRegion = regionId;
    updateLayoutMode();
    if (hiddenToggleUpdater) {
        hiddenToggleUpdater();
    }
}

export function getActiveRegion() {
    return activeRegion;
}

export function updateSectionTabs() {
    const container = document.getElementById(SECTION_TABS_ID);
    if (!container) {
        return;
    }
    const root = document.getElementById(OVERLAY_ID);
    const stacked = !!root?.classList.contains("responsive-overlay--stacked");
    container.classList.toggle("responsive-overlay__section-tabs--active", stacked);
    container.querySelectorAll("button").forEach((button) => {
        const region = button.dataset.region;
        const isActive = region === activeRegion;
        button.classList.toggle("responsive-overlay__section-tab--active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
    });
}

export function updateLayoutMode(root = document.getElementById(OVERLAY_ID)) {
    if (!root) {
        return;
    }
    const stacked = isStackedLayout(root);
    root.classList.toggle("responsive-overlay--stacked", stacked);
    const sections = root.querySelectorAll(".responsive-overlay__region");
    sections.forEach((section) => {
        const regionKey = section.dataset.region;
        if (stacked) {
            section.classList.toggle("is-active", regionKey === activeRegion);
        } else {
            section.classList.remove("is-active");
        }
    });
    updateSectionTabs();
    if (!stacked && pullResetHandler) {
        pullResetHandler(true);
    }
}

export function rootIsStacked() {
    const root = document.getElementById(OVERLAY_ID);
    return !!root && root.classList.contains("responsive-overlay--stacked");
}

export function isStackedLayout(root = document.getElementById(OVERLAY_ID)) {
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

function clamp(value, min, max) {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.max(min, Math.min(max, value));
}
