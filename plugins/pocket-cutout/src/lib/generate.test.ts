import { describe, expect, it } from "vitest";

import { originOffset, type Position } from "@shared/position";
import { arcRadius, arcSweep, cuttingPolylines, maxDeviation, parsePath, type Pt3, type Segment } from "@shared/path";
import { jobStats } from "@shared/stats";

import { generateGcode } from "./generate";
import { toolRegion, zLevels } from "./geometry";
import { check, defaultParams, type Params } from "./params";

const job = (patch: Partial<Params> = {}): Params => ({ ...defaultParams(), ...patch });
const strip = (g: string) => g.replace(/\([^)]*\)/g, "");
const words = (g: string) => new Set([...strip(g).matchAll(/\b([GM]\d+)\b/g)].map((m) => m[1]));
const cutting = (segs: Segment[]) => segs.filter((s) => s.kind !== "rapid");
const segmentXY = (s: Segment) => Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y);

/** Points along every cutting move, no further than `step` apart (lines are only sampled at their ends). */
const dense = (segs: Segment[], step = 0.2): Pt3[] => {
	const out: Pt3[] = [];
	for (const line of cuttingPolylines(segs, 0.02)) {
		for (let i = 1; i < line.length; i += 1) {
			const a = line[i - 1], b = line[i];
			const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / step));
			for (let k = 0; k <= n; k += 1) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
		}
	}
	return out;
};

/** Is (x, y) inside a rounded rectangle of half sizes hx × hy and corner radius r? */
const insideRounded = (x: number, y: number, hx: number, hy: number, r: number, slack = 0): boolean => {
	const ax = Math.abs(x), ay = Math.abs(y);
	if (ax > hx + slack || ay > hy + slack) return false;
	const cx = ax - (hx - r), cy = ay - (hy - r);
	return cx <= 0 || cy <= 0 || Math.hypot(cx, cy) <= r + slack;
};

const shapes: { name: string; patch: Partial<Params> }[] = [
	{ name: "rectangle, sharp", patch: { shape: "rectangle", width: 40, height: 28, cornerRadius: 0 } },
	{ name: "rectangle, rounded", patch: { shape: "rectangle", width: 40, height: 28, cornerRadius: 8 } },
	{ name: "tall rectangle", patch: { shape: "rectangle", width: 22, height: 50, cornerRadius: 5 } },
	{ name: "stadium", patch: { shape: "rectangle", width: 50, height: 20, cornerRadius: 10 } },
	{ name: "circle", patch: { shape: "circle", diameter: 36 } },
];

const cases = shapes.flatMap((s) =>
	(["cw", "ccw"] as const).flatMap((rotation) =>
		[true, false].map((useArcs) => ({ label: `${s.name}, ${rotation}, arcs ${useArcs ? "on" : "off"}`, p: job({ ...s.patch, rotation, useArcs, depth: 4, stepdown: 2 }) })),
	),
);

