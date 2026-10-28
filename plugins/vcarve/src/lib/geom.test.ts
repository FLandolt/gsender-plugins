import { describe, expect, it } from "vitest";

import { boundsOf, buildShapes, flattenCubic, pointInRing, ringArea, shapeTester, simplifyOpen3, simplifyRing, turnAngles, type Ring } from "./geom";

const square = (x: number, y: number, s: number): Ring => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];

describe("rings", () => {
	it("area is signed by direction", () => {
		expect(ringArea(square(0, 0, 2))).toBeCloseTo(4);
		expect(ringArea([...square(0, 0, 2)].reverse())).toBeCloseTo(-4);
	});
	it("point in ring", () => {
		expect(pointInRing({ x: 1, y: 1 }, square(0, 0, 2))).toBe(true);
		expect(pointInRing({ x: 3, y: 1 }, square(0, 0, 2))).toBe(false);
	});
	it("turn angles of a square are all 90°", () => {
		for (const a of turnAngles(square(0, 0, 2))) expect(a).toBeCloseTo(Math.PI / 2);
	});
});

describe("buildShapes", () => {
	it("a hole belongs to the shape around it, and an island in the hole is its own shape", () => {
		const shapes = buildShapes([square(0, 0, 20), square(4, 4, 12), square(8, 8, 4)]);
		expect(shapes).toHaveLength(2);
		const big = shapes.find((s) => ringArea(s.outer) > 100)!;
		expect(big.holes).toHaveLength(1);
		expect(Math.abs(ringArea(big.holes[0]))).toBeCloseTo(144);
		expect(shapes.find((s) => s !== big)!.holes).toHaveLength(0);
	});
	it("outsides run counter-clockwise and holes clockwise", () => {
		const [s] = buildShapes([[...square(0, 0, 20)].reverse(), square(4, 4, 6)]);
		expect(ringArea(s.outer)).toBeGreaterThan(0);
		expect(ringArea(s.holes[0])).toBeLessThan(0);
	});
	it("drops degenerate outlines", () => {
		expect(buildShapes([[{ x: 0, y: 0 }, { x: 1, y: 1 }], square(0, 0, 0)])).toHaveLength(0);
	});
	it("two separate outlines are two shapes", () => {
		expect(buildShapes([square(0, 0, 5), square(10, 0, 5)])).toHaveLength(2);
	});
});

describe("shapeTester", () => {
	it("agrees with a plain even-odd test, holes included", () => {
		const rings = [square(0, 0, 20), square(5, 5, 10)];
		const test = shapeTester(rings);
		for (let x = -2; x <= 22; x += 1.3) for (let y = -2; y <= 22; y += 1.7) {
			const plain = rings.filter((r) => pointInRing({ x, y }, r)).length % 2 === 1;
			expect(test(x, y)).toBe(plain);
		}
	});
});

describe("simplify and flatten", () => {
	it("simplifying keeps the corners of a finely sampled square", () => {
		const fine: Ring = [];
		for (let i = 0; i < 40; i += 1) fine.push({ x: i / 4, y: 0 });
		for (let i = 0; i < 40; i += 1) fine.push({ x: 10, y: i / 4 });
		for (let i = 0; i < 40; i += 1) fine.push({ x: 10 - i / 4, y: 10 });
		for (let i = 0; i < 40; i += 1) fine.push({ x: 0, y: 10 - i / 4 });
		const s = simplifyRing(fine, 0.01);
		expect(s.length).toBe(4);
		const b = boundsOf([s]);
		expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([0, 0, 10, 10]);
	});
	it("forced points survive simplification", () => {
		const pts = Array.from({ length: 11 }, (_, i) => ({ x: i, y: 0, z: 0 }));
		expect(simplifyOpen3(pts, 0.1, new Set([5]))).toHaveLength(3);
	});
	it("a flattened quarter circle stays within the tolerance of the circle", () => {
		const k = 0.5522847498;
		const pts = flattenCubic({ x: 10, y: 0 }, { x: 10, y: 10 * k }, { x: 10 * k, y: 10 }, { x: 0, y: 10 }, 0.01);
		for (const p of pts) expect(Math.abs(Math.hypot(p.x, p.y) - 10)).toBeLessThan(0.012);
		expect(pts.at(-1)).toEqual({ x: 0, y: 10 });
	});
});
