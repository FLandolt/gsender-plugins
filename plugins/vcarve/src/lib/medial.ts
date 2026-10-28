/**
 * The centre line ("medial axis") of a shape, with the distance from each of its points
 * to the nearest edge.
 *
 * It is found from the Voronoi diagram of points sampled along the outline, taken from a
 * Delaunay triangulation: the centres of the triangles inside the shape, joined where
 * triangles touch, run along the middle of the shape, and the radius of each triangle's
 * circle is how far that point is from the edge. Sampling noise adds tiny spurious
 * branches on curves, which are filtered out; convex corners are always sampled, and their
 * branch is extended right up to the corner so points come out sharp.
 *
 * The radius of every axis point is then measured exactly, as its distance to the
 * outline, never more than the true distance, so a cut can never be wider than the shape.
 * The path itself is an approximation whose error shrinks with the sample spacing `h`.
 */

import Delaunator from "delaunator";

import { oriented, shapeTester, turnAngles, type Pt, type Shape } from "./geom";

export type AxisVertex = { x: number; y: number; r: number };

export type Axis = {
	verts: AxisVertex[];
	/** Neighbours of each vertex. */
	adj: number[][];
	/** Where the convex corners of the shape are. */
	corners: Pt[];
};

/** A bend sharper than this is a corner of the artwork; milder bends are just curves. */
const CORNER_TURN = (25 * Math.PI) / 180;
/** Two edge points further apart along the outline than this × their distance are on opposite sides of something. */
const FOLD_RATIO = 1.2;

type Site = { x: number; y: number; ring: number; s: number; corner: boolean };