describe.each(cases)("pocket ($label)", ({ p }) => {
	const g = generateGcode(p);
	const segs = parsePath(g);
	const rt = p.toolDiameter / 2;
	const reg = toolRegion(p);
	const inRegion = (x: number, y: number, slack: number) =>
		reg.shape === "circle" ? Math.hypot(x, y) <= reg.R + slack : insideRounded(x, y, reg.hx, reg.hy, reg.r, slack);
	const pts = dense(segs);

	it("the tool centre never leaves the pocket (one tool radius in from the wall)", () => {
		for (const q of pts) expect(inRegion(q.x, q.y, 0.003)).toBe(true);
	});

	it("every point the tool can reach is cut at full depth", () => {
		const floor = pts.filter((q) => q.z <= -p.depth + 1e-6);
		expect(floor.length).toBeGreaterThan(10);
		// Everything within a tool radius of where the centre may go.
		const reachable = (x: number, y: number) =>
			reg.shape === "circle" ? Math.hypot(x, y) <= reg.R + rt - 0.08 : insideRounded(x, y, reg.hx + rt - 0.08, reg.hy + rt - 0.08, reg.r + rt - 0.08);
		const extentX = reg.shape === "circle" ? reg.R + rt : reg.hx + rt;
		const extentY = reg.shape === "circle" ? reg.R + rt : reg.hy + rt;
		let uncut = 0;
		for (let x = -extentX; x <= extentX; x += 1) {
			for (let y = -extentY; y <= extentY; y += 1) {
				if (!reachable(x, y)) continue;
				let best = Infinity;
				for (const q of floor) best = Math.min(best, Math.hypot(q.x - x, q.y - y));
				if (best > rt + 0.03) uncut += 1;
			}
		}
		expect(uncut).toBe(0);
	});

	it("enters with a helix: the only vertical cutting move is the short drop onto the last floor", () => {
		const levels = zLevels(p.depth, p.stepdown);
		const vertical = cutting(segs).filter((s) => s.from.x === s.to.x && s.from.y === s.to.y && s.kind === "line");
		expect(vertical).toHaveLength(levels.length);
		vertical.forEach((s, i) => {
			const prevFloor = i === 0 ? 0 : levels[i - 1];
			expect(s.to.z).toBeCloseTo(prevFloor, 9); // down to the existing floor, never into material
			expect(s.from.z - s.to.z).toBeLessThanOrEqual(1 + 1e-9);
		});
		// Every other change of Z happens while moving sideways, and only downwards.
		for (const s of cutting(segs).filter((x) => !vertical.includes(x) && x.to.z !== x.from.z)) {
			expect(s.to.z).toBeLessThan(s.from.z);
			expect(segmentXY(s)).toBeGreaterThan(0.01);
		}
		expect(Math.min(...segs.map((s) => s.to.z))).toBeCloseTo(-p.depth);
	});

	it("emits only GRBL-safe words and selects the XY plane before any arc", () => {
		for (const w of words(g)) expect(["G0", "G1", "G2", "G3", "G4", "G17", "G21", "G90", "G94", "M3", "M5", "M30"]).toContain(w);
		if (p.useArcs) expect(g.search(/^G17$/m)).toBeLessThan(g.search(/^G[23] /m));
		else expect(words(g).has("G2") || words(g).has("G3")).toBe(false);
	});

	it("arcs: start and end radius agree, none is a full circle", () => {
		for (const s of segs.filter((x) => x.kind === "arc")) {
			const rEnd = Math.hypot(s.to.x - s.centre!.x, s.to.y - s.centre!.y);
			expect(Math.abs(rEnd - arcRadius(s))).toBeLessThan(0.0015);
			expect(s.from.x !== s.to.x || s.from.y !== s.to.y).toBe(true);
			expect(Math.abs(arcSweep(s))).toBeLessThanOrEqual(Math.PI + 1e-6);
		}
		expect(g).not.toMatch(/\bR-?\d/);
	});
});

describe("spiral direction", () => {
	/** Signed area swept around the middle: positive is counter-clockwise. */
	const turning = (p: Params): number => {
		const floor = dense(parsePath(generateGcode(p)), 0.1).filter((q) => q.z <= -p.depth + 1e-6);
		let sum = 0;
		for (let i = 1; i < floor.length; i += 1) sum += floor[i - 1].x * floor[i].y - floor[i].x * floor[i - 1].y;
		return sum;
	};
	it.each(shapes)("$name: clockwise turns clockwise, counter-clockwise the other way", ({ patch }) => {
		expect(turning(job({ ...patch, rotation: "cw", depth: 2, useArcs: false }))).toBeLessThan(0);
		expect(turning(job({ ...patch, rotation: "ccw", depth: 2, useArcs: false }))).toBeGreaterThan(0);
	});
	it("the two directions are mirror images of each other (arcs on)", () => {
		for (const { patch } of shapes) {
			const cw = cuttingPolylines(parsePath(generateGcode(job({ ...patch, rotation: "cw", depth: 2 }))), 0.002);
			const ccw = cuttingPolylines(parsePath(generateGcode(job({ ...patch, rotation: "ccw", depth: 2 }))), 0.002);
			// Both cover the same ground: the same reachable area is cut either way.
			expect(Math.abs(Math.max(...cw.flat().map((q) => q.x)) - Math.max(...ccw.flat().map((q) => q.x)))).toBeLessThan(0.01);
			expect(Math.abs(Math.max(...cw.flat().map((q) => q.y)) - Math.max(...ccw.flat().map((q) => q.y)))).toBeLessThan(0.01);
		}
	});
	it("clockwise uses mostly G2 and counter-clockwise mostly G3", () => {
		const turns = (rotation: "cw" | "ccw") => {
			const arcs = parsePath(generateGcode(job({ rotation, depth: 2 }))).filter((s) => s.kind === "arc");
			const total = arcs.reduce((sum, s) => sum + arcSweep(s), 0);
			return total;
		};
		expect(turns("cw")).toBeLessThan(0);
		expect(turns("ccw")).toBeGreaterThan(0);
	});
});

