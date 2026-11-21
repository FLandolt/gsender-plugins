/**
 * Pictures as grids, for the plugins that cut from an uploaded image (Height Map, and the Picture
 * shape in Cutout and Pocket Cutout). Pure functions on arrays, so they run the same in the browser
 * and in tests.
 *
 * A picture is turned to grey (transparency counts as white) and resampled onto a grid of square
 * cells covering its real-world size, Y up. The grid can reach past the picture by a margin (filled
 * as background), so a path outside the shape still has room. A distance transform and marching
 * squares then turn masks on that grid into smooth outlines.
 */

export type Pt = { x: number; y: number };

export type RawImage = { width: number; height: number; data: ArrayLike<number> };

export type Gray = { w: number; h: number; v: Float32Array };

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
export const shrink = (g: Gray, max: number): Gray => {
	const f = Math.ceil(Math.max(g.w, g.h) / max);
	if (f <= 1) return g;
	const w = Math.max(1, Math.floor(g.w / f)), h = Math.max(1, Math.floor(g.h / f));
	const v = new Float32Array(w * h);
	for (let y = 0; y < h; y += 1)
		for (let x = 0; x < w; x += 1) {
			let s = 0;
			for (let j = 0; j < f; j += 1) for (let i = 0; i < f; i += 1) s += g.v[(y * f + j) * g.w + x * f + i];
			v[y * w + x] = s / (f * f);
		}
	return { w, h, v };
};

/** Pictures bigger than this are shrunk on loading, to keep memory in check. */
export const MAX_PICTURE_SIDE = 2400;

/** Reads an image file into RGBA pixels (browser only). */
export const readPicture = async (file: File): Promise<RawImage> => {
	const bitmap = await createImageBitmap(file);
	const f = Math.min(1, MAX_PICTURE_SIDE / Math.max(bitmap.width, bitmap.height));
	const w = Math.max(1, Math.round(bitmap.width * f)), h = Math.max(1, Math.round(bitmap.height * f));
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Couldn't read the picture.");
	ctx.drawImage(bitmap, 0, 0, w, h);
	return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
};

/** The picture's size in mm, from the side that was set. */
export const pictureSize = (g: { w: number; h: number }, sizeBy: "width" | "height", size: number): { width: number; height: number } =>
	sizeBy === "width" ? { width: size, height: (size * g.h) / g.w } : { width: (size * g.w) / g.h, height: size };

/**
 * Square cells, Y up: cell (i, j) has its centre at (x0 + (i + ½)·cell, y0 + (j + ½)·cell) in mm,
 * with (0, 0) at the picture's lower-left corner.
 */
export type Grid = {
	w: number;
	h: number;
	cell: number;
	x0: number;
	y0: number;
	v: Float32Array;
	/** Cells of margin around the picture: never part of a shape, whatever the threshold or invert. */
	pad?: number;
};

/** Most cells along the picture's long side: fine enough for a router bit, quick enough to redraw live. */
export const MAX_CELLS = 360;

/**
 * Resamples the picture onto a grid covering `width` × `height` mm, plus `pad` mm of margin all round.
 */