export const medialAxis = (shape: Shape, h: number): Axis => {
	const rings = [oriented(shape.outer, true), ...shape.holes.map((r) => oriented(r, false))];
	const sites: Site[] = [];
	const ringStart: number[] = [];
	const ringLen: number[] = [];
	const ringCount: number[] = [];
	const cornerPrefix: number[][] = [];
	const corners: Pt[] = [];

	rings.forEach((ring, k) => {
		const turns = turnAngles(ring);
		ringStart.push(sites.length);
		let s = 0;
		for (let i = 0; i < ring.length; i += 1) {
			const a = ring[i], b = ring[(i + 1) % ring.length];
			const isCorner = Math.abs(turns[i]) >= CORNER_TURN;
			if (isCorner && turns[i] > 0) corners.push({ x: a.x, y: a.y });
			sites.push({ x: a.x, y: a.y, ring: k, s, corner: isCorner });
			const len = Math.hypot(b.x - a.x, b.y - a.y);
			const m = Math.max(1, Math.ceil(len / h));
			for (let j = 1; j < m; j += 1) {
				sites.push({ x: a.x + ((b.x - a.x) * j) / m, y: a.y + ((b.y - a.y) * j) / m, ring: k, s: s + (len * j) / m, corner: false });
			}
			s += len;
		}
		ringLen.push(s);
		ringCount.push(sites.length - ringStart[k]);
		const prefix = [0];
		for (let i = ringStart[k]; i < sites.length; i += 1) prefix.push(prefix[prefix.length - 1] + (sites[i].corner ? 1 : 0));
		cornerPrefix.push(prefix);
	});

	const empty: Axis = { verts: [], adj: [], corners };
	if (sites.length < 3) return empty;
	const del = Delaunator.from(sites, (p) => p.x, (p) => p.y);
	const { triangles, halfedges } = del;
	const nTri = triangles.length / 3;

	// Centre and radius of each triangle's circle, and whether the centre is inside the shape.
	const inside = shapeTester(rings);
	const cx = new Float64Array(nTri), cy = new Float64Array(nTri), cr = new Float64Array(nTri);
	const ok = new Uint8Array(nTri);
	let reach = 0;
	for (const r of rings) for (const p of r) reach = Math.max(reach, Math.hypot(p.x - rings[0][0].x, p.y - rings[0][0].y));
	for (let t = 0; t < nTri; t += 1) {
		const A = sites[triangles[3 * t]], B = sites[triangles[3 * t + 1]], C = sites[triangles[3 * t + 2]];
		const bx = B.x - A.x, by = B.y - A.y, ccx = C.x - A.x, ccy = C.y - A.y;
		const d = 2 * (bx * ccy - by * ccx);
		if (Math.abs(d) < 1e-12) continue;
		const b2 = bx * bx + by * by, c2 = ccx * ccx + ccy * ccy;
		const ux = (ccy * b2 - by * c2) / d, uy = (bx * c2 - ccx * b2) / d;
		const r = Math.hypot(ux, uy);
		if (r > reach * 2 + 1) continue;
		cx[t] = A.x + ux;
		cy[t] = A.y + uy;
		cr[t] = r;
		ok[t] = inside(cx[t], cy[t]) ? 1 : 0;
	}

	// Is there a real fold or corner between two sites of the same outline?
	const folds = (ia: number, ib: number): boolean => {
		const a = sites[ia], b = sites[ib];
		if (a.ring !== b.ring) return true;
		const k = a.ring;
		const d = Math.abs(a.s - b.s);
		const e = Math.hypot(a.x - b.x, a.y - b.y);
		const arc = Math.min(d, ringLen[k] - d);
		if (arc >= FOLD_RATIO * e) return true;
		const lo = Math.min(ia, ib) - ringStart[k], hi = Math.max(ia, ib) - ringStart[k];
		const prefix = cornerPrefix[k];
		const innerShorter = d <= ringLen[k] / 2;
		const corners = innerShorter
			? prefix[hi + 1] - prefix[lo]
			: prefix[ringCount[k]] - (prefix[hi] - prefix[lo + 1]);
		return corners > 0;
	};

	// Join the centres of neighbouring triangles.
	const verts: AxisVertex[] = [];
	const adj: Set<number>[] = [];
	const key = new Map<string, number>();
	const eps = 2e-3;
	const vertexOf = (t: number): number => {
		const k = `${Math.round(cx[t] / eps)},${Math.round(cy[t] / eps)}`;
		let id = key.get(k);
		if (id === undefined) {
			id = verts.length;
			key.set(k, id);
			verts.push({ x: cx[t], y: cy[t], r: cr[t] });
			adj.push(new Set());
		} else if (cr[t] < verts[id].r) verts[id].r = cr[t];
		return id;
	};
	for (let e = 0; e < halfedges.length; e += 1) {
		const o = halfedges[e];
		if (o < e) continue;
		const t1 = Math.floor(e / 3), t2 = Math.floor(o / 3);
		if (!ok[t1] || !ok[t2]) continue;
		const a = triangles[e], b = triangles[e % 3 === 2 ? e - 2 : e + 1];
		if (!folds(a, b)) continue;
		// The link must stay inside the shape.
		if (!inside((cx[t1] + cx[t2]) / 2, (cy[t1] + cy[t2]) / 2)) continue;
		const v1 = vertexOf(t1), v2 = vertexOf(t2);
		if (v1 === v2) continue;
		adj[v1].add(v2);
		adj[v2].add(v1);
	}

	pruneHairs(verts, adj, corners, h);
	extendToCorners(verts, adj, corners, h);
	densify(verts, adj, h);
	const distance = boundaryDistance(rings, Math.max(4 * h, 0.5));
	for (const v of verts) if (v.r > 0) v.r = Math.min(v.r, distance(v.x, v.y, v.r));
	return { verts, adj: adj.map((s) => [...s]), corners };
};

/**
 * Puts points along every long edge. Between two points of the outline the centre line is
 * straight, but the radius along it is not (it grows like a hyperbola), so a depth
 * interpolated between the two ends would be too deep in between and cut past the edge.
 * With a point every `step`, the radius is measured exactly often enough.
 */
const densify = (verts: AxisVertex[], adj: Set<number>[], step: number) => {
	const count = verts.length;
	for (let u = 0; u < count; u += 1) {
		for (const v of [...adj[u]]) {
			if (v < u) continue;
			const a = verts[u], b = verts[v];
			const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step);
			if (n < 2) continue;
			adj[u].delete(v);
			adj[v].delete(u);
			let prev = u;
			for (let k = 1; k < n; k += 1) {
				const id = verts.length;
				// The radius here is only a starting bound; it is measured exactly afterwards.
				verts.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n, r: Math.max(a.r, b.r) });
				adj.push(new Set([prev]));
				adj[prev].add(id);
				prev = id;
			}
			adj[prev].add(v);
			adj[v].add(prev);
		}
	}
};

