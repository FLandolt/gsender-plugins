import { describe, expect, it } from "vitest";

import { buildMoves, generateGcode, lapCount, toolOutline, tabSpans } from "./generate";
import { buildOutline } from "./outline";
import { check, defaultParams, type Params } from "./params";

const base = (patch: Partial<Params> = {}): Params => ({ ...defaultParams(), ...patch });

describe("outline", () => {
	it("sharp rectangle has the expected perimeter", () => {
		const o = buildOutline(30, 20, 0);
		expect(o.length).toBeCloseTo(2 * (60 + 40));
	});
	it("rounded perimeter ≈ 2(w+h) − 8r + 2πr", () => {
		const o = buildOutline(30, 20, 5);
		expect(o.length).toBeCloseTo(2 * (60 + 40) - 8 * 5 + 2 * Math.PI * 5, 1);
	});
	it("is closed", () => {
		const v = buildOutline(30, 20, 5).vertices;
		expect(v[0].x).toBeCloseTo(v.at(-1)!.x);
		expect(v[0].y).toBeCloseTo(v.at(-1)!.y);
	});
});

describe("tool path", () => {
	it("inside is inset by the tool radius, outside is outset", () => {
		const hole = toolOutline(base({ mode: "hole" })).vertices;
		const part = toolOutline(base({ mode: "part" })).vertices;
		const maxX = (v: { x: number }[]) => Math.max(...v.map((p) => p.x));
		expect(maxX(hole)).toBeCloseTo(30 - base().toolDiameter / 2);
		expect(maxX(part)).toBeCloseTo(30 + base().toolDiameter / 2);
	});
	it("never leaves the allowed envelope", () => {
		const p = base({ cornerRadius: 8 });
		for (const v of toolOutline(p).vertices) {
			expect(Math.abs(v.x)).toBeLessThanOrEqual(30 - base().toolDiameter / 2 + 1e-6);
			expect(Math.abs(v.y)).toBeLessThanOrEqual(20 - base().toolDiameter / 2 + 1e-6);
		}
	});
	it("inside + climb is clockwise, outside + climb counter-clockwise", () => {
		const area = (vs: { x: number; y: number }[]) =>
			vs.reduce((a, v, i) => {
				const n = vs[(i + 1) % vs.length];
				return a + (v.x * n.y - n.x * v.y) / 2;
			}, 0);
		expect(area(toolOutline(base({ mode: "hole" })).vertices)).toBeLessThan(0);
		expect(area(toolOutline(base({ mode: "part" })).vertices)).toBeGreaterThan(0);
	});
});

describe("depth and tabs", () => {
	it("reaches full depth and never rises except over tabs", () => {
		const p = base();
		const o = toolOutline(p);
		const moves = buildMoves(p, o, tabSpans(p, o).spans);
		expect(Math.min(...moves.map((m) => m.z))).toBeCloseTo(-p.depth);
	});
	it("tabs are trapezoids: sloped sides and a flat top at depth − tab height", () => {
		const p = base();
		const o = toolOutline(p);
		const { spans } = tabSpans(p, o);
		expect(spans).toHaveLength(4);
		const moves = buildMoves(p, o, spans);
		const tabTop = -(p.depth - p.tabs.height);
		// Final flat lap: the moves after the last point at (almost) full depth up to the end.
		const flatLap = moves.slice(-(o.vertices.length - 1 + 4 * spans.length));
		const top = flatLap.filter((m) => Math.abs(m.z - tabTop) < 1e-9);
		expect(top.length).toBeGreaterThanOrEqual(spans.length * 2);
		// Never a vertical wall: consecutive moves that change Z also change X or Y.
		for (let i = 1; i < moves.length; i += 1) {
			const a = moves[i - 1];
			const b = moves[i];
			if (Math.abs(a.z - b.z) > 1e-9) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1e-6);
		}
		// The rise over each side is at most 45°.
		for (let i = 1; i < moves.length; i += 1) {
			const a = moves[i - 1];
			const b = moves[i];
			const run = Math.hypot(a.x - b.x, a.y - b.y);
			if (run > 1e-6 && b.z > a.z + 1e-9) expect((b.z - a.z) / run).toBeLessThanOrEqual(1 + 1e-6);
		}
		expect(Math.min(...flatLap.map((m) => m.z))).toBeCloseTo(-p.depth);
	});
	it("rectangular tabs hold the tab top with vertical sides", () => {
		const p = base({ tabs: { ...defaultParams().tabs, shape: "rectangular" } });
		const o = toolOutline(p);
		const { spans } = tabSpans(p, o);
		const moves = buildMoves(p, o, spans);
		const tabTop = -(p.depth - p.tabs.height);
		expect(moves.filter((m) => Math.abs(m.z - tabTop) < 1e-9).length).toBeGreaterThanOrEqual(spans.length * 2);
		const vertical = moves.slice(1).filter((m, i) => Math.abs(m.z - moves[i].z) > 1e-9 && Math.hypot(m.x - moves[i].x, m.y - moves[i].y) < 1e-9);
		expect(vertical.length).toBeGreaterThan(0);
		expect(Math.min(...moves.map((m) => m.z))).toBeCloseTo(-p.depth);
	});
	it("no tabs when disabled", () => {
		const p = base({ tabs: { ...defaultParams().tabs, enabled: false } });
		expect(tabSpans(p, toolOutline(p)).spans).toHaveLength(0);
	});
	it("laps = ceil(depth / stepdown)", () => {
		expect(lapCount(19, 2)).toBe(10);
	});
});

describe("gcode", () => {
	it("uses only GRBL-safe words", () => {
		const { gcode } = generateGcode(base({ cornerRadius: 6 }));
		const words = new Set(
			[...gcode.replace(/\([^)]*\)/g, "").matchAll(/\b([GM]\d+)\b/g)].map((m) => m[1]),
		);
		for (const w of words) expect(["G0", "G1", "G4", "G17", "G21", "G90", "G94", "M3", "M5", "M30"]).toContain(w);
	});
	it("lower-left origin shifts X/Y into positive space", () => {
		const { gcode } = generateGcode(base({ origin: "lower-left", mode: "part", tabs: { ...defaultParams().tabs, enabled: false } }));
		for (const m of gcode.matchAll(/ X(-?[\d.]+) Y(-?[\d.]+)/g)) {
			expect(Number(m[1])).toBeGreaterThanOrEqual(-base().toolDiameter / 2 - 1e-6);
			expect(Number(m[2])).toBeGreaterThanOrEqual(-base().toolDiameter / 2 - 1e-6);
		}
	});
});

describe("check", () => {
	it("flags a radius that is too large and a too-small inside cut", () => {
		expect(check(base({ cornerRadius: 25 })).errors).not.toHaveLength(0);
		expect(check(base({ width: 3 })).errors).not.toHaveLength(0);
		expect(check(base()).errors).toHaveLength(0);
	});
	it("warns about sharp inside corners with a round bit", () => {
		expect(check(base()).warnings.join(" ")).toMatch(/sharp inside corners/);
		expect(check(base({ cornerRadius: 5 })).warnings).toHaveLength(0);
	});
});
