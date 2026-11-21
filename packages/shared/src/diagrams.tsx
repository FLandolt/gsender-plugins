/**
 * Small live drawings that explain the numbers being typed: the bit in its cut seen from the side,
 * how far apart neighbouring passes are, and what a holding tab looks like. They redraw as the
 * values change, so it is easy to see what a setting does before looking at the 3D preview.
 *
 * The drawings follow the text colour, so they work in light and dark mode.
 */
import type { ReactNode } from "react";

import type { Units } from "./units";

const WOOD = "#d6b88a";
const WOOD_EDGE = "#8b6b3d";
const BIT = "#52a8ff";
const BIT_EDGE = "#0070f3";
const SHANK = "#cbd5e1";
const TAB = "#b08855";
const ALERT = "#dc2626";

const ok = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v) && v > 0;

/** "12.5 mm" or "0.492 in" from millimetres. */
export const fmtLen = (mm: number, units: Units): string =>
	`${Number((units === "in" ? mm / 25.4 : mm).toFixed(units === "in" ? 3 : 2))} ${units}`;

/** Equal-depth levels, as the generators cut them. */
export const passCount = (depth: number, stepdown: number): number =>
	ok(depth) && ok(stepdown) ? Math.max(1, Math.ceil(depth / stepdown - 1e-9)) : 0;

const Frame = ({ title, caption, children, label }: { title: string; caption?: ReactNode; children: ReactNode; label: string }) => (
	<figure className="dot-grid m-0 rounded-xl border border-gray-200 bg-gray-50 p-3 text-gray-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
		<figcaption className="mb-1 flex items-baseline justify-between gap-2 px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-gray-500 dark:text-slate-400">
			<span>{title}</span>
		</figcaption>
		<div role="img" aria-label={label}>
			{children}
		</div>
		{caption ? <p className="m-0 mt-1 px-1 text-[13px] text-gray-600 dark:text-slate-400">{caption}</p> : null}
	</figure>
);

/** Horizontal dimension line with end ticks and a label above it. */
const DimH = ({ x1, x2, y, text }: { x1: number; x2: number; y: number; text: string }) => (
	<g>
		<path d={`M${x1} ${y}H${x2}M${x1} ${y - 4}v8M${x2} ${y - 4}v8`} stroke="currentColor" strokeWidth="1" fill="none" />
		<text x={(x1 + x2) / 2} y={y - 6} textAnchor="middle" fontSize="11" fill="currentColor">
			{text}
		</text>
	</g>
);

/** Vertical dimension line with end ticks; the label sits to the side given. */
const DimV = ({ x, y1, y2, text, side = "left" }: { x: number; y1: number; y2: number; text: string; side?: "left" | "right" }) => (
	<g>
		<path d={`M${x} ${y1}V${y2}M${x - 4} ${y1}h8M${x - 4} ${y2}h8`} stroke="currentColor" strokeWidth="1" fill="none" />
		<text
			x={side === "left" ? x - 7 : x + 7}
			y={(y1 + y2) / 2}
			textAnchor={side === "left" ? "end" : "start"}
			dominantBaseline="middle"
			fontSize="11"
			fill="currentColor"
		>
			{text}
		</text>
	</g>
);

/** A straight end mill: flutes below, shank above, its bottom at `bottom`. */
const EndMill = ({ cx, bottom, width, top }: { cx: number; bottom: number; width: number; top: number }) => {
	const flute = Math.max(14, Math.min(bottom - top - 10, width * 2.2));
	const fluteTop = bottom - flute;
	const shankW = Math.max(4, width * 0.9);
	const stripes = [];
	for (let y = bottom - 4; y > fluteTop + 2; y -= Math.max(5, width * 0.45))
		stripes.push(<path key={y} d={`M${cx - width / 2} ${y}L${cx + width / 2} ${y - Math.max(3, width * 0.35)}`} stroke={BIT_EDGE} strokeWidth="0.8" />);
	return (
		<g>
			<rect x={cx - shankW / 2} y={top} width={shankW} height={Math.max(0, fluteTop - top)} fill={SHANK} stroke="#94a3b8" strokeWidth="1" />
			<rect x={cx - width / 2} y={fluteTop} width={width} height={flute} fill={BIT} stroke={BIT_EDGE} strokeWidth="1.2" rx="1" />
			{stripes}
		</g>
	);
};

