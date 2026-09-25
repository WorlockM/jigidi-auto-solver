# 🧩 Jigidi Auto Solver

A userscript that solves [Jigidi](https://www.jigidi.com/) jigsaw puzzles automatically by dragging every piece into its correct place, one by one.

Handy for geocaching mystery caches that hide the coordinates in a Jigidi puzzle: let the script do the dragging while you get on with the hunt.

## Installation

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open the install link below; your userscript manager will offer to install the script:

   **[Install Jigidi Auto Solver](https://raw.githubusercontent.com/WorlockM/jigidi-auto-solver/main/jigidi-auto-solver.user.js)**

The script checks this repository for updates, so new versions arrive automatically through your userscript manager.

## Usage

1. Open any puzzle on `https://www.jigidi.com/solve/...`.
2. A small **🧩 Auto Solver** panel appears in the bottom-left corner.
3. Wait until it reports *"N pieces found. Ready!"*.
4. Click **Solve puzzle**. Click **Stop** at any time to halt.

When it is done, the panel shows how many pieces were placed and how long it took.

> [!IMPORTANT]
> **Please turn on Jigidi's Zen mode before solving.** The script solves puzzles far faster than any human, so without Zen mode your time lands at the top of the leaderboard. Keep the leaderboards fair for people who solve by hand.

## How it works

The script runs at `document-start`, before Jigidi's own game code, and hooks a few browser APIs:

- **Canvas hooks** (`putImageData` / `drawImage`) record how Jigidi cuts each piece from the source image. That offset reveals each piece's position in the solution, and every redraw reveals where the piece currently sits on the board.
- **Event listener hook** captures the game's mouse and pointer handlers, so the script can feed them drag events directly.

To solve, it:

1. Reads the grid size (e.g. `(12 × 8)`) from the page and checks it matches the number of pieces found.
2. Zooms out until the finished puzzle fits comfortably on the board.
3. Clears the top-left target area by parking any pieces there elsewhere.
4. Drags each piece to its computed target position in solution order, verifying every move and retrying or tidying up when a drag grabs the wrong piece.

## Troubleshooting

- **"Still loading"**: wait a moment and try again. If it persists, reload the page. The script must be active *before* the puzzle loads.
- **Other Jigidi scripts** (for example a "Bingo Solver" that recolors pieces) interfere with piece detection. Disable them while using this script.
- **"Puzzle not recognized"**: the piece count did not match the grid size shown on the page. Reload and try again.
- Some pieces **FAILED**: reload the page and run the solver again.

## Disclaimer

This is an unofficial tool, not affiliated with or endorsed by Jigidi. It only automates what you could do by hand in your own browser. Use it responsibly, and remember that solving the puzzle yourself is half the fun.

## License

[MIT](LICENSE) © WorlockM
