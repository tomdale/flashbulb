# flashbulb

Capture a screenshot of every *distinct* render state a page goes through between
request and fully loaded — so you can see each discrete thing a user sees while
your app boots, without drowning in identical spinner frames.

flashbulb opens a real (headed) Chrome. You navigate and log in like normal.
Press **Enter** in the terminal to reload the current page and start capturing.
Frames arrive on every repaint via CDP screencast, but one is only saved when its
visual delta vs. the last kept frame clears a threshold — so a spinning loader
collapses to a single state instead of one frame per tick. Capture stops once the
page is loaded and quiet. Each press starts a fresh numbered session dir, so
re-running the same page is one keystroke.

## Use

```bash
npm install
npm start -- https://example.com   # url optional; you can navigate manually
```

- **Enter** — reload current page + capture
- **Ctrl-C** — quit

For unattended/CI use, `--capture` runs headless, captures the url once, and exits:

```bash
npm start -- --capture https://example.com
```

Screenshots land in `captures/<timestamp>-<host-port-path>/000.png, 001.png, …`
(e.g. `dev.localhost:3024/dashboard` → `captures/20260628-2145-dev.localhost-3024-dashboard/`)
with a `frames.json` recording each kept frame's time offset and change ratio.

## Options

| flag | default | meaning |
|------|---------|---------|
| `-o, --out` | `captures` | output root |
| `-t, --threshold` | `0.01` | min fraction of pixels changed to keep a frame |
| `-p, --pixel-threshold` | `0.1` | per-pixel color tolerance (ignores AA/noise) |
| `-q, --quiet` | `10000` | stop after this many ms of no change once loaded |
| `-m, --max` | `30000` | hard cap per session |
| `--profile` | `$XDG_DATA_HOME/flashbulb/profile` | Chrome profile dir; logins persist |
| `-c, --capture` | off | headless single capture of the url, then exit |

Uses your installed Chrome, so no large download is needed.
