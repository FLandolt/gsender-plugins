export type Units = "mm" | "in";

export const MM_PER_INCH = 25.4;

/** mm per display unit. Multiply a display value by this to get mm. */
export const unitsScale = (units: Units): number =>
	units === "in" ? MM_PER_INCH : 1;
