/**
 * Clearing areas of a picture grid, level by level, and writing that as G-code. Used by Height Map
 * (many levels) and by the Picture shape of Pocket Cutout (one level).
 *
 * Each pass depth cuts every cell whose level is at least that deep. The bit's centre may only go
 * where the whole bit fits inside that area (found with a distance transform), so it never cuts into
 * a higher level. Inside it the bit cuts rings at a constant distance from the wall, one stepover
 * apart, from the inside out, ending on the wall (like Pocket Cutout's spiral, for any shape).
 *
 * The rings are cheap: they are outlines of the same distance map, at 0, 1, 2 … stepovers from the
 * wall. Each ring follows the nearest ring one step further out, so each area is cleared from
 * its middle outwards towards each wall in turn; each ring starts at the point nearest where the last one ended, and the bit stays down
 * when that link is short and stays inside the area (a long one lifts, rather than cut a slot). Whatever no ring reached (the middle of a long, thin
 * area with a large stepover) is cleaned up first with a few short rows.
 */

import { adaptiveStrokes } from "./adaptive";
import { cellCentre, distanceToOutside, type Grid, pointInRing, type Pt, ringArea, ringsToMm, simplifyRing, traceContours } from "./picture";

/** One cut at constant depth: a polyline in mm (picture coordinates, Y up). Closed strokes end where they start. */
export type Stroke = Pt[];

export type PassPlan = { depth: number; strokes: Stroke[] };

export type Clearing = {
	passes: PassPlan[];
	/** The level the bit really reaches in each cell (lower than asked where the bit doesn't fit). */
	reached: Uint8Array;
};

/** The pass depths: down to each level in even passes no deeper than `stepdown`. `levels[0]` is the top (0). */
export const passDepths = (levels: number[], stepdown: number): number[] => {
	const out: number[] = [];
	for (let k = 1; k < levels.length; k += 1) {
		const from = levels[k - 1], to = levels[k];
		const n = Math.max(1, Math.ceil((to - from) / stepdown - 1e-9));
		for (let s = 1; s <= n; s += 1) out.push(from + ((to - from) * s) / n);
	}
	return out;
};

/** True when the straight line from `a` to `b` (mm) stays on allowed cells. */
const staysInside = (allowed: Uint8Array, g: Grid, a: Pt, b: Pt): boolean => {
	const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (g.cell * 0.5)));
	for (let s = 0; s <= n; s += 1) {
		const x = a.x + ((b.x - a.x) * s) / n, y = a.y + ((b.y - a.y) * s) / n;
		const i = Math.floor((x - g.x0) / g.cell), j = Math.floor((y - g.y0) / g.cell);
		if (i < 0 || j < 0 || i >= g.w || j >= g.h || !allowed[j * g.w + i]) return false;
	}
	return true;
};

type Loop = { pts: Pt[]; area: number; children: Loop[] };

/** Back-and-forth rows over the cells of `mask`, `spacing` mm apart, joined where the link stays in `allowed`. */
const rowStrokes = (grid: Grid, mask: Uint8Array, allowed: Uint8Array, spacing: number): Stroke[] => {
	const { w, h, cell } = grid;
	const strokes: Stroke[] = [];
	let row = 0;
	for (let y = cell * 0.5; y < h * cell; y += spacing, row += 1) {
		const j = Math.min(h - 1, Math.floor(y / cell));
		const segs: { a: Pt; b: Pt }[] = [];
		let start = -1;
		for (let i = 0; i <= w; i += 1) {
			const on = i < w && mask[j * w + i] === 1;
			if (on && start < 0) start = i;
			if (!on && start >= 0) {
				segs.push({ a: cellCentre(grid, start, j), b: cellCentre(grid, i - 1, j) });
				start = -1;
			}
		}
		const ordered = row % 2 === 0 ? segs : segs.reverse().map((sg) => ({ a: sg.b, b: sg.a }));
		for (const sg of ordered) {
			const last = strokes[strokes.length - 1];
			const end = last?.[last.length - 1];
			if (end && staysInside(allowed, grid, end, sg.a)) last.push(sg.a, sg.b);
			else strokes.push([sg.a, sg.b]);
		}
	}
	return strokes;
};

