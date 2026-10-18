# Conway's Game of Life

A fast, crisp, touch-friendly Game of Life in vanilla JavaScript — native ES modules, no framework, no build step, no runtime dependencies.

**Play it:** https://adisakshya.github.io/conways-game-of-life/

![Gosper glider gun, pulsar, pentadecathlon and a lightweight spaceship running on the board](docs/screenshot.png)

## Features

- 256×160 toroidal board (edges wrap) running B3/S23 at 1–120 generations per second
- Pixel-perfect rendering at any `devicePixelRatio`, with 1-device-pixel gridlines
- Gap-free painting with mouse, pen or touch; strokes that start on a live cell erase
- Eight classic presets with a ghost preview, rotation and touch placement
- Wheel, trackpad and pinch zoom; drag panning; fit-to-screen
- Light and dark themes that follow the system, keyboard shortcuts and screen-reader stats

## Controls

| Action | Mouse / touch | Keyboard |
| --- | --- | --- |
| Play / pause | Play button | <kbd>Space</kbd> |
| Step one generation | Step button | <kbd>N</kbd> or <kbd>→</kbd> |
| Draw / erase | Drag on the board (starting on a live cell erases) | — |
| Clear | Clear button | <kbd>C</kbd> |
| Randomize (25%) | Randomize button | — |
| Speed | Speed slider (1–120 gen/s) | Arrow keys on the slider |
| Place a pattern | Pick from **Patterns…**, then click — or drag and release on touch | — |
| Rotate pattern | Toast **Rotate** button | <kbd>R</kbd> |
| Cancel | Toast **Cancel** button | <kbd>Esc</kbd> (also pauses when nothing to cancel) |
| Zoom | Mouse wheel / trackpad / two-finger pinch | <kbd>+</kbd> / <kbd>−</kbd> |
| Pan | Right-drag, middle-drag, <kbd>Shift</kbd>-drag, or two-finger drag | — |
| Fit board to screen | Fit button | <kbd>F</kbd> |

## Run locally

ES modules do not load from `file://`, so serve the folder over HTTP:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

Run the tests (Node 20 or later, no install needed):

```sh
node --test
```

## Architecture

```
index.html         Markup: toolbar, canvas, stamp toast, live region
styles.css         Layout and design tokens (light + dark), canvas colors as CSS variables
src/engine.js      Pure simulation: Uint8Array double buffers, B3/S23 on a torus, frame Clock
src/patterns.js    Pure preset data, plaintext/RLE parsing, 90° rotation
src/renderer.js    Canvas drawing: device-pixel sizing, offscreen cell layer, gridlines, overlays
src/input.js       Pointer painting (coalesced events + Bresenham), stamping, wheel/pan/pinch
src/ui.js          Toolbar, stats, stamp toast, keyboard shortcuts, theme reading
src/main.js        Wiring and the requestAnimationFrame loop
test/*.test.js     node:test suites for engine, patterns, renderer math, input math, theme contrast
```

Data flows one way: `input` and `ui` mutate the `Engine` or the `Renderer` view; every frame `main` advances the `Clock`, steps the engine, and asks the renderer to draw. The renderer skips frames when neither `engine.version` nor the view changed.

Design notes:

- **Crispness.** Cell size is a whole number of device pixels chosen from fixed zoom levels, and the pan offset is rounded once per frame, so every line derives from one integer origin. Cells are written one pixel each to an offscreen canvas and scaled up with `imageSmoothingEnabled = false`, drawing only the visible range.
- **Timing.** The simulation is driven by `requestAnimationFrame` (never `setInterval`) with at most 10 steps per frame, so background tabs stay throttled.
- **Deployment.** `.github/workflows/pages.yml` publishes the site files to GitHub Pages on every push to `master`. All asset paths are relative so the site works under `/conways-game-of-life/`.

## License

[MIT](LICENSE)