describe("lane change between rings", () => {
	/** Corners the path turns sharply at (more than 40°), along the floor level. */
	const sharpTurns = (p: Params): number => {
		const floor = dense(parsePath(generateGcode(p)), 0.1).filter((q) => q.z <= -p.depth + 1e-6);
		let count = 0;
		let prev: [number, number] | null = null;
		for (let i = 1; i < floor.length; i += 1) {
			const v: [number, number] = [floor[i].x - floor[i - 1].x, floor[i].y - floor[i - 1].y];
			if (Math.hypot(v[0], v[1]) < 1e-9) continue;
			if (prev) {
				const cos = (prev[0] * v[0] + prev[1] * v[1]) / (Math.hypot(...prev) * Math.hypot(...v));
				if (Math.acos(Math.max(-1, Math.min(1, cos))) > (40 * Math.PI) / 180) count += 1;
			}
			prev = v;
		}
		return count;
	};
	it.each([true, false])("a sharp-cornered pocket turns only at its corners: four per ring, none to step over (arcs %s)", (useArcs) => {
		const p = job({ shape: "rectangle", width: 40, height: 28, cornerRadius: 0, depth: 2, useArcs });
		const reg = toolRegion(p);
		const rings = Math.ceil(Math.min((reg as { hx: number; hy: number }).hx, (reg as { hx: number; hy: number }).hy) / Math.min(p.toolDiameter * p.stepover, p.toolDiameter / 2) - 1e-9);
		// The old straight step turned 90° twice per ring on top of the corners.
		expect(sharpTurns(p)).toBeLessThanOrEqual(4 * rings);
		expect(sharpTurns(p)).toBeGreaterThanOrEqual(4 * rings - 4);
	});
	it("arcs on: each lane change is a pair of equal arcs turning opposite ways", () => {
		const arcs = parsePath(generateGcode(job({ shape: "rectangle", width: 40, height: 28, cornerRadius: 0, depth: 2 }))).filter((s) => s.kind === "arc");
		// With sharp corners the gentle arcs (under 45°) are the lane changes; the helix and its flat lap are half circles.
		const lane = arcs.filter((s) => Math.abs(arcSweep(s)) < Math.PI / 4);
		expect(lane.length).toBeGreaterThanOrEqual(8);
		for (let i = 0; i + 1 < lane.length; i += 2) {
			expect(lane[i].cw).toBe(!lane[i + 1].cw);
			expect(arcRadius(lane[i])).toBeCloseTo(arcRadius(lane[i + 1]), 2);
			expect(Math.abs(arcSweep(lane[i]))).toBeCloseTo(Math.abs(arcSweep(lane[i + 1])), 3);
			expect(Math.abs(arcSweep(lane[i]))).toBeLessThan(Math.PI / 4); // gentle
		}
	});
	it("a round pocket needs no lane change: it is one smooth spiral", () => {
		expect(sharpTurns(job({ shape: "circle", diameter: 36, depth: 2, useArcs: false }))).toBe(0);
	});
});

