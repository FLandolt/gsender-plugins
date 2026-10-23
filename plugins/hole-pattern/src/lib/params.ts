/**
 * The Hole Pattern parameter model. Everything is in millimetres regardless of
 * the display units; conversion happens only at the UI boundary and in the
 * G-code emitter.
 */

import type { Units } from "@shared/units";

export type { Units };

export type Params = {
	units: Units;
	/** Endmill diameter in mm. */
	toolDiameter: number;
	/** Finished hole diameter in mm. */
	holeDiameter: number;
	/** Depth of each hole below the stock top (Z0), in mm. */
	depth: number;
	/** Number of holes along X / Y. 1 × 1 is a single hole at 0,0. */
	countX: number;
	countY: number;
	/** Centre-to-centre distance between neighbouring holes, in mm. */
	spacingX: number;
	spacingY: number;
	feedrate: number;
	plungeRate: number;
	spindleRpm: number;
	/** Max depth of cut per pass, in mm. */
	stepdown: number;
	/** Stepover as a fraction of tool diameter (0–1). */
	stepover: number;
	/** Retract height above the stock top, in mm. */
	safeZ: number;
	/** Seconds to wait for the spindle to ramp up after start; 0 disables the G4. */
	spindleDwell: number;
};

// Cutting values match the "High" speed preset.
export const defaultParams = (): Params => ({
	units: "mm",
	toolDiameter: 4,
	holeDiameter: 10,
	depth: 5,
	countX: 1,
	countY: 1,
	spacingX: 20,
	spacingY: 20,
	feedrate: 1200,
	plungeRate: 400,
	spindleRpm: 15000,
	stepdown: 2,
	stepover: 0.4,
	safeZ: 5,
	spindleDwell: 2,
});

/** Returns human-readable problems; an empty list means the job can run. */
export const validate = (p: Params): string[] => {
	const errors: string[] = [];
	if (!(p.toolDiameter > 0)) errors.push("Tool diameter must be greater than 0.");
	if (!(p.holeDiameter > 0)) errors.push("Hole diameter must be greater than 0.");
	if (p.holeDiameter < p.toolDiameter - 1e-6)
		errors.push("Hole diameter is smaller than the tool — the bit cannot cut it.");
	if (!(p.depth > 0)) errors.push("Depth must be greater than 0.");
	if (!(p.stepdown > 0)) errors.push("Stepdown must be greater than 0.");
	if (!(p.stepover > 0 && p.stepover <= 1))
		errors.push("Stepover must be between 0 and 1.");
	if (!(p.feedrate > 0) || !(p.plungeRate > 0))
		errors.push("Feed and plunge rates must be greater than 0.");
	if (!Number.isInteger(p.countX) || p.countX < 1 || !Number.isInteger(p.countY) || p.countY < 1)
		errors.push("Pattern counts must be whole numbers of at least 1.");
	if (p.countX > 1 && p.spacingX < p.holeDiameter)
		errors.push("X spacing is smaller than the hole diameter — holes would overlap.");
	if (p.countY > 1 && p.spacingY < p.holeDiameter)
		errors.push("Y spacing is smaller than the hole diameter — holes would overlap.");
	return errors;
};
