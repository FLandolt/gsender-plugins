import { gcode } from "@sienci/gsender-plugin-sdk";
import { useWorkspaceState } from "@sienci/gsender-plugin-sdk/react";
import { lazy, Suspense, useDeferredValue, useMemo, useState } from "react";

import { FEED_PRESETS, matchFeedPreset } from "@shared/feeds";
import { isStandalone } from "@shared/mockBridge";
import { formatMinutes, jobStats } from "@shared/stats";
import { Card, NumberField, Segmented, SliderField, Stat, Stepper, Toggle } from "@shared/ui";
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
			const name = `cutout-${Number(params.width.toFixed(1))}x${Number(params.height.toFixed(1))}.nc`;
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
				<div className="flex min-h-0 flex-col gap-4 lg:overflow-y-auto lg:pr-1">
					<div>
						<h1 className="m-0 text-xl font-semibold">Rectangular Cutout</h1>
						<p className="m-0 mt-1 text-sm text-gray-500 dark:text-slate-400">
							Cuts a rectangle with optional rounded corners and holding tabs. Z0 = top of stock.
						</p>
					</div>

					<Card title="Shape">
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
					</Card>

					<Card title="Cut" hint="Which side of the line the bit runs on">
						<div className="flex flex-col gap-3">
							<Segmented
								value={params.mode}
								onChange={(mode) => update({ mode })}
								options={[
									{ value: "hole", label: "Opening" },
									{ value: "part", label: "Part" },
								]}
							/>
							<p className="m-0 text-xs text-gray-500 dark:text-slate-400">
								{params.mode === "hole"
									? "Opening: the rectangle is removed, the material around it stays."
									: "Part: the rectangle is kept, the bit cuts around the outside."}
							</p>
							<div className="grid grid-cols-2 gap-3">
								{len("Tool diameter", params.toolDiameter, (v) => update({ toolDiameter: v }))}
								{len("Cut depth", params.depth, (v) => update({ depth: v }))}
							</div>
							<Segmented
								label="Zero (X0 Y0)"
								value={params.origin}
								onChange={(origin) => update({ origin })}
								options={[
									{ value: "center", label: "Centre" },
									{ value: "lower-left", label: "Lower-left corner" },
								]}
							/>
						</div>
					</Card>

					<Card title="Tabs" hint="Small bridges that keep the cut piece from moving">
						<div className="flex flex-col gap-3">
							<Toggle label="Use tabs" checked={params.tabs.enabled} onChange={(enabled) => updateTabs({ enabled })} />
							{params.tabs.enabled && (
								<div className="grid grid-cols-2 gap-3">
									<div className="col-span-2">
										<Stepper label="Tabs per side" value={params.tabs.perSide} max={4} onChange={(perSide) => updateTabs({ perSide })} />
									</div>
									{len("Tab length", params.tabs.length, (length) => updateTabs({ length }))}
									{len("Tab height", params.tabs.height, (height) => updateTabs({ height }))}
								</div>
							)}
						</div>
					</Card>

					<Card title="Material & speeds" hint={preset ? preset.hint : "Custom values"}>
						<div className="mb-3 grid grid-cols-3 gap-2">
							{FEED_PRESETS.map((f) => (
								<button
									key={f.id}
									type="button"
									onClick={() =>
										update({
											feedrate: f.feedrate,
											plungeRate: f.plungeRate,
											spindleRpm: f.spindleRpm,
											stepdown: f.stepdown,
										})
									}
									className={`h-12 cursor-pointer rounded-lg border text-sm font-medium transition active:scale-95 ${
										preset?.id === f.id
											? "border-blue-600 bg-blue-600 text-white"
											: "border-gray-300 bg-gray-50 hover:border-blue-500 dark:border-slate-600 dark:bg-slate-800"
									}`}
								>
									{f.label}
								</button>
							))}
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
									<NumberField label="Spindle dwell" suffix="s" value={params.spindleDwell} onChange={(v) => update({ spindleDwell: v })} />
								</div>
							</div>
						</details>
					</Card>

					{(problems.errors.length > 0 || warnings.length > 0) && (
						<ul className="m-0 list-none rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
							{[...problems.errors, ...warnings].map((e) => (
								<li key={e} className="flex gap-2 py-0.5">
									<span aria-hidden>⚠</span>
									<span>{e}</span>
								</li>
							))}
						</ul>
					)}
				</div>

				<div className="flex min-h-96 min-w-0 flex-col gap-3 lg:min-h-0">
					<div className="grid grid-cols-3 gap-2">
						<Stat label="Size" value={`${shown(params.width)} × ${shown(params.height)} ${units}`} />
						<Stat label="Est. time" value={stats ? formatMinutes(stats.minutes) : "–"} />
						<Stat label="G-code lines" value={stats ? stats.lines.toLocaleString() : "–"} />
					</div>
					<div className="min-h-72 grow">
						{previewCode ? (
							<Suspense fallback={<div className="h-full rounded-xl bg-slate-950" />}>
								<ToolpathView gcode={previewCode} units={units} />
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
