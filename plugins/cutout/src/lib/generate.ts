/**
 * Cutout → GRBL G-code.
 *
 * G0/G1 moves, plus G2/G3 for rounded corners and circles unless arcs are switched
 * off (then they are short G1 chords). The shape is a rectangle or a circle. No canned cycles, like the other plugins here.
 *
 * The bit never plunges: it ramps down along the outline, losing one stepdown
 * per lap, and finishes with one flat lap at full depth. Tabs are a raised
 * floor under that path — wherever a pass is deeper than the tab floor, it
 * climbs the side (sloped for trapezoid tabs, vertical for rectangular ones),
 * crosses the flat top and descends again.
 *
 * Corners carry no tabs, so a corner arc is a helix: Z falls steadily along it, as
 * it does along the straights.
 *
 * Work zero is the centre of the rectangle or any of its corners; Z0 is the stock
 * top.
 */

import { arcMove, comment, fmt } from "@shared/gcode";
import { originOffset, POSITION_NAMES } from "@shared/position";
import { MM_PER_INCH } from "@shared/units";

import { arcPoint, buildCircleOutline, buildOutline, type Outline, reverseOutline } from "./outline";
import type { Params } from "./params";
import { placeTabs, placeTabsEvenly, type TabSpan } from "./tabs";

/** A step of the path. With `arc`, an arc from the previous move around that centre. */
export type Move = { x: number; y: number; z: number; s?: number; arc?: { cx: number; cy: number; cw: boolean } };

export type Result = { gcode: string; warnings: string[] };

/** Number of laps needed to reach `depth` with at most `stepdown` per lap. */
export const lapCount = (depth: number, stepdown: number): number =>
	Math.max(1, Math.ceil(depth / stepdown - 1e-9));

/** The centre-line path the tool follows, in direction order, around (0, 0). */
export const toolOutline = (p: Params): Outline => {
	const rt = p.toolDiameter / 2;
	const grow = p.mode === "part" ? rt : -rt;
	let ccw: Outline;
	if (p.shape === "circle") {
		ccw = buildCircleOutline(Math.max(0, p.diameter / 2 + grow));
	} else {
		const hx = p.width / 2 + grow;
		const hy = p.height / 2 + grow;
		// A round bit can't leave an inside corner tighter than its own radius.
		const r = Math.max(0, p.cornerRadius + grow);
		ccw = buildOutline(hx, hy, Math.min(r, hx, hy));
	}
	// Climb milling: a part (tool outside) goes counter-clockwise, a hole clockwise.
	const wantCcw = (p.mode === "part") === (p.direction === "climb");
	return wantCcw ? ccw : reverseOutline(ccw);
};

/** Tabs along the path, in the path's own direction. */
export const tabSpans = (p: Params, outline: Outline): { spans: TabSpan[]; skippedSides: number } => {
	if (!p.tabs.enabled) return { spans: [], skippedSides: 0 };
	return p.shape === "circle"
		? placeTabsEvenly(outline.length, p.tabs.perSide, p.tabs.length)
		: placeTabs(outline.sides, p.tabs.perSide, p.tabs.length);
};

/** Horizontal run of a tab's sloped side: 45° (as long as it is tall), at most half the tab. */
const tabRun = (t: TabSpan, height: number): number => Math.min(height, (t.end - t.start) / 2);

