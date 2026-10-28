/**
 * The tool-centre path for one depth level of a pocket, as steps in pocket-centred
 * coordinates (X0 Y0 at the middle of the pocket).
 *
 * Every level starts with a helical ramp at the middle, so the bit never plunges
 * into material, and a flat lap at full depth to clean the floor under the ramp. Then it
 * spirals outwards until it reaches the wall:
 *  - a round pocket gets a true spiral, then a final circle on the wall;
 *  - a rectangle gets rings (rounded rectangles) that grow outwards, the last one
 *    being the wall. Each ring is joined to the next by a lane change: an S-curve of
 *    two gentle arcs along a long straight side, so the bit never turns sharply to
 *    step over.
 */

import type { Params } from "./params";

/** A move to (x, y, z). With `arc`, an arc from the previous point around that centre. */
export type Seg = { x: number; y: number; z: number; arc?: { cx: number; cy: number; cw: boolean } };

/** The area the centre of the tool may travel: the pocket shrunk by the tool radius. */
export type Region =
	| { shape: "rectangle"; hx: number; hy: number; r: number }
	| { shape: "circle"; R: number };

export const toolRegion = (p: Params): Region => {
	const rt = p.toolDiameter / 2;
	if (p.shape === "circle") return { shape: "circle", R: Math.max(0, p.diameter / 2 - rt) };
	const hx = Math.max(0, p.width / 2 - rt);
	const hy = Math.max(0, p.height / 2 - rt);
	// A round bit can't cut a corner tighter than its own radius.
	return { shape: "rectangle", hx, hy, r: Math.min(Math.max(0, p.cornerRadius - rt), hx, hy) };
};

/** Cumulative depths for each cutting level, ending exactly at `depth`. */
export const zLevels = (depth: number, stepdown: number): number[] => {
	const n = Math.max(1, Math.ceil(depth / stepdown - 1e-9));
	return Array.from({ length: n }, (_, i) => -Math.min(depth, (i + 1) * (depth / n)));
};

const SAG = 0.01;
/** Arcs smaller than this are written as chords: at 3 decimals they would be mostly rounding. */
const MIN_ARC_RADIUS = 0.05;
/** The helix descends at most this steeply. */
const RAMP_ANGLE = (5 * Math.PI) / 180;

const chordCount = (r: number, sweep: number): number => {
	const step = r > SAG ? 2 * Math.acos(1 - SAG / r) : Math.PI;
	return Math.max(1, Math.ceil(Math.abs(sweep) / step));
};

type ArcSpec = { cx: number; cy: number; r: number; a0: number; sweep: number; z0: number; z1: number };

/**
 * An arc of a circle, from angle `a0` turning by `sweep` (negative is clockwise), Z
 * going linearly from `z0` to `z1`, as G2/G3 pieces of at most half a circle, or as
 * chords. The starting point is not included.
 */
export const arcSegs = (c: ArcSpec, arcs: boolean): Seg[] => {
	const useArcs = arcs && c.r >= MIN_ARC_RADIUS;
	const n = useArcs ? Math.max(1, Math.ceil(Math.abs(c.sweep) / Math.PI - 1e-9)) : chordCount(c.r, c.sweep);
	const out: Seg[] = [];
	for (let k = 1; k <= n; k += 1) {
		const t = k / n;
		const a = c.a0 + c.sweep * t;
		const seg: Seg = { x: c.cx + c.r * Math.cos(a), y: c.cy + c.r * Math.sin(a), z: c.z0 + (c.z1 - c.z0) * t };
		if (useArcs) seg.arc = { cx: c.cx, cy: c.cy, cw: c.sweep < 0 };
		out.push(seg);
	}
	return out;
};

/** Where the helix starts (and ends): to the right of the middle. */
export const helixRadius = (reg: Region, toolDiameter: number): number =>
	Math.min(toolDiameter * 0.375, reg.shape === "circle" ? reg.R : Math.min(reg.hx, reg.hy));

