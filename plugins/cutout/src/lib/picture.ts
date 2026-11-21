/**
 * The Picture shape: the outline of the shape in an image, as the path the bit's centre follows.
 *
 * The picture is resampled onto a grid with room around it, turned black and white by the threshold,
 * and a distance transform measures how far every cell is from the shape's edge. The path is where
 * that distance equals the bit's radius: outside the shape for an outside cut (the shape is kept),
 * inside it for an inside cut (the shape is removed). Marching squares place it smoothly between
 * cells. Only outer outlines are cut: holes inside the shape stay, so it comes out in one piece.
 *
 * Coordinates are mm with (0, 0) at the centre of the picture's rectangle, like the rectangle and
 * circle outlines, so zeroing works the same way.
 */

import { blurGrid, distanceToOutside, type Gray, makeGrid, outerRings, pictureSize, type Pt, ringArea, ringsToMm, simplifyRing, thresholdMask, traceContours } from "@shared/picture";

import type { Outline, Vertex } from "./outline";
import type { Params } from "./params";

export type PictureOutlines = {
	/** Counter-clockwise closed paths for the bit's centre, around (0, 0) = the picture's centre. */
	rings: Pt[][];
	/** The whole picture's size, mm. */
	width: number;
	height: number;
	/** True when nothing in the picture counts as shape at this threshold. */
	empty: boolean;
};

export const pictureOutlines = (p: Params, gray: Gray): PictureOutlines => {
	const { width, height } = pictureSize(gray, p.sizeBy, p.size);
	const r = p.toolDiameter / 2;
	const grid = blurGrid(makeGrid(gray, width, height, { maxCells: 500, pad: r + 2 }), 1);
	const mask = thresholdMask(grid, p.threshold, p.invert);
	const empty = !mask.some((m) => m === 1);
	const rc = r / grid.cell;
	const field = new Float32Array(mask.length);
	if (p.mode === "part") {
		// Distance from each cell outside the shape to the shape; the edge sits half a cell from a cell centre.
		const notShape = mask.map((m) => (m ? 0 : 1));
		const d = distanceToOutside(notShape, grid.w, grid.h, false);
		for (let i = 0; i < field.length; i += 1) field[i] = rc - (d[i] - 0.5);
	} else {
		const d = distanceToOutside(mask, grid.w, grid.h);
		for (let i = 0; i < field.length; i += 1) field[i] = d[i] - 0.5 - rc;
	}
	const rings = outerRings(ringsToMm(grid, traceContours(field, grid.w, grid.h)))
		.map((ring) => simplifyRing(ring, grid.cell * 0.15))
		// Specks smaller than the bit are left out.
		.filter((ring) => ring.length >= 3 && Math.abs(ringArea(ring)) > p.toolDiameter * p.toolDiameter * 0.25)
		.map((ring) => {
			const centred = ring.map((pt) => ({ x: pt.x - width / 2, y: pt.y - height / 2 }));
			return ringArea(centred) < 0 ? centred.reverse() : centred;
		});
	return { rings, width, height, empty };
};

/** A closed ring as an Outline (no straight sides, no arcs), starting at its lowest-left point. */
export const ringOutline = (ring: Pt[]): Outline => {
	let start = 0;
	ring.forEach((pt, i) => {
		const b = ring[start];
		if (pt.y < b.y - 1e-9 || (Math.abs(pt.y - b.y) < 1e-9 && pt.x < b.x)) start = i;
	});
	const pts = [...ring.slice(start), ...ring.slice(0, start), ring[start]];
	const vertices: Vertex[] = [];
	let s = 0;
	pts.forEach((pt, i) => {
		if (i > 0) s += Math.hypot(pt.x - pts[i - 1].x, pt.y - pts[i - 1].y);
		vertices.push({ x: pt.x, y: pt.y, s });
	});
	return { vertices, length: s, sides: [], arcs: [] };
};
