import { gcode } from "@sienci/gsender-plugin-sdk";
import { useWorkspaceState } from "@sienci/gsender-plugin-sdk/react";
import { lazy, Suspense, useDeferredValue, useMemo, useState } from "react";

import { matchFeedPreset } from "@shared/feeds";
import { ArcIcon, CircleIcon, ImageIcon, LineIcon, RectIcon, RotateCcw, RotateCw } from "@shared/icons";
import { readPicture, toGray, type Gray } from "@shared/picture";
import PictureInput from "@shared/PictureInput";
import { isStandalone } from "@shared/mockBridge";
import PositionPicker from "@shared/PositionPicker";
import { formatMinutes, jobStats } from "@shared/stats";
import { CutSection, passCount, StepoverDiagram } from "@shared/diagrams";
import PluginLayout, { PreviewPlaceholder, primaryBtn, StatRow, type Step } from "@shared/PluginLayout";
import { POSITION_NAMES } from "@shared/position";
import { BLANK_MESSAGE, hasBlank, Hint, lengthLabel, More, Notices, NumberField, Segmented, SliderField, SpeedPresets, Summary } from "@shared/ui";
import { type Units, unitsScale } from "@shared/units";

import { generateGcode } from "./lib/generate";
import { check, defaultParams, type Params } from "./lib/params";
import { planPicturePocket } from "./lib/picture";

/** three.js + the gviewer engine are large; load them only when first shown. */
const ToolpathView = lazy(() => import("@shared/ToolpathView"));

type WorkspaceState = { units?: string };

