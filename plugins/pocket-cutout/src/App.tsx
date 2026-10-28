import { gcode } from "@sienci/gsender-plugin-sdk";
import { useWorkspaceState } from "@sienci/gsender-plugin-sdk/react";
import { lazy, Suspense, useDeferredValue, useMemo, useState } from "react";

import { matchFeedPreset } from "@shared/feeds";
import { ArcIcon, CircleIcon, LineIcon, RectIcon, RotateCcw, RotateCw } from "@shared/icons";
import { isStandalone } from "@shared/mockBridge";
import PositionPicker from "@shared/PositionPicker";
import { formatMinutes, jobStats } from "@shared/stats";
import { Card, NumberField, Segmented, SliderField, SpeedPresets, Stat, Notices } from "@shared/ui";
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
	const [showCode, setShowCode] = useState(false);

	// gSender owns the unit system; mirror it rather than letting the user pick.
	const params = useMemo<Params>(() => ({ ...base, units }), [base, units]);
	const problems = useMemo(() => check(params), [params]);
	const code = useMemo(() => (problems.errors.length ? "" : generateGcode(params)), [params, problems]);
	const previewCode = useDeferredValue(code);
	const stats = useMemo(() => (code ? jobStats(code) : null), [code]);
	const preset = matchFeedPreset(params);
	const round = params.shape === "circle";

	const update = (patch: Partial<Params>) => setBase((b) => ({ ...b, ...patch }));
	const shown = (mm: number) => Number((mm / scale).toFixed(4));
	const len = (label: string, mm: number, set: (mm: number) => void) => (
		<NumberField label={label} value={shown(mm)} suffix={units} onChange={(v) => set(v * scale)} />
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

	return (
		<div className="flex h-full flex-col bg-gray-50 text-gray-900 dark:bg-slate-950 dark:text-slate-100">
			<div className="grid min-h-0 grow grid-cols-1 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(340px,440px)_1fr] lg:overflow-hidden">
				<div className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
					<div>
						<h1 className="m-0 text-xl font-semibold">Pocket Cutout</h1>
						<p className="m-0 mt-1 text-sm text-gray-500 dark:text-slate-400">
							Clears a rectangular or round pocket. The bit spirals down, so it never plunges. Z0 = top of stock.
						</p>
					</div>

					<Card title="Pocket">
						<div className="flex flex-col gap-3">
							<Segmented
								value={params.shape}
								onChange={(shape) => update({ shape })}
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
											label="Corner radius (0 = the tool's radius)"
											suffix={units}
											value={shown(params.cornerRadius)}
											min={0}
											max={shown(Math.min(params.width, params.height) / 2)}
											onChange={(v) => update({ cornerRadius: Math.max(0, v) * scale })}
										/>
									</div>
								</div>
							)}
							<div className="grid grid-cols-2 gap-3">
								{len("Tool diameter", params.toolDiameter, (v) => update({ toolDiameter: v }))}
								{len("Depth", params.depth, (v) => update({ depth: v }))}
							</div>
						</div>
					</Card>

					<Card title="Spiral" hint="Starts in the middle and works outwards, ending on the wall. Every level begins with a spiral ramp down.">
						<div className="flex flex-col gap-3">
							<div>
								<Segmented
									label="Spiral direction"
									value={params.rotation}
									onChange={(rotation) => update({ rotation })}
									options={[
										{ value: "cw", label: "Clockwise", icon: <RotateCw />, title: "Climb milling" },
										{ value: "ccw", label: "Counter-clockwise", icon: <RotateCcw />, title: "Conventional milling" },
									]}
								/>
								<p className="m-0 mt-2 text-xs text-gray-500 dark:text-slate-400">
									{params.rotation === "cw"
										? "Clockwise is climb milling, usually the better finish inside a pocket."
										: "Counter-clockwise is conventional milling."}
								</p>
							</div>
							<NumberField label="Stepover" suffix="× tool" step={0.05} value={params.stepover} onChange={(stepover) => update({ stepover })} />
						</div>
					</Card>

					<Card title="Zero" hint="Where X0 Y0 is. Z0 is always the top of the stock.">
						<PositionPicker
							label="Zero (X0 Y0)"
							centre
							value={params.origin}
							onChange={(origin) => update({ origin })}
						/>
					</Card>

					<Card title="Speed" hint={preset ? preset.hint : "Custom values"}>
						<div className="mb-3">
							<SpeedPresets
								value={preset}
								onPick={(f) => update({ feedrate: f.feedrate, plungeRate: f.plungeRate, spindleRpm: f.spindleRpm, stepdown: f.stepdown })}
							/>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<NumberField label="Cut feed" suffix={`${units}/min`} value={shown(params.feedrate)} onChange={(v) => update({ feedrate: v * scale })} />
							<NumberField label="Plunge feed" suffix={`${units}/min`} value={shown(params.plungeRate)} onChange={(v) => update({ plungeRate: v * scale })} />
							<NumberField label="Spindle" suffix="RPM" value={params.spindleRpm} onChange={(v) => update({ spindleRpm: v })} />
							{len("Stepdown", params.stepdown, (v) => update({ stepdown: v }))}
						</div>
						<details className="mt-3">
							<summary className="cursor-pointer select-none text-sm text-gray-600 dark:text-slate-400">More options</summary>
							<div className="mt-3 flex flex-col gap-3">
								<div className="grid grid-cols-2 gap-3">
									{len("Safe Z", params.safeZ, (v) => update({ safeZ: v }))}
									<NumberField label="Spindle ramp up" suffix="s" value={params.spindleDwell} onChange={(v) => update({ spindleDwell: v })} />
								</div>
								<Segmented
									label="Circles and corners"
									title="Smaller files and smoother motion. Turn off if your controller rejects arcs."
									value={params.useArcs ? "arcs" : "lines"}
									onChange={(v) => update({ useArcs: v === "arcs" })}
									options={[
										{ value: "arcs", label: "Arcs (G2/G3)", icon: <ArcIcon /> },
										{ value: "lines", label: "Lines (G1)", icon: <LineIcon /> },
									]}
								/>
							</div>
						</details>
					</Card>

				</div>

				<div className="flex min-h-96 min-w-0 flex-col gap-3 lg:min-h-0">
					<div className="grid grid-cols-3 gap-2">
						<Stat label="Pocket" value={round ? `Ø ${shown(params.diameter)} ${units}` : `${shown(params.width)} × ${shown(params.height)} ${units}`} />
						<Stat label="Est. time" value={stats ? formatMinutes(stats.minutes) : "–"} />
						<Stat label="G-code lines" value={stats ? stats.lines.toLocaleString() : "–"} />
					</div>
					<div className="min-h-72 grow">
						{previewCode ? (
							<Suspense fallback={<div className="h-full rounded-xl bg-slate-950" />}>
								<ToolpathView gcode={previewCode} units={units} toolDiameter={params.toolDiameter} />
							</Suspense>
						) : (
							<div className="flex h-full items-center justify-center rounded-xl border border-dashed border-gray-300 text-sm text-gray-500 dark:border-slate-700">
								Fix the warnings to see the toolpath.
							</div>
						)}
					</div>
					{showCode && code && (
						<pre className="m-0 max-h-60 overflow-auto rounded-xl bg-gray-100 p-3 font-mono text-[11px] leading-relaxed dark:bg-slate-900">
							{code}
						</pre>
					)}
				</div>
			</div>

			<Notices errors={problems.errors} warnings={problems.warnings} />

			<footer className="flex flex-wrap items-center gap-3 border-t border-gray-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
				<button
					type="button"
					onClick={send}
					disabled={busy || !code}
					className="h-12 cursor-pointer rounded-lg bg-blue-600 px-6 text-base font-semibold text-white shadow-sm transition hover:bg-blue-500 active:scale-95 disabled:cursor-default disabled:opacity-40"
				>
					{busy ? "Loading…" : "Load to gSender"}
				</button>
				<button
					type="button"
					onClick={() => setShowCode((v) => !v)}
					disabled={!code}
					className="h-12 cursor-pointer rounded-lg border border-gray-300 px-4 text-sm transition hover:border-blue-500 disabled:cursor-default disabled:opacity-40 dark:border-slate-600"
				>
					{showCode ? "Hide G-code" : "Show G-code"}
				</button>
				{status && (
					<span className={`text-sm ${status.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{status.text}</span>
				)}
			</footer>
		</div>
	);
};

export default App;
