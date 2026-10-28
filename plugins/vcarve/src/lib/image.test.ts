import { describe, expect, it } from "vitest";

import { planCarve } from "./carve";
import { boundsOf, ringArea, turnAngles } from "./geom";
import { analyse, imageShapes, maskPixels, shrink, toGray, traceContours, type RawImage } from "./image";
import { surfaceCheck } from "./testkit";

const bit = { angle: 60, diameter: 14, tip: 0, cuttingLength: null };

/** A tiny deterministic random generator, so the noise in these tests is the same every run. */
const rng = (seed: number) => () => {
	seed = (seed * 1664525 + 1013904223) >>> 0;
	return seed / 2 ** 32;
};

const draw = (w: number, h: number, pixel: (x: number, y: number) => number | [number, number, number, number]): RawImage => {
	const data = new Uint8ClampedArray(w * h * 4);
	for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
		const v = pixel(x, y);
		const [r, g, b, a] = typeof v === "number" ? [v, v, v, 255] : v;
		data.set([r, g, b, a], 4 * (y * w + x));
	}
	return { width: w, height: h, data };
};

/** Black on white, antialiased by supersampling. */
const aa = (w: number, h: number, inside: (x: number, y: number) => boolean): RawImage =>
	draw(w, h, (x, y) => {
		let n = 0;
		for (let j = 0; j < 4; j += 1) for (let i = 0; i < 4; i += 1) if (inside(x + (i + 0.5) / 4, y + (j + 0.5) / 4)) n += 1;
		return 255 - (255 * n) / 16;
	});

const ringAt = (cx: number, cy: number, r0: number, r1: number) => (x: number, y: number) => {
	const d = Math.hypot(x - cx, y - cy);
	return d >= r0 && d <= r1;
};

const opts = { threshold: 128, invert: false, sizeBy: "width" as const, size: 100 };

describe("a clean logo", () => {
	// A ring ("O") 200 px across, with a 60 px bar beside it.
	const img = aa(400, 220, (x, y) => ringAt(110, 110, 60, 100)(x, y) || (x > 250 && x < 380 && y > 90 && y < 130));
	const art = imageShapes(img, opts);
	it("finds the ring with its hole and the bar", () => {
		expect(art.shapes).toHaveLength(2);
		expect(art.shapes.filter((s) => s.holes.length === 1)).toHaveLength(1);
	});
	it("scales to the size asked for", () => {
		const b = boundsOf(art.shapes.map((s) => s.outer));
		expect(b.maxX - b.minX).toBeCloseTo((380 - 10) * (100 / 400), 0);
		expect(art.width).toBeCloseTo(100, 6);
		expect(art.height).toBeCloseTo(55, 6);
		const byHeight = imageShapes(img, { ...opts, sizeBy: "height", size: 44 });
		expect(byHeight.height).toBeCloseTo(44, 6);
		expect(byHeight.width).toBeCloseTo(80, 6);
	});
	it("the picture is the right way up", () => {
		// The bar is on the right and lower-middle of the picture; y is flipped, so it sits mid-height.
		const bar = art.shapes.find((s) => s.holes.length === 0)!;
		const b = boundsOf([bar.outer]);
		expect(b.minX).toBeGreaterThan(55);
		expect((b.minY + b.maxY) / 2).toBeCloseTo(27.5, 0);
	});
	it("is not mistaken for a photo", () => {
		expect(art.analysis.photo).toBe(false);
		expect(art.analysis.flat).toBe(false);
	});
	it("carves cleanly: within the depth limit, no overcut, nothing missed", () => {
		const plan = planCarve(art.shapes, bit, 12, "normal");
		expect(plan.tooWide).toHaveLength(0);
		for (const c of plan.chains) for (const p of c) expect(p.z).toBeGreaterThanOrEqual(-12);
		const { overcut, miss } = surfaceCheck(plan, art.shapes, bit, 0.5);
		expect(overcut).toBeLessThan(0.05);
		expect(miss).toBeLessThan(0.2);
	}, 60_000);
});

describe("threshold and invert", () => {
	// A light grey disc on white, and a dark one.
	const img = draw(300, 200, (x, y) => (Math.hypot(x - 80, y - 100) < 50 ? 200 : Math.hypot(x - 220, y - 100) < 50 ? 40 : 255));
	it("a low threshold cuts only the dark disc, a high one cuts both", () => {
		expect(imageShapes(img, { ...opts, threshold: 100 }).shapes).toHaveLength(1);
		expect(imageShapes(img, { ...opts, threshold: 230 }).shapes).toHaveLength(2);
	});
	it("invert cuts the light areas instead: the background and the grey disc around the dark one", () => {
		const dark = imageShapes(img, { ...opts, threshold: 100 });
		const light = imageShapes(img, { ...opts, threshold: 100, invert: true });
		expect(dark.shapes).toHaveLength(1);
		// The light area is everything except the dark disc: one shape with a hole.
		expect(light.shapes).toHaveLength(1);
		expect(light.shapes[0].holes).toHaveLength(1);
	});
	it("the mask preview shows what would be carved", () => {
		const g = toGray(img);
		const m = maskPixels(g, 100, false);
		const at = (x: number, y: number) => m[4 * (y * 300 + x)];
		expect(at(220, 100)).toBe(0);
		expect(at(80, 100)).toBe(255);
		expect(at(5, 5)).toBe(255);
		const inv = maskPixels(g, 100, true);
		expect(inv[4 * (100 * 300 + 220)]).toBe(255);
		expect(inv[4 * (5 * 300 + 5)]).toBe(0);
	});
});

