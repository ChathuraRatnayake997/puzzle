# Puzzle Studio

A modern rewrite of the jigsaw puzzle creator: plain **HTML + CSS + JavaScript (ES modules)** and a single `<canvas>`. No framework, no build step, no dependencies — ready for GitHub Pages.


## The look

Puzzle Studio is a minimal flat workspace with dimensional pieces:

- off-white page, white panels, 1px rules and black primary actions
- flat board with a hairline border
- pieces keep a printed face, soft bevel, cardboard edge and cast shadow
- no gradients, textures, glass or decorative shadows in the UI

## Features

- **Any image** — drag & drop, upload, or use the built-in artwork.
- **Procedural jigsaw cuts** — seeded, interlocking tabs generated once per edge.
- **Piece counts** — starts at 12 and steps up to 500, with the grid chosen to keep pieces roughly square.
- **Guided progression** — after each win, the completion screen offers the next piece count.
- **Composed tray** — pieces are arranged in a ring around the board, not dumped on top of it.
- **Groups & snapping** — adjacent pieces click together and then move as one.
- **Live stats** — placed count, progress bar, timer and move counter.
- **Preview & guide** — overlay the finished picture, or show a faint guide on the board.
- **Completion view** — the finished picture in a framed preview, with a full-size link, save and replay.
- **Save image** — download the full picture as a high-resolution JPEG from the toolbar or the win screen.
- **Responsive** — pointer/touch input, DPR-aware canvas, compact mobile dock.
- **Offline-friendly** — no CDN, fonts, or network requests at runtime.

## Run locally

ES modules need an HTTP origin (opening `index.html` from disk will not work). From this folder:

```bash
python -m http.server 5500
# then open http://localhost:5500
```

Any static server works (`npx serve`, `php -S`, VS Code Live Server, …).

## Deploy to GitHub Pages

**Option A — no workflow**

1. Push this folder to a repository's `main` branch.
2. Repository **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Choose `main` and `/ (root)`, save.

**Option B — GitHub Actions (included)**

The workflow in `.github/workflows/pages.yml` deploys the repository root on every push to `main`. Enable **Settings → Pages → Source: GitHub Actions** and push.

All asset paths are relative, so the app also works from a project subpath such as `https://user.github.io/repo/`.

## Project layout

```
index.html               app shell
styles.css               minimal flat theme + responsive layout
assets/default.jpg       built-in puzzle artwork
assets/favicon.svg       app icon
src/main.js              UI wiring, input, timer, image save
src/generator.js         grid + jigsaw edge geometry (Path2D)
src/puzzle.js            groups, hit testing, snapping, tray layout
src/renderer.js          canvas view, bevelled piece bitmaps, flat board
src/piece-select.js      themed piece-count combobox
src/prng.js              seeded random generator
```

## How it works

Each puzzle is a grid of pieces. Every interior edge is generated once as a chain of cubic Béziers and shared by both neighbouring pieces (walked forward by one, backward by the other), so cuts interlock exactly.

A piece's solved position never changes. A group of connected pieces is just a list plus one `(ox, oy)` offset from the solved layout. Dropping a group checks adjacent groups whose offset is within a screen-space tolerance; matching groups merge and inherit the stationary group's offset. When every piece is one group at offset zero, the puzzle is solved.

Pieces are rasterised once into small offscreen canvases: the clipped image, a light/dark inner bevel, a cardboard edge and a baked shadow. Each frame is then one `drawImage` per piece, which keeps even 500 pieces smooth. The linen board is cached the same way and only rebuilt when the view size, guide setting or image changes.

The tray layout divides the ring around the board between its four sides in proportion to side length, spreads pieces evenly along each side with jitter, and keeps their solid cores off the felt.

## Ideas for the next iteration

- Piece rotation and rotation-step modes
- Alternative cut styles (triangular, polygonal)
- Save/restore via `localStorage` and `.puzz` files
- Zoom/pan for very large puzzles
- Sound effects and snap haptics

## License

MIT — do what you like.