export const makeGrid = (g: Gray, width: number, height: number, o: { maxCells?: number; pad?: number; nearest?: boolean } = {}): Grid => {
	const maxCells = o.maxCells ?? MAX_CELLS;
	const cell = Math.max(width, height) / maxCells;
	const padCells = Math.max(0, Math.ceil((o.pad ?? 0) / cell));
	const iw = Math.max(1, Math.round(width / cell)), ih = Math.max(1, Math.round(height / cell));
	const w = iw + 2 * padCells, h = ih + 2 * padCells;
	// `nearest` takes each cell from the nearest pixel: no blending, so a black-and-white picture stays
	// black and white and no grey fringe appears at its edges.
	const src = o.nearest ? g : shrink(g, maxCells * 2);
	const sample = (u: number, v: number) => {
		if (o.nearest) return src.v[Math.min(src.h - 1, Math.max(0, Math.round(v))) * src.w + Math.min(src.w - 1, Math.max(0, Math.round(u)))];
		const x = Math.min(src.w - 1, Math.max(0, u)), y = Math.min(src.h - 1, Math.max(0, v));
		const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(src.w - 1, x0 + 1), y1 = Math.min(src.h - 1, y0 + 1);
		const fx = x - x0, fy = y - y0;
		const a = src.v[y0 * src.w + x0], b = src.v[y0 * src.w + x1], c = src.v[y1 * src.w + x0], d = src.v[y1 * src.w + x1];
		return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
	};
	// The margin repeats the picture's edge, so smoothing doesn't bleed a colour into it; it is
	// never counted as shape (see thresholdMask).
	const v = new Float32Array(w * h);
	for (let j = 0; j < h; j += 1) {
		const jj = Math.min(ih - 1, Math.max(0, j - padCells));
		for (let i = 0; i < w; i += 1) {
			const ii = Math.min(iw - 1, Math.max(0, i - padCells));
			v[j * w + i] = sample(((ii + 0.5) / iw) * src.w - 0.5, (1 - (jj + 0.5) / ih) * src.h - 0.5);
		}
	}
	// The cells are fitted to the picture: stretch the last fraction so the grid matches its size exactly.
	const cx = width / iw, cy = height / ih;
	return { w, h, cell: (cx + cy) / 2, x0: -padCells * cx, y0: -padCells * cy, v, pad: padCells };
};

/** Centre of cell (i, j) in mm. */
export const cellCentre = (g: Grid, i: number, j: number): Pt => ({ x: g.x0 + (i + 0.5) * g.cell, y: g.y0 + (j + 0.5) * g.cell });

/** Box blur, three times over (close to a Gaussian), with a radius in cells. */
export const blurGrid = (g: Grid, radius: number): Grid => {
	const r = Math.round(radius);
	if (r < 1) return g;
	let cur = g.v;
	const pass = (src: Float32Array, horizontal: boolean) => {
		const out = new Float32Array(src.length);
		const n = horizontal ? g.w : g.h, lines = horizontal ? g.h : g.w;
		const at = (line: number, k: number) => src[horizontal ? line * g.w + k : k * g.w + line];
		for (let line = 0; line < lines; line += 1) {
			let sum = 0;
			for (let k = -r; k <= r; k += 1) sum += at(line, Math.min(n - 1, Math.max(0, k)));
			for (let k = 0; k < n; k += 1) {
				out[horizontal ? line * g.w + k : k * g.w + line] = sum / (2 * r + 1);
				sum += at(line, Math.min(n - 1, k + r + 1)) - at(line, Math.max(0, k - r));
			}
		}
		return out;
	};
	for (let t = 0; t < 3; t += 1) cur = pass(pass(cur, true), false);
	return { ...g, v: cur };
};

/** Black and white: 1 where the picture counts as shape (darker than `threshold`, or lighter when inverted). */
export const thresholdMask = (g: Grid, threshold: number, invert: boolean): Uint8Array => {
	const out = new Uint8Array(g.v.length);
	const pad = g.pad ?? 0;
	for (let j = pad; j < g.h - pad; j += 1)
		for (let i = pad; i < g.w - pad; i += 1) {
			const k = j * g.w + i;
			out[k] = (invert ? g.v[k] >= threshold : g.v[k] < threshold) ? 1 : 0;
		}
	return out;
};

/** The picture as black (shape) and white RGBA pixels, at most `max` on its long side, for a preview. */
export const maskPreview = (gray: Gray, threshold: number, invert: boolean, max = 480): { w: number; h: number; data: Uint8ClampedArray } => {
	const s = shrink(gray, max);
	const data = new Uint8ClampedArray(s.w * s.h * 4);
	for (let i = 0; i < s.v.length; i += 1) {
		const shape = invert ? s.v[i] >= threshold : s.v[i] < threshold;
		data[4 * i] = data[4 * i + 1] = data[4 * i + 2] = shape ? 0 : 255;
		data[4 * i + 3] = 255;
	}
	return { w: s.w, h: s.h, data };
};

