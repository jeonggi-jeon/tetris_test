import { BUFFER_ROWS, COLS, ROWS, VISIBLE_ROWS } from "./constants.js";
import {
  createGameState,
  startGame,
  updatePlaying,
  getPieceCells,
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
/** 우측 상단 미리보기(≈42px)·여백 — 가로 격자와 겹침 완화 */
const MOBILE_RIGHT_RESERVED_PX = 72;

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
  /* 뷰포트 전체 너비(vw) 기준 가로 중앙 — innerW 는 CELL만 제한, 오프셋은 vw 사용 */
  mobileBoardOffsetX = (vw - bw) / 2;
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
/* 모바일 CSS(≈42px)와 일치 — 100px 버퍼 + 작은 화면 표시 시 셀 스케일 불일치 방지 */
const nextMobilePreviewPx = 42;
const nextCtxMobile = setupHiDpiCanvas(
  nextCanvasMobile,
  isMobileViewport() ? nextMobilePreviewPx : nextCanvasMobile.width,
  isMobileViewport() ? nextMobilePreviewPx : nextCanvasMobile.height,
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

/** 모바일 next 캔버스(CSS ~42px) — 게임의 NEXT_CELL(큼)을 쓰면 4칸 막대가 캔버스 밖으로 나가 보이지 않음 */
function getNextPreviewCellSize() {
  if (!nextCanvasMobile) return 9;
  const w = nextCanvasMobile.clientWidth;
  const h = nextCanvasMobile.clientHeight;
  const m = Math.min(w > 0 ? w : 42, h > 0 ? h : 42);
  return Math.max(3, Math.min(11, Math.floor(m / 4.3)));
}

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
  if (!ctx) {
    refreshGameCanvasContext();
  }
  if (!ctx) {
    requestAnimationFrame(loop);
    return;
  }

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
  const nextCellMobile = isMobile ? getNextPreviewCellSize() : 30;
  drawNext(nextCtxMobile, state.nextType, nextCellMobile, true);
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

/** 모바일 캔버스(뷰포트) 좌표가 현재 조각이 차지한 칸에 해당하는지 */
function isClientPointOnCurrentFallingPiece(clientX, clientY) {
  if (!state.current || !gameCanvasMobile) return false;
  const rect = gameCanvasMobile.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  if (!Number.isFinite(localX) || !Number.isFinite(localY)) return false;
  const c = Math.floor((localX - mobileBoardOffsetX) / CELL);
  const r = Math.floor((localY - mobileBoardOffsetY) / CELL) + BUFFER_ROWS;
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
  return getPieceCells(
    state.current.type,
    state.current.rotation,
    state.current.x,
    state.current.y,
  ).some(([pr, pc]) => pr === r && pc === c);
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

/** 셀 너비의 일정 비율을 넘을 때마다 1칸 (버튼 DAS와 맞는 느낌) */
const MOBILE_BOARD_DRAG_STRIDE = 0.42;
function getMobileDragThreshold() {
  return Math.max(CELL * MOBILE_BOARD_DRAG_STRIDE, 8);
}
/** 이보다 짧으면 드래그(좌우이동)가 아닌 '탭'으로 보고 조각 위에서 회전 */
const MOBILE_CANVAS_TAP_MAX_PX = 16;
/** 터치 시작 대비 이 정도 이상·세로(아래)가 우세하면 하드 드롭 1회 */
const MOBILE_FLICK_DOWN_MIN_PX = 36;
const gameDrag = {
  active: false,
  lastClientX: 0,
  startClientX: 0,
  startClientY: 0,
  /** Draggable: 한 칸이라도 좌우로 이동에 성공하면 '탭 회전' 대비 취소 */
  strafeThisPointer: false,
  /** 하드 드롭 후 손 뗄 때까지 좌우 이동/중복 낙하 방지 */
  lockedByHardDrop: false,
  /** @type {number | null} */
  pointerId: null,
};

function shouldMobileHardDropFromFlick(drx, dry) {
  if (dry < MOBILE_FLICK_DOWN_MIN_PX) return false;
  /* 아래(y 증가) — 가로 끌기보다 세로가 뚜렷할 때만 */
  return dry >= Math.abs(drx) * 0.7;
}

function bindGameCanvasPointerDrag() {
  if (!gameCanvasMobile) return;

  const end = (e) => {
    if (gameDrag.pointerId != null && e.pointerId === gameDrag.pointerId) {
      if (isMobileViewport() && playing && !paused && !state.gameOver) {
        const dx = e.clientX - gameDrag.startClientX;
        const dy = e.clientY - gameDrag.startClientY;
        if (
          !gameDrag.lockedByHardDrop
          && !gameDrag.strafeThisPointer
          && Math.hypot(dx, dy) < MOBILE_CANVAS_TAP_MAX_PX
          && isClientPointOnCurrentFallingPiece(gameDrag.startClientX, gameDrag.startClientY)
        ) {
          actionRotate();
        }
      }
      try {
        gameCanvasMobile.releasePointerCapture(gameDrag.pointerId);
      } catch {
        /* no-op */
      }
      gameDrag.active = false;
      gameDrag.pointerId = null;
      gameDrag.lockedByHardDrop = false;
    }
  };

  gameCanvasMobile.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      if (!isMobileViewport() || !playing || paused || state.gameOver) return;
      if (!state.current) return;
      e.preventDefault();
      gameDrag.active = true;
      gameDrag.pointerId = e.pointerId;
      gameDrag.lastClientX = e.clientX;
      gameDrag.startClientX = e.clientX;
      gameDrag.startClientY = e.clientY;
      gameDrag.strafeThisPointer = false;
      gameDrag.lockedByHardDrop = false;
      try {
        gameCanvasMobile.setPointerCapture(e.pointerId);
      } catch {
        /* no-op */
      }
    },
    { passive: false },
  );

  gameCanvasMobile.addEventListener(
    "pointermove",
    (e) => {
      if (!gameDrag.active || gameDrag.pointerId !== e.pointerId) return;
      if (!playing || paused || state.gameOver || !state.current) {
        end(e);
        return;
      }
      e.preventDefault();
      if (gameDrag.lockedByHardDrop) return;
      const drx = e.clientX - gameDrag.startClientX;
      const dry = e.clientY - gameDrag.startClientY;
      if (shouldMobileHardDropFromFlick(drx, dry)) {
        actionHardDrop();
        gameDrag.lockedByHardDrop = true;
        return;
      }
      const t = getMobileDragThreshold();
      const x = e.clientX;
      while (x - gameDrag.lastClientX >= t) {
        if (tryMove(state, 1, 0)) gameDrag.strafeThisPointer = true;
        else break;
        gameDrag.lastClientX += t;
      }
      while (gameDrag.lastClientX - x >= t) {
        if (tryMove(state, -1, 0)) gameDrag.strafeThisPointer = true;
        else break;
        gameDrag.lastClientX -= t;
      }
    },
    { passive: false },
  );

  gameCanvasMobile.addEventListener("pointerup", end);
  gameCanvasMobile.addEventListener("pointercancel", end);
  gameCanvasMobile.addEventListener("lostpointercapture", (e) => {
    if (e.pointerId === gameDrag.pointerId) {
      gameDrag.active = false;
      gameDrag.pointerId = null;
      gameDrag.lockedByHardDrop = false;
    }
  });
}

let lastStartSessionAt = 0;
function startGameSession() {
  const now = performance.now();
  if (now - lastStartSessionAt < 500) return;
  lastStartSessionAt = now;

  resetParticles();
  startGame(state);
  playing = true;
  paused = false;
  pauseOverlay.hidden = true;
  gameOverOverlay.hidden = true;
  syncHud();
  document.body.classList.add("game-started");
}

if (btnStartPC) btnStartPC.addEventListener("click", startGameSession);
if (btnRestart) btnRestart.addEventListener("click", startGameSession);

if (btnStartMobile) {
  /** click + touch 대응 (WebKit에서 둘 다 쓸 수 있어 중복 방지는 startGameSession 내부 쿨다운) */
  btnStartMobile.addEventListener("click", startGameSession);
  btnStartMobile.addEventListener("touchend", (e) => {
    e.preventDefault();
    startGameSession();
  }, { passive: false });
}

if (btnPauseResume) {
  btnPauseResume.addEventListener("click", () => {
    if (paused) togglePause();
  });
}

window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);

bindTouchControls();
bindGameCanvasPointerDrag();

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
const nextCellMobileInit = isMobileViewport() ? getNextPreviewCellSize() : 30;
drawNext(nextCtxMobile, state.nextType, nextCellMobileInit, true);
requestAnimationFrame(loop);
