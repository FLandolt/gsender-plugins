import { gcode } from "@sienci/gsender-plugin-sdk";
import { useWorkspaceState } from "@sienci/gsender-plugin-sdk/react";
import type opentype from "opentype.js";
import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useState } from "react";

import { FEED_PRESETS } from "@shared/feeds";
import { ImageIcon, ShapesIcon, TextIcon } from "@shared/icons";
import { isStandalone } from "@shared/mockBridge";
import PositionPicker from "@shared/PositionPicker";
import { formatMinutes, jobStats } from "@shared/stats";
import PluginLayout, { primaryBtn, secondaryBtn, StatRow, type Step } from "@shared/PluginLayout";
import { POSITION_NAMES } from "@shared/position";
import { BLANK_MESSAGE, BlankNumberField, FilePicker, hasBlank, More, Notices, NumberField, OnOff, Segmented, SpeedPresets, Summary } from "@shared/ui";
import { type Units, unitsScale } from "@shared/units";

import ArtworkView from "./ArtworkView";
import BitDiagram from "./BitDiagram";
import { FONTS, loadBundledFont } from "./fonts";
import { buildArtwork } from "./lib/artwork";
import { lengthText } from "./lib/bit";
import { planCarve, type CarvePlan } from "./lib/carve";
import { generateGcode } from "./lib/generate";
import { shrink, toGray, type Gray, type RawImage } from "./lib/image";
import { check, defaultParams, type Params } from "./lib/params";
import { report } from "./lib/report";
import { svgItems, type SvgItem } from "./lib/svg";
import { parseFont } from "./lib/text";
import MaskPreview from "./MaskPreview";

/** three.js + the gviewer engine are large; load them only when first shown. */
const ToolpathView = lazy(() => import("@shared/ToolpathView"));

type WorkspaceState = { units?: string };

type Preview = { key: string; plan: CarvePlan; errors: string[]; warnings: string[]; gcode: string; tooWide: CarvePlan["tooWide"] };

/** Pictures bigger than this are shrunk on loading, to keep memory in check. */
const MAX_PICTURE_SIDE = 3200;

const readPicture = async (file: File): Promise<RawImage> => {
	const bitmap = await createImageBitmap(file);
	const f = Math.min(1, MAX_PICTURE_SIDE / Math.max(bitmap.width, bitmap.height));
	const w = Math.max(1, Math.round(bitmap.width * f)), h = Math.max(1, Math.round(bitmap.height * f));
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Couldn't read the picture.");
	ctx.drawImage(bitmap, 0, 0, w, h);
	const { data } = ctx.getImageData(0, 0, w, h);
	return { width: w, height: h, data };
};

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

