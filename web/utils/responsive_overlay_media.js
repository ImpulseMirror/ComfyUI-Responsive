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
        const mediaElement = item.kind === "video"
            ? createVideoElement(item.url, { controls: true, loop: true, playsInline: true, preload: "metadata" })
            : createImageElement(item.url, item.filename, { loading: "lazy" });

        const figure = document.createElement("figure");
        figure.className = "responsive-overlay__result";
        figure.appendChild(mediaElement);

        const caption = document.createElement("figcaption");
        caption.appendChild(createSpan("responsive-overlay__result-name", item.filename));
        if (typeof item.node !== "undefined") {
            caption.appendChild(createSpan("responsive-overlay__result-node", `Node #${item.node}`));
        }
        figure.appendChild(caption);

        figure.addEventListener("click", () => {
            window.open(item.url, "_blank", "noopener");
        });

        grid.appendChild(figure);
    });
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

    const mediaElement = item.kind === "video"
        ? createVideoElement(item.url, { controls: true, autoplay: true, loop: true, playsInline: true, preload: "metadata" })
        : createImageElement(item.url, item.filename, { loading: "eager" });

    container.appendChild(mediaElement);
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
                const url = buildMediaUrl(filename, subfolder, storageType);
                if (url) {
                    const ext = filename.split(".").pop()?.toLowerCase() || "";
                    const videoExts = ["mp4", "webm", "mov", "avi", "mkv"];
                    const kind = videoExts.includes(ext) ? "video" : "image";
                    collected.push({
                        url,
                        filename,
                        subfolder,
                        storageType,
                        kind
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

function createVideoElement(src, attributes) {
    const video = document.createElement("video");
    video.src = src;
    Object.assign(video, attributes);
    return video;
}

function createImageElement(src, alt, attributes) {
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
