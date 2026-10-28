import { gcode } from "@sienci/gsender-plugin-sdk";
import { useWorkspaceState } from "@sienci/gsender-plugin-sdk/react";
import { lazy, Suspense, useDeferredValue, useMemo, useState } from "react";

import { matchFeedPreset } from "@shared/feeds";
import { isStandalone } from "@shared/mockBridge";
import { formatMinutes, jobStats } from "@shared/stats";
import { ArrowsH, ArrowsV, Snake, SameWay, TurnInside, TurnOutside } from "@shared/icons";
import { Card, NumberField, Segmented, SpeedPresets, Stat, Notices } from "@shared/ui";
import { type Units, unitsScale } from "@shared/units";

import { generateGcode } from "./lib/generate";
import { check, defaultParams, describeStart, type Params } from "./lib/params";
import PositionPicker from "@shared/PositionPicker";
import { cornerOf } from "@shared/position";
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
	const [showCode, setShowCode] = useState(false);

	// gSender owns the unit system; mirror it rather than letting the user pick.
	const params = useMemo<Params>(() => ({ ...base, units }), [base, units]);
	const problems = useMemo(() => check(params), [params]);
	const code = useMemo(() => (problems.errors.length ? "" : generateGcode(params)), [params, problems]);
	const previewCode = useDeferredValue(code);
	const stats = useMemo(() => (code ? jobStats(code) : null), [code]);
	const preset = matchFeedPreset(params);

	const update = (patch: Partial<Params>) => setBase((b) => ({ ...b, ...patch }));
	const shown = (mm: number) => Number((mm / scale).toFixed(4));
	const len = (label: string, mm: number, set: (mm: number) => void) => (
		<NumberField label={label} value={shown(mm)} suffix={units} onChange={(v) => set(v * scale)} />
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

	return (
		<div className="flex h-full flex-col bg-gray-50 text-gray-900 dark:bg-slate-950 dark:text-slate-100">
			<div className="grid min-h-0 grow grid-cols-1 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(340px,440px)_1fr] lg:overflow-hidden">
				<div className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
					<div>
						<h1 className="m-0 text-xl font-semibold">Surfacing</h1>
						<p className="m-0 mt-1 text-sm text-gray-500 dark:text-slate-400">
							Faces a rectangular area. Pick where to zero the machine; Z0 is the top of the stock.
						</p>
					</div>

					<Card title="Area" hint="What gets surfaced">
						<div className="grid grid-cols-2 gap-3">
							{len("Width (X)", params.width, (width) => update({ width }))}
							{len("Height (Y)", params.height, (height) => update({ height }))}
							{len("Tool diameter", params.toolDiameter, (toolDiameter) => update({ toolDiameter }))}
							{len("Depth", params.depth, (depth) => update({ depth }))}
							<div className="col-span-2">
								<NumberField label="Stepover" suffix="× tool" step={0.05} value={params.stepover} onChange={(stepover) => update({ stepover })} />
							</div>
						</div>
					</Card>

					<Card title="Start and direction" hint={describeStart(params)}>
						<div className="flex flex-col gap-3">
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
									{ value: "x", label: "X", icon: <ArrowsH />, title: "Passes run left to right (or right to left)" },
									{ value: "y", label: "Y", icon: <ArrowsV />, title: "Passes run front to back (or back to front)" },
								]}
							/>
							<div>
								<Segmented
									label="Turns"
									value={params.turn}
									onChange={(turn) => update({ turn })}
									options={[
										{ value: "outside", label: "Outside", icon: <TurnOutside /> },
										{ value: "inside", label: "Inside", icon: <TurnInside /> },
									]}
								/>
								<p className="m-0 mt-2 text-xs text-gray-500 dark:text-slate-400">
									{params.turn === "outside"
										? "Each pass runs past the edge, so the bit steps over in the air and enters the material already moving."
										: "Passes stop on the edge and the step is cut straight along it. The bit plunges inside the material."}
								</p>
							</div>
							<div>
								<Segmented
									label="Passes"
									value={params.pattern}
									onChange={(pattern) => update({ pattern })}
									options={[
										{ value: "snake", label: "Back and forth", icon: <Snake /> },
										{ value: "same", label: "Same direction", icon: <SameWay /> },
									]}
								/>
								<p className="m-0 mt-2 text-xs text-gray-500 dark:text-slate-400">
									{params.pattern === "snake"
										? "Each pass cuts the opposite way to the last one. Fastest."
										: "The bit lifts after every pass and returns, so all passes cut the same way (consistent finish, slower)."}
								</p>
							</div>
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
							<div className="mt-3 grid grid-cols-2 gap-3">
								{len("Safe Z", params.safeZ, (v) => update({ safeZ: v }))}
								<NumberField label="Spindle ramp up" suffix="s" value={params.spindleDwell} onChange={(v) => update({ spindleDwell: v })} />
							</div>
						</details>
					</Card>

				</div>

				<div className="flex min-h-96 min-w-0 flex-col gap-3 lg:min-h-0">
					<div className="grid grid-cols-3 gap-2">
						<Stat label="Area" value={`${shown(params.width)} × ${shown(params.height)} ${units}`} />
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
