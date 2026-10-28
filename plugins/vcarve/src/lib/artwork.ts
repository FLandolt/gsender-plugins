/** Turns whatever the user chose (typed text, an SVG, a picture) into shapes in millimetres, ready to carve. */

import type opentype from "opentype.js";

import { boundsOf, type Bounds, type Ring, type Shape } from "./geom";
import { imageShapes, type RawImage } from "./image";
import type { Params } from "./params";
import { svgShapes, type SvgItem } from "./svg";
import { textShapes } from "./text";

export type Assets = {
	font: opentype.Font | null;
	svg: { items: SvgItem[]; skipped: number } | null;
	image: RawImage | null;
};

export type Artwork = {
	shapes: Shape[];
	bounds: Bounds;
	/** What it is, for the G-code header. */
	description: string;
	/** Real size, mm. */
	width: number;
	height: number;
	errors: string[];
	/** Still to choose: no error, but nothing to carve yet. */
	needs: string[];
	warnings: string[];
};

const EMPTY: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

const finish = (shapes: Shape[], description: string, errors: string[], warnings: string[], needs: string[] = []): Artwork => {
	const rings = shapes.flatMap((s) => [s.outer, ...s.holes]);
	const bounds = rings.length ? boundsOf(rings) : EMPTY;
	return { shapes, bounds, description, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY, errors, needs, warnings };
};

const scaleShapes = (shapes: Shape[], f: number, dx: number, dy: number): Shape[] => {
	const m = (r: Ring) => r.map((p) => ({ x: (p.x + dx) * f, y: (p.y + dy) * f }));
	return shapes.map((s) => ({ outer: m(s.outer), holes: s.holes.map(m) }));
};

export const buildArtwork = (p: Params, assets: Assets): Artwork => {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (p.source === "text") {
		if (!assets.font) return finish([], "text", [], []);
		if (!p.text.trim() || !(p.letterHeight > 0) || !(p.lineSpacing > 0)) return finish([], "text", [], []);
		const art = textShapes(assets.font, { text: p.text, letterHeight: p.letterHeight, lineSpacing: p.lineSpacing, align: p.align });
		if (art.missing.length) warnings.push(`This font doesn't have the character${art.missing.length === 1 ? "" : "s"} ${art.missing.map((c) => `"${c}"`).join(", ")}, so ${art.missing.length === 1 ? "it was" : "they were"} left out. Pick another font or load your own.`);
		if (!art.shapes.length) errors.push("The text has no letters to carve.");
		return finish(art.shapes, `text "${p.text.replace(/\s+/g, " ").slice(0, 40)}"`, errors, warnings);
	}

	if (p.source === "svg") {
		if (!assets.svg) return finish([], "SVG drawing", errors, warnings, ["Choose an SVG file to carve."]);
		if (!(p.size > 0)) return finish([], "SVG drawing", [], []);
		const art = svgShapes(assets.svg.items);
		if (!art.shapes.length) {
			errors.push("This SVG has no closed shapes to carve. Open lines have no inside, so they can't be V-carved. Close the paths, or convert strokes to outlines, and try again.");
			return finish([], "SVG drawing", errors, warnings);
		}
		const b = boundsOf(art.shapes.flatMap((s) => [s.outer, ...s.holes]));
		const f = p.sizeBy === "width" ? p.size / (b.maxX - b.minX) : p.size / (b.maxY - b.minY);
		const open = art.open + assets.svg.skipped;
		if (open > 0) warnings.push(`${open} open line${open === 1 ? " was" : "s were"} left out, because only closed shapes can be V-carved.`);
		return finish(scaleShapes(art.shapes, f, -b.minX, -b.minY), "SVG drawing", errors, warnings);
	}

	if (!assets.image) return finish([], "picture", errors, warnings, ["Choose a picture to carve."]);
	if (!(p.size > 0)) return finish([], "picture", [], []);
	const art = imageShapes(assets.image, { threshold: p.threshold, invert: p.invert, sizeBy: p.sizeBy, size: p.size });
	if (art.analysis.flat) errors.push("This picture is all one colour, so there is no shape to carve. Choose a picture with a clear dark-on-light (or light-on-dark) design.");
	else if (!art.shapes.length) errors.push(`Nothing is carved at this threshold. Move the threshold slider, or ${p.invert ? "turn off" : "turn on"} Invert, until the shape shows.`);
	if (art.analysis.photo && !art.analysis.flat)
		warnings.push("This looks like a photograph, or has many shades of grey. V-carving works best on clean logos, line art and text, and a photo won't give a good result.");
	return finish(art.shapes, "picture", errors, warnings);
};
