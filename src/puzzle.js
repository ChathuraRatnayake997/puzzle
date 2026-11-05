/**
 * Puzzle state: groups of connected pieces and their offset from the solved
 * layout. Because pieces never rotate, every piece has a fixed "solved"
 * position; a group is simply a set of pieces sharing one (ox, oy) offset.
 * Snapping is therefore just "do two adjacent groups have the same offset?".
 */

const hitCanvas = document.createElement("canvas");
const hitCtx = hitCanvas.getContext("2d");

export class Puzzle {
  constructor(geometry) {
    this.width = geometry.width;
    this.height = geometry.height;
    this.cols = geometry.cols;
    this.rows = geometry.rows;
    this.pieces = geometry.pieces;
    this.playRect = geometry.playRect;
    this.seed = geometry.seed;
    this.groups = [];
    this.zOrder = [];
    this.reset();
  }

  /** Break every connection and give each piece its own group. */
  reset() {
    this.groups = this.pieces.map((piece, index) => {
      const group = { id: index, pieces: [piece], ox: 0, oy: 0 };
      piece.group = group;
      return group;
    });
    this.zOrder = this.groups.slice();
  }

  /**
   * Lay the pieces out in a tray ring around the board. Slots are spread
   * evenly along each side with a little jitter, so the tray looks composed
   * instead of randomly dumped on the board.
   */
  scatter(rng = Math.random) {
    this.reset();

    const pr = this.playRect;
    const gap = Math.max(6, Math.min(this.width, this.height) * 0.004);
    const marginX = -pr.x;
    const marginY = -pr.y;

    const pieces = this.pieces.slice();
    for (let i = pieces.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
    }

    // Share pieces between the four tray sides in proportion to side length.
    const lengths = [pr.h, pr.h, pr.w, pr.w];
    const total = lengths.reduce((a, b) => a + b, 0);
    const exact = lengths.map((l) => (l / total) * pieces.length);
    const counts = exact.map(Math.floor);
    let remaining = pieces.length - counts.reduce((a, b) => a + b, 0);
    const order = exact
      .map((v, i) => ({ i, frac: v - Math.floor(v) }))
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < remaining; k++) counts[order[k % 4].i]++;

    const unit = pieces[0];
    let index = 0;

    for (let side = 0; side < 4; side++) {
      const n = counts[side];
      if (!n) continue;

      const vertical = side < 2; // left / right
      const alongStart = vertical ? pr.y : pr.x;
      const alongSpan = (vertical ? pr.h : pr.w) - (vertical ? unit.h : unit.w);
      const crossStart = vertical
        ? side === 0
          ? pr.x + gap
          : this.width + gap
        : side === 2
          ? pr.y + gap
          : this.height + gap;
      const crossRoom = Math.max(
        0,
        (vertical ? marginX : marginY) - (vertical ? unit.w : unit.h) - gap * 2
      );

      for (let k = 0; k < n; k++) {
        const piece = pieces[index++];
        const t = (k + 0.5) / n;
        const spacing = alongSpan / n;
        let along = alongStart + t * alongSpan;
        along += (rng() - 0.5) * spacing * 0.5;
        along = Math.max(alongStart, Math.min(alongStart + alongSpan, along));

        const cross = crossStart + crossRoom * (0.18 + rng() * 0.64);
        const coreX = vertical ? cross : along;
        const coreY = vertical ? along : cross;

        piece.group.ox = coreX - piece.x;
        piece.group.oy = coreY - piece.y;
      }
    }

    // Shuffle draw order so overlapping pieces look naturally piled up.
    for (let i = this.zOrder.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [this.zOrder[i], this.zOrder[j]] = [this.zOrder[j], this.zOrder[i]];
    }
  }

  bringToFront(group) {
    const i = this.zOrder.indexOf(group);
    if (i === -1 || i === this.zOrder.length - 1) return;
    this.zOrder.splice(i, 1);
    this.zOrder.push(group);
  }

  /** Return the top-most group under a board-space point, or null. */
  hitTest(x, y) {
    for (let i = this.zOrder.length - 1; i >= 0; i--) {
      const group = this.zOrder[i];
      for (let j = group.pieces.length - 1; j >= 0; j--) {
        const piece = group.pieces[j];
        const lx = x - (piece.bbox.x + group.ox);
        const ly = y - (piece.bbox.y + group.oy);
        if (lx < 0 || ly < 0 || lx > piece.bbox.w || ly > piece.bbox.h) continue;
        if (hitCtx.isPointInPath(piece.path, lx, ly)) return group;
      }
    }
    return null;
  }

  adjacent(a, b) {
    const inB = new Set(b.pieces);
    for (const piece of a.pieces) {
      for (const neighbor of piece.neighbors) {
        if (inB.has(neighbor)) return true;
      }
    }
    return false;
  }

  merge(target, source) {
    for (const piece of source.pieces) {
      piece.group = target;
      target.pieces.push(piece);
    }
    const gi = this.groups.indexOf(source);
    if (gi !== -1) this.groups.splice(gi, 1);
    const zi = this.zOrder.indexOf(source);
    if (zi !== -1) this.zOrder.splice(zi, 1);
  }

  /**
   * Snap a dragged group to the board origin and to any adjacent groups
   * whose offsets are within `tol` board units. Chains of groups are merged
   * in one pass.
   */
  trySnap(group, tol) {
    let mergedAny = false;
    let again = true;

    while (again) {
      again = false;

      if (group.ox !== 0 || group.oy !== 0) {
        if (Math.abs(group.ox) <= tol && Math.abs(group.oy) <= tol) {
          group.ox = 0;
          group.oy = 0;
          again = true;
          mergedAny = true;
        }
      }

      for (const other of this.groups) {
        if (other === group) continue;
        if (Math.abs(other.ox - group.ox) > tol) continue;
        if (Math.abs(other.oy - group.oy) > tol) continue;
        if (!this.adjacent(group, other)) continue;

        group.ox = other.ox;
        group.oy = other.oy;
        this.merge(group, other);
        again = true;
        mergedAny = true;
        break;
      }
    }

    return mergedAny;
  }

  get placed() {
    let count = 0;
    for (const group of this.groups) {
      if (group.ox === 0 && group.oy === 0) count += group.pieces.length;
    }
    return count;
  }

  get solved() {
    return (
      this.groups.length === 1 &&
      this.groups[0].ox === 0 &&
      this.groups[0].oy === 0
    );
  }
}