/** The ring rotated to start at its point nearest `from`, closed (ends where it starts). */
const startNear = (ring: Pt[], from: Pt | undefined): Pt[] => {
	let at = 0;
	if (from) {
		let best = Infinity;
		ring.forEach((pt, i) => {
			const d = (pt.x - from.x) ** 2 + (pt.y - from.y) ** 2;
			if (d < best) {
				best = d;
				at = i;
			}
		});
	}
	const rot = [...ring.slice(at), ...ring.slice(0, at)];
	return [...rot, rot[0]];
};

/**
 * Concentric rings over the allowed area (where `field`, in cells, is positive), `step` mm apart,
 * cut from the inside out. See the comment at the top of the file.
 */
export const ringStrokes = (grid: Grid, field: Float32Array, allowed: Uint8Array, step: number, radius: number): Stroke[] => {
	const { w, h, cell } = grid;
	let maxF = 0;
	for (let i = 0; i < field.length; i += 1) if (field[i] > maxF) maxF = field[i];
	const stepCells = step / cell;

	// The rings at each distance from the wall, oriented with the area on their right (climb milling).
	const levels: Loop[][] = [];
	const shifted = new Float32Array(field.length);
	for (let level = 0; level < maxF; level += stepCells) {
		for (let i = 0; i < field.length; i += 1) shifted[i] = field[i] - level;
		const rings = ringsToMm(grid, traceContours(shifted, w, h))
			.map((ring) => simplifyRing(ring, cell * 0.2))
			.filter((ring) => ring.length >= 3);
		const loops = rings.map((pts) => ({ pts, area: ringArea(pts), children: [] as Loop[] }));
		for (const loop of loops) {
			// A ring inside an odd number of others at the same level goes round an island.
			const hole = loops.filter((o) => o !== loop && pointInRing(loop.pts[0], o.pts)).length % 2 === 1;
			const ccw = loop.area > 0;
			if (hole !== ccw) loop.pts.reverse();
		}
		levels.push(loops);
	}

	// Each ring follows the nearest ring one step further out, so the rings along one wall form a
	// chain (in a frame-shaped area, one along the outside and one round the island), cut in one go.
	const roots: Loop[] = [...(levels[0] ?? [])];
	const near2 = (pt: Pt, ring: Pt[]) => {
		let best = Infinity;
		for (const q of ring) best = Math.min(best, (q.x - pt.x) ** 2 + (q.y - pt.y) ** 2);
		return best;
	};
	for (let k = 1; k < levels.length; k += 1)
		for (const loop of levels[k]) {
			let parent: Loop | null = null, bestD = Infinity;
			for (const o of levels[k - 1]) {
				const d = near2(loop.pts[0], o.pts);
				if (d < bestD) {
					bestD = d;
					parent = o;
				}
			}
			(parent ? parent.children : roots).push(loop);
		}

	// Inside out: a ring's inner rings first, nearest first, then the ring itself.
	const order: Pt[][] = [];
	let at: Pt | undefined;
	const visit = (loops: Loop[]) => {
		const left = [...loops];
		while (left.length) {
			let best = 0, bestD = Infinity;
			left.forEach((l, i) => {
				const d = at ? Math.min(...l.pts.map((pt) => (pt.x - at!.x) ** 2 + (pt.y - at!.y) ** 2)) : 0;
				if (d < bestD) {
					bestD = d;
					best = i;
				}
			});
			const loop = left.splice(best, 1)[0];
			visit(loop.children);
			const ring = startNear(loop.pts, at);
			order.push(ring);
			at = ring[ring.length - 1];
		}
	};
	visit(roots);

	// What the rings don't reach: cleaned up first with short rows.
	const path = new Uint8Array(w * h);
	for (const ring of order)
		for (let k = 1; k < ring.length; k += 1) {
			const a = ring[k - 1], b = ring[k];
			const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (cell * 0.5)));
			for (let s = 0; s <= n; s += 1) {
				const i = Math.floor((a.x + ((b.x - a.x) * s) / n - grid.x0) / cell), j = Math.floor((a.y + ((b.y - a.y) * s) / n - grid.y0) / cell);
				if (i >= 0 && j >= 0 && i < w && j < h) path[j * w + i] = 1;
			}
		}
	const notPath = path.map((v) => (v ? 0 : 1));
	const toPath = distanceToOutside(notPath, w, h, false);
	const missed = new Uint8Array(w * h);
	let anyMissed = false;
	for (let i = 0; i < missed.length; i += 1)
		if (allowed[i] && toPath[i] * cell > radius * 0.95) {
			missed[i] = 1;
			anyMissed = true;
		}
	const strokes: Stroke[] = [];
	if (anyMissed) {
		// Rows closer than the bit's radius over the missed spots and a margin round them, so none slips between rows.
		const spacing = radius * 0.9;
		const toMissed = distanceToOutside(missed.map((v) => (v ? 0 : 1)), w, h, false);
		const near = new Uint8Array(w * h);
		for (let i = 0; i < near.length; i += 1) near[i] = allowed[i] && toMissed[i] * cell <= spacing ? 1 : 0;
		strokes.push(...rowStrokes(grid, near, allowed, spacing));
	}

	// Join the rings into strokes, staying down where the link stays inside. The wall ring lies on the
	// edge of the allowed area, so links may touch that edge (the area already keeps half a cell spare).
	const linkable = new Uint8Array(w * h);
	for (let i = 0; i < linkable.length; i += 1) linkable[i] = field[i] > -0.75 ? 1 : 0;
	// A long link would plough a full-depth slot through material not cleared yet: lift instead.
	const maxLink = Math.max(2 * step, 2 * radius);
	for (const ring of order) {
		const last = strokes[strokes.length - 1];
		const end = last?.[last.length - 1];
		if (end && Math.hypot(ring[0].x - end.x, ring[0].y - end.y) <= maxLink && staysInside(linkable, grid, end, ring[0])) last.push(...ring);
		else strokes.push(ring);
	}
	return strokes;
};

