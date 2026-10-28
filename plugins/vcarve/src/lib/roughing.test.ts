import { describe, expect, it } from "vitest";

import { radiusForDepth, type Bit } from "./bit";
import { planCarve, type CarvePlan, type P3 } from "./carve";
import { generateGcode } from "./generate";
import { boundsOf, buildShapes, type Ring } from "./geom";
import { check, defaultParams, type Params } from "./params";
import { circle, distToRings, poly, rect, samples, star, surfaceCheck } from "./testkit";
import { parsePath } from "@shared/path";
import { jobStats } from "@shared/stats";

const bit: Bit = { angle: 60, diameter: 12, tip: 0, cuttingLength: null };

const split = (plan: CarvePlan): { rough: CarvePlan; finish: CarvePlan } => {
	const n = plan.passes!.roughing;
	return { rough: { ...plan, chains: plan.chains.slice(0, n) }, finish: { ...plan, chains: plan.chains.slice(n) } };
};

const shapesList: { name: string; rings: Ring[]; maxDepth: number }[] = [
	{ name: "bar", rings: [rect(0, 0, 40, 6)], maxDepth: 6 },
	{ name: "T", rings: [poly([0, 24], [18, 24], [18, 0], [24, 0], [24, 24], [42, 24], [42, 30], [0, 30])], maxDepth: 8 },
	{ name: "star", rings: [star()], maxDepth: 14 },
	{ name: "ring (O)", rings: [circle(0, 0, 14), circle(0, 0, 8)], maxDepth: 6 },
];

describe.each(shapesList)("roughing: $name", ({ rings, maxDepth }) => {
	const shapes = buildShapes(rings);
	const allowance = 0.3;
	const plan = planCarve(shapes, bit, maxDepth, "normal", { roughing: { allowance } });
	const { rough, finish } = split(plan);
	const single = planCarve(shapes, bit, maxDepth, "normal");

	it("has a roughing pass and a finishing pass, roughing first", () => {
		expect(plan.passes).toEqual({ roughing: rough.chains.length, finishing: finish.chains.length, allowance });
		expect(rough.chains.length).toBeGreaterThan(0);
		expect(finish.chains.length).toBeGreaterThan(0);
		expect(plan.chains).toHaveLength(rough.chains.length + finish.chains.length);
	});

	it("the finishing pass is exactly the single-pass cut", () => {
		expect(finish.chains).toEqual(single.chains);
	});

	it("the roughing pass leaves at least the stock asked for on every wall", () => {
		const rs = shapes.flatMap((s) => [s.outer, ...s.holes]);
		for (const p of samples(rough, 0.05)) {
			// The groove it cuts must stay `allowance` clear of the edge (give or take the path's tolerance).
			expect(radiusForDepth(-p.z, bit)).toBeLessThanOrEqual(distToRings(p.x, p.y, rs) - allowance + 0.035);
		}
	});

	it("is shallower than the finishing pass wherever they meet, and never deeper than the limit", () => {
		const fin = samples(finish, 0.25);
		for (const p of samples(rough, 0.25)) {
			expect(p.z).toBeGreaterThanOrEqual(-maxDepth - 1e-12);
			expect(p.z).toBeLessThanOrEqual(0);
			let nearest: P3 | null = null, d = Infinity;
			for (const q of fin) {
				const dd = Math.hypot(q.x - p.x, q.y - p.y);
				if (dd < d) { d = dd; nearest = q; }
			}
			if (nearest && d < 0.2) expect(p.z).toBeGreaterThanOrEqual(nearest.z - 0.06);
		}
	});

	it("the finishing pass still cuts the whole shape with no overcut", () => {
		const { overcut, miss } = surfaceCheck(finish, shapes, bit, 0.5);
		expect(overcut).toBeLessThan(0.04);
		expect(miss).toBeLessThan(0.15);
	}, 60_000);

	it("roughing alone gets within the stock left of the final shape", () => {
		const { miss } = surfaceCheck(rough, shapes, bit, 0.5);
		expect(miss).toBeLessThan(allowance + 0.25);
	}, 60_000);
});

describe("the stock to leave", () => {
	const shapes = buildShapes([rect(0, 0, 40, 6)]);
	it("0 leaves nothing: the roughing pass is the finishing pass again", () => {
		const plan = planCarve(shapes, bit, 6, "normal", { roughing: { allowance: 0 } });
		const { rough, finish } = split(plan);
		expect(rough.chains).toEqual(finish.chains);
	});
	it("more stock makes a shallower roughing pass, by allowance / tan(angle/2)", () => {
		const deepest = (a: number) => {
			const plan = planCarve(shapes, bit, 6, "normal", { roughing: { allowance: a } });
			return Math.max(...samples(split(plan).rough).map((p) => -p.z));
		};
		const full = 3 / Math.tan(Math.PI / 6);
		expect(deepest(0)).toBeCloseTo(full, 1);
		expect(deepest(0.5)).toBeCloseTo(full - 0.5 / Math.tan(Math.PI / 6), 1);
		expect(deepest(1)).toBeLessThan(deepest(0.5));
	});
	it("stock wider than the artwork leaves no roughing at all: only the finishing pass", () => {
		const plan = planCarve(shapes, bit, 6, "normal", { roughing: { allowance: 5 } });
		expect(plan.passes).toEqual({ roughing: 0, finishing: plan.chains.length, allowance: 5 });
		expect(plan.chains).toEqual(planCarve(shapes, bit, 6, "normal").chains);
	});
	it("a disc is roughed by a shallower plunge, then finished by the full one", () => {
		const plan = planCarve(buildShapes([circle(0, 0, 6)]), { ...bit, angle: 90, diameter: 10 }, 6, "normal", { roughing: { allowance: 0.5 } });
		expect(plan.passes!.roughing).toBe(1);
		expect(plan.passes!.finishing).toBe(1);
		expect(plan.chains[0][0].z).toBeCloseTo(-5.5, 1);
		expect(plan.chains[1][0].z).toBeCloseTo(-6, 1);
	});
	it("the depth limit still holds for both passes, even when capped", () => {
		const plan = planCarve(buildShapes([rect(0, 0, 40, 20)]), bit, 6, "normal", { roughing: { allowance: 0.4 } });
		for (const c of plan.chains) for (const p of c) expect(p.z).toBeGreaterThanOrEqual(-6);
	});
});

