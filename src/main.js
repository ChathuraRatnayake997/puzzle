import { buildPuzzleGeometry, computeGrid } from "./generator.js";
import { Puzzle } from "./puzzle.js";
import { Renderer } from "./renderer.js";
import { PieceSelect } from "./piece-select.js";
import { randomSeed } from "./prng.js";

const $ = (id) => document.getElementById(id);

const stage = $("stage");
const canvas = $("canvas");
const guideToggle = $("guide");
const previewBtn = $("previewBtn");
const shuffleBtn = $("shuffleBtn");
const uploadBtn = $("uploadBtn");
const newBtn = $("newBtn");
const fileInput = $("file");
const progressText = $("progressText");
const progressBar = $("bar");
const barTrack = $("barTrack");
const timeEl = $("time");
const movesLabel = $("movesLabel");
const gridLabel = $("gridLabel");
const winEl = $("win");
const winTime = $("winTime");
const winMoves = $("winMoves");
const winAgain = $("winAgain");
const winImage = $("winImage");
const winImageLink = $("winImageLink");
const winSave = $("winSave");
const winNext = $("winNext");
const winNextLabel = $("winNextLabel");
const winNextBtn = $("winNextBtn");
const winClose = $("winClose");
const saveBtn = $("saveBtn");
const toastEl = $("toast");
const dropEl = $("drop");
const busyEl = $("busy");

const renderer = new Renderer(canvas, stage);

let image = null;
let puzzle = null;
let pieceCount = 12;
let moves = 0;
let won = false;
let buildToken = 0;
let objectUrl = null;
let toastTimer = 0;

const PIECE_STEPS = [12, 24, 48, 96, 192, 384, 500];

function nextPieceCount() {
  return PIECE_STEPS.find((count) => count > pieceCount) || null;
}

const pieceSelect = new PieceSelect({
  root: $("pieceSelect"),
  trigger: $("pieceSelectTrigger"),
  valueEl: $("pieceSelectValue"),
  menu: $("pieceListbox"),
  initial: pieceCount,
  onChange: (value) => {
    pieceCount = value;
    startNewPuzzle();
  }
});
pieceCount = pieceSelect.value;

const timer = { running: false, start: 0, elapsed: 0, id: 0 };

/* ------------------------------------------------------------------ helpers */

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 2600);
}

function startTimer() {
  if (timer.running || won) return;
  timer.running = true;
  timer.start = performance.now() - timer.elapsed;
  clearInterval(timer.id);
  timer.id = setInterval(() => {
    timer.elapsed = performance.now() - timer.start;
    timeEl.textContent = formatTime(timer.elapsed);
  }, 250);
}

function stopTimer(reset = false) {
  if (timer.running) timer.elapsed = performance.now() - timer.start;
  timer.running = false;
  clearInterval(timer.id);
  if (reset) timer.elapsed = 0;
  timeEl.textContent = formatTime(timer.elapsed);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Unable to load image"));
    img.src = src;
  });
}

/** Save the full source image as a high-resolution PNG. */
function saveImage() {
  if (!image) return;

  const maxSide = 2400;
  const ratio = Math.min(
    1,
    maxSide / Math.max(image.naturalWidth, image.naturalHeight)
  );
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);

  const date = new Date().toISOString().slice(0, 10);
  const count = puzzle ? puzzle.pieces.length : "image";
  const filename = `puzzle-${count}-${date}.jpg`;

  canvas.toBlob((blob) => {
    if (!blob) {
      toast("Could not save the image.");
      return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast("Image saved");
  }, "image/jpeg", 0.92);
}

/* --------------------------------------------------------------- game state */

function updateStats() {
  if (!puzzle) return;
  const total = puzzle.pieces.length;
  const placed = puzzle.placed;
  const percent = total ? (placed / total) * 100 : 0;

  progressText.textContent = `${placed} / ${total}`;
  progressBar.style.width = `${percent}%`;
  barTrack.setAttribute("aria-valuenow", String(Math.round(percent)));
  movesLabel.textContent = String(moves);
  gridLabel.textContent = `${puzzle.cols} × ${puzzle.rows}`;
}

function resetGameState() {
  won = false;
  moves = 0;
  winEl.hidden = true;
  stopTimer(true);
  movesLabel.textContent = "0";
}

function checkWin() {
  if (!puzzle || won || !puzzle.solved) return;
  won = true;
  stopTimer();
  winTime.textContent = formatTime(timer.elapsed);
  winMoves.textContent = `${moves} ${moves === 1 ? "move" : "moves"}`;
  winImage.src = image.src;
  winImageLink.href = image.src;

  const next = nextPieceCount();
  if (next) {
    winNextLabel.textContent = `You solved ${puzzle.pieces.length} pieces. Ready for ${next}?`;
    winNextBtn.hidden = false;
    winNextBtn.textContent = `Try ${next} pieces`;
    winSave.classList.remove("primary");
    winSave.classList.add("ghost");
  } else {
    winNextLabel.textContent = `You solved all ${puzzle.pieces.length} pieces — the biggest puzzle.`;
    winNextBtn.hidden = true;
    winSave.classList.add("primary");
    winSave.classList.remove("ghost");
  }

  winEl.hidden = false;
  winAgain.focus({ preventScroll: true });
}

