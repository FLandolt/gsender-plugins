import { parsePath, segmentLength } from "./path";

/** Rough job stats parsed back out of the emitted G-code. */
export type JobStats = { lines: number; minutes: number };

export const jobStats = (gcode: string): JobStats => {
	let lines = 0;
	for (const raw of gcode.split("\n")) {
		if (raw.replace(/\([^)]*\)/g, "").trim()) lines += 1;
	}
	let minutes = 0;
	for (const s of parsePath(gcode)) {
		// Rapids are taken as 3000 per minute; good enough for an estimate.
		const rate = s.kind === "rapid" ? 3000 : s.feed;
		if (rate > 0) minutes += segmentLength(s) / rate;
	}
	return { lines, minutes };
};

export const formatMinutes = (m: number): string => {
	if (m < 1) return `${Math.max(1, Math.round(m * 60))} s`;
	const h = Math.floor(m / 60);
	const mm = Math.round(m % 60);
	return h > 0 ? `${h} h ${mm} min` : `${Math.round(m)} min`;
};
