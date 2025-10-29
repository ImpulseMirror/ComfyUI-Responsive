let focusScrollListenerBound = false;

export function setupFocusScrollHandling(root) {
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

export function ensureFieldVisible(element) {
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

export function findScrollableParent(element) {
    let current = element?.parentElement || null;
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
