import { describe, expect, it } from "vitest";

import { parsePath } from "@shared/path";
import { toGray, type RawImage } from "@shared/picture";

import { generateGcode } from "./generate";
import { check, defaultParams, type Params } from "./params";
import { planPicturePocket } from "./picture";

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

// A black disc of radius 30 mm in the middle of a 100 × 100 mm picture.
const disc = toGray(picture(200, 200, (x, y) => (Math.hypot(x + 0.5 - 100, y + 0.5 - 100) < 60 ? 0 : 255)));
const job = (patch: Partial<Params> = {}): Params => ({ ...defaultParams(), shape: "picture", size: 100, depth: 5, ...patch });

describe("picture pocket", () => {
	const p = job({ origin: "center" });
	const plan = planPicturePocket(p, disc);
	const gcode = generateGcode(p, { plan, name: "disc" });
	const segs = parsePath(gcode);

	it("cuts in levels no deeper than the stepdown", () => {
		expect(plan.passes.map((pass) => pass.depth)).toEqual([5 / 3, 10 / 3, 5]);
	});
	it("keeps the whole bit inside the shape", () => {
		const r = p.toolDiameter / 2;
		for (const s of segs) if (s.to.z < 0) expect(Math.hypot(s.to.x, s.to.y) + r).toBeLessThanOrEqual(30 + 0.6);
	});
	it("clears nearly all of it and reaches the full depth", () => {
		expect(plan.missed).toBeLessThan(0.02);
		expect(Math.min(...segs.map((s) => s.to.z))).toBeCloseTo(-5);
	});
	it("ramps in instead of plunging straight down into the material", () => {
		const plunges = segs.filter((s) => s.kind !== "rapid" && s.from.x === s.to.x && s.from.y === s.to.y && s.to.z < s.from.z && s.from.z < 0);
		expect(plunges).toHaveLength(0);
	});
	it("an empty picture says so", () => {
		expect(planPicturePocket(job(), toGray(picture(40, 40, () => 255))).empty).toBe(true);
	});
	it("a picture needs a size", () => {
		expect(check(job({ size: 0, depth: 5 })).errors).not.toHaveLength(0);
		expect(check(job()).errors).toHaveLength(0);
	});
});

describe("rings from the inside out", () => {
	const p = job({ origin: "center" });
	const plan = planPicturePocket(p, disc);

	it("clears each level of a disc in one stroke, without lifting", () => {
		for (const pass of plan.passes) expect(pass.strokes).toHaveLength(1);
	});
	it("starts near the middle and ends on the wall", () => {
		const stroke = plan.passes[0].strokes[0];
		const r = (pt: { x: number; y: number }) => Math.hypot(pt.x - 50, pt.y - 50);
		expect(r(stroke[0])).toBeLessThan(5);
		expect(r(stroke[stroke.length - 1])).toBeCloseTo(30 - p.toolDiameter / 2, 0);
	});
	it("still clears everything with a large stepover", () => {
		const wide = planPicturePocket(job({ stepover: 0.95 }), disc);
		expect(wide.missed).toBeLessThan(0.02);
	});
	it("goes round an island instead of over it", () => {
		const ring = toGray(picture(200, 200, (x, y) => {
			const d = Math.hypot(x + 0.5 - 100, y + 0.5 - 100);
			return d < 70 && d > 20 ? 0 : 255;
		}));
		const q = planPicturePocket(job({ origin: "center" }), ring);
		const r = p.toolDiameter / 2;
		for (const pass of q.passes)
			for (const pt of pass.strokes.flat()) expect(Math.hypot(pt.x - 50, pt.y - 50)).toBeGreaterThanOrEqual(10 + r - 0.6);
		expect(q.missed).toBeLessThan(0.02);
	});
});

