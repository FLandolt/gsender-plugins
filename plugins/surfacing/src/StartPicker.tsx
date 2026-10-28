import PositionPicker, { BOX } from "@shared/PositionPicker";
import { cornerOf, type Position } from "@shared/position";

import type { PassAxis, Params } from "./lib/params";

type Props = Pick<Params, "startX" | "startY" | "passAxis"> & {
	onChange: (startX: Params["startX"], startY: Params["startY"]) => void;
};

/** Arrow from `a` towards `b`, drawn as a line with a head at `b`. */
const arrow = (ax: number, ay: number, bx: number, by: number) => {
	const dx = Math.sign(bx - ax), dy = Math.sign(by - ay);
	const head = dx !== 0
		? `M${bx - dx * 7} ${by - 5}L${bx} ${by}L${bx - dx * 7} ${by + 5}`
		: `M${bx - 5} ${by - dy * 7}L${bx} ${by}L${bx + 5} ${by - dy * 7}`;
	return `M${ax} ${ay}L${bx} ${by}${head}`;
};

/**
 * Start corner, drawn with the first pass (solid arrow) running away from it and
 * the step over (dotted arrow) heading into the area.
 */
const StartPicker = ({ startX, startY, passAxis, onChange }: Props) => {
	const { L, R, T, B } = BOX;
	const sx = startX === "left" ? L : R;
	const sy = startY === "top" ? T : B;
	const ox = startX === "left" ? R : L; // the opposite corner
	const oy = startY === "top" ? B : T;
	const inset = (axis: PassAxis) => (axis === "x" ? (startY === "top" ? 14 : -14) : startX === "left" ? 14 : -14);
	const along = 0.55; // how far along the first pass the arrow runs
	const run = passAxis === "x"
		? arrow(sx, sy + inset("x"), sx + (ox - sx) * along, sy + inset("x"))
		: arrow(sx + inset("y"), sy, sx + inset("y"), sy + (oy - sy) * along);
	const tipX = sx + (ox - sx) * along + 14 * Math.sign(ox - sx);
	const tipY = sy + (oy - sy) * along + 14 * Math.sign(oy - sy);
	const step = passAxis === "x"
		? arrow(tipX, sy + inset("x"), tipX, sy + inset("x") + (oy - sy) * 0.3)
		: arrow(sx + inset("y"), tipY, sx + inset("y") + (ox - sx) * 0.3, tipY);
	return (
		<PositionPicker
			label="Start corner"
			hint={undefined}
			value={cornerOf(startX, startY)}
			onChange={(pos: Position) => {
				if (pos === "center") return;
				onChange(pos.endsWith("right") ? "right" : "left", pos.startsWith("upper") ? "top" : "bottom");
			}}
			overlay={
				<>
					<path d={run} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
					<path d={step} fill="none" stroke="currentColor" strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 4" />
				</>
			}
		/>
	);
};

export default StartPicker;
