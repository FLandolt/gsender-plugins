import type { Units } from "@shared/units";

import { levelColour } from "./DepthMap";

const len = (mm: number, units: Units) => `${Number((units === "in" ? mm / 25.4 : mm).toFixed(units === "in" ? 3 : 2))} ${units}`;

/**
 * The levels seen from the side, as steps down into the stock: one tread per level, each labelled
 * with its depth. Redraws as the steps and depth change.
 */
const Terraces = ({ steps, depth, units, invert }: { steps: number; depth: number; units: Units; invert: boolean }) => {
	const W = 360;
	const H = 150;
	const valid = Number.isInteger(steps) && steps >= 1 && depth > 0;
	const n = valid ? steps : 2;
	const left = 30, right = W - 14, top = 30, bottom = H - 20;
	const tread = (right - left) / (n + 1);
	const yAt = (k: number) => top + ((bottom - 14 - top) * k) / n;
	let profile = `M${left} ${bottom}V${yAt(0)}`;
	for (let k = 0; k <= n; k += 1) {
		profile += `H${left + tread * (k + 1)}`;
		if (k < n) profile += `V${yAt(k + 1)}`;
	}
	profile += `V${bottom}Z`;
	return (
		<figure className="dot-grid m-0 rounded-xl border border-gray-200 bg-gray-50 p-3 text-gray-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
			<figcaption className="mb-1 px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-gray-500 dark:text-slate-400">The levels, seen from the side</figcaption>
			<svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ maxHeight: 180 }} role="img" aria-label={valid ? `${n + 1} levels down to ${len(depth, units)}` : "Levels not set"}>
				{Array.from({ length: n + 1 }, (_, k) => {
					const [r, g, b] = levelColour(k, n);
					return <rect key={k} x={left + tread * k} y={yAt(k)} width={tread} height={bottom - yAt(k)} fill={`rgb(${r} ${g} ${b})`} />;
				})}
				<path d={profile} fill="none" stroke="#8b6b3d" strokeWidth="1.4" strokeLinejoin="round" />
				<text x={left - 4} y={yAt(0) + 4} textAnchor="end" fontSize="10" fill="currentColor">
					Z0
				</text>
				{Array.from({ length: n + 1 }, (_, k) => (
					<text key={k} x={left + tread * (k + 0.5)} y={yAt(k) - 5} textAnchor="middle" fontSize="11" fill="currentColor">
						{k === 0 ? "top" : valid ? `−${len((depth * k) / n, units)}` : `level ${k}`}
					</text>
				))}
			</svg>
			<p className="m-0 mt-1 px-1 text-[13px] text-gray-600 dark:text-slate-400">
				{valid ? (
					<>
						{n} {n === 1 ? "step" : "steps"} of {len(depth / n, units)}: the {invert ? "darkest" : "lightest"} parts of the picture stay at the top, the {invert ? "lightest" : "darkest"} go to −{len(depth, units)}.
					</>
				) : (
					<span style={{ color: "#dc2626" }}>Set the depth to see the levels.</span>
				)}
			</p>
		</figure>
	);
};

export default Terraces;
