/**
 * The closed tool-centre path around a rounded rectangle.
 *
 * Built counter-clockwise, starting at the left end of the bottom straight, as
 * a list of vertices with their running arc length `s`. Corner arcs are chorded
 * finely enough that the sag stays under 0.01 mm; the true arcs are kept in
 * `arcs` so the generator can write them as G2/G3 instead.
 */

export type Vertex = { x: number; y: number; s: number };

/** A straight side, as arc-length positions along the path. */
export type Side = { start: number; end: number };

/**
 * A true arc of the path: spans path positions `s0`..`s1`, which hold its chord vertices.
 * It starts at angle `a0` on the circle (centre `cx`,`cy`, radius `r`) and turns
 * counter-clockwise, or clockwise when `cw`.
 */
export type Arc = { s0: number; s1: number; cx: number; cy: number; r: number; a0: number; cw: boolean };

/** The point at path position `s` on an arc, exactly on its circle. */
export const arcPoint = (a: Arc, s: number): { x: number; y: number } => {
	const angle = a.a0 + (a.cw ? -1 : 1) * ((s - a.s0) / a.r);
	return { x: a.cx + a.r * Math.cos(angle), y: a.cy + a.r * Math.sin(angle) };
};

export type Outline = {
	/** Closed loop: the last vertex coincides with the first. */
	vertices: Vertex[];
	length: number;
	/** The straight sides in travel order: bottom, right, top, left. None on a circle. */
	sides: Side[];
	/** Corner arcs in travel order; empty when the corners are sharp or tiny. */
	arcs: Arc[];
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
	const arcIdx: { start: number; end: number; cx: number; cy: number; a0: number }[] = [];
	const n = arcSteps(r);

	for (const side of sides) {
		const startIdx = pts.length - 1;
		pts.push([side.end[0], side.end[1]]);
		straightIdx.push({ start: startIdx, end: pts.length - 1 });
		if (r > 0) {
			const arcStart = pts.length - 1;
			for (let k = 1; k <= n; k += 1) {
				const a = side.a0 + (Math.PI / 2) * (k / n);
				pts.push([side.centre[0] + r * Math.cos(a), side.centre[1] + r * Math.sin(a)]);
			}
			// Below this a printed arc would be mostly rounding; the chord stands in.
			if (r >= SAG) arcIdx.push({ start: arcStart, end: pts.length - 1, cx: side.centre[0], cy: side.centre[1], a0: side.a0 });
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
		arcs: arcIdx.map((a) => ({ s0: vertices[a.start].s, s1: vertices[a.end].s, cx: a.cx, cy: a.cy, r, a0: a.a0, cw: false })),
	};
};

/** Reverses a path's direction, keeping the same start point. */
export const reverseOutline = (o: Outline): Outline => {
	const vertices = [...o.vertices].reverse().map((v) => ({ ...v, s: o.length - v.s }));
	const sides = o.sides.map((t) => ({ start: o.length - t.end, end: o.length - t.start }));
	// Walking an arc backwards starts where it ended and turns the other way.
	const arcs = o.arcs
		.map((a) => ({ ...a, s0: o.length - a.s1, s1: o.length - a.s0, a0: a.a0 + (a.cw ? -1 : 1) * ((a.s1 - a.s0) / a.r), cw: !a.cw }))
		.reverse();
	return { vertices, length: o.length, sides, arcs };
};

/**
 * The closed path around a circle of radius `r`, counter-clockwise, starting at the
 * bottom. It has no straight sides, so no `sides`; the circle is four quarter arcs.
 */
export const buildCircleOutline = (r: number): Outline => {
	const n = 4 * arcSteps(r);
	const start = -Math.PI / 2;
	const vertices: Vertex[] = [];
	for (let k = 0; k <= n; k += 1) {
		const a = start + (2 * Math.PI * k) / n;
		vertices.push({ x: r * Math.cos(a), y: r * Math.sin(a), s: (2 * Math.PI * r * k) / n });
	}
	// Close the loop exactly on its first point.
	vertices[n] = { ...vertices[0], s: 2 * Math.PI * r };
	const quarter = (Math.PI / 2) * r;
	const arcs: Arc[] = [0, 1, 2, 3].map((q) => ({
		s0: q * quarter,
		s1: (q + 1) * quarter,
		cx: 0,
		cy: 0,
		r,
		a0: start + (q * Math.PI) / 2,
		cw: false,
	}));
	return { vertices, length: 2 * Math.PI * r, sides: [], arcs };
};
