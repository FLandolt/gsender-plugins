import { gcode } from "@sienci/gsender-plugin-sdk";
import { useWorkspaceState } from "@sienci/gsender-plugin-sdk/react";
import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { CutSection, StepoverDiagram } from "@shared/diagrams";
import { matchFeedPreset } from "@shared/feeds";
import { isStandalone } from "@shared/mockBridge";
import PluginLayout, { PreviewPlaceholder, primaryBtn, StatRow, type Status, type Step } from "@shared/PluginLayout";
import PositionPicker from "@shared/PositionPicker";
import { POSITION_NAMES } from "@shared/position";
import { formatMinutes, jobStats } from "@shared/stats";
import { BLANK_MESSAGE, FilePicker, hasBlank, Hint, lengthLabel, More, Notices, NumberField, OnOff, Segmented, SliderField, SpeedPresets, Stepper, Summary } from "@shared/ui";
import { type Units, unitsScale } from "@shared/units";

import DepthMap from "./DepthMap";
import { generateGcode } from "./lib/generate";
import { pictureSize, planCut, shrink, toGray, type Gray } from "./lib/heightmap";
import { readPicture } from "@shared/picture";
import { check, defaultParams, levelDepths, MAX_STEPS, type Params } from "./lib/params";
import Terraces from "./Terraces";

/** three.js + the gviewer engine are large; load them only when first shown. */
const ToolpathView = lazy(() => import("@shared/ToolpathView"));

type WorkspaceState = { units?: string };

/** The picture in black and white, as the plugin sees it (flipped when inverted). */
const GreyPreview = ({ gray, invert }: { gray: Gray; invert: boolean }) => {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const canvas = ref.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;
		const small = shrink(gray, 480);
		canvas.width = small.w;
		canvas.height = small.h;
		const img = ctx.createImageData(small.w, small.h);
		for (let i = 0; i < small.v.length; i += 1) {
			const v = invert ? 255 - small.v[i] : small.v[i];
			img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = v;
			img.data[4 * i + 3] = 255;
		}
		ctx.putImageData(img, 0, 0);
	}, [gray, invert]);
	return <canvas ref={ref} className="h-auto max-h-48 w-full rounded-xl border border-gray-200 bg-white object-contain dark:border-slate-700" aria-label="The picture in black and white" />;
};

