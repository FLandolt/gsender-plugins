import { describe, expect, it } from "vitest";

import { arcRadius, arcSweep, cuttingPolylines, maxDeviation, parsePath } from "@shared/path";

import { buildMoves, generateGcode, toolOutline, tabSpans } from "./generate";
import { buildCircleOutline, reverseOutline } from "./outline";
import { check, defaultParams, type Params } from "./params";

const circle = (patch: Partial<Params> = {}): Params => ({
	...defaultParams(),
	shape: "circle",
	diameter: 50,
	depth: 6,
	tabs: { ...defaultParams().tabs, perSide: 4 },
	...patch,
});
const noTabs = { ...defaultParams().tabs, enabled: false };
const strip = (g: string) => g.replace(/\([^)]*\)/g, "");

describe("circle outline", () => {
	it("is a closed circle of the right length with four quarter arcs", () => {
		const o = buildCircleOutline(20);
		expect(o.length).toBeCloseTo(2 * Math.PI * 20);
		expect(o.sides).toHaveLength(0);
		expect(o.arcs).toHaveLength(4);
		for (const v of o.vertices) expect(Math.hypot(v.x, v.y)).toBeCloseTo(20, 9);
		expect(o.vertices[0].x).toBeCloseTo(o.vertices.at(-1)!.x, 9);
		expect(o.vertices[0].y).toBeCloseTo(o.vertices.at(-1)!.y, 9);
	});
	it("reversed, it runs clockwise from the same point", () => {
		const o = buildCircleOutline(20);
		const r = reverseOutline(o);
		expect(r.arcs.every((a) => a.cw)).toBe(true);
		expect(r.vertices[0].x).toBeCloseTo(o.vertices[0].x, 9);
		expect(r.vertices[1].x).not.toBeCloseTo(o.vertices[1].x, 3);
	});
	it("the tool path is inset (inside) or outset (outside) by the tool radius", () => {
		const inside = toolOutline(circle({ mode: "hole" }));
		const outside = toolOutline(circle({ mode: "part" }));
		expect(Math.hypot(inside.vertices[3].x, inside.vertices[3].y)).toBeCloseTo(25 - 2, 9);
		expect(Math.hypot(outside.vertices[3].x, outside.vertices[3].y)).toBeCloseTo(25 + 2, 9);
	});
});

describe.each([
	{ name: "inside, mm", patch: {} as Partial<Params>, mmPerUnit: 1, decimals: 3 },
	{ name: "outside, conventional, mm", patch: { mode: "part", direction: "conventional" } as Partial<Params>, mmPerUnit: 1, decimals: 3 },
	{ name: "inside, rectangular tabs", patch: { tabs: { ...defaultParams().tabs, perSide: 3, shape: "rectangular" } } as Partial<Params>, mmPerUnit: 1, decimals: 3 },
	{ name: "inside, lower-left zero, inch", patch: { origin: "lower-left", units: "in" } as Partial<Params>, mmPerUnit: 25.4, decimals: 4 },
	{ name: "inside, no tabs", patch: { tabs: noTabs } as Partial<Params>, mmPerUnit: 1, decimals: 3 },
])("circle cutout ($name)", ({ patch, mmPerUnit, decimals }) => {
	const arcs = generateGcode(circle({ ...patch, useArcs: true })).gcode;
	const chords = generateGcode(circle({ ...patch, useArcs: false })).gcode;
	const sag = 0.002 / mmPerUnit;

	it("arc mode writes arcs, chord mode only lines", () => {
		expect(parsePath(arcs).filter((s) => s.kind === "arc").length).toBeGreaterThan(10);
		expect(parsePath(chords).some((s) => s.kind === "arc")).toBe(false);
		expect(arcs.split("\n").length).toBeLessThan(chords.split("\n").length / 2);
	});
	it("both modes cut the same path within tolerance", () => {
		const a = cuttingPolylines(parsePath(arcs), sag);
		const b = cuttingPolylines(parsePath(chords), sag);
		const tol = 0.015 / mmPerUnit;
		expect(maxDeviation(a, b)).toBeLessThan(tol);
		expect(maxDeviation(b, a)).toBeLessThan(tol);
	});
	it("every arc has matching start and end radius and a sensible sweep", () => {
		for (const s of parsePath(arcs).filter((x) => x.kind === "arc")) {
			const rEnd = Math.hypot(s.to.x - s.centre!.x, s.to.y - s.centre!.y);
			expect(Math.abs(rEnd - arcRadius(s))).toBeLessThan(1.5 * 10 ** -decimals);
			expect(Math.abs(arcSweep(s))).toBeLessThanOrEqual(Math.PI / 2 + 1e-6);
			expect(s.from.x !== s.to.x || s.from.y !== s.to.y).toBe(true);
		}
		expect(arcs).toMatch(/^G17$/m);
		expect(arcs).not.toMatch(/\bR-?\d/);
	});
	it("reaches full depth and only ever uses the safe words", () => {
		const p = circle(patch);
		expect(Math.min(...parsePath(arcs).map((s) => s.to.z))).toBeCloseTo(-p.depth / mmPerUnit, decimals);
		const words = new Set([...strip(arcs).matchAll(/\b([GM]\d+)\b/g)].map((m) => m[1]));
		for (const w of words) expect(["G0", "G1", "G2", "G3", "G4", "G17", "G20", "G21", "G90", "G94", "M3", "M5", "M30"]).toContain(w);
	});
});

