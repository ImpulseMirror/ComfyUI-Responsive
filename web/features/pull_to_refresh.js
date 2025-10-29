import { registerPullResetHandler } from "./layout_manager.js";
import { findScrollableParent } from "./focus.js";

const pullRefreshState = {
    bound: false,
    tracking: false,
    pulling: false,
    startY: 0,
    scroller: null,
    currentPull: 0,
    indicator: null,
    shell: null
};

let workflowRefreshHandler = null;
let outputsRefreshHandler = null;

registerPullResetHandler((immediate) => resetPullState(immediate));

export function setPullToRefreshHandlers({ renderWorkflow, renderOutputs }) {
    workflowRefreshHandler = typeof renderWorkflow === "function" ? renderWorkflow : null;
    outputsRefreshHandler = typeof renderOutputs === "function" ? renderOutputs : null;
}

export function resetPullState(immediate = false) {
    const shell = pullRefreshState.shell;
    if (shell) {
        if (!immediate) {
            shell.style.transition = "transform 0.2s ease";
        }
        shell.style.transform = "";
        if (!immediate) {
            setTimeout(() => {
                if (pullRefreshState.shell) {
                    pullRefreshState.shell.style.transition = "";
                }
            }, 200);
        } else {
            shell.style.transition = "";
        }
    }
    const indicator = pullRefreshState.indicator;
    if (indicator) {
        indicator.classList.remove("is-visible", "is-ready", "is-active");
        indicator.textContent = "Pull to refresh";
    }
    pullRefreshState.tracking = false;
    pullRefreshState.pulling = false;
    pullRefreshState.scroller = null;
    pullRefreshState.currentPull = 0;
}

export function setupPullToRefresh(root) {
    if (!root || pullRefreshState.bound) {
        return;
    }
    const shell = root.querySelector(".responsive-overlay__shell");
    if (!shell) {
        return;
    }
    pullRefreshState.shell = shell;
    const indicator = document.createElement("div");
    indicator.id = "responsive-overlay-pull-indicator";
    indicator.className = "responsive-overlay__pull-indicator";
    indicator.textContent = "Pull to refresh";
    shell.prepend(indicator);
    pullRefreshState.indicator = indicator;

    const THRESHOLD = 80;
    const MAX_PULL = 140;

    const indicatorEl = pullRefreshState.indicator;

    const onTouchStart = (event) => {
        if (!root.classList.contains("responsive-overlay--stacked")) {
            return;
        }
        if (event.touches.length !== 1) {
            return;
        }
        const touch = event.touches[0];
        const target = event.target instanceof HTMLElement ? event.target : null;
        const scroller = target ? findScrollableParent(target) : null;
        if (!scroller || scroller.scrollTop > 0) {
            return;
        }
        pullRefreshState.tracking = true;
        pullRefreshState.pulling = false;
        pullRefreshState.startY = touch.clientY;
        pullRefreshState.scroller = scroller;
        pullRefreshState.currentPull = 0;
        if (indicatorEl) {
            indicatorEl.classList.remove("is-visible", "is-ready", "is-active");
            indicatorEl.textContent = "Pull to refresh";
        }
    };

    const onTouchMove = (event) => {
        if (!pullRefreshState.tracking || !pullRefreshState.shell) {
            return;
        }
        if (!root.classList.contains("responsive-overlay--stacked")) {
            resetPullState(true);
            return;
        }
        if (event.touches.length !== 1) {
            return;
        }
        const touch = event.touches[0];
        const delta = touch.clientY - pullRefreshState.startY;
        if (delta <= 0) {
            if (pullRefreshState.pulling && indicatorEl) {
                indicatorEl.classList.remove("is-visible", "is-ready", "is-active");
                indicatorEl.textContent = "Pull to refresh";
            }
            if (pullRefreshState.shell) {
                pullRefreshState.shell.style.transform = "";
            }
            pullRefreshState.pulling = false;
            pullRefreshState.currentPull = 0;
            return;
        }
        if (pullRefreshState.scroller && pullRefreshState.scroller.scrollTop > 0) {
            resetPullState(true);
            return;
        }

        pullRefreshState.pulling = true;
        const pullDistance = Math.min(MAX_PULL, delta);
        pullRefreshState.currentPull = pullDistance;

        if (indicatorEl) {
            indicatorEl.classList.add("is-visible");
            const ready = pullDistance >= THRESHOLD;
            indicatorEl.classList.toggle("is-ready", ready);
            indicatorEl.textContent = ready ? "Release to refresh" : "Pull to refresh";
        }

        pullRefreshState.shell.style.transition = "";
        pullRefreshState.shell.style.transform = `translateY(${pullDistance}px)`;
        event.preventDefault();
    };

    const triggerRefresh = () => {
        if (indicatorEl) {
            indicatorEl.classList.add("is-active");
            indicatorEl.textContent = "Refreshing...";
        }
        if (workflowRefreshHandler) {
            workflowRefreshHandler(true);
        }
        if (outputsRefreshHandler) {
            outputsRefreshHandler();
        }
    };

    const onTouchEnd = () => {
        if (!pullRefreshState.tracking) {
            return;
        }
        const shouldRefresh = pullRefreshState.pulling && pullRefreshState.currentPull >= THRESHOLD;
        if (shouldRefresh) {
            triggerRefresh();
            setTimeout(() => resetPullState(true), 200);
        } else {
            resetPullState();
        }
    };

    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd, { passive: true });
    root.addEventListener("touchcancel", onTouchEnd, { passive: true });

    pullRefreshState.bound = true;
}
