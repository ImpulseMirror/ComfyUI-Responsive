const MAX_OUTPUT_ITEMS = 16;
const latestOutputs = [];

let currentMediaId = "";
let outputsContainerId = "";
let resultsGridId = "";

export function configureMediaTargets(options) {
    currentMediaId = options.currentMediaId;
    outputsContainerId = options.outputsContainerId;
    resultsGridId = options.resultsGridId;
}

export function handleExecutionOutput(detail) {
    if (!detail || !detail.output) {
        return;
    }

    const mediaItems = extractMediaFromOutput(detail.output);
    if (!mediaItems.length) {
        return;
    }

    mediaItems.forEach((item) => {
        const key = buildMediaKey(item);
        const existingIndex = latestOutputs.findIndex((entry) => entry.key === key);
        if (existingIndex !== -1) {
            latestOutputs.splice(existingIndex, 1);
        }

        latestOutputs.unshift({
            ...item,
            key,
            node: detail.node,
            promptId: detail.prompt_id,
            timestamp: Date.now()
        });
    });

    if (latestOutputs.length > MAX_OUTPUT_ITEMS) {
        latestOutputs.length = MAX_OUTPUT_ITEMS;
    }

    renderOutputs();
}

export function renderOutputs() {
    const container = document.getElementById(outputsContainerId);
    const grid = document.getElementById(resultsGridId);
    const meta = document.getElementById("responsive-overlay-results-meta");

    if (!container || !grid || !meta) {
        return;
    }

    if (!latestOutputs.length) {
        container.classList.add("hidden");
        grid.innerHTML = "";
        meta.textContent = "Run the workflow to see images or videos here.";
        renderCurrentMedia(null);
        return;
    }

    container.classList.remove("hidden");
    grid.innerHTML = "";
    meta.textContent = `Showing ${latestOutputs.length} recent file${latestOutputs.length > 1 ? "s" : ""}`;

    renderCurrentMedia(latestOutputs[0]);

    latestOutputs.forEach((item) => {
        const preview = createPreviewElement(item, item.kind === "video" ? {} : { loading: "lazy" });

        const figure = document.createElement("figure");
        figure.className = "responsive-overlay__result";
        figure.dataset.mediaUrl = item.url;
        figure.dataset.mediaPlaybackUrl = item.playbackUrl;
        figure.dataset.mediaKind = item.kind;
        figure.dataset.mediaName = item.filename;

        preview.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            openLightboxMedia(item);
        });

        figure.appendChild(preview);

        const caption = document.createElement("figcaption");
        caption.appendChild(createSpan("responsive-overlay__result-name", item.filename));
        if (typeof item.node !== "undefined") {
            caption.appendChild(createSpan("responsive-overlay__result-node", `Node #${item.node}`));
        }
        figure.appendChild(caption);

        figure.addEventListener("click", (event) => {
            event.preventDefault();
            openLightboxMedia(item);
        });

        grid.appendChild(figure);
    });
}

export function openLightboxMedia(item) {
    const lightbox = document.getElementById("responsive-overlay-lightbox");
    const mediaContainer = document.getElementById("responsive-overlay-lightbox-media");
    const meta = document.getElementById("responsive-overlay-lightbox-meta");
    if (!lightbox || !mediaContainer || !meta) {
        return;
    }

    mediaContainer.innerHTML = "";
    meta.textContent = item.filename;

    if (item.kind === "video") {
        const video = document.createElement("video");
        video.controls = true;
        video.autoplay = true;
        video.loop = true;
        video.playsInline = true;
        const source = document.createElement("source");
        source.src = item.playbackUrl;
        source.type = "video/mp4";
        video.appendChild(source);
        mediaContainer.appendChild(video);
    } else {
        const img = createImageElement(item.url, item.filename, { loading: "eager" });
        // Wrap in a pan/zoom container for pinch-zoom support
        const wrapper = document.createElement("div");
        wrapper.style.width = "100%";
        wrapper.style.height = "100%";
        wrapper.style.display = "flex";
        wrapper.style.alignItems = "center";
        wrapper.style.justifyContent = "center";
        wrapper.style.overflow = "hidden";
        wrapper.style.touchAction = "none"; // enable pointer-based pinch gestures

        img.style.transformOrigin = "center center";
        img.style.willChange = "transform";
        img.style.userSelect = "none";
        img.draggable = false;

        wrapper.appendChild(img);
        mediaContainer.appendChild(wrapper);

        enablePinchZoom(img, wrapper);
    }

    lightbox.classList.remove("hidden");
}

