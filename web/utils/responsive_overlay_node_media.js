import { buildMediaUrl, buildVideoPlaybackUrl } from "./responsive_overlay_media.js";

const MEDIA_WIDGET_TYPES = new Set(["image", "preview", "image_preview", "video", "media"]);
const VIDEO_FILE_EXTENSIONS = new Set(["mp4", "webm", "mov", "mkv", "avi", "gifv"]);

export function collectNodeMediaPreviews(node) {
    if (!node || typeof node !== "object") {
        return [];
    }

    const previews = [];
    const dedupe = new Set();

    const pushItems = (items) => {
        if (!Array.isArray(items)) {
            return;
        }
        items.forEach((item) => {
            if (!item || !item.url) {
                return;
            }
            const key = `${item.url}|${item.playbackUrl || ""}`;
            if (dedupe.has(key)) {
                return;
            }
            dedupe.add(key);
            previews.push(item);
        });
    };

    if (Array.isArray(node.widgets)) {
        node.widgets.forEach((widget) => {
            pushItems(normalizeWidgetMedia(widget));
        });
    }

    if (Array.isArray(node.images) && node.images.length) {
        node.images.forEach((entry, index) => {
            pushItems(normalizeMediaValue(entry, {
                label: buildLabel("Image", index),
                defaultKind: "image",
                defaultStorage: "output"
            }));
        });
    }

    if (Array.isArray(node.imgs) && node.imgs.length) {
        node.imgs.forEach((entry, index) => {
            if (Array.isArray(entry)) {
                const [value, meta] = entry;
                const label = buildLabel("Preview", index);
                const collected = normalizeMediaValue(meta, {
                    label,
                    defaultKind: "image",
                    defaultStorage: "output"
                });
                if (collected.length) {
                    pushItems(collected);
                    return;
                }
                pushItems(normalizeMediaValue(value, {
                    label,
                    defaultKind: "image",
                    defaultStorage: "output"
                }));
            } else {
                pushItems(normalizeMediaValue(entry, {
                    label: buildLabel("Preview", index),
                    defaultKind: "image",
                    defaultStorage: "output"
                }));
            }
        });
    }

    return previews;
}

function normalizeWidgetMedia(widget) {
    if (!widget || typeof widget !== "object") {
        return [];
    }

    if (!MEDIA_WIDGET_TYPES.has(String(widget.type || "").toLowerCase())) {
        return [];
    }

    const label = typeof widget.label === "string" && widget.label.length
        ? widget.label
        : typeof widget.name === "string" && widget.name.length
            ? widget.name
            : "Preview";

    const widgetKind = inferWidgetKind(widget);
    const defaultStorage = inferWidgetStorage(widget, widgetKind);

    return normalizeMediaValue(widget.value, {
        label,
        defaultKind: widgetKind,
        defaultStorage
    });
}

function normalizeMediaValue(value, options = {}) {
    if (value === undefined || value === null) {
        return [];
    }

    if (Array.isArray(value)) {
        const multi = [];
        value.forEach((entry, index) => {
            multi.push(...normalizeMediaValue(entry, {
                ...options,
                label: buildIndexedLabel(options.label, index)
            }));
        });
        return multi;
    }

    const descriptor = createMediaDescriptor(value, options);
    return descriptor ? [descriptor] : [];
}

function createMediaDescriptor(value, options = {}) {
    if (!value) {
        return null;
    }

    if (typeof value === "string") {
        return descriptorFromString(value, options);
    }

    if (isMediaElement(value)) {
        return descriptorFromElement(value, options);
    }

    if (typeof value === "object") {
        if (value.params) {
            return descriptorFromParams(value.params, {
                ...options,
                fallbackUrl: value.url || value.value || value.src
            });
        }
        if (value.url || value.src) {
            return descriptorFromParams(value, {
                ...options,
                fallbackUrl: value.url || value.src
            });
        }
        if (value.filename || value.file_name) {
            return descriptorFromParams(value, options);
        }
    }

    return null;
}

function descriptorFromString(raw, options) {
    const trimmed = raw.trim();
    if (!trimmed) {
        return null;
    }

    if (trimmed.startsWith("data:")) {
        return {
            kind: options.defaultKind || "image",
            url: trimmed,
            playbackUrl: trimmed,
            filename: options.label || "preview",
            label: options.label || "Preview"
        };
    }

    if (trimmed.includes("?") && trimmed.includes("filename=")) {
        const queryIndex = trimmed.indexOf("?");
        const params = paramsToObject(parseSearchParams(trimmed.slice(queryIndex + 1)));
        return descriptorFromParams(params, {
            ...options,
            fallbackUrl: trimmed
        });
    }

    return descriptorFromParams({ filename: extractFilename(trimmed) }, {
        ...options,
        fallbackUrl: trimmed
    });
}