const helixSegs = (rh: number, cw: boolean, z0: number, z1: number, arcs: boolean): Seg[] => {
	const perTurn = 2 * Math.PI * rh * Math.tan(RAMP_ANGLE);
	const turns = Math.min(40, Math.max(1, Math.ceil((z0 - z1) / perTurn - 1e-9)));
	return arcSegs({ cx: 0, cy: 0, r: rh, a0: 0, sweep: (cw ? -1 : 1) * 2 * Math.PI * turns, z0, z1 }, arcs);
};

/**
 * One lap of a rounded rectangle of half sizes a × b and corner radius c, counter-
 * clockwise, from the right edge (where the path already is) round to (a, ye) on it.
 */
const loopSegs = (a: number, b: number, c: number, ye: number, z: number, arcs: boolean): Seg[] => {
	const out: Seg[] = [];
	const rc = c < 0.01 ? 0 : c;
	const line = (x: number, y: number) => out.push({ x, y, z });
	const corner = (cx: number, cy: number, a0: number) =>
		rc > 0 && out.push(...arcSegs({ cx, cy, r: rc, a0, sweep: Math.PI / 2, z0: z, z1: z }, arcs));
	line(a, b - rc);
	corner(a - rc, b - rc, 0);
	line(-a + rc, b);
	corner(-a + rc, b - rc, Math.PI / 2);
	line(-a, -b + rc);
	corner(-a + rc, -b + rc, Math.PI);
	line(a - rc, -b);
	corner(a - rc, -b + rc, -Math.PI / 2);
	line(a, ye);
	return out;
};

/**
 * A lane change: from (x0, y0) heading up (+Y) to (x1, y0 + L), two arcs of equal radius
 * and opposite turn, so the path leaves and arrives heading straight up and the whole
 * thing has no corner. Falls back to one straight diagonal when there is too little
 * length for gentle arcs.
 */
const laneChange = (x0: number, y0: number, x1: number, L: number, z: number, arcs: boolean): Seg[] => {
	const delta = x1 - x0;
	const shift = Math.abs(delta);
	if (shift < 0.05 || L < 1.5 * shift) return [{ x: x1, y: y0 + L, z }];
	// Each arc turns by theta and moves the path sideways by half the shift.
	const theta = 2 * Math.atan(shift / L);
	const r = shift / 2 / (1 - Math.cos(theta));
	const out = delta > 0
		? [
				{ cx: x0 + r, cy: y0, a0: Math.PI, sweep: -theta },
				{ cx: x1 - r, cy: y0 + L, a0: -theta, sweep: theta },
			]
		: [
				{ cx: x0 - r, cy: y0, a0: 0, sweep: theta },
				{ cx: x1 + r, cy: y0 + L, a0: Math.PI + theta, sweep: -theta },
			];
	return out.flatMap((arc) => arcSegs({ ...arc, r, z0: z, z1: z }, arcs));
};

const circumcentre = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) => {
	const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
	const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
	return {
		x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
		y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
	};
};

/**
 * A spiral out from radius `rh` to `R` in `revs` turns, radius growing evenly with the
 * angle, as quarter-turn arcs through three points of the spiral, or as chords.
 */
const spiralSegs = (rh: number, R: number, revs: number, cw: boolean, z: number, arcs: boolean): Seg[] => {
	const quarters = 4 * revs;
	const dir = cw ? -1 : 1;
	const at = (k: number) => {
		const angle = dir * (Math.PI / 2) * k;
		const r = rh + (R - rh) * (k / quarters);
		return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
	};
	const useArcs = arcs && rh >= MIN_ARC_RADIUS;
	const out: Seg[] = [];
	let from = at(0);
	for (let q = 0; q < quarters; q += 1) {
		if (useArcs) {
			const to = q === quarters - 1 ? { x: R, y: 0 } : at(q + 1);
			const centre = circumcentre(from, at(q + 0.5), to);
			out.push({ x: to.x, y: to.y, z, arc: { cx: centre.x, cy: centre.y, cw } });
			from = to;
		} else {
			const m = chordCount((rh + R) / 2, Math.PI / 2);
			for (let j = 1; j <= m; j += 1) {
				const to = q === quarters - 1 && j === m ? { x: R, y: 0 } : at(q + j / m);
				out.push({ x: to.x, y: to.y, z });
			}
		}
	}
	return out;
};

