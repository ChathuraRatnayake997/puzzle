/**
 * Canvas renderer — warm table, felt board, bevelled pieces.
 *
 * Pieces are rasterised once into offscreen canvases (image + 3D bevel +
 * cardboard edge + soft shadow). Frames then draw one image per piece, which
 * keeps even large puzzles smooth.
 */

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/* Paper & sage theme. */
const PAPER = {
  board: {
    base: "#3a2a1c",
    shadow: "rgba(74, 50, 26, 0.3)",
    rimTop: "#a97a52",
    rimMid: "#7d5436",
    rimBottom: "#4e3423",
    rimHighlight: "rgba(255, 250, 240, 0.5)",
    feltTop: "#d3ddc3",
    feltMid: "#c0ccae",
    feltBottom: "#aab994",
    inlay: "rgba(255, 252, 244, 0.55)",
    stitch: "rgba(88, 100, 70, 0.4)",
    light: "rgba(255, 255, 246, 0.55)",
    recess: "rgba(60, 70, 45, 0.18)",
    innerShadow: "rgba(60, 70, 45, 0.22)",
    hairline: "rgba(255, 252, 244, 0.55)"
  },
  piece: {
    edge: "#cbb99e",
    shadow: "rgba(74, 50, 26, 0.42)",
    bevelDark: "rgba(80, 52, 26, 0.28)",
    bevelLight: "rgba(255, 252, 246, 0.65)",
    glossTop: "rgba(255, 255, 255, 0.2)",
    glossMid: "rgba(255, 255, 255, 0.02)",
    glossBottom: "rgba(80, 50, 20, 0.05)",
    cut: "rgba(74, 50, 26, 0.42)"
  },
  glow: "rgba(192, 90, 58, 0.55)",
  previewBorder: "rgba(60, 40, 20, 0.45)"
};

/* Minimal UI, dimensional pieces. */
const MINIMAL = {
  board: {
    flat: true,
    surface: "#fafaf7",
    border: "#d7d3cc"
  },
  piece: {
    flat: false,
    edge: "#d6d2ca",
    shadow: "rgba(0, 0, 0, 0.18)",
    bevelDark: "rgba(0, 0, 0, 0.2)",
    bevelLight: "rgba(255, 255, 255, 0.7)",
    glossTop: "rgba(255, 255, 255, 0.14)",
    glossMid: "rgba(255, 255, 255, 0.01)",
    glossBottom: "rgba(0, 0, 0, 0.03)",
    cut: "rgba(0, 0, 0, 0.22)"
  },
  active: "#1a1a1a",
  previewBorder: "rgba(0, 0, 0, 0.35)"
};

export class Renderer {
  constructor(canvas, stage) {
    this.canvas = canvas;
    this.stage = stage;
    this.ctx = canvas.getContext("2d");
    this.puzzle = null;
    this.image = null;

    this.dpr = 1;
    this.viewW = 0;
    this.viewH = 0;
    this.scale = 1;
    this.originX = 0;
    this.originY = 0;
    this.quality = 1;
    this.padding = { top: 90, right: 22, bottom: 120, left: 22 };

    this.guide = false;
    this.preview = false;
    this.activeGroup = null;
    this.palette = MINIMAL;

    this._frame = 0;
    this._bitmapTimer = 0;
    this._board = null;
    this._boardKey = "";
  }

  setPuzzle(puzzle, image) {
    clearTimeout(this._bitmapTimer);
    this.puzzle = puzzle;
    this.image = image;
    this.activeGroup = null;
    this._board = null;
    this._boardKey = "";

    this.resize();
    this.computeView();
    this.quality = this.computeQuality();
    this.buildBitmaps();
    this.requestRender();
  }

  setPadding(padding) {
    this.padding = { ...this.padding, ...padding };
    this.resize();
    this.requestRender();
  }

  resize() {
    const rect = this.stage.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.round(rect.width * dpr);
    const ch = Math.round(rect.height * dpr);

    this.dpr = dpr;
    this.viewW = rect.width;
    this.viewH = rect.height;

    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }

