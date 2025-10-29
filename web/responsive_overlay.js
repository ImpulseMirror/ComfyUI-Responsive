import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import {
    configureMediaTargets,
    handleExecutionOutput,
    renderOutputs
} from "./utils/responsive_overlay_media.js";
import { setPullToRefreshHandlers } from "./features/pull_to_refresh.js";
import {
    ensureStyleTag,
    buildToggleButton,
    createOverlayRoot,
    handleKeyboardShortcuts
} from "./features/overlay_controls.js";
import { renderWorkflow, scheduleOverlayRefresh } from "./features/workflow_renderer.js";
import {
    handleExecutionStartEvent,
    handleExecutionSuccessEvent,
    handleExecutionInterruptedEvent,
    handleExecutionErrorEvent,
    handleExecutionCachedEvent,
    handleExecutingEvent,
    handleProgressEvent,
    handleProgressStateEvent,
    handleExecutedEvent
} from "./features/execution_tracking.js";
import {
    CURRENT_MEDIA_ID,
    EXTENSION_NAME,
    OUTPUTS_ID,
    RESULTS_GRID_ID
} from "./features/constants.js";

setPullToRefreshHandlers({
    renderWorkflow,
    renderOutputs
});

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
