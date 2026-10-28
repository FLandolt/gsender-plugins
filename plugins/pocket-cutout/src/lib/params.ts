/**
 * Pocket Cutout parameters. Everything is in millimetres regardless of the display
 * units; conversion happens only at the UI boundary and in the G-code emitter.
 */

import type { Position } from "@shared/position";
import type { Units } from "@shared/units";

export type { Units };

export type Shape = "rectangle" | "circle";

/** Which way the spiral turns, seen from above. Clockwise is climb milling inside a pocket. */
export type Rotation = "cw" | "ccw";

export type Params = {
	units: Units;
	shape: Shape;
	/** Finished pocket size (rectangle). */
	width: number;
	height: number;
	/** Radius of all four corners; 0 leaves the tool's own radius. */
	cornerRadius: number;
	/** Finished pocket diameter (circle). */
	diameter: number;
	toolDiameter: number;
	/** Pocket depth below the stock top (Z0), in mm. */
	depth: number;
	/** Max depth of cut per level, in mm. */
	stepdown: number;
	/** Stepover as a fraction of the tool diameter, (0–1]. */
	stepover: number;
	/** Which way the spiral turns. Clockwise is climb milling; counter-clockwise is conventional. */
	rotation: Rotation;
	/** Where X0 Y0 sits on the pocket: a corner of its bounding box or the centre. */
	origin: Position;
	feedrate: number;
	plungeRate: number;
	spindleRpm: number;
	/** Retract height above the stock top, in mm. */
	safeZ: number;
	/** Seconds to wait for the spindle to ramp up after start; 0 disables the G4. */
	spindleDwell: number;
	/** Cut circles and rounded corners with G2/G3 arcs; off writes short G1 chords instead. */
	useArcs: boolean;
};

// Cutting values match the "High" speed preset.
export const defaultParams = (): Params => ({
	units: "mm",
	shape: "rectangle",
	width: 60,
	height: 40,
	cornerRadius: 0,
	diameter: 40,
	toolDiameter: 6,
	depth: 6,
	stepdown: 2,
	stepover: 0.4,
	rotation: "cw",
	origin: "center",
	feedrate: 1200,
	plungeRate: 400,
	spindleRpm: 15000,
	safeZ: 5,
	spindleDwell: 2,
	useArcs: true,
});

export type Problems = { errors: string[]; warnings: string[] };

export const check = (p: Params): Problems => {
	const errors: string[] = [];
	const warnings: string[] = [];
	const rt = p.toolDiameter / 2;
	const round = p.shape === "circle";

	if (!(p.toolDiameter > 0)) errors.push("Tool diameter must be greater than 0.");
	if (round) {
		if (!(p.diameter > 0)) errors.push("Diameter must be greater than 0.");
		else if (p.diameter <= p.toolDiameter + 1e-6) errors.push("The pocket must be wider than the tool. For a hole the size of the tool, use Hole Pattern.");
	} else {
		if (!(p.width > 0) || !(p.height > 0)) errors.push("Width and height must be greater than 0.");
		else if (Math.min(p.width, p.height) <= p.toolDiameter + 1e-6) errors.push("The pocket must be wider than the tool.");
		if (p.cornerRadius < 0) errors.push("Corner radius cannot be negative.");
		if (p.cornerRadius > Math.min(p.width, p.height) / 2 + 1e-9) errors.push("Corner radius is larger than half the shorter side.");
	}
	if (!(p.depth > 0)) errors.push("Depth must be greater than 0.");
	if (!(p.stepdown > 0)) errors.push("Stepdown must be greater than 0.");
	if (!(p.stepover > 0 && p.stepover <= 1)) errors.push("Stepover must be between 0 and 1.");
	if (!(p.feedrate > 0) || !(p.plungeRate > 0)) errors.push("Feed and plunge rates must be greater than 0.");

	if (!round && p.cornerRadius < rt - 1e-9)
		warnings.push(
			p.cornerRadius === 0
				? "A round bit can't cut sharp corners, so they will have the tool's radius."
				: "Corner radius is smaller than the tool radius, so corners will have the tool's radius.",
		);
	if (p.stepover > 0.9) warnings.push("A stepover this close to the tool diameter can leave faint ridges between passes.");
	return { errors, warnings };
};
