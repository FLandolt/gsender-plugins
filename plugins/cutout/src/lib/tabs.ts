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

/**
 * Tabs on a closed path with no straight sides (a circle): `count` of them spread
 * evenly, half a gap in from the start so none straddles it. If they would be too
 * close together (each needs half its own length of cut between it and the next),
 * none are placed and all are reported as skipped.
 */
export const placeTabsEvenly = (
	pathLength: number,
	count: number,
	length: number,
): { spans: TabSpan[]; skippedSides: number } => {
	const gap = pathLength / count;
	if (gap < length * 1.5) return { spans: [], skippedSides: count };
	const spans: TabSpan[] = [];
	for (let i = 0; i < count; i += 1) {
		const centre = gap * (i + 0.5);
		spans.push({ start: centre - length / 2, end: centre + length / 2 });
	}
	return { spans, skippedSides: 0 };
};