describe("circle tabs", () => {
	it("are spread evenly and sit apart from each other", () => {
		const p = circle();
		const o = toolOutline(p);
		const { spans, skippedSides } = tabSpans(p, o);
		expect(skippedSides).toBe(0);
		expect(spans).toHaveLength(4);
		for (let i = 1; i < spans.length; i += 1) {
			expect(spans[i].start - spans[i - 1].start).toBeCloseTo(o.length / 4, 9);
			expect(spans[i].start).toBeGreaterThan(spans[i - 1].end);
		}
	});
	it("trapezoid tabs raise the floor to depth minus tab height with sloped sides", () => {
		const p = circle({ useArcs: false });
		const o = toolOutline(p);
		const moves = buildMoves(p, o, tabSpans(p, o).spans);
		const tabTop = -(p.depth - p.tabs.height);
		expect(moves.filter((m) => Math.abs(m.z - tabTop) < 1e-9).length).toBeGreaterThanOrEqual(8);
		expect(Math.min(...moves.map((m) => m.z))).toBeCloseTo(-p.depth);
		for (let i = 1; i < moves.length; i += 1) {
			const run = Math.hypot(moves[i].x - moves[i - 1].x, moves[i].y - moves[i - 1].y);
			// The slope is 45° along the arc; a chord is a hair shorter than its arc, hence the tolerance.
			if (run > 1e-6 && moves[i].z > moves[i - 1].z + 1e-9) expect((moves[i].z - moves[i - 1].z) / run).toBeLessThanOrEqual(1 + 1e-3);
		}
	});
	it("arcs run between and over the tabs (helical on the slopes)", () => {
		const segs = parsePath(generateGcode(circle()).gcode).filter((s) => s.kind === "arc");
		expect(segs.some((s) => s.to.z > s.from.z)).toBe(true); // climbing a tab side
		expect(segs.some((s) => s.to.z === s.from.z)).toBe(true); // flat on a tab or the final lap
	});
	it("warns and skips tabs that do not fit", () => {
		const r = generateGcode(circle({ diameter: 12, tabs: { ...defaultParams().tabs, perSide: 4, length: 8 } }));
		expect(r.warnings.join(" ")).toMatch(/don't fit/);
	});
	it("no tabs when disabled", () => {
		const p = circle({ tabs: noTabs });
		expect(tabSpans(p, toolOutline(p)).spans).toHaveLength(0);
	});
});

describe("circle zero and checks", () => {
	it("centre zero puts the finished circle around 0,0; a corner zero shifts it", () => {
		const pts = (origin: Params["origin"]) => cuttingPolylines(parsePath(generateGcode(circle({ origin, mode: "part", tabs: noTabs })).gcode), 0.01).flat();
		const c = pts("center");
		expect(Math.max(...c.map((q) => q.x))).toBeCloseTo(27);
		expect(Math.min(...c.map((q) => q.x))).toBeCloseTo(-27);
		const ll = pts("lower-left");
		expect(Math.min(...ll.map((q) => q.x))).toBeCloseTo(25 - 27);
		expect(Math.max(...ll.map((q) => q.y))).toBeCloseTo(25 + 27);
		const ur = pts("upper-right");
		expect(Math.max(...ur.map((q) => q.x))).toBeCloseTo(-25 + 27);
	});
	it("validates the diameter and the inside cut", () => {
		expect(check(circle()).errors).toHaveLength(0);
		expect(check(circle({ diameter: 0 })).errors).not.toHaveLength(0);
		expect(check(circle({ diameter: 3 })).errors).not.toHaveLength(0);
		expect(check(circle({ mode: "part", diameter: 3 })).errors).toHaveLength(0);
		expect(check(circle()).warnings).toHaveLength(0);
	});
});