function descriptorFromElement(element, options) {
    const tagName = (element.tagName || "").toUpperCase();
    const kind = tagName === "VIDEO" ? "video" : "image";
    let src = element.currentSrc || element.src || "";

    if (!src && tagName === "CANVAS" && typeof element.toDataURL === "function") {
        try {
            src = element.toDataURL("image/png");
        } catch {
            // ignore
        }
    }

    if (!src) {
        return null;
    }

    const descriptor = descriptorFromParams({
        filename: element.dataset?.filename || options.label || "preview",
        url: src,
        format: tagName === "VIDEO" ? "video/mp4" : "image/png"
    }, {
        ...options,
        defaultKind: kind,
        fallbackUrl: src
    });

    if (descriptor) {
        descriptor.kind = kind;
    }

    return descriptor;
}

function descriptorFromParams(params = {}, options = {}) {
    const filename = params.filename || params.file_name || params.name || options.filename || options.label || "preview";
    const subfolder = params.subfolder || params.sub_folder || params.folder || "";
    const storageType = params.type || params.storage || options.defaultStorage || "output";
    const format = params.format || params.mime || params.content_type || "";
    const kind = determineKind(format, filename, options.defaultKind);

    let url = params.url || params.value || options.fallbackUrl || "";
    if (url) {
        url = ensureApiUrl(url, kind);
    } else if (filename) {
        url = buildMediaUrl(filename, subfolder, storageType);
    }

    if (!url) {
        return null;
    }

    let playbackUrl = params.playbackUrl || params.video || params.playback_url || "";
    if (playbackUrl) {
        playbackUrl = ensureApiUrl(playbackUrl, "video");
    } else if (kind === "video") {
        playbackUrl = buildVideoPlaybackUrl(filename, subfolder, storageType);
    } else {
        playbackUrl = url;
    }

    return {
        kind,
        url,
        playbackUrl,
        filename,
        label: options.label || params.label || filename
    };
}

function inferWidgetKind(widget) {
    const type = String(widget.type || "").toLowerCase();
    if (type.includes("video")) {
        return "video";
    }
    if (type.includes("audio")) {
        return "audio";
    }
    return "image";
}

function inferWidgetStorage(widget, kind) {
    if (widget?.value && typeof widget.value === "string") {
        if (widget.value.includes("type=input")) {
            return "input";
        }
        if (widget.value.includes("type=temp")) {
            return "temp";
        }
        if (widget.value.includes("type=output")) {
            return "output";
        }
    }

    if (kind === "video") {
        return "temp";
    }

    return "output";
}

function determineKind(format, filename, fallback = "image") {
    if (typeof format === "string") {
        if (format.startsWith("video")) {
            return "video";
        }
        if (format.startsWith("image")) {
            return "image";
        }
    }

    const ext = (filename || "").split(".").pop();
    if (ext && VIDEO_FILE_EXTENSIONS.has(ext.toLowerCase())) {
        return "video";
    }

    return fallback || "image";
}

function ensureApiUrl(raw, kind) {
    if (!raw) {
        return "";
    }

    if (raw.startsWith("data:")) {
        return raw;
    }

    const base = typeof window !== "undefined" && window.location ? window.location.origin : "http://127.0.0.1";

    try {
        const url = new URL(raw, base);
        if (!url.pathname.startsWith("/api/")) {
            if (url.pathname.startsWith("/view")) {
                url.pathname = `/api${url.pathname}`;
            } else if (url.pathname.startsWith("view")) {
                url.pathname = `/api/${url.pathname}`;
            }
        }
        if (kind !== "video" && !url.searchParams.has("preview")) {
            url.searchParams.set("preview", "1");
        }
        const search = url.searchParams.toString();
        return `${url.pathname}${search ? `?${search}` : ""}`;
    } catch {
        if (raw.startsWith("?")) {
            const params = parseSearchParams(raw.slice(1));
            if (kind !== "video" && !params.get("preview")) {
                params.set("preview", "1");
            }
            return `/api/view?${params.toString()}`;
        }
        return raw;
    }
}

function parseSearchParams(search) {
    try {
        return new URLSearchParams(search);
    } catch {
        return new URLSearchParams();
    }
}

function paramsToObject(searchParams) {
    const obj = {};
    if (!searchParams || typeof searchParams.forEach !== "function") {
        return obj;
    }
    searchParams.forEach((value, key) => {
        obj[key] = value;
    });
    return obj;
}

function extractFilename(path) {
    if (!path) {
        return "";
    }
    const cleaned = path.split("?")[0];
    const segments = cleaned.split(/[\\/]/);
    return segments.pop() || cleaned;
}

function buildLabel(base, index) {
    return index != null ? `${base} ${index + 1}` : base;
}

function buildIndexedLabel(base, index) {
    if (!base) {
        return buildLabel("Preview", index);
    }
    return `${base}${index != null ? ` ${index + 1}` : ""}`;
}

function isMediaElement(value) {
    if (!value || typeof value !== "object") {
        return false;
    }
    if (typeof value.tagName === "string") {
        return true;
    }
    const HTMLElementCtor = typeof window !== "undefined" ? window.HTMLElement : undefined;
    if (HTMLElementCtor && value instanceof HTMLElementCtor) {
        return true;
    }
    return false;
}
