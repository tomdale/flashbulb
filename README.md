# flashbulb

flashbulb is a command-line tool that screenshots a web page as it loads. Each
time the page changes visually, it saves an image, so you get the sequence of
states a page passes through (empty, loading, loaded) rather than a single final
screenshot or a stream of near-identical frames.

## What it's for

A page load happens too fast to inspect by eye, and a normal screenshot only
captures the end result. flashbulb keeps the intermediate states, which is
useful for seeing what users look at during loading, finding layout shifts, and
comparing how a page loads before and after a change.

Chrome DevTools can show a filmstrip of a page loading, but those frames are
low-resolution thumbnails that can't be easily saved or shared. flashbulb writes
full-resolution PNGs to disk that you keep.

Repeated frames are collapsed. A spinner that animates for two seconds produces
one screenshot, not sixty.

## Getting started

You need Node installed. `pnpm install` installs Puppeteer and its managed
browser, which flashbulb uses for capture.

```bash
pnpm install
pnpm start https://example.com
```

A real browser window opens. Go to the page you want, log in if you need to, then
press Enter in the terminal. flashbulb reloads the page and captures every state
it goes through. Once the page finishes loading and goes quiet, it stops and
prints a link to a gallery.

- Press Enter to reload the current page and capture again.
- Press Ctrl-C to quit.

The browser stays open and remembers your login, so you can capture one page after
another without signing in each time.

## What you get

Each capture creates a folder under `captures/`, named with the date and the
page address (for example `captures/20260628-2145-example.com/`). Inside:

- Numbered screenshots: `000.png`, `001.png`, and so on, in the order they
  appeared.
- `index.html`, a self-contained gallery you can open in any browser. It shows a
  filmstrip of every state with timing. Click one to view it full size.
  Shift-click a second to compare the two side by side with a slider.
- `frames.json`, the same data as plain text in case you want to script against
  it.

## Capturing without the window

For automated or scripted runs, `--capture` skips the window, loads the page
once, captures it, and exits.

```bash
pnpm start --capture https://example.com
```

## Options

| flag                    | default                            | what it does                                                                     |
| ----------------------- | ---------------------------------- | -------------------------------------------------------------------------------- |
| `-o, --out`             | `captures`                         | folder to save captures in                                                       |
| `-t, --threshold`       | `0.01`                             | how much the page must change to count as a new state (0 to 1)                   |
| `-p, --pixel-threshold` | `0.1`                              | how different a pixel must be to count as changed, to ignore tiny noise (0 to 1) |
| `-q, --quiet`           | `10000`                            | stop after this many milliseconds with no change once loaded                     |
| `-m, --max`             | `30000`                            | longest a single capture can run, in milliseconds                                |
| `--profile`             | `$XDG_DATA_HOME/flashbulb/profile` | where the browser keeps your logins between runs                                 |
| `-c, --capture`         | off                                | load the page once without a window, capture, then exit                          |