describe("no material left behind", () => {
	// A fine grid, so a thin wedge beside a lane change or a ridge near the middle shows up.
	const fineCases = shapes.flatMap((s) => [0.4, 1].map((stepover) => ({ label: `${s.name}, stepover ${stepover}`, p: job({ ...s.patch, stepover, depth: 2, useArcs: false }) })));
	it.each(fineCases)("$label: every reachable point is within the tool radius of the full-depth path", ({ p }) => {
		const rt = p.toolDiameter / 2;
		const reg = toolRegion(p);
		const floor = dense(parsePath(generateGcode(p)), 0.05).filter((q) => q.z <= -p.depth + 1e-6);
		const cell = 1;
		const grid = new Map<string, Pt3[]>();
		for (const q of floor) {
			const k = `${Math.floor(q.x / cell)},${Math.floor(q.y / cell)}`;
			(grid.get(k) ?? grid.set(k, []).get(k)!).push(q);
		}
		const nearest = (x: number, y: number) => {
			let best = Infinity;
			for (let dx = -4; dx <= 4; dx += 1)
				for (let dy = -4; dy <= 4; dy += 1)
					for (const q of grid.get(`${Math.floor(x / cell) + dx},${Math.floor(y / cell) + dy}`) ?? []) best = Math.min(best, Math.hypot(q.x - x, q.y - y));
			return best;
		};
		const ex = reg.shape === "circle" ? reg.R + rt : reg.hx + rt;
		const ey = reg.shape === "circle" ? reg.R + rt : reg.hy + rt;
		let worst = 0;
		for (let x = -ex; x <= ex; x += 0.25) {
			for (let y = -ey; y <= ey; y += 0.25) {
				const reachable = reg.shape === "circle" ? Math.hypot(x, y) <= reg.R + rt - 0.05 : insideRounded(x, y, reg.hx + rt - 0.05, reg.hy + rt - 0.05, reg.r + rt - 0.05);
				if (reachable) worst = Math.max(worst, nearest(x, y) - rt);
			}
		}
		expect(worst).toBeLessThan(0.01);
	});
	it("after the helix there is a flat lap at full depth, cleaning the sloped floor under the ramp", () => {
		const p = job({ depth: 2, useArcs: false });
		const rh = Math.min(p.toolDiameter * 0.375, 17);
		const flat = dense(parsePath(generateGcode(p)), 0.05).filter((q) => q.z === -2 && Math.abs(Math.hypot(q.x, q.y) - rh) < 0.02);
		// A full circle's worth of points (about 2π·rh / 0.05), not just the end of the ramp.
		expect(flat.length).toBeGreaterThan((2 * Math.PI * rh) / 0.05 * 0.9);
	});
});

describe("arcs vs chords", () => {
	it.each(shapes)("$name: cut the same path within tolerance, in far fewer lines", ({ patch }) => {
		const on = job({ ...patch, useArcs: true, depth: 4 });
		const off = job({ ...patch, useArcs: false, depth: 4 });
		const a = cuttingPolylines(parsePath(generateGcode(on)), 0.002);
		const b = cuttingPolylines(parsePath(generateGcode(off)), 0.002);
		expect(maxDeviation(a, b)).toBeLessThan(0.03);
		expect(maxDeviation(b, a)).toBeLessThan(0.03);
		expect(generateGcode(on).split("\n").length).toBeLessThan(generateGcode(off).split("\n").length * 0.6);
	});
});

