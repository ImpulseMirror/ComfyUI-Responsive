# ComfyUI-Responsive

ComfyUI-Responsive adds a toggleable, responsive control surface on top of ComfyUI so you can work with the active workflow without navigating the raw node graph. It is built as a web overlay extension following the same patterns as the official ComfyUI Manager.

## Features

- Persistent header toggle that sits next to other ComfyUI overlay icons (e.g. Manager) and can also be opened with `Alt + R`.
- Full-screen responsive overlay that works on large monitors, tablets, and narrow displays.
- Sidebar workflow outline that lists every node with its type, id, and connection counts, highlighting the active selection and supporting drag-to-reorder (per-workflow preferences persist between sessions).
- Detail panel that groups the selected node’s widgets into tidy form controls (text areas, selects, sliders, checkboxes) and keeps values in sync with the node graph.
- Built-in **Generate** button queues the current workflow directly from the overlay and keeps the newest renders in view.
- Refresh button and automatic reload when workflows are opened through the ComfyUI API so the layout always reflects the latest graph.
- Keyboard-friendly escape hatch (`Esc`) and close button so you can quickly return to the native editor.

## Installation

1. Clone this repository inside your ComfyUI install (typically `ComfyUI/custom_nodes/ComfyUI-Responsive`).
2. Restart ComfyUI so it can load the new web extension exposed through `WEB_DIRECTORY`.

On startup a new “Responsive” button with a dashboard icon will appear in the ComfyUI header.

## Usage

1. Open any workflow in ComfyUI.
2. Click the **Responsive** toggle (or press `Alt + R`) to open the overlay.
3. Select a node from the left sidebar to inspect or edit its widgets in the main panel; the selected entry stays highlighted for clarity.
4. Drag workflow entries to curate the column order; changes are remembered for that workflow.
5. Adjust widget values as needed, then hit **Generate** to queue the workflow without leaving the overlay. The current render fills the right-hand column while the latest images/videos appear beneath it.
6. Use the **Refresh** action if you add or reorder nodes while the overlay is visible.
7. Click **Close** or press `Esc` to return to the traditional node canvas.

## Testing

The project ships with lightweight utility tests that rely only on Node’s built-in test runner—no external dependencies required.

```bash
npm test
# or
node --test
```

## Development Notes

- Front-end code lives in `web/extensions/responsive_overlay.js` and is registered through `app.registerExtension`, mirroring the ComfyUI Manager overlay approach.
- Styles are isolated in `web/css/responsive_overlay.css`; tweak breakpoints or theme tokens there.
- No custom Python logic is required for now—`__init__.py` simply exposes the web directory so ComfyUI can serve the assets.

## Roadmap Ideas

- Push real-time updates when nodes change without needing manual refresh.
- Add task-focused layouts (e.g. text-to-image, image-to-image) that hide irrelevant nodes.
- Provide quick actions for running or queueing renders directly from the overlay.
