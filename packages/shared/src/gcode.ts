/** Small G-code formatting helpers shared by the plugins. */

/** Formats a value, trimming trailing zeros and avoiding "-0". */
export const fmt = (value: number, decimals: number): string => {
	const safe = Object.is(value, -0) ? 0 : value;
	return safe
		.toFixed(decimals)
		.replace(/(\.\d*?)0+$/, "$1")
		.replace(/\.$/, "");
};

/** Escapes G-code comment delimiters, which cannot nest. */
export const comment = (text: string): string => `(${text.replace(/[()]/g, "")})`;

export type Pt = { x: number; y: number };

/** How coordinates are printed: mm × `scale` rounded to `decimals`. */
export type NumberFormat = { scale: number; decimals: number };

/** A value as it will be printed (rounded), in output units. */
const printed = (v: number, f: NumberFormat): number => Number((v * f.scale).toFixed(f.decimals));

export type ArcSpec = {
	from: Pt;
	centre: Pt;
	/** End point. Leave out for a full circle back to `from`. */
	to?: Pt;
	/** Absolute end Z for a helical arc; leave out to keep Z. */
	z?: number;
	/** Clockwise (G2) or counter-clockwise (G3), seen from above. */
	cw: boolean;
};

/**
 * One G2/G3 arc in the XY plane (G17), with the centre given as IJK offsets from the start.
 *
 * Coordinates are in mm and converted with `f`. I and J are the difference of the
 * *rounded* centre and start, so the centre the controller reconstructs is exactly the
 * printed one and start/end radii differ only by print rounding, well inside GRBL's
 * arc tolerance. A full circle prints no X/Y (the controller reads "no end" as a full
 * turn); a real arc whose rounded end equals its rounded start would be misread as one,
 * so that is an error. The caller emits G17 and any feed word.
 */
export const arcMove = (f: NumberFormat, a: ArcSpec): string => {
	const sx = printed(a.from.x, f);
	const sy = printed(a.from.y, f);
	const i = fmt(printed(a.centre.x, f) - sx, f.decimals);
	const j = fmt(printed(a.centre.y, f) - sy, f.decimals);
	const word = a.cw ? "G2" : "G3";
	const z = a.z === undefined ? "" : ` Z${fmt(a.z * f.scale, f.decimals)}`;
	if (!a.to) return `${word}${z} I${i} J${j}`;
	const ex = printed(a.to.x, f);
	const ey = printed(a.to.y, f);
	if (ex === sx && ey === sy) throw new Error("Arc is too small to print: it would be read as a full circle.");
	return `${word} X${fmt(ex, f.decimals)} Y${fmt(ey, f.decimals)}${z} I${i} J${j}`;
};

/**
 * A full circle as two half-circle arcs with explicit end points. A single arc with
 * no X/Y is valid G-code (GRBL reads it as a full turn), but gSender's viewer skips
 * an arc whose end equals its start, so the circle would be missing from the
 * preview. Two half arcs run and draw the same everywhere. `z` is the end Z of a
 * helical circle; the first half ends halfway down (from `zFrom`).
 */
export const circleMoves = (
	f: NumberFormat,
	a: { from: Pt; centre: Pt; cw: boolean; z?: number; zFrom?: number },
): [string, string] => {
	const opposite: Pt = { x: 2 * a.centre.x - a.from.x, y: 2 * a.centre.y - a.from.y };
	const zMid = a.z === undefined ? undefined : ((a.zFrom ?? 0) + a.z) / 2;
	return [
		arcMove(f, { from: a.from, centre: a.centre, to: opposite, z: zMid, cw: a.cw }),
		arcMove(f, { from: opposite, centre: a.centre, to: a.from, z: a.z, cw: a.cw }),
	];
};