/** Rectangular tabs: vertical sides, flat top. Used when the shape is "rectangular". */
const buildMovesRect = (p: Params, outline: Outline, spans: TabSpan[], pointAt: (s: number) => { x: number; y: number }): Move[] => {
	const laps = lapCount(p.depth, p.stepdown);
	const tabTop = -(p.depth - p.tabs.height);
	const moves: Move[] = [];
	const inTab = (s: number) => spans.some((t) => s > t.start && s < t.end);
	type Stop = { s: number; kind: "vertex" | "tabIn" | "tabOut"; x: number; y: number };
	const stops: Stop[] = outline.vertices.map((v) => ({ s: v.s, kind: "vertex" as const, x: v.x, y: v.y }));
	for (const t of spans) {
		stops.push({ s: t.start, kind: "tabIn", ...pointAt(t.start) });
		stops.push({ s: t.end, kind: "tabOut", ...pointAt(t.end) });
	}
	stops.sort((a, b) => a.s - b.s);
	for (let lap = 0; lap <= laps; lap += 1) {
		const flat = lap === laps;
		const zFrom = -p.depth * (lap / laps);
		const zTo = flat ? -p.depth : -p.depth * ((lap + 1) / laps);
		const ramp = (s: number) => (flat ? -p.depth : zFrom + (zTo - zFrom) * (s / outline.length));
		for (const st of stops) {
			if (lap > 0 && st.s === 0) continue; // the lap's first point is the previous lap's last
			const z = ramp(st.s);
			if (st.kind === "tabIn") {
				moves.push({ x: st.x, y: st.y, z, s: st.s });
				moves.push({ x: st.x, y: st.y, z: Math.max(z, tabTop), s: st.s });
			} else if (st.kind === "tabOut") {
				moves.push({ x: st.x, y: st.y, z: Math.max(z, tabTop), s: st.s });
				moves.push({ x: st.x, y: st.y, z, s: st.s });
			} else {
				moves.push({ x: st.x, y: st.y, z: inTab(st.s) && z < tabTop ? tabTop : z, s: st.s });
			}
		}
	}
	return moves;
};

/**
 * Trapezoidal tab floor: height above the bottom of the cut at path position `s`.
 * Each tab is `end - start` long at its base, rises along sloped sides and has a
 * flat top, so the bit climbs over it instead of meeting a vertical wall.
 */
const tabFloor = (s: number, spans: TabSpan[], height: number): number => {
	let floor = 0;
	for (const t of spans) {
		if (s <= t.start || s >= t.end) continue;
		const run = tabRun(t, height);
		floor = Math.max(floor, Math.min(height, (Math.min(s - t.start, t.end - s) * height) / run));
	}
	return floor;
};

/**
 * Folds the chord moves along each arc (a rounded corner or a circle) into G2/G3 arc
 * moves. Within one arc, each run of moves along which Z changes at a steady rate
 * becomes one (helical) arc: a whole corner while the bit ramps down, the stretches
 * between tabs on a circle. Vertical steps, tiny runs and anything not on the circle
 * stay as the chords they were.
 */
const collapseArcs = (moves: Move[], outline: Outline): Move[] => {
	const eps = 1e-6;
	// Too short to print as an arc: its rounded start and end could coincide.
	const minChord = 0.05;
	const arcAt = (s: number) => outline.arcs.find((a) => s > a.s0 + eps && s <= a.s1 + eps);
	const out: Move[] = [];
	let i = 0;
	while (i < moves.length) {
		const m = moves[i];
		const arc = m.s === undefined ? undefined : arcAt(m.s);
		const prev = out[out.length - 1];
		// Where the previous move sits along the path. A lap's first point is the
		// previous lap's last, so a move at the very end of the path counts as 0.
		const wrapped = prev?.s !== undefined && arc !== undefined && arc.s0 < eps && Math.abs(prev.s - outline.length) < eps;
		const ps = wrapped ? 0 : prev?.s;
		const continues = arc !== undefined && ps !== undefined && ps >= arc.s0 - eps && ps < arc.s1 - eps && (m.s ?? 0) - ps > eps;
		if (!arc || !continues || ps === undefined) {
			out.push(m);
			i += 1;
			continue;
		}
		// Take the longest run from `prev` whose Z is linear in path position.
		const slope = (m.z - prev.z) / ((m.s ?? 0) - ps);
		let j = i;
		while (
			j + 1 < moves.length &&
			moves[j + 1].s !== undefined &&
			arcAt(moves[j + 1].s!) === arc &&
			moves[j + 1].s! - moves[j].s! > eps &&
			Math.abs(moves[j + 1].z - (prev.z + slope * (moves[j + 1].s! - ps))) < eps
		) {
			j += 1;
		}
		const end = moves[j];
		const onArc = Math.abs(Math.hypot(prev.x - arc.cx, prev.y - arc.cy) - arc.r) < eps && Math.abs(Math.hypot(end.x - arc.cx, end.y - arc.cy) - arc.r) < eps;
		const longEnough = Math.hypot(end.x - prev.x, end.y - prev.y) >= minChord;
		if (onArc && longEnough) {
			out.push({ ...end, arc: { cx: arc.cx, cy: arc.cy, cw: arc.cw } });
			i = j + 1;
		} else {
			out.push(m);
			i += 1;
		}
	}
	return out;
};