/**
 * Euclidean distance (in cells) from every cell to the nearest cell where `mask` is 0.
 * Everything outside the grid counts as 0 too, unless `edgeCounts` is false.
 * Felzenszwalb & Huttenlocher's exact transform.
 */
export const distanceToOutside = (mask: Uint8Array, w: number, h: number, edgeCounts = true): Float32Array => {
	const pw = w + 2, ph = h + 2;
	const INF = 1e20;
	const f = new Float64Array(pw * ph);
	for (let j = 0; j < ph; j += 1)
		for (let i = 0; i < pw; i += 1) {
			const onGrid = i > 0 && j > 0 && i <= w && j <= h;
			const inside = onGrid ? mask[(j - 1) * w + (i - 1)] !== 0 : !edgeCounts;
			f[j * pw + i] = inside ? INF : 0;
		}
	const n = Math.max(pw, ph);
	const d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), line = new Float64Array(n);
	const edt1d = (len: number) => {
		let k = 0;
		v[0] = 0;
		z[0] = -INF;
		z[1] = INF;
		for (let q = 1; q < len; q += 1) {
			let s = (line[q] + q * q - (line[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
			while (s <= z[k]) {
				k -= 1;
				s = (line[q] + q * q - (line[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
			}
			k += 1;
			v[k] = q;
			z[k] = s;
			z[k + 1] = INF;
		}
		k = 0;
		for (let q = 0; q < len; q += 1) {
			while (z[k + 1] < q) k += 1;
			d[q] = (q - v[k]) * (q - v[k]) + line[v[k]];
		}
	};
	for (let i = 0; i < pw; i += 1) {
		for (let j = 0; j < ph; j += 1) line[j] = f[j * pw + i];
		edt1d(ph);
		for (let j = 0; j < ph; j += 1) f[j * pw + i] = d[j];
	}
	for (let j = 0; j < ph; j += 1) {
		for (let i = 0; i < pw; i += 1) line[i] = f[j * pw + i];
		edt1d(pw);
		for (let i = 0; i < pw; i += 1) f[j * pw + i] = d[i];
	}
	const out = new Float32Array(w * h);
	for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) out[j * w + i] = Math.sqrt(f[(j + 1) * pw + (i + 1)]);
	return out;
};

/** Outlines where `f` is positive, by marching squares, in cell units (a cell's centre is at i + ½). */
export const traceContours = (f: Float32Array, w: number, h: number): Pt[][] => {
	const at = (x: number, y: number) => (x < 1 || y < 1 || x > w || y > h ? -1 : f[(y - 1) * w + (x - 1)]);
	type S = { a: string; b: string; pa: Pt; pb: Pt };
	const segs: S[] = [];
	const byEdge = new Map<string, number[]>();
	const t = (u: number, v: number) => (u === v ? 0.5 : u / (u - v));
	const point = (edge: number, i: number, j: number, fa: number, fb: number, fc: number, fd: number): { key: string; p: Pt } => {
		switch (edge) {
			case 0:
				return { key: `h${i},${j}`, p: { x: i - 0.5 + t(fa, fb), y: j - 0.5 } };
			case 1:
				return { key: `v${i + 1},${j}`, p: { x: i + 0.5, y: j - 0.5 + t(fb, fc) } };
			case 2:
				return { key: `h${i},${j + 1}`, p: { x: i - 0.5 + t(fd, fc), y: j + 0.5 } };
			default:
				return { key: `v${i},${j}`, p: { x: i - 0.5, y: j - 0.5 + t(fa, fd) } };
		}
	};
	const TABLE: Record<number, [number, number][]> = {
		1: [[3, 0]], 2: [[0, 1]], 4: [[1, 2]], 8: [[2, 3]],
		3: [[3, 1]], 6: [[0, 2]], 12: [[1, 3]], 9: [[0, 2]],
		14: [[3, 0]], 13: [[0, 1]], 11: [[1, 2]], 7: [[2, 3]],
	};
	for (let j = 0; j < h + 1; j += 1)
		for (let i = 0; i < w + 1; i += 1) {
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
	const used = new Uint8Array(segs.length);
	const rings: Pt[][] = [];
	for (let s = 0; s < segs.length; s += 1) {
		if (used[s]) continue;
		const ring: Pt[] = [segs[s].pa];
		let cur = s, key = segs[s].b;
		used[s] = 1;
		for (let guard = 0; guard < segs.length + 2; guard += 1) {
			const c = segs[cur];
			ring.push(c.b === key ? c.pb : c.pa);
			const next = (byEdge.get(key) ?? []).find((n) => n !== cur && !used[n]);
			if (next === undefined) break;
			used[next] = 1;
			key = segs[next].a === key ? segs[next].b : segs[next].a;
			cur = next;
		}
		if (ring.length > 3) {
			const a = ring[0], b = ring[ring.length - 1];
			if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) ring.pop();
			rings.push(ring);
		}
	}
	return rings;
};

/** Contour rings from cell units to mm. */
export const ringsToMm = (g: Grid, rings: Pt[][]): Pt[][] => rings.map((r) => r.map((p) => ({ x: g.x0 + p.x * g.cell, y: g.y0 + p.y * g.cell })));

/** Douglas–Peucker on an open polyline. */
const simplifyLine = (pts: Pt[], tol: number): Pt[] => {
	if (pts.length < 3) return pts;
	const keep = new Uint8Array(pts.length);
	keep[0] = keep[pts.length - 1] = 1;
	const stack: [number, number][] = [[0, pts.length - 1]];
	while (stack.length) {
		const [a, b] = stack.pop()!;
		const A = pts[a], B = pts[b];
		const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1e-12;
		let best = -1, at = -1;
		for (let i = a + 1; i < b; i += 1) {
			const d = Math.abs((pts[i].x - A.x) * dy - (pts[i].y - A.y) * dx) / len;
			if (d > best) {
				best = d;
				at = i;
			}
		}
		if (best > tol) {
			keep[at] = 1;
			stack.push([a, at], [at, b]);
		}
	}
	return pts.filter((_, i) => keep[i]);
};

/** A closed ring, simplified: cut at its two most distant points so each half is an open line. */
export const simplifyRing = (r: Pt[], tol: number): Pt[] => {
	if (r.length < 4) return r;
	let far = 0, best = -1;
	for (let i = 1; i < r.length; i += 1) {
		const d = Math.hypot(r[i].x - r[0].x, r[i].y - r[0].y);
		if (d > best) {
			best = d;
			far = i;
		}
	}
	const a = simplifyLine(r.slice(0, far + 1), tol);
	const b = simplifyLine([...r.slice(far), r[0]], tol);
	return [...a, ...b.slice(1, -1)];
};

/** Signed area: positive when the ring runs counter-clockwise (Y up). */
export const ringArea = (r: Pt[]): number => {
	let a = 0;
	for (let i = 0; i < r.length; i += 1) {
		const p = r[i], q = r[(i + 1) % r.length];
		a += p.x * q.y - q.x * p.y;
	}
	return a / 2;
};

export const pointInRing = (pt: Pt, r: Pt[]): boolean => {
	let inside = false;
	for (let i = 0, j = r.length - 1; i < r.length; j = i, i += 1) {
		const a = r[i], b = r[j];
		if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
	}
	return inside;
};

/** The rings that are not inside any other ring: the outer outlines, without holes. */
export const outerRings = (rings: Pt[][]): Pt[][] => rings.filter((r, i) => !rings.some((o, k) => k !== i && Math.abs(ringArea(o)) > Math.abs(ringArea(r)) && pointInRing(r[0], o)));
