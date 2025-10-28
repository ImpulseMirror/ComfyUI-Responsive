export function summarizeWorkflow(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) {
        return "No nodes in workflow";
    }

    const count = nodes.length;
    return `${count} node${count === 1 ? "" : "s"}`;
}

function normalizeComboOptions(options) {
    if (!options) {
        return [];
    }

    if (Array.isArray(options)) {
        return options.map((option) => normaliseOptionRecord(option));
    }

    if (Array.isArray(options.values)) {
        return options.values.map((option) => normaliseOptionRecord(option));
    }

    if (typeof options.values === "object") {
        return Object.entries(options.values).map(([key, value]) => normaliseOptionRecord({ id: key, label: value }));
    }

    return [];
}

function normaliseOptionRecord(option) {
    if (option && typeof option === "object") {
        const value = option.value ?? option.id ?? option.name ?? option.label;
        const label = option.label ?? option.name ?? String(value ?? "");
        return {
            value,
            label
        };
    }
    return {
        value: option,
        label: String(option ?? "")
    };
}

export function mapNodeToDisplay(node) {
    if (!node || typeof node !== "object") {
        return {
            title: "Unknown node",
            type: "Unknown",
            id: "N/A",
            inputCount: 0,
            outputCount: 0
        };
    }

    const type = node.type ?? "Unknown";

    return {
        title: node.title || type,
        type,
        id: node.id ?? "N/A",
        inputCount: Array.isArray(node.inputs) ? node.inputs.length : 0,
        outputCount: Array.isArray(node.outputs) ? node.outputs.length : 0
    };
}

export function getWidgetDescriptor(widget, index = 0) {
    if (!widget || typeof widget !== "object") {
        return {
            label: `Widget ${index + 1}`,
            control: "textarea",
            value: "",
            options: []
        };
    }

    const descriptor = {
        label: widget.name || `Widget ${index + 1}`,
        control: "textarea",
        value: widget.value ?? "",
        options: [],
        attributes: {}
    };

    const lowerType = String(widget.type || "").toLowerCase();
    const lowerName = String(widget.name || "").toLowerCase();

    switch (widget.type) {
        case "combo":
            descriptor.control = "select";
            descriptor.options = normalizeComboOptions(widget.options);
            if ((descriptor.value === undefined || descriptor.value === null || descriptor.value === "") && descriptor.options.length) {
                descriptor.value = descriptor.options[0]?.value ?? descriptor.options[0]?.id ?? descriptor.options[0];
            }
            break;
        case "number":
        case "slider":
            descriptor.control = "number";
            if (typeof widget.min === "number") {
                descriptor.attributes.min = widget.min;
            }
            if (typeof widget.max === "number") {
                descriptor.attributes.max = widget.max;
            }
            descriptor.attributes.step = widget.step || 1;
            if (descriptor.value === "" || descriptor.value === undefined || descriptor.value === null) {
                descriptor.value = widget.default ?? 0;
            }
            break;
        case "checkbox":
            descriptor.control = "checkbox";
            descriptor.value = !!widget.value;
            break;
        default:
            descriptor.control = "textarea";
            descriptor.value = widget.value ?? "";
    }

    const isLikelyImage = lowerType === "image" || lowerName.includes("image") || lowerName.includes("mask") || lowerName.includes("upload") || typeof widget?.directory === "string" || typeof widget?.path === "string";

    if (isLikelyImage) {
        descriptor.control = "image";
        descriptor.value = widget.value ?? "";
        descriptor.attributes = descriptor.attributes || {};
        descriptor.attributes.accept = widget?.accept || "image/*";
        descriptor.attributes.uploadType = widget?.upload_type || widget?.directory || widget?.path || "input";
        descriptor.attributes.subfolder = widget?.subfolder || "";
    }

    return descriptor;
}