describe("jagged and noisy pictures", () => {
	// A rectangle turned 20°, drawn with no antialiasing at all: a pixel staircase along every edge.
	const a = (20 * Math.PI) / 180;
	const inside = (x: number, y: number) => {
		const u = (x - 200) * Math.cos(a) + (y - 150) * Math.sin(a), v = -(x - 200) * Math.sin(a) + (y - 150) * Math.cos(a);
		return Math.abs(u) <= 120 && Math.abs(v) <= 40;
	};
	const jagged = draw(400, 300, (x, y) => (inside(x + 0.5, y + 0.5) ? 0 : 255));

	it("the outline of a pixel staircase is smooth: a few corners, nothing wobbly", () => {
		const { shapes } = imageShapes(jagged, opts);
		expect(shapes).toHaveLength(1);
		const ring = shapes[0].outer;
		// A rectangle: four real corners, and everything else near straight.
		const turns = turnAngles(ring).map(Math.abs);
		expect(turns.filter((t) => t > (35 * Math.PI) / 180).length).toBeLessThanOrEqual(8);
		expect(ring.length).toBeLessThan(40);
		// And it follows the true rectangle to well under a pixel (0.25 mm per pixel here).
		const px = 100 / 400;
		for (const p of ring) {
			const x = p.x / px, y = 300 - p.y / px;
			const u = (x - 200) * Math.cos(a) + (y - 150) * Math.sin(a), v = -(x - 200) * Math.sin(a) + (y - 150) * Math.cos(a);
			const out = Math.max(Math.abs(u) - 120, Math.abs(v) - 40);
			expect(Math.abs(out)).toBeLessThan(1.2);
		}
	});

	it("a noisy picture (speckle and fuzz, like a bad JPG) still gives the same clean shapes and no specks", () => {
		const r = rng(7);
		const noisy = aa(400, 300, inside);
		const data = noisy.data as Uint8ClampedArray;
		for (let i = 0; i < data.length; i += 4) {
			// Fuzz of about ±25 levels everywhere, plus the odd stray dark pixel on the background.
			const n = (r() - 0.5) * 50;
			let v = data[i] + n;
			if (r() < 0.002) v = 0;
			data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, v));
		}
		const { shapes } = imageShapes(noisy, opts);
		expect(shapes).toHaveLength(1);
		expect(shapes[0].holes).toHaveLength(0);
		expect(Math.abs(ringArea(shapes[0].outer))).toBeCloseTo(240 * 80 * (100 / 400) ** 2, -1);
	});
});

describe("images that can't give a good result", () => {
	it("a picture of one colour has nothing to carve", () => {
		const plain = draw(100, 100, () => 200);
		const art = imageShapes(plain, opts);
		expect(art.analysis.flat).toBe(true);
		expect(art.shapes).toHaveLength(0);
		expect(imageShapes(draw(100, 100, () => [20, 120, 220, 255]), opts).analysis.flat).toBe(true);
	});
	it("a fully transparent picture counts as plain white", () => {
		expect(imageShapes(draw(60, 60, () => [0, 0, 0, 0]), opts).analysis.flat).toBe(true);
	});
	it("a photograph (lots of in-between greys) is recognised", () => {
		const r = rng(3);
		const photo = draw(200, 200, (x, y) => 128 + 100 * Math.sin(x / 17) * Math.cos(y / 23) + (r() - 0.5) * 30);
		expect(imageShapes(photo, opts).analysis.photo).toBe(true);
	});
	it("a smooth gradient is flagged as a photo too", () => {
		expect(analyse(toGray(draw(200, 50, (x) => (x / 200) * 255))).photo).toBe(true);
	});
	it("a threshold that selects nothing finds no shapes", () => {
		const img = draw(120, 80, (x) => (x < 60 ? 100 : 200));
		expect(imageShapes(img, { ...opts, threshold: 10 }).shapes).toHaveLength(0);
	});
	it("a colour logo on transparency works", () => {
		const img = draw(200, 100, (x, y) => (Math.hypot(x - 100, y - 50) < 35 ? [200, 30, 30, 255] : [0, 0, 0, 0]));
		const art = imageShapes(img, { ...opts, threshold: 150 });
		expect(art.shapes).toHaveLength(1);
	});
});

describe("contours and size", () => {
	it("traceContours closes every outline, and puts them between the pixels", () => {
		const w = 20, h = 20;
		const f = new Float32Array(w * h).fill(-1);
		for (let y = 5; y < 15; y += 1) for (let x = 5; x < 15; x += 1) f[y * w + x] = 1;
		const rings = traceContours(f, w, h);
		expect(rings).toHaveLength(1);
		const b = boundsOf(rings);
		// Ten pixels of +1 beside -1: the edge falls halfway between pixel centres.
		expect(b.minX).toBeCloseTo(5, 6);
		expect(b.maxX).toBeCloseTo(15, 6);
	});
	it("shapes touching the edge of the picture still close up", () => {
		const img = draw(60, 60, (x) => (x < 30 ? 0 : 255));
		const art = imageShapes(img, opts);
		expect(art.shapes).toHaveLength(1);
		expect(Math.abs(ringArea(art.shapes[0].outer))).toBeGreaterThan(40 * 60 * (100 / 60) ** 2 * 0.4);
	});
	it("huge pictures are shrunk before tracing, and the size stays right", () => {
		const big = draw(3200, 1600, (x, y) => (Math.hypot(x - 1600, y - 800) < 600 ? 0 : 255));
		expect(shrink(toGray(big)).w).toBeLessThanOrEqual(1600);
		const art = imageShapes(big, opts);
		expect(art.width).toBeCloseTo(100, 6);
		const b = boundsOf(art.shapes.map((s) => s.outer));
		expect(b.maxX - b.minX).toBeCloseTo(37.5, 0);
	}, 60_000);
});
