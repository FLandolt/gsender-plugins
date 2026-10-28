/** Plain 2D geometry for closed outlines: shapes, containment, simplification. All lengths in mm. */

export type Pt = { x: number; y: number };

/** A closed outline; the last point is not repeated. */
export type Ring = Pt[];

/** One filled region: an outside outline and the holes cut out of it. */
export type Shape = { outer: Ring; holes: Ring[] };

/** Signed area; counter-clockwise outlines are positive. */
export const ringArea = (r: Ring): number => {
	let a = 0;
	for (let i = 0, j = r.length - 1; i < r.length; j = i, i += 1) a += (r[j].x * r[i].y - r[i].x * r[j].y) / 2;
	return a;
};

export const ringLength = (r: Ring): number => {
	let l = 0;
	for (let i = 0, j = r.length - 1; i < r.length; j = i, i += 1) l += Math.hypot(r[i].x - r[j].x, r[i].y - r[j].y);
	return l;
};

/** The ring turned to run counter-clockwise (or clockwise). */
export const oriented = (r: Ring, counterClockwise: boolean): Ring => ((ringArea(r) > 0) === counterClockwise ? r : [...r].reverse());

/** Even-odd test of a point against one ring. */
export const pointInRing = (p: Pt, r: Ring): boolean => {
	let inside = false;
	for (let i = 0, j = r.length - 1; i < r.length; j = i, i += 1) {
		const a = r[i], b = r[j];
		if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
	}
	return inside;
};

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export const boundsOf = (rings: Ring[]): Bounds => {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const r of rings) for (const p of r) {
		if (p.x < minX) minX = p.x;
		if (p.x > maxX) maxX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.y > maxY) maxY = p.y;
	}
	return { minX, minY, maxX, maxY };
};

/**
 * Sorts loose outlines into shapes by how deeply they are nested: outlines inside an even
 * number of others are outsides, inside an odd number are holes of the smallest outside
 * around them. So the inside of an "O" is a hole, and a dot inside that hole is a new shape.
 * Outlines with fewer than three points or no area are dropped.
 */
export const buildShapes = (rings: Ring[]): Shape[] => {
	const items = rings
		.filter((r) => r.length >= 3 && Math.abs(ringArea(r)) > 1e-9)
		.map((ring) => ({ ring, area: Math.abs(ringArea(ring)), bounds: boundsOf([ring]) }));
	const contains = (outer: (typeof items)[number], inner: (typeof items)[number]) =>
		outer !== inner &&
		outer.area > inner.area &&
		inner.bounds.minX >= outer.bounds.minX && inner.bounds.maxX <= outer.bounds.maxX &&
		inner.bounds.minY >= outer.bounds.minY && inner.bounds.maxY <= outer.bounds.maxY &&
		pointInRing(inner.ring[0], outer.ring);
	const depth = items.map((it) => items.filter((o) => contains(o, it)).length);
	const shapes = new Map<number, Shape>();
	items.forEach((it, i) => {
		if (depth[i] % 2 === 0) shapes.set(i, { outer: oriented(it.ring, true), holes: [] });
	});
	items.forEach((it, i) => {
		if (depth[i] % 2 === 0) return;
		let parent = -1;
		items.forEach((o, j) => {
			if (depth[j] === depth[i] - 1 && contains(o, it) && (parent < 0 || o.area < items[parent].area)) parent = j;
		});
		if (parent >= 0) shapes.get(parent)?.holes.push(oriented(it.ring, false));
	});
	return [...shapes.values()];
};

/** Fast even-odd point test against every outline of a shape (rows of segments by height). */
export const shapeTester = (rings: Ring[]): ((x: number, y: number) => boolean) => {
	const b = boundsOf(rings);
	let segs = 0;
	for (const r of rings) segs += r.length;
	const bands = Math.max(1, Math.min(2048, Math.round(Math.sqrt(segs))));
	const bandH = (b.maxY - b.minY) / bands || 1;
	const rows: number[][] = Array.from({ length: bands }, () => []);
	const ax: number[] = [], ay: number[] = [], bx: number[] = [], by: number[] = [];
	for (const r of rings) {
		for (let i = 0, j = r.length - 1; i < r.length; j = i, i += 1) {
			const id = ax.length;
			ax.push(r[i].x); ay.push(r[i].y); bx.push(r[j].x); by.push(r[j].y);
			const lo = Math.max(0, Math.floor((Math.min(r[i].y, r[j].y) - b.minY) / bandH));
			const hi = Math.min(bands - 1, Math.floor((Math.max(r[i].y, r[j].y) - b.minY) / bandH));
			for (let k = lo; k <= hi; k += 1) rows[k].push(id);
		}
	}
	return (x, y) => {
		if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) return false;
		const row = rows[Math.min(bands - 1, Math.max(0, Math.floor((y - b.minY) / bandH)))];
		let inside = false;
		for (const id of row) {
			if (ay[id] > y !== by[id] > y && x < ((bx[id] - ax[id]) * (y - ay[id])) / (by[id] - ay[id]) + ax[id]) inside = !inside;
		}
		return inside;
	};
};

