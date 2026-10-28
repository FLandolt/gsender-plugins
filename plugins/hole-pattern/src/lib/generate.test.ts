import { describe, expect, it } from "vitest";

import { parsePath } from "@shared/path";

import { generateGcode, holeCentres, zLevels } from "./generate";
import { defaultParams, type Params, validate } from "./params";

describe("pattern", () => {
	it("1x1 is a single hole at the origin", () => {
		expect(holeCentres(defaultParams())).toEqual([{ x: 0, y: 0 }]);
	});
	it("1x2 goes along Y", () => {
		const c = holeCentres({ ...defaultParams(), countX: 1, countY: 2, spacingY: 15 });
		expect(c).toEqual([{ x: 0, y: 0 }, { x: 0, y: 15 }]);
	});
	it("serpentine visits every cell once", () => {
		const c = holeCentres({ ...defaultParams(), countX: 3, countY: 2 });
		expect(c).toHaveLength(6);
		expect(new Set(c.map((p) => `${p.x},${p.y}`)).size).toBe(6);
	});
});

describe("zero corner", () => {
	it("lower-right extends in -X and +Y, upper-left in +X and -Y, upper-right in -X and -Y", () => {
		const grid = { ...defaultParams(), countX: 3, countY: 2, spacingX: 20, spacingY: 15 };
		const xs = (o: Params["origin"]) => holeCentres({ ...grid, origin: o }).map((c) => c.x);
		const ys = (o: Params["origin"]) => holeCentres({ ...grid, origin: o }).map((c) => c.y);
		expect(Math.min(...xs("lower-right"))).toBe(-40);
		expect(Math.max(...xs("lower-right"))).toBe(0);
		expect(Math.min(...ys("lower-right"))).toBe(0);
		expect(Math.max(...ys("upper-left"))).toBe(0);
		expect(Math.min(...ys("upper-left"))).toBe(-15);
		expect(Math.max(...xs("upper-left"))).toBe(40);
		expect(Math.min(...xs("upper-right"))).toBe(-40);
		expect(Math.min(...ys("upper-right"))).toBe(-15);
	});
	it("the first hole is always at X0 Y0, and holes are never visited twice", () => {
		for (const origin of ["lower-left", "lower-right", "upper-left", "upper-right"] as const) {
			const c = holeCentres({ ...defaultParams(), countX: 3, countY: 3, origin });
			expect(Math.abs(c[0].x) + Math.abs(c[0].y)).toBe(0);
			expect(new Set(c.map((q) => `${q.x},${q.y}`)).size).toBe(9);
		}
	});
	it("the G-code starts the first hole at 0,0 whatever the corner", () => {
		const g = generateGcode({ ...defaultParams(), countX: 2, origin: "upper-right" });
		expect(g).toMatch(/^G0 X0 Y0$/m);
		expect(g).toMatch(/^G0 X-20 Y0$/m);
	});
});

describe("toolpath", () => {
	it("last level hits full depth", () => {
		const p = defaultParams();
		expect(zLevels(p.depth, p.stepdown).at(-1)).toBe(-p.depth);
	});
	it("tool-sized hole is plunge only", () => {
		const g = generateGcode({ ...defaultParams(), holeDiameter: defaultParams().toolDiameter });
		expect(g).not.toMatch(/G1 X/);
	});
	it("returns to the middle between levels", () => {
		const p = defaultParams();
		const rh = String(p.toolDiameter * 0.375).replace(".", "\\.");
		const back = [...generateGcode(p).matchAll(new RegExp(`^G1 X${rh} Y0$`, "gm"))];
		// 5 mm depth / 2 mm stepdown = 3 levels → 2 returns to the middle.
		expect(back).toHaveLength(zLevels(p.depth, p.stepdown).length - 1);
	});
	it("with arcs off, emits only G0/G1 plus the GRBL-safe setup words", () => {
		const g = generateGcode({ ...defaultParams(), countX: 2, countY: 2, useArcs: false });
		const words = new Set([...g.replace(/\([^)]*\)/g, "").matchAll(/\b([GM]\d+)\b/g)].map((m) => m[1]));
		expect([...words].every((w) => ["G0", "G1", "G4", "G17", "G21", "G90", "G94", "M3", "M5", "M30"].includes(w))).toBe(true);
	});
	it.each([true, false])("spirals down: Z never rises while cutting and reaches full depth (arcs %s)", (useArcs) => {
		const p = { ...defaultParams(), useArcs };
		const zs = parsePath(generateGcode(p)).filter((s) => s.kind !== "rapid").map((s) => s.to.z);
		expect(zs.length).toBeGreaterThan(0);
		for (let i = 1; i < zs.length; i += 1) expect(zs[i]).toBeLessThanOrEqual(zs[i - 1] + 1e-9);
		expect(Math.min(...zs)).toBeCloseTo(-p.depth);
	});
	it("never exceeds the hole radius", () => {
		const p = { ...defaultParams(), useArcs: false };
		const g = generateGcode(p);
		const limit = (p.holeDiameter - p.toolDiameter) / 2 + 1e-3;
		for (const m of g.matchAll(/^G1 X(-?[\d.]+) Y(-?[\d.]+)/gm)) {
			expect(Math.hypot(Number(m[1]), Number(m[2]))).toBeLessThanOrEqual(limit);
		}
	});
});

describe("validate", () => {
	it("rejects hole smaller than tool and overlapping spacing", () => {
		expect(validate({ ...defaultParams(), holeDiameter: 2 })).not.toHaveLength(0);
		expect(validate({ ...defaultParams(), countX: 2, spacingX: 5 })).not.toHaveLength(0);
		expect(validate(defaultParams())).toHaveLength(0);
	});
});
