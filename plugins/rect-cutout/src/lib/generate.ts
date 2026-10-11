/**
 * Rectangular Cutout → GRBL G-code.
 *
 * Only G0/G1 (no arcs, no canned cycles), like the other plugins here.
 *
 * The bit never plunges: it ramps down along the outline, losing one stepdown
 * per lap, and finishes with one flat lap at full depth. Tabs are a raised
 * floor under that path — wherever a pass is deeper than the tab top, it is
 * held at the tab top for the length of the tab.
 *
 * Work zero is either the centre of the rectangle or its lower-left corner; Z0
 * is the stock top.
 */

import { comment, fmt } from "@shared/gcode";
import { MM_PER_INCH } from "@shared/units";

import { buildOutline, type Outline, reverseOutline } from "./outline";
import type { Params } from "./params";
import { placeTabs, type TabSpan } from "./tabs";

export type Move = { x: number; y: number; z: number };

export type Result = { gcode: string; warnings: string[] };

/** Number of laps needed to reach `depth` with at most `stepdown` per lap. */
export const lapCount = (depth: number, stepdown: number): number =>
	Math.max(1, Math.ceil(depth / stepdown - 1e-9));

/** The centre-line path the tool follows, in direction order, around (0, 0). */
export const toolOutline = (p: Params): Outline => {
	const rt = p.toolDiameter / 2;
	const grow = p.mode === "part" ? rt : -rt;
	const hx = p.width / 2 + grow;
	const hy = p.height / 2 + grow;
	// A round bit can't leave an inside corner tighter than its own radius.
	const r = Math.max(0, p.cornerRadius + grow);
	const ccw = buildOutline(hx, hy, Math.min(r, hx, hy));
	// Climb milling: a part (tool outside) goes counter-clockwise, a hole clockwise.
	const wantCcw = (p.mode === "part") === (p.direction === "climb");
	return wantCcw ? ccw : reverseOutline(ccw);
};

/** Tabs along the path, in the path's own direction. */
export const tabSpans = (p: Params, outline: Outline): { spans: TabSpan[]; skippedSides: number } =>
	p.tabs.enabled
		? placeTabs(outline.sides, p.tabs.perSide, p.tabs.length)
		: { spans: [], skippedSides: 0 };

/** All moves for the full job, outline starting at (0,0)-centred coordinates. */
export const buildMoves = (p: Params, outline: Outline, spans: TabSpan[]): Move[] => {
	const laps = lapCount(p.depth, p.stepdown);
	const tabTop = -(p.depth - p.tabs.height);
	const moves: Move[] = [];
	const vs = outline.vertices;

	const inTab = (s: number) => spans.some((t) => s > t.start && s < t.end);

	// Path positions where something changes: every vertex plus tab edges.
	type Stop = { s: number; kind: "vertex" | "tabIn" | "tabOut"; x: number; y: number };
	const pointAt = (s: number) => {
		let i = 1;
		while (i < vs.length - 1 && vs[i].s < s) i += 1;
		const a = vs[i - 1];
		const b = vs[i];
		const t = b.s === a.s ? 0 : (s - a.s) / (b.s - a.s);
		return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
	};
	const stops: Stop[] = vs.map((v) => ({ s: v.s, kind: "vertex" as const, x: v.x, y: v.y }));
	for (const t of spans) {
		stops.push({ s: t.start, kind: "tabIn", ...pointAt(t.start) });
		stops.push({ s: t.end, kind: "tabOut", ...pointAt(t.end) });
	}
	stops.sort((a, b) => a.s - b.s);

	// Laps 0..laps-1 ramp down; one extra lap stays flat at full depth.
	for (let lap = 0; lap <= laps; lap += 1) {
		const flat = lap === laps;
		const zFrom = -p.depth * (Math.min(lap, laps) / laps);
		const zTo = flat ? -p.depth : -p.depth * ((lap + 1) / laps);
		const ramp = (s: number) => (flat ? -p.depth : zFrom + (zTo - zFrom) * (s / outline.length));
		const lift = (z: number, s: number) => (inTab(s) && z < tabTop ? tabTop : z);

		for (const st of stops) {
			if (lap > 0 && st.s === 0) continue; // the lap's first point is the previous lap's last
			const z = ramp(st.s);
			if (st.kind === "tabIn") {
				moves.push({ x: st.x, y: st.y, z });
				moves.push({ x: st.x, y: st.y, z: Math.max(z, tabTop) });
			} else if (st.kind === "tabOut") {
				moves.push({ x: st.x, y: st.y, z: Math.max(z, tabTop) });
				moves.push({ x: st.x, y: st.y, z });
			} else {
				moves.push({ x: st.x, y: st.y, z: lift(z, st.s) });
			}
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
			`${skippedSides} side(s) are too short for ${p.tabs.perSide} tab(s) of ${fmt(p.tabs.length, 1)} mm and have none.`,
		);
	if (p.tabs.enabled && spans.length === 0)
		warnings.push("No tabs fit — the cut-out piece will come loose.");

	// Shift from rectangle-centred to machine coordinates.
	const dx = p.origin === "lower-left" ? p.width / 2 : 0;
	const dy = p.origin === "lower-left" ? p.height / 2 : 0;

	const moves = buildMoves(p, outline, spans);
	const laps = lapCount(p.depth, p.stepdown);

	const out: string[] = [];
	out.push(comment("Generated by Rectangular Cutout - gSender plugin"));
	out.push(comment(`Units: ${p.units}`));
	out.push(comment(`Rectangle: ${fmt(p.width, 3)} x ${fmt(p.height, 3)} mm, corner radius ${fmt(p.cornerRadius, 3)} mm`));
	out.push(comment(`Cut: ${p.mode === "hole" ? "opening (keep material around)" : "part (keep the rectangle)"}, depth ${fmt(p.depth, 3)} mm, ${p.direction}`));
	out.push(comment(`Tool: endmill ${fmt(p.toolDiameter, 3)} mm`));
	out.push(comment(`Feeds: cut ${fmt(p.feedrate, 0)}, plunge ${fmt(p.plungeRate, 0)} mm/min, spindle ${fmt(p.spindleRpm, 0)} RPM`));
	if (spans.length > 0)
		out.push(comment(`Tabs: ${spans.length} x ${fmt(p.tabs.length, 2)} mm long, ${fmt(p.tabs.height, 2)} mm tall`));
	out.push(comment(`Work zero: ${p.origin === "center" ? "centre of the rectangle" : "lower-left corner of the rectangle"}, Z0 = top of stock`));
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
	for (const m of moves) {
		const x = m.x + dx;
		const y = m.y + dy;
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
