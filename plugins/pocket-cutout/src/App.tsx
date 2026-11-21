import { gcode } from "@sienci/gsender-plugin-sdk";
import { useWorkspaceState } from "@sienci/gsender-plugin-sdk/react";
import { lazy, Suspense, useDeferredValue, useMemo, useState } from "react";

import { matchFeedPreset } from "@shared/feeds";
import { ArcIcon, CircleIcon, LineIcon, RectIcon, RotateCcw, RotateCw } from "@shared/icons";
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
	const round = params.shape === "circle";

	const update = (patch: Partial<Params>) => setBase((b) => ({ ...b, ...patch }));
	const shown = (mm: number) => Number((mm / scale).toFixed(4));
	const len = (label: string, mm: number, set: (mm: number) => void, required = false) => (
		<NumberField label={label} value={shown(mm)} suffix={units} required={required} onChange={(v) => set(v * scale)} />
	);

	const send = async () => {
		setBusy(true);
		try {
			const name = round
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
	const errors = blank ? [BLANK_MESSAGE, ...problems.errors] : problems.errors;
	const bad = (...keys: (keyof Params)[]) => keys.some((k) => !(Number(params[k]) > 0));
	const passes = passCount(params.depth, params.stepdown);
	const pocketWidth = round ? params.diameter : Math.min(params.width, params.height);

	const steps: Step[] = [
		{
			id: "pocket",
			label: "Pocket",
			hint: "The pocket's shape and size, and where X0 Y0 is. Z0 is the top of the stock.",
			issue: round ? bad("diameter") : bad("width", "height") || params.cornerRadius > Math.min(params.width, params.height) / 2 + 1e-9,
			content: (
				<>
					<Segmented
						value={params.shape}
						onChange={(shape) => update({ shape })}
						options={[
							{ value: "rectangle", label: "Rectangle", icon: <RectIcon /> },
							{ value: "circle", label: "Circle", icon: <CircleIcon /> },
						]}
					/>
					{round ? (
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
			issue: bad("toolDiameter", "depth") || pocketWidth <= params.toolDiameter + 1e-6,
			content: (
				<>
					<div className="grid grid-cols-2 gap-3">
						{len("Bit diameter", params.toolDiameter, (v) => update({ toolDiameter: v }), true)}
						{len("Depth", params.depth, (v) => update({ depth: v }), true)}
					</div>
					<CutSection units={units} tool={params.toolDiameter} depth={params.depth} stepdown={params.stepdown} safeZ={params.safeZ} width={pocketWidth} />
					<Hint>Every level starts with a spiral ramp down, so the bit never plunges straight in.</Hint>
				</>
			),
		},
		{
			id: "spiral",
			label: "Spiral",
			hint: "Starts in the middle and works outwards, ending on the wall.",
			issue: !(params.stepover > 0 && params.stepover <= 1),
			content: (
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
					<NumberField label="Stepover" required suffix="× bit" value={params.stepover} onChange={(stepover) => update({ stepover })} />
					<StepoverDiagram units={units} tool={params.toolDiameter} stepover={params.stepover} />
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
							["Pocket", round ? `Circle Ø ${lengthLabel(params.diameter, units)}` : `${lengthLabel(params.width, units)} × ${lengthLabel(params.height, units)}${params.cornerRadius > 0 ? `, r ${lengthLabel(params.cornerRadius, units)}` : ""}`],
							["Bit", `Ø ${lengthLabel(params.toolDiameter, units)}`],
							["Depth", `${lengthLabel(params.depth, units)}${passes ? ` in ${passes} levels` : ""}`],
							["Spiral", `${params.rotation === "cw" ? "Clockwise" : "Counter-clockwise"}, stepover ${Math.round(params.stepover * 100)}%`],
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
			intro="Clears a pocket in a spiral from the middle out. Z0 = top of stock."
			steps={steps}
			code={code}
			status={status}
			stats={
				<StatRow
					items={[
						["Pocket", round ? `Ø ${shown(params.diameter)} ${units}` : `${shown(params.width)} × ${shown(params.height)} ${units}`],
						["Est. time", stats ? formatMinutes(stats.minutes) : "–"],
						["G-code lines", stats ? stats.lines.toLocaleString() : "–"],
					]}
				/>
			}
			preview={
				previewCode ? (
					<Suspense fallback={<div className="h-full rounded-xl bg-slate-950" />}>
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
