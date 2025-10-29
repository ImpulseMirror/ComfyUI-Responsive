import { EXTENSION_NAME } from "./constants.js";

function warnImportFailure(target, error) {
    console.warn(`[${EXTENSION_NAME}] Failed to import ${target}; falling back to global`, error);
}

const appModule = await import("../../../scripts/app.js").catch((error) => {
    warnImportFailure("app module", error);
    return {};
});

const apiModule = await import("../../../scripts/api.js").catch((error) => {
    warnImportFailure("api module", error);
    return {};
});

const uiModule = await import("../../../scripts/ui.js").catch((error) => {
    warnImportFailure("ui module", error);
    return {};
});

const buttonModule = await import("../../../scripts/ui/components/button.js").catch((error) => {
    console.debug(`[${EXTENSION_NAME}] ComfyButton unavailable via import`, error);
    return {};
});


const buttonGroupModule = await import("../../../scripts/ui/components/buttonGroup.js").catch((error) => {
    console.debug(`[${EXTENSION_NAME}] ComfyButtonGroup unavailable via import`, error);
    return {};
});
export const app = appModule.app ?? globalThis.app;
export const api = apiModule.api ?? globalThis.api;
export const ui = uiModule ?? globalThis.ui ?? {};
export const $el = uiModule?.$el ?? globalThis.$el;
export const ComfyButton = buttonModule?.ComfyButton ?? null;
export const ComfyButtonGroup = buttonGroupModule?.ComfyButtonGroup ?? null;

if (!app) {
    throw new Error(`[${EXTENSION_NAME}] Unable to resolve ComfyUI app reference.`);
}

if (!api) {
    throw new Error(`[${EXTENSION_NAME}] Unable to resolve ComfyUI api reference.`);
}

if (typeof $el !== "function") {
    throw new Error(`[${EXTENSION_NAME}] Unable to resolve ComfyUI $el helper.`);
}
