import { gcode } from "@sienci/gsender-plugin-sdk";
import { useWorkspaceState } from "@sienci/gsender-plugin-sdk/react";
import { lazy, Suspense, useDeferredValue, useMemo, useState } from "react";

import { matchFeedPreset } from "@shared/feeds";
import { isStandalone } from "@shared/mockBridge";
import { formatMinutes, jobStats } from "@shared/stats";
import { ArcIcon, LineIcon } from "@shared/icons";
import PositionPicker from "@shared/PositionPicker";
import { CutSection, passCount, StepoverDiagram } from "@shared/diagrams";
import PluginLayout, { PreviewPlaceholder, primaryBtn, StatRow, type Step } from "@shared/PluginLayout";
import { BLANK_MESSAGE, hasBlank, Hint, lengthLabel, More, Notices, NumberField, Segmented, SpeedPresets, Stepper, Summary } from "@shared/ui";
import { type Units, unitsScale } from "@shared/units";

import { generateGcode } from "./lib/generate";
import { defaultParams, type Params, validate } from "./lib/params";

/** three.js + the gviewer engine are large; load them only when first shown. */
const ToolpathView = lazy(() => import("@shared/ToolpathView"));

type WorkspaceState = { units?: string };

type NumKey = Exclude<keyof Params, "units" | "useArcs" | "origin">;

