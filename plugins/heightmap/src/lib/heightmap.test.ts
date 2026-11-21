import { describe, expect, it } from "vitest";

import { parsePath } from "@shared/path";

import { generateGcode } from "./generate";
import { distanceToOutside, levelMap, passDepths, pictureSize, planCut, toGray, type Grid, type PlanOptions, type RawImage } from "./heightmap";
import { check, defaultParams, levelDepths, type Params } from "./params";

/** A picture from a grey-level function of the pixel position (0 = black, 255 = white). */
const picture = (w: number, h: number, grey: (x: number, y: number) => number): RawImage => {
	const data = new Uint8ClampedArray(w * h * 4);
	for (let y = 0; y < h; y += 1)
		for (let x = 0; x < w; x += 1) {
			const v = grey(x, y), i = 4 * (y * w + x);
			data[i] = data[i + 1] = data[i + 2] = v;
			data[i + 3] = 255;
		}
	return { width: w, height: h, data };
};

const job = (patch: Partial<Params> = {}): Params => ({ ...defaultParams(), depth: 6, ...patch });
const options = (p: Params, size: { width: number; height: number }): PlanOptions => ({ ...p, ...size });

describe("levels", () => {
	const grid = (values: number[]): Grid => ({ w: values.length, h: 1, cell: 1, x0: 0, y0: 0, v: Float32Array.from(values) });
	it("white stays at the top, black goes to the bottom, grey in between", () => {
		expect([...levelMap(grid([255, 128, 0]), 2, false)]).toEqual([0, 1, 2]);
	});
	it("invert swaps them", () => {
		expect([...levelMap(grid([255, 128, 0]), 2, true)]).toEqual([2, 1, 0]);
	});
	it("two steps give three levels: top, middle and bottom", () => {
		expect(levelDepths(10, 2)).toEqual([0, 5, 10]);
	});
	it("a step deeper than the stepdown is cut in several even passes", () => {
		const d = passDepths(10, 2, 2);
		expect(d).toHaveLength(6);
		expect(d).toContain(5);
		expect(d.at(-1)).toBe(10);
		for (let i = 1; i < d.length; i += 1) expect(d[i] - d[i - 1]).toBeLessThanOrEqual(2 + 1e-9);
	});
	it("treats colour as grey and transparency as white", () => {
		const g = toGray({ width: 2, height: 1, data: [255, 0, 0, 255, 0, 0, 0, 0] });
		expect(g.v[0]).toBeCloseTo(0.299 * 255);
		expect(g.v[1]).toBe(255);
	});
	it("keeps the picture's shape when one side is set", () => {
		expect(pictureSize({ w: 200, h: 100 }, "width", 80)).toEqual({ width: 80, height: 40 });
		expect(pictureSize({ w: 200, h: 100 }, "height", 30)).toEqual({ width: 60, height: 30 });
	});
});

describe("distance transform", () => {
	it("measures to the nearest outside cell, the edge included", () => {
		const mask = new Uint8Array(7 * 7).fill(1);
		const d = distanceToOutside(mask, 7, 7);
		expect(d[3 * 7 + 3]).toBeCloseTo(4);
		expect(d[0]).toBeCloseTo(1);
	});
});

