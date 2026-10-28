import type { ReactNode } from "react";

import { FEED_PRESETS, type FeedPreset } from "./feeds";

export const Card = ({
	title,
	hint,
	children,
}: {
	title: string;
	hint?: string;
	children: ReactNode;
}) => (
	<section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
		<header className="mb-3">
			<h2 className="m-0 text-sm font-semibold tracking-wide text-gray-900 dark:text-slate-100">
				{title}
			</h2>
			{hint ? <p className="m-0 mt-0.5 text-xs text-gray-500 dark:text-slate-400">{hint}</p> : null}
		</header>
		{children}
	</section>
);

const inputBase =
	"h-12 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 text-base tabular-nums outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/30 dark:border-slate-600 dark:bg-slate-800 dark:focus:bg-slate-800";

/** Number box with the unit sitting inside the field. */
export const NumberField = ({
	label,
	value,
	onChange,
	suffix,
	step,
}: {
	label: string;
	value: number;
	onChange: (v: number) => void;
	suffix?: string;
	step?: number | "any";
}) => (
	<label className="flex flex-col gap-1">
		<span className="text-xs font-medium text-gray-600 dark:text-slate-400">{label}</span>
		<span className="relative block">
			<input
				type="number"
				inputMode="decimal"
				className={`${inputBase} ${suffix ? "pr-16" : ""}`}
				value={value}
				step={step ?? "any"}
				onChange={(e) => {
					const v = e.currentTarget.valueAsNumber;
					if (Number.isFinite(v)) onChange(v);
				}}
			/>
			{suffix ? (
				<span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-gray-400">
					{suffix}
				</span>
			) : null}
		</span>
	</label>
);

/** − / + counter for whole numbers. */
export const Stepper = ({
	label,
	value,
	onChange,
	min = 1,
	max = 99,
}: {
	label: string;
	value: number;
	onChange: (v: number) => void;
	min?: number;
	max?: number;
}) => {
	const btn =
		"h-12 w-12 shrink-0 cursor-pointer rounded-lg border border-gray-300 bg-gray-50 text-xl leading-none transition hover:border-blue-500 active:scale-95 disabled:cursor-default disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800";
	const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v)));
	return (
		<div className="flex flex-col gap-1">
			<span className="text-xs font-medium text-gray-600 dark:text-slate-400">{label}</span>
			<div className="flex items-center gap-2">
				<button type="button" className={btn} disabled={value <= min} onClick={() => onChange(clamp(value - 1))} aria-label={`Fewer ${label}`}>
					−
				</button>
				<input
					type="number"
					inputMode="numeric"
					className={`${inputBase} text-center`}
					value={value}
					onChange={(e) => {
						const v = e.currentTarget.valueAsNumber;
						if (Number.isFinite(v)) onChange(clamp(v));
					}}
				/>
				<button type="button" className={btn} disabled={value >= max} onClick={() => onChange(clamp(value + 1))} aria-label={`More ${label}`}>
					+
				</button>
			</div>
		</div>
	);
};

export const Stat = ({ label, value }: { label: string; value: string }) => (
	<div className="rounded-lg bg-gray-100 px-3 py-2 dark:bg-slate-800">
		<div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</div>
		<div className="text-base font-semibold tabular-nums">{value}</div>
	</div>
);

/** Pill-style choice between a few options, each with an optional icon. */
export const Segmented = <T extends string>({
	label,
	value,
	options,
	onChange,
	title,
}: {
	label?: string;
	value: T;
	options: { value: T; label: string; icon?: ReactNode; title?: string }[];
	onChange: (v: T) => void;
	/** Tooltip for the whole control. */
	title?: string;
}) => (
	<div className="flex flex-col gap-1" title={title}>
		{label ? <span className="text-xs font-medium text-gray-600 dark:text-slate-400">{label}</span> : null}
		<div className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-gray-100 p-1 dark:bg-slate-800">
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					title={o.title}
					aria-pressed={o.value === value}
					onClick={() => onChange(o.value)}
					className={`flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium transition ${
						o.value === value
							? "bg-white text-blue-700 shadow-sm dark:bg-slate-600 dark:text-white"
							: "text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100"
					}`}
				>
					{o.icon}
					<span>{o.label}</span>
				</button>
			))}
		</div>
	</div>
);

/** An on/off choice as a two-button segmented control. */
export const OnOff = ({
	label,
	value,
	onChange,
	title,
}: {
	label: string;
	value: boolean;
	onChange: (v: boolean) => void;
	title?: string;
}) => (
	<Segmented
		label={label}
		title={title}
		value={value ? "on" : "off"}
		onChange={(v) => onChange(v === "on")}
		options={[
			{ value: "off", label: "Off" },
			{ value: "on", label: "On" },
		]}
	/>
);

/** Slow / Medium / High. None is highlighted when the values have been edited by hand. */
export const SpeedPresets = ({
	value,
	onPick,
}: {
	value: FeedPreset | null;
	onPick: (preset: FeedPreset) => void;
}) => (
	<Segmented
		value={value?.id ?? ""}
		onChange={(id) => {
			const preset = FEED_PRESETS.find((f) => f.id === id);
			if (preset) onPick(preset);
		}}
		options={FEED_PRESETS.map((f) => ({ value: f.id, label: f.label, title: f.hint }))}
	/>
);

