/**
 * Adaptive clearing: a path that keeps the load on the bit about even.
 *
 * Rings and rows have the bit cutting at the stepover most of the time, but in corners and at the
 * start of each ring it can take far more material at once (up to a full-width slot), and the
 * radial force jumps. Here the material is tracked on the picture grid while the path is made:
 *
 * - The bit moves in short steps. At each step it tries headings within ±90° of where it is going
 *   and counts, for each, how much material its disc would remove (the engagement). It takes the one
 *   closest to the target load (what a straight cut at the stepover removes per step), turning as
 *   little as it can and preferring material on its left, which is climb milling with a clockwise
 *   spindle. Headings that would load the bit much more than the target are refused. The result is
 *   a smooth, spiralling path that follows the edge of the material at a steady load.
 * - Where it has to start inside solid material it first cuts a small circle (ramped in by the
 *   writer), so it never ploughs a full-width slot.
 * - When an area runs out of material it moves to the nearest material left, staying down when the
 *   way there is already clear and close, lifting otherwise.
 * - It keeps one stepover away from the walls, so the final pass along the walls takes an even band
 *   of exactly the stepover, for a clean edge at the same load.
 *
 * Each step costs one engagement count per heading tried (a few thousand cell reads), so a pass
 * plans in a fraction of a second.
 */

import { distanceToOutside, type Grid, pointInRing, type Pt, ringArea, ringsToMm, simplifyLine, simplifyRing, traceContours } from "./picture";

type Stroke = Pt[];

/** Cell offsets inside a disc of `rc` cells. */
const discOffsets = (rc: number): [number, number][] => {
	const R = Math.ceil(rc);
	const out: [number, number][] = [];
	for (let dy = -R; dy <= R; dy += 1) for (let dx = -R; dx <= R; dx += 1) if (dx * dx + dy * dy <= rc * rc) out.push([dx, dy]);
	return out;
};

/** The walls (where `field` crosses 0) as closed rings with the area on their right: climb milling. */
export const wallRings = (grid: Grid, field: Float32Array): Stroke[] => {
	const rings = ringsToMm(grid, traceContours(field, grid.w, grid.h))
		.map((ring) => simplifyRing(ring, grid.cell * 0.2))
		.filter((ring) => ring.length >= 3);
	return rings.map((ring) => {
		const hole = rings.filter((o) => o !== ring && pointInRing(ring[0], o)).length % 2 === 1;
		const pts = hole !== ringArea(ring) > 0 ? [...ring].reverse() : ring;
		return [...pts, pts[0]];
	});
};

export type AdaptiveOptions = {
	/** Radial depth of cut the load is matched to, mm (the stepover). */
	stepover: number;
	/** Bit radius, mm. */
	radius: number;
	/** Most steps to take in one pass: a guard, far above what a real job needs. */
	maxSteps?: number;
};

/**
 * The adaptive path for one pass. `field` is the distance from the wall in cells (positive where the
 * bit's centre may go), `allowed` marks those cells, and `area` the cells cut at this pass.
 */
