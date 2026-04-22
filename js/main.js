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

// 모바일: 화면에 맞게 CELL 크기 계산 (상단 HUD·하단 버튼 영역 제외, 가로/세로 균형)
let CELL = 32;
let NEXT_CELL = 24;
/** 상단 정보 영역 예상 높이(px) — css/style.css 의 .info-stats 와 대략 일치 */
const MOBILE_TOP_RESERVED_PX = 72;
/** 하단 홈 인디케이터·여백 (터치 버튼은 화면 중앙에 있음) */
const MOBILE_BOTTOM_RESERVED_PX = 24;
/** 우측 상단 미리보기·여백 — 가로 격자 계산 시 빼서 플레이 영역과 겹침 완화 */
const MOBILE_RIGHT_RESERVED_PX = 52;

/** @type {number} */
let mobileBoardOffsetX = 0;
/** @type {number} */
let mobileBoardOffsetY = 0;

const DAS_DELAY_MS = 170;
const DAS_INTERVAL_MS = 50;

function isMobileViewport() {
  return window.innerWidth <= 900;
}

function getMobileViewportSize() {
  const vv = window.visualViewport;
  if (vv) {
    return {
      width: Math.max(1, vv.width),
      height: Math.max(1, vv.height),
    };
  }
  return {
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight),
  };
}

function calculateCellSize() {
  if (!isMobileViewport()) {
    CELL = 32;
    NEXT_CELL = 24;
    mobileBoardOffsetX = 0;
    mobileBoardOffsetY = 0;
    return;
  }

  const { width: vw, height: vh } = getMobileViewportSize();
  const innerW = Math.max(COLS * 12, vw - MOBILE_RIGHT_RESERVED_PX);
  const availH = Math.max(
    120,
    vh - MOBILE_TOP_RESERVED_PX - MOBILE_BOTTOM_RESERVED_PX,
  );

  CELL = Math.max(
    12,
    Math.min(
      Math.floor(innerW / COLS),
      Math.floor(availH / VISIBLE_ROWS),
    ),
  );
  NEXT_CELL = Math.max(12, Math.floor(CELL * 0.75));

  const bw = COLS * CELL;
  const bh = VISIBLE_ROWS * CELL;
  mobileBoardOffsetX = (availW - bw) / 2;
  mobileBoardOffsetY =
    MOBILE_TOP_RESERVED_PX + Math.max(0, (availH - bh) / 2);
}

calculateCellSize();

const gameCanvasMobile = /** @type {HTMLCanvasElement | null} */ (
  document.getElementById("gameCanvasMobile")
);
const gameCanvasPC = /** @type {HTMLCanvasElement | null} */ (
  document.getElementById("gameCanvasPC")
);
const nextCanvas = /** @type {HTMLCanvasElement} */ (
  document.getElementById("nextCanvas")
);
const nextCanvasMobile = /** @type {HTMLCanvasElement} */ (
  document.getElementById("nextCanvasMobile")
);
const boardWrap = document.getElementById("boardWrap");
const flashOverlayMobile = document.getElementById("flashOverlayMobile");
const flashOverlayPC = document.getElementById("flashOverlayPC");
const mobileBoardShake = document.querySelector(".mobile-game-container");
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
const btnPauseResume = document.getElementById("btnPauseResume");

let reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

const motionMq = window.matchMedia("(prefers-reduced-motion: reduce)");
motionMq.addEventListener("change", (e) => {
  reducedMotion = e.matches;
  if (reducedMotion) resetParticles();
});

/** @type {CanvasRenderingContext2D} */
let ctx;

const nextCtx = setupHiDpiCanvas(nextCanvas, nextCanvas.width, nextCanvas.height, false);
const nextCtxMobile = setupHiDpiCanvas(
  nextCanvasMobile,
  nextCanvasMobile.width,
  nextCanvasMobile.height,
  false,
);

/**
 * @param {boolean} [fullViewportOnMobile] 메인 게임 보드만 true — 미리보기 캔버스는 false
 */
function setupHiDpiCanvas(canvas, cssW, cssH, fullViewportOnMobile = false) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const useVv = fullViewportOnMobile && isMobileViewport();
  const vs = useVv ? getMobileViewportSize() : null;
  const w = useVv && vs ? Math.floor(vs.width) : cssW;
  const h = useVv && vs ? Math.floor(vs.height) : cssH;

  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  const c = canvas.getContext("2d");
  if (!c) throw new Error("2d context unavailable");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return c;
}

function refreshGameCanvasContext() {
  const mobile = isMobileViewport();
  const canvas = mobile ? gameCanvasMobile : gameCanvasPC;
  if (!canvas) return;
  const vs = getMobileViewportSize();
  const cssW = mobile ? vs.width : COLS * CELL;
  const cssH = mobile ? vs.height : VISIBLE_ROWS * CELL;
  ctx = setupHiDpiCanvas(canvas, cssW, cssH, true);
}

refreshGameCanvasContext();

function getActiveFlashOverlay() {
  return isMobileViewport() ? flashOverlayMobile : flashOverlayPC;
}

function triggerShake() {
  const target = isMobileViewport() ? mobileBoardShake : boardWrap;
  if (!target) return;
  target.classList.remove("shake");
  void target.offsetWidth;
  target.classList.add("shake");
  setTimeout(() => target.classList.remove("shake"), 400);
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
  if (scoreEl) scoreEl.textContent = String(state.score);
  if (levelEl) levelEl.textContent = String(state.level);
  if (linesEl) linesEl.textContent = String(state.lines);
  if (scoreMobileEl) scoreMobileEl.textContent = String(state.score);
  if (levelMobileEl) levelMobileEl.textContent = String(state.level);
  if (linesMobileEl) linesMobileEl.textContent = String(state.lines);
}

function triggerLineFx(lineResult) {
  if (!lineResult || lineResult.cleared === 0) return;
  const w = COLS * CELL;
  spawnLineClearBurst(lineResult.rows, CELL, w, reducedMotion);
  const flashEl = getActiveFlashOverlay();
  if (!reducedMotion) {
    if (flashEl) {
      flashEl.classList.remove("active");
      void flashEl.offsetWidth;
      flashEl.classList.add("active");
      setTimeout(() => flashEl.classList.remove("active"), 380);
    }
    if (lineResult.cleared >= 4) {
      triggerShake();
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
  const mobileOffset =
    isMobileViewport()
      ? { x: mobileBoardOffsetX, y: mobileBoardOffsetY }
      : null;
  drawMain(ctx, state, ghostY, CELL, dt, reducedMotion, mobileOffset);
  drawNext(nextCtx, state.nextType, NEXT_CELL);

  const isMobile = isMobileViewport();
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

if (btnPauseResume) {
  btnPauseResume.addEventListener("click", () => {
    if (paused) togglePause();
  });
}

window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);

bindTouchControls();

function onViewportChange() {
  calculateCellSize();
  refreshGameCanvasContext();
}

window.addEventListener("resize", onViewportChange);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", onViewportChange);
  window.visualViewport.addEventListener("scroll", onViewportChange);
}

syncHud();
drawNext(nextCtx, state.nextType, NEXT_CELL);
const nextCellMobileInit = isMobileViewport() ? NEXT_CELL : 30;
drawNext(nextCtxMobile, state.nextType, nextCellMobileInit);
requestAnimationFrame(loop);
