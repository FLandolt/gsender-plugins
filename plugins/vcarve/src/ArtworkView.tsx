import { useMemo } from "react";

import type { Bounds, Shape } from "./lib/geom";

/** The shapes that will be carved, drawn flat, with holes left open. */
/** `marks` are circled in red: the places the artwork is too wide for the bit. */
const ArtworkView = ({ shapes, bounds, label, marks = [] }: { shapes: Shape[]; bounds: Bounds; label: string; marks?: { x: number; y: number; r: number }[] }) => {
	const d = useMemo(
		() =>
			shapes
				.flatMap((s) => [s.outer, ...s.holes])
				// SVG's y runs down, the artwork's runs up.
				.map((r) => `M${r.map((p) => `${p.x.toFixed(2)} ${(-p.y).toFixed(2)}`).join("L")}Z`)
				.join(""),
		[shapes],
	);
	const w = Math.max(bounds.maxX - bounds.minX, 1e-6);
	const h = Math.max(bounds.maxY - bounds.minY, 1e-6);
	const pad = Math.max(w, h) * 0.06;
	return (
		<div className="relative h-full min-h-72 w-full overflow-hidden rounded-lg bg-slate-950">
			{shapes.length ? (
				<svg
					viewBox={`${bounds.minX - pad} ${-bounds.maxY - pad} ${w + 2 * pad} ${h + 2 * pad}`}
					className="absolute inset-0 h-full w-full"
					role="img"
					aria-label={label}
				>
					<path d={d} fillRule="evenodd" fill="#93c5fd" fillOpacity="0.9" stroke="#bfdbfe" strokeWidth={Math.max(w, h) / 600} />
					{marks.map((m, i) => (
						<circle key={i} cx={m.x} cy={-m.y} r={Math.max(m.r, Math.max(w, h) / 80)} fill="#ef4444" fillOpacity="0.25" stroke="#ef4444" strokeWidth={Math.max(w, h) / 250} />
					))}
				</svg>
			) : (
				<p className="absolute inset-0 m-0 flex items-center justify-center p-6 text-center text-sm text-slate-400">
					The artwork will show here.
				</p>
			)}
		</div>
	);
};

export default ArtworkView;
