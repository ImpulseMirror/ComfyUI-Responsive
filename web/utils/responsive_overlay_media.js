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
        const key = item.url;
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
        const preview = createPreviewElement(item, item.kind === 'video' ? {} : { loading: 'lazy' });

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
        mediaContainer.appendChild(img);
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

    const preview = createPreviewElement(item, item.kind === 'video' ? {} : { loading: 'eager' });
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

function buildMediaUrl(filename, subfolder, storageType) {
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

function buildVideoPlaybackUrl(filename, subfolder, storageType) {
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

function createPreviewElement(item, attributes = {}) {
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

function createImageElement(src, alt, attributes = {}) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = alt;
    Object.assign(img, attributes);
    return img;
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
