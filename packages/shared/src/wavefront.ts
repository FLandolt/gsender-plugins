/**
 * Adaptive clearing with smooth spirals: a wavefront from the middle of each area.
 *
 * Picture a pebble dropped at the deepest point of an area (the point furthest from its walls). The
 * ripple spreads in circles, bends round islands and stops at the walls. Measure for every spot how
 * far the ripple travels to reach it, going round obstacles, never through them (a geodesic
 * distance), and draw that distance's outlines one stepover apart: curves that start as circles and
 * gradually take on the area's shape.
 *
 * The bit cuts those curves one after another, from the inside out:
 * - Neighbouring curves are always one stepover apart, so the bit takes about the stepover all the
 *   way along: an even load, with no full-width cuts and no spikes in inside corners, because the
 *   material is only ever taken from a smoothly growing front.
 * - Each curve is drawn whole (an outline of a smooth distance map), so the path is made of smooth
 *   arcs and spirals instead of wobbling step by step.
 * - Where a curve reaches a wall it ends there; the walls get one clean pass at the end.
 * - Arcs that end on walls are cut back and forth by default ("both ways": the bit steps along the
 *   wall onto the next arc, half the arcs are then conventional), or all with the material on their
 *   left ("climb only", climb milling with a clockwise spindle), going back through cleared ground
 *   between them. Closed loops are always climb, and the bit steps onto the next one diagonally,
 *   like a spiral. The bit stays down when the way is clear and lifts only when there is none.
 *
 * The distances come from one shortest-path sweep per pass over the grid, with 16 directions of
 * travel so the circles come out round, not octagonal. Cheap enough to plan live.
 */

import { wallRings } from "./walls";
import { distanceToOutside, type Grid, type Pt, ringsToMm, simplifyLine, simplifyRing, traceContours } from "./picture";

type Stroke = Pt[];

