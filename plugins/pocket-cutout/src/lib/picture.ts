/**
 * The Picture shape: the shape in an image, cleared as a pocket.
 *
 * The picture is resampled onto a grid, turned black and white by the threshold, and the shared
 * clearing plans each level: rings from the middle outwards wherever the whole bit fits inside the shape, ending on
 * one pass around each outline. Each level ramps in along its first row, so the bit doesn't plunge
 * straight into the material.
 */

import { planClearing, type PassPlan } from "@shared/clearing";
import { blurGrid, type Gray, makeGrid, pictureSize, thresholdMask } from "@shared/picture";

import type { Params } from "./params";

export type PicturePocket = {
	passes: PassPlan[];
	/** The whole picture's size, mm. */
	width: number;
	height: number;
	/** Nothing in the picture counts as shape at this threshold. */
	empty: boolean;
	/** Share of the shape the bit can't reach because it is narrower than the bit. */
	missed: number;
};

export const planPicturePocket = (p: Params, gray: Gray): PicturePocket => {
	const { width, height } = pictureSize(gray, p.sizeBy, p.size);
	const grid = blurGrid(makeGrid(gray, width, height, { maxCells: 400 }), 1);
	const target = thresholdMask(grid, p.threshold, p.invert);
	const { passes, reached } = planClearing(grid, target, [0, p.depth], p);
	let shape = 0, missed = 0;
	for (let i = 0; i < target.length; i += 1) {
		if (!target[i]) continue;
		shape += 1;
		if (!reached[i]) missed += 1;
	}
	return { passes, width, height, empty: shape === 0, missed: shape ? missed / shape : 0 };
};
