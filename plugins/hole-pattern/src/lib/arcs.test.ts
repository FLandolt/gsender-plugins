import { describe, expect, it } from "vitest";

import { arcMove, circleMoves } from "@shared/gcode";
import { arcRadius, arcSweep, cuttingPolylines, maxDeviation, parsePath, samplePoints, segmentLength } from "@shared/path";
import { jobStats } from "@shared/stats";

import { generateGcode, zLevels } from "./generate";
import { defaultParams, type Params } from "./params";

const job = (patch: Partial<Params> = {}): Params => ({ ...defaultParams(), ...patch });
const strip = (g: string) => g.replace(/\([^)]*\)/g, "");
const words = (g: string) => new Set([...strip(g).matchAll(/\b([GM]\d+)\b/g)].map((m) => m[1]));

const cases: { name: string; patch: Partial<Params>; decimals: number; mmPerUnit: number }[] = [
	{ name: "mm", patch: {}, decimals: 3, mmPerUnit: 1 },
	{ name: "inch", patch: { units: "in" }, decimals: 4, mmPerUnit: 25.4 },
	{ name: "grid, mm", patch: { countX: 2, countY: 2, holeDiameter: 12.7, toolDiameter: 3.175 }, decimals: 3, mmPerUnit: 1 },
];

describe.each(cases)("arcs vs chords ($name)", ({ patch, decimals, mmPerUnit }) => {
	const arcs = generateGcode(job({ ...patch, useArcs: true }));
	const chords = generateGcode(job({ ...patch, useArcs: false }));
	const sag = 0.002 / mmPerUnit;

	it("arc mode uses G2/G3 and no chords on the circles", () => {
		expect(words(arcs).has("G3")).toBe(true);
		expect(arcs.split("\n").length).toBeLessThan(chords.split("\n").length / 3);
		expect(words(chords).has("G3")).toBe(false);
		expect(words(chords).has("G2")).toBe(false);
	});

	it("both modes cut the same path within tolerance", () => {
		const a = cuttingPolylines(parsePath(arcs), sag);
		const b = cuttingPolylines(parsePath(chords), sag);
		// Chords sag up to 0.01 mm; the quarter-turn arcs of the spiral stay within ~0.016 mm.
		const tol = 0.03 / mmPerUnit;
		expect(maxDeviation(a, b)).toBeLessThan(tol);
		expect(maxDeviation(b, a)).toBeLessThan(tol);
		const zMin = (l: typeof a) => Math.min(...l.flat().map((p) => p.z));
		expect(zMin(a)).toBeCloseTo(zMin(b), decimals);
	});

	it("start and end radius of every arc agree", () => {
		const segs = parsePath(arcs).filter((s) => s.kind === "arc");
		expect(segs.length).toBeGreaterThan(0);
		for (const s of segs) {
			const rEnd = Math.hypot(s.to.x - s.centre!.x, s.to.y - s.centre!.y);
			expect(Math.abs(rEnd - arcRadius(s))).toBeLessThan(1.5 * 10 ** -decimals);
		}
	});

	it("selects the XY plane and writes circles as half-circle arcs with IJ", () => {
		expect(arcs).toMatch(/^G17$/m);
		expect(arcs.indexOf("G17\n", arcs.indexOf("Hole 1"))).toBeLessThan(arcs.search(/^G3 /m));
		for (const l of strip(arcs).split("\n").filter((x) => /^G[23] /.test(x))) {
			expect(l).toMatch(/ X-?[\d.]+ Y-?[\d.]+/);
			expect(l).toMatch(/ I-?[\d.]+ J-?[\d.]+/);
		}
		expect(arcs).not.toMatch(/\bR-?\d/);
	});

	it("no arc ends where it starts (gSender's viewer skips those, so the circle would vanish)", () => {
		const segs = parsePath(arcs).filter((x) => x.kind === "arc");
		expect(segs.length).toBeGreaterThan(0);
		for (const s of segs) expect(s.from.x !== s.to.x || s.from.y !== s.to.y).toBe(true);
	});

	it("each level cuts the wall circle at full radius: a closed loop of two half arcs", () => {
		const p = job(patch);
		const wall = (p.holeDiameter - p.toolDiameter) / 2 / mmPerUnit;
		const full = parsePath(arcs).filter((x) => x.kind === "arc" && Math.abs(arcRadius(x) - wall) < 2 * 10 ** -decimals);
		// Two halves per level, for every hole.
		const holes = p.countX * p.countY;
		expect(full).toHaveLength(2 * zLevels(p.depth, p.stepdown).length * holes);
		for (let i = 0; i < full.length; i += 2) {
			expect(Math.abs(arcSweep(full[i]))).toBeCloseTo(Math.PI, 2);
			expect(Math.abs(arcSweep(full[i + 1]))).toBeCloseTo(Math.PI, 2);
			expect(full[i + 1].to.x).toBeCloseTo(full[i].from.x, decimals);
			expect(full[i + 1].to.y).toBeCloseTo(full[i].from.y, decimals);
		}
	});

	it("emits only GRBL-safe words", () => {
		for (const w of words(arcs)) expect(["G0", "G1", "G3", "G4", "G17", "G20", "G21", "G90", "G94", "M3", "M5", "M30"]).toContain(w);
	});

	it("stays inside the hole wall and never rises while cutting", () => {
		const p = job(patch);
		const limit = (p.holeDiameter - p.toolDiameter) / 2 / mmPerUnit + 1e-3;
		const pts = cuttingPolylines(parsePath(arcs), sag).flat();
		// Holes in a grid are offset from the origin, so measure from the nearest centre.
		const pitchX = p.spacingX / mmPerUnit, pitchY = p.spacingY / mmPerUnit;
		for (const pt of pts) {
			const dx = pt.x - Math.round(pt.x / pitchX) * pitchX;
			const dy = pt.y - Math.round(pt.y / pitchY) * pitchY;
			expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(limit);
		}
		const down = parsePath(arcs).filter((s) => s.kind !== "rapid" && s.to.z !== s.from.z);
		for (const s of down) expect(s.to.z).toBeLessThan(s.from.z);
	});

	it("helix arcs descend one level per circle, in two halves", () => {
		const p = job(patch);
		const levels = zLevels(p.depth, p.stepdown).length;
		const helix = parsePath(arcs).filter((x) => x.kind === "arc" && x.to.z !== x.from.z);
		expect(helix).toHaveLength(2 * levels * p.countX * p.countY);
		for (const s of helix) expect(Math.abs(arcSweep(s))).toBeCloseTo(Math.PI, 2);
	});
});

