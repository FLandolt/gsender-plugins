/** Rough job stats parsed back out of the emitted G-code. */
export type JobStats = { lines: number; minutes: number };

export const jobStats = (gcode: string): JobStats => {
	let x = 0, y = 0, z = 0, feed = 0, minutes = 0, lines = 0;
	for (const raw of gcode.split("\n")) {
		const line = raw.replace(/\([^)]*\)/g, "").trim();
		if (!line) continue;
		lines += 1;
		const g = /^G([01])\b/.exec(line);
		if (!g) continue;
		const val = (axis: string) => {
			const m = new RegExp(`${axis}(-?[\\d.]+)`).exec(line);
			return m ? Number(m[1]) : null;
		};
		const f = val("F");
		if (f !== null) feed = f;
		const nx = val("X") ?? x, ny = val("Y") ?? y, nz = val("Z") ?? z;
		const dist = Math.hypot(nx - x, ny - y, nz - z);
		// Rapids are taken as 3000 per minute; good enough for an estimate.
		const rate = g[1] === "0" ? 3000 : feed;
		if (rate > 0) minutes += dist / rate;
		x = nx; y = ny; z = nz;
	}
	return { lines, minutes };
};

export const formatMinutes = (m: number): string => {
	if (m < 1) return `${Math.max(1, Math.round(m * 60))} s`;
	const h = Math.floor(m / 60);
	const mm = Math.round(m % 60);
	return h > 0 ? `${h} h ${mm} min` : `${Math.round(m)} min`;
};
