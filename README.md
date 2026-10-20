# Conway's Game of Life

A fast, crisp, touch-friendly Game of Life in vanilla JavaScript — native ES modules, no framework, no build step, no runtime dependencies.

**Play it:** https://adisakshya.github.io/conways-game-of-life/

| Light | Dark |
| --- | --- |
| ![The light theme: a Gosper glider gun on the board, simulation controls and pattern library in the sidebar](docs/screenshots/desktop-light.png) | ![The dark theme: the same workspace with a lime accent](docs/screenshots/desktop-dark.png) |

## Features

- 256×160 toroidal board (edges wrap) running B3/S23 at 1–120 generations per second
- Pixel-perfect rendering at any `devicePixelRatio`, with 1-device-pixel gridlines
- Draw, Erase and Pan tools that work the same with mouse, pen and touch, and gap-free strokes at any zoom
- Undo and Redo for strokes, placed patterns, Clear and Randomize (the last 50 steps), and Restart from seed to rerun the setup you started from
- A Help panel (keyboard and touch friendly) that explains the controls and the wrapping board
- A visual Pattern library of eight classic presets (spaceships, oscillators, a gun and methuselahs), each with a miniature drawn from its own cells, a factual description, and two actions: **Load** (replace the board) and **Stamp** (add to it with a ghost preview, rotation and touch placement)
- A fresh session opens on a paused, centred Gosper glider gun with a dismissible "Press Play to see it evolve" hint
- **Share & save**: save one setup in the browser (cells, generation, Restart seed), export the live cells as RLE, import RLE or plaintext (validated completely first, then Load or Stamp), and copy a share link that carries the pattern in the URL fragment. Nothing is sent to a server
- Keyboard editing: Tab to the board, move a visible cursor with the arrow keys, toggle cells with Enter, and place patterns without a pointing device
- Wheel, trackpad, pinch and −/+ button zoom with a live px/cell readout; drag panning; Fit board and Fit live cells; a status line stating the 256 × 160 wrapping board
- A canvas-and-sidebar workspace that stacks on phones, with Play and Step pinned to the bottom edge
- Light and dark themes with a Light / Dark / System switch that remembers your choice
- Keyboard shortcuts and screen-reader stats

## Controls

