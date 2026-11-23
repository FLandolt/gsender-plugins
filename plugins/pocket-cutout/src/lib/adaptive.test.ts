import { describe, expect, it } from "vitest";

import { wavefrontStrokes } from "@shared/wavefront";
import { ringStrokes } from "@shared/clearing";
import { distanceToOutside, type Grid, makeGrid, type Pt, thresholdMask, toGray } from "@shared/picture";

import { generateGcode } from "./generate";
import { defaultParams, type Params } from "./params";
import { planPicturePocket } from "./picture";

const picture = (w: number, h: number, grey: (x: number, y: number) => number) => {
	const data = new Uint8ClampedArray(w * h * 4);
	for (let y = 0; y < h; y += 1)
		for (let x = 0; x < w; x += 1) {
			const v = grey(x, y), i = 4 * (y * w + x);
			data[i] = data[i + 1] = data[i + 2] = v;
			data[i + 3] = 255;
		}
	return toGray({ width: w, height: h, data });
};

// A blob with three lobes and an island, 120 × 80 mm.
const blob = picture(240, 160, (x, y) => {
	const a = Math.atan2(y - 80, x - 120), r = Math.hypot((x - 120) / 1.4, y - 80), R = 50 + 9 * Math.sin(3 * a) + 5 * Math.cos(5 * a + 1);
	return r < R && Math.hypot(x - 145, y - 75) >= 11 ? 0 : 255;
});

/** One pass over the blob, set up as the clearing does it. */
const setup = () => {
	const r = 2;
	const g = makeGrid(blob, 120, 80);
	const area = thresholdMask(g, 128, false);
	const inside = distanceToOutside(area, g.w, g.h);
	const field = new Float32Array(area.length), allowed = new Uint8Array(area.length);
	for (let i = 0; i < field.length; i += 1) {
		field[i] = inside[i] - (r / g.cell + 0.5);
		allowed[i] = field[i] > 0 ? 1 : 0;
	}
	const toAllowed = distanceToOutside(allowed.map((v) => (v ? 0 : 1)), g.w, g.h, false);
	const material = area.map((v, i) => (v && toAllowed[i] <= r / g.cell + 0.75 ? 1 : 0));
	return { g, r, area, field, allowed, material };
};

/** Replays strokes on a fresh material map: the load (material per mm, averaged over 1 mm) along the path, and what is left. */
const replay = (g: Grid, material: Uint8Array, strokes: Pt[][], r: number) => {
	const mat = material.slice(), rc = r / g.cell, R = Math.ceil(rc), raw: number[] = [];
	const cut = (p: Pt) => {
		const ci = Math.floor((p.x - g.x0) / g.cell), cj = Math.floor((p.y - g.y0) / g.cell);
		let n = 0;
		for (let dy = -R; dy <= R; dy += 1)
			for (let dx = -R; dx <= R; dx += 1) {
				const i = ci + dx, j = cj + dy, k = j * g.w + i;
				if (dx * dx + dy * dy <= rc * rc && i >= 0 && j >= 0 && i < g.w && j < g.h && mat[k]) {
					mat[k] = 0;
					n += 1;
				}
			}
		return n;
	};
	for (const s of strokes) {
		cut(s[0]);
		for (let k = 1; k < s.length; k += 1) {
			const a = s[k - 1], b = s[k], L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(L / (g.cell * 0.5)));
			for (let t = 1; t <= n; t += 1) raw.push(cut({ x: a.x + ((b.x - a.x) * t) / n, y: a.y + ((b.y - a.y) * t) / n }) / (L / n));
		}
	}
	const win = Math.round(1 / (g.cell * 0.5)), loads: number[] = [];
	for (let k = 0; k + win <= raw.length; k += 1) loads.push(raw.slice(k, k + win).reduce((x, y) => x + y, 0) / win);
	const left = mat.reduce((x, y) => x + y, 0) / material.reduce((x, y) => x + y, 0);
	return { loads, left };
};

