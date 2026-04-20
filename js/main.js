import { COLS, VISIBLE_ROWS } from "./constants.js";
import {
  createGameState,
  startGame,
  updatePlaying,
  tryMove,
  tryRotate,
  hardDrop,
  computeGhostY,
} from "./game.js";
import {
  drawMain,
  drawNext,
  spawnLineClearBurst,
  resetParticles,
} from "./render.js";

const CELL = 32;
const NEXT_CELL = 24;
const DAS_DELAY_MS = 170;
const DAS_INTERVAL_MS = 50;

const gameCanvas = /** @type {HTMLCanvasElement} */ (
  document.getElementById("gameCanvas")
);
const nextCanvas = /** @type {HTMLCanvasElement} */ (
  document.getElementById("nextCanvas")
);
const boardWrap = document.getElementById("boardWrap");
const flashOverlay = document.getElementById("flashOverlay");
const pauseOverlay = document.getElementById("pauseOverlay");
const gameOverOverlay = document.getElementById("gameOverOverlay");
const scoreEl = document.getElementById("score");
const levelEl = document.getElementById("level");
const linesEl = document.getElementById("lines");
const finalScoreEl = document.getElementById("finalScore");
const btnStart = document.getElementById("btnStart");
const btnRestart = document.getElementById("btnRestart");

let reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

const motionMq = window.matchMedia("(prefers-reduced-motion: reduce)");
motionMq.addEventListener("change", (e) => {
  reducedMotion = e.matches;
  if (reducedMotion) resetParticles();
});

const ctx = setupHiDpiCanvas(gameCanvas, COLS * CELL, VISIBLE_ROWS * CELL);
const nextCtx = setupHiDpiCanvas(nextCanvas, nextCanvas.width, nextCanvas.height);

function setupHiDpiCanvas(canvas, cssW, cssH) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const c = canvas.getContext("2d");
  if (!c) throw new Error("2d context unavailable");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return c;
}

const state = createGameState();

let playing = false;
let paused = false;
let lastTs = 0;

/** @type {{ left: boolean, right: boolean, down: boolean }} */
const keys = { left: false, right: false, down: false };

/** 지연 자동 이동(DAS): 첫 입력 후 DAS_DELAY_MS, 이후 DAS_INTERVAL_MS마다 반복 */
const das = { timer: 0, armed: false };

function syncHud() {
  scoreEl.textContent = String(state.score);
  levelEl.textContent = String(state.level);
  linesEl.textContent = String(state.lines);
}

function triggerLineFx(lineResult) {
  if (!lineResult || lineResult.cleared === 0) return;
  const w = COLS * CELL;
  spawnLineClearBurst(lineResult.rows, CELL, w, reducedMotion);
  if (!reducedMotion) {
    flashOverlay.classList.remove("active");
    void flashOverlay.offsetWidth;
    flashOverlay.classList.add("active");
    setTimeout(() => flashOverlay.classList.remove("active"), 380);
    if (lineResult.cleared >= 4) {
      boardWrap.classList.remove("shake");
      void boardWrap.offsetWidth;
      boardWrap.classList.add("shake");
      setTimeout(() => boardWrap.classList.remove("shake"), 400);
    }
  }
}

function loop(ts) {
  const dt = lastTs ? Math.min(48, ts - lastTs) : 16;
  lastTs = ts;

  if (playing && !paused && !state.gameOver) {
    const input = { softDrop: keys.down };
    const lineResult = updatePlaying(state, dt, input);
    triggerLineFx(lineResult);

    runDas(dt);
  }

  const ghostY = computeGhostY(state);
  drawMain(ctx, state, ghostY, CELL, dt, reducedMotion);
  drawNext(nextCtx, state.nextType, NEXT_CELL);
  syncHud();

  if (state.gameOver && playing) {
    playing = false;
    finalScoreEl.textContent = String(state.score);
    gameOverOverlay.hidden = false;
  }

  requestAnimationFrame(loop);
}

function resetDas() {
  das.timer = 0;
  das.armed = false;
}

function runDas(dt) {
  if (!state.current || state.gameOver) return;

  const left = keys.left && !keys.right;
  const right = keys.right && !keys.left;
  if (!left && !right) {
    resetDas();
    return;
  }

  const dir = left ? -1 : 1;
  das.timer += dt;

  while (das.timer >= (das.armed ? DAS_INTERVAL_MS : DAS_DELAY_MS)) {
    das.timer -= das.armed ? DAS_INTERVAL_MS : DAS_DELAY_MS;
    das.armed = true;
    tryMove(state, dir, 0);
  }
}

function onKeyDown(e) {
  if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
    e.preventDefault();
  }

  if (["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "Space"].includes(
    e.code,
  )) {
    e.preventDefault();
  }

  if (!playing) {
    if (e.code === "Enter" && !gameOverOverlay.hidden) {
      /* ignore */
    }
    return;
  }

  if (e.code === "Escape" || e.code === "KeyP") {
    if (!state.gameOver) {
      paused = !paused;
      pauseOverlay.hidden = !paused;
    }
    return;
  }

  if (paused || state.gameOver) return;

  if (e.code === "ArrowLeft") {
    if (!keys.left) {
      keys.left = true;
      tryMove(state, -1, 0);
      resetDas();
    }
    return;
  }
  if (e.code === "ArrowRight") {
    if (!keys.right) {
      keys.right = true;
      tryMove(state, 1, 0);
      resetDas();
    }
    return;
  }
  if (e.code === "ArrowDown") {
    keys.down = true;
    return;
  }
  if (e.code === "ArrowUp") {
    tryRotate(state, 1);
    return;
  }
  if (e.code === "Space") {
    const lr = hardDrop(state);
    triggerLineFx(lr);
    return;
  }
}

function onKeyUp(e) {
  if (e.code === "ArrowLeft") keys.left = false;
  if (e.code === "ArrowRight") keys.right = false;
  if (e.code === "ArrowDown") keys.down = false;
}

btnStart.addEventListener("click", () => {
  resetParticles();
  startGame(state);
  playing = true;
  paused = false;
  pauseOverlay.hidden = true;
  gameOverOverlay.hidden = true;
  syncHud();
});

btnRestart.addEventListener("click", () => {
  resetParticles();
  startGame(state);
  playing = true;
  paused = false;
  pauseOverlay.hidden = true;
  gameOverOverlay.hidden = true;
  syncHud();
});

window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);

syncHud();
drawNext(nextCtx, state.nextType, NEXT_CELL);
requestAnimationFrame(loop);
