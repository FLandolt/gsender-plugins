import { describe, expect, it } from "vitest";

import { parsePath } from "@shared/path";
import { toGray, type RawImage } from "@shared/picture";

import { generateGcode } from "./generate";
import { defaultParams, type Params } from "./params";
import { pictureOutlines } from "./picture";

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

// A black disc of radius 30 mm in the middle of a 100 × 100 mm white picture (2 px per mm).
const disc = toGray(picture(200, 200, (x, y) => (Math.hypot(x + 0.5 - 100, y + 0.5 - 100) < 60 ? 0 : 255)));
const job = (patch: Partial<Params> = {}): Params => ({ ...defaultParams(), shape: "picture", size: 100, depth: 6, tabs: { ...defaultParams().tabs, perSide: 4 }, ...patch });

const radii = (p: Params) => {
	const o = pictureOutlines(p, disc);
	return { o, rs: o.rings.flat().map((pt) => Math.hypot(pt.x, pt.y)) };
};

describe("picture outline", () => {
	it("outside cut: the bit's centre runs one radius outside the shape", () => {
		const { o, rs } = radii(job({ mode: "part" }));
		expect(o.rings).toHaveLength(1);
		for (const r of rs) expect(r).toBeCloseTo(32, 0);
	});
	it("inside cut: one radius inside", () => {
		const { o, rs } = radii(job({ mode: "hole" }));
		expect(o.rings).toHaveLength(1);
		for (const r of rs) expect(r).toBeCloseTo(28, 0);
	});
	it("invert makes the white area the shape", () => {
		// Inverted, the shape is the white frame around the disc; its outer outline is the picture's
		// edge plus the bit's radius, not the margin around the picture.
		const o = pictureOutlines(job({ mode: "part", invert: true }), disc);
		expect(o.rings).toHaveLength(1);
		const xs = o.rings[0].map((pt) => pt.x);
		expect(Math.max(...xs)).toBeCloseTo(52, 0);
	});
	it("invert of a light shape on a dark background gives the shape, not the margin", () => {
		const light = toGray(picture(200, 200, (x, y) => (Math.hypot(x + 0.5 - 100, y + 0.5 - 100) < 60 ? 255 : 0)));
		const o = pictureOutlines(job({ mode: "part", invert: true }), light);
		expect(o.rings).toHaveLength(1);
		for (const pt of o.rings[0]) expect(Math.hypot(pt.x, pt.y)).toBeCloseTo(32, 0);
	});
	it("only outer outlines are cut: a ring-shaped shape gives one path", () => {
		const donut = toGray(picture(200, 200, (x, y) => {
			const r = Math.hypot(x + 0.5 - 100, y + 0.5 - 100);
			return r < 60 && r > 30 ? 0 : 255;
		}));
		expect(pictureOutlines(job({ mode: "part" }), donut).rings).toHaveLength(1);
	});
	it("separate shapes each get their own path", () => {
		const two = toGray(picture(200, 100, (x, y) => (Math.hypot(x - 50, y - 50) < 30 || Math.hypot(x - 150, y - 50) < 30 ? 0 : 255)));
		expect(pictureOutlines(job({ mode: "part" }), two).rings).toHaveLength(2);
	});
	it("an empty picture says so", () => {
		const blank = toGray(picture(50, 50, () => 255));
		const o = pictureOutlines(job(), blank);
		expect(o.empty).toBe(true);
		expect(o.rings).toHaveLength(0);
	});
});

describe("picture G-code", () => {
	const p = job({ mode: "part", origin: "lower-left" });
	const o = pictureOutlines(p, disc);
	const { gcode, warnings } = generateGcode(p, o);
	const segs = parsePath(gcode);

	it("reaches the full depth and never goes deeper", () => {
		expect(Math.min(...segs.map((s) => s.to.z))).toBeCloseTo(-6);
	});
	it("is zeroed like the picture's rectangle: the disc's centre is at 50, 50", () => {
		const cut = segs.filter((s) => s.kind !== "rapid" && s.to.z < -5.9);
		for (const s of cut) expect(Math.hypot(s.to.x - 50, s.to.y - 50)).toBeCloseTo(32, 0);
	});
	it("places the tabs around the outline", () => {
		expect(warnings).toHaveLength(0);
		expect(gcode).toMatch(/\(Tabs: 4 x/);
		const tabTop = -(6 - p.tabs.height);
		const lastLap = segs.slice(-Math.floor(segs.length / 6));
		expect(lastLap.some((s) => Math.abs(s.to.z - tabTop) < 1e-6)).toBe(true);
	});
	it("writes plain G-code with no NaN", () => {
		expect(gcode).not.toMatch(/NaN|undefined|Infinity/);
	});
});