/**
 * Side view through the cut: the stock, the groove the bit leaves at full depth, one dashed line per
 * pass, the bit itself to scale and the safe height above the stock. Widths and depths are to scale
 * with each other; the safe height is marked, not drawn to scale.
 */
export const CutSection = ({
	units,
	tool,
	depth,
	stepdown,
	safeZ,
	width,
	tabHeight,
	leftLabel,
	rightLabel,
	line,
	title = "Side view of the cut",
}: {
	units: Units;
	/** Bit diameter, mm. */
	tool: number;
	/** Final depth below the stock top, mm. */
	depth: number;
	/** Depth per pass, mm: draws one line per pass. */
	stepdown?: number;
	/** Retract height above the stock, mm. */
	safeZ?: number;
	/** Width of what is cut (a hole or pocket), mm. Defaults to one bit wide (a slot along a line). */
	width?: number;
	/** Height of a holding tab left in the groove, mm. */
	tabHeight?: number;
	/** Names for the material on either side of the groove, e.g. "part" and "waste". */
	leftLabel?: string;
	rightLabel?: string;
	/** Where the drawn outline (the line you asked for) sits: the groove's left or right wall. */
	line?: "left" | "right";
	title?: string;
}) => {
	const W = 360;
	const H = 210;
	const toolOk = ok(tool);
	const depthOk = ok(depth);
	const cutW = ok(width) && toolOk ? Math.max(width, tool) : toolOk ? tool : 6;
	// A wide pocket is drawn shortened, with a break in the middle, so the bit stays readable.
	const maxShown = toolOk ? tool * 5 : cutW;
	const broken = cutW > maxShown + 1e-9;
	const shownW = broken ? maxShown : cutW;
	const shownDepth = depthOk ? depth : (toolOk ? tool : 6) * 0.8;

	const top = 22; // room for the bit's diameter label
	const surfaceRoom = 34; // between the top of the shank and the stock: where safe Z is marked
	const bottomRoom = 18;
	const s = Math.min((H - top - surfaceRoom - bottomRoom - 14) / shownDepth, (W * 0.42) / shownW);
	const cx = W / 2;
	const surface = top + surfaceRoom + 14;
	const floor = surface + shownDepth * s;
	const gl = cx - (shownW * s) / 2;
	const gr = cx + (shownW * s) / 2;
	const stockL = 26;
	const stockR = W - 26;
	const stockB = Math.min(H - 6, floor + Math.max(14, shownDepth * s * 0.35));

	const passes = depthOk && ok(stepdown) ? passCount(depth, stepdown) : 0;
	const levels = Array.from({ length: passes }, (_, i) => surface + ((i + 1) / passes) * depth * s);
	const bitW = (toolOk ? tool : shownW) * s;
	// In a wide cut the bit is drawn finishing the right-hand wall.
	const bitCx = shownW > (toolOk ? tool : shownW) + 1e-9 ? gr - bitW / 2 : cx;
	const tabOk = depthOk && ok(tabHeight) && tabHeight < depth;

	const stock = depthOk
		? `M${stockL} ${surface}H${gl}V${floor}H${gr}V${surface}H${stockR}V${stockB}H${stockL}Z`
		: `M${stockL} ${surface}H${stockR}V${stockB}H${stockL}Z`;

	const label = `Side view: a ${toolOk ? fmtLen(tool, units) : "missing"} bit cutting ${depthOk ? fmtLen(depth, units) : "no"} deep${passes ? ` in ${passes} passes` : ""}`;
	return (
		<Frame
			title={title}
			label={label}
			caption={
				!toolOk ? (
					<span style={{ color: ALERT }}>Enter the bit's diameter.</span>
				) : !depthOk ? (
					<span style={{ color: ALERT }}>Set the depth to see the cut.</span>
				) : passes ? (
					<>
						{passes === 1 ? "1 pass" : `${passes} passes`} of {fmtLen(depth / passes, units)}
						{tabOk ? `, tabs ${fmtLen(tabHeight, units)} high` : ""}
						{broken ? ` · cut drawn shortened (${fmtLen(cutW, units)} wide)` : ""}
					</>
				) : null
			}
		>
			<svg viewBox={`0 0 ${W} ${Math.min(H, stockB + 6)}`} className="block w-full" style={{ maxHeight: 220 }}>
				{/* Stock and the groove */}
				<path d={stock} fill={WOOD} stroke={WOOD_EDGE} strokeWidth="1.2" strokeLinejoin="round" />
				{depthOk && broken && (
					<path
						d={`M${cx - 6} ${floor - 8}l4 -6l4 12l4 -6M${cx - 6} ${surface + 4}l4 -6l4 12l4 -6`}
						stroke="currentColor"
						strokeWidth="1"
						fill="none"
						opacity=".6"
					/>
				)}
				{tabOk && (
					<rect x={gl} y={floor - tabHeight * s} width={Math.min((gr - gl) * 0.45, (gr - gl) - bitW * 0.2)} height={tabHeight * s} fill={TAB} stroke={WOOD_EDGE} strokeWidth="1" />
				)}
				{/* One dashed line per pass */}
				{depthOk &&
					levels.map((y, i) => (
						<g key={i}>
							<path d={`M${gl} ${y}H${gr}`} stroke="currentColor" strokeWidth="0.8" strokeDasharray="3 3" opacity=".55" />
							{passes <= 8 && (
								<text x={gr + 4} y={y - 2} fontSize="9" fill="currentColor" opacity=".7">
									{i + 1}
								</text>
							)}
						</g>
					))}
				{/* The outline that was asked for */}
				{depthOk && line && (
					<path d={`M${line === "left" ? gl : gr} ${surface - 10}V${stockB}`} stroke={ALERT} strokeWidth="1.4" strokeDasharray="5 3" />
				)}
				{/* Z0 and safe Z */}
				<text x={stockL - 4} y={surface + 4} textAnchor="end" fontSize="10" fill="currentColor">
					Z0
				</text>
				{ok(safeZ) && (
					<g opacity=".8">
						<path d={`M${stockL} ${surface - 20}H${stockR}`} stroke="currentColor" strokeWidth="0.8" strokeDasharray="6 4" />
						<text x={stockR} y={surface - 23} textAnchor="end" fontSize="10" fill="currentColor">
							safe Z +{fmtLen(safeZ, units)}
						</text>
					</g>
				)}
				{leftLabel && (
					<text x={(stockL + gl) / 2} y={stockB - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill="#5b4220">
						{leftLabel}
					</text>
				)}
				{rightLabel && (
					<text x={(gr + stockR) / 2} y={stockB - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill="#5b4220">
						{rightLabel}
					</text>
				)}
				{/* The bit at full depth */}
				{toolOk && <EndMill cx={bitCx} bottom={depthOk ? floor : surface} width={bitW} top={4} />}
				{toolOk && <DimH x1={bitCx - bitW / 2} x2={bitCx + bitW / 2} y={top - 4} text={`Ø ${fmtLen(tool, units)}`} />}
				{depthOk && <DimV x={gl - 10} y1={surface} y2={floor} text={fmtLen(depth, units)} />}
			</svg>
		</Frame>
	);
};

/**
 * Seen from above: three neighbouring passes of the bit, overlapping by what the stepover leaves.
 */
export const StepoverDiagram = ({ units, tool, stepover }: { units: Units; tool: number; stepover: number }) => {
	const W = 360;
	const H = 130;
	const valid = ok(tool) && ok(stepover) && stepover <= 1;
	const r = 34;
	const step = valid ? 2 * r * stepover : 2 * r * 0.5;
	const cy = 64;
	const cx0 = W / 2 - step;
	const circles = [0, 1, 2].map((i) => cx0 + i * step);
	return (
		<Frame
			title="Stepover, seen from above"
			label={valid ? `Each pass moves ${fmtLen(tool * stepover, units)} sideways` : "Stepover not set"}
			caption={
				valid ? (
					<>
						Each pass moves {fmtLen(tool * stepover, units)} over ({Math.round(stepover * 100)}% of the bit) and overlaps the last by {fmtLen(tool * (1 - stepover), units)}.
					</>
				) : (
					<span style={{ color: ALERT }}>Enter a stepover between 0 and 1 and the bit's diameter.</span>
				)
			}
		>
			<svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ maxHeight: 150 }}>
				{circles.map((x, i) => (
					<circle key={i} cx={x} cy={cy} r={r} fill={BIT} fillOpacity={0.18 + i * 0.12} stroke={BIT_EDGE} strokeWidth="1.2" />
				))}
				{circles.map((x, i) => (
					<circle key={`c${i}`} cx={x} cy={cy} r="2" fill={BIT_EDGE} />
				))}
				{valid && <DimH x1={circles[0]} x2={circles[1]} y={cy + r + 20} text={`${fmtLen(tool * stepover, units)}`} />}
				<path d={`M${circles[2]} ${cy}h${r}`} stroke="currentColor" strokeWidth="1" />
				<text x={circles[2] + r / 2} y={cy - 4} textAnchor="middle" fontSize="10" fill="currentColor">
					r
				</text>
			</svg>
		</Frame>
	);
};

