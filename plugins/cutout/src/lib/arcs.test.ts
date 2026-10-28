import { describe, expect, it } from "vitest";

import { arcRadius, arcSweep, cuttingPolylines, maxDeviation, parsePath } from "@shared/path";
import { jobStats } from "@shared/stats";

import { buildMoves, generateGcode, tabSpans, toolOutline } from "./generate";
import { buildOutline, reverseOutline } from "./outline";
import { defaultParams, type Params } from "./params";

const job = (patch: Partial<Params> = {}): Params => ({ ...defaultParams(), cornerRadius: 6, ...patch });
const noTabs = { ...defaultParams().tabs, enabled: false };
const strip = (g: string) => g.replace(/\([^)]*\)/g, "");
const words = (g: string) => new Set([...strip(g).matchAll(/\b([GM]\d+)\b/g)].map((m) => m[1]));

const cases: { name: string; patch: Partial<Params>; decimals: number; mmPerUnit: number }[] = [
	{ name: "inside, climb, trapezoid tabs", patch: {}, decimals: 3, mmPerUnit: 1 },
	{ name: "outside, climb, no tabs", patch: { mode: "part", tabs: noTabs }, decimals: 3, mmPerUnit: 1 },
	{ name: "inside, conventional, rectangular tabs", patch: { direction: "conventional", tabs: { ...defaultParams().tabs, shape: "rectangular" } }, decimals: 3, mmPerUnit: 1 },
	{ name: "outside, conventional, lower-left origin", patch: { mode: "part", direction: "conventional", origin: "lower-left" }, decimals: 3, mmPerUnit: 1 },
	{ name: "inch", patch: { units: "in" }, decimals: 4, mmPerUnit: 25.4 },
	{ name: "inch, outside, 2 tabs per side", patch: { units: "in", mode: "part", tabs: { ...defaultParams().tabs, perSide: 2 } }, decimals: 4, mmPerUnit: 25.4 },
];

describe.each(cases)("arcs vs chords ($name)", ({ patch, decimals, mmPerUnit }) => {
	const arcs = generateGcode(job({ ...patch, useArcs: true })).gcode;
	const chords = generateGcode(job({ ...patch, useArcs: false })).gcode;
	const sag = 0.002 / mmPerUnit;

	it("arc mode writes the corners as G2/G3", () => {
		const n = parsePath(arcs).filter((s) => s.kind === "arc").length;
		// Four corners per lap, one lap more than the ramp laps.
		expect(n).toBe(4 * 11);
		expect(arcs.split("\n").length).toBeLessThan(chords.split("\n").length);
		expect(words(chords).has("G2") || words(chords).has("G3")).toBe(false);
	});

	it("both modes cut the same path within tolerance", () => {
		const a = cuttingPolylines(parsePath(arcs), sag);
		const b = cuttingPolylines(parsePath(chords), sag);
		const tol = 0.015 / mmPerUnit; // chord sag is 0.01 mm
		expect(maxDeviation(a, b)).toBeLessThan(tol);
		expect(maxDeviation(b, a)).toBeLessThan(tol);
	});

	it("start and end radius of every arc agree, and each is a quarter turn", () => {
		const r = job(patch).cornerRadius + (patch.mode === "part" ? job(patch).toolDiameter / 2 : -job(patch).toolDiameter / 2);
		for (const s of parsePath(arcs).filter((x) => x.kind === "arc")) {
			const rEnd = Math.hypot(s.to.x - s.centre!.x, s.to.y - s.centre!.y);
			expect(Math.abs(rEnd - arcRadius(s))).toBeLessThan(1.5 * 10 ** -decimals);
			expect(arcRadius(s)).toBeCloseTo(r / mmPerUnit, decimals - 1);
			expect(Math.abs(arcSweep(s))).toBeCloseTo(Math.PI / 2, 2);
		}
	});

	it("selects the XY plane before the first arc, and only uses IJ", () => {
		expect(arcs).toMatch(/^G17$/m);
		expect(arcs.search(/^G17$/m)).toBeLessThan(arcs.search(/^G[23] /m));
		const lastG17 = arcs.lastIndexOf("G17\n");
		expect(lastG17).toBeLessThan(arcs.search(/^G[23] /m));
		expect(arcs).not.toMatch(/\bR-?\d/);
		for (const l of strip(arcs).split("\n").filter((x) => /^G[23] /.test(x))) expect(l).toMatch(/ I-?[\d.]+ J-?[\d.]+/);
	});

	it("no arc ends where it starts (gSender's viewer skips those)", () => {
		for (const s of parsePath(arcs).filter((x) => x.kind === "arc")) expect(s.from.x !== s.to.x || s.from.y !== s.to.y).toBe(true);
	});

	it("emits only GRBL-safe words", () => {
		for (const w of words(arcs)) expect(["G0", "G1", "G2", "G3", "G4", "G17", "G20", "G21", "G90", "G94", "M3", "M5", "M30"]).toContain(w);
	});

	it("arc direction follows climb/conventional and inside/outside", () => {
		const p = job(patch);
		const ccw = (p.mode === "part") === (p.direction === "climb");
		for (const s of parsePath(arcs).filter((x) => x.kind === "arc")) expect(s.cw).toBe(!ccw);
		expect(words(arcs).has(ccw ? "G3" : "G2")).toBe(true);
		expect(words(arcs).has(ccw ? "G2" : "G3")).toBe(false);
	});

	it("straight edges stay G1, Z never rises except over tabs, depth is reached", () => {
		const p = job(patch);
		const segs = parsePath(arcs);
		expect(segs.some((s) => s.kind === "line")).toBe(true);
		expect(Math.min(...segs.map((s) => s.to.z))).toBeCloseTo(-p.depth / mmPerUnit, decimals);
		if (!p.tabs.enabled) for (const s of segs.filter((x) => x.kind !== "rapid")) expect(s.to.z).toBeLessThanOrEqual(s.from.z + 1e-9);
	});
});