/** On/off switch with a label. */
export const Toggle = ({
	label,
	checked,
	onChange,
	title,
}: {
	label: string;
	checked: boolean;
	onChange: (v: boolean) => void;
	/** Tooltip shown on hover. */
	title?: string;
}) => (
	<label title={title} className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium">
		<span>{label}</span>
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			onClick={() => onChange(!checked)}
			className={`relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition ${checked ? "bg-blue-600" : "bg-gray-300 dark:bg-slate-600"}`}
		>
			<span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
		</button>
	</label>
);

/** Slider paired with the number field it drives. */
export const SliderField = ({
	label,
	value,
	min,
	max,
	suffix,
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	suffix?: string;
	onChange: (v: number) => void;
}) => (
	<div className="flex flex-col gap-1">
		<NumberField label={label} value={value} suffix={suffix} onChange={onChange} />
		<input
			type="range"
			min={min}
			max={Math.max(max, min)}
			step="any"
			value={Math.min(Math.max(value, min), Math.max(max, min))}
			onChange={(e) => onChange(e.currentTarget.valueAsNumber)}
			className="w-full accent-blue-600"
			aria-label={`${label} slider`}
		/>
	</div>
);

/**
 * Problems, warnings and things still to do, in a strip that sits above the action bar. It is
 * outside the scrolling settings column, so it stays in view however far the form is scrolled.
 */
export const Notices = ({ errors = [], warnings = [], info = [] }: { errors?: string[]; warnings?: string[]; info?: string[] }) => {
	if (errors.length === 0 && warnings.length === 0 && info.length === 0) return null;
	const row = (text: string, kind: "e" | "w" | "i") => (
		<li key={`${kind}-${text}`} className="flex gap-2 py-0.5">
			<span aria-hidden>{kind === "e" ? "⛔" : kind === "w" ? "⚠" : "ℹ"}</span>
			<span>{text}</span>
		</li>
	);
	const tone =
		errors.length > 0
			? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
			: warnings.length > 0
				? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
				: "border-slate-300 bg-slate-100 text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200";
	return (
		<div role="alert" className={`shrink-0 border-t px-4 py-2 text-sm ${tone}`}>
			<ul className="m-0 max-h-32 list-none overflow-y-auto p-0">
				{errors.map((e) => row(e, "e"))}
				{warnings.map((w) => row(w, "w"))}
				{info.map((i) => row(i, "i"))}
			</ul>
		</div>
	);
};

/** A number box that can be empty, for values with no sensible default (such as a bit's angle). */
export const BlankNumberField = ({
	label,
	value,
	onChange,
	suffix,
	step,
	invalid = false,
	hint,
	placeholder = "required",
}: {
	label: string;
	value: number | null;
	onChange: (v: number | null) => void;
	suffix?: string;
	step?: number | "any";
	/** Highlights the box: the value is wrong, or missing and needed. */
	invalid?: boolean;
	hint?: string;
	placeholder?: string;
}) => (
	<label className="flex flex-col gap-1">
		<span className="text-xs font-medium text-gray-600 dark:text-slate-400">{label}</span>
		<span className="relative block">
			<input
				type="number"
				inputMode="decimal"
				className={`${inputBase} ${suffix ? "pr-16" : ""} ${invalid ? "!border-red-400 !ring-2 !ring-red-400/20" : ""}`}
				value={value ?? ""}
				step={step ?? "any"}
				placeholder={placeholder}
				aria-invalid={invalid}
				onChange={(e) => {
					const raw = e.currentTarget.value;
					if (raw === "") return onChange(null);
					const v = e.currentTarget.valueAsNumber;
					if (Number.isFinite(v)) onChange(v);
				}}
			/>
			{suffix ? (
				<span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-gray-400">{suffix}</span>
			) : null}
		</span>
		{hint ? <span className="text-xs text-gray-500 dark:text-slate-400">{hint}</span> : null}
	</label>
);

/** A button that opens the file chooser, with the chosen file's name beside it. */
export const FilePicker = ({
	label,
	accept,
	fileName,
	onFile,
}: {
	label: string;
	accept: string;
	fileName?: string | null;
	onFile: (file: File) => void;
}) => (
	<label className="flex cursor-pointer items-center gap-3">
		<span className="flex h-12 shrink-0 items-center rounded-lg border border-gray-300 bg-gray-50 px-4 text-sm font-medium transition hover:border-blue-500 active:scale-95 dark:border-slate-600 dark:bg-slate-800">
			{label}
		</span>
		<span className="min-w-0 truncate text-sm text-gray-500 dark:text-slate-400">{fileName ?? "No file chosen"}</span>
		<input
			type="file"
			accept={accept}
			className="sr-only"
			onChange={(e) => {
				const file = e.currentTarget.files?.[0];
				if (file) onFile(file);
				// So choosing the same file again still counts.
				e.currentTarget.value = "";
			}}
		/>
	</label>
);
