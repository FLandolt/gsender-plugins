import type { ReactNode } from "react";

import { type Position, POSITION_NAMES } from "./position";

/** Drawing space of the picker; an `overlay` is drawn in these coordinates. */
export const BOX = { W: 200, H: 120, L: 40, R: 160, T: 24, B: 96 };

const spots: { pos: Position; x: number; y: number }[] = [
	{ pos: "upper-left", x: BOX.L, y: BOX.T },
	{ pos: "upper-right", x: BOX.R, y: BOX.T },
	{ pos: "lower-left", x: BOX.L, y: BOX.B },
	{ pos: "lower-right", x: BOX.R, y: BOX.B },
	{ pos: "center", x: (BOX.L + BOX.R) / 2, y: (BOX.T + BOX.B) / 2 },
];

/**
 * Touch-friendly picker: the area drawn as a rectangle with a round button on each
 * corner (and in the middle when `centre` is set). Tap where you want it.
 */
const PositionPicker = ({
	label,
	hint,
	value,
	onChange,
	centre = false,
	overlay,
}: {
	label: string;
	hint?: string;
	value: Position;
	onChange: (pos: Position) => void;
	centre?: boolean;
	/** Extra SVG drawn over the rectangle, in `BOX` coordinates. */
	overlay?: ReactNode;
}) => (
	<div className="flex flex-col gap-1">
		<span className="text-xs font-medium text-gray-600 dark:text-slate-400">{label}</span>
		<div
			className="relative mx-auto w-full max-w-[280px] rounded-lg bg-gray-100 dark:bg-slate-800"
			style={{ aspectRatio: `${BOX.W} / ${BOX.H}` }}
		>
			<svg viewBox={`0 0 ${BOX.W} ${BOX.H}`} className="absolute inset-0 h-full w-full text-blue-600 dark:text-blue-400" aria-hidden>
				<rect
					x={BOX.L}
					y={BOX.T}
					width={BOX.R - BOX.L}
					height={BOX.B - BOX.T}
					rx="3"
					fill="none"
					stroke="currentColor"
					strokeOpacity=".35"
					strokeWidth="1.5"
					strokeDasharray="4 3"
				/>
				{overlay}
			</svg>
			{spots
				.filter((s) => centre || s.pos !== "center")
				.map((s) => {
					const active = s.pos === value;
					return (
						<button
							key={s.pos}
							type="button"
							aria-label={`${label}: ${POSITION_NAMES[s.pos]}`}
							aria-pressed={active}
							title={POSITION_NAMES[s.pos]}
							onClick={() => onChange(s.pos)}
							className={`absolute h-10 w-10 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border-2 transition active:scale-90 ${
								active
									? "border-blue-600 bg-blue-600 shadow-sm"
									: "border-gray-400 bg-white hover:border-blue-500 dark:border-slate-500 dark:bg-slate-700"
							}`}
							style={{ left: `${(s.x / BOX.W) * 100}%`, top: `${(s.y / BOX.H) * 100}%` }}
						/>
					);
				})}
		</div>
		<p className="m-0 text-center text-xs text-gray-500 dark:text-slate-400">
			{hint ?? POSITION_NAMES[value][0].toUpperCase() + POSITION_NAMES[value].slice(1)}
		</p>
	</div>
);

export default PositionPicker;
