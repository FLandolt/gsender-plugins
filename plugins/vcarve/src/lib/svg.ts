/**
 * SVG → outlines. Reads path, rect, circle, ellipse and polygon elements (with their transforms),
 * turns curves into short straight pieces, and keeps only the closed ones: an open path has no
 * inside to carve. Fill and stroke are ignored; the geometry is what counts.
 */

import svgpath from "svgpath";

import { buildShapes, flattenCubic, flattenQuad, type Pt, type Ring, type Shape } from "./geom";

/** A shape element: its path data, and the transforms of it and everything around it. */
export type SvgItem = { d: string; transform: string };

const num = (v: string | null | undefined, fallback = 0): number => {
	const n = v === null || v === undefined ? NaN : parseFloat(v);
	return Number.isFinite(n) ? n : fallback;
};

const rectPath = (x: number, y: number, w: number, h: number, rx: number, ry: number): string => {
	if (rx <= 0 && ry <= 0) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
	rx = Math.min(rx || ry, w / 2);
	ry = Math.min(ry || rx, h / 2);
	return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
};

const ellipsePath = (cx: number, cy: number, rx: number, ry: number): string =>
	`M${cx + rx} ${cy}A${rx} ${ry} 0 1 1 ${cx - rx} ${cy}A${rx} ${ry} 0 1 1 ${cx + rx} ${cy}Z`;

/** The shape elements of an SVG document, with the transforms that apply to each. */
export const svgItems = (doc: Document): { items: SvgItem[]; skipped: number } => {
	const items: SvgItem[] = [];
	let skipped = 0;
	const visit = (el: Element, inherited: string) => {
		const own = el.getAttribute("transform");
		const transform = [inherited, own].filter(Boolean).join(" ");
		const tag = el.localName.toLowerCase();
		const a = (n: string) => el.getAttribute(n);
		if (tag === "path") items.push({ d: a("d") ?? "", transform });
		else if (tag === "rect") items.push({ d: rectPath(num(a("x")), num(a("y")), num(a("width")), num(a("height")), num(a("rx")), num(a("ry"))), transform });
		else if (tag === "circle") items.push({ d: ellipsePath(num(a("cx")), num(a("cy")), num(a("r")), num(a("r"))), transform });
		else if (tag === "ellipse") items.push({ d: ellipsePath(num(a("cx")), num(a("cy")), num(a("rx")), num(a("ry"))), transform });
		else if (tag === "polygon") {
			const nums = (a("points") ?? "").trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
			if (nums.length >= 6) {
				const pts: string[] = [];
				for (let i = 0; i + 1 < nums.length; i += 2) pts.push(`${nums[i]} ${nums[i + 1]}`);
				items.push({ d: `M${pts.join("L")}Z`, transform });
			}
		} else if (tag === "line" || tag === "polyline") skipped += 1;
		else if (tag === "defs" || tag === "clippath" || tag === "mask" || tag === "symbol") return;
		for (const child of Array.from(el.children)) visit(child, transform);
	};
	visit(doc.documentElement, "");
	return { items, skipped };
};

/** Flattens path data into closed outlines; open sub-paths are counted and dropped. */
export const pathRings = (d: string, transform = "", tolerance = 0.01): { rings: Ring[]; open: number } => {
	const rings: Ring[] = [];
	let open = 0;
	let ring: Ring = [];
	let start: Pt = { x: 0, y: 0 };
	let cur: Pt = { x: 0, y: 0 };
	const finish = (closed: boolean) => {
		if (ring.length >= 2) {
			const a = ring[0], b = ring[ring.length - 1];
			const meets = Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
			if (closed || meets) {
				if (meets) ring.pop();
				if (ring.length >= 3) rings.push(ring);
			} else open += 1;
		}
		ring = [];
	};
	let path = svgpath(d).abs().unshort().unarc();
	if (transform.trim()) path = path.transform(transform);
	path.iterate((seg, _i, x, y) => {
		const [cmd, ...v] = seg as [string, ...number[]];
		void x; void y;
		switch (cmd) {
			case "M":
				finish(false);
				cur = { x: v[0], y: v[1] };
				start = cur;
				ring = [cur];
				break;
			case "L":
				cur = { x: v[0], y: v[1] };
				ring.push(cur);
				break;
			case "H":
				cur = { x: v[0], y: cur.y };
				ring.push(cur);
				break;
			case "V":
				cur = { x: cur.x, y: v[0] };
				ring.push(cur);
				break;
			case "Q": {
				const pts = flattenQuad(cur, { x: v[0], y: v[1] }, { x: v[2], y: v[3] }, tolerance);
				ring.push(...pts);
				cur = pts[pts.length - 1];
				break;
			}
			case "C": {
				const pts = flattenCubic(cur, { x: v[0], y: v[1] }, { x: v[2], y: v[3] }, { x: v[4], y: v[5] }, tolerance);
				ring.push(...pts);
				cur = pts[pts.length - 1];
				break;
			}
			case "Z":
				finish(true);
				cur = start;
				break;
			default:
				break;
		}
	});
	finish(false);
	return { rings, open };
};

export type SvgArtwork = { shapes: Shape[]; open: number; count: number };

/** Outlines from the elements of a drawing, in the drawing's own units, y flipped so that up is up. */
export const svgShapes = (items: SvgItem[], tolerance = 0.01): SvgArtwork => {
	const rings: Ring[] = [];
	let open = 0;
	for (const it of items) {
		const r = pathRings(it.d, it.transform, tolerance);
		open += r.open;
		rings.push(...r.rings);
	}
	// SVG's y runs down the page.
	const flipped = rings.map((r) => r.map((p) => ({ x: p.x, y: -p.y })));
	return { shapes: buildShapes(flipped), open, count: items.length };
};
