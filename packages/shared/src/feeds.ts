/** Feeds-and-speeds presets (mm, mm/min), same values as Simple Signs. */
export type FeedValues = {
	feedrate: number;
	plungeRate: number;
	spindleRpm: number;
	stepdown: number;
};

export type FeedPreset = FeedValues & {
	id: string;
	label: string;
	hint: string;
};

export const FEED_PRESETS: FeedPreset[] = [
	{ id: "softwood", label: "Softwood", hint: "Pine, cedar, plywood", feedrate: 1200, plungeRate: 400, spindleRpm: 15000, stepdown: 2 },
	{ id: "hardwood", label: "Hardwood", hint: "Oak, maple, walnut", feedrate: 800, plungeRate: 250, spindleRpm: 18000, stepdown: 1.2 },
	{ id: "gentle", label: "Take it easy", hint: "Slow and safe", feedrate: 700, plungeRate: 200, spindleRpm: 14000, stepdown: 1 },
];

export const matchFeedPreset = (v: FeedValues): FeedPreset | null =>
	FEED_PRESETS.find(
		(f) =>
			Math.abs(f.feedrate - v.feedrate) <= 1 &&
			Math.abs(f.plungeRate - v.plungeRate) <= 1 &&
			Math.abs(f.spindleRpm - v.spindleRpm) <= 1 &&
			Math.abs(f.stepdown - v.stepdown) <= 0.01,
	) ?? null;