/** Moves for the distance sweep: 8 neighbours plus the 8 knight's moves, with their true lengths. */
const MOVES: [number, number, number][] = [
	[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
	[1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
	[2, 1, Math.sqrt(5)], [2, -1, Math.sqrt(5)], [-2, 1, Math.sqrt(5)], [-2, -1, Math.sqrt(5)],
	[1, 2, Math.sqrt(5)], [1, -2, Math.sqrt(5)], [-1, 2, Math.sqrt(5)], [-1, -2, Math.sqrt(5)],
];

/**
 * Distance (in cells) from the seeds to every allowed cell, travelling only over allowed cells.
 * Dijkstra with a binary heap; a knight's move also needs the two cells it passes between.
 */
export const geodesicDistance = (allowed: Uint8Array, w: number, h: number, seeds: number[]): Float64Array => {
	const dist = new Float64Array(w * h).fill(Infinity);
	const heap: number[] = [];
	const keys: number[] = [];
	const push = (k: number, d: number) => {
		heap.push(k);
		keys.push(d);
		let i = heap.length - 1;
		while (i > 0) {
			const p = (i - 1) >> 1;
			if (keys[p] <= keys[i]) break;
			[heap[p], heap[i]] = [heap[i], heap[p]];
			[keys[p], keys[i]] = [keys[i], keys[p]];
			i = p;
		}
	};
	const pop = (): [number, number] => {
		const top: [number, number] = [heap[0], keys[0]];
		const lastK = heap.pop()!, lastD = keys.pop()!;
		if (heap.length) {
			heap[0] = lastK;
			keys[0] = lastD;
			let i = 0;
			for (;;) {
				const l = 2 * i + 1, r = l + 1;
				let m = i;
				if (l < heap.length && keys[l] < keys[m]) m = l;
				if (r < heap.length && keys[r] < keys[m]) m = r;
				if (m === i) break;
				[heap[m], heap[i]] = [heap[i], heap[m]];
				[keys[m], keys[i]] = [keys[i], keys[m]];
				i = m;
			}
		}
		return top;
	};
	for (const s of seeds) {
		dist[s] = 0;
		push(s, 0);
	}
	const ok = (i: number, j: number) => i >= 0 && j >= 0 && i < w && j < h && allowed[j * w + i] === 1;
	while (heap.length) {
		const [k, d] = pop();
		if (d > dist[k]) continue;
		const i = k % w, j = (k - i) / w;
		for (const [dx, dy, len] of MOVES) {
			const ni = i + dx, nj = j + dy;
			if (!ok(ni, nj)) continue;
			// A knight's move must not cut a corner: both cells it passes between must be open.
			if (Math.abs(dx) + Math.abs(dy) === 3) {
				const sx = Math.sign(dx), sy = Math.sign(dy);
				if (Math.abs(dx) === 2 ? !ok(i + sx, j) || !ok(i + sx, j + sy) : !ok(i, j + sy) || !ok(i + sx, j + sy)) continue;
			}
			const n = nj * w + ni, nd = d + len;
			if (nd < dist[n]) {
				dist[n] = nd;
				push(n, nd);
			}
		}
	}
	return dist;
};

/** One seed per connected piece of the allowed area: its cell furthest from the walls. */
const seedsOf = (allowed: Uint8Array, field: Float32Array, w: number, h: number): number[] => {
	const label = new Int32Array(w * h).fill(-1);
	const seeds: number[] = [];
	const queue = new Int32Array(w * h);
	for (let s = 0; s < allowed.length; s += 1) {
		if (!allowed[s] || label[s] >= 0) continue;
		let head = 0, tail = 0, best = s;
		queue[tail++] = s;
		label[s] = seeds.length;
		while (head < tail) {
			const k = queue[head++];
			if (field[k] > field[best]) best = k;
			const i = k % w, j = (k - i) / w;
			for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
				const ni = i + dx, nj = j + dy;
				if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
				const n = nj * w + ni;
				if (allowed[n] && label[n] < 0) {
					label[n] = seeds.length;
					queue[tail++] = n;
				}
			}
		}
		seeds.push(best);
	}
	return seeds;
};

export type WavefrontOptions = {
	/** Spacing of the curves, mm (the stepover). */
	stepover: number;
	/** Bit radius, mm. */
	radius: number;
	/** Let arcs alternate direction (half of them conventional) instead of always climb: much less travel. */
	bothWays?: boolean;
};

/**
 * The wavefront path for one pass. `field` is the distance from the wall in cells (positive where the
 * bit's centre may go) and `allowed` marks those cells.
 */
export const wavefrontStrokes = (grid: Grid, field: Float32Array, allowed: Uint8Array, o: WavefrontOptions): Stroke[] => {
	const { w, h, cell } = grid;
	const seeds = seedsOf(allowed, field, w, h);
	if (seeds.length === 0) return wallRings(grid, field);
	const dist = geodesicDistance(allowed, w, h, seeds);
	let far = 0;
	for (let i = 0; i < dist.length; i += 1) if (allowed[i] && dist[i] > far) far = dist[i];
	const step = o.stepover / cell;

	const ij = (p: Pt) => [Math.floor((p.x - grid.x0) / cell), Math.floor((p.y - grid.y0) / cell)] as const;
	/** Geodesic distance at a point (bilinear between cell centres), Infinity off the allowed area. */
	const distAt = (p: Pt): number => {
		const u = (p.x - grid.x0) / cell - 0.5, v = (p.y - grid.y0) / cell - 0.5;
		const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
		let s = 0, wsum = 0;
		for (const [di, dj, wt] of [[0, 0, (1 - fu) * (1 - fv)], [1, 0, fu * (1 - fv)], [0, 1, (1 - fu) * fv], [1, 1, fu * fv]] as const) {
			const i = i0 + di, j = j0 + dj;
			if (i < 0 || j < 0 || i >= w || j >= h) continue;
			const d = dist[j * w + i];
			if (!Number.isFinite(d) || wt === 0) continue;
			s += d * wt;
			wsum += wt;
		}
		return wsum > 0 ? s / wsum : Infinity;
	};
	const fieldAt = (p: Pt) => {
		const [i, j] = ij(p);
		return i >= 0 && j >= 0 && i < w && j < h ? field[j * w + i] : -1;
	};

	// The curves, level by level, split where they run along a wall, turned so the material
	// (further out, a larger distance) is on their left.
	type Arc = { pts: Pt[]; children: Arc[]; parent?: Arc };
	const levels: Arc[][] = [];
	const f = new Float32Array(w * h);
	// Where each curve can be: cells within a couple of cells of its distance, plus the cells along
	// the walls (where it ends), so the tracer needn't scan the whole grid for every curve.
	const edge: number[] = [];
	for (let k = 0; k < allowed.length; k += 1) {
		if (!allowed[k]) continue;
		const i = k % w, j = (k - i) / w;
		if (i === 0 || j === 0 || i === w - 1 || j === h - 1 || !allowed[k - 1] || !allowed[k + 1] || !allowed[k - w] || !allowed[k + w]) edge.push(k);
	}
	const nLevels = Math.ceil(far / step) + 1;
	const bands: number[][] = Array.from({ length: nLevels + 1 }, () => []);
	for (let k = 0; k < dist.length; k += 1) {
		if (!allowed[k] || !Number.isFinite(dist[k])) continue;
		const lo = Math.max(1, Math.ceil((dist[k] - 2) / step)), hi = Math.min(nLevels, Math.floor((dist[k] + 2) / step));
		for (let m = lo; m <= hi; m += 1) bands[m].push(k);
	}
	for (let k = 0; k < f.length; k += 1) f[k] = 1;
	for (let m = 1, level = step; level < far + step * 0.5; m += 1, level += step) {
		const near = [...bands[m], ...edge.filter((k) => dist[k] > level - 2)];
		// Only the cells the tracer will read need the new values.
		for (const k of near) {
			const i = k % w, j = (k - i) / w;
			for (let dj = -1; dj <= 1; dj += 1)
				for (let di = -1; di <= 1; di += 1) {
					const ni = i + di, nj = j + dj;
					if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
					const q = nj * w + ni;
					f[q] = allowed[q] ? level - dist[q] : 1;
				}
		}
		const arcs: Stroke[] = [];
		for (const ring of ringsToMm(grid, traceContours(f, w, h, near))) {
			// A curve that never touches a wall stays a closed loop; otherwise it is cut at the walls.
			const onFront = ring.map((p) => fieldAt(p) > 0.5);
			if (onFront.every(Boolean)) {
				arcs.push([...ring, ring[0]]);
				continue;
			}
			const start = onFront.indexOf(false);
			let cur: Pt[] = [];
			for (let n = 1; n <= ring.length; n += 1) {
				const idx = (start + n) % ring.length;
				if (onFront[idx]) cur.push(ring[idx]);
				else {
					if (cur.length >= 2) arcs.push(cur);
					cur = [];
				}
			}
			if (cur.length >= 2) arcs.push(cur);
		}
		for (const arc of arcs) {
			// Material on the left: going from the arc's first point, the distance must grow to the left.
			const m = Math.floor(arc.length / 2);
			const a = arc[Math.max(0, m - 1)], b = arc[Math.min(arc.length - 1, m + 1)];
			const tx = b.x - a.x, ty = b.y - a.y, len = Math.hypot(tx, ty) || 1;
			const probe = { x: arc[m].x - (ty / len) * cell, y: arc[m].y + (tx / len) * cell };
			if (!(distAt(probe) > level)) arc.reverse();
		}
		levels.push(
			arcs
				.filter((a) => a.length >= 2)
				.map((arc) => {
					// A closed loop (start = end) is simplified as a ring: as a line it would collapse to its end points.
					const closed = arc.length > 3 && Math.hypot(arc[0].x - arc[arc.length - 1].x, arc[0].y - arc[arc.length - 1].y) < 1e-9;
					const simple = closed ? simplifyRing(arc.slice(0, -1), cell * 0.1) : simplifyLine(arc, cell * 0.1);
					return { pts: closed ? [...simple, simple[0]] : simple, children: [] as Arc[] };
				}),
		);
	}

	// Each curve belongs to the nearest curve one level further in: the wavefront as a tree, which
	// branches where it splits into lobes. Cutting it branch by branch finishes one lobe before the
	// next, so the links stay short.
	const near2 = (p: Pt, pts: Pt[]) => {
		let best = Infinity;
		for (const q of pts) best = Math.min(best, (q.x - p.x) ** 2 + (q.y - p.y) ** 2);
		return best;
	};
	const roots: Arc[] = [...(levels[0] ?? [])];
	for (let k = 1; k < levels.length; k += 1)
		for (const arc of levels[k]) {
			const mid = arc.pts[Math.floor(arc.pts.length / 2)];
			let parent: Arc | null = null, bd = Infinity;
			for (const o of levels[k - 1]) {
				const d = near2(mid, o.pts);
				if (d < bd) {
					bd = d;
					parent = o;
				}
			}
			if (parent) arc.parent = parent;
			(parent ? parent.children : roots).push(arc);
		}
	const order: { pts: Stroke; via: Pt | null }[] = [];
	let at: Pt | null = null;
	const visit = (list: Arc[]) => {
		const left = [...list];
		while (left.length) {
			let bi = 0, bd = Infinity;
			left.forEach((a, i) => {
				const d = at ? (a.pts[0].x - at.x) ** 2 + (a.pts[0].y - at.y) ** 2 : 0;
				if (d < bd) {
					bd = d;
					bi = i;
				}
			});
			const arc = left.splice(bi, 1)[0];
			// A closed loop can start anywhere: start it at its point nearest the bit.
			const pts = arc.pts;
			const closed = pts.length > 3 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-9;
			if (closed && at) {
				// Step onto it diagonally forward (about 27°), as a spiral would, not straight sideways.
				const prevPts = order.length ? order[order.length - 1].pts : null;
				let aim: Pt = at;
				if (prevPts && prevPts.length >= 2) {
					const p1 = prevPts[prevPts.length - 2], p2 = prevPts[prevPts.length - 1];
					const l = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
					aim = { x: at.x + ((p2.x - p1.x) / l) * o.stepover * 2, y: at.y + ((p2.y - p1.y) / l) * o.stepover * 2 };
				}
				const ring = pts.slice(0, -1);
				let best = 0, bdd = Infinity;
				ring.forEach((p, i) => {
					const d = (p.x - aim.x) ** 2 + (p.y - aim.y) ** 2;
					if (d < bdd) {
						bdd = d;
						best = i;
					}
				});
				const rot = [...ring.slice(best), ...ring.slice(0, best)];
				arc.pts = [...rot, rot[0]];
			}
			// Both ways: an open arc may be cut backwards when its end is the nearer, so the bit just steps
			// along the wall to it instead of travelling back across the area.
			if (o.bothWays && !closed && at) {
				const e = arc.pts[arc.pts.length - 1], b0 = arc.pts[0];
				if ((e.x - at.x) ** 2 + (e.y - at.y) ** 2 < (b0.x - at.x) ** 2 + (b0.y - at.y) ** 2) arc.pts = [...arc.pts].reverse();
			}
			// An open arc is best reached via the start of the arc it grew from, then along the wall.
			order.push({ pts: arc.pts, via: !closed && arc.parent && !o.bothWays ? arc.parent.pts[0] : null });
			at = arc.pts[arc.pts.length - 1];
			visit(arc.children);
		}
	};
	visit(roots);

	// Join the arcs. The material actually removed is stamped as the bit goes, so a link is judged by
	// what it would really hit: it stays down when the way is clear (but for a short last approach
	// onto the next curve, at most about one stepover); otherwise the bit lifts.
	const rc = o.radius / cell;
	const R = Math.ceil(rc);
	const disc: number[][] = [];
	for (let dy = -R; dy <= R; dy += 1) for (let dx = -R; dx <= R; dx += 1) if (dx * dx + dy * dy <= rc * rc) disc.push([dx, dy]);
	// Material: what the bit can reach from where its centre may go.
	const toAllowed = distanceToOutside(allowed.map((v) => (v ? 0 : 1)), w, h, false);
	const removed = new Uint8Array(w * h);
	for (let k = 0; k < removed.length; k += 1) removed[k] = toAllowed[k] <= rc + 0.75 ? 0 : 1;
	const fits = (p: Pt) => {
		const [i, j] = ij(p);
		return i >= 0 && j >= 0 && i < w && j < h && allowed[j * w + i] === 1;
	};
	const stamp = (pts: Pt[]) => {
		for (let k = 0; k < pts.length; k += 1) {
			const a = pts[Math.max(0, k - 1)], b = pts[k];
			const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / cell));
			for (let t = k === 0 ? 0 : 1; t <= n; t += 1) {
				const [ci, cj] = ij({ x: a.x + ((b.x - a.x) * t) / n, y: a.y + ((b.y - a.y) * t) / n });
				for (const [dx, dy] of disc) {
					const i = ci + dx, j = cj + dy;
					if (i >= 0 && j >= 0 && i < w && j < h) removed[j * w + i] = 1;
				}
			}
		}
	};
	const approach = o.stepover * 1.25;
	/** New material a step from cell (pi, pj) to (ci, cj) would take: uncut cells its disc gains. */
	const gained = (pi: number, pj: number, ci: number, cj: number) => {
		let n = 0;
		for (const [dx, dy] of disc) {
			const i = ci + dx, j = cj + dy;
			if (i < 0 || j < 0 || i >= w || j >= h || removed[j * w + i]) continue;
			if ((i - pi) ** 2 + (j - pj) ** 2 > rc * rc) n += 1;
		}
		return n;
	};
	// A link may take at most about the stepover's worth of material per step (as cutting would).
	const most = Math.max(1, (o.stepover / cell) * 1.5);
	const linkOk = (a: Pt, b: Pt) => {
		const L = Math.hypot(b.x - a.x, b.y - a.y);
		const n = Math.max(1, Math.ceil(L / cell));
		let [pi, pj] = ij(a);
		for (let t = 1; t < n; t += 1) {
			const p = { x: a.x + ((b.x - a.x) * t) / n, y: a.y + ((b.y - a.y) * t) / n };
			if (!fits(p)) return false;
			const [ci, cj] = ij(p);
			if (ci === pi && cj === pj) continue;
			if (L * (1 - t / n) > approach && gained(pi, pj, ci, cj) > most) return false;
			pi = ci;
			pj = cj;
		}
		return true;
	};
	/** Material under the bit's disc at cell (ci, cj) not yet removed. */
	const under = (ci: number, cj: number) => {
		let n = 0;
		for (const [dx, dy] of disc) {
			const i = ci + dx, j = cj + dy;
			if (i >= 0 && j >= 0 && i < w && j < h && !removed[j * w + i]) n += 1;
		}
		return n;
	};
	/**
	 * A short way round when the straight line leaves the area (two arc ends on a curved wall): a local
	 * breadth-first search over cells where the bit fits and isn't buried in material.
	 */
	const prev = new Int32Array(w * h).fill(-1);
	const queue = new Int32Array(w * h);
	const wayRound = (a: Pt, b: Pt): Pt[] | null => {
		const [ai, aj] = ij(a), [bi, bj] = ij(b);
		const reach = Math.hypot(bi - ai, bj - aj) + (approach / cell) * 2 + 2;
		if (reach > (o.stepover / cell) * 8 + 4) return null;
		if (ai < 0 || aj < 0 || ai >= w || aj >= h) return null;
		const s0 = aj * w + ai;
		let head = 0, tail = 0, goal = -1;
		queue[tail++] = s0;
		prev[s0] = s0;
		while (head < tail) {
			const k = queue[head++];
			const i = k % w, j = (k - i) / w;
			if (Math.abs(i - bi) <= 1 && Math.abs(j - bj) <= 1) {
				goal = k;
				break;
			}
			for (let dj = -1; dj <= 1; dj += 1)
				for (let di = -1; di <= 1; di += 1) {
					const ni = i + di, nj = j + dj;
					if ((!di && !dj) || ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
					const n = nj * w + ni;
					if (prev[n] >= 0 || !allowed[n]) continue;
					// Stay near the two ends, and off cells where the bit would be half buried.
					if (Math.hypot(ni - ai, nj - aj) + Math.hypot(ni - bi, nj - bj) > reach) continue;
					if (under(ni, nj) > disc.length * 0.5) continue;
					prev[n] = k;
					queue[tail++] = n;
				}
		}
		const path: Pt[] = [];
		if (goal >= 0) for (let k = goal; k !== s0; k = prev[k]) path.push({ x: grid.x0 + ((k % w) + 0.5) * cell, y: grid.y0 + ((k - (k % w)) / w + 0.5) * cell });
		for (let q = 0; q < tail; q += 1) prev[queue[q]] = -1;
		if (goal < 0) return null;
		return simplifyLine([a, ...path.reverse(), b], cell * 0.4);
	};

	const strokes: Stroke[] = [];
	for (const { pts: arc, via } of order) {
		const last = strokes[strokes.length - 1];
		const end = last?.[last.length - 1];
		if (end && via && linkOk(end, via) && linkOk(via, arc[0])) {
			stamp([end, via, arc[0]]);
			last.push(via, ...arc);
		} else if (end && linkOk(end, arc[0])) {
			stamp([end, arc[0]]);
			last.push(...arc);
		} else {
			const way = end ? wayRound(end, arc[0]) : null;
			if (last && way) {
				stamp(way);
				last.push(...way.slice(1, -1), ...arc);
			} else strokes.push([...arc]);
		}
		stamp(arc);
	}

	// Round the corners where links meet the curves (Chaikin, twice), keeping a rounded point only
	// where the whole bit still fits.
	const round = (pts: Pt[]) => {
		if (pts.length < 3) return pts;
		const out: Pt[] = [pts[0]];
		for (let k = 0; k + 1 < pts.length; k += 1) {
			const a = pts[k], b = pts[k + 1];
			const q = { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 };
			const r = { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 };
			if (k > 0) out.push(fits(q) ? q : a);
			if (k + 2 < pts.length) out.push(fits(r) ? r : b);
		}
		out.push(pts[pts.length - 1]);
		return out;
	};
	const tidy = (st: Stroke) => {
		const r = round(round(st));
		// A stroke that is one closed loop is simplified as a ring: as a line it would collapse.
		const closed = r.length > 3 && Math.hypot(r[0].x - r[r.length - 1].x, r[0].y - r[r.length - 1].y) < 1e-9;
		if (!closed) return simplifyLine(r, cell * 0.05);
		const ring = simplifyRing(r.slice(0, -1), cell * 0.05);
		return [...ring, ring[0]];
	};
	return [...strokes.map(tidy), ...wallRings(grid, field)];
};
