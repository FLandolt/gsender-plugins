/** The V-bit: how deep it has to go to cut a given width, and how deep it can go. All lengths in mm. */

import { MM_PER_INCH, type Units } from "@shared/units";

export type Bit = {
	/** Included angle of the cone, degrees. */
	angle: number;
	/** Diameter at the widest point of the cutting edge. */
	diameter: number;
	/** Width of the flat at the tip; 0 for a sharp point. */
	tip: number;
	/** Length of the cutting edge, if known. */
	cuttingLength: number | null;
};

const halfTan = (angle: number) => Math.tan((angle * Math.PI) / 360);

/** The depth at which the bit cuts a groove with half-width `r`. Zero if the groove is no wider than the tip. */
export const depthForRadius = (r: number, bit: Bit): number => (r <= bit.tip / 2 ? 0 : (r - bit.tip / 2) / halfTan(bit.angle));

/** The half-width of the groove at a given depth. */
export const radiusForDepth = (depth: number, bit: Bit): number => bit.tip / 2 + depth * halfTan(bit.angle);

/** The deepest this bit can cut: where the cone reaches its full diameter, or the end of its cutting edge. */
export const deepestCut = (bit: Bit): { depth: number; limitedBy: "diameter" | "cutting length" } => {
	const byDiameter = (bit.diameter - bit.tip) / 2 / halfTan(bit.angle);
	if (bit.cuttingLength !== null && bit.cuttingLength < byDiameter) return { depth: bit.cuttingLength, limitedBy: "cutting length" };
	return { depth: byDiameter, limitedBy: "diameter" };
};

/** A length for messages, in the user's units. */
export const lengthText = (mm: number, units: Units): string =>
	units === "in" ? `${Number((mm / MM_PER_INCH).toFixed(3))} in` : `${Number(mm.toFixed(2))} mm`;
