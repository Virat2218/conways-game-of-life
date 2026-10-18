# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- README, changelog and screenshot.

[Unreleased]: https://github.com/adisakshya/conways-game-of-life/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/adisakshya/conways-game-of-life/releases/tag/v1.0.0
