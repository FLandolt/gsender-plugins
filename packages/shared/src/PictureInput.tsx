import { type CSSProperties, useEffect, useRef } from "react";

import { type Gray, maskPreview, pictureSize } from "./picture";
import { FilePicker, Hint, lengthLabel, NumberField, OnOff, Segmented } from "./ui";
import type { Units } from "./units";

export type PictureSettings = {
	/** Grey level below which a pixel counts as shape (above it when inverted). */
	threshold: number;
	invert: boolean;
	sizeBy: "width" | "height";
	/** The picture's real size along `sizeBy`, mm. */
	size: number;
};

/** The black-and-white version: black is the shape. Redrawn live as the threshold moves. */
const MaskPreview = ({ gray, threshold, invert }: { gray: Gray; threshold: number; invert: boolean }) => {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const canvas = ref.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;
		const m = maskPreview(gray, threshold, invert);
		canvas.width = m.w;
		canvas.height = m.h;
		ctx.putImageData(new ImageData(m.data as unknown as Uint8ClampedArray<ArrayBuffer>, m.w, m.h), 0, 0);
	}, [gray, threshold, invert]);
	return <canvas ref={ref} className="h-auto max-h-48 w-full rounded-xl border border-gray-200 bg-white object-contain dark:border-slate-700" aria-label="The shape in black" />;
};

/**
 * Picking a picture for a shape: the file, its black-and-white version (black is the shape), the
 * threshold that decides what counts as shape, invert, and the real size.
 */
const PictureInput = ({
	picture,
	onFile,
	value,
	onChange,
	units,
}: {
	picture: { name: string; gray: Gray } | null;
	onFile: (file: File) => void;
	value: PictureSettings;
	onChange: (patch: Partial<PictureSettings>) => void;
	units: Units;
}) => {
	const scale = units === "in" ? 25.4 : 1;
	const size = picture && value.size > 0 ? pictureSize(picture.gray, value.sizeBy, value.size) : null;
	return (
		<>
			<FilePicker label="Choose a picture…" accept="image/*" fileName={picture?.name ?? null} onFile={onFile} />
			{picture && (
				<>
					<MaskPreview gray={picture.gray} threshold={value.threshold} invert={value.invert} />
					<div className="flex flex-col gap-1.5">
						<span className="flex items-baseline justify-between text-[13px] font-medium text-gray-600 dark:text-slate-400">
							<span>Threshold: what counts as shape</span>
							<span className="tabular-nums">{value.threshold}</span>
						</span>
						<input
							type="range"
							min={1}
							max={254}
							value={value.threshold}
							onChange={(e) => onChange({ threshold: e.currentTarget.valueAsNumber })}
							className="touch-range w-full"
							style={{ "--fill": `${((value.threshold - 1) / 253) * 100}%` } as CSSProperties}
							aria-label="Threshold"
						/>
					</div>
				</>
			)}
			<OnOff label="Invert: the light areas are the shape" value={value.invert} onChange={(invert) => onChange({ invert })} />
			<Hint>Black in the preview is the shape. Colour pictures are turned to black and white first.</Hint>
			<div className="grid grid-cols-2 gap-3">
				<Segmented
					label="Set the size by"
					value={value.sizeBy}
					onChange={(sizeBy) => onChange({ sizeBy })}
					options={[
						{ value: "width", label: "Width" },
						{ value: "height", label: "Height" },
					]}
				/>
				<NumberField
					label={value.sizeBy === "width" ? "Picture width (X)" : "Picture height (Y)"}
					suffix={units}
					required
					value={Number((value.size / scale).toFixed(4))}
					onChange={(v) => onChange({ size: v * scale })}
				/>
			</div>
			{size && <Hint>The whole picture is {lengthLabel(size.width, units)} × {lengthLabel(size.height, units)}. Use the same picture, size and zero as in Height Map and the cuts line up.</Hint>}
		</>
	);
};

export default PictureInput;