export const adaptiveStrokes = (grid: Grid, field: Float32Array, allowed: Uint8Array, area: Uint8Array, o: AdaptiveOptions): Stroke[] => {
	const { w, h, cell } = grid;
	const rc = o.radius / cell;
	const disc = discOffsets(rc);

	// The adaptive part keeps one stepover further from the walls than the bit could go, leaving an
	// even band that the final wall pass takes at exactly the stepover: no chasing slivers into walls.
	const band = o.stepover / cell;
	const inner = new Uint8Array(w * h);
	for (let i = 0; i < inner.length; i += 1) inner[i] = allowed[i] && field[i] > band ? 1 : 0;
	allowed = inner;

	// The material to remove: cells of the area the bit can reach from an allowed centre.
	const notAllowed = new Uint8Array(w * h);
	for (let i = 0; i < notAllowed.length; i += 1) notAllowed[i] = allowed[i] ? 0 : 1;
	const toAllowed = distanceToOutside(notAllowed, w, h, false);
	const mat = new Uint8Array(w * h);
	let remaining = 0;
	for (let i = 0; i < mat.length; i += 1)
		if (area[i] && toAllowed[i] <= rc + 0.75) {
			mat[i] = 1;
			remaining += 1;
		}
	const tail = Math.max(2, remaining * 0.002); // what the wall pass mops up

	// cnt[k] = material under the bit with its centre on cell k. Kept up to date as cells are cut, so
	// "how much would the bit take here" is one lookup instead of a scan of its disc.
	const offs = disc.map(([dx, dy]) => [dx, dy, dy * w + dx] as const);
	const cnt = new Int32Array(w * h);
	const RR = Math.ceil(rc);
	const spread = (k: number, by: number) => {
		const i = k % w, j = (k - i) / w;
		if (i >= RR && j >= RR && i < w - RR && j < h - RR) {
			for (const o of offs) cnt[k + o[2]] += by;
			return;
		}
		for (const [dx, dy, d] of offs) {
			const ni = i + dx, nj = j + dy;
			if (ni >= 0 && nj >= 0 && ni < w && nj < h) cnt[k + d] += by;
		}
	};
	for (let k = 0; k < mat.length; k += 1) if (mat[k]) spread(k, 1);

	const ij = (p: Pt) => [Math.floor((p.x - grid.x0) / cell), Math.floor((p.y - grid.y0) / cell)] as const;
	const centre = (i: number, j: number): Pt => ({ x: grid.x0 + (i + 0.5) * cell, y: grid.y0 + (j + 0.5) * cell });
	const isAllowed = (p: Pt) => {
		const [i, j] = ij(p);
		return i >= 0 && j >= 0 && i < w && j < h && allowed[j * w + i] === 1;
	};
	/** Material under the bit's disc at `p`, split by the side of `dir` it lies on (left = climb). */
	const engage = (p: Pt, dx = 0, dy = 0) => {
		const [ci, cj] = ij(p);
		let n = 0, right = 0;
		for (const [ox, oy] of disc) {
			const i = ci + ox, j = cj + oy;
			if (i < 0 || j < 0 || i >= w || j >= h || !mat[j * w + i]) continue;
			n += 1;
			if (dx * oy - dy * ox < 0) right += 1;
		}
		return { n, right };
	};
	const under = (p: Pt) => {
		const [i, j] = ij(p);
		return i >= 0 && j >= 0 && i < w && j < h ? cnt[j * w + i] : 0;
	};
	const R = Math.ceil(rc);
	const cut = (p: Pt) => {
		const [ci, cj] = ij(p);
		const k0 = cj * w + ci;
		// Away from the edges no bounds checks are needed.
		const inside = ci >= R && cj >= R && ci < w - R && cj < h - R;
		for (const [dx, dy, d] of offs) {
			if (!inside) {
				const i = ci + dx, j = cj + dy;
				if (i < 0 || j < 0 || i >= w || j >= h) continue;
			}
			const k = k0 + d;
			if (mat[k]) {
				mat[k] = 0;
				remaining -= 1;
				spread(k, -1);
			}
		}
	};
	/** Cuts along a straight move, every cell (the disc is many cells wide, so nothing slips between). */
	const sweep = (a: Pt, b: Pt) => {
		const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / cell));
		for (let s = 1; s <= n; s += 1) cut({ x: a.x + ((b.x - a.x) * s) / n, y: a.y + ((b.y - a.y) * s) / n });
	};
	/** The most material under the bit along a straight move, and whether its centre stays on allowed cells. */
	const moveCost = (a: Pt, b: Pt) => {
		const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (cell * 0.5)));
		let most = 0;
		for (let s = 1; s <= n; s += 1) {
			const p = { x: a.x + ((b.x - a.x) * s) / n, y: a.y + ((b.y - a.y) * s) / n };
			if (!isAllowed(p)) return { ok: false, most };
			most = Math.max(most, under(p));
		}
		return { ok: true, most };
	};

	/** Where to start next: the allowed centre nearest `from` whose disc touches the material closest to `from`. */
	const findStart = (from: Pt | null): Pt | null => {
		while (remaining > tail) {
			let best = -1, bestD = Infinity;
			const [fi, fj] = from ? ij(from) : [0, 0];
			for (let k = 0; k < mat.length; k += 1) {
				if (!mat[k]) continue;
				const i = k % w, j = (k - i) / w;
				// With nowhere to come from, start where the material is furthest from the walls.
				const d = from ? (i - fi) ** 2 + (j - fj) ** 2 : -field[k];
				if (d < bestD) {
					bestD = d;
					best = k;
				}
			}
			if (best < 0) return null;
			const mi = best % w, mj = (best - mi) / w;
			const R = Math.ceil(rc);
			let pick: Pt | null = null, pickD = Infinity;
			for (let dj = -R; dj <= R; dj += 1)
				for (let di = -R; di <= R; di += 1) {
					const i = mi + di, j = mj + dj;
					if (i < 0 || j < 0 || i >= w || j >= h || !allowed[j * w + i] || di * di + dj * dj > rc * rc) continue;
					const c = centre(i, j);
					const d = from ? (c.x - from.x) ** 2 + (c.y - from.y) ** 2 : -field[j * w + i];
					if (d < pickD) {
						pickD = d;
						pick = c;
					}
				}
			if (pick) return pick;
			// No centre's disc covers it: the bit can't take that cell, so forget it.
			mat[best] = 0;
			remaining -= 1;
		}
		return null;
	};

	/**
	 * The way to the nearest material through ground the bit has already cleared, so it can stay down:
	 * a breadth-first search over allowed cells where the bit touches no material, ending at the first
	 * cell where it does. Null when no such way exists (the material is in another area).
	 */
	// Search buffers, made once: each search resets only the cells it touched.
	const prev = new Int32Array(w * h).fill(-1);
	const queue = new Int32Array(w * h);
	const clearWay = (from: Pt): Pt[] | null => {
		const [fi, fj] = ij(from);
		if (fi < 0 || fj < 0 || fi >= w || fj >= h) return null;
		const loadAt = (k: number) => cnt[k];
		const start = fj * w + fi;
		prev[start] = start;
		let head = 0, tail = 0;
		queue[tail++] = start;
		let goal = -1;
		while (head < tail) {
			const k = queue[head++];
			if (k !== start && loadAt(k) > 0) {
				goal = k;
				break;
			}
			const i = k % w, j = (k - i) / w;
			for (let dj = -1; dj <= 1; dj += 1)
				for (let di = -1; di <= 1; di += 1) {
					const ni = i + di, nj = j + dj;
					if ((di === 0 && dj === 0) || ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
					const n = nj * w + ni;
					if (prev[n] >= 0 || !allowed[n]) continue;
					prev[n] = k;
					queue[tail++] = n;
				}
		}
		const path: number[] = [];
		if (goal >= 0) for (let k = goal; k !== start; k = prev[k]) path.push(k);
		// Reset what this search touched (the material changes as soon as the bit moves on).
		for (let q = 0; q < tail; q += 1) prev[queue[q]] = -1;
		if (goal < 0) return null;
		path.reverse();
		const pts = path.map((k) => centre(k % w, (k - (k % w)) / w));
		return simplifyLine([from, ...pts], cell * 0.5);
	};

	const stepLen = Math.max(cell * 1.2, o.radius * 0.35);
	// What a straight cut at the stepover removes per step, in cells; never more than ~1.6× that.
	const target = Math.max(1, (o.stepover * stepLen) / (cell * cell));
	const most = target * 1.6;
	const full = disc.length;
	const turns: number[] = [];
	for (let a = -90; a <= 90; a += 15) turns.push((a * Math.PI) / 180);
	turns.sort((a, b) => Math.abs(a) - Math.abs(b));
	// When nothing lies ahead (the end of a cut), look the rest of the way round before searching further.
	const behind: number[] = [];
	for (let a = 105; a <= 255; a += 15) behind.push((a * Math.PI) / 180);
	behind.sort((a, b) => Math.abs(a - Math.PI) - Math.abs(b - Math.PI)).reverse();

	const strokes: Stroke[] = [];
	let stroke: Stroke | null = null;
	let pos: Pt | null = null;
	let heading = 0;
	const maxSteps = o.maxSteps ?? 400000;

	for (let guard = 0; guard < maxSteps && remaining > tail; guard += 1) {
		if (!stroke) {
			// Best: carry on through cleared ground, staying down.
			const way: Pt[] | null = pos && strokes.length ? clearWay(pos) : null;
			if (way && way.length >= 2) {
				const into: Stroke = strokes[strokes.length - 1];
				for (const p of way.slice(1)) {
					sweep(into[into.length - 1], p);
					into.push(p);
				}
				stroke = into;
				const end: Pt = way[way.length - 1], before: Pt = way[way.length - 2];
				pos = end;
				heading = Math.atan2(end.y - before.y, end.x - before.x);
				continue;
			}
			const start = findStart(pos);
			if (!start) break;
			// Stay down if the way there is close and never buries the bit; otherwise lift.
			const last = strokes[strokes.length - 1];
			const link = pos && Math.hypot(start.x - pos.x, start.y - pos.y) < o.radius * 10 ? moveCost(pos, start) : null;
			if (last && pos && link?.ok && link.most <= full * 0.35) {
				sweep(pos, start);
				stroke = last;
				stroke.push(start);
			} else {
				stroke = [start];
				strokes.push(stroke);
			}
			pos = start;
			// Buried in material: open a small circle first rather than plough a slot.
			if (engage(pos).n > full * 0.5) {
				const room = Math.max(cell, Math.min(o.radius * 0.8, field[ij(pos)[1] * w + ij(pos)[0]] * cell));
				const c = pos;
				const n = Math.max(8, Math.ceil((2 * Math.PI * room) / stepLen));
				// Out to the circle, round it clockwise (climb), back to the middle.
				const ring: Pt[] = [];
				for (let s = 0; s <= n; s += 1) {
					const a = -(2 * Math.PI * s) / n;
					ring.push({ x: c.x + room * Math.cos(a), y: c.y + room * Math.sin(a) });
				}
				for (const p of [...ring, c]) {
					if (!isAllowed(p)) continue;
					sweep(stroke[stroke.length - 1], p);
					stroke.push(p);
				}
				pos = c;
			} else {
				cut(pos);
			}
			// Head towards the material that is left nearby.
			let best = -1;
			for (let a = 0; a < 24; a += 1) {
				const t = (a / 24) * 2 * Math.PI;
				const q = { x: pos.x + stepLen * Math.cos(t), y: pos.y + stepLen * Math.sin(t) };
				if (!isAllowed(q)) continue;
				const e = engage(q, Math.cos(t), Math.sin(t));
				const score = Math.abs(e.n - target) + e.right * 0.5;
				if (e.n > 0 && (best < 0 || score < best)) {
					best = score;
					heading = t;
				}
			}
			continue;
		}

		// One step: the heading whose load is closest to the target.
		const here: Pt = pos as Pt;
		let pick: { q: Pt; t: number; score: number } | null = null;
		let gentlest: { q: Pt; t: number; n: number } | null = null;
		for (const [ti, turn] of [...turns, ...behind].entries()) {
			if (ti === turns.length && (pick || gentlest)) break;
			const t = heading + turn;
			const dx = Math.cos(t), dy = Math.sin(t);
			const q: Pt = { x: here.x + stepLen * dx, y: here.y + stepLen * dy };
			if (!isAllowed(q)) continue;
			const n = under(q);
			// Light moves are fine (they keep the stroke going); only a move through bare air ends it.
			if (n === 0) continue;
			if (!gentlest || n < gentlest.n) gentlest = { q, t, n };
			if (n > most) continue;
			// Which side the material is on only matters for a heading that could win.
			if (pick && Math.abs(n - target) / target + Math.abs(turn) * 0.15 >= pick.score) continue;
			const e = engage(q, dx, dy);
			const score = Math.abs(e.n - target) / target + Math.abs(turn) * 0.15 + (e.right / Math.max(1, e.n)) * 0.6;
			if (!pick || score < pick.score) pick = { q, t, score };
		}
		// Only heavy moves left here: take the lightest, if it is still well short of a slot.
		const step: { q: Pt; t: number } | null = pick ?? (gentlest && gentlest.n < full * 0.6 ? gentlest : null);
		if (!step) {
			// Nothing worth cutting from here: finish this stroke and look for material elsewhere.
			stroke = null;
			continue;
		}
		sweep(here, step.q);
		pos = step.q;
		heading = step.t;
		stroke!.push(pos);
	}

	// Fewer, longer moves where the path runs straight.
	const out = strokes.filter((s) => s.length >= 2).map((s) => simplifyLine(s, cell * 0.15));
	// One pass along the walls for a clean edge.
	return [...out, ...wallRings(grid, field)];
};
