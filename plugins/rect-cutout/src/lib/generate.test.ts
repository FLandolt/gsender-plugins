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
	it("tab floor holds at depth − tab height", () => {
		const p = base();
		const o = toolOutline(p);
		const { spans } = tabSpans(p, o);
		expect(spans).toHaveLength(4);
		const moves = buildMoves(p, o, spans);
		// In the final flat lap, every tab is held at the tab top.
		const tabTop = -(p.depth - p.tabs.height);
		const lastLap = moves.slice(-(o.vertices.length - 1 + 4 * spans.length));
		expect(lastLap.filter((m) => Math.abs(m.z - tabTop) < 1e-9).length).toBeGreaterThanOrEqual(spans.length * 2);
		expect(Math.min(...lastLap.map((m) => m.z))).toBeCloseTo(-p.depth);
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