describe("adaptive clearing", () => {
	const { g, r, field, allowed, material } = setup();
	const stepover = 1.6;
	const target = stepover / (g.cell * g.cell);
	const adaptive = wavefrontStrokes(g, field, allowed, { stepover, radius: r, bothWays: true });
	const climb = wavefrontStrokes(g, field, allowed, { stepover, radius: r });
	const rings = ringStrokes(g, field, allowed, stepover, r);
	const a = replay(g, material, adaptive, r);
	const b = replay(g, material, rings, r);
	const overloaded = (loads: number[]) => loads.filter((l) => l > 2 * target).length / loads.length;
	const peak = (loads: number[]) => Math.max(...loads) / target;

	it("clears everything rings clear", () => {
		expect(a.left).toBeLessThan(0.005);
	});
	it("keeps the load more even than rings: far fewer overloads", () => {
		expect(overloaded(a.loads)).toBeLessThan(0.03);
		expect(overloaded(a.loads)).toBeLessThan(overloaded(b.loads) / 2);
		const p99 = (l: number[]) => [...l].sort((x, y) => x - y)[Math.floor(l.length * 0.99)];
		expect(p99(a.loads)).toBeLessThan(p99(b.loads));
		// The worst moment is entering solid material at the very start, as with rings.
		expect(peak(a.loads)).toBeLessThanOrEqual(peak(b.loads) + 0.01);
	});
	it("climb only clears everything too, with an even load", () => {
		const c = replay(g, material, climb, r);
		expect(c.left).toBeLessThan(0.005);
		expect(overloaded(c.loads)).toBeLessThan(overloaded(b.loads) / 2);
	});
	it("runs smoothly: few sharp turns", () => {
		// Share of the path (sampled every 0.5 mm) where the heading turns more than 30° within 1 mm.
		let sharp = 0, all = 0;
		const pts: Pt[] = [];
		for (const s of adaptive)
		for (let k = 1; k < s.length; k += 1) {
			const p = s[k - 1], q = s[k], n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 0.5));
			for (let t = 0; t < n; t += 1) pts.push({ x: p.x + ((q.x - p.x) * t) / n, y: p.y + ((q.y - p.y) * t) / n });
		}
		for (let k = 2; k + 2 < pts.length; k += 1) {
			const h1 = Math.atan2(pts[k].y - pts[k - 2].y, pts[k].x - pts[k - 2].x), h2 = Math.atan2(pts[k + 2].y - pts[k].y, pts[k + 2].x - pts[k].x);
			let d = Math.abs(h2 - h1);
			if (d > Math.PI) d = 2 * Math.PI - d;
			all += 1;
			if (d > Math.PI / 6) sharp += 1;
		}
		expect(sharp / all).toBeLessThan(0.08);
	});
	it("stays down: only a few lifts", () => {
		expect(adaptive.length).toBeLessThanOrEqual(10);
	});
	it("never takes the bit's centre outside where it fits", () => {
		for (const pt of adaptive.flat()) {
			const i = Math.floor((pt.x - g.x0) / g.cell), j = Math.floor((pt.y - g.y0) / g.cell);
			expect(field[j * g.w + i]).toBeGreaterThan(-1);
		}
	});
});

describe("adaptive in Pocket Cutout", () => {
	const job = (patch: Partial<Params> = {}): Params => ({ ...defaultParams(), shape: "picture", size: 120, depth: 4, ...patch });

	it("rings stay the default", () => {
		expect(defaultParams().strategy).toBe("rings");
	});
	it("the toggle switches the picture pocket to adaptive and says so in the G-code", () => {
		const p = job({ strategy: "adaptive" });
		const plan = planPicturePocket(p, blob);
		expect(plan.missed).toBeLessThan(0.02);
		const code = generateGcode(p, { plan, name: "blob" });
		expect(code).toMatch(/adaptive/i);
		expect(code).not.toMatch(/NaN|undefined/);
	});
});