describe("roughing in the G-code", () => {
	const make = (patch: Partial<Params>) => {
		const p: Params = { ...defaultParams(), angle: 60, diameter: 12, tip: 0, maxDepth: 6, ...patch };
		const c = check(p);
		const rings = [rect(0, 0, 40, 6), circle(70, 3, 3)];
		const plan = planCarve(buildShapes(rings), c.bit!, c.maxDepth!, p.quality, p.rough ? { roughing: { allowance: p.allowance } } : {});
		return { p, plan, gcode: generateGcode(p, plan, { bounds: boundsOf(rings), description: "test" }) };
	};

	it("is off by default, and then the program is the same as before", () => {
		expect(defaultParams().rough).toBe(false);
		const { gcode, plan } = make({});
		expect(plan.passes).toBeNull();
		expect(gcode).toMatch(/^\(Cut 1 of /m);
		expect(gcode).not.toMatch(/Roughing|Finishing/);
	});

	it("cuts all the roughing first, then the finishing, at a slower feed", () => {
		const { gcode, plan, p } = make({ rough: true, allowance: 0.3, finishFeedPercent: 60 });
		const rough = plan.passes!.roughing, fin = plan.passes!.finishing;
		expect(gcode).toMatch(new RegExp(`Roughing cut 1 of ${rough}`));
		expect(gcode).toMatch(new RegExp(`Finishing cut ${fin} of ${fin}`));
		expect(gcode).toMatch(/Roughing pass leaves 0\.3 mm on each wall, then a finishing pass at 60% of the cutting feed, 570 mm\/min/);
		expect(gcode.indexOf("Roughing cut 1")).toBeLessThan(gcode.indexOf("Finishing cut 1"));
		// Every roughing move is at the cut feed and every finishing move at the lower one.
		const [roughPart, finishPart] = gcode.split(/\(Finishing cut 1 of \d+\)/);
		const feeds = (t: string) => new Set([...t.matchAll(/ F(\d+)/g)].map((m) => Number(m[1])).filter((f) => f !== p.plungeRate));
		expect([...feeds(roughPart)]).toEqual([950]);
		expect([...feeds(finishPart)]).toEqual([570]);
	});

	it("never goes below the maximum depth in either pass", () => {
		const { gcode } = make({ rough: true, allowance: 0.2, maxDepth: 6 });
		for (const s of parsePath(gcode)) expect(s.to.z).toBeGreaterThanOrEqual(-6 - 1e-9);
	});

	it("takes about twice as long, which the time estimate shows", () => {
		const one = jobStats(make({}).gcode).minutes;
		const two = jobStats(make({ rough: true, allowance: 0.2 }).gcode).minutes;
		expect(two).toBeGreaterThan(one * 1.4);
		expect(two).toBeLessThan(one * 2.6);
	});

	it("in inches too", () => {
		const { gcode } = make({ rough: true, units: "in" });
		expect(gcode).toMatch(/^G20$/m);
		expect(gcode).toMatch(/Roughing cut 1/);
	});
});

describe("check: the roughing settings", () => {
	const base = { ...defaultParams(), angle: 60, diameter: 12, tip: 0, maxDepth: 6, rough: true };
	it("0 is allowed for the wood left; negative is not", () => {
		expect(check({ ...base, allowance: 0 }).errors).toEqual([]);
		expect(check({ ...base, allowance: 0.5 }).errors).toEqual([]);
		expect(check({ ...base, allowance: -0.1 }).errors.join(" ")).toMatch(/must be 0 or more/);
	});
	it("the finishing feed is a percentage between 0 and 100", () => {
		expect(check({ ...base, finishFeedPercent: 60 }).errors).toEqual([]);
		expect(check({ ...base, finishFeedPercent: 100 }).errors).toEqual([]);
		expect(check({ ...base, finishFeedPercent: 0 }).errors.join(" ")).toMatch(/finishing feed/);
		expect(check({ ...base, finishFeedPercent: 150 }).errors.join(" ")).toMatch(/at most 100%/);
	});
	it("these are only checked when roughing is on", () => {
		expect(check({ ...base, rough: false, allowance: -5, finishFeedPercent: 0 }).errors).toEqual([]);
	});
});
