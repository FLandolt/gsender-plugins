import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { planCarve } from "./carve";
import { boundsOf, ringArea } from "./geom";
import { surfaceCheck } from "./testkit";
import { parseFont, textShapes } from "./text";

const load = (path: string) => {
	const b = readFileSync(new URL(`../../../../node_modules/@fontsource/${path}`, import.meta.url));
	return parseFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
};
const roboto = load("roboto/files/roboto-latin-700-normal.woff");
const slab = load("roboto-slab/files/roboto-slab-latin-700-normal.woff");
const bebas = load("bebas-neue/files/bebas-neue-latin-400-normal.woff");

const opts = { text: "H", letterHeight: 40, lineSpacing: 1, align: "left" as const };
const rings = (a: ReturnType<typeof textShapes>) => a.shapes.flatMap((s) => [s.outer, ...s.holes]);
const bit = { angle: 60, diameter: 14, tip: 0, cuttingLength: null };

describe("text outlines", () => {
	it("a capital letter is as tall as asked", () => {
		for (const font of [roboto, slab, bebas]) {
			const b = boundsOf(rings(textShapes(font, opts)));
			expect(b.maxY - b.minY).toBeGreaterThan(40 * 0.97);
			expect(b.maxY - b.minY).toBeLessThan(40 * 1.03);
		}
	});
	it("holes and islands: O has a hole, i has two parts, an A has a hole, a period is one shape", () => {
		const shapesOf = (t: string) => textShapes(roboto, { ...opts, text: t }).shapes;
		expect(shapesOf("O")).toHaveLength(1);
		expect(shapesOf("O")[0].holes).toHaveLength(1);
		expect(shapesOf("i")).toHaveLength(2);
		expect(shapesOf("A")[0].holes).toHaveLength(1);
		expect(shapesOf("B")[0].holes).toHaveLength(2);
		expect(shapesOf(".")).toHaveLength(1);
		expect(shapesOf("l")[0].holes).toHaveLength(0);
	});
	it("shapes have the right winding: outsides counter-clockwise, holes clockwise", () => {
		for (const s of textShapes(roboto, { ...opts, text: "OB" }).shapes) {
			expect(ringArea(s.outer)).toBeGreaterThan(0);
			for (const h of s.holes) expect(ringArea(h)).toBeLessThan(0);
		}
	});
	it("several lines stack upwards, the last line on the baseline", () => {
		const one = boundsOf(rings(textShapes(roboto, opts)));
		const two = boundsOf(rings(textShapes(roboto, { ...opts, text: "H\nH" })));
		expect(one.minY).toBeCloseTo(0, 1);
		expect(two.minY).toBeCloseTo(0, 1);
		expect(two.maxY).toBeGreaterThan(one.maxY + 40);
		expect(textShapes(roboto, { ...opts, text: "H\nH" }).lines).toBe(2);
	});
	it("alignment moves shorter lines", () => {
		const left = boundsOf(textShapes(roboto, { ...opts, text: "HHHH\nH" }).shapes.filter((s) => s.outer[0].y < 30).flatMap((s) => [s.outer]));
		const right = boundsOf(textShapes(roboto, { ...opts, text: "HHHH\nH", align: "right" }).shapes.filter((s) => s.outer[0].y < 30).flatMap((s) => [s.outer]));
		expect(right.minX).toBeGreaterThan(left.minX + 20);
	});
	it("kerning and spacing give a wider word for more letters", () => {
		const w = (t: string) => { const b = boundsOf(rings(textShapes(roboto, { ...opts, text: t }))); return b.maxX - b.minX; };
		expect(w("HHH")).toBeGreaterThan(w("HH") * 1.3);
	});
	it("lists the characters the font does not have, and skips them", () => {
		const a = textShapes(roboto, { ...opts, text: "A漢B" });
		expect(a.missing).toEqual(["漢"]);
		expect(a.shapes.length).toBeGreaterThanOrEqual(2);
	});
	it("an empty line makes nothing", () => {
		expect(textShapes(roboto, { ...opts, text: "" }).shapes).toHaveLength(0);
	});
});

describe("carving text", () => {
	// These are the test shapes from the brief, as letters: thin strokes, curves, holes.
	for (const [label, font, text, maxDepth] of [
		["Roboto Bold, curves and holes", roboto, "OAB&@", 10],
		["Roboto Slab Bold, with serifs", slab, "Hi", 10],
		["Bebas Neue, tall and narrow", bebas, "VW", 12],
	] as const) {
		it(`${label}: no overcut, nothing missed, within the depth limit`, () => {
			const art = textShapes(font, { text, letterHeight: 30, lineSpacing: 1, align: "left" });
			const plan = planCarve(art.shapes, bit, maxDepth, "normal");
			expect(plan.tooWide).toHaveLength(0);
			expect(plan.chains.length).toBeGreaterThan(0);
			for (const c of plan.chains) for (const p of c) {
				expect(p.z).toBeGreaterThanOrEqual(-maxDepth);
				expect(p.z).toBeLessThanOrEqual(0);
			}
			const { overcut, miss } = surfaceCheck(plan, art.shapes, bit, 0.5);
			expect(overcut).toBeLessThan(0.04);
			expect(miss).toBeLessThan(0.15);
		}, 60_000);
	}
	it("the inside of an O stays uncut", () => {
		const art = textShapes(roboto, { text: "O", letterHeight: 30, lineSpacing: 1, align: "left" });
		const plan = planCarve(art.shapes, bit, 10, "normal");
		const hole = art.shapes[0].holes[0];
		const cx = hole.reduce((s, p) => s + p.x, 0) / hole.length;
		const cy = hole.reduce((s, p) => s + p.y, 0) / hole.length;
		const holeRadius = Math.min(...hole.map((p) => Math.hypot(p.x - cx, p.y - cy)));
		for (const c of plan.chains) for (const p of c) expect(Math.hypot(p.x - cx, p.y - cy)).toBeGreaterThan(holeRadius - 0.05);
	});
	it("a thick letter in a wide bit still needs only the depth of its stem", () => {
		const art = textShapes(roboto, { text: "I", letterHeight: 30, lineSpacing: 1, align: "left" });
		const b = boundsOf(rings(art));
		const stem = b.maxX - b.minX;
		const plan = planCarve(art.shapes, bit, 12, "normal");
		expect(plan.deepestNeeded).toBeCloseTo(stem / 2 / Math.tan(Math.PI / 6), 0);
	});
});
