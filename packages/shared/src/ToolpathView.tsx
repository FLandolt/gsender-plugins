import {
	GCodeVisualizer,
	type GCodeViewerHandle,
} from "@sienci/gsender-plugin-sdk/viewer";
import { useEffect, useRef, useState } from "react";

import { Segmented } from "./ui";
import { MM_PER_INCH, type Units } from "./units";

type Props = {
	gcode: string;
	units: Units;
	/** Tool diameter in mm; sizes the bit marker in the preview. */
	toolDiameter: number;
	/**
	 * Offer the Material view. Its simulation models a flat cylindrical cutter, so leave it off for
	 * tools that aren't one, such as a V-bit.
	 */
	materialView?: boolean;
	/** Draw the bit in the preview. Turn it off where it would hide a small toolpath. */
	showBit?: boolean;
};

/**
 * The viewer's drill marker is scaled by its overall length (1.6 × `bit.size`), not
 * its width. The model is 6.35 wide and 68.67 long, so this factor makes the drawn
 * bit exactly as wide as the tool.
 */
const DRILL_SIZE_PER_DIAMETER = 68.67 / (1.6 * 6.35);

/**
 * 3D toolpath preview using the same engine as gSender's own visualizer.
 * The viewer is imperative: it is driven through its ref rather than by props.
 *
 * "Material" runs the engine's cut simulation to the end of the program, showing what
 * is left of a block of stock: anything the bit did not reach stays standing.
 */
const ToolpathView = ({ gcode, units, toolDiameter, materialView = true, showBit = true }: Props) => {
	const viewerRef = useRef<GCodeViewerHandle>(null);
	const [error, setError] = useState<string | null>(null);
	const [view, setView] = useState<"toolpath" | "material">("toolpath");
	// The viewer draws in G-code units, which are inches when the job is in inches.
	const diameter = units === "in" ? toolDiameter / MM_PER_INCH : toolDiameter;

	useEffect(() => {
		const viewer = viewerRef.current;
		if (!viewer || !gcode) return;
		let cancelled = false;
		setError(null);
		const material = materialView && view === "material";
		// The simulation is built while the program loads, so set it up first.
		viewer.setOptions({
			mode: { laser: false, sim3d: material },
			sim3d: { toolDiameter: diameter, resolution: 320, showToolpath: false, erosionPasses: 2 },
		});
		viewer
			.loadFromText(gcode)
			.then(() => {
				if (cancelled) return;
				// Play the whole program: the end state is what is left.
				if (material) viewer.seekToLine(Number.MAX_SAFE_INTEGER);
				viewer.focusToModel();
			})
			.catch((err: unknown) => {
				if (!cancelled) setError(err instanceof Error ? err.message : String(err));
			});
		return () => {
			cancelled = true;
		};
	}, [gcode, view, diameter, materialView]);

	useEffect(() => {
		viewerRef.current?.setOptions({ units });
	}, [units]);

	useEffect(() => {
		const size = diameter * DRILL_SIZE_PER_DIAMETER;
		const viewer = viewerRef.current;
		if (viewer && size > 0) viewer.setOptions({ bit: { ...viewer.getOptions().bit, size, enabled: showBit } });
	}, [diameter, showBit]);

	return (
		<div className="relative h-full min-h-72 w-full overflow-hidden rounded-lg bg-slate-950">
			<GCodeVisualizer
				ref={viewerRef}
				id="plugin-preview"
				style={{ width: "100%", height: "100%" }}
			/>
			{materialView && (
				<div className="absolute left-2 top-2 z-10 w-52 opacity-95">
					<Segmented
						value={view}
						onChange={setView}
						title="Material shows what is left of a block of stock after the whole program has run"
						options={[
							{ value: "toolpath", label: "Toolpath" },
							{ value: "material", label: "Material" },
						]}
					/>
				</div>
			)}
			{error ? (
				<p className="absolute inset-x-0 bottom-0 bg-red-900/80 p-2 text-xs text-red-100">
					Preview failed: {error}
				</p>
			) : null}
		</div>
	);
};

export default ToolpathView;
