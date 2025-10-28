import test from "node:test";
import assert from "node:assert/strict";

import { collectNodeMediaPreviews } from "../web/utils/responsive_overlay_node_media.js";

test("collectNodeMediaPreviews extracts previews from image widgets", () => {
    const node = {
        widgets: [
            {
                type: "image",
                name: "Input Image",
                value: "/view?filename=sample.png&type=input&subfolder=&preview=1"
            }
        ]
    };

    const previews = collectNodeMediaPreviews(node);

    assert.equal(previews.length, 1);
    assert.equal(previews[0].filename, "sample.png");
    assert.match(previews[0].url, /^\/api\/view\?/);
    assert.equal(previews[0].kind, "image");
    assert.equal(previews[0].storageType, "input");
});

test("collectNodeMediaPreviews handles preview widgets with params", () => {
    const node = {
        widgets: [
            {
                type: "preview",
                label: "Combined Video",
                value: {
                    params: {
                        filename: "combine.mp4",
                        subfolder: "Video/Previews",
                        type: "temp",
                        format: "video/mp4"
                    }
                }
            }
        ]
    };

    const previews = collectNodeMediaPreviews(node);

    assert.equal(previews.length, 1);
    assert.equal(previews[0].filename, "combine.mp4");
    assert.equal(previews[0].kind, "video");
    assert.match(previews[0].playbackUrl, /^\/api\/viewvideo\?/);
    assert.equal(previews[0].storageType, "temp");
});

test("collectNodeMediaPreviews dedupes identical sources", () => {
    const node = {
        widgets: [
            {
                type: "image",
                value: "/view?filename=test.png&type=input&subfolder=&preview=1"
            }
        ],
        images: [{
            filename: "test.png",
            type: "input",
            subfolder: ""
        }]
    };

    const previews = collectNodeMediaPreviews(node);

    assert.equal(previews.length, 1);
    assert.equal(previews[0].filename, "test.png");
});
