/** A spot on a rectangle: one of its corners or its middle. Used for where X0 Y0 sits. */
export type Position = "lower-left" | "lower-right" | "upper-left" | "upper-right" | "center";

export type Corner = Exclude<Position, "center">;

export const POSITION_NAMES: Record<Position, string> = {
	"lower-left": "lower-left corner",
	"lower-right": "lower-right corner",
	"upper-left": "upper-left corner",
	"upper-right": "upper-right corner",
	center: "centre",
};

/** Where the zero point is, measured from the lower-left corner of a width × height area. */
export const originOffset = (pos: Position, width: number, height: number): { x: number; y: number } => ({
	x: pos === "center" ? width / 2 : pos.endsWith("right") ? width : 0,
	y: pos === "center" ? height / 2 : pos.startsWith("upper") ? height : 0,
});

export const cornerOf = (x: "left" | "right", y: "bottom" | "top"): Corner =>
	`${y === "top" ? "upper" : "lower"}-${x}`;