/** All moves for the full job, outline starting at (0,0)-centred coordinates. */
export const buildMoves = (p: Params, outline: Outline, spans: TabSpan[]): Move[] => {
	const moves = buildPolylineMoves(p, outline, spans);
	return p.useArcs ? collapseArcs(moves, outline) : moves;
};

const buildPolylineMoves = (p: Params, outline: Outline, spans: TabSpan[]): Move[] => {
	const laps = lapCount(p.depth, p.stepdown);
	const height = p.tabs.height;
	const moves: Move[] = [];
	const vs = outline.vertices;

	// Path positions where something changes: every vertex plus the tab corners.
	const pointAt = (s: number) => {
		// On a corner or circle the point is exactly on the arc, not on a chord of it.
		const arc = outline.arcs.find((a) => s > a.s0 && s < a.s1);
		if (arc) return arcPoint(arc, s);
		let i = 1;
		while (i < vs.length - 1 && vs[i].s < s) i += 1;
		const a = vs[i - 1];
		const b = vs[i];
		const t = b.s === a.s ? 0 : (s - a.s) / (b.s - a.s);
		return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
	};
	if (p.tabs.shape === "rectangular") return buildMovesRect(p, outline, spans, pointAt);
	const stopS = new Set<number>(vs.map((v) => v.s));
	for (const t of spans) {
		const run = tabRun(t, height);
		for (const s of [t.start, t.start + run, t.end - run, t.end]) stopS.add(s);
	}
	const stops = [...stopS].sort((a, b) => a - b);

	// Laps 0..laps-1 ramp down; one extra lap stays flat at full depth.
	for (let lap = 0; lap <= laps; lap += 1) {
		const flat = lap === laps;
		const zFrom = -p.depth * (lap / laps);
		const zTo = flat ? -p.depth : -p.depth * ((lap + 1) / laps);
		const ramp = (s: number) => (flat ? -p.depth : zFrom + (zTo - zFrom) * (s / outline.length));
		// The bit follows the ramp, but never goes below the tab floor.
		const zAt = (s: number) => Math.max(ramp(s), -p.depth + tabFloor(s, spans, height));
		const gap = (s: number) => ramp(s) - (-p.depth + tabFloor(s, spans, height));

		const lapStops: number[] = [];
		stops.forEach((s, k) => {
			if (k > 0) {
				// Where the ramp crosses a sloped tab side, the path changes direction.
				const a = stops[k - 1];
				const ga = gap(a + 1e-9);
				const gb = gap(s - 1e-9);
				if ((ga < 0 && gb > 0) || (ga > 0 && gb < 0)) lapStops.push(a + (s - a) * (ga / (ga - gb)));
			}
			lapStops.push(s);
		});
		for (const s of lapStops) {
			if (lap > 0 && s === 0) continue; // the lap's first point is the previous lap's last
			moves.push({ ...pointAt(s), z: zAt(s), s });
		}
	}
	return moves;
};

