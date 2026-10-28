/** Text → outlines, using opentype.js. Each letter becomes its own shapes, so overlapping letters are cut as a union rather than cancelling out. */

import opentype from "opentype.js";

import { buildShapes, flattenCubic, flattenQuad, type Pt, type Ring, type Shape } from "./geom";
import type { Align } from "./params";

export type TextOptions = {
	text: string;
	/** Height of capital letters, mm. */
	letterHeight: number;
	/** 1 is the font's own line height. */
	lineSpacing: number;
	align: Align;
};

export type TextArtwork = { shapes: Shape[]; missing: string[]; lines: number };

export const parseFont = (data: ArrayBuffer): opentype.Font => opentype.parse(data);

/** Height of capital letters in font units. */
const capHeightOf = (font: opentype.Font): number => {
	const os2 = font.tables?.os2 as { sCapHeight?: number } | undefined;
	if (os2?.sCapHeight && os2.sCapHeight > 0) return os2.sCapHeight;
	const h = font.charToGlyph("H");
	const box = h.getBoundingBox();
	return box.y2 > 0 ? box.y2 : font.unitsPerEm * 0.7;
};

/** The outlines of a glyph path as rings, flattening curves to within `tolerance` mm. */
const pathRings = (path: opentype.Path, tolerance: number): Ring[] => {
	const rings: Ring[] = [];
	let ring: Ring = [];
	let cur: Pt = { x: 0, y: 0 };
	const close = () => {
		if (ring.length >= 3) {
			const a = ring[0], b = ring[ring.length - 1];
			if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-9) ring.pop();
			rings.push(ring);
		}
		ring = [];
	};
	for (const cmd of path.commands) {
		if (cmd.type === "M") {
			close();
			cur = { x: cmd.x, y: cmd.y };
			ring = [cur];
		} else if (cmd.type === "L") {
			cur = { x: cmd.x, y: cmd.y };
			ring.push(cur);
		} else if (cmd.type === "Q") {
			const pts = flattenQuad(cur, { x: cmd.x1, y: cmd.y1 }, { x: cmd.x, y: cmd.y }, tolerance);
			ring.push(...pts);
			cur = pts[pts.length - 1];
		} else if (cmd.type === "C") {
			const pts = flattenCubic(cur, { x: cmd.x1, y: cmd.y1 }, { x: cmd.x2, y: cmd.y2 }, { x: cmd.x, y: cmd.y }, tolerance);
			ring.push(...pts);
			cur = pts[pts.length - 1];
		} else if (cmd.type === "Z") close();
	}
	close();
	return rings;
};

/**
 * Lays out the text, with y up and the baseline of the last line at 0. Characters the font doesn't
 * have are listed in `missing` and skipped.
 */
export const textShapes = (font: opentype.Font, o: TextOptions, tolerance = 0.01): TextArtwork => {
	const capHeight = capHeightOf(font);
	const fontSize = (o.letterHeight / capHeight) * font.unitsPerEm;
	const scale = fontSize / font.unitsPerEm;
	const lineAdvance = (font.ascender - font.descender + (font.tables?.hhea?.lineGap ?? 0)) * scale * o.lineSpacing;
	const lines = o.text.split(/\r?\n/);
	const missing = new Set<string>();
	const shapes: Shape[] = [];
	const widths = lines.map((l) => font.getAdvanceWidth(l, fontSize));
	const widest = Math.max(0, ...widths);
	lines.forEach((line, li) => {
		const x0 = o.align === "left" ? 0 : o.align === "right" ? widest - widths[li] : (widest - widths[li]) / 2;
		// opentype's y runs down the page; the last line sits on the baseline.
		const baseline = (lines.length - 1 - li) * lineAdvance;
		for (const ch of line) if (ch.trim() && font.charToGlyphIndex(ch) === 0) missing.add(ch);
		font.forEachGlyph(line, x0, 0, fontSize, { kerning: true }, (glyph, gx, gy, gSize) => {
			if (glyph.index === 0 || !glyph.path) return;
			const rings = pathRings(glyph.getPath(gx, gy, gSize), tolerance);
			// Turn the page's y-down into y-up.
			const flipped = rings.map((r) => r.map((p) => ({ x: p.x, y: baseline - p.y })));
			shapes.push(...buildShapes(flipped));
		});
	});
	return { shapes, missing: [...missing], lines: lines.length };
};