export function closeLightboxMedia() {
    const lightbox = document.getElementById("responsive-overlay-lightbox");
    const mediaContainer = document.getElementById("responsive-overlay-lightbox-media");
    if (!lightbox || !mediaContainer) {
        return;
    }
    mediaContainer.innerHTML = "";
    lightbox.classList.add("hidden");
}

export function renderCurrentMedia(item) {
    const container = document.getElementById(currentMediaId);
    if (!container) {
        return;
    }

    container.innerHTML = "";

    if (!item) {
        container.appendChild(createParagraph("responsive-overlay__empty", "Generate to see the latest render here."));
        return;
    }

    const preview = createPreviewElement(item, item.kind === "video" ? {} : { loading: "eager" });
    preview.classList.add("responsive-overlay__current-preview");
    preview.addEventListener("click", (event) => {
        event.preventDefault();
        openLightboxMedia(item);
    });

    container.appendChild(preview);
}

function extractMediaFromOutput(output) {
    const collected = [];

    const visit = (value) => {
        if (!value) {
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (typeof value === "object") {
            if (value.filename || value.file_name) {
                const filename = value.filename || value.file_name;
                const subfolder = value.subfolder || value.sub_folder || value.folder || "";
                const storageType = value.type || value.storage || "output";
                const previewUrl = buildMediaUrl(filename, subfolder, storageType);
                if (previewUrl) {
                    const ext = filename.split(".").pop()?.toLowerCase() || "";
                    const videoExts = ["mp4", "webm", "mov", "avi", "mkv"];
                    const kind = videoExts.includes(ext) ? "video" : "image";
                    collected.push({
                        url: previewUrl,
                        filename,
                        subfolder,
                        storageType,
                        kind,
                        playbackUrl: kind === "video" ? buildVideoPlaybackUrl(filename, subfolder, storageType) : previewUrl
                    });
                }
                return;
            }
            Object.values(value).forEach(visit);
        }
    };

    visit(output);
    return collected;
}

export function buildMediaUrl(filename, subfolder, storageType) {
    if (!filename) {
        return "";
    }
    const params = new URLSearchParams();
    params.set("filename", filename);
    params.set("type", storageType || "output");
    if (subfolder) {
        params.set("subfolder", subfolder);
    }
    params.set("preview", "1");
    return `/api/view?${params.toString()}`;
}

export function buildVideoPlaybackUrl(filename, subfolder, storageType) {
    if (!filename) {
        return "";
    }
    const params = new URLSearchParams();
    params.set("filename", filename);
    params.set("type", storageType || "output");
    if (subfolder) {
        params.set("subfolder", subfolder);
    }
    params.set("format", "video/h264-mp4");
    params.set("frame_rate", "30");
    return `/api/viewvideo?${params.toString()}`;
}

export function createPreviewElement(item, attributes = {}) {
    if (item.kind === "video") {
        const video = document.createElement("video");
        video.className = "responsive-overlay__preview-video";
        video.muted = true;
        video.playsInline = true;
        video.controls = false;
        video.setAttribute("preload", "metadata");
        const source = document.createElement("source");
        source.src = item.playbackUrl || item.url;
        source.type = "video/mp4";
        video.appendChild(source);
        if (attributes && typeof attributes === "object") {
            Object.entries(attributes).forEach(([key, value]) => {
                if (value !== undefined && value !== null) {
                    video.setAttribute(key, value);
                }
            });
        }
        return video;
    }
    return createImageElement(item.url, item.filename, attributes);
}

export function createImageElement(src, alt, attributes = {}) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = alt;
    Object.assign(img, attributes);
    return img;
}

