/** What to tell the user about a plan, in plain words and in their units. */

import { lengthText } from "./bit";
import type { CarvePlan } from "./carve";
import type { Bounds } from "./geom";
import { toMachine } from "./generate";
import type { Params } from "./params";

export type Report = {
	errors: string[];
	warnings: string[];
	/** No G-code may be made: there is an error, or the artwork is too wide for the bit. */
	blocked: boolean;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const report = (p: Params, plan: CarvePlan, bounds: Bounds): Report => {
	const errors: string[] = [];
	const warnings: string[] = [];
	const len = (mm: number) => lengthText(mm, p.units);
	const shift = toMachine(p, bounds);
	const at = (x: number, y: number) => {
		const m = shift(x, y);
		const v = (mm: number) => Number((p.units === "in" ? mm / 25.4 : mm).toFixed(p.units === "in" ? 3 : 1));
		return `X${v(m.x)} Y${v(m.y)}`;
	};

	if (plan.tooWide.length > 0) {
		const worst = plan.tooWide[0];
		warnings.push(
			`The artwork is too wide for this bit at ${len(plan.maxDepth)} deep, in ${plural(plan.tooWide.length, "place", "places")}, so no G-code was made. ` +
				`The widest spot, at ${at(worst.x, worst.y)}, is ${len(worst.width)} across and needs ${len(worst.need)} depth, which is ${len(worst.need - plan.maxDepth)} more than allowed. ` +
				`The red circles show where. To fix it, use a wider-angle or bigger bit (this one can go ${len(plan.deepestBit)}), allow more depth if the stock is thick enough, or make the artwork smaller or thinner.`,
		);
	}
	if (plan.thin.length > 0 && p.tip !== null) {
		const t = plan.thin[0];
		warnings.push(
			`${plural(plan.thin.length, "part is", "parts are")} narrower than the bit's tip (${len(p.tip)}), for example at ${at(t.x, t.y)} where it is only ${len(t.width)} wide. ` +
				`${plan.thin.length === 1 ? "It" : "They"} can't be cut to a point and will be left uncut.`,
		);
	}
	if (plan.chains.length === 0 && plan.tooWide.length === 0) {
		errors.push(plan.thin.length > 0 ? "Nothing can be cut: every part of the artwork is narrower than the bit's tip." : "There is nothing to cut. The artwork has no closed shapes with any width.");
	}
	if (plan.qualityReduced) warnings.push("The artwork is very detailed, so the outline was sampled more coarsely than the quality setting asks for, to keep things fast.");
	return { errors, warnings, blocked: errors.length > 0 || plan.tooWide.length > 0 };
};