/** `rings`: from the inside out, one stepover apart. `adaptive`: an even load on the bit (see adaptive.ts). */
export type Strategy = "rings" | "adaptive";

/**
 * Plans the passes for a grid whose cells each ask for a level (`target`, 0 = top), with `levels`
 * giving each level's depth (top first, `levels[0]` = 0).
 */
export const planClearing = (
	grid: Grid,
	target: Uint8Array,
	levels: number[],
	o: { toolDiameter: number; stepover: number; stepdown: number; strategy?: Strategy },
): Clearing => {
	const { w, h, cell } = grid;
	const r = o.toolDiameter / 2;
	// A centre this far from any cell that must not be cut keeps the whole bit off it.
	const clear = r / cell + 0.5;
	const step = o.toolDiameter * o.stepover;
	const reached = new Uint8Array(w * h);
	const passes: PassPlan[] = [];

	for (const depth of passDepths(levels, o.stepdown)) {
		// The level this pass works towards: cells at that level or deeper get cut.
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

		const strokes = o.strategy === "adaptive" ? adaptiveStrokes(grid, field, allowed, area, { stepover: step, radius: r }) : ringStrokes(grid, field, allowed, step, r);
		passes.push({ depth, strokes });

		// Where the bit reaches at a level's final depth: within its radius of an allowed centre.
		if (levels.some((d) => Math.abs(d - depth) < 1e-9)) {
			const notAllowed = new Uint8Array(w * h);
			for (let i = 0; i < notAllowed.length; i += 1) notAllowed[i] = allowed[i] ? 0 : 1;
			const toAllowed = distanceToOutside(notAllowed, w, h, false);
			for (let i = 0; i < reached.length; i += 1) if (area[i] && toAllowed[i] <= r / cell + 0.75) reached[i] = Math.max(reached[i], k);
		}
	}
	return { passes, reached };
};

