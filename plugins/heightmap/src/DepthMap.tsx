import { useEffect, useRef } from "react";

import type { Units } from "@shared/units";

import type { Plan } from "./lib/heightmap";

/** Wood shades from the stock top (light) to the deepest level (dark). */
export const levelColour = (k: number, steps: number): [number, number, number] => {
	const top: [number, number, number] = [240, 222, 190];
	const bottom: [number, number, number] = [92, 58, 24];
	const t = steps > 0 ? k / steps : 0;
	return top.map((a, i) => Math.round(a + (bottom[i] - a) * t)) as [number, number, number];
};

const len = (mm: number, units: Units) => `${Number((units === "in" ? mm / 25.4 : mm).toFixed(units === "in" ? 3 : 2))} ${units}`;

/**
 * The picture seen from above, coloured by the depth each spot will be cut to: light at the stock
 * top, darker for each level down. Spots the bit can't reach as deep as the picture asks (narrower
 * than the bit) are tinted red. A legend lists every level's depth and how much of the picture it covers.
 */
const DepthMap = ({ plan, steps, depths, units, showDepths }: { plan: Plan; steps: number; depths: number[]; units: Units; showDepths: boolean }) => {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const canvas = ref.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;
		const { w, h } = plan.grid;
		canvas.width = w;
		canvas.height = h;
		const img = ctx.createImageData(w, h);
		for (let j = 0; j < h; j += 1)
			for (let i = 0; i < w; i += 1) {
				const cell = j * w + i;
				const k = plan.reached[cell];
				let [r, g, b] = levelColour(k, steps);
				if (k < plan.target[cell]) [r, g, b] = [Math.round(r * 0.5 + 239 * 0.5), Math.round(g * 0.5 + 68 * 0.5), Math.round(b * 0.5 + 68 * 0.5)];
				// The grid has Y up; the canvas has Y down.
				const o = 4 * ((h - 1 - j) * w + i);
				img.data[o] = r;
				img.data[o + 1] = g;
				img.data[o + 2] = b;
				img.data[o + 3] = 255;
			}
		ctx.putImageData(img, 0, 0);
	}, [plan, steps]);

	return (
		<div className="relative flex h-full min-h-40 w-full items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-black p-3 dark:border-slate-800">
			<canvas ref={ref} className="h-full w-full object-contain" style={{ imageRendering: "pixelated" }} aria-label="The picture from above, coloured by cut depth" />
			<ul className="absolute left-3 top-3 m-0 flex max-w-[60%] list-none flex-col gap-1 rounded-[12px] bg-white/80 p-2 text-[12px] shadow-lg ring-1 ring-black/5 backdrop-blur-xl dark:bg-slate-900/80 dark:ring-white/10">
				{depths.map((d, k) => {
					const [r, g, b] = levelColour(k, steps);
					return (
						<li key={k} className="flex items-center gap-2 tabular-nums">
							<span className="h-3.5 w-3.5 shrink-0 rounded-[4px] ring-1 ring-black/10" style={{ background: `rgb(${r} ${g} ${b})` }} />
							<span className="font-medium">{k === 0 ? "Top" : showDepths ? `−${len(d, units)}` : `Level ${k}`}</span>
							<span className="ml-auto pl-2 text-gray-500 dark:text-slate-400">{Math.round(plan.share[k] * 100)}%</span>
						</li>
					);
				})}
				{plan.missed > 0.0005 && (
					<li className="flex items-center gap-2">
						<span className="h-3.5 w-3.5 shrink-0 rounded-[4px] ring-1 ring-black/10" style={{ background: "rgb(239 68 68 / 0.6)" }} />
						<span>Too narrow for the bit</span>
					</li>
				)}
			</ul>
		</div>
	);
};

export default DepthMap;
