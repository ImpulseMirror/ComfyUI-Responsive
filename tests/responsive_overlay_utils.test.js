import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { summarizeWorkflow, mapNodeToDisplay, getWidgetDescriptor } from "../web/utils/responsive_overlay_utils.js";

describe("summarizeWorkflow", () => {
    test("returns empty message for falsy input", () => {
        assert.equal(summarizeWorkflow(), "No nodes in workflow");
        assert.equal(summarizeWorkflow(null), "No nodes in workflow");
    });

    test("handles node counts correctly", () => {
        assert.equal(summarizeWorkflow([]), "No nodes in workflow");
        assert.equal(summarizeWorkflow([{}]), "1 node");
        assert.equal(summarizeWorkflow([{}, {}]), "2 nodes");
    });
});

describe("mapNodeToDisplay", () => {
    test("falls back gracefully for invalid node", () => {
        const result = mapNodeToDisplay(null);
        assert.deepEqual(result, {
            title: "Unknown node",
            type: "Unknown",
            id: "N/A",
            inputCount: 0,
            outputCount: 0
        });
    });

    test("maps core node properties", () => {
        const node = {
            title: "Prompt",
            type: "CLIPTextEncode",
            id: 42,
            inputs: [1, 2],
            outputs: [3]
        };

        const result = mapNodeToDisplay(node);
        assert.equal(result.title, "Prompt");
        assert.equal(result.type, "CLIPTextEncode");
        assert.equal(result.id, 42);
        assert.equal(result.inputCount, 2);
        assert.equal(result.outputCount, 1);
    });
});

describe("getWidgetDescriptor", () => {
    test("handles select widgets", () => {
        const widget = {
            name: "Mode",
            type: "combo",
            value: "fast",
            options: ["fast", "balanced", "quality"]
        };

        const descriptor = getWidgetDescriptor(widget, 0);
        assert.equal(descriptor.control, "select");
        assert.equal(descriptor.label, "Mode");
        assert.deepEqual(descriptor.options, widget.options);
        assert.equal(descriptor.value, "fast");
    });

    test("handles number widgets with bounds", () => {
        const widget = {
            name: "Steps",
            type: "number",
            value: 20,
            min: 1,
            max: 150,
            step: 1
        };

        const descriptor = getWidgetDescriptor(widget, 1);
        assert.equal(descriptor.control, "number");
        assert.equal(descriptor.label, "Steps");
        assert.equal(descriptor.value, 20);
        assert.deepEqual(descriptor.attributes, { min: 1, max: 150, step: 1 });
    });

    test("handles checkbox widgets", () => {
        const widget = {
            type: "checkbox",
            value: true
        };

        const descriptor = getWidgetDescriptor(widget, 2);
        assert.equal(descriptor.control, "checkbox");
        assert.equal(descriptor.label, "Widget 3");
        assert.equal(descriptor.value, true);
    });

    test("defaults to textarea for unknown widget", () => {
        const descriptor = getWidgetDescriptor(undefined, 3);
        assert.equal(descriptor.control, "textarea");
        assert.equal(descriptor.label, "Widget 4");
        assert.equal(descriptor.value, "");
    });
});
