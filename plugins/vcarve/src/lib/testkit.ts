/** Helpers for the tests: shapes to carve, and a physical check of what a carve does to the surface. */

import { radiusForDepth, type Bit } from "./bit";
import type { CarvePlan, P3 } from "./carve";
import { shapeTester, type Ring, type Shape } from "./geom";

export const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
export const circle = (cx: number, cy: number, r: number, n = 240): Ring => Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((2 * Math.PI * i) / n), y: cy + r * Math.sin((2 * Math.PI * i) / n) }));
export const star = (): Ring => Array.from({ length: 10 }, (_, i) => {
	const r = i % 2 === 0 ? 20 : 8, a = Math.PI / 2 + (i * Math.PI) / 5;
	return { x: r * Math.cos(a), y: r * Math.sin(a) };
});
export const poly = (...c: [number, number][]): Ring => c.map(([x, y]) => ({ x, y }));

/** Walks along each cut in small steps. */
export const samples = (plan: CarvePlan, step = 0.05): P3[] => {
	const out: P3[] = [];
	for (const c of plan.chains) {
		out.push(c[0]);
		for (let i = 1; i < c.length; i += 1) {
			const n = Math.max(1, Math.ceil(Math.hypot(c[i].x - c[i - 1].x, c[i].y - c[i - 1].y, c[i].z - c[i - 1].z) / step));
			for (let k = 1; k <= n; k += 1) out.push({ x: c[i - 1].x + ((c[i].x - c[i - 1].x) * k) / n, y: c[i - 1].y + ((c[i].y - c[i - 1].y) * k) / n, z: c[i - 1].z + ((c[i].z - c[i - 1].z) * k) / n });
		}
	}
	return out;
};

export const distToRings = (x: number, y: number, rings: Ring[]): number => {
	let best = Infinity;
	for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i, i += 1) {
		const dx = r[i].x - r[j].x, dy = r[i].y - r[j].y, l2 = dx * dx + dy * dy;
		const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - r[j].x) * dx + (y - r[j].y) * dy) / l2));
		best = Math.min(best, Math.hypot(x - r[j].x - t * dx, y - r[j].y - t * dy));
	}
	return best;
};

/**
 * What the cut does to the surface: at each point the bit removes a disc as wide as the cone is
 * at that depth. Returns the worst overcut (how far a disc pokes past the shape's edge) and the
 * worst miss (how far from the cut some part of the shape is).
 */
export const surfaceCheck = (plan: CarvePlan, shapes: Shape[], bit: Bit, grid = 0.3) => {
	const pts = samples(plan, 0.04);
	const rings = shapes.flatMap((s) => [s.outer, ...s.holes]);
	let overcut = 0;
	for (const p of pts) overcut = Math.max(overcut, radiusForDepth(-p.z, bit) - distToRings(p.x, p.y, rings));
	const inside = shapeTester(rings);
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const r of rings) for (const p of r) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
	// Bucket the samples for speed.
	const cell = 2, buckets = new Map<string, P3[]>();
	for (const p of pts) { const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`; (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(p); }
	let miss = 0;
	for (let x = minX; x <= maxX; x += grid) for (let y = minY; y <= maxY; y += grid) {
		if (!inside(x, y) || distToRings(x, y, rings) < 0.05) continue;
		let best = Infinity;
		const reach = 16;
		for (let i = -reach; i <= reach; i += 1) for (let j = -reach; j <= reach; j += 1)
			for (const p of buckets.get(`${Math.floor(x / cell) + i},${Math.floor(y / cell) + j}`) ?? []) best = Math.min(best, Math.hypot(p.x - x, p.y - y) - radiusForDepth(-p.z, bit));
		miss = Math.max(miss, best);
	}
	return { overcut, miss };
};

