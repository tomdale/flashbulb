import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CDPSession, Page } from "puppeteer";
import { decode, diffRatio, type FrameImage } from "./diff.ts";

export interface CaptureOptions {
  /** Min fraction of pixels that must change vs. the last kept frame (0..1). */
  deltaThreshold: number;
  /** Per-pixel color tolerance for pixelmatch (0..1). */
  pixelThreshold: number;
  /** Stop once loaded and no new state for this many ms. */
  quietMs: number;
  /** Hard cap on a capture session regardless of activity. */
  maxMs: number;
  /** Called as each distinct frame is kept, for live progress. */
  onKeep?: (index: number, offsetMs: number) => void;
  /** Periodic tick with ms left in the quiet window (null until loaded). */
  onTick?: (quietRemainingMs: number | null) => void;
}

export interface CaptureResult {
  kept: number;
  seen: number;
  reason: "quiet" | "max";
  durationMs: number;
}

interface FrameMeta {
  index: number;
  file: string;
  offsetMs: number;
  ratio: number;
}

const now = () => performance.now();

/**
 * Reload the page and persist a screenshot for each distinct render state until
 * the page is loaded and quiet. Frames arrive via CDP screencast (delivered on
 * repaint), so we only keep ones whose visual delta clears the threshold —
 * collapsing spinner/animation churn into a single state.
 */
export async function capture(
  page: Page,
  cdp: CDPSession,
  dir: string,
  opts: CaptureOptions,
): Promise<CaptureResult> {
  const frames: FrameMeta[] = [];
  let prev: FrameImage | null = null;
  let seen = 0;
  let lastChangeAt = now();
  const start = now();

  const onFrame = (evt: { data: string; sessionId: number }) => {
    cdp.send("Page.screencastFrameAck", { sessionId: evt.sessionId }).catch(() => {});
    seen++;
    const buf = Buffer.from(evt.data, "base64");
    let img: FrameImage;
    try {
      img = decode(buf);
    } catch {
      return;
    }
    const ratio = prev ? diffRatio(prev, img, opts.pixelThreshold) : 1;
    if (ratio < opts.deltaThreshold) return;
    const index = frames.length;
    const file = `${String(index).padStart(3, "0")}.png`;
    writeFileSync(join(dir, file), buf);
    const offsetMs = Math.round(now() - start);
    frames.push({ index, file, offsetMs, ratio });
    prev = img;
    lastChangeAt = now();
    opts.onKeep?.(index, offsetMs);
  };

  // Seed the comparison baseline with the pre-reload page so the old pixels
  // that linger after commit (until the new page first paints) get filtered out
  // instead of saved as a bogus first state.
  try {
    prev = decode(await page.screenshot({ type: "png" }) as Buffer);
  } catch {
    prev = null;
  }

  // Reload first and wait for the main frame to commit before recording.
  let loaded = false;
  const committed = new Promise<void>((res) => {
    page.once("framenavigated", (f) => { if (f === page.mainFrame()) res(); });
  });
  page.reload({ waitUntil: "load" }).then(() => { loaded = true; }).catch(() => { loaded = true; });
  await committed;

  cdp.on("Page.screencastFrame", onFrame);
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });

  const reason = await new Promise<CaptureResult["reason"]>((resolve) => {
    const tick = setInterval(() => {
      const elapsed = now() - start;
      opts.onTick?.(loaded ? Math.max(0, opts.quietMs - (now() - lastChangeAt)) : null);
      if (elapsed >= opts.maxMs) return finish("max");
      if (loaded && now() - lastChangeAt >= opts.quietMs) return finish("quiet");
    }, 100);
    const finish = (r: CaptureResult["reason"]) => { clearInterval(tick); resolve(r); };
  });

  cdp.off("Page.screencastFrame", onFrame);
  await cdp.send("Page.stopScreencast").catch(() => {});

  writeFileSync(
    join(dir, "frames.json"),
    JSON.stringify({ url: page.url(), reason, frames }, null, 2),
  );
  const dpr = await page.evaluate(() => window.devicePixelRatio).catch(() => 1);
  writeFileSync(join(dir, "index.html"), gallery(page.url(), frames, dpr));
  return { kept: frames.length, seen, reason, durationMs: Math.round(now() - start) };
}

/**
 * Self-contained viewer: a filmstrip of frames at the bottom; click a thumb to
 * show it full-resolution (scaled by dpr to actual size) as the main content;
 * click a second thumb to overlay both with a before/after diff slider.
 */
