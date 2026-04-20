import {
  COLS,
  ROWS,
  SHAPES,
  PIECE_TYPES,
  LINE_SCORE,
  LINES_PER_LEVEL,
} from "./constants.js";

function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function shuffleBag() {
  const bag = [...PIECE_TYPES];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

function pullFromBag(state) {
  if (state.bag.length === 0) state.bag = shuffleBag();
  return state.bag.pop();
}

export function getPieceCells(type, rotation, ox, oy) {
  const cells = SHAPES[type][rotation & 3];
  return cells.map(([r, c]) => [r + oy, c + ox]);
}

function collides(board, type, rotation, ox, oy) {
  const cells = getPieceCells(type, rotation, ox, oy);
  for (const [r, c] of cells) {
    if (c < 0 || c >= COLS || r >= ROWS) return true;
    if (r >= 0 && board[r][c] !== null) return true;
  }
  return false;
}

export function getDropIntervalMs(level) {
  const lv = Math.max(1, level);
  const ms = 1000 - (lv - 1) * 65;
  return Math.max(70, ms);
}

export function createGameState() {
  const state = {
    board: createBoard(),
    current: null,
    nextType: null,
    bag: shuffleBag(),
    score: 0,
    level: 1,
    lines: 0,
    linesForNextLevel: 0,
    fallAccumulator: 0,
    gameOver: false,
    combo: -1,
  };
  state.nextType = pullFromBag(state);
  return state;
}

export function spawnPiece(state) {
  const type = state.nextType;
  state.nextType = pullFromBag(state);
  const rotation = 0;
  const x = 3;
  const y = 0;
  if (collides(state.board, type, rotation, x, y)) {
    state.gameOver = true;
    state.current = null;
    return false;
  }
  state.current = { type, x, y, rotation };
  return true;
}

export function tryMove(state, dx, dy) {
  const p = state.current;
  if (!p || state.gameOver) return false;
  const nx = p.x + dx;
  const ny = p.y + dy;
  if (collides(state.board, p.type, p.rotation, nx, ny)) return false;
  p.x = nx;
  p.y = ny;
  return true;
}

const KICKS = [0, -1, 1, -2, 2];

export function tryRotate(state, dir) {
  const p = state.current;
  if (!p || state.gameOver) return false;
  const nextRot = (p.rotation + (dir > 0 ? 1 : 3)) & 3;
  if (p.type === "O") return false;
  for (const k of KICKS) {
    const nx = p.x + k;
    if (!collides(state.board, p.type, nextRot, nx, p.y)) {
      p.rotation = nextRot;
      p.x = nx;
      return true;
    }
  }
  return false;
}

export function computeGhostY(state) {
  const p = state.current;
  if (!p || state.gameOver) return null;
  let gy = p.y;
  while (!collides(state.board, p.type, p.rotation, p.x, gy + 1)) gy += 1;
  return gy;
}

export function hardDrop(state) {
  const p = state.current;
  if (!p || state.gameOver) return null;
  let drops = 0;
  while (tryMove(state, 0, 1)) drops += 1;
  state.score += drops * 2;
  return lockPiece(state);
}

export function lockPiece(state) {
  const p = state.current;
  if (!p) return null;
  const cells = getPieceCells(p.type, p.rotation, p.x, p.y);
  for (const [r, c] of cells) {
    if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
      state.board[r][c] = p.type;
    }
  }
  state.current = null;
  const lineResult = clearLines(state);
  applyLineScore(state, lineResult.cleared);
  if (!state.gameOver) spawnPiece(state);
  return lineResult;
}

export function clearLines(state) {
  const board = state.board;
  const fullRows = [];
  for (let r = 0; r < ROWS; r++) {
    if (board[r].every((cell) => cell !== null)) fullRows.push(r);
  }
  const cleared = fullRows.length;
  const kept = [];
  for (let r = 0; r < ROWS; r++) {
    if (!board[r].every((cell) => cell !== null)) kept.push(board[r]);
  }
  while (kept.length < ROWS) {
    kept.unshift(Array(COLS).fill(null));
  }
  for (let i = 0; i < ROWS; i++) {
    state.board[i] = kept[i];
  }
  return { cleared, rows: fullRows };
}

function applyLineScore(state, cleared) {
  if (cleared === 0) {
    state.combo = -1;
    return;
  }
  state.combo += 1;
  state.lines += cleared;
  state.linesForNextLevel += cleared;
  const base = LINE_SCORE[cleared] ?? 0;
  const lvl = state.level;
  let points = base * (lvl + 1);
  if (state.combo > 0) points += 50 * state.combo * lvl;
  state.score += points;

  while (state.linesForNextLevel >= LINES_PER_LEVEL) {
    state.linesForNextLevel -= LINES_PER_LEVEL;
    state.level += 1;
  }
}

export function tickGravity(state, deltaMs, softDropActive) {
  const p = state.current;
  if (!p || state.gameOver) return null;
  const interval = getDropIntervalMs(state.level);
  const speedMul = softDropActive ? 14 : 1;
  state.fallAccumulator += deltaMs * speedMul;
  while (state.fallAccumulator >= interval) {
    state.fallAccumulator -= interval;
    if (!tryMove(state, 0, 1)) {
      return lockPiece(state);
    }
  }
  return null;
}

export function updatePlaying(state, deltaMs, input) {
  if (state.gameOver || !state.current) return null;
  return tickGravity(state, deltaMs, input.softDrop);
}

export function startGame(state) {
  state.board = createBoard();
  state.score = 0;
  state.level = 1;
  state.lines = 0;
  state.linesForNextLevel = 0;
  state.fallAccumulator = 0;
  state.gameOver = false;
  state.combo = -1;
  state.bag = shuffleBag();
  state.nextType = pullFromBag(state);
  spawnPiece(state);
}
