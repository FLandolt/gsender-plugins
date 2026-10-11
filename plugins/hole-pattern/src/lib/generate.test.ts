import { describe, expect, it } from "vitest";

import { generateGcode, holeCentres, zLevels } from "./generate";
import { defaultParams, validate } from "./params";

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

describe("toolpath", () => {
	it("last level hits full depth", () => {
		const p = defaultParams();
		expect(zLevels(p.depth, p.stepdown).at(-1)).toBe(-p.depth);
	});
	it("tool-sized hole is plunge only", () => {
		const g = generateGcode({ ...defaultParams(), holeDiameter: 3.175 });
		expect(g).not.toMatch(/G1 X/);
	});
	it("returns to the middle between levels", () => {
		const p = defaultParams();
		const back = [...generateGcode(p).matchAll(/^G1 X0\.79\d Y0$/gm)];
		// 5 mm depth / 2 mm stepdown = 3 levels → 2 returns to the middle.
		expect(back).toHaveLength(zLevels(p.depth, p.stepdown).length - 1);
	});
	it("emits only GRBL-safe words", () => {
		const g = generateGcode({ ...defaultParams(), countX: 2, countY: 2 });
		const words = new Set([...g.replace(/\([^)]*\)/g, "").matchAll(/\b([GM]\d+)\b/g)].map((m) => m[1]));
		expect([...words].every((w) => ["G0", "G1", "G4", "G17", "G21", "G90", "G94", "M3", "M5", "M30"].includes(w))).toBe(true);
	});
	it("spirals down: Z never rises while cutting and reaches full depth", () => {
		const p = defaultParams();
		const zs = [...generateGcode(p).matchAll(/^G1 X\S+ Y\S+ Z(-?[\d.]+)/gm)].map((m) => Number(m[1]));
		expect(zs.length).toBeGreaterThan(0);
		for (let i = 1; i < zs.length; i += 1) expect(zs[i]).toBeLessThanOrEqual(zs[i - 1] + 1e-9);
		expect(Math.min(...zs)).toBeCloseTo(-p.depth);
	});
	it("never exceeds the hole radius", () => {
		const p = defaultParams();
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
