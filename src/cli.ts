#!/usr/bin/env -S npx tsx
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import chalk from "chalk";
import { program } from "commander";
import puppeteer from "puppeteer";
import { capture } from "./capture.ts";

// Chrome profile holds logins, so it's persistent app data: XDG_DATA_HOME.
const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
const defaultProfile = join(dataHome, "flashbulb", "profile");

program
  .name("flashbulb")
  .description("Capture viewport screenshots of every distinct render state during page load")
  .argument("[url]", "page to open at startup")
  .option("-o, --out <dir>", "output directory", "captures")
  .option("-t, --threshold <n>", "min visual delta to keep a frame (0..1)", parseFloat, 0.01)
  .option("-p, --pixel-threshold <n>", "per-pixel color tolerance (0..1)", parseFloat, 0.1)
  .option("-q, --quiet <ms>", "stop after no changes for this long once loaded", (v) => parseInt(v, 10), 10000)
  .option("-m, --max <ms>", "hard cap per capture session", (v) => parseInt(v, 10), 30000)
  .option("--profile <dir>", "Chrome profile dir (persists logins)", defaultProfile)
  .option("-c, --capture", "run headless: capture the url once, then exit")
  .parse();

const url = program.args[0];
const opts = program.opts();
const outRoot: string = opts.out;
const capOpts = {
  deltaThreshold: opts.threshold,
  pixelThreshold: opts.pixelThreshold,
  quietMs: opts.quiet,
  maxMs: opts.max,
};

function slug(u: string): string {
  try {
    const { hostname, port, pathname } = new URL(u);
    return [hostname, port, pathname]
      .join("-")
      .replace(/[^a-z0-9.]+/gi, "-")
      .replace(/^-+|-+$/g, "");
  } catch {
    return "page";
  }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

if (opts.capture && !url) {
  console.error(chalk.red("--capture requires a url"));
  process.exit(1);
}

mkdirSync(opts.profile, { recursive: true });
const browser = await puppeteer.launch({
  channel: "chrome",
  headless: Boolean(opts.capture),
  defaultViewport: opts.capture ? { width: 1280, height: 800 } : null,
  userDataDir: opts.profile,
});
const [page] = await browser.pages();
const cdp = await page.createCDPSession();
if (url) await page.goto(url).catch(() => {});

let busy = false;

async function runCapture() {
  if (busy) return;
  busy = true;
  const dir = join(outRoot, `${stamp()}-${slug(page.url())}`);
  mkdirSync(dir, { recursive: true });
  process.stdout.write(chalk.cyan(`\n● capturing ${page.url()} → ${dir}\n`));
  const clear = "\r\x1b[2K";
  const r = await capture(page, cdp, dir, {
    ...capOpts,
    onKeep: (i, ms) => process.stdout.write(clear + chalk.dim(`  ${String(i).padStart(3, "0")}  +${ms}ms\n`)),
    onTick: (ms) =>
      process.stdout.write(clear + chalk.dim(ms == null ? "  loading…" : `  stopping in ${(ms / 1000).toFixed(1)}s`)),
  });
  const gallery = pathToFileURL(resolve(dir, "index.html")).href;
  process.stdout.write(
    clear +
      chalk.green(`✔ kept ${r.kept}/${r.seen} frames in ${r.durationMs}ms (${r.reason})\n`) +
      chalk.cyan(`  gallery: ${gallery}\n`) +
      (opts.capture ? "" : chalk.dim("press Enter to capture again · Ctrl-C to quit\n")),
  );
  busy = false;
}

async function shutdown() {
  process.stdout.write(chalk.dim("\nclosing…\n"));
  await browser.close().catch(() => {});
  process.exit(0);
}

if (opts.capture) {
  await runCapture();
  await shutdown();
}

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (key: string) => {
  if (key === "") shutdown();
  else if ((key === "\r" || key === "\n") && !busy) void runCapture();
});

console.log(chalk.bold("flashbulb ready.") + chalk.dim(" navigate/auth in the browser, then press Enter to reload + capture. Ctrl-C to quit."));
