import { gcode } from "@sienci/gsender-plugin-sdk";
import { useWorkspaceState } from "@sienci/gsender-plugin-sdk/react";
import { lazy, Suspense, useDeferredValue, useMemo, useState } from "react";

import { matchFeedPreset } from "@shared/feeds";
import { isStandalone } from "@shared/mockBridge";
import { formatMinutes, jobStats } from "@shared/stats";
import { ArrowsH, ArrowsV, Snake, SameWay, TurnInside, TurnOutside } from "@shared/icons";
import { CutSection, passCount, StepoverDiagram } from "@shared/diagrams";
import PluginLayout, { PreviewPlaceholder, primaryBtn, StatRow, type Step } from "@shared/PluginLayout";
import { BLANK_MESSAGE, hasBlank, Hint, lengthLabel, More, Notices, NumberField, Segmented, SpeedPresets, Summary } from "@shared/ui";
import { type Units, unitsScale } from "@shared/units";

import { generateGcode } from "./lib/generate";
import { check, defaultParams, describeStart, type Params } from "./lib/params";
import PositionPicker from "@shared/PositionPicker";
import { cornerOf, POSITION_NAMES } from "@shared/position";
import StartPicker from "./StartPicker";

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

	// gSender owns the unit system; mirror it rather than letting the user pick.
	const params = useMemo<Params>(() => ({ ...base, units }), [base, units]);
	const problems = useMemo(() => check(params), [params]);
	const code = useMemo(() => (problems.errors.length || hasBlank(params) ? "" : generateGcode(params)), [params, problems]);
	const previewCode = useDeferredValue(code);
	const stats = useMemo(() => (code ? jobStats(code) : null), [code]);
	const preset = matchFeedPreset(params);

	const update = (patch: Partial<Params>) => setBase((b) => ({ ...b, ...patch }));
	const shown = (mm: number) => Number((mm / scale).toFixed(4));
	const len = (label: string, mm: number, set: (mm: number) => void, required = false) => (
		<NumberField label={label} value={shown(mm)} suffix={units} required={required} onChange={(v) => set(v * scale)} />
	);

	const send = async () => {
		setBusy(true);
		try {
			const name = `surfacing-${Number(params.width.toFixed(1))}x${Number(params.height.toFixed(1))}.nc`;
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
	const errors = blank ? [BLANK_MESSAGE, ...problems.errors] : problems.errors;
	const bad = (...keys: (keyof Params)[]) => keys.some((k) => !(Number(params[k]) > 0));
	const passes = passCount(params.depth, params.stepdown);

	const steps: Step[] = [
		{
			id: "area",
			label: "Area",
			hint: "The area to face, and where X0 Y0 is. Z0 is the top of the stock.",
			issue: bad("width", "height"),
			content: (
				<>
					<div className="grid grid-cols-2 gap-3">
						{len("Width (X)", params.width, (width) => update({ width }), true)}
						{len("Height (Y)", params.height, (height) => update({ height }), true)}
					</div>
					<PositionPicker label="Zero (X0 Y0)" centre value={params.origin} onChange={(origin) => update({ origin })} />
				</>
			),
		},
		{
			id: "bit",
			label: "Bit & depth",
			hint: "The bit's size, how much to take off and how far apart the passes are.",
			issue: bad("toolDiameter", "depth") || !(params.stepover > 0 && params.stepover <= 1),
			content: (
				<>
					<div className="grid grid-cols-2 gap-3">
						{len("Bit diameter", params.toolDiameter, (toolDiameter) => update({ toolDiameter }), true)}
						{len("Depth", params.depth, (depth) => update({ depth }), true)}
					</div>
					<CutSection units={units} tool={params.toolDiameter} depth={params.depth} stepdown={params.stepdown} safeZ={params.safeZ} width={params.toolDiameter * 4} />
					<NumberField label="Stepover" required suffix="× bit" value={params.stepover} onChange={(stepover) => update({ stepover })} />
					<StepoverDiagram units={units} tool={params.toolDiameter} stepover={params.stepover} />
				</>
			),
		},
		{
			id: "path",
			label: "Path",
			hint: describeStart(params),
			content: (
				<>
					<StartPicker
						startX={params.startX}
						startY={params.startY}
						passAxis={params.passAxis}
						onChange={(startX, startY) =>
							// Zero follows the start corner until it has been set somewhere else.
							setBase((b) => ({
								...b,
								startX,
								startY,
								origin: b.origin === cornerOf(b.startX, b.startY) ? cornerOf(startX, startY) : b.origin,
							}))
						}
					/>
					<Segmented
						label="Passes run along"
						value={params.passAxis}
						onChange={(passAxis) => update({ passAxis })}
						options={[
							{ value: "x", label: "X", icon: <ArrowsH /> },
							{ value: "y", label: "Y", icon: <ArrowsV /> },
						]}
					/>
					<Segmented
						label="Turns"
						value={params.turn}
						onChange={(turn) => update({ turn })}
						options={[
							{ value: "outside", label: "Outside", icon: <TurnOutside /> },
							{ value: "inside", label: "Inside", icon: <TurnInside /> },
						]}
					/>
					<Hint>
						{params.turn === "outside"
							? "Each pass runs past the edge, so the bit steps over in the air and enters the material already moving."
							: "Passes stop on the edge and the step is cut straight along it. The bit plunges inside the material."}
					</Hint>
					<Segmented
						label="Passes"
						value={params.pattern}
						onChange={(pattern) => update({ pattern })}
						options={[
							{ value: "snake", label: "Back and forth", icon: <Snake /> },
							{ value: "same", label: "Same direction", icon: <SameWay /> },
						]}
					/>
					<Hint>
						{params.pattern === "snake"
							? "Each pass cuts the opposite way to the last one. Fastest."
							: "The bit lifts after every pass and returns, so all passes cut the same way (consistent finish, slower)."}
					</Hint>
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
					<CutSection units={units} tool={params.toolDiameter} depth={params.depth} stepdown={params.stepdown} safeZ={params.safeZ} width={params.toolDiameter * 4} title="Passes" />
					<More>
						<div className="grid grid-cols-2 gap-3">
							{len("Safe Z", params.safeZ, (v) => update({ safeZ: v }))}
							<NumberField label="Spindle ramp up" suffix="s" value={params.spindleDwell} onChange={(v) => update({ spindleDwell: v })} />
						</div>
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
							["Area", `${lengthLabel(params.width, units)} × ${lengthLabel(params.height, units)}`],
							["Bit", `Ø ${lengthLabel(params.toolDiameter, units)}`],
							["Depth", `${lengthLabel(params.depth, units)}${passes ? ` in ${passes} levels` : ""}`],
							["Stepover", Number.isFinite(params.stepover) ? `${Math.round(params.stepover * 100)}% (${lengthLabel(params.stepover * params.toolDiameter, units)})` : "–"],
							["First pass", describeStart(params)],
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
			title="Surfacing"
			intro="Faces a rectangular area. Z0 = top of stock."
			steps={steps}
			code={code}
			status={status}
			stats={
				<StatRow
					items={[
						["Area", `${shown(params.width)} × ${shown(params.height)} ${units}`],
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
			notices={<Notices errors={errors} warnings={problems.warnings} />}
			actions={
				<button type="button" onClick={send} disabled={busy || !code} className={primaryBtn}>
					{busy ? "Loading…" : "Load to gSender"}
				</button>
			}
		/>
	);
};

export default App;
