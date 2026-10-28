/**
 * Image → outlines. Pure functions on pixel arrays (RGBA), so they run the same in the browser and in tests.
 *
 * Colour is turned to grey, transparent areas count as white, and the grey picture is lightly blurred
 * so scanner and JPEG noise doesn't become wobbles. The outline of the dark (or, inverted, light) areas
 * is then traced with marching squares, which places it between pixels by interpolating the grey
 * levels: that gives smooth outlines, not pixel staircases. A little more smoothing and
 * simplification follows before the outlines become shapes.
 */

import { buildShapes, ringArea, simplifyRing, turnAngles, type Pt, type Ring, type Shape } from "./geom";

export type RawImage = { width: number; height: number; data: ArrayLike<number> };

export type Gray = { w: number; h: number; v: Float32Array };

/** Pictures bigger than this on their long side are shrunk first: more pixels add nothing to a signmaker's outline. */
export const MAX_SIDE = 1600;

/** Grey levels 0 to 255, with transparency treated as white. */
export const toGray = (img: RawImage): Gray => {
	const v = new Float32Array(img.width * img.height);
	for (let i = 0; i < v.length; i += 1) {
		const r = img.data[4 * i], g = img.data[4 * i + 1], b = img.data[4 * i + 2], a = img.data[4 * i + 3] / 255;
		v[i] = (0.299 * r + 0.587 * g + 0.114 * b) * a + 255 * (1 - a);
	}
	return { w: img.width, h: img.height, v };
};

/** Shrinks by averaging blocks, so the long side is at most `max`. */
export const shrink = (g: Gray, max = MAX_SIDE): Gray => {
	const f = Math.ceil(Math.max(g.w, g.h) / max);
	if (f <= 1) return g;
	const w = Math.floor(g.w / f), h = Math.floor(g.h / f);
	const v = new Float32Array(w * h);
	for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
		let s = 0;
		for (let j = 0; j < f; j += 1) for (let i = 0; i < f; i += 1) s += g.v[(y * f + j) * g.w + x * f + i];
		v[y * w + x] = s / (f * f);
	}
	return { w, h, v };
};

/** A gentle separable blur (a 1-4-6-4-1 kernel): enough to calm noise without rounding real corners much. */
export const blur = (g: Gray): Gray => {
	const k = [1, 4, 6, 4, 1].map((x) => x / 16);
	const pass = (src: Float32Array, horizontal: boolean) => {
		const out = new Float32Array(src.length);
		for (let y = 0; y < g.h; y += 1) for (let x = 0; x < g.w; x += 1) {
			let s = 0;
			for (let t = -2; t <= 2; t += 1) {
				const xx = horizontal ? Math.min(g.w - 1, Math.max(0, x + t)) : x;
				const yy = horizontal ? y : Math.min(g.h - 1, Math.max(0, y + t));
				s += k[t + 2] * src[yy * g.w + xx];
			}
			out[y * g.w + x] = s;
		}
		return out;
	};
	return { w: g.w, h: g.h, v: pass(pass(g.v, true), false) };
};

export type ImageAnalysis = {
	/** Grey levels span too little to hold a picture: a single colour. */
	flat: boolean;
	/** Share of pixels that are neither clearly dark nor clearly light. */
	midtones: number;
	/** Looks like a photograph or a gradient rather than a logo or line art. */
	photo: boolean;
};

export const analyse = (g: Gray): ImageAnalysis => {
	let lo = 255, hi = 0, mid = 0;
	for (const x of g.v) {
		if (x < lo) lo = x;
		if (x > hi) hi = x;
		if (x > 40 && x < 215) mid += 1;
	}
	const midtones = mid / g.v.length;
	return { flat: hi - lo < 24, midtones, photo: midtones > 0.3 };
};

/** Black where the artwork would be carved, white elsewhere, as RGBA for showing on screen. */
export const maskPixels = (g: Gray, threshold: number, invert: boolean): Uint8ClampedArray => {
	const out = new Uint8ClampedArray(g.w * g.h * 4);
	for (let i = 0; i < g.v.length; i += 1) {
		const carve = invert ? g.v[i] >= threshold : g.v[i] < threshold;
		const c = carve ? 0 : 255;
		out[4 * i] = out[4 * i + 1] = out[4 * i + 2] = c;
		out[4 * i + 3] = 255;
	}
	return out;
};

type Seg = { a: string; b: string; pa: Pt; pb: Pt };

