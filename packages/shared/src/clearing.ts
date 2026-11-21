/**
 * Clearing areas of a picture grid, level by level, and writing that as G-code. Used by Height Map
 * (many levels) and by the Picture shape of Pocket Cutout (one level).
 *
 * Each pass depth cuts every cell whose level is at least that deep. The bit's centre may only go
 * where the whole bit fits inside that area (found with a distance transform), so it never cuts into
 * a higher level. Inside it the bit runs back-and-forth rows, joined without lifting where the
 * straight link stays inside, then follows each outline once for clean walls.
 */

import { cellCentre, distanceToOutside, type Grid, type Pt, ringsToMm, simplifyRing, traceContours } from "./picture";

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

/**
 * Plans the passes for a grid whose cells each ask for a level (`target`, 0 = top), with `levels`
 * giving each level's depth (top first, `levels[0]` = 0).
 */
export const planClearing = (
	grid: Grid,
	target: Uint8Array,
	levels: number[],
	o: { toolDiameter: number; stepover: number; stepdown: number },
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

		// Back-and-forth rows across the allowed area.
		const strokes: Stroke[] = [];
		let row = 0;
		for (let y = cell * 0.5; y < h * cell; y += step, row += 1) {
			const j = Math.min(h - 1, Math.floor(y / cell));
			const segs: { a: Pt; b: Pt }[] = [];
			let start = -1;
			for (let i = 0; i <= w; i += 1) {
				const on = i < w && allowed[j * w + i] === 1;
				if (on && start < 0) start = i;
				if (!on && start >= 0) {
					segs.push({ a: cellCentre(grid, start, j), b: cellCentre(grid, i - 1, j) });
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
		for (const ring of ringsToMm(grid, traceContours(field, w, h))) {
			const pts = simplifyRing(ring, cell * 0.2);
			if (pts.length < 2) continue;
			strokes.push([...pts, pts[0]]);
		}
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
