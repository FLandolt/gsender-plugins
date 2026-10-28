/** The measurements behind the picture of the bit, in mm, using the same maths as the toolpath. */

import { deepestCut, radiusForDepth, type Bit } from "./bit";

export type BitDiagram = {
	bit: Bit;
	/** How tall the cone is: the deepest the bit can cut. */
	coneHeight: number;
	/** Half the cone's width at its top. */
	topHalfWidth: number;
	limitedBy: "diameter" | "cutting length";
	/** The groove the bit makes at the maximum depth, if that is known. */
	groove: { depth: number; surfaceWidth: number; floorWidth: number } | null;
};

export const bitDiagram = (bit: Bit, maxDepth: number | null): BitDiagram => {
	const deepest = deepestCut(bit);
	return {
		bit,
		coneHeight: deepest.depth,
		topHalfWidth: radiusForDepth(deepest.depth, bit),
		limitedBy: deepest.limitedBy,
		groove:
			maxDepth !== null && maxDepth > 0 && maxDepth <= deepest.depth + 1e-9
				? { depth: maxDepth, surfaceWidth: 2 * radiusForDepth(maxDepth, bit), floorWidth: bit.tip }
				: null,
	};
};