/** Outlines of the area where `f` is positive, placed by interpolation, in pixel units. */
export const traceContours = (f: Float32Array, w: number, h: number): Ring[] => {
	// Pad by one pixel of background so shapes touching the edge still close up.
	const pw = w + 2, ph = h + 2;
	const at = (x: number, y: number) => (x < 1 || y < 1 || x > w || y > h ? -1 : f[(y - 1) * w + (x - 1)]);
	const segs: Seg[] = [];
	const byEdge = new Map<string, number[]>();
	const point = (edge: number, i: number, j: number, fa: number, fb: number, fc: number, fd: number): { key: string; p: Pt } => {
		const t = (u: number, v: number) => (u === v ? 0.5 : u / (u - v));
		// The lattice sits on pixel centres: lattice (i, j) is pixel (i - 1, j - 1).
		switch (edge) {
			case 0: return { key: `h${i},${j}`, p: { x: i - 1 + t(fa, fb) + 0.5, y: j - 1 + 0.5 } };
			case 1: return { key: `v${i + 1},${j}`, p: { x: i - 1 + 1 + 0.5, y: j - 1 + t(fb, fc) + 0.5 } };
			case 2: return { key: `h${i},${j + 1}`, p: { x: i - 1 + t(fd, fc) + 0.5, y: j - 1 + 1 + 0.5 } };
			default: return { key: `v${i},${j}`, p: { x: i - 1 + 0.5, y: j - 1 + t(fa, fd) + 0.5 } };
		}
	};
	const TABLE: Record<number, [number, number][]> = {
		1: [[3, 0]], 2: [[0, 1]], 4: [[1, 2]], 8: [[2, 3]],
		3: [[3, 1]], 6: [[0, 2]], 12: [[1, 3]], 9: [[0, 2]],
		14: [[3, 0]], 13: [[0, 1]], 11: [[1, 2]], 7: [[2, 3]],
	};
	for (let j = 0; j < ph - 1; j += 1) {
		for (let i = 0; i < pw - 1; i += 1) {
			const fa = at(i, j), fb = at(i + 1, j), fc = at(i + 1, j + 1), fd = at(i, j + 1);
			const idx = (fa > 0 ? 1 : 0) | (fb > 0 ? 2 : 0) | (fc > 0 ? 4 : 0) | (fd > 0 ? 8 : 0);
			if (idx === 0 || idx === 15) continue;
			let pairs: [number, number][];
			if (idx === 5) pairs = (fa + fb + fc + fd) / 4 > 0 ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]];
			else if (idx === 10) pairs = (fa + fb + fc + fd) / 4 > 0 ? [[3, 0], [1, 2]] : [[0, 1], [2, 3]];
			else pairs = TABLE[idx];
			for (const [e1, e2] of pairs) {
				const A = point(e1, i, j, fa, fb, fc, fd), B = point(e2, i, j, fa, fb, fc, fd);
				const id = segs.length;
				segs.push({ a: A.key, b: B.key, pa: A.p, pb: B.p });
				for (const k of [A.key, B.key]) (byEdge.get(k) ?? byEdge.set(k, []).get(k)!).push(id);
			}
		}
	}
	const used = new Uint8Array(segs.length);
	const rings: Ring[] = [];
	for (let s = 0; s < segs.length; s += 1) {
		if (used[s]) continue;
		const ring: Ring = [];
		let cur = s, key = segs[s].b, from = segs[s].a;
		used[s] = 1;
		ring.push(segs[s].pa);
		for (let guard = 0; guard < segs.length + 2; guard += 1) {
			const at2 = segs[cur];
			ring.push(at2.b === key ? at2.pb : at2.pa);
			const next = (byEdge.get(key) ?? []).find((n) => n !== cur && !used[n]);
			if (next === undefined) break;
			used[next] = 1;
			const n = segs[next];
			from = key;
			key = n.a === key ? n.b : n.a;
			cur = next;
		}
		void from;
		// The last point repeats the first, once the loop has closed.
		if (ring.length > 3) {
			const a = ring[0], b = ring[ring.length - 1];
			if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) ring.pop();
			rings.push(ring);
		}
	}
	return rings;
};

/** Smooths along an outline, but leaves real corners alone. */
const smoothRing = (r: Ring, passes: number): Ring => {
	let cur = r;
	for (let p = 0; p < passes; p += 1) {
		const turns = turnAngles(cur);
		cur = cur.map((pt, i) => {
			if (Math.abs(turns[i]) > (40 * Math.PI) / 180) return pt;
			const a = cur[(i + cur.length - 1) % cur.length], b = cur[(i + 1) % cur.length];
			return { x: (a.x + 2 * pt.x + b.x) / 4, y: (a.y + 2 * pt.y + b.y) / 4 };
		});
	}
	return cur;
};

export type ImageOptions = {
	threshold: number;
	invert: boolean;
	/** Real-world size along one side, mm. */
	sizeBy: "width" | "height";
	size: number;
};

export type ImageArtwork = {
	shapes: Shape[];
	analysis: ImageAnalysis;
	/** Millimetres per pixel of the (possibly shrunk) picture. */
	mmPerPixel: number;
	/** Real size of the whole picture, mm. */
	width: number;
	height: number;
};

/** Outlines from a picture, in millimetres with y up and the picture's lower-left corner at 0,0. */
export const imageShapes = (img: RawImage, o: ImageOptions): ImageArtwork => {
	const gray = shrink(toGray(img));
	const analysis = analyse(gray);
	const mmPerPixel = o.sizeBy === "width" ? o.size / gray.w : o.size / gray.h;
	const result = (shapes: Shape[]): ImageArtwork => ({ shapes, analysis, mmPerPixel, width: gray.w * mmPerPixel, height: gray.h * mmPerPixel });
	if (analysis.flat) return result([]);
	const smooth = blur(gray);
	const f = new Float32Array(smooth.v.length);
	for (let i = 0; i < f.length; i += 1) f[i] = o.invert ? smooth.v[i] - o.threshold : o.threshold - smooth.v[i];
	const raw = traceContours(f, gray.w, gray.h);
	const rings: Ring[] = [];
	for (const r of raw) {
		// Specks: a handful of pixels is noise, not artwork.
		if (Math.abs(ringArea(r)) < 8) continue;
		const s = simplifyRing(smoothRing(r, 2), 0.3);
		// Pixels to millimetres, and the picture's y runs down.
		rings.push(s.map((p) => ({ x: p.x * mmPerPixel, y: (gray.h - p.y) * mmPerPixel })));
	}
	return result(buildShapes(rings));
};
