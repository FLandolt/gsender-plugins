/** Small G-code formatting helpers shared by the plugins. */

/** Formats a value, trimming trailing zeros and avoiding "-0". */
export const fmt = (value: number, decimals: number): string => {
	const safe = Object.is(value, -0) ? 0 : value;
	return safe
		.toFixed(decimals)
		.replace(/(\.\d*?)0+$/, "$1")
		.replace(/\.$/, "");
};

/** Escapes G-code comment delimiters, which cannot nest. */
export const comment = (text: string): string => `(${text.replace(/[()]/g, "")})`;
