import { describe, expect, it } from "vitest";

import { parsePath, type Segment } from "@shared/path";
import { originOffset, type Position } from "@shared/position";
import { jobStats } from "@shared/stats";

import { generateGcode, mapPoint, OVERSHOOT, passPositions, zLevels } from "./generate";
import { check, defaultParams, describeStart, type Params } from "./params";

const job = (patch: Partial<Params> = {}): Params => ({ ...defaultParams(), ...patch });
const strip = (g: string) => g.replace(/\([^)]*\)/g, "");
const cuts = (segs: Segment[]) => segs.filter((s) => s.kind === "line" && (s.from.x !== s.to.x || s.from.y !== s.to.y));
const corners: Pick<Params, "startX" | "startY">[] = [
	{ startX: "left", startY: "bottom" },
	{ startX: "right", startY: "bottom" },
	{ startX: "left", startY: "top" },
	{ startX: "right", startY: "top" },
];

describe("passes", () => {
	it("are evenly spaced, cover 0..span and never exceed the stepover", () => {
		const v = passPositions(60, 6, 0.5);
		expect(v[0]).toBe(0);
		expect(v.at(-1)).toBeCloseTo(60);
		for (let i = 1; i < v.length; i += 1) expect(v[i] - v[i - 1]).toBeLessThanOrEqual(3 + 1e-9);
	});
	it("a span smaller than the stepover still gets a pass at each edge", () => {
		expect(passPositions(1, 6, 0.5)).toEqual([0, 1]);
	});
	it("levels end exactly at depth", () => {
		expect(zLevels(2.5, 1).at(-1)).toBe(-2.5);
		expect(zLevels(1, 2)).toEqual([-1]);
	});
});

describe("start corner and direction", () => {
	it("maps the start corner to the right machine corner for both axes", () => {
		const base = job({ width: 100, height: 60 });
		expect(mapPoint({ ...base, startX: "left", startY: "bottom", passAxis: "x" }, 0, 0)).toEqual({ x: 0, y: 0 });
		expect(mapPoint({ ...base, startX: "right", startY: "bottom", passAxis: "x" }, 0, 0)).toEqual({ x: 100, y: 0 });
		expect(mapPoint({ ...base, startX: "left", startY: "top", passAxis: "y" }, 0, 0)).toEqual({ x: 0, y: 60 });
		expect(mapPoint({ ...base, startX: "right", startY: "top", passAxis: "y" }, 0, 0)).toEqual({ x: 100, y: 60 });
	});
	it.each(corners.flatMap((c) => (["x", "y"] as const).map((passAxis) => ({ ...c, passAxis }))))(
		"first pass starts at the $startX $startY corner and runs along $passAxis",
		(patch) => {
			const p = job({ ...patch, turn: "inside" });
			const first = cuts(parsePath(generateGcode(p)))[0];
			expect(first.from.x).toBeCloseTo(patch.startX === "left" ? 0 : p.width);
			expect(first.from.y).toBeCloseTo(patch.startY === "bottom" ? 0 : p.height);
			if (patch.passAxis === "x") {
				expect(first.to.y).toBeCloseTo(first.from.y);
				expect(Math.sign(first.to.x - first.from.x)).toBe(patch.startX === "left" ? 1 : -1);
			} else {
				expect(first.to.x).toBeCloseTo(first.from.x);
				expect(Math.sign(first.to.y - first.from.y)).toBe(patch.startY === "bottom" ? 1 : -1);
			}
		},
	);
	it("the stepover moves away from the start edge", () => {
		const p = job({ startX: "left", startY: "top", passAxis: "x", turn: "inside" });
		const ys = cuts(parsePath(generateGcode(p))).map((s) => s.to.y);
		expect(Math.max(...ys)).toBeCloseTo(p.height);
		expect(Math.min(...ys)).toBeCloseTo(0);
		expect(ys[0]).toBeCloseTo(p.height);
	});
	it("describes the first pass in words", () => {
		expect(describeStart(job())).toBe("First pass runs right along the bottom edge, then steps up.");
		expect(describeStart(job({ startX: "right", startY: "top", passAxis: "y" }))).toBe("First pass runs down along the right edge, then steps left.");
	});
});

