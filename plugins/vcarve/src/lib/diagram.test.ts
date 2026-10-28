import { describe, expect, it } from "vitest";

import { depthForRadius, deepestCut, type Bit } from "./bit";
import { bitDiagram } from "./diagram";

const bit: Bit = { angle: 60, diameter: 12, tip: 0, cuttingLength: null };

describe("bit diagram", () => {
	it("the cone is as tall as the deepest cut and as wide at the top as the bit", () => {
		const d = bitDiagram(bit, null);
		expect(d.coneHeight).toBeCloseTo(6 / Math.tan(Math.PI / 6), 9);
		expect(d.coneHeight).toBe(deepestCut(bit).depth);
		expect(d.topHalfWidth).toBeCloseTo(6, 9);
		expect(d.limitedBy).toBe("diameter");
		expect(d.groove).toBeNull();
	});
	it("the flanks make the angle that was entered", () => {
		for (const angle of [30, 60, 90, 120]) {
			const d = bitDiagram({ ...bit, angle }, null);
			// Each flank leans half the included angle from the bit's axis.
			expect(Math.atan(d.topHalfWidth / d.coneHeight) * (180 / Math.PI) * 2).toBeCloseTo(angle, 6);
		}
	});
	it("a flat tip shortens the cone", () => {
		const d = bitDiagram({ ...bit, tip: 2 }, null);
		expect(d.coneHeight).toBeCloseTo((6 - 1) / Math.tan(Math.PI / 6), 9);
		expect(d.topHalfWidth).toBeCloseTo(6, 9);
	});
	it("a short cutting length ends the cone before it reaches the full diameter", () => {
		const d = bitDiagram({ ...bit, cuttingLength: 5 }, null);
		expect(d.coneHeight).toBe(5);
		expect(d.limitedBy).toBe("cutting length");
		expect(d.topHalfWidth).toBeCloseTo(5 * Math.tan(Math.PI / 6), 9);
		expect(d.topHalfWidth).toBeLessThan(6);
	});
	it("the groove at the maximum depth is as wide as the toolpath maths says", () => {
		const d = bitDiagram(bit, 6);
		expect(d.groove!.surfaceWidth).toBeCloseTo(2 * 6 * Math.tan(Math.PI / 6), 9);
		// Going the other way, that width needs exactly that depth.
		expect(depthForRadius(d.groove!.surfaceWidth / 2, bit)).toBeCloseTo(6, 9);
		expect(d.groove!.floorWidth).toBe(0);
		expect(bitDiagram({ ...bit, tip: 1 }, 6).groove!.floorWidth).toBe(1);
	});
	it("no groove is drawn for a depth the bit can't reach", () => {
		expect(bitDiagram(bit, 20).groove).toBeNull();
		expect(bitDiagram(bit, 0).groove).toBeNull();
	});
});