| Action | Mouse / touch | Keyboard |
| --- | --- | --- |
| Play / pause | Play button (unavailable while a stroke or pattern placement is in progress) | <kbd>Space</kbd> |
| Step one generation | Step button | <kbd>N</kbd>, or <kbd>→</kbd> when the board is not focused |
| Save / load a setup | **Share & save** → **Save board** / **Load saved setup**. One slot per browser; loading pauses, is one undo step, and restores the generation and Restart seed. A missing, damaged, newer or wrong-size save is reported and the board is left alone. | — |
| Export / import | **Share & save** → **Export RLE** downloads the live cells; **Import…** takes a file (up to 256 KiB) or pasted RLE/plaintext, shows what it found, and only then offers **Load on clean board** or **Stamp onto board**. Patterns are limited to the 256 × 160 board and Conway's rule (B3/S23); anything else is refused with a message and nothing changes. | — |
| Share a link | **Share & save** → **Copy share link**: the live cells as RLE in `#pattern=v1.…` (whole link ≤ 2,000 characters; bigger patterns are offered as a file instead). Opening a link asks before anything changes; if the clipboard is blocked the link is shown selected for copying. | — |
| Move the keyboard cursor | Tab to the board first. A ring marks the cell; the view follows it and it stays on the board (it does not wrap). | <kbd>←</kbd> <kbd>↑</kbd> <kbd>→</kbd> <kbd>↓</kbd>, <kbd>Shift</kbd> for ten cells |
| Toggle the cell under the cursor | Pauses the simulation; one undo step | <kbd>Enter</kbd> |
| Draw cells | **Draw** tool (the default): drag to add cells, wherever the stroke starts. Editing pauses a running simulation and leaves it paused; press Play to resume. | — |
| Erase cells | **Erase** tool: drag to remove cells, wherever the stroke starts | — |
| Pan the view | **Pan** tool: drag with a mouse, pen or one finger. Cells are never changed. | Arrow keys in the tool group switch tools |
| Undo / Redo | **Undo** and **Redo** buttons above the board. Each stroke, placed pattern, Clear and Randomize is one step; the last 50 are kept, and undoing restores the generation count too. Unavailable while a stroke or placement is in progress. | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd>, <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> (or <kbd>Ctrl</kbd>+<kbd>Y</kbd>) |
| Restart from seed | **Restart from seed** button: puts the board back to the setup you started running from, at generation 0, and stays paused. Restart can be undone. | — |
| Help | **Help** button (also dismissed with <kbd>Esc</kbd> or Close; focus returns to the button) | <kbd>Enter</kbd> on the button |
| Clear | Clear button | <kbd>C</kbd> |
| Randomize (25%) | Randomize button: pauses, replaces the board and resets the generation to 0 | — |
| Speed | Speed slider (1–120 gen/s) | Arrow keys on the slider |
| Load a pattern | **Load** on a library card: pauses, cancels any stroke or placement in progress, replaces every cell, resets the generation to 0, makes the pattern the Restart seed and frames it. One undo step. | — |
| Stamp a pattern | **Stamp** on a library card, then click the board (the board is kept) — or drag and release on touch. Placing is a temporary mode: your tool is back afterwards, and choosing another tool cancels it. | — |
| Stamp from the keyboard | **Stamp** moves focus to the board with the ghost at the cursor; arrows move it, <kbd>Enter</kbd> places, <kbd>Esc</kbd> cancels and returns focus to the Stamp button | — |
| Rotate pattern | Toast **Rotate** button | <kbd>R</kbd> |
| Cancel | Toast **Cancel** button | <kbd>Esc</kbd> reverts the stroke in progress exactly, or cancels a pattern being placed; with nothing to cancel it pauses |
| Zoom | Mouse wheel / trackpad / two-finger pinch | <kbd>+</kbd> / <kbd>−</kbd> |
| Pan (any tool) | Right-drag, middle-drag, <kbd>Shift</kbd>-drag, or two-finger drag | — |
| Fit board to screen | **Board** button | <kbd>F</kbd> |
| Zoom to the live cells | **Live cells** button | — |
| Theme | **Light / Dark / System** switch in the header. System follows your OS until you choose Light or Dark; your choice is kept in this browser. | Arrow keys inside the switch |

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
index.html         Markup: header with theme switch, board panel with tools, sidebar cards, Help dialog, stamp toast, live region
styles.css         Layout and design tokens (light + dark via data-theme), canvas colors as CSS variables
src/engine.js      Pure simulation: Uint8Array double buffers, B3/S23 on a torus, frame Clock
src/patterns.js    Preset data and metadata, plaintext/RLE parsing, rotation, preview paths
src/renderer.js    Canvas drawing: device-pixel sizing, offscreen cell layer, gridlines, overlays
src/session.js     Play state, pause-on-edit, undo/redo orchestration and the restart seed
src/history.js     Bounded undo/redo stack of before/after board states
src/input.js       Draw/Erase/Pan tools, pointer painting (coalesced events + Bresenham), stamping, wheel/pan/pinch
src/theme.js       Theme preference (system / light / dark), persistence, canvas palette reading
src/serialize.js   RLE export, the versioned save schema, share-link encoding (pure, validating)
src/transfer.js    Save / load / import / export / link orchestration with atomic failure handling, no DOM
src/share.js       The Share & save dialog (DOM only)
src/ui.js          Sidebar, tools, status, pattern library, Help dialog, stamp toast, keyboard shortcuts
src/main.js        Wiring and the requestAnimationFrame loop
test/*.test.js     node:test suites for engine, patterns, renderer math, input math, theme contrast
```

Data flows one way: `input` and `ui` mutate the `Engine` or the `Renderer` view; every frame `main` advances the `Clock`, steps the engine, and asks the renderer to draw. The renderer skips frames when neither `engine.version` nor the view changed.

Design notes:

- **Crispness.** Cell size is a whole number of device pixels chosen from fixed zoom levels, and the pan offset is rounded once per frame, so every line derives from one integer origin. Cells are written one pixel each to an offscreen canvas and scaled up with `imageSmoothingEnabled = false`, drawing only the visible range.
- **Theming.** An inline script in `index.html` sets `data-theme` before first paint, from the saved choice or else the OS. `src/theme.js` keeps it current and re-reads the canvas palette from CSS variables whenever it changes, so the board re-themes even while paused.
- **Editing.** Painting a stroke or arming a pattern pauses the simulation before anything changes and never resumes it. Play and Step stay unavailable until the edit ends, so a stroke is applied to a board that is standing still and Esc can restore it exactly.
- **History and seed.** Each stroke, placement, Clear and Randomize is recorded as one entry holding the board (cells and generation) before and after it, plus the restart seed in force; the latest 50 are kept. Undo and redo restore those snapshots, so simulation ticks are never steps. The seed is the setup a run started from: it is taken at the first Play or Step after the board changed, kept while the simulation runs, and dropped by any edit, so the next Play or Step starts a new one. Restart restores it at generation 0 and is itself an undo step.
- **Timing.** The simulation is driven by `requestAnimationFrame` (never `setInterval`) with at most 10 steps per frame, so background tabs stay throttled.
- **Deployment.** `.github/workflows/pages.yml` publishes the site files to GitHub Pages on every push to `master`. All asset paths are relative so the site works under `/conways-game-of-life/`.

## Search and sharing

The page includes crawlable rules and pattern explanations, search metadata, a
canonical URL, a sitemap and social-preview assets. See [the SEO handoff](docs/seo.md)
for Search Console verification and post-deployment checks. Indexing and search
rankings are not guaranteed.

## License

[MIT](LICENSE)