/**
 * A holding tab seen from the side of the cut: the bit runs along the floor and climbs over the tab.
 */
export const TabDiagram = ({
	units,
	length,
	height,
	depth,
	shape,
	tool,
}: {
	units: Units;
	length: number;
	height: number;
	depth: number;
	shape: "trapezoid" | "rectangular";
	tool: number;
}) => {
	const W = 360;
	const H = 150;
	const valid = ok(length) && ok(height) && ok(depth);
	const tooTall = valid && height >= depth;
	const surface = 30;
	const floorY = 120;
	const s = valid ? Math.min((floorY - surface) / depth, 200 / (length + (ok(tool) ? tool : 0) * 2)) : 1;
	const cx = W / 2;
	const half = valid ? (length * s) / 2 : 40;
	const tabTop = valid ? floorY - Math.min(height, depth) * s : floorY - 30;
	const ramp = shape === "trapezoid" ? Math.min(half * 0.8, (floorY - tabTop) * 1) : 0;
	const tab =
		shape === "trapezoid"
			? `M${cx - half} ${floorY}L${cx - half + ramp} ${tabTop}H${cx + half - ramp}L${cx + half} ${floorY}Z`
			: `M${cx - half} ${floorY}V${tabTop}H${cx + half}V${floorY}Z`;
	const depthY = valid ? floorY - depth * s : surface;
	return (
		<Frame
			title="Tab, seen along the cut"
			label={valid ? `A ${shape} tab ${fmtLen(length, units)} long and ${fmtLen(height, units)} high` : "Tab size not set"}
			caption={
				!valid ? (
					<span style={{ color: ALERT }}>Enter the tab length and height, and the cut depth.</span>
				) : tooTall ? (
					<span style={{ color: ALERT }}>The tab is as tall as the cut: nothing would be cut through.</span>
				) : shape === "trapezoid" ? (
					"The bit climbs the sloped sides, so it never stops."
				) : (
					"The bit stops, lifts over the tab and drops back down."
				)
			}
		>
			<svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ maxHeight: 170 }}>
				{/* What is left of the stock around the groove, seen through it */}
				<rect x="20" y={depthY} width={W - 40} height={floorY - depthY + 12} fill={WOOD} fillOpacity=".25" stroke="none" />
				<path d={`M20 ${depthY}H${W - 20}`} stroke={WOOD_EDGE} strokeWidth="1" strokeDasharray="4 3" />
				<text x="22" y={depthY - 4} fontSize="10" fill="currentColor">
					stock top (Z0)
				</text>
				<rect x="20" y={floorY} width={W - 40} height="12" fill={WOOD} stroke={WOOD_EDGE} strokeWidth="1" />
				<text x={W - 22} y={floorY + 9} textAnchor="end" fontSize="9" fill="#5b4220">
					cut through
				</text>
				<path d={tab} fill={tooTall ? ALERT : TAB} fillOpacity={tooTall ? 0.5 : 1} stroke={WOOD_EDGE} strokeWidth="1.2" strokeLinejoin="round" />
				{/* The bit's path over the tab */}
				<path
					d={
						shape === "trapezoid"
							? `M24 ${floorY - 2}H${cx - half}L${cx - half + ramp} ${tabTop - 2}H${cx + half - ramp}L${cx + half} ${floorY - 2}H${W - 24}`
							: `M24 ${floorY - 2}H${cx - half - 4}V${tabTop - 4}H${cx + half + 4}V${floorY - 2}H${W - 24}`
					}
					stroke={BIT_EDGE}
					strokeWidth="1.6"
					fill="none"
					strokeDasharray="5 3"
				/>
				{valid && <DimH x1={cx - half} x2={cx + half} y={floorY + 26} text={fmtLen(length, units)} />}
				{valid && <DimV x={cx + half + 16} y1={tabTop} y2={floorY} text={fmtLen(height, units)} side="right" />}
				{valid && <DimV x={40} y1={depthY} y2={floorY} text={fmtLen(depth, units)} side="right" />}
			</svg>
		</Frame>
	);
};
