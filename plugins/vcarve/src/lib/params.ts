/**
 * V-Carve parameters. Lengths are millimetres whatever the display units; conversion happens
 * at the UI boundary and in the G-code emitter. The V-bit starts with common values (60°,
 * 12.7 mm, sharp tip) that are shown in the form and can be changed; the maximum depth is
 * worked out from the bit unless a smaller one is entered.
 */

import type { Position } from "@shared/position";
import { MM_PER_INCH, type Units } from "@shared/units";

import { deepestCut, lengthText } from "./bit";

export type { Units };

export type Source = "text" | "svg" | "image";
export type Quality = "draft" | "normal" | "fine";
export type Align = "left" | "center" | "right";

export type Params = {
	units: Units;
	source: Source;

	/** Text. */
	text: string;
	/** `custom` is a font file the user loaded. */
	fontId: string;
	/** Height of capital letters. */
	letterHeight: number;
	lineSpacing: number;
	align: Align;

	/** SVG and image: the real-world size, set by one side; the other follows. */
	sizeBy: "width" | "height";
	size: number;

	/** Image. */
	threshold: number;
	/** Cut the light areas instead of the dark ones. */
	invert: boolean;

	/** The V-bit. Null means the box was cleared and must be filled in again. */
	angle: number | null;
	diameter: number | null;
	tip: number | null;
	cuttingLength: number | null;

	/**
	 * A limit on the depth, for thin stock. Null means automatic: the deepest the bit can cut,
	 * worked out from its angle, diameter, tip and cutting length.
	 */
	maxDepth: number | null;
	quality: Quality;
	/** Cut a roughing pass that leaves some wood on the walls, then a slower finishing pass. */
	rough: boolean;
	/** Wood left on each wall by the roughing pass, measured sideways at the surface. Can be 0. */
	allowance: number;
	/** The finishing pass feed, as a percentage of the cutting feed. */
	finishFeedPercent: number;

	feedrate: number;
	plungeRate: number;
	spindleRpm: number;
	safeZ: number;
	spindleDwell: number;

	/** Where X0 Y0 sits on the artwork's bounding box. */
	origin: Position;
};

export const defaultParams = (): Params => ({
	units: "mm",
	source: "text",
	text: "Hello",
	fontId: "roboto-bold",
	letterHeight: 40,
	lineSpacing: 1,
	align: "center",
	sizeBy: "width",
	size: 100,
	threshold: 128,
	invert: false,
	angle: 60,
	diameter: 12.7,
	tip: 0,
	cuttingLength: null,
	maxDepth: null,
	quality: "normal",
	rough: false,
	allowance: 0.2,
	finishFeedPercent: 60,
	feedrate: 950,
	plungeRate: 300,
	spindleRpm: 14500,
	safeZ: 5,
	spindleDwell: 2,
	origin: "lower-left",
});

/** The bit, once it has been checked. */
export type CheckedBit = { angle: number; diameter: number; tip: number; cuttingLength: number | null };

export type Checked = {
	/** Things that were entered but are wrong or impossible. */
	errors: string[];
	/** Things still to be filled in. */
	missing: string[];
	warnings: string[];
	/** Present only when the bit values are all valid. */
	bit: CheckedBit | null;
	/** The deepest this bit can cut, when the bit is valid. */
	deepest: number | null;
	/**
	 * The depth limit in force, once the bit is valid: the one entered, or else the deepest the bit
	 * can cut. Null if the bit or the entered depth is not valid.
	 */
	maxDepth: number | null;
};

const entered = (v: number | null): v is number => v !== null && Number.isFinite(v);

/**
 * Checks everything the user typed about the bit and the cut, and says in plain words what is wrong
 * and how to fix it. The errors are written for people, in the user's units.
 */