const App = () => {
	const workspace = useWorkspaceState<WorkspaceState>();
	const units: Units = workspace?.units === "in" ? "in" : "mm";
	const scale = unitsScale(units);

	const [base, setBase] = useState<Params>(defaultParams);
	const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
	const [busy, setBusy] = useState(false);
	const [picture, setPicture] = useState<{ name: string; gray: Gray } | null>(null);
	const [pictureError, setPictureError] = useState<string | null>(null);
	const onPicture = async (file: File) => {
		try {
			setPicture({ name: file.name, gray: toGray(await readPicture(file)) });
			setPictureError(null);
		} catch {
			setPictureError("Couldn't read that picture. Try a PNG or JPG.");
		}
	};

	// gSender owns the unit system; mirror it rather than letting the user pick.
	const params = useMemo<Params>(() => ({ ...base, units }), [base, units]);
	const problems = useMemo(() => check(params), [params]);
	const isPicture = params.shape === "picture";
	// Planning a picture is the heavy part: while a slider moves, keep the screen responsive and catch up after.
	const settled = useDeferredValue(params);
	const picturePlan = useMemo(
		() =>
			settled.shape === "picture" && picture && settled.size > 0 && settled.toolDiameter > 0 && settled.depth > 0 && settled.stepdown > 0 && settled.stepover > 0 && settled.stepover <= 1
				? planPicturePocket(settled, picture.gray)
				: null,
		[settled, picture],
	);
	const pictureProblems = !isPicture
		? []
		: pictureError
			? [pictureError]
			: !picture
				? ["Choose a picture to pocket."]
				: picturePlan?.empty
					? ["Nothing in the picture counts as shape. Move the threshold or switch Invert."]
					: picturePlan && picturePlan.passes.every((pass) => pass.strokes.length === 0)
						? ["The bit doesn't fit inside the shape. Use a smaller bit."]
						: [];
	const code = useMemo(
		() =>
			problems.errors.length || hasBlank(params) || pictureProblems.length || (isPicture && (!picturePlan || settled !== params))
				? ""
				: generateGcode(params, picturePlan ? { plan: picturePlan, name: picture?.name ?? "picture" } : undefined),
		[params, problems, pictureProblems.length, isPicture, picturePlan, settled, picture],
	);
	const previewCode = useDeferredValue(code);
	const stats = useMemo(() => (code ? jobStats(code) : null), [code]);
	const preset = matchFeedPreset(params);
	const round = params.shape === "circle";

	const update = (patch: Partial<Params>) => setBase((b) => ({ ...b, ...patch }));
	const shown = (mm: number) => Number((mm / scale).toFixed(4));
	const len = (label: string, mm: number, set: (mm: number) => void, required = false) => (
		<NumberField label={label} value={shown(mm)} suffix={units} required={required} onChange={(v) => set(v * scale)} />
	);

	const send = async () => {
		setBusy(true);
		try {
			const name = isPicture
				? `pocket-${(picture?.name ?? "picture").replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.nc`
				: round
				? `pocket-d${Number(params.diameter.toFixed(1))}.nc`
				: `pocket-${Number(params.width.toFixed(1))}x${Number(params.height.toFixed(1))}.nc`;
			await gcode.loadToVisualizer(code, name);
			setStatus({
				ok: true,
				text: isStandalone() ? `Standalone harness — downloaded ${name}` : "Loaded into gSender",
			});
		} catch (err) {
			setStatus({ ok: false, text: err instanceof Error ? err.message : String(err) });
		} finally {
			setBusy(false);
		}
	};

	const blank = hasBlank(params);
	const errors = [...(blank ? [BLANK_MESSAGE] : []), ...pictureProblems, ...problems.errors];
	const pictureWarnings = picturePlan && picturePlan.missed > 0.02 ? [`About ${Math.round(picturePlan.missed * 100)}% of the shape is narrower than the bit and stays uncut. Use a smaller bit.`] : [];
	const bad = (...keys: (keyof Params)[]) => keys.some((k) => !(Number(params[k]) > 0));
	const passes = passCount(params.depth, params.stepdown);
	const pocketWidth = isPicture ? params.toolDiameter * 4 : round ? params.diameter : Math.min(params.width, params.height);

	const steps: Step[] = [
		{
			id: "pocket",
			label: "Pocket",
			hint: "The pocket's shape and size: a rectangle, a circle or a shape from a picture. And where X0 Y0 is; Z0 is the top of the stock.",
			issue: isPicture ? pictureProblems.length > 0 || bad("size") : round ? bad("diameter") : bad("width", "height") || params.cornerRadius > Math.min(params.width, params.height) / 2 + 1e-9,
			content: (
				<>
					<Segmented
						value={params.shape}
						onChange={(shape) => update({ shape })}
						options={[
							{ value: "rectangle", label: "Rectangle", icon: <RectIcon /> },
							{ value: "circle", label: "Circle", icon: <CircleIcon /> },
							{ value: "picture", label: "Picture", icon: <ImageIcon /> },
						]}
					/>
					{isPicture ? (
						<PictureInput picture={picture} onFile={onPicture} value={params} onChange={update} units={units} />
					) : round ? (
						len("Diameter", params.diameter, (v) => update({ diameter: v }), true)
					) : (
						<div className="grid grid-cols-2 gap-3">
							{len("Width (X)", params.width, (v) => update({ width: v }), true)}
							{len("Height (Y)", params.height, (v) => update({ height: v }), true)}
							<div className="col-span-2">
								<SliderField
									label="Corner radius (0 = the bit's radius)"
									suffix={units}
									value={shown(params.cornerRadius)}
									min={0}
									max={shown(Math.min(params.width, params.height) / 2)}
									step={units === "in" ? 0.02 : 0.5}
									onChange={(v) => update({ cornerRadius: Math.max(0, v) * scale })}
								/>
							</div>
						</div>
					)}
					<PositionPicker label="Zero (X0 Y0)" centre value={params.origin} onChange={(origin) => update({ origin })} />
				</>
			),
		},
		{
			id: "bit",
			label: "Bit & depth",
			hint: "The bit's size and how deep the pocket goes.",
			issue: bad("toolDiameter", "depth") || (!isPicture && pocketWidth <= params.toolDiameter + 1e-6),
			content: (
				<>
					<div className="grid grid-cols-2 gap-3">
						{len("Bit diameter", params.toolDiameter, (v) => update({ toolDiameter: v }), true)}
						{len("Depth", params.depth, (v) => update({ depth: v }), true)}
					</div>
					<CutSection units={units} tool={params.toolDiameter} depth={params.depth} stepdown={params.stepdown} safeZ={params.safeZ} width={pocketWidth} />
					<Hint>
						{isPicture
							? "Every level ramps down along its first row, so the bit never plunges straight in."
							: "Every level starts with a spiral ramp down, so the bit never plunges straight in."}
					</Hint>
				</>
			),
		},
		{
			id: "spiral",
			label: isPicture ? "Clearing" : "Spiral",
			hint: isPicture ? "How the shape is cleared: rings from the middle outwards, or adaptive for an even load on the bit." : "Starts in the middle and works outwards, ending on the wall.",
			issue: !(params.stepover > 0 && params.stepover <= 1),
			content: (
				<>
					{!isPicture && (
					<>
					<Segmented
						label="Spiral direction"
						value={params.rotation}
						onChange={(rotation) => update({ rotation })}
						options={[
							{ value: "cw", label: "Clockwise", icon: <RotateCw /> },
							{ value: "ccw", label: "Counter-clockwise", icon: <RotateCcw /> },
						]}
					/>
					<Hint>
						{params.rotation === "cw"
							? "Clockwise is climb milling, usually the better finish inside a pocket."
							: "Counter-clockwise is conventional milling."}
					</Hint>
					</>
					)}
					<NumberField label="Stepover" required suffix="× bit" value={params.stepover} onChange={(stepover) => update({ stepover })} />
					<StepoverDiagram units={units} tool={params.toolDiameter} stepover={params.stepover} />
					{isPicture && (
						<>
					<Segmented
						label="Clearing strategy"
						value={params.strategy}
						onChange={(strategy) => update({ strategy })}
						options={[
							{ value: "rings", label: "Rings" },
							{ value: "adaptive", label: "Adaptive (Experimental)" },
						]}
					/>
					<Hint>
						{params.strategy === "adaptive"
							? "Experimental: not finished yet, so check the preview and air-cut first. Adaptive spreads out from the middle of each area like a ripple, in smooth arcs one stepover apart, so the bit takes about the same amount all the way: no full-width cuts, no spikes in corners. With an even load you can try a smaller stepover and a deeper stepdown."
							: "Rings cut from the middle of each area outwards, one stepover apart, ending on the wall: the shortest path."}
					</Hint>
					{params.strategy === "adaptive" && (
						<>
							<Segmented
								label="Arc direction"
								value={params.climbOnly ? "climb" : "both"}
								onChange={(v) => update({ climbOnly: v === "climb" })}
								options={[
									{ value: "both", label: "Both ways" },
									{ value: "climb", label: "Climb only" },
								]}
							/>
							<Hint>
								{params.climbOnly
									? "Every arc is cut climb, so the force on the bit is always on the same side. The bit travels back after each arc: slower."
									: "Arcs go back and forth: the bit just steps along the wall to the next one. Half the arcs are conventional; the load stays the same. Faster."}
							</Hint>
						</>
					)}
						</>
					)}
				</>
			),
		},
		{
			id: "speed",
			label: "Speed",
			hint: preset ? preset.hint : "Custom values",
			issue: bad("feedrate", "plungeRate", "stepdown") || hasBlank([params.spindleRpm, params.safeZ, params.spindleDwell]),
			content: (
				<>
					<SpeedPresets
						value={preset}
						onPick={(f) => update({ feedrate: f.feedrate, plungeRate: f.plungeRate, spindleRpm: f.spindleRpm, stepdown: f.stepdown })}
					/>
					<div className="grid grid-cols-2 gap-3">
						<NumberField label="Cut feed" required suffix={`${units}/min`} value={shown(params.feedrate)} onChange={(v) => update({ feedrate: v * scale })} />
						<NumberField label="Plunge feed" required suffix={`${units}/min`} value={shown(params.plungeRate)} onChange={(v) => update({ plungeRate: v * scale })} />
						<NumberField label="Spindle" suffix="RPM" value={params.spindleRpm} onChange={(v) => update({ spindleRpm: v })} />
						{len("Stepdown", params.stepdown, (v) => update({ stepdown: v }), true)}
					</div>
					<CutSection units={units} tool={params.toolDiameter} depth={params.depth} stepdown={params.stepdown} safeZ={params.safeZ} width={pocketWidth} title="Passes" />
					<More>
						<div className="grid grid-cols-2 gap-3">
							{len("Safe Z", params.safeZ, (v) => update({ safeZ: v }))}
							<NumberField label="Spindle ramp up" suffix="s" value={params.spindleDwell} onChange={(v) => update({ spindleDwell: v })} />
						</div>
						<Segmented
							label="Circles and corners"
							value={params.useArcs ? "arcs" : "lines"}
							onChange={(v) => update({ useArcs: v === "arcs" })}
							options={[
								{ value: "arcs", label: "Arcs (G2/G3)", icon: <ArcIcon /> },
								{ value: "lines", label: "Lines (G1)", icon: <LineIcon /> },
							]}
						/>
						<Hint>Arcs give smaller files and smoother motion. Pick lines if your controller rejects arcs.</Hint>
					</More>
				</>
			),
		},
		{
			id: "check",
			label: "Check & load",
			hint: "Look over the job, then load it into gSender. Always air-cut first.",
			issue: errors.length > 0,
			content: (
				<>
					<Summary
						rows={[
							["Pocket", isPicture ? (picture?.name ?? "Picture") : round ? `Circle Ø ${lengthLabel(params.diameter, units)}` : `${lengthLabel(params.width, units)} × ${lengthLabel(params.height, units)}${params.cornerRadius > 0 ? `, r ${lengthLabel(params.cornerRadius, units)}` : ""}`],
							["Bit", `Ø ${lengthLabel(params.toolDiameter, units)}`],
							["Depth", `${lengthLabel(params.depth, units)}${passes ? ` in ${passes} levels` : ""}`],
							isPicture ? ["Clearing", `${params.strategy === "adaptive" ? "Adaptive (Experimental, even load)" : "Rings, inside out"}, stepover ${Math.round(params.stepover * 100)}%`] : ["Spiral", `${params.rotation === "cw" ? "Clockwise" : "Counter-clockwise"}, stepover ${Math.round(params.stepover * 100)}%`],
							["Zero", POSITION_NAMES[params.origin]],
							["Feed / plunge", `${shown(params.feedrate)} / ${shown(params.plungeRate)} ${units}/min`],
							["Spindle", `${params.spindleRpm} RPM`],
							["Est. time", stats ? formatMinutes(stats.minutes) : "–"],
						]}
					/>
					{errors.length > 0 && <Hint>Fix the items listed at the bottom (steps with a red dot) before loading.</Hint>}
				</>
			),
		},
	];

	return (
		<PluginLayout
			title="Pocket Cutout"
			intro="Clears a rectangular, round or picture-shaped pocket. Z0 = top of stock."
			steps={steps}
			code={code}
			status={status}
			stats={
				<StatRow
					items={[
						["Pocket", isPicture ? (picturePlan ? `${lengthLabel(picturePlan.width, units).replace(` ${units}`, "")} × ${lengthLabel(picturePlan.height, units)}` : "–") : round ? `Ø ${shown(params.diameter)} ${units}` : `${shown(params.width)} × ${shown(params.height)} ${units}`],
						["Est. time", stats ? formatMinutes(stats.minutes) : "–"],
						["G-code lines", stats ? stats.lines.toLocaleString() : "–"],
					]}
				/>
			}
			preview={
				previewCode ? (
					<Suspense fallback={<div className="h-full rounded-xl border border-gray-200 bg-black dark:border-slate-800" />}>
						<ToolpathView gcode={previewCode} units={units} toolDiameter={params.toolDiameter} />
					</Suspense>
				) : (
					<PreviewPlaceholder />
				)
			}
			notices={<Notices errors={errors} warnings={[...problems.warnings, ...pictureWarnings]} />}
			actions={
				<button type="button" onClick={send} disabled={busy || !code} className={primaryBtn}>
					{busy ? "Loading…" : "Load to gSender"}
				</button>
			}
		/>
	);
};

export default App;