// Adds pinch-zoom and pan support to an image inside a container using Pointer Events
function enablePinchZoom(img, container) {
    let pointers = new Map();
    let scale = 1;
    let minScale = 1;
    let maxScale = 6;
    let translateX = 0;
    let translateY = 0;

    const applyTransform = () => {
        img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    };

    const getDistance = (p1, p2) => {
        const dx = p2.clientX - p1.clientX;
        const dy = p2.clientY - p1.clientY;
        return Math.hypot(dx, dy);
    };

    const getMidpoint = (p1, p2) => ({
        x: (p1.clientX + p2.clientX) / 2,
        y: (p1.clientY + p2.clientY) / 2
    });

    let startDistance = 0;
    let startScale = 1;
    let originX = 0;
    let originY = 0;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e) => {
        container.setPointerCapture?.(e.pointerId);
        pointers.set(e.pointerId, e);
        if (pointers.size === 1) {
            lastX = e.clientX;
            lastY = e.clientY;
        } else if (pointers.size === 2) {
            const [p1, p2] = [...pointers.values()];
            startDistance = getDistance(p1, p2);
            startScale = scale;
            const mid = getMidpoint(p1, p2);
            const rect = img.getBoundingClientRect();
            originX = mid.x - (rect.left + rect.width / 2);
            originY = mid.y - (rect.top + rect.height / 2);
        }
    };

    const onPointerMove = (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, e);
        if (pointers.size === 1 && scale > 1) {
            const dx = e.clientX - lastX;
            const dy = e.clientY - lastY;
            lastX = e.clientX;
            lastY = e.clientY;
            translateX += dx;
            translateY += dy;
            applyTransform();
        } else if (pointers.size === 2) {
            const [p1, p2] = [...pointers.values()];
            const dist = getDistance(p1, p2);
            if (startDistance > 0) {
                const factor = dist / startDistance;
                let nextScale = Math.min(maxScale, Math.max(minScale, startScale * factor));
                // Adjust translate so zoom centers around the pinch midpoint
                const scaleDiff = nextScale / scale;
                translateX = (translateX - originX) * scaleDiff + originX;
                translateY = (translateY - originY) * scaleDiff + originY;
                scale = nextScale;
                applyTransform();
            }
        }
    };

    const onPointerUp = (e) => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) {
            startDistance = 0;
        }
    };

    const onWheel = (e) => {
        if (!e.ctrlKey) return; // desktop pinch-zoom gesture
        e.preventDefault();
        const rect = img.getBoundingClientRect();
        const pointX = e.clientX - (rect.left + rect.width / 2);
        const pointY = e.clientY - (rect.top + rect.height / 2);
        const delta = -e.deltaY;
        const zoom = delta > 0 ? 1.06 : 0.94;
        const nextScale = Math.min(maxScale, Math.max(minScale, scale * zoom));
        const scaleDiff = nextScale / scale;
        translateX = (translateX - pointX) * scaleDiff + pointX;
        translateY = (translateY - pointY) * scaleDiff + pointY;
        scale = nextScale;
        applyTransform();
    };

    // Double-tap to reset
    let lastTap = 0;
    const onDblTap = (e) => {
        const now = Date.now();
        if (now - lastTap < 300) {
            scale = 1;
            translateX = 0;
            translateY = 0;
            applyTransform();
        }
        lastTap = now;
    };

    container.addEventListener("pointerdown", onPointerDown, { passive: true });
    container.addEventListener("pointermove", onPointerMove, { passive: true });
    container.addEventListener("pointerup", onPointerUp, { passive: true });
    container.addEventListener("pointercancel", onPointerUp, { passive: true });
    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("touchend", onDblTap, { passive: true });
}

function createSpan(className, text) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    return span;
}

function createParagraph(className, text) {
    const p = document.createElement("p");
    p.className = className;
    p.textContent = text;
    return p;
}

function buildMediaKey(item) {
    if (!item) {
        return "";
    }
    if (item.filename) {
        return [
            item.filename,
            item.subfolder || "",
            item.storageType || "",
            item.kind || "image"
        ].join("|");
    }
    return `${item.url || ""}|${item.playbackUrl || ""}`;
}