describe("spiral", () => {
	it("a round pocket works outwards from the middle to the wall circle", () => {
		const p = job({ shape: "circle", diameter: 36, useArcs: false, depth: 2 });
		const floor = dense(parsePath(generateGcode(p)), 0.05).filter((q) => q.z <= -2 + 1e-6);
		const r = floor.map((q) => Math.hypot(q.x, q.y));
		for (let i = 1; i < Math.floor(r.length * 0.7); i += 1) expect(r[i]).toBeGreaterThanOrEqual(r[i - 1] - 0.02);
		expect(Math.max(...r)).toBeCloseTo(18 - 3, 1);
	});
	it("a rectangle's rings grow outwards and the last is the wall", () => {
		const p = job({ width: 40, height: 28, cornerRadius: 0, useArcs: false, depth: 2 });
		const floor = dense(parsePath(generateGcode(p)), 0.05).filter((q) => q.z <= -2 + 1e-6);
		expect(Math.max(...floor.map((q) => Math.abs(q.x)))).toBeCloseTo(20 - 3, 6);
		expect(Math.max(...floor.map((q) => Math.abs(q.y)))).toBeCloseTo(14 - 3, 6);
	});
	it("a zero corner radius leaves the tool's radius in the corners", () => {
		const p = job({ cornerRadius: 0, width: 40, height: 28 });
		expect(toolRegion(p)).toMatchObject({ r: 0 });
		expect(check(p).warnings.join(" ")).toMatch(/tool's radius/);
		expect(toolRegion(job({ cornerRadius: 8 }))).toMatchObject({ r: 5 });
	});
});

describe("levels", () => {
	it("repeat the clearing at each depth and finish exactly at full depth", () => {
		const p = job({ depth: 5, stepdown: 2 });
		const g = generateGcode(p);
		expect([...g.matchAll(/^\(Level /gm)]).toHaveLength(3);
		expect(zLevels(5, 2).at(-1)).toBe(-5);
		expect(Math.min(...parsePath(g).map((s) => s.to.z))).toBeCloseTo(-5);
	});
	it("steps down by at most the stepdown per level", () => {
		let prev = 0;
		for (const z of zLevels(7, 2)) {
			expect(prev - z).toBeLessThanOrEqual(2 + 1e-9);
			prev = z;
		}
	});
});

describe("zero position", () => {
	const positions: Position[] = ["lower-left", "lower-right", "upper-left", "upper-right", "center"];
	it.each(positions)("%s: the pocket sits there relative to X0 Y0", (origin) => {
		const p = job({ origin, width: 40, height: 28, useArcs: false, depth: 2 });
		const pts = dense(parsePath(generateGcode(p)), 0.05);
		const o = originOffset(origin, 40, 28);
		const rt = 3;
		expect(Math.min(...pts.map((q) => q.x))).toBeCloseTo(-o.x + rt, 2);
		expect(Math.max(...pts.map((q) => q.x))).toBeCloseTo(40 - o.x - rt, 2);
		expect(Math.min(...pts.map((q) => q.y))).toBeCloseTo(-o.y + rt, 2);
		expect(Math.max(...pts.map((q) => q.y))).toBeCloseTo(28 - o.y - rt, 2);
	});
	it("a circle is zeroed like its bounding square", () => {
		const p = job({ shape: "circle", diameter: 30, origin: "lower-left", useArcs: false, depth: 2 });
		const pts = dense(parsePath(generateGcode(p)), 0.05);
		expect(Math.min(...pts.map((q) => q.x))).toBeCloseTo(3, 1);
		expect(Math.max(...pts.map((q) => q.x))).toBeCloseTo(27, 1);
	});
});

describe("units", () => {
	it("inches: G20, 4 decimals and the same geometry", () => {
		const mm = parsePath(generateGcode(job({ units: "mm", depth: 2 })));
		const inch = generateGcode(job({ units: "in", depth: 2 }));
		expect(inch).toMatch(/^G20$/m);
		expect(inch).toMatch(/\.\d{4}\b/);
		const segs = parsePath(inch);
		expect(segs).toHaveLength(mm.length);
		segs.forEach((s, i) => {
			expect(s.to.x * 25.4).toBeCloseTo(mm[i].to.x, 2);
			expect(s.to.y * 25.4).toBeCloseTo(mm[i].to.y, 2);
			expect(s.to.z * 25.4).toBeCloseTo(mm[i].to.z, 2);
		});
		for (const s of segs.filter((x) => x.kind === "arc")) expect(Math.abs(Math.hypot(s.to.x - s.centre!.x, s.to.y - s.centre!.y) - arcRadius(s))).toBeLessThan(1.5e-4);
	});
	it("job stats see the pocket", () => {
		expect(jobStats(generateGcode(job())).minutes).toBeGreaterThan(0.1);
	});
});

describe("check", () => {
	it("accepts the defaults and rejects bad input", () => {
		expect(check(defaultParams()).errors).toHaveLength(0);
		expect(check(job({ width: 0 })).errors).not.toHaveLength(0);
		expect(check(job({ width: 5, toolDiameter: 6 })).errors.join(" ")).toMatch(/wider than the tool/);
		expect(check(job({ shape: "circle", diameter: 6 })).errors.join(" ")).toMatch(/wider than the tool/);
		expect(check(job({ cornerRadius: 40 })).errors).not.toHaveLength(0);
		expect(check(job({ stepover: 1.5 })).errors).not.toHaveLength(0);
		expect(check(job({ shape: "circle", diameter: 40 })).errors).toHaveLength(0);
	});
});