    if (this.puzzle) {
      this.computeView();
      const q = this.computeQuality();
      if (Math.abs(q - this.quality) / this.quality > 0.25) {
        this.quality = q;
        this.scheduleBitmaps();
      }
    }
  }

  computeView() {
    if (!this.puzzle) return;
    const pr = this.puzzle.playRect;
    const pad = this.padding;
    const availW = Math.max(1, this.viewW - pad.left - pad.right);
    const availH = Math.max(1, this.viewH - pad.top - pad.bottom);

    this.scale = Math.min(availW / pr.w, availH / pr.h) * 0.99;
    this.originX = pad.left + (availW - pr.w * this.scale) / 2 - pr.x * this.scale;
    this.originY = pad.top + (availH - pr.h * this.scale) / 2 - pr.y * this.scale;
  }

  computeQuality() {
    return clamp(this.dpr * this.scale, 1, 2);
  }

  scheduleBitmaps() {
    clearTimeout(this._bitmapTimer);
    this._bitmapTimer = setTimeout(() => {
      if (!this.puzzle || !this.image) return;
      this.buildBitmaps();
      this.requestRender();
    }, 180);
  }

  /* ------------------------------------------------------------- pieces */

  buildBitmaps() {
    const puzzle = this.puzzle;
    const image = this.image;
    if (!puzzle || !image) return;

    const q = this.quality;
    const P = this.palette.piece;

    for (const piece of puzzle.pieces) {
      const b = piece.bbox;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(b.w * q));
      canvas.height = Math.max(1, Math.ceil(b.h * q));

      const ctx = canvas.getContext("2d");
      ctx.scale(canvas.width / b.w, canvas.height / b.h);

      if (P.flat) {
        // Soft contact shadow.
        ctx.save();
        ctx.shadowColor = P.shadow;
        ctx.shadowBlur = 3;
        ctx.shadowOffsetY = 1;
        ctx.fillStyle = "rgba(0, 0, 0, 0.9)";
        ctx.fill(piece.path);
        ctx.restore();

        // Printed face.
        ctx.save();
        ctx.clip(piece.path);
        this.drawImageRegion(ctx, b);
        ctx.restore();

        // Hairline cut.
        ctx.lineWidth = 1;
        ctx.strokeStyle = P.cut;
        ctx.stroke(piece.path);

        piece.bitmap = canvas;
        continue;
      }

      const unit = Math.min(piece.w, piece.h);
      const depth = Math.max(2, Math.min(5, unit * 0.032));
      const bevel = Math.max(1.6, Math.min(4.5, unit * 0.03));

      // 1. Cardboard thickness + soft drop shadow.
      ctx.save();
      ctx.shadowColor = P.shadow;
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 1.5;
      ctx.shadowOffsetY = 5;
      ctx.fillStyle = P.edge;
      ctx.translate(0, depth);
      ctx.fill(piece.path);
      ctx.restore();

      // 2. Printed face.
      ctx.save();
      ctx.clip(piece.path);
      this.drawImageRegion(ctx, b);

      // 3. Inner bevel — dark along the bottom/right.
      ctx.save();
      ctx.translate(bevel, bevel);
      ctx.lineWidth = bevel * 2.4;
      ctx.strokeStyle = P.bevelDark;
      ctx.stroke(piece.path);
      ctx.restore();

      // 4. Inner bevel — warm light along the top/left.
      ctx.save();
      ctx.translate(-bevel, -bevel);
      ctx.lineWidth = bevel * 2.2;
      ctx.strokeStyle = P.bevelLight;
      ctx.stroke(piece.path);
      ctx.restore();

      // 5. Gentle gloss across the face.
      const gloss = ctx.createLinearGradient(0, 0, 0, b.h);
      gloss.addColorStop(0, P.glossTop);
      gloss.addColorStop(0.32, P.glossMid);
      gloss.addColorStop(1, P.glossBottom);
      ctx.fillStyle = gloss;
      ctx.fillRect(0, 0, b.w, b.h);
      ctx.restore();

      // 6. Crisp cut line.
      ctx.lineWidth = 1;
      ctx.strokeStyle = P.cut;
      ctx.stroke(piece.path);

      piece.bitmap = canvas;
    }
  }

  drawImageRegion(ctx, b) {
    const image = this.image;
    const puzzle = this.puzzle;
    const kx = image.naturalWidth / puzzle.width;
    const ky = image.naturalHeight / puzzle.height;

    let sx = b.x * kx;
    let sy = b.y * ky;
    let sw = b.w * kx;
    let sh = b.h * ky;

    let dx = 0;
    let dy = 0;
    let dw = b.w;
    let dh = b.h;

    if (sx < 0) {
      const cut = -sx;
      sx = 0;
      sw -= cut;
      dx += cut / kx;
      dw -= cut / kx;
    }
    if (sy < 0) {
      const cut = -sy;
      sy = 0;
      sh -= cut;
      dy += cut / ky;
      dh -= cut / ky;
    }
    if (sx + sw > image.naturalWidth) {
      const cut = sx + sw - image.naturalWidth;
      sw -= cut;
      dw -= cut / kx;
    }
    if (sy + sh > image.naturalHeight) {
      const cut = sy + sh - image.naturalHeight;
      sh -= cut;
      dh -= cut / ky;
    }

    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
    ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  /* --------------------------------------------------------------- board */

  buildBoardCache(w, h) {
    const pad = this.palette.board.flat ? 8 : 90;
    const dpr = this.dpr;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil((w + pad * 2) * dpr));
    canvas.height = Math.max(1, Math.ceil((h + pad * 2) * dpr));

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.translate(pad, pad);
    this.paintBoard(ctx, w, h);

    return { canvas, pad };
  }

  paintBoard(ctx, w, h) {
    const P = this.palette.board;

    if (this.palette.board.flat) {
      const radius = Math.min(14, w * 0.02);
      roundRect(ctx, 0, 0, w, h, radius);
      ctx.fillStyle = P.surface;
      ctx.fill();

      if (this.guide) {
        ctx.save();
        roundRect(ctx, 0, 0, w, h, radius);
        ctx.clip();
        ctx.globalAlpha = 0.18;
        ctx.drawImage(this.image, 0, 0, w, h);
        ctx.restore();
      }

      roundRect(ctx, 0, 0, w, h, radius);
      ctx.lineWidth = 1;
      ctx.strokeStyle = P.border;
      ctx.stroke();
      return;
    }

    const radius = Math.min(26, w * 0.03);
    const frame = Math.max(7, Math.min(16, w * 0.012));

    // Ambient shadow on the table.
    ctx.save();
    ctx.shadowColor = P.shadow;
    ctx.shadowBlur = 45;
    ctx.shadowOffsetY = 18;
    roundRect(ctx, -frame, -frame, w + frame * 2, h + frame * 2, radius + frame);
    ctx.fillStyle = P.base;
    ctx.fill();
    ctx.restore();

    // Wooden rim.
    roundRect(ctx, -frame, -frame, w + frame * 2, h + frame * 2, radius + frame);
    const rim = ctx.createLinearGradient(0, -frame, 0, h + frame);
    rim.addColorStop(0, P.rimTop);
    rim.addColorStop(0.16, P.rimMid);
    rim.addColorStop(0.8, P.rimMid);
    rim.addColorStop(1, P.rimBottom);
    ctx.fillStyle = rim;
    ctx.fill();

    // Rim highlight.
    roundRect(ctx, -frame + 1, -frame + 1, w + frame * 2 - 2, h + frame * 2 - 2, radius + frame - 1);
    ctx.lineWidth = 1;
    ctx.strokeStyle = P.rimHighlight;
    ctx.stroke();

    // Felt surface.
    roundRect(ctx, 0, 0, w, h, radius);
    const felt = ctx.createLinearGradient(0, 0, 0, h);
    felt.addColorStop(0, P.feltTop);
    felt.addColorStop(0.5, P.feltMid);
    felt.addColorStop(1, P.feltBottom);
    ctx.fillStyle = felt;
    ctx.fill();

    // Brass inlay between wood and felt.
    roundRect(ctx, -2, -2, w + 4, h + 4, radius + 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = P.inlay;
    ctx.stroke();

    // Woven grain, generated once and repeated.
    if (!this._feltNoise) {
      const noise = document.createElement("canvas");
      noise.width = 128;
      noise.height = 128;
      const nctx = noise.getContext("2d");
      const data = nctx.createImageData(128, 128);
      for (let i = 0; i < data.data.length; i += 4) {
        const v = 120 + Math.random() * 120;
        data.data[i] = v;
        data.data[i + 1] = v;
        data.data[i + 2] = v;
        data.data[i + 3] = 16;
      }
      nctx.putImageData(data, 0, 0);
      this._feltNoise = noise;
    }

    ctx.save();
    roundRect(ctx, 0, 0, w, h, radius);
    ctx.clip();
    ctx.fillStyle = ctx.createPattern(this._feltNoise, "repeat");
    ctx.fillRect(0, 0, w, h);

    // Diagonal sheen across the felt.
    const sheen = ctx.createLinearGradient(0, 0, w, h);
    sheen.addColorStop(0, "rgba(255, 255, 255, 0.06)");
    sheen.addColorStop(0.45, "rgba(255, 255, 255, 0)");
    sheen.addColorStop(1, "rgba(60, 70, 45, 0.05)");
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    ctx.save();
    roundRect(ctx, 0, 0, w, h, radius);
    ctx.clip();

    // Pool of warm light.
    const glow = ctx.createRadialGradient(
      w * 0.5,
      -h * 0.05,
      0,
      w * 0.5,
      -h * 0.05,
      Math.max(w, h) * 0.95
    );
    glow.addColorStop(0, "rgba(255, 255, 246, 0.55)");
    glow.addColorStop(0.45, "rgba(255, 255, 246, 0.12)");
    glow.addColorStop(1, "rgba(255, 255, 246, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // Recessed bottom edge.
    const recess = ctx.createLinearGradient(0, 0, 0, h);
    recess.addColorStop(0, "rgba(60, 70, 45, 0)");
    recess.addColorStop(0.7, "rgba(60, 70, 45, 0)");
    recess.addColorStop(1, P.recess);
    ctx.fillStyle = recess;
    ctx.fillRect(0, 0, w, h);

    if (this.guide) {
      ctx.globalAlpha = 0.16;
      ctx.drawImage(this.image, 0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    // Inner shadow around the felt edge.
    ctx.lineWidth = 26;
    ctx.strokeStyle = P.innerShadow;
    roundRect(ctx, -13, -13, w + 26, h + 26, radius + 13);
    ctx.stroke();
    ctx.restore();

    // Stitched brass line.
    const inset = Math.max(8, Math.min(16, w * 0.014));
    roundRect(ctx, inset, inset, w - inset * 2, h - inset * 2, Math.max(4, radius - inset));
    ctx.save();
    ctx.setLineDash([5, 6]);
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = P.stitch;
    ctx.stroke();
    ctx.restore();

    // Outer hairline.
    roundRect(ctx, 0, 0, w, h, radius);
    ctx.lineWidth = 1;
    ctx.strokeStyle = P.hairline;
    ctx.stroke();
  }

  drawBoardBackdrop() {
    const w = this.puzzle.width * this.scale;
    const h = this.puzzle.height * this.scale;
    const key = `${Math.round(w)}:${Math.round(h)}:${this.guide ? 1 : 0}:${this.dpr}`;

    if (this._boardKey !== key) {
      this._board = this.buildBoardCache(w, h);
      this._boardKey = key;
    }

    const { canvas, pad } = this._board;
    this.ctx.drawImage(
      canvas,
      this.originX - pad,
      this.originY - pad,
      w + pad * 2,
      h + pad * 2
    );
  }

  /* --------------------------------------------------------------- draw */

  setGuide(value) {
    this.guide = Boolean(value);
    this._boardKey = "";
    this.requestRender();
  }

  setPreview(value) {
    this.preview = Boolean(value);
    this.requestRender();
  }

  screenToBoard(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.originX) / this.scale,
      y: (clientY - rect.top - this.originY) / this.scale
    };
  }

  requestRender() {
    if (this._frame) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = 0;
      this.render();
    });
  }

  drawActive(group) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.originX, this.originY);
    ctx.scale(this.scale, this.scale);
    ctx.lineWidth = 2 / this.scale;
    ctx.strokeStyle = this.palette.active;

    for (const piece of group.pieces) {
      ctx.save();
      ctx.translate(piece.bbox.x + group.ox, piece.bbox.y + group.oy);
      ctx.stroke(piece.path);
      ctx.restore();
    }
    ctx.restore();
  }

  drawPreviewOverlay() {
    const ctx = this.ctx;
    const x = this.originX;
    const y = this.originY;
    const w = this.puzzle.width * this.scale;
    const h = this.puzzle.height * this.scale;
    const radius = Math.min(26, w * 0.03);

    ctx.save();
    roundRect(ctx, x, y, w, h, radius);
    ctx.clip();
    ctx.globalAlpha = 0.94;
    ctx.drawImage(this.image, x, y, w, h);
    ctx.restore();

    ctx.save();
    roundRect(ctx, x, y, w, h, radius);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = this.palette.previewBorder;
    ctx.stroke();
    ctx.restore();
  }

  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewW, this.viewH);

    if (!this.puzzle || !this.image) return;

    this.drawBoardBackdrop();

    for (const group of this.puzzle.zOrder) {
      if (group === this.activeGroup) this.drawActive(group);

      for (const piece of group.pieces) {
        const b = piece.bbox;
        ctx.drawImage(
          piece.bitmap,
          this.originX + (b.x + group.ox) * this.scale,
          this.originY + (b.y + group.oy) * this.scale,
          b.w * this.scale,
          b.h * this.scale
        );
      }
    }

    if (this.preview) this.drawPreviewOverlay();
  }
}