/** How the strokes are written: number formatting and where they go in machine coordinates. */
export type StrokeWriter = {
	/** A coordinate in mm, as printed. */
	c: (mm: number) => string;
	/** A feed in mm/min, as printed. */
	f: (mmPerMin: number) => string;
	/** Picture coordinates (mm) → machine coordinates (mm). */
	toMachine: (p: Pt) => Pt;
	/** Travel height above the stock between strokes, mm. */
	clearance: number;
	feedrate: number;
	plungeRate: number;
	toolDiameter: number;
};

/** The stroke's points from its start until `run` mm along it (cut short exactly at `run`). */
const leadIn = (stroke: Stroke, run: number): Pt[] => {
	const pts: Pt[] = [stroke[0]];
	let left = run;
	for (let i = 1; i < stroke.length && left > 1e-9; i += 1) {
		const a = stroke[i - 1], b = stroke[i];
		const d = Math.hypot(b.x - a.x, b.y - a.y);
		if (d <= left) {
			pts.push(b);
			left -= d;
		} else {
			const t = left / d;
			pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
			left = 0;
		}
	}
	return pts;
};

const strokeLength = (stroke: Stroke): number => {
	let n = 0;
	for (let i = 1; i < stroke.length; i += 1) n += Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y);
	return n;
};

/**
 * Writes the passes, shallow to deep. Each stroke starts with the bit travelling at the clearance
 * height (nothing is above the stock top) and dropping fast to just above the floor the last pass
 * left. It then ramps down along the start of the stroke (at most about 1 in 4, over at least a bit
 * diameter) and comes back along the same line at full depth, so it doesn't plunge straight into the
 * material. Only a stroke shorter than the bit is entered with a straight plunge.
 */
export const writeClearing = (out: string[], passes: PassPlan[], w: StrokeWriter): void => {
	const xy = (p: Pt) => {
		const m = w.toMachine(p);
		return `X${w.c(m.x)} Y${w.c(m.y)}`;
	};
	let floor = 0;
	passes.forEach((pass, pi) => {
		if (pass.strokes.length === 0) return;
		out.push(`(Pass ${pi + 1} of ${passes.length}, Z${w.c(-pass.depth)})`);
		for (const stroke of pass.strokes) {
			const a = stroke[0];
			const top = Math.min(w.clearance, -floor + 0.5);
			out.push(`G0 Z${w.c(w.clearance)}`);
			out.push(`G0 ${xy(a)}`);
			out.push(`G0 Z${w.c(top)}`);
			const total = strokeLength(stroke);
			if (total >= w.toolDiameter) {
				const run = Math.min(total, Math.max(w.toolDiameter, (pass.depth + top) * 4));
				const lead = leadIn(stroke, run);
				let along = 0;
				for (let i = 1; i < lead.length; i += 1) {
					along += Math.hypot(lead[i].x - lead[i - 1].x, lead[i].y - lead[i - 1].y);
					const z = top - (top + pass.depth) * (along / run);
					out.push(`G1 ${xy(lead[i])} Z${w.c(i === lead.length - 1 ? -pass.depth : z)}${i === 1 ? ` F${w.f(w.plungeRate)}` : ""}`);
				}
				// Back to the start at full depth, then the whole stroke.
				for (let i = lead.length - 2; i >= 0; i -= 1) out.push(`G1 ${xy(lead[i])}${i === lead.length - 2 ? ` F${w.f(w.feedrate)}` : ""}`);
				stroke.slice(1).forEach((pt) => out.push(`G1 ${xy(pt)}`));
			} else {
				out.push(`G1 Z${w.c(-pass.depth)} F${w.f(w.plungeRate)}`);
				stroke.slice(1).forEach((pt, i) => out.push(`G1 ${xy(pt)}${i === 0 ? ` F${w.f(w.feedrate)}` : ""}`));
			}
		}
		floor = pass.depth;
	});
};