export const check = (p: Params): Checked => {
	const errors: string[] = [];
	const missing: string[] = [];
	const warnings: string[] = [];
	const len = (mm: number) => lengthText(mm, p.units);
	let bit: CheckedBit | null = null;
	let deepest: number | null = null;
	let maxDepth: number | null = null;

	// The bit.
	let bitOk = true;
	if (!entered(p.angle)) {
		missing.push("Enter the V-bit's included angle (for example 60 or 90).");
		bitOk = false;
	} else if (!(p.angle >= 1 && p.angle <= 179)) {
		errors.push(`The included angle must be between 1° and 179°. You entered ${p.angle}°.`);
		bitOk = false;
	}
	if (!entered(p.diameter)) {
		missing.push("Enter the V-bit's maximum diameter, the width of the cutting edge at its widest.");
		bitOk = false;
	} else if (!(p.diameter > 0)) {
		errors.push(`The bit's maximum diameter must be greater than 0. You entered ${len(p.diameter)}.`);
		bitOk = false;
	}
	if (!entered(p.tip)) {
		missing.push("Enter the V-bit's tip diameter. Enter 0 for a sharp point.");
		bitOk = false;
	} else if (p.tip < 0) {
		errors.push(`The tip diameter can't be negative. You entered ${len(p.tip)}. Enter 0 for a sharp point.`);
		bitOk = false;
	} else if (entered(p.diameter) && p.diameter > 0 && p.tip >= p.diameter) {
		errors.push(
			`The tip (${len(p.tip)}) can't be as wide as the whole bit (${len(p.diameter)}). The tip diameter must be smaller than the maximum diameter.`,
		);
		bitOk = false;
	}
	if (p.cuttingLength !== null && !(Number.isFinite(p.cuttingLength) && p.cuttingLength > 0)) {
		errors.push(`The cutting length must be greater than 0, or left empty if you don't know it. You entered ${len(p.cuttingLength)}.`);
		bitOk = false;
	}
	if (bitOk && entered(p.angle) && entered(p.diameter) && entered(p.tip)) {
		bit = { angle: p.angle, diameter: p.diameter, tip: p.tip, cuttingLength: p.cuttingLength };
		const d = deepestCut(bit);
		deepest = d.depth;
	}

	// The depth: automatic unless a limit was entered.
	if (entered(p.maxDepth)) {
		if (!(p.maxDepth > 0)) {
			errors.push(`The maximum depth must be greater than 0, or left empty for automatic. You entered ${len(p.maxDepth)}.`);
		} else if (bit && deepest !== null && p.maxDepth > deepest + 1e-9) {
			const d = deepestCut(bit);
			errors.push(
				`A maximum depth of ${len(p.maxDepth)} is deeper than this bit can cut. The deepest it can go is ${len(deepest)}, ` +
					(d.limitedBy === "cutting length"
						? "where its cutting edge ends. Enter a smaller maximum depth, or leave it empty for automatic."
						: "where the cone reaches its full diameter. Enter a smaller maximum depth, leave it empty for automatic, or use a bit with a larger diameter or narrower angle."),
			);
		} else if (bit) {
			maxDepth = p.maxDepth;
		}
	} else if (bit && deepest !== null) {
		maxDepth = deepest;
	}

	// The roughing pass.
	if (p.rough) {
		if (!(Number.isFinite(p.allowance) && p.allowance >= 0)) errors.push(`The wood left for the finishing pass must be 0 or more. You entered ${len(p.allowance)}.`);
		if (!(p.finishFeedPercent > 0 && p.finishFeedPercent <= 100))
			errors.push(`The finishing feed must be more than 0% and at most 100% of the cutting feed. You entered ${p.finishFeedPercent}%.`);
	}

	// The cutting settings.
	if (!(p.feedrate > 0)) errors.push("The cutting feed rate must be greater than 0.");
	if (!(p.plungeRate > 0)) errors.push("The plunge rate must be greater than 0.");
	if (!(p.spindleRpm > 0)) errors.push("The spindle speed must be greater than 0.");
	if (!(p.safeZ > 0)) errors.push("The safe Z height must be greater than 0.");

	// The artwork.
	if (p.source === "text") {
		if (!p.text.trim()) missing.push("Type the text to carve.");
		if (!(p.letterHeight > 0)) errors.push("The letter height must be greater than 0.");
		if (!(p.lineSpacing > 0)) errors.push("The line spacing must be greater than 0.");
	} else if (!(p.size > 0)) {
		errors.push(`The ${p.sizeBy} must be greater than 0.`);
	}
	return { errors, missing, warnings, bit, deepest, maxDepth };
};

/** Millimetres per display unit. */
export const unitScale = (units: Units): number => (units === "in" ? MM_PER_INCH : 1);
