/**
 * Jigsaw geometry generator.
 *
 * A puzzle is a grid of rectangular pieces. Every interior edge gets a
 * randomly shaped "tab" (or matching "blank"), generated once and shared by
 * the two neighbouring pieces so the cut lines always interlock exactly.
 *
 * All coordinates are in "board space" (pixels of the scaled source image).
 */
import { mulberry32 } from "./prng.js";

/*
 * Normalised classic jigsaw edge profile, from (0, 0) to (1, 0).
 * Each row is: c1.s, c1.p, c2.s, c2.p, end.s, end.p
 * `s` runs along the edge, `p` is the outward bulge.
 */
const PROFILE = [
  [0.16, 0.0, 0.3, 0.02, 0.38, 0.045],
  [0.335, 0.1, 0.325, 0.21, 0.42, 0.25],
  [0.465, 0.285, 0.535, 0.285, 0.58, 0.25],
  [0.675, 0.21, 0.665, 0.1, 0.62, 0.045],
  [0.7, 0.02, 0.84, 0.0, 1, 0.0]
];

/**
 * Pick a grid whose piece count is close to `count` and whose pieces are as
 * square as possible for the given image aspect ratio.
 */
export function computeGrid(count, aspect) {
  const ideal = Math.sqrt(count * aspect);
  let best = null;

  for (let cols = Math.max(2, Math.floor(ideal) - 2); cols <= ideal + 2; cols++) {
    const rows = Math.max(2, Math.round(count / cols));
    const actual = cols * rows;
    const pieceAspect = (aspect * rows) / cols;
    const score = Math.abs(Math.log(pieceAspect)) + Math.abs(actual - count) / count;
    if (!best || score < best.score) best = { cols, rows, score };
  }

  return { cols: best.cols, rows: best.rows, count: best.cols * best.rows };
}

function cubicAt(a, b, c, d, t) {
  const mt = 1 - t;
  return mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d;
}

/** Build one shared edge as a chain of cubic Bézier segments (A -> B). */
function makeEdge(ax, ay, bx, by, rng) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (!len) return [];

  const ux = dx / len;
  const uy = dy / len;
  const sign = rng() < 0.5 ? -1 : 1;
  const nx = -uy * sign;
  const ny = ux * sign;
  const centreShift = (rng() - 0.5) * 0.08;
  const heightScale = 0.88 + rng() * 0.24;
  const jitter = () => (rng() - 0.5) * 0.01;

  const point = (s, p) => {
    let ss = s;
    if (s > 0 && s < 1) ss += centreShift * Math.sin(Math.PI * s) + jitter();
    let pp = p * heightScale;
    if (p > 0) pp += jitter() * 0.6;
    return {
      x: ax + ux * len * ss + nx * len * pp,
      y: ay + uy * len * ss + ny * len * pp
    };
  };

  const segments = [];
  let from = { x: ax, y: ay };
  for (const [c1s, c1p, c2s, c2p, s, p] of PROFILE) {
    const to = point(s, p);
    segments.push({
      from,
      c1: point(c1s, c1p),
      c2: point(c2s, c2p),
      to
    });
    from = to;
  }
  return segments;
}

/** Reverse a segment chain so the same physical cut can be walked backwards. */
function reverseSegments(segments) {
  return segments
    .slice()
    .reverse()
    .map((seg) => ({ from: seg.to, c1: seg.c2, c2: seg.c1, to: seg.from }));
}

