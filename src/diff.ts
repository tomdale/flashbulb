import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface FrameImage {
  width: number;
  height: number;
  data: Buffer;
}

/** Decode a PNG buffer into raw RGBA pixels. */
export function decode(png: Buffer): FrameImage {
  const img = PNG.sync.read(png);
  return { width: img.width, height: img.height, data: img.data };
}

/**
 * Fraction of viewport pixels that changed between two frames (0..1).
 *
 * A change in viewport dimensions counts as a full repaint: the page reflowed
 * enough that pixel-level comparison is meaningless, so we always persist it.
 * `pixelThreshold` is pixelmatch's per-pixel color tolerance — higher values
 * ignore subtle antialiasing/compression noise so a spinner's frames don't each
 * register as a distinct state.
 */
export function diffRatio(
  a: FrameImage,
  b: FrameImage,
  pixelThreshold: number,
): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  const total = a.width * a.height;
  if (total === 0) return 1;
  const changed = pixelmatch(a.data, b.data, undefined, a.width, a.height, {
    threshold: pixelThreshold,
  });
  return changed / total;
}
