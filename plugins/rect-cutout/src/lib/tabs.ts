import type { Side } from "./outline";

export type TabSpan = { start: number; end: number };

/**
 * Tabs sit on the straight sides: one per side is centred, more are spread
 * evenly. A side too short to hold a tab with some margin is skipped, and
 * reported so the UI can say so.
 */
export const placeTabs = (
	sides: Side[],
	perSide: number,
	length: number,
): { spans: TabSpan[]; skippedSides: number } => {
	const spans: TabSpan[] = [];
	let skippedSides = 0;
	for (const side of sides) {
		const room = side.end - side.start;
		// Keep a tab clear of the corners by at least half its own length.
		if (room < length * (perSide + 1)) {
			skippedSides += 1;
			continue;
		}
		for (let i = 1; i <= perSide; i += 1) {
			const centre = side.start + (room * i) / (perSide + 1);
			spans.push({ start: centre - length / 2, end: centre + length / 2 });
		}
	}
	return { spans: spans.sort((a, b) => a.start - b.start), skippedSides };
};
