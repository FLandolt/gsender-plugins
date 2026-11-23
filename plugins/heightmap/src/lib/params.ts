/**
 * Height Map parameters. Lengths are millimetres whatever the display units; conversion happens at
 * the UI boundary and in the G-code emitter.
 *
 * A picture is turned to grey and split into `steps + 1` bands of brightness: the lightest band stays
 * at the stock top, each darker band is one step deeper, and the darkest is cut to `depth`
 * (inverted, the light areas go deep instead). Two steps give top, middle and bottom.
 */

import type { Position } from "@shared/position";
import type { Strategy } from "@shared/clearing";
import type { Units } from "@shared/units";

export type { Units };

export type Params = {
	units: Units;
	/** The real-world size of the picture, set by one side; the other follows its shape. */
	sizeBy: "width" | "height";
	size: number;
	/** Light areas go deep instead of dark ones. */
	invert: boolean;
	/** How many steps down from the top: 2 gives three levels (top, middle, bottom). */
	steps: number;
	/** Depth of the deepest level below the stock top (Z0), mm. */
	depth: number;
	/** Radius of the median filter run before the picture is split into levels, mm. Removes specks without blurring edges. */
	smoothing: number;
	toolDiameter: number;
	/** Stepover as a fraction of the tool diameter, (0–1]. */
	stepover: number;
	/** How a picture's areas are cleared: rings from the inside out, or adaptive (an even load on the bit). */
	strategy: Strategy;
	/** Most the bit cuts down in one pass, mm. A deep step is cut in several passes. */
	stepdown: number;
	/** Where X0 Y0 sits on the picture's rectangle. */
	origin: Position;
	feedrate: number;
	plungeRate: number;
	spindleRpm: number;
	safeZ: number;
	spindleDwell: number;
};

// Cutting values match the "High" speed preset.
export const defaultParams = (): Params => ({
	units: "mm",
	sizeBy: "width",
	size: 100,
	invert: false,
	steps: 2,
	// No depth until one is entered: it depends on the stock, so the job can't run on a guess.
	depth: 0,
	smoothing: 1,
	toolDiameter: 4,
	stepover: 0.4,
	strategy: "rings",
	stepdown: 2,
	origin: "lower-left",
	feedrate: 1200,
	plungeRate: 400,
	spindleRpm: 15000,
	safeZ: 5,
	spindleDwell: 2,
});

export const MAX_STEPS = 12;

export type Problems = { errors: string[]; warnings: string[] };

export const check = (p: Params): Problems => {
	const errors: string[] = [];
	const warnings: string[] = [];
	if (!(p.size > 0)) errors.push(`The ${p.sizeBy} must be greater than 0.`);
	if (!(p.depth > 0)) errors.push(p.depth === 0 ? "Set the depth of the deepest level." : "The depth must be greater than 0.");
	if (!(Number.isInteger(p.steps) && p.steps >= 1 && p.steps <= MAX_STEPS)) errors.push(`The number of steps must be a whole number from 1 to ${MAX_STEPS}.`);
	if (!(p.toolDiameter > 0)) errors.push("Bit diameter must be greater than 0.");
	if (!(p.stepover > 0 && p.stepover <= 1)) errors.push("Stepover must be between 0 and 1.");
	if (!(p.stepdown > 0)) errors.push("Stepdown must be greater than 0.");
	if (!(p.smoothing >= 0)) errors.push("Smoothing can't be negative.");
	if (!(p.feedrate > 0) || !(p.plungeRate > 0)) errors.push("Feed and plunge rates must be greater than 0.");
	if (!(p.safeZ > 0)) errors.push("Safe Z must be greater than 0.");
	if (p.stepover > 0.9) warnings.push("A stepover this close to the bit diameter can leave faint ridges between passes.");
	return { errors, warnings };
};

/** Depth of each level, top first: level 0 is the stock top, level `steps` is the full depth. */
export const levelDepths = (depth: number, steps: number): number[] =>
	Array.from({ length: steps + 1 }, (_, k) => (depth * k) / steps);