describe("turns", () => {
	it("outside: passes overshoot every edge by more than the bit diameter", () => {
		const p = job({ turn: "outside" });
		const segs = cuts(parsePath(generateGcode(p)));
		const xs = segs.flatMap((s) => [s.from.x, s.to.x]);
		expect(Math.min(...xs)).toBeCloseTo(-p.toolDiameter * OVERSHOOT);
		expect(Math.max(...xs)).toBeCloseTo(p.width + p.toolDiameter * OVERSHOOT);
		expect(OVERSHOOT).toBeGreaterThan(1);
		// The steps happen outside the material.
		const steps = segs.filter((s) => s.from.x === s.to.x && s.from.y !== s.to.y);
		expect(steps.length).toBeGreaterThan(0);
		for (const s of steps) expect(s.from.x < 0 || s.from.x > p.width).toBe(true);
	});
	it("inside: passes stop on the edge and the step is cut along it", () => {
		const p = job({ turn: "inside" });
		const segs = cuts(parsePath(generateGcode(p)));
		for (const s of segs) {
			expect(s.from.x).toBeGreaterThanOrEqual(-1e-9);
			expect(s.to.x).toBeLessThanOrEqual(p.width + 1e-9);
		}
		const steps = segs.filter((s) => s.from.x === s.to.x && s.from.y !== s.to.y);
		for (const s of steps) expect(s.from.x === 0 || Math.abs(s.from.x - p.width) < 1e-9).toBe(true);
	});
	it("every move is a straight G0/G1", () => {
		const g = generateGcode(job());
		const words = new Set([...strip(g).matchAll(/\b([GM]\d+)\b/g)].map((m) => m[1]));
		for (const w of words) expect(["G0", "G1", "G4", "G17", "G21", "G90", "G94", "M3", "M5", "M30"]).toContain(w);
	});
});

describe("pattern", () => {
	it("snake alternates direction and steps over without lifting", () => {
		const p = job({ pattern: "snake", turn: "inside", height: 30 });
		const segs = parsePath(generateGcode(p)).filter((s) => s.kind === "line" && s.from.y === s.to.y && s.from.x !== s.to.x);
		segs.forEach((s, i) => expect(Math.sign(s.to.x - s.from.x)).toBe(i % 2 === 0 ? 1 : -1));
		// One plunge per level: no lifts between passes.
		expect(generateGcode(p).match(/^G1 Z/gm)).toHaveLength(zLevels(p.depth, p.stepdown).length);
	});
	it("same direction: every pass cuts the same way, with a lift and return between", () => {
		const p = job({ pattern: "same", turn: "inside", height: 30 });
		const g = generateGcode(p);
		const segs = parsePath(g).filter((s) => s.kind === "line" && s.from.y === s.to.y && s.from.x !== s.to.x);
		expect(segs.length).toBeGreaterThan(1);
		for (const s of segs) expect(Math.sign(s.to.x - s.from.x)).toBe(1);
		const passes = segs.length;
		expect(g.match(/^G1 Z/gm)).toHaveLength(passes);
		// Never cuts sideways: the return is a rapid, with the bit lifted.
		for (const s of parsePath(g).filter((x) => x.kind === "line")) expect(s.from.y).toBeCloseTo(s.to.y);
	});
	it("the area is fully covered: neighbouring passes are never further apart than the stepover", () => {
		const p = job({ turn: "inside" });
		const ys = [...new Set(cuts(parsePath(generateGcode(p))).map((s) => s.to.y.toFixed(6)))].map(Number).sort((a, b) => a - b);
		for (let i = 1; i < ys.length; i += 1) expect(ys[i] - ys[i - 1]).toBeLessThanOrEqual(p.toolDiameter * p.stepover + 1e-6);
	});
});