function startNewPuzzle() {
  if (!image) return;

  const token = ++buildToken;
  busyEl.hidden = false;

  // Let the browser paint the busy state before the synchronous cut.
  setTimeout(() => {
    if (token !== buildToken) return;

    try {
      const aspect = image.naturalWidth / image.naturalHeight;
      const grid = computeGrid(pieceCount, aspect);
      const maxSide = Math.max(image.naturalWidth, image.naturalHeight);
      const imageScale = Math.min(1400 / maxSide, 3);

      const geometry = buildPuzzleGeometry({
        width: image.naturalWidth * imageScale,
        height: image.naturalHeight * imageScale,
        cols: grid.cols,
        rows: grid.rows,
        seed: randomSeed()
      });

      puzzle = new Puzzle(geometry);
      puzzle.scatter();
      renderer.setPuzzle(puzzle, image);
      resetGameState();
      updateStats();
    } catch (error) {
      console.error(error);
      toast("Could not build that puzzle.");
    } finally {
      if (token === buildToken) busyEl.hidden = true;
    }
  }, 30);
}

function shuffle() {
  if (!puzzle) return;
  puzzle.scatter();
  renderer.activeGroup = null;
  renderer.requestRender();
  resetGameState();
  updateStats();
}

/* ------------------------------------------------------------- image inputs */

async function useFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    toast("Please choose an image file.");
    return;
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    image = img;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = url;
    startNewPuzzle();
    toast("Image loaded");
  } catch {
    URL.revokeObjectURL(url);
    toast("Could not load that image.");
  }
}

/* ------------------------------------------------------------------- inputs */

guideToggle.addEventListener("change", () => {
  renderer.setGuide(guideToggle.checked);
});

previewBtn.addEventListener("click", () => {
  const on = !renderer.preview;
  renderer.setPreview(on);
  previewBtn.classList.toggle("active", on);
  previewBtn.setAttribute("aria-pressed", String(on));
});

shuffleBtn.addEventListener("click", shuffle);
newBtn.addEventListener("click", startNewPuzzle);
saveBtn.addEventListener("click", saveImage);
winSave.addEventListener("click", saveImage);

winNextBtn.addEventListener("click", () => {
  const next = nextPieceCount();
  if (next) pieceSelect.setValue(next);
});

winClose.addEventListener("click", () => {
  winEl.hidden = true;
});

winEl.addEventListener("click", (event) => {
  if (event.target === winEl) winEl.hidden = true;
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !winEl.hidden) winEl.hidden = true;
});

uploadBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const file = fileInput.files && fileInput.files[0];
  if (file) await useFile(file);
  fileInput.value = "";
});

winAgain.addEventListener("click", startNewPuzzle);

/* --------------------------------------------------------------- drag & drop */

let dragCounter = 0;

stage.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragCounter++;
  dropEl.hidden = false;
});

stage.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});

stage.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragCounter = Math.max(0, dragCounter - 1);
  if (dragCounter === 0) dropEl.hidden = true;
});

stage.addEventListener("drop", async (event) => {
  event.preventDefault();
  dragCounter = 0;
  dropEl.hidden = true;
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) await useFile(file);
});

/* ------------------------------------------------------------ pointer input */

let drag = null;

canvas.addEventListener("pointerdown", (event) => {
  if (!puzzle) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;

  const point = renderer.screenToBoard(event.clientX, event.clientY);
  const group = puzzle.hitTest(point.x, point.y);
  if (!group) return;

  event.preventDefault();

  if (renderer.preview) {
    renderer.setPreview(false);
    previewBtn.classList.remove("active");
    previewBtn.setAttribute("aria-pressed", "false");
  }

  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("dragging");

  puzzle.bringToFront(group);
  renderer.activeGroup = group;
  renderer.requestRender();

  drag = {
    id: event.pointerId,
    group,
    startX: point.x,
    startY: point.y,
    ox: group.ox,
    oy: group.oy,
    moved: false
  };

  startTimer();
});

canvas.addEventListener("pointermove", (event) => {
  if (!drag || event.pointerId !== drag.id) return;

  const point = renderer.screenToBoard(event.clientX, event.clientY);
  const dx = point.x - drag.startX;
  const dy = point.y - drag.startY;

  if (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4) drag.moved = true;

  drag.group.ox = drag.ox + dx;
  drag.group.oy = drag.oy + dy;
  renderer.requestRender();
});

function finishDrag(event) {
  if (!drag || (event && event.pointerId !== drag.id)) return;

  const { group, moved } = drag;
  if (moved) {
    moves++;
    puzzle.trySnap(group, 18 / renderer.scale);
  }

  drag = null;
  renderer.activeGroup = null;
  canvas.classList.remove("dragging");
  renderer.requestRender();
  updateStats();
  checkWin();
}

canvas.addEventListener("pointerup", finishDrag);
canvas.addEventListener("pointercancel", finishDrag);
canvas.addEventListener("lostpointercapture", finishDrag);

/* -------------------------------------------------------------------- misc */

function updateInsets() {
  const pad = window.innerWidth <= 900 ? 20 : 40;
  renderer.setPadding({ top: pad, right: pad, bottom: pad, left: pad });
}

const observer = new ResizeObserver(() => {
  updateInsets();
  renderer.requestRender();
});
observer.observe(stage);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (timer.running) {
      timer.elapsed = performance.now() - timer.start;
      timer.running = false;
      clearInterval(timer.id);
    }
  } else if (!timer.running && !won && timer.elapsed > 0) {
    startTimer();
  }
});

/* -------------------------------------------------------------------- init */

async function init() {
  timeEl.textContent = "00:00";
  updateInsets();
  try {
    image = await loadImage("assets/default.jpg");
  } catch (error) {
    console.error(error);
    toast("The default image could not be loaded.");
    return;
  }
  startNewPuzzle();
}

init();

// Small debugging hook (also handy when tweaking the cut generator).
window.puzzleStudio = {
  get puzzle() {
    return puzzle;
  },
  get image() {
    return image;
  },
  renderer
};