export const generateGcode = (p: Params): Result => {
	const inch = p.units === "in";
	const scale = inch ? 1 / MM_PER_INCH : 1;
	const dec = inch ? 4 : 3;
	const c = (v: number) => fmt(v * scale, dec);
	const f = (v: number) => fmt(v * scale, inch ? 2 : 0);

	const outline = toolOutline(p);
	const { spans, skippedSides } = tabSpans(p, outline);
	const warnings: string[] = [];
	if (p.tabs.enabled && skippedSides > 0)
		warnings.push(
			p.shape === "circle"
				? `${p.tabs.perSide} tab(s) of ${fmt(p.tabs.length, 1)} mm don't fit around the circle.`
				: `${skippedSides} side(s) are too short for ${p.tabs.perSide} tab(s) of ${fmt(p.tabs.length, 1)} mm and have none.`,
		);
	if (p.tabs.enabled && spans.length === 0)
		warnings.push("No tabs fit — the cut-out piece will come loose.");

	// Shift from rectangle-centred to machine coordinates.
	// A circle is zeroed like its bounding square.
	const bw = p.shape === "circle" ? p.diameter : p.width;
	const bh = p.shape === "circle" ? p.diameter : p.height;
	const origin = originOffset(p.origin, bw, bh);
	const dx = bw / 2 - origin.x;
	const dy = bh / 2 - origin.y;

	const moves = buildMoves(p, outline, spans);
	const laps = lapCount(p.depth, p.stepdown);

	const out: string[] = [];
	out.push(comment("Generated by Cutout - gSender plugin"));
	out.push(comment(`Units: ${p.units}`));
	out.push(comment(p.shape === "circle"
		? `Circle: diameter ${fmt(p.diameter, 3)} mm`
		: `Rectangle: ${fmt(p.width, 3)} x ${fmt(p.height, 3)} mm, corner radius ${fmt(p.cornerRadius, 3)} mm`));
	out.push(comment(`Cut: ${p.mode === "hole" ? `inside (${p.shape} removed, material around stays)` : `outside (${p.shape} kept)`}, depth ${fmt(p.depth, 3)} mm, ${p.direction}`));
	out.push(comment(`Tool: endmill ${fmt(p.toolDiameter, 3)} mm`));
	out.push(comment(`Feeds: cut ${fmt(p.feedrate, 0)}, plunge ${fmt(p.plungeRate, 0)} mm/min, spindle ${fmt(p.spindleRpm, 0)} RPM`));
	if (spans.length > 0)
		out.push(comment(`Tabs: ${spans.length} x ${fmt(p.tabs.length, 2)} mm long${p.tabs.shape === "trapezoid" ? " at the base" : ""}, ${fmt(p.tabs.height, 2)} mm tall, ${p.tabs.shape === "trapezoid" ? "sloped" : "vertical"} sides`));
	out.push(comment(`Work zero: ${POSITION_NAMES[p.origin]} of the ${p.shape === "circle" ? "circle's bounding square" : "rectangle"}, Z0 = top of stock`));
	for (const w of warnings) out.push(comment(`WARNING: ${w}`));

	out.push(p.units === "in" ? "G20" : "G21", "G90", "G17", "G94");
	out.push(`M3 S${fmt(p.spindleRpm, 0)}`);
	if (p.spindleDwell > 0) out.push(`G4 P${fmt(p.spindleDwell, 2)}`);
	out.push(`G0 Z${c(p.safeZ)}`);

	const first = moves[0];
	out.push(`G0 X${c(first.x + dx)} Y${c(first.y + dy)}`);
	out.push(`G0 Z${c(Math.min(1, p.safeZ))}`);
	out.push(comment(`Ramp down over ${laps} lap(s), then one flat lap`));
	out.push(`G1 Z0 F${f(p.plungeRate)}`);

	let last = { x: Number.NaN, y: Number.NaN, z: 0 };
	let lastF = p.plungeRate;
	const nf = { scale, decimals: dec };
	let planeSet = false;
	for (const m of moves) {
		const x = m.x + dx;
		const y = m.y + dy;
		if (m.arc) {
			// Arcs always cut, so they take the cut feed; Z changes along them (a helix).
			if (!planeSet) {
				out.push("G17");
				planeSet = true;
			}
			const zChanged = Math.abs(m.z - last.z) >= 1e-9;
			const word = arcMove(nf, {
				from: last,
				centre: { x: m.arc.cx + dx, y: m.arc.cy + dy },
				to: { x, y },
				z: zChanged ? m.z : undefined,
				cw: m.arc.cw,
			});
			out.push(`${word}${p.feedrate !== lastF ? ` F${f(p.feedrate)}` : ""}`);
			lastF = p.feedrate;
			last = { x, y, z: m.z };
			continue;
		}
		const sameXY = Math.abs(x - last.x) < 1e-9 && Math.abs(y - last.y) < 1e-9;
		if (sameXY && Math.abs(m.z - last.z) < 1e-9) continue;
		// Straight up/down moves use the plunge feed, everything else the cut feed.
		const rate = sameXY ? p.plungeRate : p.feedrate;
		const zChanged = Math.abs(m.z - last.z) >= 1e-9;
		const words = (sameXY ? "" : ` X${c(x)} Y${c(y)}`) + (zChanged ? ` Z${c(m.z)}` : "");
		out.push(`G1${words}${rate !== lastF ? ` F${f(rate)}` : ""}`);
		lastF = rate;
		last = { x, y, z: m.z };
	}
	out.push(`G0 Z${c(p.safeZ)}`, "M5", "M30");
	return { gcode: `${out.join("\n")}\n`, warnings };
};
