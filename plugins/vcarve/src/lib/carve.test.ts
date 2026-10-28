import { describe, expect, it } from "vitest";

import { depthForRadius, type Bit } from "./bit";
import { planCarve, type P3 } from "./carve";
import { buildShapes, pointInRing, type Ring, type Shape } from "./geom";
import { circle, poly, rect, samples, star, surfaceCheck } from "./testkit";

const bit60: Bit = { angle: 60, diameter: 12, tip: 0, cuttingLength: null };
const bit90: Bit = { angle: 90, diameter: 10, tip: 0, cuttingLength: null };

const shapesOf = (...rings: Ring[]): Shape[] => buildShapes(rings);

const cases: { name: string; rings: Ring[]; bit: Bit; maxDepth: number }[] = [
	{ name: "bar", rings: [rect(0, 0, 40, 6)], bit: bit60, maxDepth: 6 },
	{ name: "L", rings: [poly([0, 0], [30, 0], [30, 6], [6, 6], [6, 30], [0, 30])], bit: bit60, maxDepth: 8 },
	{ name: "T", rings: [poly([0, 24], [18, 24], [18, 0], [24, 0], [24, 24], [42, 24], [42, 30], [0, 30])], bit: bit60, maxDepth: 8 },
	{ name: "star", rings: [star()], bit: bit60, maxDepth: 14 },
	{ name: "thin strokes", rings: [rect(0, 0, 50, 0.8), rect(0, 5, 0.8, 30)], bit: bit60, maxDepth: 6 },
	{ name: "ring (O) with a hole", rings: [circle(0, 0, 14), circle(0, 0, 8)], bit: bit60, maxDepth: 6 },
	{ name: "disc", rings: [circle(0, 0, 6)], bit: bit90, maxDepth: 6 },
	{ name: "island in a hole", rings: [circle(0, 0, 20), circle(0, 0, 14), circle(0, 0, 4)], bit: bit60, maxDepth: 8 },
];

describe.each(cases)("planCarve: $name", ({ rings, bit, maxDepth }) => {
	const shapes = shapesOf(...rings);
	const plan = planCarve(shapes, bit, maxDepth, "normal");

	it("has no too-wide places and stays within the allowed depth", () => {
		expect(plan.tooWide).toHaveLength(0);
		expect(plan.chains.length).toBeGreaterThan(0);
		for (const p of samples(plan)) expect(p.z).toBeGreaterThanOrEqual(-maxDepth - 1e-12);
		for (const p of samples(plan)) expect(p.z).toBeLessThanOrEqual(0);
		expect(plan.deepestNeeded).toBeLessThanOrEqual(maxDepth);
	});

	it("never cuts past the edge of the shape, and cuts all of it", () => {
		const { overcut, miss } = surfaceCheck(plan, shapes, bit);
		expect(overcut).toBeLessThan(0.03);
		expect(miss).toBeLessThan(0.1);
	});
});

describe("depth follows the width", () => {
	it("a 6 mm bar with a 60° bit is cut 3 / tan(30°) = 5.196 mm deep along its middle", () => {
		const plan = planCarve(shapesOf(rect(0, 0, 40, 6)), bit60, 6, "normal");
		const deepest = Math.max(...samples(plan).map((p) => -p.z));
		expect(deepest).toBeCloseTo(3 / Math.tan(Math.PI / 6), 1);
		expect(plan.deepestNeeded).toBeCloseTo(3 / Math.tan(Math.PI / 6), 1);
	});
	it("a wider angle cuts shallower", () => {
		const a = planCarve(shapesOf(rect(0, 0, 40, 6)), { ...bit60, angle: 90 }, 6, "normal");
		expect(a.deepestNeeded).toBeCloseTo(3, 1);
	});
	it("a flat tip makes the cut shallower by half its width", () => {
		const flat = planCarve(shapesOf(rect(0, 0, 40, 6)), { ...bit60, tip: 1 }, 6, "normal");
		expect(flat.deepestNeeded).toBeCloseTo((3 - 0.5) / Math.tan(Math.PI / 6), 1);
		expect(depthForRadius(0.5, { ...bit60, tip: 1 })).toBe(0);
	});
	it("tapers to the surface at the sharp corners", () => {
		const plan = planCarve(shapesOf(rect(0, 0, 40, 6)), bit60, 6, "normal");
		const surface = plan.chains.flatMap((c) => [c[0], c[c.length - 1]]).filter((p) => p.z === 0);
		for (const c of [[0, 0], [40, 0], [40, 6], [0, 6]]) expect(surface.some((p) => Math.hypot(p.x - c[0], p.y - c[1]) < 1e-9)).toBe(true);
	});
});

