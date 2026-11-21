/**
 * Picture → terraced levels → toolpaths. Pure functions on arrays, so they run the same in the
 * browser and in tests.
 *
 * 1. The picture is turned to grey (transparency counts as white) and resampled onto a grid of
 *    square cells covering its real-world size, Y up, with the origin at the lower-left corner.
 * 2. It is blurred by the smoothing radius and split into `steps + 1` bands of brightness: the
 *    lightest band is level 0 (stock top), the darkest is level `steps` (full depth).
 * 3. Each pass depth cuts every cell whose level is at least that deep. The bit's centre may only go
 *    where the whole bit fits inside that area (found with a distance transform), so it never cuts
 *    into a higher level. Inside it the bit runs back-and-forth rows (like Surfacing), joined without
 *    lifting where the straight link stays inside, then follows the outline once for clean walls.
 * 4. What the bit really reaches is worked out too: areas narrower than the bit stay higher, and the
 *    depth map shows that.
 */

import { levelDepths } from "./params";

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

/** The picture's size in mm, from the side that was set. */
export const pictureSize = (g: { w: number; h: number }, sizeBy: "width" | "height", size: number): { width: number; height: number } =>
	sizeBy === "width" ? { width: size, height: (size * g.h) / g.w } : { width: (size * g.w) / g.h, height: size };

/** Square cells over the picture, Y up: cell (i, j) has its centre at ((i + ½)·cell, (j + ½)·cell). */
export type Grid = { w: number; h: number; cell: number; v: Float32Array };

/** Most cells along the long side: fine enough for a router bit, quick enough to redraw live. */
export const MAX_CELLS = 360;

export const makeGrid = (g: Gray, width: number, height: number, maxCells = MAX_CELLS): Grid => {
	const cell = Math.max(width, height) / maxCells;
	const w = Math.max(1, Math.round(width / cell)), h = Math.max(1, Math.round(height / cell));
	const src = shrink(g, maxCells * 2);
	const sample = (u: number, v: number) => {
		const x = Math.min(src.w - 1, Math.max(0, u)), y = Math.min(src.h - 1, Math.max(0, v));
		const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(src.w - 1, x0 + 1), y1 = Math.min(src.h - 1, y0 + 1);
		const fx = x - x0, fy = y - y0;
		const a = src.v[y0 * src.w + x0], b = src.v[y0 * src.w + x1], c = src.v[y1 * src.w + x0], d = src.v[y1 * src.w + x1];
		return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
	};
	const v = new Float32Array(w * h);
	for (let j = 0; j < h; j += 1)
		for (let i = 0; i < w; i += 1) v[j * w + i] = sample(((i + 0.5) / w) * src.w - 0.5, (1 - (j + 0.5) / h) * src.h - 0.5);
	return { w, h, cell, v };
};

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

/**
 * Splits brightness into `steps + 1` even bands: 0 = lightest = stock top, `steps` = darkest = full
 * depth. The picture's own range is stretched first (its darkest and lightest 0.5 % set the ends), so
 * a height map that never reaches pure black or white still uses every level.
 */
export const levelMap = (g: Grid, steps: number, invert: boolean): Uint8Array => {
	const hist = new Uint32Array(256);
	for (let i = 0; i < g.v.length; i += 1) hist[Math.min(255, Math.max(0, Math.round(g.v[i])))] += 1;
	const cut = g.v.length * 0.005;
	let lo = 0, hi = 255, acc = 0;
	for (let b = 0; b < 256; b += 1) {
		acc += hist[b];
		if (acc > cut) {
			lo = b;
			break;
		}
	}
	acc = 0;
	for (let b = 255; b >= 0; b -= 1) {
		acc += hist[b];
		if (acc > cut) {
			hi = b;
			break;
		}
	}
	const span = hi - lo;
	const out = new Uint8Array(g.v.length);
	for (let i = 0; i < out.length; i += 1) {
		// A flat picture (no contrast) stays at the top.
		const light = span < 1 ? 1 : Math.min(1, Math.max(0, (g.v[i] - lo) / span));
		const high = invert ? 1 - light : light;
		out[i] = Math.min(steps, Math.floor((1 - high) * (steps + 1)));
	}
	return out;
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

/** The pass depths: down to each level in even passes no deeper than `stepdown`. */
export const passDepths = (depth: number, steps: number, stepdown: number): number[] => {
	const levels = levelDepths(depth, steps);
	const out: number[] = [];
	for (let k = 1; k < levels.length; k += 1) {
		const from = levels[k - 1], to = levels[k];
		const n = Math.max(1, Math.ceil((to - from) / stepdown - 1e-9));
		for (let s = 1; s <= n; s += 1) out.push(from + ((to - from) * s) / n);
	}
	return out;
};

type Seg = { a: Pt; b: Pt };

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

/** One cut at constant depth: a polyline in mm (picture coordinates, Y up). Closed strokes end where they start. */
export type Stroke = Pt[];

export type PassPlan = { depth: number; strokes: Stroke[] };

export type Plan = {
	grid: Grid;
	/** The level each cell asks for (from the picture). */
	target: Uint8Array;
	/** The level the bit really reaches in each cell (higher where the bit doesn't fit). */
	reached: Uint8Array;
	passes: PassPlan[];
	width: number;
	height: number;
	/** Share of the picture, per level, that the bit reaches: top first. */
	share: number[];
	/** Share of the picture left higher than asked because the bit doesn't fit there. */
	missed: number;
};

export type PlanOptions = {
	width: number;
	height: number;
	steps: number;
	depth: number;
	invert: boolean;
	smoothing: number;
	toolDiameter: number;
	stepover: number;
	stepdown: number;
};

/** True when the straight line from `a` to `b` (mm) stays on allowed cells. */
const staysInside = (allowed: Uint8Array, g: Grid, a: Pt, b: Pt): boolean => {
	const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (g.cell * 0.5)));
	for (let s = 0; s <= n; s += 1) {
		const x = a.x + ((b.x - a.x) * s) / n, y = a.y + ((b.y - a.y) * s) / n;
		const i = Math.floor(x / g.cell), j = Math.floor(y / g.cell);
		if (i < 0 || j < 0 || i >= g.w || j >= g.h || !allowed[j * g.w + i]) return false;
	}
	return true;
};