describe("arc moves", () => {
	it("corner arcs are helical: Z falls evenly along them during the ramp laps", () => {
		const p = job({ tabs: noTabs });
		const o = toolOutline(p);
		const arcMoves = buildMoves(p, o, []).filter((m) => m.arc);
		expect(arcMoves).toHaveLength(4 * 11);
		const segs = parsePath(generateGcode(p).gcode).filter((s) => s.kind === "arc");
		expect(segs.filter((s) => s.to.z < s.from.z)).toHaveLength(4 * 10);
		expect(segs.filter((s) => s.to.z === s.from.z)).toHaveLength(4);
	});
	it("rounded rectangles of any tab layout keep corners out of tab spans", () => {
		const p = job();
		const o = toolOutline(p);
		const { spans } = tabSpans(p, o);
		for (const a of o.arcs) for (const t of spans) expect(a.s1 <= t.start || a.s0 >= t.end).toBe(true);
	});
	it("reversing the outline flips arc direction and keeps them on the path", () => {
		const o = buildOutline(30, 20, 5);
		const r = reverseOutline(o);
		expect(o.arcs).toHaveLength(4);
		expect(r.arcs).toHaveLength(4);
		for (const a of r.arcs) {
			expect(a.cw).toBe(true);
			const v0 = r.vertices.find((v) => Math.abs(v.s - a.s0) < 1e-9)!;
			const v1 = r.vertices.find((v) => Math.abs(v.s - a.s1) < 1e-9)!;
			expect(Math.hypot(v0.x - a.cx, v0.y - a.cy)).toBeCloseTo(5, 9);
			expect(Math.hypot(v1.x - a.cx, v1.y - a.cy)).toBeCloseTo(5, 9);
		}
	});
	it("sharp corners and a tool-radius inside corner produce no arcs", () => {
		expect(parsePath(generateGcode(job({ cornerRadius: 0 })).gcode).some((s) => s.kind === "arc")).toBe(false);
		// Inside cut with corner radius = tool radius: the path's corners have radius 0.
		expect(parsePath(generateGcode(job({ cornerRadius: 2 })).gcode).some((s) => s.kind === "arc")).toBe(false);
	});
	it("a full stadium (radius = half the height) works", () => {
		const p = job({ cornerRadius: 20, mode: "part", tabs: noTabs });
		const arcs = cuttingPolylines(parsePath(generateGcode({ ...p, useArcs: true }).gcode), 0.002);
		const chords = cuttingPolylines(parsePath(generateGcode({ ...p, useArcs: false }).gcode), 0.002);
		expect(maxDeviation(arcs, chords)).toBeLessThan(0.015);
		expect(maxDeviation(chords, arcs)).toBeLessThan(0.015);
	});
	it("estimates time for arcs close to the chorded job", () => {
		const a = jobStats(generateGcode(job({ useArcs: true })).gcode).minutes;
		const c = jobStats(generateGcode(job({ useArcs: false })).gcode).minutes;
		expect(a).toBeGreaterThan(0);
		expect(Math.abs(a - c) / c).toBeLessThan(0.01);
	});
});

describe("zero position", () => {
	const positions = ["lower-left", "lower-right", "upper-left", "upper-right", "center"] as const;
	it.each(positions)("%s: the finished rectangle sits there relative to X0 Y0", (origin) => {
		// Outside cut, no tabs: the tool path is the rectangle grown by the tool radius.
		const p = job({ origin, mode: "part", tabs: noTabs, cornerRadius: 0, width: 60, height: 40 });
		const pts = cuttingPolylines(parsePath(generateGcode(p).gcode), 0.01).flat();
		const rt = p.toolDiameter / 2;
		const left = origin.endsWith("right") ? -60 : origin === "center" ? -30 : 0;
		const bottom = origin.startsWith("upper") ? -40 : origin === "center" ? -20 : 0;
		expect(Math.min(...pts.map((q) => q.x))).toBeCloseTo(left - rt);
		expect(Math.max(...pts.map((q) => q.x))).toBeCloseTo(left + 60 + rt);
		expect(Math.min(...pts.map((q) => q.y))).toBeCloseTo(bottom - rt);
		expect(Math.max(...pts.map((q) => q.y))).toBeCloseTo(bottom + 40 + rt);
	});
	it("arcs follow the zero too", () => {
		const a = parsePath(generateGcode(job({ origin: "lower-left" })).gcode).filter((s) => s.kind === "arc");
		const b = parsePath(generateGcode(job({ origin: "upper-right" })).gcode).filter((s) => s.kind === "arc");
		expect(b).toHaveLength(a.length);
		a.forEach((s, i) => {
			expect(b[i].centre!.x - s.centre!.x).toBeCloseTo(-60);
			expect(b[i].centre!.y - s.centre!.y).toBeCloseTo(-40);
		});
	});
});