function boundsOf(start, segments) {
  let minX = start.x;
  let maxX = start.x;
  let minY = start.y;
  let maxY = start.y;
  let from = start;

  for (const seg of segments) {
    if (seg.c1) {
      for (let i = 1; i <= 12; i++) {
        const t = i / 12;
        const x = cubicAt(from.x, seg.c1.x, seg.c2.x, seg.to.x, t);
        const y = cubicAt(from.y, seg.c1.y, seg.c2.y, seg.to.y, t);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    } else {
      if (seg.to.x < minX) minX = seg.to.x;
      if (seg.to.x > maxX) maxX = seg.to.x;
      if (seg.to.y < minY) minY = seg.to.y;
      if (seg.to.y > maxY) maxY = seg.to.y;
    }
    from = seg.to;
  }

  return { minX, minY, maxX, maxY };
}

export function buildPuzzleGeometry({ width, height, cols, rows, seed }) {
  const rng = mulberry32(seed);
  const pw = width / cols;
  const ph = height / rows;

  // hEdges[r][c] runs left -> right along the top of piece (r, c)
  const hEdges = Array.from({ length: rows }, () => []);
  for (let r = 1; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      hEdges[r][c] = makeEdge(c * pw, r * ph, (c + 1) * pw, r * ph, rng);
    }
  }

  // vEdges[c][r] runs top -> bottom along the left of piece (r, c)
  const vEdges = Array.from({ length: cols }, () => []);
  for (let c = 1; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      vEdges[c][r] = makeEdge(c * pw, r * ph, c * pw, (r + 1) * ph, rng);
    }
  }

  const pieces = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * pw;
      const y = r * ph;
      const start = { x, y };
      const segments = [];

      // Top: left -> right
      if (r === 0) segments.push({ to: { x: x + pw, y } });
      else segments.push(...hEdges[r][c]);

      // Right: top -> bottom
      if (c === cols - 1) segments.push({ to: { x: x + pw, y: y + ph } });
      else segments.push(...vEdges[c + 1][r]);

      // Bottom: right -> left
      if (r === rows - 1) segments.push({ to: { x, y: y + ph } });
      else segments.push(...reverseSegments(hEdges[r + 1][c]));

      // Left: bottom -> top
      if (c === 0) segments.push({ to: { x, y } });
      else segments.push(...reverseSegments(vEdges[c][r]));

      const b = boundsOf(start, segments);
      const pad = Math.max(14, Math.min(pw, ph) * 0.1);
      const bbox = {
        x: b.minX - pad,
        y: b.minY - pad,
        w: b.maxX - b.minX + pad * 2,
        h: b.maxY - b.minY + pad * 2
      };

      const path = new Path2D();
      path.moveTo(start.x - bbox.x, start.y - bbox.y);
      for (const seg of segments) {
        if (seg.c1) {
          path.bezierCurveTo(
            seg.c1.x - bbox.x,
            seg.c1.y - bbox.y,
            seg.c2.x - bbox.x,
            seg.c2.y - bbox.y,
            seg.to.x - bbox.x,
            seg.to.y - bbox.y
          );
        } else {
          path.lineTo(seg.to.x - bbox.x, seg.to.y - bbox.y);
        }
      }

      pieces.push({
        index: pieces.length,
        row: r,
        col: c,
        x,
        y,
        w: pw,
        h: ph,
        bbox,
        path,
        neighbors: [],
        group: null
      });
    }
  }

  // Neighbour links are used for snapping and for merging groups.
  for (const piece of pieces) {
    const { row, col } = piece;
    if (row > 0) piece.neighbors.push(pieces[(row - 1) * cols + col]);
    if (row < rows - 1) piece.neighbors.push(pieces[(row + 1) * cols + col]);
    if (col > 0) piece.neighbors.push(pieces[row * cols + col - 1]);
    if (col < cols - 1) piece.neighbors.push(pieces[row * cols + col + 1]);
  }

  // The play area is the board plus a tray margin roughly one piece wide.
  // Cap the margin relative to the board so large-piece puzzles keep a
  // prominent board instead of shrinking into the middle of the table.
  const cap = Math.max(width, height) * 0.24;
  const marginX = Math.max(width * 0.12, Math.min(pw * 1.25, cap));
  const marginY = Math.max(height * 0.12, Math.min(ph * 1.25, cap));

  return {
    width,
    height,
    cols,
    rows,
    seed,
    pieces,
    playRect: {
      x: -marginX,
      y: -marginY,
      w: width + marginX * 2,
      h: height + marginY * 2
    }
  };
}