const App = () => {
	const workspace = useWorkspaceState<WorkspaceState>();
	const units: Units = workspace?.units === "in" ? "in" : "mm";
	const scale = unitsScale(units);

	const [base, setBase] = useState<Params>(defaultParams);
	const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
	const [busy, setBusy] = useState(false);

	// gSender owns the unit system; mirror it rather than letting the user pick.
	const params = useMemo<Params>(() => ({ ...base, units }), [base, units]);
	const errors = useMemo(() => validate(params), [params]);
	const code = useMemo(() => (errors.length || hasBlank(params) ? "" : generateGcode(params)), [params, errors]);
	const previewCode = useDeferredValue(code);
	const stats = useMemo(() => (code ? jobStats(code) : null), [code]);
	const preset = matchFeedPreset(params);

	const set = (key: NumKey, v: number) => setBase((b) => ({ ...b, [key]: v }));
	/** Length-like fields are stored in mm but edited in workspace units. */
	const len = (key: NumKey, label: string, required = false) => (
		<NumberField label={label} value={Number((params[key] / scale).toFixed(4))} suffix={units} required={required} onChange={(v) => set(key, v * scale)} />
	);

	const total = params.countX * params.countY;

	const send = async () => {
		setBusy(true);
		try {
			const name = `holes-${params.countX}x${params.countY}-d${Number(params.holeDiameter.toFixed(2))}.nc`;
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
	const allErrors = blank ? [BLANK_MESSAGE, ...errors] : errors;
	const bad = (...keys: NumKey[]) => keys.some((k) => !(params[k] > 0));
	const passes = passCount(params.depth, params.stepdown);
	const cornerName = params.origin.replace("-", " ").replace("lower", "bottom").replace("upper", "top");

	const steps: Step[] = [
		{
			id: "hole",
			label: "Hole & bit",
			hint: "The hole to cut, the bit that cuts it and how deep. Z0 is the top of the stock.",
			issue: bad("toolDiameter", "holeDiameter", "depth") || params.holeDiameter < params.toolDiameter - 1e-6,
			content: (
				<>
					<div className="grid grid-cols-2 gap-3">
						{len("toolDiameter", "Bit diameter", true)}
						{len("holeDiameter", "Hole diameter", true)}
						<div className="col-span-2">{len("depth", "Hole depth", true)}</div>
					</div>
					<CutSection units={units} tool={params.toolDiameter} depth={params.depth} stepdown={params.stepdown} safeZ={params.safeZ} width={params.holeDiameter} />
					<Hint>The bit spirals down level by level, then clears out to the hole's wall.</Hint>
				</>
			),
		},
		{
			id: "pattern",
			label: "Pattern",
			hint: "1 × 1 is a single hole · 1 × 2 adds a second one along Y.",
			issue:
				!(params.countX >= 1) ||
				!(params.countY >= 1) ||
				(params.countX > 1 && !(params.spacingX >= params.holeDiameter)) ||
				(params.countY > 1 && !(params.spacingY >= params.holeDiameter)),
			content: (
				<>
					<div className="grid grid-cols-2 gap-3">
						<Stepper label="Holes in X" value={params.countX} onChange={(v) => set("countX", v)} />
						<Stepper label="Holes in Y" value={params.countY} onChange={(v) => set("countY", v)} />
						{params.countX > 1 ? len("spacingX", "Spacing X", true) : <div />}
						{params.countY > 1 ? len("spacingY", "Spacing Y", true) : <div />}
					</div>
					{total > 1 ? (
						<PositionPicker
							label="Zero (X0 Y0)"
							hint={`Zero at the centre of the ${cornerName} hole. The other holes extend away from it.`}
							value={params.origin}
							onChange={(origin) => origin !== "center" && setBase((b) => ({ ...b, origin }))}
						/>
					) : (
						<Hint>Zero the machine at the centre of the hole.</Hint>
					)}
				</>
			),
		},
		{
			id: "speed",
			label: "Speed",
			hint: preset ? preset.hint : "Custom values",
			issue: bad("feedrate", "plungeRate", "stepdown") || !(params.stepover > 0 && params.stepover <= 1) || hasBlank([params.spindleRpm, params.safeZ, params.spindleDwell]),
			content: (
				<>
					<SpeedPresets
						value={preset}
						onPick={(f) => setBase((b) => ({ ...b, feedrate: f.feedrate, plungeRate: f.plungeRate, spindleRpm: f.spindleRpm, stepdown: f.stepdown }))}
					/>
					<div className="grid grid-cols-2 gap-3">
						<NumberField label="Cut feed" required suffix={`${units}/min`} value={Number((params.feedrate / scale).toFixed(2))} onChange={(v) => set("feedrate", v * scale)} />
						<NumberField label="Plunge feed" required suffix={`${units}/min`} value={Number((params.plungeRate / scale).toFixed(2))} onChange={(v) => set("plungeRate", v * scale)} />
						<NumberField label="Spindle" suffix="RPM" value={params.spindleRpm} onChange={(v) => set("spindleRpm", v)} />
						{len("stepdown", "Stepdown", true)}
					</div>
					<CutSection units={units} tool={params.toolDiameter} depth={params.depth} stepdown={params.stepdown} safeZ={params.safeZ} width={params.holeDiameter} title="Passes" />
					<More>
						<div className="grid grid-cols-2 gap-3">
							<NumberField label="Stepover" required suffix="× bit" value={params.stepover} onChange={(v) => set("stepover", v)} />
							{len("safeZ", "Safe Z")}
							<NumberField label="Spindle ramp up" suffix="s" value={params.spindleDwell} onChange={(v) => set("spindleDwell", v)} />
						</div>
						<StepoverDiagram units={units} tool={params.toolDiameter} stepover={params.stepover} />
						<Segmented
							label="Circles and corners"
							value={params.useArcs ? "arcs" : "lines"}
							onChange={(v) => setBase((b) => ({ ...b, useArcs: v === "arcs" }))}
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
			issue: allErrors.length > 0,
			content: (
				<>
					<Summary
						rows={[
							["Holes", `${params.countX} × ${params.countY} = ${total}`],
							["Hole", `Ø ${lengthLabel(params.holeDiameter, units)}`],
							["Bit", `Ø ${lengthLabel(params.toolDiameter, units)}`],
							["Depth", `${lengthLabel(params.depth, units)}${passes ? ` in ${passes} passes` : ""}`],
							...(total > 1 ? ([["Spacing", `${params.countX > 1 ? `X ${lengthLabel(params.spacingX, units)}` : ""}${params.countX > 1 && params.countY > 1 ? " · " : ""}${params.countY > 1 ? `Y ${lengthLabel(params.spacingY, units)}` : ""}`]] as [string, string][]) : []),
							["Zero", total > 1 ? `centre of the ${cornerName} hole` : "centre of the hole"],
							["Feed / plunge", `${Number((params.feedrate / scale).toFixed(2))} / ${Number((params.plungeRate / scale).toFixed(2))} ${units}/min`],
							["Spindle", `${params.spindleRpm} RPM`],
							["Est. time", stats ? formatMinutes(stats.minutes) : "–"],
						]}
					/>
					{allErrors.length > 0 && <Hint>Fix the items listed at the bottom (steps with a red dot) before loading.</Hint>}
				</>
			),
		},
	];

	return (
		<PluginLayout
			title="Hole Pattern"
			intro="Zero at the centre of the first hole, Z0 on top of the stock."
			steps={steps}
			code={code}
			status={status}
			stats={
				<StatRow
					items={[
						["Holes", String(total)],
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
			notices={<Notices errors={allErrors} warnings={[]} />}
			actions={
				<button type="button" onClick={send} disabled={busy || !code || blank} className={primaryBtn}>
					{busy ? "Loading…" : "Load to gSender"}
				</button>
			}
		/>
	);
};

export default App;
