/**
 * The finishing pass along the walls, shared by the clearing strategies. (Adaptive clearing itself is
 * in wavefront.ts.)
 */

import { type Grid, pointInRing, type Pt, ringArea, ringsToMm, simplifyRing, traceContours } from "./picture";

type Stroke = Pt[];

/** The walls (where `field` crosses 0) as closed rings with the area on their right: climb milling. */
export const wallRings = (grid: Grid, field: Float32Array): Stroke[] => {
	const rings = ringsToMm(grid, traceContours(field, grid.w, grid.h))
		.map((ring) => simplifyRing(ring, grid.cell * 0.2))
		.filter((ring) => ring.length >= 3);
	return rings.map((ring) => {
		const hole = rings.filter((o) => o !== ring && pointInRing(ring[0], o)).length % 2 === 1;
		const pts = hole !== ringArea(ring) > 0 ? [...ring].reverse() : ring;
		return [...pts, pts[0]];
	});
};
