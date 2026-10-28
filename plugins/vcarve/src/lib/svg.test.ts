import { describe, expect, it } from "vitest";

import { planCarve } from "./carve";
import { boundsOf } from "./geom";
import { pathRings, svgShapes } from "./svg";
import { surfaceCheck } from "./testkit";

const bit = { angle: 60, diameter: 14, tip: 0, cuttingLength: null };

describe("svg paths", () => {
	it("a closed rectangle path becomes one outline", () => {
		const { rings, open } = pathRings("M0 0 H40 V10 H0 Z");
		expect(rings).toHaveLength(1);
		expect(rings[0]).toHaveLength(4);
		expect(open).toBe(0);
	});
	it("relative commands, shorthand curves and arcs all work", () => {
		const a = pathRings("m 0 0 h 20 v 20 h -20 z");
		expect(boundsOf(a.rings)).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 20 });
		const circle = pathRings("M10 0 A10 10 0 1 1 -10 0 A10 10 0 1 1 10 0 Z", "", 0.01);
		expect(circle.rings).toHaveLength(1);
		for (const p of circle.rings[0]) expect(Math.abs(Math.hypot(p.x, p.y) - 10)).toBeLessThan(0.02);
		const curve = pathRings("M0 0 C 10 0 20 10 20 20 S 10 40 0 40 Z");
		expect(curve.rings[0].length).toBeGreaterThan(10);
	});
	it("a path with a hole gives two outlines, which become one shape with a hole", () => {
		const art = svgShapes([{ d: "M0 0H30V30H0Z M10 10H20V20H10Z", transform: "" }]);
		expect(art.shapes).toHaveLength(1);
		expect(art.shapes[0].holes).toHaveLength(1);
	});
	it("open paths are counted and left out, since they have no inside", () => {
		const art = svgShapes([{ d: "M0 0 L10 10 L20 0", transform: "" }, { d: "M0 0H10V10H0Z", transform: "" }]);
		expect(art.open).toBe(1);
		expect(art.shapes).toHaveLength(1);
	});
	it("transforms apply, nested ones included", () => {
		const { rings } = pathRings("M0 0H10V10H0Z", "translate(100 50) scale(2)");
		expect(boundsOf(rings)).toEqual({ minX: 100, minY: 50, maxX: 120, maxY: 70 });
	});
	it("up is up: the page's y axis is flipped", () => {
		const art = svgShapes([{ d: "M0 0H10V30H0Z", transform: "" }]);
		const b = boundsOf(art.shapes.map((s) => s.outer));
		expect(b.maxY - b.minY).toBeCloseTo(30);
		expect(b.maxY).toBeCloseTo(0);
	});
});

describe("carving an svg shape", () => {
	it("a curvy blob with a hole: no overcut, nothing missed, within the limit", () => {
		const art = svgShapes([{ d: "M0 20 C 0 0, 40 0, 40 20 S 70 60, 40 60 S 0 50, 0 20 Z M12 25 C 12 15, 28 15, 28 25 S 12 35, 12 25 Z", transform: "scale(0.3)" }]);
		const plan = planCarve(art.shapes, bit, 12, "normal");
		expect(plan.tooWide).toHaveLength(0);
		for (const c of plan.chains) for (const p of c) expect(p.z).toBeGreaterThanOrEqual(-12);
		const { overcut, miss } = surfaceCheck(plan, art.shapes, bit, 0.5);
		expect(overcut).toBeLessThan(0.04);
		expect(miss).toBeLessThan(0.15);
	}, 60_000);
});