describe("arcMove", () => {
	const mm = { scale: 1, decimals: 3 };
	it("prints IJ from the rounded start and centre", () => {
		expect(arcMove(mm, { from: { x: 1.0004, y: 2 }, centre: { x: 0.0004, y: 2 }, to: { x: -1, y: 2 }, cw: false })).toBe("G3 X-1 Y2 I-1 J0");
	});
	it("writes a helical full circle with no X/Y", () => {
		expect(arcMove(mm, { from: { x: 3, y: 0 }, centre: { x: 0, y: 0 }, z: -1.5, cw: true })).toBe("G2 Z-1.5 I-3 J0");
	});
	it("refuses an arc that would be read as a full circle", () => {
		expect(() => arcMove(mm, { from: { x: 1, y: 1 }, centre: { x: 1, y: 2 }, to: { x: 1.0001, y: 1 }, cw: false })).toThrow();
	});
	it("writes a circle as two half arcs, helical ones descending halfway first", () => {
		const [a, b] = circleMoves(mm, { from: { x: 3, y: 0 }, centre: { x: 0, y: 0 }, cw: false, z: -2, zFrom: 0 });
		expect(a).toBe("G3 X-3 Y0 Z-1 I-3 J0");
		expect(b).toBe("G3 X3 Y0 Z-2 I3 J0");
	});
	it("converts to inches with 4 decimals", () => {
		expect(arcMove({ scale: 1 / 25.4, decimals: 4 }, { from: { x: 25.4, y: 0 }, centre: { x: 0, y: 0 }, cw: false })).toBe("G3 I-1 J0");
	});
});

describe("path reader", () => {
	it("measures a full circle and a helix", () => {
		const [circle] = parsePath("G17\nG1 X5 Y0\nG3 I-5 J0 F100\n").slice(1);
		expect(segmentLength(circle)).toBeCloseTo(2 * Math.PI * 5);
		const [helix] = parsePath("G1 X5 Y0\nG2 Z-3 I-5 J0\n").slice(1);
		expect(segmentLength(helix)).toBeCloseTo(Math.hypot(2 * Math.PI * 5, 3));
		const pts = samplePoints(helix, 0.001);
		expect(pts.at(-1)!.z).toBe(-3);
		for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeCloseTo(5, 6);
	});
	it("counts arc time in the job estimate", () => {
		const { minutes } = jobStats("G1 X5 Y0 F600\nG3 I-5 J0\n");
		expect(minutes).toBeCloseTo((5 + 2 * Math.PI * 5) / 600);
	});
});
