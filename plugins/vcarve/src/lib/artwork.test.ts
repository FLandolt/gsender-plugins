import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { buildArtwork, type Assets } from "./artwork";
import { defaultParams, type Params } from "./params";
import type { RawImage } from "./image";
import { parseFont } from "./text";

const p = (patch: Partial<Params> = {}): Params => ({ ...defaultParams(), ...patch });
const font = (() => {
	const b = readFileSync(new URL("../../../../node_modules/@fontsource/roboto/files/roboto-latin-700-normal.woff", import.meta.url));
	return parseFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
})();
const none: Assets = { font: null, svg: null, image: null };
const disc = (w: number, h: number, f: (x: number, y: number) => number): RawImage => {
	const data = new Uint8ClampedArray(w * h * 4);
	for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) data.set([f(x, y), f(x, y), f(x, y), 255], 4 * (y * w + x));
	return { width: w, height: h, data };
};

describe("buildArtwork", () => {
	it("text: shapes of the right height, with a description for the G-code", () => {
		const a = buildArtwork(p({ text: "Hi", letterHeight: 30 }), { ...none, font });
		expect(a.shapes.length).toBeGreaterThan(1);
		expect(a.height).toBeGreaterThan(29);
		expect(a.description).toContain("Hi");
		expect(a.errors).toEqual([]);
	});
	it("text: names the characters the font lacks", () => {
		const a = buildArtwork(p({ text: "A漢" }), { ...none, font });
		expect(a.warnings.join(" ")).toMatch(/doesn't have the character "漢"/);
	});
	it("text: nothing to say until there is a font and some text", () => {
		expect(buildArtwork(p(), none).shapes).toHaveLength(0);
		expect(buildArtwork(p({ text: "   " }), { ...none, font }).shapes).toHaveLength(0);
	});

	it("svg: scaled to the size asked for, by width or by height, with its corner at 0,0", () => {
		const items = [{ d: "M10 10H30V20H10Z", transform: "" }];
		const w = buildArtwork(p({ source: "svg", sizeBy: "width", size: 100 }), { ...none, svg: { items, skipped: 0 } });
		expect(w.width).toBeCloseTo(100);
		expect(w.height).toBeCloseTo(50);
		expect(w.bounds.minX).toBeCloseTo(0);
		expect(w.bounds.minY).toBeCloseTo(0);
		const h = buildArtwork(p({ source: "svg", sizeBy: "height", size: 100 }), { ...none, svg: { items, skipped: 0 } });
		expect(h.height).toBeCloseTo(100);
		expect(h.width).toBeCloseTo(200);
	});
	it("svg: open lines are reported, and a drawing with no closed shapes is an error", () => {
		const open = buildArtwork(p({ source: "svg" }), { ...none, svg: { items: [{ d: "M0 0L10 10", transform: "" }], skipped: 0 } });
		expect(open.errors.join(" ")).toMatch(/no closed shapes/);
		const mixed = buildArtwork(p({ source: "svg" }), { ...none, svg: { items: [{ d: "M0 0H10V10H0Z", transform: "" }, { d: "M0 0L10 10", transform: "" }], skipped: 1 } });
		expect(mixed.errors).toEqual([]);
		expect(mixed.warnings.join(" ")).toMatch(/2 open lines were left out/);
		expect(buildArtwork(p({ source: "svg" }), none).needs.join(" ")).toMatch(/Choose an SVG/);
		expect(buildArtwork(p({ source: "svg" }), none).errors).toEqual([]);
	});

	it("image: finds the shape and scales it", () => {
		const img = disc(200, 100, (x, y) => (Math.hypot(x - 100, y - 50) < 40 ? 0 : 255));
		const a = buildArtwork(p({ source: "image", size: 100 }), { ...none, image: img });
		expect(a.errors).toEqual([]);
		expect(a.shapes).toHaveLength(1);
		expect(Math.abs(a.width - 40)).toBeLessThan(1); // a 79-pixel disc, to within a fraction of a pixel
	});
	it("image: an all-one-colour picture is an error that says so", () => {
		const a = buildArtwork(p({ source: "image" }), { ...none, image: disc(50, 50, () => 120) });
		expect(a.errors.join(" ")).toMatch(/all one colour/);
	});
	it("image: a threshold that finds nothing says what to move", () => {
		const img = disc(100, 50, (x) => (x < 50 ? 100 : 200));
		const a = buildArtwork(p({ source: "image", threshold: 10 }), { ...none, image: img });
		expect(a.errors.join(" ")).toMatch(/Move the threshold slider/);
	});
	it("image: a photograph gets a warning, not an error", () => {
		const img = disc(200, 200, (x, y) => 128 + 100 * Math.sin(x / 17) * Math.cos(y / 23));
		const a = buildArtwork(p({ source: "image" }), { ...none, image: img });
		expect(a.warnings.join(" ")).toMatch(/looks like a photograph/);
	});
	it("image: asks for a picture first", () => {
		expect(buildArtwork(p({ source: "image" }), none).needs.join(" ")).toMatch(/Choose a picture/);
		expect(buildArtwork(p({ source: "image" }), none).errors).toEqual([]);
	});
});