/** Everything for one picture and one set of settings: levels, passes and what the bit reaches. */
export const planCut = (gray: Gray, o: PlanOptions): Plan => {
	const base = makeGrid(gray, o.width, o.height);
	const grid = blurGrid(base, o.smoothing / base.cell);
	const target = levelMap(grid, o.steps, o.invert);
	const levels = levelDepths(o.depth, o.steps);
	const { w, h, cell } = grid;
	const r = o.toolDiameter / 2;
	// A centre this far from any cell that must not be cut keeps the whole bit off it.
	const clear = r / cell + 0.5;
	const step = o.toolDiameter * o.stepover;
	const reached = new Uint8Array(w * h);
	const passes: PassPlan[] = [];

	for (const depth of passDepths(o.depth, o.steps, o.stepdown)) {
		// The deepest level this pass is not yet below: cells at that level or deeper get cut.
		const k = levels.findIndex((d) => d >= depth - 1e-9);
		const area = new Uint8Array(w * h);
		for (let i = 0; i < area.length; i += 1) area[i] = target[i] >= k ? 1 : 0;
		const inside = distanceToOutside(area, w, h);
		const field = new Float32Array(w * h);
		const allowed = new Uint8Array(w * h);
		for (let i = 0; i < field.length; i += 1) {
			field[i] = inside[i] - clear;
			allowed[i] = field[i] > 0 ? 1 : 0;
		}

		// Back-and-forth rows across the allowed area.
		const strokes: Stroke[] = [];
		let row = 0;
		for (let y = cell * 0.5; y < o.height; y += step, row += 1) {
			const j = Math.min(h - 1, Math.floor(y / cell));
			const segs: Seg[] = [];
			let start = -1;
			for (let i = 0; i <= w; i += 1) {
				const on = i < w && allowed[j * w + i] === 1;
				if (on && start < 0) start = i;
				if (!on && start >= 0) {
					segs.push({ a: { x: (start + 0.5) * cell, y: (j + 0.5) * cell }, b: { x: (i - 0.5) * cell, y: (j + 0.5) * cell } });
					start = -1;
				}
			}
			const ordered = row % 2 === 0 ? segs : segs.reverse().map((s) => ({ a: s.b, b: s.a }));
			for (const s of ordered) {
				const last = strokes[strokes.length - 1];
				const end = last?.[last.length - 1];
				if (end && staysInside(allowed, grid, end, s.a)) last.push(s.a, s.b);
				else strokes.push([s.a, s.b]);
			}
		}
		// Then once around every outline, for clean walls.
		for (const ring of traceContours(field, w, h)) {
			const pts = simplifyRing(ring, 0.2).map((p) => ({ x: p.x * cell, y: p.y * cell }));
			if (pts.length < 2) continue;
			strokes.push([...pts, pts[0]]);
		}
		passes.push({ depth, strokes });

		// Where the bit reaches at this depth: within its radius of an allowed centre.
		if (levels.some((d) => Math.abs(d - depth) < 1e-9)) {
			const notAllowed = new Uint8Array(w * h);
			for (let i = 0; i < notAllowed.length; i += 1) notAllowed[i] = allowed[i] ? 0 : 1;
			const toAllowed = distanceToOutside(notAllowed, w, h, false);
			for (let i = 0; i < reached.length; i += 1) if (area[i] && toAllowed[i] <= r / cell + 0.75) reached[i] = Math.max(reached[i], k);
		}
	}

	const share = levels.map(() => 0);
	let missed = 0;
	for (let i = 0; i < reached.length; i += 1) {
		share[reached[i]] += 1;
		if (reached[i] < target[i]) missed += 1;
	}
	return {
		grid,
		target,
		reached,
		passes,
		width: o.width,
		height: o.height,
		share: share.map((s) => s / reached.length),
		missed: missed / reached.length,
	};
};
