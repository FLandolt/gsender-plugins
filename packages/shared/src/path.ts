/**
 * Reads back the motion in a G-code program: G0/G1 lines and G2/G3 arcs given as
 * IJ offsets, absolute coordinates, XY plane. That is everything the plugins write.
 * Used for the time estimate and by the tests; the preview itself uses gSender's viewer.
 */

export type Pt3 = { x: number; y: number; z: number };

export type Segment = {
	kind: "rapid" | "line" | "arc";
	from: Pt3;
	to: Pt3;
	/** Feed in program units per minute. */
	feed: number;
	/** Arcs only. A full circle has `from` and `to` equal in XY. */
	centre?: { x: number; y: number };
	cw?: boolean;
};

const word = (line: string, letter: string): number | null => {
	const m = new RegExp(`${letter}(-?\\d*\\.?\\d+)`).exec(line);
	return m ? Number(m[1]) : null;
};

export const parsePath = (gcode: string): Segment[] => {
	const segments: Segment[] = [];
	let pos: Pt3 = { x: 0, y: 0, z: 0 };
	let feed = 0;
	let motion: number | null = null;
	for (const raw of gcode.split("\n")) {
		const line = raw.replace(/\([^)]*\)/g, "").trim();
		if (!line) continue;
		const g = [...line.matchAll(/G(\d+)/g)].map((m) => Number(m[1])).find((n) => n <= 3);
		if (g !== undefined) motion = g;
		if (motion === null || !/[XYZIJ]/.test(line)) continue;
		const f = word(line, "F");
		if (f !== null) feed = f;
		const to: Pt3 = { x: word(line, "X") ?? pos.x, y: word(line, "Y") ?? pos.y, z: word(line, "Z") ?? pos.z };
		const i = word(line, "I");
		const j = word(line, "J");
		if ((motion === 2 || motion === 3) && (i !== null || j !== null)) {
			segments.push({
				kind: "arc",
				from: pos,
				to,
				feed,
				centre: { x: pos.x + (i ?? 0), y: pos.y + (j ?? 0) },
				cw: motion === 2,
			});
		} else {
			segments.push({ kind: motion === 0 ? "rapid" : "line", from: pos, to, feed });
		}
		pos = to;
	}
	return segments;
};

/** Signed sweep in radians; negative is clockwise. Equal start and end in XY is a full turn. */
export const arcSweep = (s: Segment): number => {
	const c = s.centre!;
	const a0 = Math.atan2(s.from.y - c.y, s.from.x - c.x);
	const a1 = Math.atan2(s.to.y - c.y, s.to.x - c.x);
	const full = s.from.x === s.to.x && s.from.y === s.to.y;
	const twoPi = 2 * Math.PI;
	if (s.cw) {
		let d = (a0 - a1) % twoPi;
		if (d < 0) d += twoPi;
		return -(full || d === 0 ? twoPi : d);
	}
	let d = (a1 - a0) % twoPi;
	if (d < 0) d += twoPi;
	return full || d === 0 ? twoPi : d;
};

export const arcRadius = (s: Segment): number => Math.hypot(s.from.x - s.centre!.x, s.from.y - s.centre!.y);

export const segmentLength = (s: Segment): number => {
	if (s.kind !== "arc") return Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y, s.to.z - s.from.z);
	return Math.hypot(arcRadius(s) * Math.abs(arcSweep(s)), s.to.z - s.from.z);
};

/** Points along a segment, from start to end, with chord sag at most `sag`. */
export const samplePoints = (s: Segment, sag: number): Pt3[] => {
	if (s.kind !== "arc") return [s.from, s.to];
	const r = arcRadius(s);
	const sweep = arcSweep(s);
	const step = r > sag ? 2 * Math.acos(1 - sag / r) : Math.PI;
	const n = Math.max(1, Math.ceil(Math.abs(sweep) / step));
	const a0 = Math.atan2(s.from.y - s.centre!.y, s.from.x - s.centre!.x);
	const pts: Pt3[] = [s.from];
	for (let k = 1; k < n; k += 1) {
		const t = k / n;
		const a = a0 + sweep * t;
		pts.push({
			x: s.centre!.x + r * Math.cos(a),
			y: s.centre!.y + r * Math.sin(a),
			z: s.from.z + (s.to.z - s.from.z) * t,
		});
	}
	pts.push(s.to);
	return pts;
};

/** The cutting moves (everything but rapids) as one list of sampled points per segment. */
export const cuttingPolylines = (segments: Segment[], sag: number): Pt3[][] =>
	segments.filter((s) => s.kind !== "rapid").map((s) => samplePoints(s, sag));

const distToSegment = (p: Pt3, a: Pt3, b: Pt3): number => {
	const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
	const len2 = dx * dx + dy * dy + dz * dz;
	const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / len2));
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy), p.z - (a.z + t * dz));
};

/** Largest distance from any point of `a` to the polyline set `b` (one direction only). */
export const maxDeviation = (a: Pt3[][], b: Pt3[][]): number => {
	const segs: [Pt3, Pt3][] = [];
	for (const line of b) for (let i = 1; i < line.length; i += 1) segs.push([line[i - 1], line[i]]);
	let worst = 0;
	for (const line of a) {
		for (const p of line) {
			let best = Infinity;
			for (const [s0, s1] of segs) best = Math.min(best, distToSegment(p, s0, s1));
			worst = Math.max(worst, best);
		}
	}
	return worst;
};
