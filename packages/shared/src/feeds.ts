/** Feeds-and-speeds presets (mm, mm/min), High matches the Simple Signs softwood values. */
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
	{ id: "slow", label: "Slow", hint: "Gentle and safe, for hard material or thin bits", feedrate: 700, plungeRate: 200, spindleRpm: 14000, stepdown: 1 },
	{ id: "medium", label: "Medium", hint: "A balance of speed and safety", feedrate: 950, plungeRate: 300, spindleRpm: 14500, stepdown: 1.5 },
	{ id: "high", label: "High", hint: "Fastest, for soft material like pine or plywood", feedrate: 1200, plungeRate: 400, spindleRpm: 15000, stepdown: 2 },
];

export const matchFeedPreset = (v: FeedValues): FeedPreset | null =>
	FEED_PRESETS.find(
		(f) =>
			Math.abs(f.feedrate - v.feedrate) <= 1 &&
			Math.abs(f.plungeRate - v.plungeRate) <= 1 &&
			Math.abs(f.spindleRpm - v.spindleRpm) <= 1 &&
			Math.abs(f.stepdown - v.stepdown) <= 0.01,
	) ?? null;