/** Douglas–Peucker for an open polyline of points with a third coordinate `z`; keeps `keep` indices. */
export const simplifyOpen3 = <T extends { x: number; y: number; z: number }>(pts: T[], tol: number, keep: Set<number> = new Set()): T[] => {
	const n = pts.length;
	if (n <= 2) return pts;
	const marks = new Uint8Array(n);
	marks[0] = 1;
	marks[n - 1] = 1;
	keep.forEach((i) => {
		if (i >= 0 && i < n) marks[i] = 1;
	});
	const dist = (p: T, a: T, b: T) => {
		const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
		const l2 = dx * dx + dy * dy + dz * dz;
		const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / l2));
		return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy), p.z - (a.z + t * dz));
	};
	const stack: [number, number][] = [];
	let start = 0;
	for (let i = 1; i < n; i += 1) {
		if (marks[i]) {
			stack.push([start, i]);
			start = i;
		}
	}
	while (stack.length) {
		const [lo, hi] = stack.pop()!;
		let worst = -1, at = -1;
		for (let i = lo + 1; i < hi; i += 1) {
			const d = dist(pts[i], pts[lo], pts[hi]);
			if (d > worst) {
				worst = d;
				at = i;
			}
		}
		if (worst > tol && at > 0) {
			marks[at] = 1;
			stack.push([lo, at], [at, hi]);
		}
	}
	return pts.filter((_, i) => marks[i]);
};

/** Douglas–Peucker for a closed outline. */
export const simplifyRing = (r: Ring, tol: number): Ring => {
	if (r.length < 4) return r;
	// Cut the loop at its two most distant points so both halves are open polylines.
	let a = 0, b = 0, best = -1;
	for (let i = 1; i < r.length; i += 1) {
		const d = Math.hypot(r[i].x - r[0].x, r[i].y - r[0].y);
		if (d > best) { best = d; b = i; }
	}
	best = -1;
	for (let i = 0; i < r.length; i += 1) {
		const d = Math.hypot(r[i].x - r[b].x, r[i].y - r[b].y);
		if (d > best) { best = d; a = i; }
	}
	const [lo, hi] = a < b ? [a, b] : [b, a];
	const first = r.slice(lo, hi + 1).map((p) => ({ ...p, z: 0 }));
	const second = [...r.slice(hi), ...r.slice(0, lo), r[lo]].map((p) => ({ ...p, z: 0 }));
	const s1 = simplifyOpen3(first, tol);
	const s2 = simplifyOpen3(second, tol);
	const out = [...s1.slice(0, -1), ...s2.slice(0, -1)].map((p) => ({ x: p.x, y: p.y }));
	return out.length >= 3 ? out : r;
};

/** Turn angle at each vertex of a closed ring, in radians, positive when it bends left. */
export const turnAngles = (r: Ring): number[] =>
	r.map((p, i) => {
		const a = r[(i + r.length - 1) % r.length], b = r[(i + 1) % r.length];
		const ux = p.x - a.x, uy = p.y - a.y, vx = b.x - p.x, vy = b.y - p.y;
		return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
	});

/** Points along a cubic Bézier, not including the start, with chord error at most `tol`. */
export const flattenCubic = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, tol: number): Pt[] => {
	// Estimate how far the curve strays from its chord, then split evenly.
	const dev = Math.max(
		Math.hypot(p0.x - 2 * p1.x + p2.x, p0.y - 2 * p1.y + p2.y),
		Math.hypot(p1.x - 2 * p2.x + p3.x, p1.y - 2 * p2.y + p3.y),
	);
	const n = Math.max(1, Math.min(200, Math.ceil(Math.sqrt((0.75 * dev) / tol))));
	const out: Pt[] = [];
	for (let i = 1; i <= n; i += 1) {
		const t = i / n, u = 1 - t;
		out.push({
			x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
			y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
		});
	}
	return out;
};

export const flattenQuad = (p0: Pt, p1: Pt, p2: Pt, tol: number): Pt[] =>
	flattenCubic(
		p0,
		{ x: p0.x + (2 / 3) * (p1.x - p0.x), y: p0.y + (2 / 3) * (p1.y - p0.y) },
		{ x: p2.x + (2 / 3) * (p1.x - p2.x), y: p2.y + (2 / 3) * (p1.y - p2.y) },
		p2,
		tol,
	);