describe("the depth limit", () => {
	const wide = shapesOf(rect(0, 0, 40, 20));
	it("reports shapes too wide for the bit at the allowed depth: where, how deep, and how many places", () => {
		const plan = planCarve(wide, bit60, 6, "normal");
		// A 20 mm wide bar needs 10 / tan(30°) = 17.3 mm.
		expect(plan.tooWide.length).toBeGreaterThanOrEqual(1);
		const worst = plan.tooWide[0];
		expect(worst.need).toBeCloseTo(10 / Math.tan(Math.PI / 6), 1);
		expect(worst.width).toBeCloseTo(20, 0);
		expect(worst.y).toBeCloseTo(10, 0);
		expect(plan.deepestNeeded).toBeGreaterThan(6);
	});
	it("never goes deeper than the limit, even when the shape needs more", () => {
		const plan = planCarve(wide, bit60, 6, "normal");
		expect(Math.min(...samples(plan).map((p) => p.z))).toBeGreaterThanOrEqual(-6);
		for (const maxDepth of [0.5, 1, 3, 6]) {
			const p = planCarve(wide, bit60, maxDepth, "draft");
			for (const c of p.chains) for (const q of c) expect(q.z).toBeGreaterThanOrEqual(-maxDepth);
		}
	});
	it("counts separate places separately", () => {
		const two = shapesOf(rect(0, 0, 40, 20), rect(100, 0, 140, 20));
		expect(planCarve(two, bit60, 6, "normal").tooWide.length).toBeGreaterThanOrEqual(2);
	});
	it("a shape that fits has none", () => {
		expect(planCarve(shapesOf(rect(0, 0, 40, 6)), bit60, 6, "normal").tooWide).toHaveLength(0);
	});
});

describe("features thinner than the tip", () => {
	it("are reported when the tip is wider than the stroke, and not otherwise", () => {
		const hair = shapesOf(rect(0, 0, 40, 0.3));
		expect(planCarve(hair, { ...bit60, tip: 0.5 }, 6, "fine").thin.length).toBeGreaterThanOrEqual(1);
		expect(planCarve(hair, { ...bit60, tip: 0 }, 6, "fine").thin).toHaveLength(0);
		expect(planCarve(shapesOf(rect(0, 0, 40, 6)), { ...bit60, tip: 0.5 }, 6, "fine").thin).toHaveLength(0);
	});
	it("are not cut at all (nothing to cut with a tip that wide)", () => {
		const hair = shapesOf(rect(0, 0, 40, 0.3));
		expect(planCarve(hair, { ...bit60, tip: 0.5 }, 6, "fine").chains).toHaveLength(0);
	});
});

describe("path order", () => {
	it("a bar is cut in as few chains as it has pairs of ends, with no lift inside a stroke", () => {
		const plan = planCarve(shapesOf(rect(0, 0, 40, 6)), bit60, 6, "normal");
		// Four corner tips and one junction at each end: the centre line plus two diagonals each end.
		expect(plan.chains.length).toBeLessThanOrEqual(3);
	});
	it("every cut starts on the surface or in a groove that is already cut, apart from isolated rings and points", () => {
		const shapes = shapesOf(rect(0, 0, 50, 8), poly([0, 24], [18, 24], [18, 0], [24, 0], [24, 24], [42, 24], [42, 30], [0, 30]));
		const plan = planCarve(shapes, bit60, 8, "normal");
		const cut: P3[] = [];
		for (const c of plan.chains) {
			const start = c[0];
			const onSurface = start.z > -0.05;
			const inGroove = cut.some((p) => Math.hypot(p.x - start.x, p.y - start.y) < 0.2 && Math.abs(p.z - start.z) < 0.2);
			expect(onSurface || inGroove).toBe(true);
			cut.push(...samples({ ...plan, chains: [c] }, 0.1));
		}
	});
	it("a disc is a single plunge at its centre", () => {
		const plan = planCarve(shapesOf(circle(0, 0, 6)), bit90, 6, "normal");
		expect(plan.chains.length).toBe(1);
		const c = plan.chains[0];
		expect(Math.hypot(c[0].x, c[0].y)).toBeLessThan(0.1);
		expect(c[0].z).toBeCloseTo(-6, 0);
	});
	it("a ring (an O) is one closed cut", () => {
		const plan = planCarve(shapesOf(circle(0, 0, 14), circle(0, 0, 8)), bit60, 8, "normal");
		expect(plan.chains.length).toBe(1);
		const c = plan.chains[0];
		expect(Math.hypot(c[0].x - c.at(-1)!.x, c[0].y - c.at(-1)!.y)).toBeLessThan(0.3);
	});
});

describe("holes and islands", () => {
	it("the inside of an O is left uncut, and so is the gap around an island", () => {
		const shapes = shapesOf(circle(0, 0, 20), circle(0, 0, 14), circle(0, 0, 4));
		const plan = planCarve(shapes, bit60, 8, "normal");
		for (const p of samples(plan)) {
			const d = Math.hypot(p.x, p.y);
			// Either in the outer ring (between 14 and 20) or in the island (below 4): never in the hole.
			expect(d > 14 - 1e-6 || d < 4 + 1e-6).toBe(true);
			const inHole = pointInRing(p, circle(0, 0, 14)) && !pointInRing(p, circle(0, 0, 4));
			expect(inHole).toBe(false);
		}
	});
});

describe("quality", () => {
	it("finer quality makes a longer, smoother path with the same depth", () => {
		const shapes = shapesOf(circle(0, 0, 14), circle(0, 0, 8));
		const draft = planCarve(shapes, bit60, 8, "draft");
		const fine = planCarve(shapes, bit60, 8, "fine");
		expect(fine.chains.flat().length).toBeGreaterThan(draft.chains.flat().length);
		expect(fine.deepestNeeded).toBeCloseTo(draft.deepestNeeded, 1);
	});
});