const App = () => {
	const workspace = useWorkspaceState<WorkspaceState>();
	const units: Units = workspace?.units === "in" ? "in" : "mm";
	const scale = unitsScale(units);

	const [base, setBase] = useState<Params>(defaultParams);
	const params = useMemo<Params>(() => ({ ...base, units }), [base, units]);
	const update = (patch: Partial<Params>) => setBase((b) => ({ ...b, ...patch }));
	const shown = (mm: number) => Number((mm / scale).toFixed(4));

	// What the artwork is made from.
	const [font, setFont] = useState<opentype.Font | null>(null);
	const [custom, setCustom] = useState<{ name: string; font: opentype.Font } | null>(null);
	const [svg, setSvg] = useState<{ name: string; items: SvgItem[]; skipped: number } | null>(null);
	const [image, setImage] = useState<{ name: string; raw: RawImage; gray: Gray } | null>(null);
	const [assetError, setAssetError] = useState<string | null>(null);
	/** Changes whenever the artwork's source files do, so a stale preview can be told. */
	const [version, setVersion] = useState(0);

	useEffect(() => {
		if (params.fontId === "custom") {
			setFont(custom?.font ?? null);
			setVersion((v) => v + 1);
			return;
		}
		let live = true;
		loadBundledFont(params.fontId)
			.then((f) => {
				if (!live) return;
				setFont(f);
				setVersion((v) => v + 1);
			})
			.catch((e: unknown) => live && setAssetError(e instanceof Error ? e.message : String(e)));
		return () => {
			live = false;
		};
	}, [params.fontId, custom]);

	const onFont = async (file: File) => {
		try {
			setCustom({ name: file.name, font: parseFont(await file.arrayBuffer()) });
			update({ fontId: "custom" });
			setAssetError(null);
		} catch {
			setAssetError("Couldn't read that font file. Use a .ttf, .otf or .woff file (.woff2 isn't supported).");
		}
	};
	const onSvg = async (file: File) => {
		try {
			const doc = new DOMParser().parseFromString(await file.text(), "image/svg+xml");
			if (doc.querySelector("parsererror") || doc.documentElement.localName.toLowerCase() !== "svg") throw new Error("not svg");
			setSvg({ name: file.name, ...svgItems(doc) });
			setVersion((v) => v + 1);
			setAssetError(null);
		} catch {
			setAssetError("Couldn't read that SVG file. Make sure it is a valid .svg drawing.");
		}
	};
	const onPicture = async (file: File) => {
		try {
			const raw = await readPicture(file);
			setImage({ name: file.name, raw, gray: shrink(toGray(raw)) });
			setVersion((v) => v + 1);
			setAssetError(null);
		} catch {
			setAssetError("Couldn't read that picture. Try a PNG or JPG.");
		}
	};

	const checked = useMemo(() => check(params), [params]);
	// Tracing a picture is heavy: while a slider is dragged, keep the screen responsive and catch up after.
	const settled = useDeferredValue(params);
	const artwork = useMemo(() => buildArtwork(settled, { font, svg: svg && { items: svg.items, skipped: svg.skipped }, image: image?.raw ?? null }), [settled, font, svg, image]);

	// Preview: the toolpath and what it needs. Nothing is generated until it is asked for and fine.
	const [preview, setPreview] = useState<Preview | null>(null);
	const [busy, setBusy] = useState(false);
	const [view, setView] = useState<"artwork" | "toolpath">("artwork");
	const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
	const key = useMemo(() => JSON.stringify([params, version]), [params, version]);
	const fresh = preview !== null && preview.key === key;

	const blank = hasBlank(params);
	const ready =
		!blank &&
		checked.bit !== null &&
		checked.maxDepth !== null &&
		checked.errors.length === 0 &&
		checked.missing.length === 0 &&
		artwork.errors.length === 0 &&
		artwork.needs.length === 0 &&
		artwork.shapes.length > 0;

	const runPreview = async () => {
		if (!ready || !checked.bit || checked.maxDepth === null) return;
		setBusy(true);
		setStatus(null);
		await tick();
		try {
			const plan = planCarve(artwork.shapes, checked.bit, checked.maxDepth, params.quality, params.rough ? { roughing: { allowance: params.allowance } } : {});
			const rep = report(params, plan, artwork.bounds);
			const warnings = [...artwork.warnings, ...rep.warnings];
			const code = rep.blocked ? "" : generateGcode(params, plan, { bounds: artwork.bounds, description: artwork.description }, warnings);
			setPreview({ key, plan, errors: rep.errors, warnings, gcode: code, tooWide: plan.tooWide });
			setView(code ? "toolpath" : "artwork");
		} catch (err) {
			setPreview(null);
			setStatus({ ok: false, text: err instanceof Error ? err.message : String(err) });
		} finally {
			setBusy(false);
		}
	};

	const send = async () => {
		if (!preview || !fresh || !preview.gcode) return;
		setBusy(true);
		try {
			const name = `vcarve-${artwork.description.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "artwork"}.nc`;
			await gcode.loadToVisualizer(preview.gcode, name);
			setStatus({ ok: true, text: isStandalone() ? `Standalone harness — downloaded ${name}` : "Loaded into gSender" });
		} catch (err) {
			setStatus({ ok: false, text: err instanceof Error ? err.message : String(err) });
		} finally {
			setBusy(false);
		}
	};

	const stats = useMemo(() => (fresh && preview?.gcode ? jobStats(preview.gcode) : null), [fresh, preview]);
	const canLoad = fresh && preview !== null && preview.errors.length === 0 && preview.gcode !== "" && !busy;

	// What to tell the user.
	const errors = [...new Set([...(blank ? [BLANK_MESSAGE] : []), ...checked.errors, ...artwork.errors, ...(fresh ? preview!.errors : []), ...(assetError ? [assetError] : [])])];
	const warnings = [...new Set(fresh ? preview!.warnings : artwork.warnings)];
	const info = [...checked.missing, ...artwork.needs];
	if (ready && !fresh) info.push(preview ? "Settings changed. Press Preview to update the toolpath." : "Press Preview to see the toolpath.");

	const len = (label: string, mm: number, set: (mm: number) => void, required = false) => (
		<NumberField label={label} value={shown(mm)} suffix={units} required={required} onChange={(v) => set(v * scale)} />
	);
	const blankLen = (label: string, mm: number | null, set: (mm: number | null) => void, invalid = false, hint?: string) => (
		<BlankNumberField label={label} value={mm === null ? null : shown(mm)} suffix={units} invalid={invalid} hint={hint} onChange={(v) => set(v === null ? null : v * scale)} />
	);
	const preset = FEED_PRESETS.find((f) => Math.abs(f.feedrate - params.feedrate) <= 1 && Math.abs(f.plungeRate - params.plungeRate) <= 1 && Math.abs(f.spindleRpm - params.spindleRpm) <= 1) ?? null;

	const bitInvalid = {
		angle: params.angle !== null && !(params.angle >= 1 && params.angle <= 179),
		diameter: params.diameter !== null && !(params.diameter > 0),
		tip: params.tip !== null && (params.tip < 0 || (params.diameter !== null && params.diameter > 0 && params.tip >= params.diameter)),
		cuttingLength: params.cuttingLength !== null && !(params.cuttingLength > 0),
		maxDepth: params.maxDepth !== null && (!(params.maxDepth > 0) || (checked.deepest !== null && params.maxDepth > checked.deepest + 1e-9)),
	};
	const tile = (mm: number | null) => (mm === null ? "–" : lengthText(mm, units));

	const steps: Step[] = [
		{
			id: "artwork",
			label: "Artwork",
			hint: "What to carve: text, an SVG drawing or a picture.",
			issue: artwork.errors.length > 0 || (params.source === "text" ? !params.text.trim() || !(params.letterHeight > 0) || !(params.lineSpacing > 0) : !(params.size > 0)) || assetError !== null,
			content: (
				<div className="flex flex-col gap-3">
							<Segmented
								value={params.source}
								onChange={(source) => update({ source })}
								options={[
									{ value: "text", label: "Text", icon: <TextIcon /> },
									{ value: "svg", label: "SVG", icon: <ShapesIcon />, title: "A vector drawing with closed shapes" },
									{ value: "image", label: "Picture", icon: <ImageIcon />, title: "A logo or line drawing" },
								]}
							/>

							{params.source === "text" && (
								<>
									<label className="flex flex-col gap-1">
										<span className="text-xs font-medium text-gray-600 dark:text-slate-400">Text (a new line starts a new row)</span>
										<textarea
											value={params.text}
											rows={2}
											onChange={(e) => update({ text: e.currentTarget.value })}
											className="w-full resize-y rounded-lg border border-gray-300 bg-gray-50 p-3 text-base outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/30 dark:border-slate-600 dark:bg-slate-800"
										/>
									</label>
									<Segmented
										label="Font"
										value={params.fontId}
										onChange={(fontId) => update({ fontId })}
										options={[...FONTS.map((f) => ({ value: f.id, label: f.label, title: f.note })), ...(custom ? [{ value: "custom", label: "Yours", title: custom.name }] : [])]}
									/>
									<FilePicker label="Load a font…" accept=".ttf,.otf,.woff" fileName={custom?.name ?? null} onFile={onFont} />
									<div className="grid grid-cols-2 gap-3">
										{len("Letter height", params.letterHeight, (letterHeight) => update({ letterHeight }))}
										<NumberField label="Line spacing" required suffix="×" value={params.lineSpacing} onChange={(lineSpacing) => update({ lineSpacing })} />
									</div>
									<Segmented
										label="Alignment"
										value={params.align}
										onChange={(align) => update({ align })}
										options={[
											{ value: "left", label: "Left" },
											{ value: "center", label: "Centre" },
											{ value: "right", label: "Right" },
										]}
									/>
								</>
							)}

							{params.source === "svg" && (
								<>
									<FilePicker label="Choose an SVG…" accept=".svg,image/svg+xml" fileName={svg?.name ?? null} onFile={onSvg} />
									<p className="m-0 text-xs text-gray-500 dark:text-slate-400">
										Closed shapes are carved. A shape inside another one is a hole (like the inside of an O). Open lines are left out.
									</p>
								</>
							)}

							{params.source === "image" && (
								<>
									<FilePicker label="Choose a picture…" accept="image/*" fileName={image?.name ?? null} onFile={onPicture} />
									{image && (
										<>
											<div className="flex flex-col gap-1">
												<span className="flex items-baseline justify-between text-xs font-medium text-gray-600 dark:text-slate-400">
													<span>Threshold: what counts as shape</span>
													<span className="tabular-nums">{params.threshold}</span>
												</span>
												<input
													type="range"
													min={1}
													max={254}
													value={params.threshold}
													onChange={(e) => update({ threshold: e.currentTarget.valueAsNumber })}
													className="touch-range w-full accent-blue-600"
													aria-label="Threshold"
												/>
											</div>
											<OnOff label="Invert: carve the light areas instead of the dark" value={params.invert} onChange={(invert) => update({ invert })} />
											<MaskPreview gray={image.gray} threshold={params.threshold} invert={params.invert} />
											<p className="m-0 text-xs text-gray-500 dark:text-slate-400">Black areas will be carved.</p>
										</>
									)}
								</>
							)}

							{params.source !== "text" && (
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
									{len(params.sizeBy === "width" ? "Width" : "Height", params.size, (size) => update({ size }))}
								</div>
							)}
						</div>
			),
		},
		{
			id: "bit",
			label: "V-bit",
			hint: "Common starting values. Check them against your bit's packaging or the maker's page.",
			issue: checked.bit === null || bitInvalid.angle || bitInvalid.diameter || bitInvalid.tip || bitInvalid.cuttingLength,
			content: (
				<>
					<div className="grid grid-cols-2 gap-3">
						<BlankNumberField label="Included angle" suffix="°" value={params.angle} invalid={bitInvalid.angle} onChange={(angle) => update({ angle })} />
						{blankLen("Maximum diameter", params.diameter, (diameter) => update({ diameter }), bitInvalid.diameter)}
						{blankLen("Tip diameter", params.tip, (tip) => update({ tip }), bitInvalid.tip, "0 for a sharp point")}
						<BlankNumberField
							label="Cutting length (optional)"
							suffix={units}
							value={params.cuttingLength === null ? null : shown(params.cuttingLength)}
							placeholder="optional"
							invalid={bitInvalid.cuttingLength}
							onChange={(v) => update({ cuttingLength: v === null ? null : v * scale })}
						/>
					</div>
					<BitDiagram bit={checked.bit} maxDepth={checked.maxDepth} tooDeep={bitInvalid.maxDepth && params.maxDepth !== null && params.maxDepth > 0} units={units} />
				</>
			),
		},
		{
			id: "cutting",
			label: "Depth & quality",
			hint: "How deep it may cut, roughing and quality.",
			issue: bitInvalid.maxDepth || (params.rough && (!(params.allowance >= 0) || !(params.finishFeedPercent > 0 && params.finishFeedPercent <= 100))),
			content: (
				<div className="flex flex-col gap-3">
							<div className="flex flex-col gap-1">
								<BlankNumberField
									label="Maximum depth (optional)"
									suffix={units}
									value={params.maxDepth === null ? null : shown(params.maxDepth)}
									placeholder={checked.maxDepth !== null && params.maxDepth === null ? String(shown(checked.maxDepth)) : "automatic"}
									invalid={bitInvalid.maxDepth}
									onChange={(v) => update({ maxDepth: v === null ? null : v * scale })}
								/>
								<p className="m-0 text-xs text-gray-500 dark:text-slate-400">
									{params.maxDepth === null
										? checked.deepest !== null
											? `Automatic: ${lengthText(checked.deepest, units)}, the deepest this bit can cut. Enter a smaller number to protect thin stock; the cut is never deeper than it.`
											: "Automatic: the deepest the bit can cut, once the bit above is filled in."
										: "The cut is never deeper than this. Clear the box to go back to automatic."}
								</p>
							</div>
							<div className="flex flex-col gap-2">
								<OnOff label="Roughing pass, then a finishing pass" value={params.rough} onChange={(rough) => update({ rough })} />
								<p className="m-0 text-xs text-gray-500 dark:text-slate-400">
									{params.rough
										? "First a roughing pass that leaves some wood on the walls, then a slower finishing pass to the final size. Gives cleaner walls, and takes about twice as long."
										: "Off: the whole depth is cut in one pass."}
								</p>
								{params.rough && (
									<div className="grid grid-cols-2 gap-3">
										{len("Wood left on the walls", params.allowance, (allowance) => update({ allowance }))}
										<NumberField label="Finishing feed" required suffix="% of cut feed" value={params.finishFeedPercent} onChange={(finishFeedPercent) => update({ finishFeedPercent })} />
									</div>
								)}
							</div>
							<Segmented
								label="Quality"
								value={params.quality}
								onChange={(quality) => update({ quality })}
								options={[
									{ value: "draft", label: "Draft" },
									{ value: "normal", label: "Normal" },
									{ value: "fine", label: "Fine" },
								]}
							/>
						</div>
			),
		},
		{
			id: "zero",
			label: "Zero",
			hint: "Where X0 Y0 is on the artwork. Z0 is always the top of the stock.",
			content: <PositionPicker label="Zero (X0 Y0)" centre value={params.origin} onChange={(origin) => update({ origin })} />,
		},
		{
			id: "speed",
			label: "Speed",
			hint: preset ? preset.hint : "Custom values",
			issue: !(params.feedrate > 0) || !(params.plungeRate > 0) || !(params.spindleRpm > 0) || !(params.safeZ > 0) || Number.isNaN(params.spindleDwell),
			content: (
				<>
					<SpeedPresets value={preset} onPick={(f) => update({ feedrate: f.feedrate, plungeRate: f.plungeRate, spindleRpm: f.spindleRpm })} />
					<div className="grid grid-cols-2 gap-3">
						<NumberField label="Cut feed" required suffix={`${units}/min`} value={shown(params.feedrate)} onChange={(v) => update({ feedrate: v * scale })} />
						<NumberField label="Plunge feed" required suffix={`${units}/min`} value={shown(params.plungeRate)} onChange={(v) => update({ plungeRate: v * scale })} />
						<NumberField label="Spindle" required suffix="RPM" value={params.spindleRpm} onChange={(v) => update({ spindleRpm: v })} />
						{len("Safe Z", params.safeZ, (v) => update({ safeZ: v }), true)}
					</div>
					<More>
						<div className="grid grid-cols-2 gap-3">
							<NumberField label="Spindle ramp up" suffix="s" value={params.spindleDwell} onChange={(v) => update({ spindleDwell: v })} />
						</div>
					</More>
				</>
			),
		},
		{
			id: "check",
			label: "Check & load",
			hint: "Press Preview to work out the toolpath, look it over, then load it into gSender. Always air-cut first.",
			issue: errors.length > 0,
			content: (
				<>
					<Summary
						rows={[
							["Artwork", artwork.description || "–"],
							["V-bit", checked.bit ? `${checked.bit.angle}°, Ø ${lengthText(checked.bit.diameter, units)}${checked.bit.tip > 0 ? `, tip ${lengthText(checked.bit.tip, units)}` : ""}` : "–"],
							["Max depth", tile(checked.maxDepth)],
							["Deepest needed", fresh ? tile(preview!.plan.deepestNeeded) : "press Preview"],
							["Roughing", params.rough ? `Yes, ${lengthText(params.allowance, units)} left for finishing` : "No"],
							["Quality", params.quality[0].toUpperCase() + params.quality.slice(1)],
							["Zero", POSITION_NAMES[params.origin]],
							["Feed / plunge", `${shown(params.feedrate)} / ${shown(params.plungeRate)} ${units}/min`],
							["Est. time", stats ? formatMinutes(stats.minutes) : "–"],
						]}
					/>
					<button type="button" onClick={runPreview} disabled={busy || !ready} className={fresh ? secondaryBtn : primaryBtn}>
						{busy ? "Working…" : fresh ? "Preview is up to date" : "Preview the toolpath"}
					</button>
				</>
			),
		},
	];

	return (
		<PluginLayout
			title="V-Carve"
			intro="Carves text, shapes and pictures with a V-bit: deeper where the shape is wide. Z0 = top of stock."
			steps={steps}
			code={canLoad ? preview!.gcode : ""}
			status={status}
			stats={
				<StatRow
					items={[
						["Deepest needed", fresh ? tile(preview!.plan.deepestNeeded) : "–"],
						["Bit can cut", tile(checked.deepest)],
						["Max depth", tile(checked.maxDepth)],
						["Est. time", stats ? formatMinutes(stats.minutes) : "–"],
					]}
				/>
			}
			preview={
				<div className="flex h-full flex-col gap-2">
					{preview?.gcode && (
						<Segmented
							value={view}
							onChange={setView}
							options={[
								{ value: "artwork", label: "Artwork" },
								{ value: "toolpath", label: "Cut path" },
							]}
						/>
					)}
					<div className="min-h-0 grow">
						{view === "toolpath" && preview?.gcode ? (
							<Suspense fallback={<div className="h-full rounded-xl bg-slate-950" />}>
								<ToolpathView gcode={preview.gcode} units={units} toolDiameter={checked.bit?.diameter ?? 6} materialView={false} showBit={false} />
							</Suspense>
						) : (
							<ArtworkView shapes={artwork.shapes} bounds={artwork.bounds} label="The artwork to carve" marks={fresh ? preview!.tooWide.map((t) => ({ x: t.x, y: t.y, r: t.width / 2 })) : []} />
						)}
					</div>
				</div>
			}
			notices={<Notices errors={errors} warnings={warnings} info={info} />}
			actions={
				<>
					<button type="button" onClick={runPreview} disabled={busy || !ready} className={fresh ? secondaryBtn : primaryBtn}>
						{busy ? "Working…" : "Preview"}
					</button>
					<button type="button" onClick={send} disabled={!canLoad} className={fresh ? primaryBtn : secondaryBtn}>
						Load to gSender
					</button>
				</>
			}
		/>
	);
};

export default App;
