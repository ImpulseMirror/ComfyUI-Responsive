export const EXTENSION_NAME = "ComfyUI.ResponsiveOverlay";

export const TOGGLE_ID = "responsive-overlay-toggle";
export const OVERLAY_ID = "responsive-overlay-root";
export const LIST_ID = "responsive-overlay-nodes";
export const DETAILS_ID = "responsive-overlay-details";
export const OUTPUTS_ID = "responsive-overlay-outputs";
export const RESULTS_GRID_ID = "responsive-overlay-results-grid";
export const CURRENT_OUTPUT_ID = "responsive-overlay-current-output";
export const CURRENT_MEDIA_ID = "responsive-overlay-current-media";
export const HIDDEN_TOGGLE_ID = "responsive-overlay-hidden-toggle";
export const PROGRESS_BAR_ID = "responsive-overlay-progress";
export const PROGRESS_FILL_ID = "responsive-overlay-progress-fill";
export const PROGRESS_TEXT_ID = "responsive-overlay-progress-text";
export const SECTION_TABS_ID = "responsive-overlay-section-tabs";

export const SECTION_DEFINITIONS = [
    { id: "outputs", label: "Outputs" },
    { id: "details", label: "Inputs" },
    { id: "nodes", label: "Workflow" }
];

export const ACTIVE_CLASS = "responsive-overlay-is-open";
export const SELECTED_CLASS = "responsive-overlay__node--selected";

export const LAYOUT_STORAGE_KEY = `${EXTENSION_NAME}.layout.v1`;
export const MIN_REGION_RATIO = 0.18;
export const STACK_LAYOUT_BREAKPOINT = 1100;
export const DEFAULT_LAYOUT_SIZES = {
    outputs: 0.36,
    details: 0.32,
    nodes: 0.32
};
