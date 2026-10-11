import { gcode } from "@sienci/gsender-plugin-sdk";
import { useWorkspaceState } from "@sienci/gsender-plugin-sdk/react";
import { lazy, Suspense, useDeferredValue, useMemo, useState } from "react";

import { FEED_PRESETS, matchFeedPreset } from "@shared/feeds";
import { isStandalone } from "@shared/mockBridge";
import { formatMinutes, jobStats } from "@shared/stats";
import { Card, NumberField, Stat, Stepper } from "@shared/ui";
import { type Units, unitsScale } from "@shared/units";

import { generateGcode } from "./lib/generate";
import { defaultParams, type Params, validate } from "./lib/params";

/** three.js + the gviewer engine are large; load them only when first shown. */
const ToolpathView = lazy(() => import("@shared/ToolpathView"));

type WorkspaceState = { units?: string };

type NumKey = Exclude<keyof Params, "units">;

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
	const errors = useMemo(() => validate(params), [params]);
	const code = useMemo(() => (errors.length ? "" : generateGcode(params)), [params, errors]);
	const previewCode = useDeferredValue(code);
	const stats = useMemo(() => (code ? jobStats(code) : null), [code]);
	const preset = matchFeedPreset(params);

	const set = (key: NumKey, v: number) => setBase((b) => ({ ...b, [key]: v }));
	/** Length-like fields are stored in mm but edited in workspace units. */
	const len = (key: NumKey, label: string, step?: number) => (
		<NumberField
			label={label}
			value={Number((params[key] / scale).toFixed(4))}
			suffix={units}
			step={step}
			onChange={(v) => set(key, v * scale)}
		/>
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

	return (
		<div className="flex h-full flex-col bg-gray-50 text-gray-900 dark:bg-slate-950 dark:text-slate-100">
			<div className="grid min-h-0 grow grid-cols-1 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(340px,440px)_1fr] lg:overflow-hidden">
				{/* Settings */}
				<div className="flex min-h-0 flex-col gap-4 lg:overflow-y-auto lg:pr-1">
					<div>
						<h1 className="m-0 text-xl font-semibold">Hole Pattern</h1>
						<p className="m-0 mt-1 text-sm text-gray-500 dark:text-slate-400">
							Zero the machine at the centre of the first hole, Z0 on top of the stock.
						</p>
					</div>

					<Card title="Hole" hint="What gets cut">
						<div className="grid grid-cols-2 gap-3">
							{len("toolDiameter", "Tool diameter")}
							{len("holeDiameter", "Hole diameter")}
							<div className="col-span-2">{len("depth", "Hole depth")}</div>
						</div>
					</Card>

					<Card title="Pattern" hint={`1 × 1 is a single hole · 1 × 2 adds a second one along Y`}>
						<div className="grid grid-cols-2 gap-3">
							<Stepper label="Holes in X" value={params.countX} onChange={(v) => set("countX", v)} />
							<Stepper label="Holes in Y" value={params.countY} onChange={(v) => set("countY", v)} />
							{params.countX > 1 ? len("spacingX", "Spacing X") : <div />}
							{params.countY > 1 ? len("spacingY", "Spacing Y") : <div />}
						</div>
					</Card>

					<Card title="Material & speeds" hint={preset ? preset.hint : "Custom values"}>
						<div className="mb-3 grid grid-cols-3 gap-2">
							{FEED_PRESETS.map((f) => {
								const active = preset?.id === f.id;
								return (
									<button
										key={f.id}
										type="button"
										onClick={() =>
											setBase((b) => ({
												...b,
												feedrate: f.feedrate,
												plungeRate: f.plungeRate,
												spindleRpm: f.spindleRpm,
												stepdown: f.stepdown,
											}))
										}
										className={`h-12 cursor-pointer rounded-lg border text-sm font-medium transition active:scale-95 ${
											active
												? "border-blue-600 bg-blue-600 text-white"
												: "border-gray-300 bg-gray-50 hover:border-blue-500 dark:border-slate-600 dark:bg-slate-800"
										}`}
									>
										{f.label}
									</button>
								);
							})}
						</div>
						<div className="grid grid-cols-2 gap-3">
							<NumberField label="Cut feed" suffix={`${units}/min`} value={Number((params.feedrate / scale).toFixed(2))} onChange={(v) => set("feedrate", v * scale)} />
							<NumberField label="Plunge feed" suffix={`${units}/min`} value={Number((params.plungeRate / scale).toFixed(2))} onChange={(v) => set("plungeRate", v * scale)} />
							<NumberField label="Spindle" suffix="RPM" value={params.spindleRpm} onChange={(v) => set("spindleRpm", v)} />
							{len("stepdown", "Stepdown")}
						</div>
						<details className="mt-3">
							<summary className="cursor-pointer select-none text-sm text-gray-600 dark:text-slate-400">
								More options
							</summary>
							<div className="mt-3 grid grid-cols-2 gap-3">
								<NumberField label="Stepover" suffix="× tool" step={0.05} value={params.stepover} onChange={(v) => set("stepover", v)} />
								{len("safeZ", "Safe Z")}
								<NumberField label="Spindle dwell" suffix="s" value={params.spindleDwell} onChange={(v) => set("spindleDwell", v)} />
							</div>
						</details>
					</Card>

					{errors.length > 0 && (
						<ul className="m-0 list-none rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
							{errors.map((e) => (
								<li key={e} className="flex gap-2 py-0.5">
									<span aria-hidden>⚠</span>
									<span>{e}</span>
								</li>
							))}
						</ul>
					)}
				</div>

				{/* Preview */}
				<div className="flex min-h-96 min-w-0 flex-col gap-3 lg:min-h-0">
					<div className="grid grid-cols-3 gap-2">
						<Stat label="Holes" value={String(total)} />
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

			{/* Action bar */}
			<footer className="flex flex-wrap items-center gap-3 border-t border-gray-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
				<button
					type="button"
					onClick={send}
					disabled={busy || errors.length > 0}
					className="h-12 cursor-pointer rounded-lg bg-blue-600 px-6 text-base font-semibold text-white shadow-sm transition hover:bg-blue-500 active:scale-95 disabled:cursor-default disabled:opacity-40"
				>
					{busy ? "Loading…" : "Load to gSender"}
				</button>
				<button
					type="button"
					onClick={() => setShowCode((v) => !v)}
					disabled={errors.length > 0}
					className="h-12 cursor-pointer rounded-lg border border-gray-300 px-4 text-sm transition hover:border-blue-500 disabled:cursor-default disabled:opacity-40 dark:border-slate-600"
				>
					{showCode ? "Hide G-code" : "Show G-code"}
				</button>
				{status && (
					<span className={`text-sm ${status.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
						{status.text}
					</span>
				)}
			</footer>
		</div>
	);
};

export default App;