describe("plan", () => {
	// Left half black (cut), right half white (stays at the top): 100 × 50 mm.
	const half = toGray(picture(200, 100, (x) => (x < 100 ? 0 : 255)));
	const p = job({ steps: 1, smoothing: 0 });
	const size = pictureSize(half, "width", 100);
	const plan = planCut(half, options(p, size));
	const pts = plan.passes.flatMap((pass) => pass.strokes.flat());

	it("never lets the bit's edge cross into the higher half", () => {
		const r = p.toolDiameter / 2;
		for (const pt of pts) expect(pt.x + r).toBeLessThanOrEqual(50 + plan.grid.cell);
		expect(Math.max(...pts.map((pt) => pt.x))).toBeGreaterThan(50 - r - 2 * plan.grid.cell);
	});
	it("stays inside the picture", () => {
		const r = p.toolDiameter / 2;
		for (const pt of pts) {
			expect(pt.x).toBeGreaterThanOrEqual(r - plan.grid.cell);
			expect(pt.y).toBeGreaterThanOrEqual(r - plan.grid.cell);
			expect(pt.y).toBeLessThanOrEqual(size.height - r + plan.grid.cell);
		}
	});
	it("reaches the bottom on about half the picture", () => {
		expect(plan.share[1]).toBeGreaterThan(0.45);
		expect(plan.share[1]).toBeLessThan(0.55);
	});
	it("cuts in passes no deeper than the stepdown, down to the full depth", () => {
		expect(plan.passes.map((pass) => pass.depth)).toEqual([2, 4, 6]);
	});

	it("three bands of grey give three levels in about equal parts", () => {
		const bands = toGray(picture(300, 100, (x) => (x < 100 ? 0 : x < 200 ? 128 : 255)));
		const q = planCut(bands, options(job({ steps: 2, toolDiameter: 2 }), pictureSize(bands, "width", 150)));
		for (const s of q.share) expect(s).toBeGreaterThan(0.25);
	});
	it("reports areas narrower than the bit as not reached", () => {
		const line = toGray(picture(200, 100, (x) => (x >= 98 && x <= 101 ? 0 : 255)));
		const q = planCut(line, options(job({ steps: 1, toolDiameter: 6, smoothing: 0 }), pictureSize(line, "width", 100)));
		expect(q.missed).toBeGreaterThan(0);
		expect(q.passes.every((pass) => pass.strokes.length === 0)).toBe(true);
	});
});

describe("G-code", () => {
	const img = toGray(picture(120, 80, (x, y) => (Math.hypot(x - 60, y - 40) < 30 ? 0 : 255)));
	const p = job({ steps: 2, depth: 5 });
	const size = pictureSize(img, "width", 90);
	const plan = planCut(img, options(p, size));
	const code = generateGcode(p, plan, "test");

	it("is plain GRBL G-code with no NaN", () => {
		expect(code).not.toMatch(/NaN|undefined|Infinity/);
		expect(code.split("\n").filter((l) => l && !l.startsWith("(")).every((l) => /^(G[0-4]|G2[01]|G9[04]|G17|M[35]|M30)\b/.test(l))).toBe(true);
	});
	it("reaches the full depth and never goes deeper", () => {
		const zs = parsePath(code).map((s) => s.to.z);
		expect(Math.min(...zs)).toBeCloseTo(-5);
	});
	it("only cuts at pass depths", () => {
		const depths = new Set(plan.passes.map((pass) => Number((-pass.depth).toFixed(3))));
		for (const s of parsePath(code)) if (s.kind !== "rapid" && s.from.z === s.to.z && s.to.z < 0) expect(depths.has(Number(s.to.z.toFixed(3)))).toBe(true);
	});
	it("puts X0 Y0 where asked", () => {
		const centred = generateGcode({ ...p, origin: "center" }, plan, "test");
		const xs = parsePath(centred).map((s) => s.to.x);
		expect(Math.min(...xs)).toBeLessThan(0);
		expect(Math.max(...xs)).toBeGreaterThan(0);
	});
});

describe("check", () => {
	it("starts with no depth and a 4 mm bit, and won't run until a depth is entered", () => {
		expect(defaultParams().depth).toBe(0);
		expect(defaultParams().toolDiameter).toBe(4);
		expect(check(defaultParams()).errors).not.toHaveLength(0);
		expect(check(job()).errors).toHaveLength(0);
	});
	it("rejects a step count out of range", () => {
		expect(check(job({ steps: 0 })).errors).not.toHaveLength(0);
		expect(check(job({ steps: 2.5 })).errors).not.toHaveLength(0);
	});
});

describe("contrast", () => {
	it("stretches a picture that never reaches black or white over every level", () => {
		const g: Grid = { w: 3, h: 1, cell: 1, x0: 0, y0: 0, v: Float32Array.from([200, 150, 100]) };
		expect([...levelMap(g, 2, false)]).toEqual([0, 1, 2]);
	});
	it("leaves a flat picture at the top", () => {
		const g: Grid = { w: 3, h: 1, cell: 1, x0: 0, y0: 0, v: Float32Array.from([90, 90, 90]) };
		expect([...levelMap(g, 2, false)]).toEqual([0, 0, 0]);
	});
});
