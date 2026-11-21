/**
 * Picture → terraced levels → toolpaths.
 *
 * 1. The picture is turned to grey and resampled onto a grid covering its real-world size
 *    (shared picture code).
 * 2. It is blurred by the smoothing radius, its own darkest-to-lightest range is stretched, and it is
 *    split into `steps + 1` bands: the lightest band is level 0 (stock top), the darkest is level
 *    `steps` (full depth).
 * 3. The shared clearing plans the passes: rings from the inside out that keep the whole bit inside each
 *    level's area, and works out what the bit really reaches.
 */

import { passDepths as passDepthsFor, planClearing, type PassPlan } from "@shared/clearing";
import { blurGrid, makeGrid, type Gray, type Grid } from "@shared/picture";

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
};

/** Everything for one picture and one set of settings: levels, passes and what the bit reaches. */
export const planCut = (gray: Gray, o: PlanOptions): Plan => {
	const base = makeGrid(gray, o.width, o.height);
	const grid = blurGrid(base, o.smoothing / base.cell);
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