describe("depth", () => {
	it("repeats the pattern at each level and reaches full depth", () => {
		const p = job({ depth: 2.5, stepdown: 1 });
		const g = generateGcode(p);
		const zs = [...g.matchAll(/^G1 Z(-?[\d.]+)/gm)].map((m) => Number(m[1]));
		expect(zs).toHaveLength(3);
		expect(zs.at(-1)).toBeCloseTo(-2.5);
		for (let i = 1; i < zs.length; i += 1) expect(zs[i]).toBeLessThan(zs[i - 1]);
	});
	it("never cuts above the level, and rapids stay above the stock when moving sideways", () => {
		const p = job({ pattern: "same", depth: 2, stepdown: 1 });
		let level = 0;
		for (const s of parsePath(generateGcode(p))) {
			if (s.kind === "rapid" && (s.from.x !== s.to.x || s.from.y !== s.to.y)) expect(s.to.z).toBeGreaterThan(0);
			if (s.kind === "line" && s.from.z === s.to.z) level = s.to.z;
		}
		expect(level).toBeCloseTo(-2);
	});
});

describe("zero position", () => {
	const positions: Position[] = ["lower-left", "lower-right", "upper-left", "upper-right", "center"];
	it.each(positions)("%s: the whole area is shifted so X0 Y0 sits there", (origin) => {
		const p = job({ origin, turn: "inside", width: 100, height: 60 });
		const segs = cuts(parsePath(generateGcode(p)));
		const pts = segs.flatMap((s) => [s.from, s.to]);
		const o = originOffset(origin, p.width, p.height);
		expect(Math.min(...pts.map((q) => q.x))).toBeCloseTo(-o.x);
		expect(Math.max(...pts.map((q) => q.x))).toBeCloseTo(p.width - o.x);
		expect(Math.min(...pts.map((q) => q.y))).toBeCloseTo(-o.y);
		expect(Math.max(...pts.map((q) => q.y))).toBeCloseTo(p.height - o.y);
	});
	it("moving the zero only shifts the path; the order of the passes does not change", () => {
		const a = cuts(parsePath(generateGcode(job({ origin: "lower-left", startX: "right", startY: "top" }))));
		const b = cuts(parsePath(generateGcode(job({ origin: "upper-right", startX: "right", startY: "top" }))));
		expect(b).toHaveLength(a.length);
		a.forEach((s, i) => {
			expect(b[i].to.x - s.to.x).toBeCloseTo(-100);
			expect(b[i].to.y - s.to.y).toBeCloseTo(-60);
			expect(b[i].to.z).toBeCloseTo(s.to.z);
		});
	});
	it("the start corner can be somewhere other than the zero", () => {
		const p = job({ origin: "center", startX: "left", startY: "bottom", turn: "inside" });
		const first = cuts(parsePath(generateGcode(p)))[0];
		expect(first.from.x).toBeCloseTo(-50);
		expect(first.from.y).toBeCloseTo(-30);
	});
});

describe("units", () => {
	it("inches: 4 decimals, G20 and the same geometry", () => {
		const mm = parsePath(generateGcode(job({ units: "mm" })));
		const inch = generateGcode(job({ units: "in" }));
		expect(inch).toMatch(/^G20$/m);
		const segs = parsePath(inch);
		expect(segs).toHaveLength(mm.length);
		segs.forEach((s, i) => {
			expect(s.to.x * 25.4).toBeCloseTo(mm[i].to.x, 2);
			expect(s.to.y * 25.4).toBeCloseTo(mm[i].to.y, 2);
			expect(s.to.z * 25.4).toBeCloseTo(mm[i].to.z, 2);
		});
		expect(inch).toMatch(/\.\d{4}\b/);
	});
	it("job stats see the passes", () => {
		expect(jobStats(generateGcode(job())).minutes).toBeGreaterThan(0.1);
	});
});

describe("check", () => {
	it("accepts the defaults and rejects bad input", () => {
		expect(check(defaultParams()).errors).toHaveLength(0);
		expect(check(job({ width: 0 })).errors).not.toHaveLength(0);
		expect(check(job({ stepover: 1.5 })).errors).not.toHaveLength(0);
		expect(check(job({ stepover: 0.95 })).warnings).not.toHaveLength(0);
	});
});
