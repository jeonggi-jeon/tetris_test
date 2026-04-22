import {
  COLS,
  ROWS,
  BUFFER_ROWS,
  VISIBLE_ROWS,
  COLORS,
} from "./constants.js";
import { getPieceCells } from "./game.js";

/** @typedef {{ x: number, y: number, vx: number, vy: number, timeLeft: number, maxLife: number, color: string }} Particle */

/** @type {Particle[]} */
let particles = [];

export function resetParticles() {
  particles = [];
}

export function spawnLineClearBurst(
  clearedRows,
  cellSize,
  _canvasWidth,
  reducedMotion,
) {
  if (reducedMotion || clearedRows.length === 0) return;
  for (const br of clearedRows) {
    const cy = (br - BUFFER_ROWS) * cellSize + cellSize * 0.5;
    if (cy < -cellSize || cy > VISIBLE_ROWS * cellSize + cellSize) continue;
    for (let col = 0; col < COLS; col++) {
      const cx = col * cellSize + cellSize * 0.5;
      const hue = (col / COLS) * 80 + (br % 3) * 40;
      for (let n = 0; n < 3; n++) {
        const maxLife = 420 + Math.random() * 200;
        particles.push({
          x: cx,
          y: cy,
          vx: (Math.random() - 0.5) * 3.2,
          vy: -2.2 - Math.random() * 2.5,
          timeLeft: maxLife,
          maxLife,
          color: `hsla(${hue}, 100%, 68%, 1)`,
        });
      }
    }
  }
}

function updateParticles(dt) {
  if (dt <= 0) return;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.timeLeft -= dt;
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.12;
    if (p.timeLeft <= 0) particles.splice(i, 1);
  }
}

function drawParticles(ctx, reducedMotion) {
  if (reducedMotion) return;
  for (const p of particles) {
    const t = 1 - p.timeLeft / p.maxLife;
    const a = Math.max(0, 1 - t);
    ctx.globalAlpha = a * 0.85;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.2 + (1 - a) * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function cellScreenY(boardRow, cellSize) {
  return (boardRow - BUFFER_ROWS) * cellSize;
}

function drawBlock(
  ctx,
  sx,
  sy,
  cellSize,
  type,
  opts = {},
) {
  const { ghost = false, alpha = 1 } = opts;
  const palette = COLORS[type] ?? COLORS.T;
  const pad = 1;
  const w = cellSize - pad * 2;
  const h = cellSize - pad * 2;
  const x = sx + pad;
  const y = sy + pad;

  ctx.save();
  ctx.globalAlpha = ghost ? 0.22 : alpha;

  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  if (ghost) {
    g.addColorStop(0, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(200,220,255,0.08)");
  } else {
    g.addColorStop(0, palette.core);
    g.addColorStop(1, palette.glow);
  }

  ctx.fillStyle = g;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, 5);
  } else {
    ctx.rect(x, y, w, h);
  }
  ctx.fill();

  if (!ghost) {
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.shadowColor = palette.glow;
    ctx.shadowBlur = 12;
    ctx.stroke();
  }
  ctx.restore();
}

function drawBoardLayer(ctx, board, cellSize, canvasHeight) {
  const grd = ctx.createLinearGradient(0, 0, 0, canvasHeight);
  grd.addColorStop(0, "rgba(14,18,38,0.92)");
  grd.addColorStop(1, "rgba(8,10,22,0.96)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, COLS * cellSize, canvasHeight);

  ctx.strokeStyle = "rgba(0,240,255,0.06)";
  ctx.lineWidth = 1;
  for (let c = 0; c <= COLS; c++) {
    const x = c * cellSize;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasHeight);
    ctx.stroke();
  }
  const firstRow = BUFFER_ROWS;
  const lastRow = ROWS - 1;
  for (let r = firstRow; r <= lastRow; r++) {
    const y = cellScreenY(r, cellSize);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(COLS * cellSize, y);
    ctx.stroke();
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = board[r][c];
      if (!t) continue;
      const cy = cellScreenY(r, cellSize);
      if (cy + cellSize < 0 || cy > canvasHeight) continue;
      drawBlock(ctx, c * cellSize, cy, cellSize, t);
    }
  }
}

function drawPieceAt(ctx, type, rotation, ox, oy, cellSize, canvasHeight, opts) {
  const cells = getPieceCells(type, rotation, ox, oy);
  for (const [r, c] of cells) {
    const cy = cellScreenY(r, cellSize);
    if (cy + cellSize < 0 || cy > canvasHeight) continue;
    drawBlock(ctx, c * cellSize, cy, cellSize, type, opts);
  }
}

/**
 * @typedef {{ x: number, y: number }} MobileBoardOffset
 */

/**
 * @param {MobileBoardOffset | null} mobileBoardOffset 모바일에서 보드를 가운데 그릴 때 평행이동(px)
 */
export function drawMain(
  ctx,
  gameState,
  ghostY,
  cellSize,
  dt,
  reducedMotion,
  mobileBoardOffset = null,
) {
  const isMobile = window.innerWidth <= 900;
  const logicalBoardH = VISIBLE_ROWS * cellSize;

  if (isMobile && mobileBoardOffset) {
    const cw = ctx.canvas.clientWidth;
    const ch = ctx.canvas.clientHeight;
    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate(mobileBoardOffset.x, mobileBoardOffset.y);
  }

  const canvasHeight = logicalBoardH;
  drawBoardLayer(ctx, gameState.board, cellSize, canvasHeight);

  const cur = gameState.current;
  if (cur != null && ghostY != null) {
    drawPieceAt(ctx, cur.type, cur.rotation, cur.x, ghostY, cellSize, canvasHeight, {
      ghost: true,
    });
    drawPieceAt(ctx, cur.type, cur.rotation, cur.x, cur.y, cellSize, canvasHeight, {});
  }

  updateParticles(reducedMotion ? 0 : dt);
  drawParticles(ctx, reducedMotion);

  if (isMobile && mobileBoardOffset) {
    ctx.restore();
  }
}

export function drawNext(ctx, nextType, cellSize) {
  const canvas = ctx.canvas;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(8,10,22,0.92)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!nextType) return;

  const cells = getPieceCells(nextType, 0, 0, 0);
  let minR = 4;
  let minC = 4;
  let maxR = 0;
  let maxC = 0;
  for (const [r, c] of cells) {
    minR = Math.min(minR, r);
    minC = Math.min(minC, c);
    maxR = Math.max(maxR, r);
    maxC = Math.max(maxC, c);
  }
  const bw = maxC - minC + 1;
  const bh = maxR - minR + 1;
  const ox =
    (canvas.width / cellSize - bw) / 2 - minC;
  const oy =
    (canvas.height / cellSize - bh) / 2 - minR;

  drawPieceAt(ctx, nextType, 0, ox, oy, cellSize, canvas.height, {});
}
