import { gcode } from "@sienci/gsender-plugin-sdk";
import { useWorkspaceState } from "@sienci/gsender-plugin-sdk/react";
import { lazy, Suspense, useDeferredValue, useMemo, useState } from "react";

import { matchFeedPreset } from "@shared/feeds";
import { isStandalone } from "@shared/mockBridge";
import { formatMinutes, jobStats } from "@shared/stats";
import { ArcIcon, CircleIcon, LineIcon, RectIcon } from "@shared/icons";
import PositionPicker from "@shared/PositionPicker";
import { Card, NumberField, OnOff, Segmented, SliderField, SpeedPresets, Stat, Stepper, Notices } from "@shared/ui";
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
	const [showCode, setShowCode] = useState(false);

	// gSender owns the unit system; mirror it rather than letting the user pick.
	const params = useMemo<Params>(() => ({ ...base, units }), [base, units]);
	const problems = useMemo(() => check(params), [params]);
	const result = useMemo(
		() => (problems.errors.length ? null : generateGcode(params)),
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
	const len = (label: string, mm: number, set: (mm: number) => void) => (
		<NumberField label={label} value={shown(mm)} suffix={units} onChange={(v) => set(v * scale)} />
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

	return (
		<div className="flex h-full flex-col bg-gray-50 text-gray-900 dark:bg-slate-950 dark:text-slate-100">
			<div className="grid min-h-0 grow grid-cols-1 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(340px,440px)_1fr] lg:overflow-hidden">
				<div className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
					<div>
						<h1 className="m-0 text-xl font-semibold">Cutout</h1>
						<p className="m-0 mt-1 text-sm text-gray-500 dark:text-slate-400">
							Cuts a rectangle (optionally with rounded corners) or a circle, with holding tabs. Z0 = top of stock.
						</p>
					</div>

					<Card title="Shape">
						<div className="flex flex-col gap-3">
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
							{params.shape === "circle" ? (
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
											onChange={(v) => update({ cornerRadius: Math.max(0, v) * scale })}
										/>
									</div>
								</div>
							)}
						</div>
					</Card>

					<Card title="Cut" hint="Which side of the line the bit runs on">
						<div className="flex flex-col gap-3">
							<Segmented
								value={params.mode}
								onChange={(mode) => update({ mode })}
								options={[
									{ value: "hole", label: "Inside" },
									{ value: "part", label: "Outside" },
								]}
							/>
							<p className="m-0 text-xs text-gray-500 dark:text-slate-400">
								{params.mode === "hole"
									? `Inside: the bit runs inside the line and the ${params.shape} is removed, the material around it stays.`
									: `Outside: the bit runs outside the line and the ${params.shape} is kept.`}
							</p>
							<div className="grid grid-cols-2 gap-3">
								{len("Tool diameter", params.toolDiameter, (v) => update({ toolDiameter: v }))}
								{len("Cut depth", params.depth, (v) => update({ depth: v }))}
							</div>
							<PositionPicker
								label="Zero (X0 Y0)"
								centre
								value={params.origin}
								onChange={(origin) => update({ origin })}
							/>
						</div>
					</Card>

					<Card title="Tabs" hint="Small bridges that keep the cut piece from moving">
						<div className="flex flex-col gap-3">
							<OnOff label="Use tabs" value={params.tabs.enabled} onChange={(enabled) => updateTabs({ enabled })} />
							{params.tabs.enabled && (
								<div className="grid grid-cols-2 gap-3">
									<div className="col-span-2">
										<Segmented
											value={params.tabs.shape}
											onChange={(shape) => updateTabs({ shape })}
											options={[
												{ value: "trapezoid", label: "Trapezoid" },
												{ value: "rectangular", label: "Rectangular" },
											]}
										/>
										<p className="m-0 mt-2 text-xs text-gray-500 dark:text-slate-400">
											{params.tabs.shape === "trapezoid"
												? "Sloped sides: the bit climbs over the tab, easier on the cutter."
												: "Vertical sides: the bit stops, lifts and drops. Simple, but harder on the cutter."}
										</p>
									</div>
									<div className="col-span-2">
										<Stepper label={params.shape === "circle" ? "Number of tabs" : "Tabs per side"} value={params.tabs.perSide} max={params.shape === "circle" ? 8 : 4} onChange={(perSide) => updateTabs({ perSide })} />
									</div>
									{len(params.tabs.shape === "trapezoid" ? "Tab length (base)" : "Tab length", params.tabs.length, (length) => updateTabs({ length }))}
									{len("Tab height", params.tabs.height, (height) => updateTabs({ height }))}
								</div>
							)}
						</div>
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
						<Stat label="Size" value={params.shape === "circle" ? `Ø ${shown(params.diameter)} ${units}` : `${shown(params.width)} × ${shown(params.height)} ${units}`} />
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

			<Notices errors={problems.errors} warnings={warnings} />

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
