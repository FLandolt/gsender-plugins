import { lengthText } from "./lib/bit";
import { bitDiagram } from "./lib/diagram";
import type { CheckedBit } from "./lib/params";
import type { Units } from "@shared/units";

const W = 460;
const H = 210;

/**
 * The bit drawn from what was typed (its side view, its angle and its deepest cut) beside the groove it makes
 * at the maximum depth, to the same scale. Nothing is drawn until the bit values are valid: it never
 * shows a bit that wasn't entered.
 */
const BitDiagram = ({ bit, maxDepth, tooDeep, units }: { bit: CheckedBit | null; maxDepth: number | null; tooDeep: boolean; units: Units }) => {
	if (!bit) {
		return (
			<p className="m-0 mt-3 rounded-lg bg-gray-100 p-3 text-center text-xs text-gray-500 dark:bg-slate-800 dark:text-slate-400">
				Fill in the angle, diameter and tip to see the bit.
			</p>
		);
	}
	const d = bitDiagram(bit, maxDepth);
	const len = (mm: number) => lengthText(mm, units);
	const tan = Math.tan((bit.angle * Math.PI) / 360);

	// One scale for both pictures: the cone has to fit in the height, and the bit in its half of the width.
	const top = 34, bottom = 52; // room above for the diameter, below for captions
	const shank = d.coneHeight * 0.3;
	const s = Math.min((H - top - bottom) / (d.coneHeight + shank), 110 / (2 * d.topHalfWidth));
	const bx = 95; // the bit's axis
	const tipY = top + (d.coneHeight + shank) * s; // y of the tip, the bottom of the bit
	const yAt = (up: number) => tipY - up * s; // height above the tip → y in the picture
	const half = (up: number) => (bit.tip / 2 + up * tan) * s;
	const coneTop = yAt(d.coneHeight);
	const topHalf = half(d.coneHeight);

	const poly = [
		[bx - (bit.tip / 2) * s, yAt(0)],
		[bx + (bit.tip / 2) * s, yAt(0)],
		[bx + topHalf, coneTop],
		[bx - topHalf, coneTop],
	];
	const shankHalf = Math.min(topHalf * 0.5, 14);
	const dimY = 16; // the line that carries the width across the top

	// The groove: stock whose surface is the top of the notch, with the bit's tip at the bottom.
	const gx = 320;
	const g = d.groove;
	const surfaceY = tipY - (g ? g.depth : d.coneHeight * 0.5) * s;
	const gw = g ? (g.surfaceWidth / 2) * s : 0;
	const stockHalf = Math.max(gw * 1.3, 50);
	const stockBottom = tipY + 14;
	const ink = { stroke: "currentColor", strokeWidth: 1, fill: "none" } as const;

	return (
		<div className="mt-3 text-gray-700 dark:text-slate-300">
			<svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`A ${bit.angle} degree V-bit, ${len(bit.diameter)} wide, and the groove it cuts at the depth you set`}>
				{/* The bit: shank above, cone below */}
				<rect x={bx - shankHalf} y={coneTop - shank * s} width={2 * shankHalf} height={shank * s} fill="#cbd5e1" stroke="#94a3b8" strokeWidth="1" />
				<polygon points={poly.map((p) => p.join(",")).join(" ")} fill="#60a5fa" stroke="#2563eb" strokeWidth="1.2" />
				{/* The width across the top of the cone, carried up past the shank */}
				<g {...ink} strokeDasharray="2 2" opacity="0.6">
					<path d={`M${bx - topHalf} ${coneTop}V${dimY - 4}M${bx + topHalf} ${coneTop}V${dimY - 4}`} />
				</g>
				<g {...ink}>
					<path d={`M${bx - topHalf} ${dimY}H${bx + topHalf}M${bx - topHalf} ${dimY - 4}v8M${bx + topHalf} ${dimY - 4}v8`} />
				</g>
				<text x={bx} y={dimY - 7} textAnchor="middle" fontSize="11" fill="currentColor">
					{d.limitedBy === "cutting length" ? `${len(2 * d.topHalfWidth)} wide` : `Ø ${len(bit.diameter)}`}
				</text>
				{/* The deepest cut, up the side */}
				<g {...ink}>
					<path d={`M${bx + topHalf + 12} ${yAt(0)}V${coneTop}M${bx + topHalf + 8} ${yAt(0)}h8M${bx + topHalf + 8} ${coneTop}h8`} />
				</g>
				<text x={bx + topHalf + 18} y={(yAt(0) + coneTop) / 2} fontSize="11" fill="currentColor" dominantBaseline="middle">
					<tspan x={bx + topHalf + 18} dy="-0.4em">
						{d.limitedBy === "cutting length" ? "cutting length" : "deepest cut"}
					</tspan>
					<tspan x={bx + topHalf + 18} dy="1.2em" fontWeight="600">
						{len(d.coneHeight)}
					</tspan>
				</text>
				<text x={bx} y={tipY + 16} textAnchor="middle" fontSize="11" fill="currentColor">
					{`${bit.angle}° · ${bit.tip > 0 ? `tip ${len(bit.tip)}` : "sharp tip"}`}
				</text>

				{/* The groove at the maximum depth */}
				<path
					d={
						g
							? `M${gx - stockHalf} ${surfaceY}H${gx - gw}L${gx - (g.floorWidth / 2) * s} ${tipY}H${gx + (g.floorWidth / 2) * s}L${gx + gw} ${surfaceY}H${gx + stockHalf}V${stockBottom}H${gx - stockHalf}Z`
							: `M${gx - stockHalf} ${surfaceY}H${gx + stockHalf}V${stockBottom}H${gx - stockHalf}Z`
					}
					fill={tooDeep ? "#e5e7eb" : "#d6b88a"}
					stroke={tooDeep ? "#9ca3af" : "#8b6b3d"}
					strokeWidth="1.2"
				/>
				{g && (
					<>
						<g {...ink}>
							<path d={`M${gx - gw} ${surfaceY - 8}H${gx + gw}M${gx - gw} ${surfaceY - 12}v8M${gx + gw} ${surfaceY - 12}v8`} />
							<path d={`M${gx + stockHalf + 6} ${surfaceY}V${tipY}M${gx + stockHalf + 2} ${surfaceY}h8M${gx + stockHalf + 2} ${tipY}h8`} />
						</g>
						<text x={gx} y={surfaceY - 14} textAnchor="middle" fontSize="11" fill="currentColor">
							{len(g.surfaceWidth)} wide
						</text>
						<text x={gx + stockHalf + 12} y={(surfaceY + tipY) / 2} fontSize="11" fill="currentColor" dominantBaseline="middle">
							{len(g.depth)}
						</text>
					</>
				)}
				<text x={gx} y={H - 22} textAnchor="middle" fontSize="11" fill={tooDeep ? "#b91c1c" : "currentColor"}>
					{g ? "groove at the maximum depth" : tooDeep ? "that depth is more than this bit can cut" : ""}
				</text>
			</svg>
		</div>
	);
};

export default BitDiagram;