/** Distance from a point to the nearest outline, given an upper bound on it. */
const boundaryDistance = (rings: Pt[][], cell: number): ((x: number, y: number, upper: number) => number) => {
	const grid = new Map<string, number[]>();
	const ax: number[] = [], ay: number[] = [], bx: number[] = [], by: number[] = [];
	const keyOf = (i: number, j: number) => `${i},${j}`;
	for (const r of rings) {
		for (let i = 0, j = r.length - 1; i < r.length; j = i, i += 1) {
			const id = ax.length;
			ax.push(r[j].x); ay.push(r[j].y); bx.push(r[i].x); by.push(r[i].y);
			const i0 = Math.floor(Math.min(r[i].x, r[j].x) / cell), i1 = Math.floor(Math.max(r[i].x, r[j].x) / cell);
			const j0 = Math.floor(Math.min(r[i].y, r[j].y) / cell), j1 = Math.floor(Math.max(r[i].y, r[j].y) / cell);
			for (let a = i0; a <= i1; a += 1) for (let b = j0; b <= j1; b += 1) {
				const k = keyOf(a, b);
				(grid.get(k) ?? grid.set(k, []).get(k)!).push(id);
			}
		}
	}
	return (x, y, upper) => {
		let best = upper;
		const i0 = Math.floor((x - upper) / cell), i1 = Math.floor((x + upper) / cell);
		const j0 = Math.floor((y - upper) / cell), j1 = Math.floor((y + upper) / cell);
		for (let a = i0; a <= i1; a += 1) for (let b = j0; b <= j1; b += 1) {
			for (const id of grid.get(keyOf(a, b)) ?? []) {
				const dx = bx[id] - ax[id], dy = by[id] - ay[id];
				const l2 = dx * dx + dy * dy;
				const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax[id]) * dx + (y - ay[id]) * dy) / l2));
				const d = Math.hypot(x - (ax[id] + t * dx), y - (ay[id] + t * dy));
				if (d < best) best = d;
			}
		}
		return best;
	};
};

/** Leaves of a leaf-to-junction branch this short, ending right at an edge away from any corner, are sampling noise. */
const pruneHairs = (verts: AxisVertex[], adj: Set<number>[], corners: Pt[], h: number) => {
	const nearCorner = (v: AxisVertex) => corners.some((c) => Math.hypot(c.x - v.x, c.y - v.y) <= v.r + 3 * h);
	const maxLength = 6 * h;
	const maxR = 1.5 * h;
	for (let changed = true; changed; ) {
		changed = false;
		for (let leaf = 0; leaf < verts.length; leaf += 1) {
			if (adj[leaf].size !== 1 || verts[leaf].r > maxR || nearCorner(verts[leaf])) continue;
			const path = [leaf];
			let prev = -1, cur = leaf, length = 0, hitJunction = false;
			for (;;) {
				const next = [...adj[cur]].find((n) => n !== prev);
				if (next === undefined) break;
				length += Math.hypot(verts[next].x - verts[cur].x, verts[next].y - verts[cur].y);
				if (length > maxLength) break;
				if (adj[next].size >= 3) {
					hitJunction = true;
					break;
				}
				if (adj[next].size === 1) break; // a whole short stroke, not a hair
				path.push(next);
				prev = cur;
				cur = next;
			}
			if (!hitJunction) continue;
			for (const v of path) {
				for (const n of adj[v]) adj[n].delete(v);
				adj[v].clear();
			}
			changed = true;
		}
	}
};

/** Carry each convex corner's branch on to the corner itself, where the cut comes to a point. */
const extendToCorners = (verts: AxisVertex[], adj: Set<number>[], corners: Pt[], h: number) => {
	const leaves: number[] = [];
	verts.forEach((_, i) => {
		if (adj[i].size === 1) leaves.push(i);
	});
	const taken = new Set<number>();
	for (const c of corners) {
		let best = -1, bestDist = Infinity;
		for (const v of leaves) {
			if (taken.has(v)) continue;
			const d = Math.hypot(verts[v].x - c.x, verts[v].y - c.y);
			// The circle at the end of a corner's branch passes through the corner itself.
			if (Math.abs(d - verts[v].r) > 0.2 * h + 1e-4) continue;
			if (d < bestDist) {
				bestDist = d;
				best = v;
			}
		}
		if (best < 0) continue;
		taken.add(best);
		const id = verts.length;
		verts.push({ x: c.x, y: c.y, r: 0 });
		adj.push(new Set([best]));
		adj[best].add(id);
	}
};
