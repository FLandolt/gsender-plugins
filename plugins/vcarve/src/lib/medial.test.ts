import { describe, expect, it } from "vitest";

import { buildShapes, type Ring, type Shape } from "./geom";
import { medialAxis } from "./medial";

const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const one = (rings: Ring[]): Shape => buildShapes(rings)[0];
const circle = (cx: number, cy: number, r: number, n = 200): Ring => Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((2 * Math.PI * i) / n), y: cy + r * Math.sin((2 * Math.PI * i) / n) }));

const degree = (a: ReturnType<typeof medialAxis>, i: number) => a.adj[i].length;
const maxR = (a: ReturnType<typeof medialAxis>) => Math.max(...a.verts.map((v) => v.r));

describe("medial axis", () => {
	it("a bar: a centre line at half the width, with a branch to each corner", () => {
		const axis = medialAxis(one([rect(0, 0, 40, 6)]), 0.2);
		expect(maxR(axis)).toBeCloseTo(3, 1);
		// The centre line runs along y = 3.
		const middle = axis.verts.filter((v) => v.r > 2.99);
		expect(middle.length).toBeGreaterThan(5);
		for (const v of middle) expect(v.y).toBeCloseTo(3, 1);
		// Four corners, each reached by a branch that ends exactly on it with radius 0.
		const tips = axis.verts.filter((v) => v.r === 0);
		expect(tips).toHaveLength(4);
		for (const c of [[0, 0], [40, 0], [40, 6], [0, 6]]) expect(tips.some((t) => Math.hypot(t.x - c[0], t.y - c[1]) < 1e-9)).toBe(true);
	});

	it("the radius is the true distance to the nearest edge", () => {
		const axis = medialAxis(one([rect(0, 0, 40, 6)]), 0.2);
		for (const v of axis.verts) {
			const d = Math.min(v.x, 40 - v.x, v.y, 6 - v.y);
			expect(Math.abs(v.r - d)).toBeLessThan(0.005);
		}
	});

	it("a square has a point in the middle and four diagonal branches", () => {
		const axis = medialAxis(one([rect(0, 0, 10, 10)]), 0.2);
		expect(axis.verts.filter((v) => v.r === 0)).toHaveLength(4);
		const centre = axis.verts.find((v) => Math.hypot(v.x - 5, v.y - 5) < 0.05)!;
		expect(centre.r).toBeCloseTo(5, 1);
		for (const v of axis.verts) if (v.r > 0) expect(Math.abs(Math.abs(v.x - 5) - Math.abs(v.y - 5))).toBeLessThan(0.05);
	});

	it("a ring (a hole) has a closed centre line and never goes inside the hole or outside the ring", () => {
		const axis = medialAxis(one([circle(0, 0, 10), circle(0, 0, 6)]), 0.2);
		const ring = axis.verts;
		expect(ring.length).toBeGreaterThan(50);
		for (const v of ring) {
			expect(Math.hypot(v.x, v.y)).toBeCloseTo(8, 1);
			expect(v.r).toBeCloseTo(2, 1);
			expect(degree(axis, ring.indexOf(v))).toBe(2);
		}
		expect(axis.corners).toHaveLength(0);
	});

	it("a disc has one centre point with no spurious branches", () => {
		const axis = medialAxis(one([circle(0, 0, 10)]), 0.2);
		const long = axis.verts.filter((v) => v.r < 9.5 && Math.hypot(v.x, v.y) > 1);
		expect(long).toHaveLength(0);
		expect(maxR(axis)).toBeCloseTo(10, 1);
	});

	it("an L has a corner bend and sharp tips at its convex corners only", () => {
		const L: Ring = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 30 }, { x: 0, y: 30 }];
		const axis = medialAxis(one([L]), 0.2);
		// Five convex corners (the sixth is the inside corner of the L).
		expect(axis.verts.filter((v) => v.r === 0)).toHaveLength(5);
		expect(axis.corners).toHaveLength(5);
	});

	it("a thin stroke keeps its whole length", () => {
		const axis = medialAxis(one([rect(0, 0, 50, 0.8)]), 0.1);
		const xs = axis.verts.filter((v) => v.r > 0.35).map((v) => v.x);
		expect(Math.min(...xs)).toBeLessThan(1);
		expect(Math.max(...xs)).toBeGreaterThan(49);
	});

	it("a five-pointed star reaches all five tips", () => {
		const star: Ring = [];
		for (let i = 0; i < 10; i += 1) {
			const r = i % 2 === 0 ? 20 : 8;
			const a = Math.PI / 2 + (i * Math.PI) / 5;
			star.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
		}
		const axis = medialAxis(one([star]), 0.2);
		const tips = axis.verts.filter((v) => v.r === 0);
		expect(tips).toHaveLength(5);
		for (let i = 0; i < 10; i += 2) expect(tips.some((t) => Math.hypot(t.x - star[i].x, t.y - star[i].y) < 1e-9)).toBe(true);
	});

	it("is connected: every vertex has a neighbour", () => {
		const axis = medialAxis(one([rect(0, 0, 40, 6)]), 0.2);
		axis.verts.forEach((_, i) => expect(degree(axis, i)).toBeGreaterThan(0));
	});
});
