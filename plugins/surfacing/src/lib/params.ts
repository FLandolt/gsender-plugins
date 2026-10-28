/**
 * Surfacing parameters. Everything is in millimetres regardless of the display
 * units; conversion happens only at the UI boundary and in the G-code emitter.
 */

import type { Position } from "@shared/position";
import type { Units } from "@shared/units";

export type { Units };

/** Where the bit enters and leaves each pass. */
export type Turn = "outside" | "inside";

/** `snake` cuts back and forth; `same` lifts and returns so every pass cuts the same way. */
export type Pattern = "snake" | "same";

export type PassAxis = "x" | "y";

export type Params = {
	units: Units;
	/** Size of the area along X / Y. */
	width: number;
	height: number;
	toolDiameter: number;
	/** Total depth below the stock top (Z0), in mm. */
	depth: number;
	/** Stepover as a fraction of tool diameter (0–1]. */
	stepover: number;
	/** Corner the first pass starts at. */
	startX: "left" | "right";
	startY: "bottom" | "top";
	/** Where X0 Y0 sits on the area: a corner or the centre. Follows the start corner by default. */
	origin: Position;
	/** Direction the passes run; the stepover goes the other way. */
	passAxis: PassAxis;
	turn: Turn;
	pattern: Pattern;
	feedrate: number;
	plungeRate: number;
	spindleRpm: number;
	/** Max depth of cut per level, in mm. */
	stepdown: number;
	/** Retract height above the stock top, in mm. */
	safeZ: number;
	/** Seconds to wait for the spindle to ramp up after start; 0 disables the G4. */
	spindleDwell: number;
};

// Cutting values match the "High" speed preset, with a shallow stepdown that suits facing.
export const defaultParams = (): Params => ({
	units: "mm",
	width: 100,
	height: 60,
	toolDiameter: 6,
	depth: 1,
	stepover: 0.5,
	startX: "left",
	startY: "bottom",
	origin: "lower-left",
	passAxis: "x",
	turn: "outside",
	pattern: "snake",
	feedrate: 1200,
	plungeRate: 400,
	spindleRpm: 15000,
	stepdown: 1,
	safeZ: 5,
	spindleDwell: 2,
});

/** Plain-words summary of the first pass, for the UI and the G-code header. */
export const describeStart = (p: Params): string => {
	const x = p.startX === "left";
	const y = p.startY === "bottom";
	if (p.passAxis === "x")
		return `First pass runs ${x ? "right" : "left"} along the ${y ? "bottom" : "top"} edge, then steps ${y ? "up" : "down"}.`;
	return `First pass runs ${y ? "up" : "down"} along the ${x ? "left" : "right"} edge, then steps ${x ? "right" : "left"}.`;
};

export type Problems = { errors: string[]; warnings: string[] };

export const check = (p: Params): Problems => {
	const errors: string[] = [];
	const warnings: string[] = [];
	if (!(p.toolDiameter > 0)) errors.push("Tool diameter must be greater than 0.");
	if (!(p.width > 0) || !(p.height > 0)) errors.push("Width and height must be greater than 0.");
	if (!(p.depth > 0)) errors.push("Depth must be greater than 0.");
	if (!(p.stepdown > 0)) errors.push("Stepdown must be greater than 0.");
	if (!(p.stepover > 0 && p.stepover <= 1)) errors.push("Stepover must be between 0 and 1.");
	if (!(p.feedrate > 0) || !(p.plungeRate > 0)) errors.push("Feed and plunge rates must be greater than 0.");
	if (p.stepover > 0.9) warnings.push("A stepover this close to the tool diameter can leave faint ridges between passes.");
	return { errors, warnings };
};
