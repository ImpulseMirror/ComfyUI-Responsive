import { app, $el, ComfyButton } from "./comfy_context.js";
import {
    ACTIVE_CLASS,
    CURRENT_MEDIA_ID,
    CURRENT_OUTPUT_ID,
    DETAILS_ID,
    EXTENSION_NAME,
    HIDDEN_TOGGLE_ID,
    LIST_ID,
    OUTPUTS_ID,
    OVERLAY_ID,
    PROGRESS_BAR_ID,
    PROGRESS_FILL_ID,
    PROGRESS_TEXT_ID,
    RESULTS_GRID_ID,
    SECTION_DEFINITIONS,
    SECTION_TABS_ID,
    TOGGLE_ID
} from "./constants.js";
import {
    applyLayoutSizes,
    initializeLayoutResizers,
    setActiveRegion,
    updateHiddenToggleButton,
    updateLayoutMode
} from "./layout_manager.js";
import { setupFocusScrollHandling } from "./focus.js";
import { setupPullToRefresh } from "./pull_to_refresh.js";
import {
    closeLightbox,
    openLightbox,
    renderWorkflow,
    toggleHiddenFilter,
    triggerGenerate
} from "./workflow_renderer.js";
import { renderOutputs } from "../utils/responsive_overlay_media.js";

export function ensureStyleTag() {
    if (document.getElementById("responsive-overlay-styles")) {
        return;
    }

    let cssHref;
    try {
        cssHref = new URL("../css/responsive_overlay.css", import.meta.url).href;
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

export async function buildToggleButton() {
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

    if (ComfyButton) {
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
    }

    console.debug(`[${EXTENSION_NAME}] ComfyButton unavailable; using legacy button`);
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

export function createOverlayRoot() {
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
                ]),
                $el("div", { className: "responsive-overlay__section-tabs", id: SECTION_TABS_ID },
                    SECTION_DEFINITIONS.map((section) =>
                        $el("button", {
                            type: "button",
                            className: "responsive-overlay__section-tab",
                            dataset: { region: section.id },
                            onclick: (event) => {
                                event.preventDefault();
                                setActiveRegion(section.id);
                            }
                        }, [section.label])
                    )
                )
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
    setupPullToRefresh(root);
    applyLayoutSizes(root);
    updateHiddenToggleButton();
    updateLayoutMode(root);
    return root;
}

export function setOverlayState(open) {
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
        updateLayoutMode(root);
        applyLayoutSizes(root);
        renderWorkflow(true);
        renderOutputs();
    }
}

export function toggleOverlay() {
    const root = document.getElementById(OVERLAY_ID);
    const isOpen = root && !root.classList.contains("hidden");
    setOverlayState(!isOpen);
}

export function handleKeyboardShortcuts(event) {
    if (event.key === "Escape") {
        setOverlayState(false);
    }

    if (event.key.toLowerCase() === "r" && event.altKey) {
        event.preventDefault();
        toggleOverlay();
    }
}
