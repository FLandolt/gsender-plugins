/**
 * The closed tool-centre path around a rounded rectangle.
 *
 * Built counter-clockwise, starting at the left end of the bottom straight, as
 * a list of vertices with their running arc length `s`. Corner arcs are chorded
 * finely enough that the sag stays under 0.01 mm.
 */

export type Vertex = { x: number; y: number; s: number };

/** A straight side, as arc-length positions along the path. */
export type Side = { start: number; end: number };

export type Outline = {
	/** Closed loop: the last vertex coincides with the first. */
	vertices: Vertex[];
	length: number;
	/** The four straight sides in travel order: bottom, right, top, left. */
	sides: Side[];
};

const SAG = 0.01;

const arcSteps = (r: number): number => {
	if (r <= SAG) return 1;
	return Math.max(2, Math.ceil(Math.PI / 2 / (2 * Math.acos(1 - SAG / r))));
};

/**
 * @param hx half width of the centre-line rectangle
 * @param hy half height of the centre-line rectangle
 * @param r  corner radius of the centre-line rectangle, 0 ≤ r ≤ min(hx, hy)
 */
export const buildOutline = (hx: number, hy: number, r: number): Outline => {
	// Each side: where its straight ends, and the arc centre/start angle that follows.
	const sides = [
		{ end: [hx - r, -hy], centre: [hx - r, -hy + r], a0: -Math.PI / 2 },
		{ end: [hx, hy - r], centre: [hx - r, hy - r], a0: 0 },
		{ end: [-hx + r, hy], centre: [-hx + r, hy - r], a0: Math.PI / 2 },
		{ end: [-hx, -hy + r], centre: [-hx + r, -hy + r], a0: Math.PI },
	];

	const pts: [number, number][] = [[-hx + r, -hy]];
	const straightIdx: { start: number; end: number }[] = [];
	const n = arcSteps(r);

	for (const side of sides) {
		const startIdx = pts.length - 1;
		pts.push([side.end[0], side.end[1]]);
		straightIdx.push({ start: startIdx, end: pts.length - 1 });
		if (r > 0) {
			for (let k = 1; k <= n; k += 1) {
				const a = side.a0 + (Math.PI / 2) * (k / n);
				pts.push([side.centre[0] + r * Math.cos(a), side.centre[1] + r * Math.sin(a)]);
			}
		}
	}

	const vertices: Vertex[] = [];
	let s = 0;
	pts.forEach(([x, y], i) => {
		if (i > 0) s += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]);
		vertices.push({ x, y, s });
	});

	return {
		vertices,
		length: s,
		sides: straightIdx.map((t) => ({ start: vertices[t.start].s, end: vertices[t.end].s })),
	};
};

/** Reverses a path's direction, keeping the same start point. */
export const reverseOutline = (o: Outline): Outline => {
	const vertices = [...o.vertices].reverse().map((v) => ({ ...v, s: o.length - v.s }));
	const sides = o.sides.map((t) => ({ start: o.length - t.end, end: o.length - t.start }));
	return { vertices, length: o.length, sides };
};
