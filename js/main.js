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

// 모바일: 화면에 맞게 CELL 크기 계산
let CELL = 32;
let NEXT_CELL = 24;
const DAS_DELAY_MS = 170;
const DAS_INTERVAL_MS = 50;

function calculateCellSize() {
  const isMobile = window.innerWidth <= 900;
  if (isMobile) {
    // 모바일: 게임 높이를 화면 높이에 맞춤
    CELL = Math.floor(window.innerHeight / VISIBLE_ROWS);
    NEXT_CELL = Math.floor(CELL * 0.75);
  }
}

// CELL 크기 초기 계산
calculateCellSize();

const gameCanvas = /** @type {HTMLCanvasElement} */ (
  document.getElementById("gameCanvas")
);
const nextCanvas = /** @type {HTMLCanvasElement} */ (
  document.getElementById("nextCanvas")
);
const nextCanvasMobile = /** @type {HTMLCanvasElement} */ (
  document.getElementById("nextCanvasMobile")
);
const boardWrap = document.getElementById("boardWrap");
const flashOverlay = document.getElementById("flashOverlay");
const pauseOverlay = document.getElementById("pauseOverlay");
const gameOverOverlay = document.getElementById("gameOverOverlay");
const scoreEl = document.getElementById("score");
const levelEl = document.getElementById("level");
const linesEl = document.getElementById("lines");
const scoreMobileEl = document.getElementById("scoreMobile");
const levelMobileEl = document.getElementById("levelMobile");
const linesMobileEl = document.getElementById("linesMobile");
const finalScoreEl = document.getElementById("finalScore");
const btnStartMobile = document.getElementById("btnStartMobile");
const btnStartPC = document.getElementById("btnStartPC");
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
const nextCtxMobile = setupHiDpiCanvas(nextCanvasMobile, nextCanvasMobile.width, nextCanvasMobile.height);

function setupHiDpiCanvas(canvas, cssW, cssH) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  // 모바일: 전체 화면 크기 사용
  const isMobile = window.innerWidth <= 900;
  const w = isMobile ? window.innerWidth : cssW;
  const h = isMobile ? window.innerHeight : cssH;

  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
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
  if (scoreMobileEl) scoreMobileEl.textContent = String(state.score);
  if (levelMobileEl) levelMobileEl.textContent = String(state.level);
  if (linesMobileEl) linesMobileEl.textContent = String(state.lines);
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

  // 모바일: NEXT_CELL 사용
  const isMobile = window.innerWidth <= 900;
  const nextCellMobile = isMobile ? NEXT_CELL : 30;
  drawNext(nextCtxMobile, state.nextType, nextCellMobile);
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

function togglePause() {
  if (!playing || state.gameOver) return;
  paused = !paused;
  pauseOverlay.hidden = !paused;
}

function pressMoveLeft() {
  if (!playing || paused || state.gameOver) return;
  if (!keys.left) {
    keys.left = true;
    tryMove(state, -1, 0);
    resetDas();
  }
}

function releaseMoveLeft() {
  keys.left = false;
}

function pressMoveRight() {
  if (!playing || paused || state.gameOver) return;
  if (!keys.right) {
    keys.right = true;
    tryMove(state, 1, 0);
    resetDas();
  }
}

function releaseMoveRight() {
  keys.right = false;
}

function pressSoftDrop() {
  if (!playing || paused || state.gameOver) return;
  keys.down = true;
}

function releaseSoftDrop() {
  keys.down = false;
}

function actionRotate() {
  if (!playing || paused || state.gameOver) return;
  tryRotate(state, 1);
}

function actionHardDrop() {
  if (!playing || paused || state.gameOver) return;
  const lr = hardDrop(state);
  triggerLineFx(lr);
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
    togglePause();
    return;
  }

  if (paused || state.gameOver) return;

  if (e.code === "ArrowLeft") {
    pressMoveLeft();
    return;
  }
  if (e.code === "ArrowRight") {
    pressMoveRight();
    return;
  }
  if (e.code === "ArrowDown") {
    pressSoftDrop();
    return;
  }
  if (e.code === "ArrowUp") {
    actionRotate();
    return;
  }
  if (e.code === "Space") {
    actionHardDrop();
    return;
  }
}

function onKeyUp(e) {
  if (e.code === "ArrowLeft") releaseMoveLeft();
  if (e.code === "ArrowRight") releaseMoveRight();
  if (e.code === "ArrowDown") releaseSoftDrop();
}

function bindTouchControls() {
  const mobileRoot = document.querySelector(".mobile-controls");
  const desktopRoot = document.querySelector(".touch-controls");
  const root = mobileRoot || desktopRoot;

  if (!root) return;

  root.addEventListener("contextmenu", (e) => e.preventDefault());

  const holdActions = new Set(["left", "right", "soft-drop"]);

  /** @param {PointerEvent} e */
  function onPointerDown(e) {
    const btn = e.target.closest("[data-action]");
    if (!btn || !root.contains(btn)) return;
    if (e.button !== 0) return;
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);

    const action = btn.getAttribute("data-action");
    if (!action) return;

    if (holdActions.has(action)) {
      if (action === "left") pressMoveLeft();
      else if (action === "right") pressMoveRight();
      else if (action === "soft-drop") pressSoftDrop();
    } else if (action === "rotate") {
      actionRotate();
    } else if (action === "hard-drop") {
      actionHardDrop();
    } else if (action === "pause") {
      togglePause();
    }
  }

  /** @param {PointerEvent} e */
  function onPointerUp(e) {
    const btn = e.target.closest("[data-action]");
    if (!btn || !root.contains(btn)) return;
    const action = btn.getAttribute("data-action");
    if (!action) return;

    if (action === "left") releaseMoveLeft();
    else if (action === "right") releaseMoveRight();
    else if (action === "soft-drop") releaseSoftDrop();
  }

  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", onPointerUp);
  root.addEventListener("pointerleave", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || !root.contains(btn)) return;
    const action = btn.getAttribute("data-action");
    if (action === "left") releaseMoveLeft();
    else if (action === "right") releaseMoveRight();
    else if (action === "soft-drop") releaseSoftDrop();
  });
}

function startGameSession() {
  resetParticles();
  startGame(state);
  playing = true;
  paused = false;
  pauseOverlay.hidden = true;
  gameOverOverlay.hidden = true;
  syncHud();
  document.body.classList.add("game-started");
}

if (btnStartMobile) btnStartMobile.addEventListener("click", startGameSession);
if (btnStartPC) btnStartPC.addEventListener("click", startGameSession);
if (btnRestart) btnRestart.addEventListener("click", startGameSession);

window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);

bindTouchControls();

syncHud();
drawNext(nextCtx, state.nextType, NEXT_CELL);
const isMobileInit = window.innerWidth <= 900;
const nextCellMobileInit = isMobileInit ? NEXT_CELL : 30;
drawNext(nextCtxMobile, state.nextType, nextCellMobileInit);
requestAnimationFrame(loop);