const App = () => {
	const workspace = useWorkspaceState<WorkspaceState>();
	const units: Units = workspace?.units === "in" ? "in" : "mm";
	const scale = unitsScale(units);

	const [base, setBase] = useState<Params>(defaultParams);
	const params = useMemo<Params>(() => ({ ...base, units }), [base, units]);
	const update = (patch: Partial<Params>) => setBase((b) => ({ ...b, ...patch }));
	const shown = (mm: number) => Number((mm / scale).toFixed(4));
	const len = (label: string, mm: number, set: (mm: number) => void, required = false) => (
		<NumberField label={label} value={shown(mm)} suffix={units} required={required} onChange={(v) => set(v * scale)} />
	);

	const [picture, setPicture] = useState<{ name: string; gray: Gray } | null>(null);
	const [pictureError, setPictureError] = useState<string | null>(null);
	const [view, setView] = useState<"map" | "toolpath">("map");
	const [status, setStatus] = useState<Status>(null);
	const [busy, setBusy] = useState(false);

	const onPicture = async (file: File) => {
		try {
			const raw = await readPicture(file);
			setPicture({ name: file.name, gray: toGray(raw) });
			setPictureError(null);
		} catch {
			setPictureError("Couldn't read that picture. Try a PNG or JPG.");
		}
	};

	const problems = useMemo(() => check(params), [params]);
	const blank = hasBlank(params);
	const size = picture && params.size > 0 ? pictureSize(picture.gray, params.sizeBy, params.size) : null;

	// Planning is the heavy part: while a slider is dragged, keep the screen responsive and catch up after.
	const settled = useDeferredValue(params);
	const planOk =
		picture !== null &&
		settled.size > 0 &&
		Number.isInteger(settled.steps) &&
		settled.steps >= 1 &&
		settled.steps <= MAX_STEPS &&
		settled.toolDiameter > 0 &&
		settled.stepover > 0 &&
		settled.stepover <= 1 &&
		settled.stepdown > 0 &&
		settled.smoothing >= 0;
	const plan = useMemo(() => {
		if (!planOk || !picture) return null;
		const s = pictureSize(picture.gray, settled.sizeBy, settled.size);
		// Without a depth yet, plan with a stand-in so the depth map can still show the levels.
		const depth = settled.depth > 0 ? settled.depth : settled.steps;
		return planCut(picture.gray, { ...settled, ...s, depth, stepdown: settled.depth > 0 ? settled.stepdown : depth });
	}, [planOk, picture, settled.sizeBy, settled.size, settled.steps, settled.depth, settled.invert, settled.smoothing, settled.toolDiameter, settled.stepover, settled.stepdown, settled.strategy]);

	const fresh = settled === params;
	const code = useMemo(
		() => (plan && fresh && problems.errors.length === 0 && !blank && params.depth > 0 ? generateGcode(params, plan, picture?.name ?? "picture") : ""),
		[plan, fresh, problems, blank, params, picture],
	);
	const previewCode = useDeferredValue(code);
	const stats = useMemo(() => (code ? jobStats(code) : null), [code]);
	const preset = matchFeedPreset(params);
	const depths = levelDepths(params.depth > 0 ? params.depth : 0, Number.isInteger(params.steps) && params.steps >= 1 ? params.steps : 1);

	const errors = [
		...(blank ? [BLANK_MESSAGE] : []),
		...(picture ? [] : ["Choose a picture to carve."]),
		...(pictureError ? [pictureError] : []),
		...problems.errors,
	];
	const warnings = [...problems.warnings];
	if (plan && plan.missed > 0.01) warnings.push(`About ${Math.round(plan.missed * 100)}% of the picture is narrower than the bit and stays higher (red in the depth map). Use a smaller bit or more smoothing.`);
	if (plan && fresh && params.depth > 0 && plan.passes.every((p) => p.strokes.length === 0))
		warnings.push("The bit doesn't fit anywhere below the top: nothing would be cut. Use a smaller bit, fewer steps or a bigger size.");

	const send = async () => {
		setBusy(true);
		try {
			const stem = (picture?.name ?? "picture").replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "picture";
			const name = `heightmap-${stem}.nc`;
			await gcode.loadToVisualizer(code, name);
			setStatus({ ok: true, text: isStandalone() ? `Standalone harness — downloaded ${name}` : "Loaded into gSender" });
		} catch (err) {
			setStatus({ ok: false, text: err instanceof Error ? err.message : String(err) });
		} finally {
			setBusy(false);
		}
	};

	const passes = plan && params.depth > 0 ? plan.passes.length : 0;

	const steps: Step[] = [
		{
			id: "picture",
			label: "Picture",
			hint: "Any picture works, colour too: it is turned to black and white. Its darkest parts go deepest, its lightest stay at the top.",
			issue: !picture || !(params.size > 0) || pictureError !== null,
			content: (
				<>
					<FilePicker label="Choose a picture…" accept="image/*" fileName={picture?.name ?? null} onFile={onPicture} />
					{picture && <GreyPreview gray={picture.gray} invert={params.invert} />}
					<OnOff label="Invert: light areas go deep instead of dark" value={params.invert} onChange={(invert) => update({ invert })} />
					<Hint>For a height map or satellite elevation picture, where light means high, leave Invert off.</Hint>
					<div className="grid grid-cols-2 gap-3">
						<Segmented
							label="Set the size by"
							value={params.sizeBy}
							onChange={(sizeBy) => update({ sizeBy })}
							options={[
								{ value: "width", label: "Width" },
								{ value: "height", label: "Height" },
							]}
						/>
						{len(params.sizeBy === "width" ? "Width (X)" : "Height (Y)", params.size, (v) => update({ size: v }), true)}
					</div>
					{size && <Hint>The carving will be {lengthLabel(size.width, units)} × {lengthLabel(size.height, units)}.</Hint>}
					<SliderField
						label="Smoothing"
						suffix={units}
						value={shown(params.smoothing)}
						min={0}
						max={shown(10)}
						step={units === "in" ? 0.02 : 0.5}
						onChange={(v) => update({ smoothing: Math.max(0, v) * scale })}
					/>
					<Hint>Removes specks and smooths ragged edges without blurring: sharp edges stay one straight wall down, and a black-and-white picture keeps just two levels.</Hint>
					<PositionPicker label="Zero (X0 Y0)" centre value={params.origin} onChange={(origin) => update({ origin })} />
				</>
			),
		},
		{
			id: "levels",
			label: "Levels & depth",
			hint: "How many steps down, and how deep the deepest one goes. Z0 is the top of the stock.",
			issue: !(params.depth > 0) || !(Number.isInteger(params.steps) && params.steps >= 1 && params.steps <= MAX_STEPS),
			content: (
				<>
					<Stepper label="Steps down" value={params.steps} min={1} max={MAX_STEPS} onChange={(steps) => update({ steps })} />
					<Hint>
						{Number.isInteger(params.steps) && params.steps >= 1
							? `${params.steps} ${params.steps === 1 ? "step" : "steps"} = ${params.steps + 1} levels: top, ${params.steps > 1 ? `${params.steps - 1} in between, ` : ""}bottom.`
							: "2 steps = top, middle and bottom."}
					</Hint>
					{len("Depth of the deepest level", params.depth, (v) => update({ depth: v }), true)}
					<Terraces steps={params.steps} depth={params.depth} units={units} invert={params.invert} />
					<Hint>Switch the preview to Depth map to see which parts of the picture end up at which level.</Hint>
				</>
			),
		},
		{
			id: "bit",
			label: "Bit",
			hint: "The bit's size and how far apart the passes are. A smaller bit gets into finer detail.",
			issue: !(params.toolDiameter > 0) || !(params.stepover > 0 && params.stepover <= 1),
			content: (
				<>
					{len("Bit diameter", params.toolDiameter, (v) => update({ toolDiameter: v }), true)}
					<NumberField label="Stepover" required suffix="× bit" value={params.stepover} onChange={(stepover) => update({ stepover })} />
					<StepoverDiagram units={units} tool={params.toolDiameter} stepover={params.stepover} />
					<Segmented
						label="Clearing strategy"
						value={params.strategy}
						onChange={(strategy) => update({ strategy })}
						options={[
							{ value: "rings", label: "Rings" },
							{ value: "adaptive", label: "Adaptive" },
						]}
					/>
					<Hint>
						{params.strategy === "adaptive"
							? "Adaptive keeps the load on the bit about even: it never buries the bit in a full-width cut, so corners don't spike the radial force. The path is a little longer. With an even load you can try a smaller stepover and a deeper stepdown."
							: "Rings cut from the middle of each area outwards, one stepover apart, ending on the wall: the shortest path."}
					</Hint>
					<Hint>Either way the bit never cuts into a higher level, and the last pass runs along the walls for a clean edge.</Hint>
				</>
			),
		},
		{
			id: "speed",
			label: "Speed",
			hint: preset ? preset.hint : "Custom values",
			issue: !(params.feedrate > 0) || !(params.plungeRate > 0) || !(params.stepdown > 0) || !(params.safeZ > 0) || hasBlank([params.spindleRpm, params.spindleDwell]),
			content: (
				<>
					<SpeedPresets value={preset} onPick={(f) => update({ feedrate: f.feedrate, plungeRate: f.plungeRate, spindleRpm: f.spindleRpm, stepdown: f.stepdown })} />
					<div className="grid grid-cols-2 gap-3">
						<NumberField label="Cut feed" required suffix={`${units}/min`} value={shown(params.feedrate)} onChange={(v) => update({ feedrate: v * scale })} />
						<NumberField label="Plunge feed" required suffix={`${units}/min`} value={shown(params.plungeRate)} onChange={(v) => update({ plungeRate: v * scale })} />
						<NumberField label="Spindle" suffix="RPM" value={params.spindleRpm} onChange={(v) => update({ spindleRpm: v })} />
						{len("Stepdown", params.stepdown, (v) => update({ stepdown: v }), true)}
					</div>
					<Hint>A step deeper than the stepdown is cut in several passes.</Hint>
					<CutSection units={units} tool={params.toolDiameter} depth={params.depth} stepdown={params.stepdown} safeZ={params.safeZ} width={params.toolDiameter * 4} title="Passes to the deepest level" />
					<More>
						<div className="grid grid-cols-2 gap-3">
							{len("Safe Z", params.safeZ, (v) => update({ safeZ: v }), true)}
							<NumberField label="Spindle ramp up" suffix="s" value={params.spindleDwell} onChange={(v) => update({ spindleDwell: v })} />
						</div>
					</More>
				</>
			),
		},
		{
			id: "check",
			label: "Check & load",
			hint: "Look over the job and the depth map, then load it into gSender. Always air-cut first.",
			issue: errors.length > 0,
			content: (
				<>
					<Summary
						rows={[
							["Picture", picture ? `${picture.name}${params.invert ? " (inverted)" : ""}` : "–"],
							["Size", size ? `${lengthLabel(size.width, units)} × ${lengthLabel(size.height, units)}` : "–"],
							["Levels", params.depth > 0 ? depths.map((d, k) => (k === 0 ? "top" : `−${lengthLabel(d, units)}`)).join(" / ") : "–"],
							["Bit", `Ø ${lengthLabel(params.toolDiameter, units)}, stepover ${Number.isFinite(params.stepover) ? Math.round(params.stepover * 100) : "–"}%`],
							["Clearing", params.strategy === "adaptive" ? "Adaptive (even load)" : "Rings, inside out"],
							["Passes", passes ? `${passes} (at most ${lengthLabel(params.stepdown, units)} each)` : "–"],
							["Zero", POSITION_NAMES[params.origin]],
							["Feed / plunge", `${shown(params.feedrate)} / ${shown(params.plungeRate)} ${units}/min`],
							["Spindle", `${params.spindleRpm} RPM`],
							["Est. time", stats ? formatMinutes(stats.minutes) : "–"],
						]}
					/>
					{errors.length > 0 && <Hint>Fix the items listed in the corner (steps with a red dot) before loading.</Hint>}
				</>
			),
		},
	];

	const showMap = view === "map" || !previewCode;

	return (
		<PluginLayout
			title="Height Map"
			intro="Carves a picture or height map into stepped levels. Z0 = top of stock."
			steps={steps}
			code={code}
			status={status}
			stats={
				<StatRow
					items={[
						["Size", size ? `${lengthLabel(size.width, units).replace(` ${units}`, "")} × ${lengthLabel(size.height, units)}` : "–"],
						["Levels", Number.isInteger(params.steps) && params.steps >= 1 ? String(params.steps + 1) : "–"],
						["Est. time", stats ? formatMinutes(stats.minutes) : "–"],
					]}
				/>
			}
			preview={
				!plan ? (
					<PreviewPlaceholder text={picture ? "Fix the items marked in red to see the depth map." : "Choose a picture to start."} />
				) : (
					<div className="flex h-full flex-col gap-2">
						<Segmented
							value={showMap ? "map" : "toolpath"}
							onChange={setView}
							options={[
								{ value: "map", label: "Depth map" },
								{ value: "toolpath", label: previewCode ? "3D toolpath" : "3D (set the depth)" },
							]}
						/>
						<div className="min-h-0 grow">
							{showMap ? (
								<DepthMap plan={plan} steps={params.steps >= 1 ? params.steps : 1} depths={depths} units={units} showDepths={params.depth > 0} />
							) : (
								<Suspense fallback={<div className="h-full rounded-xl border border-gray-200 bg-black dark:border-slate-800" />}>
									<ToolpathView gcode={previewCode} units={units} toolDiameter={params.toolDiameter} />
								</Suspense>
							)}
						</div>
					</div>
				)
			}
			notices={<Notices errors={errors} warnings={warnings} />}
			actions={
				<button type="button" onClick={send} disabled={busy || !code} className={primaryBtn}>
					{busy ? "Loading…" : "Load to gSender"}
				</button>
			}
		/>
	);
};

export default App;
