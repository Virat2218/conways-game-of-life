# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Redesigned the interface as a canvas-and-sidebar workspace with a Simulation card, a Pattern library and the rules, stacking on phones with Play and Step pinned to the bottom edge.
- Painting, erasing and arming a pattern now pause a running simulation before the board changes, and leave it paused. Play and Step are unavailable (and say why) until the stroke or placement ends. Esc reverts a stroke to its exact earlier state. Randomize pauses and resets the generation to 0.
- Added explicit Draw, Erase and Pan tools. Draw always adds cells and Erase always removes them, wherever a stroke starts (the old rule of "start on a live cell to erase" is gone). Pan moves the view with a mouse, pen or finger and never changes a cell. Right-, middle- and Shift-drag still pan under every tool.
- Added a Help dialog describing the real controls, shortcuts and the wrapping board.
- Added Undo and Redo for strokes, placed patterns, Clear and Randomize (bounded to the latest 50 steps; Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z), and a Restart from seed button that returns to the setup a run started from at generation 0. Restart is itself undoable.
- Added a Light / Dark / System theme switch. The choice is saved in the browser; System follows the OS. The page and the board both re-theme immediately, even while paused.
- Added − / + zoom buttons with a px/cell readout (disabled at the limits), a Live cells fit that frames the living cells with a margin (or the whole board when empty), and a permanent "256 × 160 · Wrapping edges" status line.
- The Pattern library shows a miniature, category and short factual description for each preset, with separate **Load** (clean board, paused at generation 0, becomes the Restart seed, one undo step) and **Stamp** (keeps the board, ghost preview, rotation, touch placement) actions. A new session opens on a centred, paused Gosper glider gun with a dismissible start hint instead of a random board; Randomize is still available.

## [1.0.0] - 2026-10-18

### Added

- Static site scaffold with CI (`node --test`) and GitHub Pages deployment ([#10](https://github.com/adisakshya/conways-game-of-life/pull/10)).
- Toroidal 256×160 B3/S23 simulation engine with `Uint8Array` double buffers and population/generation tracking ([#11](https://github.com/adisakshya/conways-game-of-life/pull/11)).
- Crisp canvas renderer: device-pixel cell sizes, offscreen cell layer, 1-device-pixel minor and major gridlines, visible-range drawing ([#12](https://github.com/adisakshya/conways-game-of-life/pull/12)).
- Gap-free painting from coalesced pointer events with Bresenham interpolation, draw/erase by starting cell, hover outline ([#13](https://github.com/adisakshya/conways-game-of-life/pull/13)).
- Play/pause, step, 1–120 gen/s speed, clear, randomize, live counters and keyboard shortcuts ([#14](https://github.com/adisakshya/conways-game-of-life/pull/14)).
- Eight pattern presets with plaintext/RLE parsing, rotation, ghost-preview stamping and touch placement ([#15](https://github.com/adisakshya/conways-game-of-life/pull/15)).
- Wheel/trackpad zoom around the cursor, drag panning, fit-to-screen and two-finger pinch ([#16](https://github.com/adisakshya/conways-game-of-life/pull/16)).
- Light/dark theming via CSS custom properties, focus rings, screen-reader stats, safe-area insets and a toolbar that wraps down to 360 px ([#17](https://github.com/adisakshya/conways-game-of-life/pull/17)).
- README, changelog and screenshot ([#18](https://github.com/adisakshya/conways-game-of-life/pull/18)).

### Fixed

- Fit no longer clips the board at fractional pixel ratios, and moving between displays keeps the view centred ([#22](https://github.com/adisakshya/conways-game-of-life/pull/22)).
- Holding Space toggles playback once; Space and Enter activate a focused button; speed changes no longer burst generations ([#23](https://github.com/adisakshya/conways-game-of-life/pull/23)).
- A pinch can no longer lock out one-finger drawing; the stamp toast stays inside horizontal safe areas ([#24](https://github.com/adisakshya/conways-game-of-life/pull/24)).

[Unreleased]: https://github.com/adisakshya/conways-game-of-life/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/adisakshya/conways-game-of-life/releases/tag/v1.0.0
