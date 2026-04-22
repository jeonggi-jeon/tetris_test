# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Neon Tetris** is a browser-based Tetris game written in vanilla HTML/CSS/JavaScript with ES modules. It runs on both desktop (keyboard controls) and mobile (touch controls) with a neon aesthetic and particle effects.

## Development Setup

**Running the game:**
```bash
npx --yes serve . --listen 8080
```

Then open `http://localhost:8080` in a browser. To play on mobile from the same WiFi, use the PC's local IP (e.g., `http://192.168.x.x:8080`).

## Architecture

### Game Loop & Input (js/main.js)

- **Main loop**: `requestAnimationFrame()` callback that updates game state, renders, and syncs HUD
- **Input handling**: 
  - Keyboard: arrow keys (move/rotate), Space (hard drop), P/Esc (pause)
  - Touch: via pointer events on `.touch-controls` buttons with data-action attributes
  - **DAS (Delayed Auto Shift)**: movement repeat after 170ms delay, then every 50ms—essential for feel; implemented via `das` object tracking timer and armed state
- **Canvas setup**: `setupHiDpiCanvas()` scales for device pixel ratio (up to 2x) for sharp rendering

### Game State & Logic (js/game.js)

- **State object**: board (grid), current piece, nextType, score, level, lines, falling accumulator, gameOver flag
- **Piece system**: 7-bag randomization (shuffle bag resets when empty), rotation with wall-kick KICKS array `[0, -1, 1, -2, 2]`
- **Collision detection**: checks bounds and occupied cells; used for movement, rotation, and spawning
- **Gravity & locking**: soft drop is 14x speed multiplier; piece locks when it can't move down, triggers line clear
- **Scoring**: NES-style (40/100/300/1200 for 1/2/3/4 lines), multiplied by `level + 1`, plus combo bonus `50 * combo * level`
- **Level progression**: 10 lines per level; drop speed increases by reducing interval (formula: `max(70, 1000 - (level - 1) * 65)`)

### Rendering & Particles (js/render.js)

- **Canvas drawing**: blocks rendered with gradient + glow effect via `drawBlock()` (core color + glow hue); ghost piece at low alpha (0.22)
- **Particles**: line clear spawns 3 particles per cell, velocity-based with gravity falloff; color varies by column/row; respects `prefers-reduced-motion` media query
- **Main render**: `drawMain()` draws board, current piece, ghost piece, and particles each frame

### Constants (js/constants.js)

- **Board**: 10 columns, 22 rows (20 visible + 2 buffer at top for rotation room)
- **Piece definitions**: SHAPES object maps type (I/O/T/S/Z/J/L) → array of 4 rotations, each with [row, col] offsets in 4×4 local grid
- **Colors**: core (glow effect base) and glow (outline) for each piece type
- **Scoring table**: LINE_SCORE array for 1-4 line clears

## Key Implementation Details

1. **Touch controls**: buttons use `setPointerCapture()` for drag support; hold actions (left/right/soft-drop) work on pointer down/up, instant actions (rotate/hard-drop/pause) on pointer down
2. **Flash & shake effects**: line clear triggers flash overlay fade-in/out (380ms) and board shake animation (400ms) for 4+ lines
3. **Responsive UI**: media query `(max-width: 768px)` hides desktop hints and shows mobile touch panel
4. **Accessibility**: semantic HTML, aria-labels on canvas and buttons, color-independent piece identification via type names

## When Modifying

- Changing piece spawn position, rotation behavior, or collision logic: verify game-over detection still works at top buffer rows
- Adding visual effects: check `reducedMotion` flag to respect user preferences
- Adjusting DAS timings (170ms/50ms): affects feel significantly; test on keyboard and touch
- Modifying scoring: ensure level progression curves remain balanced (70-1000ms drop interval range)
