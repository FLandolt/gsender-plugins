/**
 * Rectangular Cutout parameters. Everything is in millimetres regardless of the
 * display units; conversion happens only at the UI boundary and in the G-code
 * emitter.
 */

import type { Units } from "@shared/units";

export type { Units };

/** `hole` keeps the material around the rectangle; `part` keeps the rectangle. */
/** `trapezoid` has sloped sides (easier on the bit); `rectangular` has vertical sides. */
export type TabShape = "trapezoid" | "rectangular";

export type CutMode = "hole" | "part";

export type Direction = "climb" | "conventional";

/** Where X0 Y0 sits relative to the finished rectangle. */
export type OriginMode = "center" | "lower-left";

export type Params = {
	units: Units;
	/** Finished rectangle size. */
	width: number;
	height: number;
	/** Radius of all four corners; 0 gives sharp corners. */
	cornerRadius: number;
	mode: CutMode;
	direction: Direction;
	origin: OriginMode;
	toolDiameter: number;
	/** Cut depth below the stock top — stock thickness plus a little. */
	depth: number;
	feedrate: number;
	plungeRate: number;
	spindleRpm: number;
	stepdown: number;
	safeZ: number;
	spindleDwell: number;
	tabs: {
		enabled: boolean;
		shape: TabShape;
		/** Tabs on each straight side (the middle one if 1, evenly spread if more). */
		perSide: number;
		/** Length along the cut, mm (at the base for trapezoid tabs). */
		length: number;
		/** Height of the tab above the bottom of the cut, mm. */
		height: number;
	};
};

export const defaultParams = (): Params => ({
	units: "mm",
	width: 60,
	height: 40,
	cornerRadius: 0,
	mode: "hole",
	direction: "climb",
	origin: "center",
	toolDiameter: 4,
	depth: 19,
	feedrate: 1200,
	plungeRate: 400,
	spindleRpm: 15000,
	stepdown: 2,
	safeZ: 5,
	spindleDwell: 2,
	tabs: { enabled: true, shape: "trapezoid", perSide: 1, length: 8, height: 3 },
});

export type Problems = { errors: string[]; warnings: string[] };

export const check = (p: Params): Problems => {
	const errors: string[] = [];
	const warnings: string[] = [];
	const rt = p.toolDiameter / 2;

	if (!(p.toolDiameter > 0)) errors.push("Tool diameter must be greater than 0.");
	if (!(p.width > 0) || !(p.height > 0)) errors.push("Width and height must be greater than 0.");
	if (!(p.depth > 0)) errors.push("Cut depth must be greater than 0.");
	if (!(p.stepdown > 0)) errors.push("Stepdown must be greater than 0.");
	if (!(p.feedrate > 0) || !(p.plungeRate > 0)) errors.push("Feed and plunge rates must be greater than 0.");
	if (p.cornerRadius < 0) errors.push("Corner radius cannot be negative.");
	if (p.cornerRadius > Math.min(p.width, p.height) / 2 + 1e-9)
		errors.push("Corner radius is larger than half the shorter side.");
	if (p.mode === "hole" && (p.width <= p.toolDiameter || p.height <= p.toolDiameter))
		errors.push("The inside cut is not wider than the tool.");

	if (p.mode === "hole" && p.cornerRadius < rt - 1e-9)
		warnings.push(
			p.cornerRadius === 0
				? "A round bit can't cut sharp inside corners — they will have the tool's radius."
				: "Corner radius is smaller than the tool radius — corners will have the tool's radius.",
		);

	if (p.tabs.enabled) {
		if (p.tabs.perSide < 1 || !Number.isInteger(p.tabs.perSide)) errors.push("Tabs per side must be a whole number of at least 1.");
		if (p.tabs.length <= 0 || p.tabs.height <= 0) errors.push("Tab length and height must be greater than 0.");
		if (p.tabs.height >= p.depth) warnings.push("Tab height is as tall as the cut — nothing would be cut through.");
	}
	return { errors, warnings };
};