function gallery(url: string, frames: FrameMeta[], dpr: number): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const data = JSON.stringify(frames.map((f) => ({ file: f.file, offsetMs: f.offsetMs, index: f.index, ratio: f.ratio })));
  return `<!doctype html><meta charset=utf8><title>flashbulb · ${esc(url)}</title>
<style>
*{box-sizing:border-box}body{margin:0;font:13px system-ui;background:#0e0e0e;color:#eee;height:100vh;display:flex;flex-direction:column}
header{padding:10px 16px;border-bottom:1px solid #2a2a2a;font-size:13px;color:#bbb;word-break:break-all}
header b{color:#eee}
#stage{flex:1;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:16px}
#hint{color:#666;align-self:center}
#stage img{display:block;height:auto}
#cmp{position:relative;line-height:0}#cmp .top{position:absolute;inset:0;overflow:hidden}
#cmp .grip{position:absolute;top:0;bottom:0;width:2px;background:#0bf;cursor:ew-resize}
#cmp .grip::after{content:"";position:absolute;top:50%;left:50%;width:28px;height:28px;margin:-14px;border-radius:50%;background:#0bf;border:3px solid #0e0e0e}
.strip{display:flex;gap:8px;overflow-x:auto;padding:8px 12px;border-top:1px solid #2a2a2a;background:#141414}
.strip figure{margin:0;flex:0 0 auto;width:150px;cursor:pointer;border:2px solid transparent;border-radius:4px;overflow:hidden}
.strip figure.sel{border-color:#0bf}.strip img{width:100%;display:block}.strip figcaption{padding:3px 6px;color:#aaa;font-size:11px}
</style>
<header><b>${esc(url)}</b> — ${frames.length} states · click a thumb · shift-click a second to compare</header>
<div id=stage><div id=hint>select a frame below</div></div>
<div class=strip id=strip></div>
<script>
const dpr=${dpr},F=${data},W=i=>i.naturalWidth/dpr+"px";let sel=F.length?[F[0].index]:[];
const stage=document.getElementById("stage"),strip=document.getElementById("strip");
F.forEach(f=>{const fig=document.createElement("figure");fig.dataset.i=f.index;
fig.innerHTML='<img src="'+f.file+'"><figcaption>+'+f.offsetMs+'ms'+(f.index?' · Δ'+(f.ratio*100).toFixed(1)+'%':'')+'</figcaption>';
fig.onclick=e=>{const i=f.index;sel=e.shiftKey?(sel.includes(i)?sel.filter(x=>x!==i):[...sel,i].slice(-2)):(sel.length===1&&sel[0]===i?[]:[i]);render();};strip.append(fig);});
function render(){[...strip.children].forEach(c=>{const on=sel.includes(+c.dataset.i);c.classList.toggle("sel",on);if(on)c.scrollIntoView({inline:"center",block:"nearest"});});
stage.innerHTML="";
if(!sel.length){stage.innerHTML='<div id=hint>select a frame below</div>';return;}
if(sel.length===1){const m=img(sel[0]);m.style.cursor="zoom-out";m.onclick=()=>{sel=[];render();};fit(m,()=>m.style.width=W(m));stage.append(m);return;}
const c=document.createElement("div");c.id="cmp";const a=img(sel[0]),t=img(sel[1]),tw=document.createElement("div");tw.className="top";tw.append(t);const g=document.createElement("div");g.className="grip";c.append(a,tw,g);stage.append(c);
fit(a,()=>{a.style.width=t.style.width=c.style.width=W(a);});move(50);
function move(p){g.style.left=p+"%";tw.style.clipPath="inset(0 "+(100-p)+"% 0 0)";}
c.onmousemove=e=>move(Math.max(0,Math.min(100,(e.clientX-c.getBoundingClientRect().left)/c.offsetWidth*100)));
c.onclick=()=>{sel=[];render();};}
function img(i){const m=new Image();m.src=F.find(f=>f.index===i).file;return m;}
function fit(m,cb){m.complete?cb():m.onload=cb;}
document.onkeydown=e=>{const d=e.key==="ArrowRight"?1:e.key==="ArrowLeft"?-1:0;if(!d)return;e.preventDefault();
const cur=sel.length?sel[sel.length-1]:-1;sel=[Math.max(0,Math.min(F.length-1,cur+d))];render();};
render();
</script>`;
}
