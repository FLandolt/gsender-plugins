import {
	GCodeVisualizer,
	type GCodeViewerHandle,
} from "@sienci/gsender-plugin-sdk/viewer";
import { useEffect, useRef, useState } from "react";

import { MM_PER_INCH, type Units } from "./units";

type Props = {
	gcode: string;
	units: Units;
	/** Tool diameter in mm; sizes the bit marker in the preview. */
	toolDiameter: number;
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
 */
const ToolpathView = ({ gcode, units, toolDiameter }: Props) => {
	const viewerRef = useRef<GCodeViewerHandle>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const viewer = viewerRef.current;
		if (!viewer || !gcode) return;
		let cancelled = false;
		setError(null);
		viewer
			.loadFromText(gcode)
			.then(() => {
				if (!cancelled) viewer.focusToModel();
			})
			.catch((err: unknown) => {
				if (!cancelled) setError(err instanceof Error ? err.message : String(err));
			});
		return () => {
			cancelled = true;
		};
	}, [gcode]);

	useEffect(() => {
		viewerRef.current?.setOptions({ units });
	}, [units]);

	useEffect(() => {
		// The viewer draws in G-code units, which are inches when the job is in inches.
		const diameter = units === "in" ? toolDiameter / MM_PER_INCH : toolDiameter;
		const size = diameter * DRILL_SIZE_PER_DIAMETER;
		const viewer = viewerRef.current;
		if (viewer && size > 0) viewer.setOptions({ bit: { ...viewer.getOptions().bit, size } });
	}, [toolDiameter, units]);

	return (
		<div className="relative h-full min-h-72 w-full overflow-hidden rounded-lg bg-slate-950">
			<GCodeVisualizer
				ref={viewerRef}
				id="plugin-preview"
				style={{ width: "100%", height: "100%" }}
			/>
			{error ? (
				<p className="absolute inset-x-0 bottom-0 bg-red-900/80 p-2 text-xs text-red-100">
					Preview failed: {error}
				</p>
			) : null}
		</div>
	);
};

export default ToolpathView;