const swapXY = (s: Seg): Seg => ({ x: s.y, y: s.x, z: s.z, arc: s.arc && { cx: s.arc.cy, cy: s.arc.cx, cw: !s.arc.cw } });
const mirrorX = (s: Seg): Seg => ({ ...s, x: -s.x, arc: s.arc && { cx: -s.arc.cx, cy: s.arc.cy, cw: !s.arc.cw } });

/** The pocket's helix start and the steps for one level, from Z `zPrev` down to `z`. */
export const levelSegs = (p: Params, reg: Region, zPrev: number, z: number): { start: { x: number; y: number }; segs: Seg[] } => {
	const arcs = p.useArcs;
	const rt = p.toolDiameter / 2;
	const step = p.toolDiameter * p.stepover;
	const wantCw = p.rotation === "cw";
	// Everything is built counter-clockwise with the long sides of a rectangle running
	// up and down, then mirrored and/or turned onto its real orientation. Turning a wide
	// pocket onto its side is a mirror image, which flips the direction once more.
	const turned = reg.shape === "rectangle" && reg.hx > reg.hy;
	const mirror = turned ? !wantCw : wantCw;
	const r: Region = turned && reg.shape === "rectangle" ? { ...reg, hx: reg.hy, hy: reg.hx } : reg;
	const rh = helixRadius(r, p.toolDiameter);
	const segs: Seg[] = helixSegs(rh, false, zPrev, z, arcs);
	// The helix leaves a sloped floor under it, so go round once more flat at full depth to
	// cut that floor, whatever the stepover. Both end at (rh, 0), heading up.
	segs.push(...arcSegs({ cx: 0, cy: 0, r: rh, a0: 0, sweep: 2 * Math.PI, z0: z, z1: z }, arcs));

	if (r.shape === "circle") {
		if (r.R - rh > 1e-6) segs.push(...spiralSegs(rh, r.R, Math.max(1, Math.ceil((r.R - rh) / step - 1e-9)), false, z, arcs));
		segs.push(...arcSegs({ cx: 0, cy: 0, r: r.R, a0: 0, sweep: 2 * Math.PI, z0: z, z1: z }, arcs));
	} else {
		const m = Math.min(r.hx, r.hy);
		// Rings no further apart than the tool radius, so the strip between the two long
		// sides of the innermost ring is cut as well.
		const n = Math.max(1, Math.ceil(m / Math.min(step, rt) - 1e-9));
		const ring = (i: number) => {
			const d = m * (1 - i / n);
			const a = r.hx - d;
			const b = r.hy - d;
			const c = Math.min(Math.max(r.r - d, 0), a, b);
			// How much of the right edge is straight, up and down from the middle.
			return { a, b, c, straight: b - (c < 0.01 ? 0 : c) };
		};
		// A lane change is about five times as long as the shift it makes (at least two tool
		// diameters), so the arcs are gentle, but never longer than the straight it runs on.
		const laneLength = (shift: number, room: number) => Math.min(Math.max(5 * shift, 2 * p.toolDiameter), room);
		let x = rh;
		let y = 0;
		// The first lane change leads from the helix onto the right edge of the first ring.
		let length = laneLength(Math.abs(ring(1).a - rh), ring(1).straight);
		for (let i = 1; i <= n; i += 1) {
			const cur = ring(i);
			segs.push(...laneChange(x, y, cur.a, length, z, arcs));
			const ys = y + length;
			// Round the ring to where the lane change out of it begins; the wall goes all the way round.
			const next = i < n ? ring(i + 1) : null;
			const nextLength = next ? laneLength(next.a - cur.a, 2 * cur.straight) : 0;
			const ye = next ? -nextLength / 2 : ys;
			segs.push(...loopSegs(cur.a, cur.b, cur.c, ye, z, arcs));
			x = cur.a;
			y = ye;
			length = nextLength;
		}
	}

	let start = { x: rh, y: 0 };
	let out = segs;
	if (mirror) {
		out = out.map(mirrorX);
		start = { x: -start.x, y: start.y };
	}
	if (turned) {
		out = out.map(swapXY);
		start = { x: start.y, y: start.x };
	}
	return { start, segs: out };
};
