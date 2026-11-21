import { gcode } from "@sienci/gsender-plugin-sdk";
import { useWorkspaceState } from "@sienci/gsender-plugin-sdk/react";
import { lazy, Suspense, useDeferredValue, useMemo, useState } from "react";

import { matchFeedPreset } from "@shared/feeds";
import { isStandalone } from "@shared/mockBridge";
import { formatMinutes, jobStats } from "@shared/stats";
import { ArcIcon, CircleIcon, LineIcon, RectIcon } from "@shared/icons";
import PositionPicker from "@shared/PositionPicker";
import { CutSection, passCount, TabDiagram } from "@shared/diagrams";
import PluginLayout, { PreviewPlaceholder, primaryBtn, StatRow, type Step } from "@shared/PluginLayout";
import { POSITION_NAMES } from "@shared/position";
import { BLANK_MESSAGE, hasBlank, Hint, lengthLabel, More, Notices, NumberField, OnOff, Segmented, SliderField, SpeedPresets, Stepper, Summary } from "@shared/ui";
import { type Units, unitsScale } from "@shared/units";

import { generateGcode } from "./lib/generate";
import { check, defaultParams, type Params } from "./lib/params";

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
	const result = useMemo(
		// An emptied box blocks the job even where no other check covers it.
		() => (problems.errors.length || hasBlank(params) ? null : generateGcode(params)),
		[params, problems],
	);
	const code = result?.gcode ?? "";
	const warnings = [...problems.warnings, ...(result?.warnings ?? [])];
	const previewCode = useDeferredValue(code);
	const stats = useMemo(() => (code ? jobStats(code) : null), [code]);
	const preset = matchFeedPreset(params);

	const update = (patch: Partial<Params>) => setBase((b) => ({ ...b, ...patch }));
	const updateTabs = (patch: Partial<Params["tabs"]>) =>
		setBase((b) => ({ ...b, tabs: { ...b.tabs, ...patch } }));

	const shown = (mm: number) => Number((mm / scale).toFixed(4));
	const len = (label: string, mm: number, set: (mm: number) => void, required = false) => (
		<NumberField label={label} value={shown(mm)} suffix={units} required={required} onChange={(v) => set(v * scale)} />
	);

	const send = async () => {
		setBusy(true);
		try {
			const name =
				params.shape === "circle"
					? `cutout-d${Number(params.diameter.toFixed(1))}.nc`
					: `cutout-${Number(params.width.toFixed(1))}x${Number(params.height.toFixed(1))}.nc`;
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

	const round = params.shape === "circle";
	const blank = hasBlank(params);
	const errors = blank ? [BLANK_MESSAGE, ...problems.errors] : problems.errors;
	const has = (...keys: (keyof Params)[]) => keys.some((k) => !(Number(params[k]) > 0));
	const tabsBad = params.tabs.enabled && (!(params.tabs.length > 0) || !(params.tabs.height > 0) || !(params.tabs.perSide >= 1) || (params.depth > 0 && params.tabs.height >= params.depth));

	const steps: Step[] = [
		{
			id: "shape",
			label: "Shape",
			hint: "What gets cut out, and where X0 Y0 is. Z0 is the top of the stock.",
			issue: round ? has("diameter") : has("width", "height") || params.cornerRadius > Math.min(params.width, params.height) / 2 + 1e-9,
			content: (
				<>
					<Segmented
						value={params.shape}
						onChange={(shape) =>
							// A circle wants a few tabs around it; a rectangle one per side.
							setBase((b) => ({ ...b, shape, tabs: { ...b.tabs, perSide: shape === "circle" ? 4 : 1 } }))
						}
						options={[
							{ value: "rectangle", label: "Rectangle", icon: <RectIcon /> },
							{ value: "circle", label: "Circle", icon: <CircleIcon /> },
						]}
					/>
					{round ? (
						len("Diameter", params.diameter, (v) => update({ diameter: v }))
					) : (
						<div className="grid grid-cols-2 gap-3">
							{len("Width (X)", params.width, (v) => update({ width: v }))}
							{len("Height (Y)", params.height, (v) => update({ height: v }))}
							<div className="col-span-2">
								<SliderField
									label="Corner radius (0 = sharp)"
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
			id: "cut",
			label: "Bit & depth",
			hint: "Which side of the line the bit runs on, the bit's size and how deep to cut.",
			issue: has("toolDiameter", "depth"),
			content: (
				<>
					<Segmented
						label="Cut"
						value={params.mode}
						onChange={(mode) => update({ mode })}
						options={[
							{ value: "hole", label: "Inside the line" },
							{ value: "part", label: "Outside the line" },
						]}
					/>
					<Hint>
						{params.mode === "hole"
							? `Inside: the bit runs inside the line and the ${params.shape} is removed, the material around it stays.`
							: `Outside: the bit runs outside the line and the ${params.shape} is kept.`}
					</Hint>
					<div className="grid grid-cols-2 gap-3">
						{len("Bit diameter", params.toolDiameter, (v) => update({ toolDiameter: v }), true)}
						{len("Cut depth", params.depth, (v) => update({ depth: v }), true)}
					</div>
					<Hint>Cut depth: the thickness of your stock plus a little, so the piece comes free.</Hint>
					<CutSection
						units={units}
						tool={params.toolDiameter}
						depth={params.depth}
						stepdown={params.stepdown}
						safeZ={params.safeZ}
						tabHeight={params.tabs.enabled ? params.tabs.height : undefined}
						line={params.mode === "hole" ? "right" : "left"}
						leftLabel={params.mode === "hole" ? "waste" : round ? "circle (kept)" : "part (kept)"}
						rightLabel={params.mode === "hole" ? "kept" : "waste"}
					/>
					<Hint>The red dashed line is the outline you entered; the bit stays on the waste side of it.</Hint>
				</>
			),
		},
		{
			id: "tabs",
			label: "Tabs",
			hint: "Small bridges that keep the cut piece from moving.",
			issue: tabsBad,
			content: (
				<>
					<OnOff label="Use tabs" value={params.tabs.enabled} onChange={(enabled) => updateTabs({ enabled })} />
					{params.tabs.enabled && (
						<>
							<Segmented
								value={params.tabs.shape}
								onChange={(shape) => updateTabs({ shape })}
								options={[
									{ value: "trapezoid", label: "Trapezoid" },
									{ value: "rectangular", label: "Rectangular" },
								]}
							/>
							<Stepper label={round ? "Number of tabs" : "Tabs per side"} value={params.tabs.perSide} max={round ? 8 : 4} onChange={(perSide) => updateTabs({ perSide })} />
							<div className="grid grid-cols-2 gap-3">
								{len(params.tabs.shape === "trapezoid" ? "Tab length (base)" : "Tab length", params.tabs.length, (length) => updateTabs({ length }), true)}
								{len("Tab height", params.tabs.height, (height) => updateTabs({ height }), true)}
							</div>
							<TabDiagram units={units} length={params.tabs.length} height={params.tabs.height} depth={params.depth} shape={params.tabs.shape} tool={params.toolDiameter} />
						</>
					)}
				</>
			),
		},
		{
			id: "speed",
			label: "Speed",
			hint: preset ? preset.hint : "Custom values",
			issue: has("feedrate", "plungeRate", "stepdown") || hasBlank([params.spindleRpm, params.safeZ, params.spindleDwell]),
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
					<CutSection units={units} tool={params.toolDiameter} depth={params.depth} stepdown={params.stepdown} safeZ={params.safeZ} title="Passes" />
					<More>
						<Segmented
							label="Cutting direction"
							value={params.direction}
							onChange={(direction) => update({ direction })}
							options={[
								{ value: "climb", label: "Climb" },
								{ value: "conventional", label: "Conventional" },
							]}
						/>
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
							["Shape", round ? `Circle Ø ${lengthLabel(params.diameter, units)}` : `${lengthLabel(params.width, units)} × ${lengthLabel(params.height, units)}${params.cornerRadius > 0 ? `, r ${lengthLabel(params.cornerRadius, units)}` : ""}`],
							["Cut", params.mode === "hole" ? "Inside the line" : "Outside the line"],
							["Bit", `Ø ${lengthLabel(params.toolDiameter, units)}`],
							["Depth", `${lengthLabel(params.depth, units)}${passCount(params.depth, params.stepdown) ? ` in ${passCount(params.depth, params.stepdown)} passes` : ""}`],
							["Tabs", params.tabs.enabled ? `${round ? params.tabs.perSide : params.tabs.perSide * 4} × ${params.tabs.shape}, ${lengthLabel(params.tabs.length, units)} × ${lengthLabel(params.tabs.height, units)}` : "None"],
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
			title="Cutout"
			intro="Cuts a rectangle or circle out, with holding tabs. Z0 = top of stock."
			steps={steps}
			code={code}
			status={status}
			stats={
				<StatRow
					items={[
						["Size", round ? `Ø ${shown(params.diameter)} ${units}` : `${shown(params.width)} × ${shown(params.height)} ${units}`],
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
