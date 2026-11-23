/**
 * Picture → terraced levels → toolpaths.
 *
 * 1. The picture is turned to grey and resampled onto a grid covering its real-world size, each cell
 *    from its nearest pixel (shared picture code), so sharp edges stay sharp.
 * 2. Its own darkest-to-lightest range is stretched and it is split into `steps + 1` bands: the
 *    lightest band is level 0 (stock top), the darkest is level `steps` (full depth).
 *    Before that, smoothing runs a median filter over the brightness (not a blur): it removes specks
 *    and ragged edges but never turns a sharp edge into in-between levels, so it stays one straight wall.
 * 3. The shared clearing plans the passes: rings from the inside out that keep the whole bit inside each
 *    level's area, and works out what the bit really reaches.
 */

import { passDepths as passDepthsFor, planClearing, type PassPlan, type Strategy } from "@shared/clearing";
import { makeGrid, type Gray, type Grid } from "@shared/picture";

import { levelDepths } from "./params";

export { distanceToOutside, pictureSize, shrink, toGray } from "@shared/picture";
export type { Gray, Grid, Pt, RawImage } from "@shared/picture";
export type { PassPlan, Stroke } from "@shared/clearing";

/** The pass depths: down to each level in even passes no deeper than `stepdown`. */
export const passDepths = (depth: number, steps: number, stepdown: number): number[] => passDepthsFor(levelDepths(depth, steps), stepdown);

/**
 * Splits brightness into `steps + 1` even bands: 0 = lightest = stock top, `steps` = darkest = full
 * depth. The picture's own range is stretched first (its darkest and lightest 0.5 % set the ends), so
 * a height map that never reaches pure black or white still uses every level.
 */
export const levelMap = (g: Grid, steps: number, invert: boolean): Uint8Array => {
	const hist = new Uint32Array(256);
	for (let i = 0; i < g.v.length; i += 1) hist[Math.min(255, Math.max(0, Math.round(g.v[i])))] += 1;
	const cut = g.v.length * 0.005;
	let lo = 0, hi = 255, acc = 0;
	for (let b = 0; b < 256; b += 1) {
		acc += hist[b];
		if (acc > cut) {
			lo = b;
			break;
		}
	}
	acc = 0;
	for (let b = 255; b >= 0; b -= 1) {
		acc += hist[b];
		if (acc > cut) {
			hi = b;
			break;
		}
	}
	const span = hi - lo;
	const out = new Uint8Array(g.v.length);
	for (let i = 0; i < out.length; i += 1) {
		// A flat picture (no contrast) stays at the top.
		const light = span < 1 ? 1 : Math.min(1, Math.max(0, (g.v[i] - lo) / span));
		const high = invert ? 1 - light : light;
		out[i] = Math.min(steps, Math.floor((1 - high) * (steps + 1)));
	}
	return out;
};

/**
 * Median filter on a level map, over a square window `radius` cells out: each cell takes the level
 * that at least half its neighbourhood reaches. Edges stay where they are and stay sharp (a picture
 * with two levels keeps two levels); specks smaller than about half the window disappear. Running
 * sums make it one pass per level, whatever the radius.
 */
export const medianLevels = (levels: Uint8Array, w: number, h: number, steps: number, radius: number): Uint8Array => {
	const r = Math.round(radius);
	if (r < 1) return levels;
	const out = new Uint8Array(levels.length);
	const sum = new Int32Array((w + 1) * (h + 1));
	for (let L = 1; L <= steps; L += 1) {
		// sum[(j+1)(w+1) + i+1] = cells at level L or deeper in the rectangle (0,0)-(i,j).
		for (let j = 0; j < h; j += 1) {
			let row = 0;
			for (let i = 0; i < w; i += 1) {
				row += levels[j * w + i] >= L ? 1 : 0;
				sum[(j + 1) * (w + 1) + i + 1] = sum[j * (w + 1) + i + 1] + row;
			}
		}
		for (let j = 0; j < h; j += 1) {
			const j0 = Math.max(0, j - r), j1 = Math.min(h - 1, j + r);
			for (let i = 0; i < w; i += 1) {
				const i0 = Math.max(0, i - r), i1 = Math.min(w - 1, i + r);
				const n = sum[(j1 + 1) * (w + 1) + i1 + 1] - sum[j0 * (w + 1) + i1 + 1] - sum[(j1 + 1) * (w + 1) + i0] + sum[j0 * (w + 1) + i0];
				const area = (j1 - j0 + 1) * (i1 - i0 + 1);
				if (2 * n > area) out[j * w + i] = L;
			}
		}
	}
	return out;
};

/** Grey levels are filtered in this many steps: plenty for up to 12 cut levels, quick for any radius. */
const MEDIAN_BINS = 64;

/**
 * Median filter on the picture's brightness, `radius` cells out (at least 1). At a sharp edge every
 * cell snaps to the side most of its neighbours are on, so the grey fringe left by resampling (or a
 * speck) disappears instead of turning into extra levels; smooth gradients pass through unchanged.
 */
export const medianGrid = (g: Grid, radius: number): Grid => {
	const top = MEDIAN_BINS - 1;
	const q = new Uint8Array(g.v.length);
	for (let i = 0; i < q.length; i += 1) q[i] = Math.round((Math.min(255, Math.max(0, g.v[i])) / 255) * top);
	const m = medianLevels(q, g.w, g.h, top, Math.max(1, radius));
	const v = new Float32Array(g.v.length);
	for (let i = 0; i < v.length; i += 1) v[i] = (m[i] / top) * 255;
	return { ...g, v };
};

export type Plan = {
	grid: Grid;
	/** The level each cell asks for (from the picture). */
	target: Uint8Array;
	/** The level the bit really reaches in each cell (higher where the bit doesn't fit). */
	reached: Uint8Array;
	passes: PassPlan[];
	width: number;
	height: number;
	/** Share of the picture, per level, that the bit reaches: top first. */
	share: number[];
	/** Share of the picture left higher than asked because the bit doesn't fit there. */
	missed: number;
};

export type PlanOptions = {
	width: number;
	height: number;
	steps: number;
	depth: number;
	invert: boolean;
	smoothing: number;
	toolDiameter: number;
	stepover: number;
	stepdown: number;
	/** Rings (default) or adaptive clearing. */
	strategy?: Strategy;
	/** Adaptive only: every arc climb instead of back and forth. */
	climbOnly?: boolean;
};

/** Everything for one picture and one set of settings: levels, passes and what the bit reaches. */
export const planCut = (gray: Gray, o: PlanOptions): Plan => {
	const base = makeGrid(gray, o.width, o.height, { nearest: true });
	const grid = medianGrid(base, o.smoothing / base.cell);
	const target = levelMap(grid, o.steps, o.invert);
	const levels = levelDepths(o.depth, o.steps);
	const { passes, reached } = planClearing(grid, target, levels, o);
	const share = levels.map(() => 0);
	let missed = 0;
	for (let i = 0; i < reached.length; i += 1) {
		share[reached[i]] += 1;
		if (reached[i] < target[i]) missed += 1;
	}
	return {
		grid,
		target,
		reached,
		passes,
		width: o.width,
		height: o.height,
		share: share.map((s) => s / reached.length),
		missed: missed / reached.length,
	};
};
