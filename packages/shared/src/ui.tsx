import { type ReactNode, useState } from "react";

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
const invalidRing = "!border-red-400 !ring-2 !ring-red-400/20";

/** Reads what is typed in a number box. Empty or half-typed ("-", ".") is NaN. Accepts a comma as the decimal mark. */
export const parseNumber = (text: string): number => {
	const t = text.trim().replace(",", ".");
	if (t === "" || t === "-" || t === "." || t === "-.") return Number.NaN;
	return /^-?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : Number.NaN;
};

/** True when anything in a settings object is a number that is not filled in (an emptied box). */
export const hasBlank = (value: unknown): boolean => {
	if (typeof value === "number") return Number.isNaN(value);
	if (value && typeof value === "object") return Object.values(value).some(hasBlank);
	return false;
};

export const BLANK_MESSAGE = "Some boxes are empty. Fill in the ones outlined in red.";

/**
 * The text box behind every number field. While it has focus it keeps exactly what is typed, so a
 * box can be cleared completely and a new number typed in (an empty box reports NaN, which the
 * checks treat as missing). Tapping it selects the number, so typing replaces it straight away.
 */
const NumInput = ({
	value,
	onChange,
	className = "",
	invalid = false,
	placeholder,
	label,
	numeric = false,
	onBlurValue,
	allowEmpty = false,
}: {
	value: number | null;
	onChange: (v: number) => void;
	className?: string;
	invalid?: boolean;
	placeholder?: string;
	label: string;
	/** Whole numbers only: shows the number pad without a decimal key where the device has one. */
	numeric?: boolean;
	/** Called when the box loses focus, with what it holds then. */
	onBlurValue?: (v: number) => void;
	/** Empty is a valid answer here (an optional value): don't outline it. */
	allowEmpty?: boolean;
}) => {
	const [draft, setDraft] = useState<string | null>(null);
	const text = draft ?? (value === null || !Number.isFinite(value) ? "" : String(value));
	const blank = !allowEmpty && (draft !== null ? Number.isNaN(parseNumber(draft)) : value !== null && Number.isNaN(value));
	return (
		<input
			type="text"
			inputMode={numeric ? "numeric" : "decimal"}
			enterKeyHint="done"
			autoComplete="off"
			spellCheck={false}
			aria-label={label}
			aria-invalid={invalid || blank}
			placeholder={placeholder ?? (blank ? "enter a value" : undefined)}
			className={`${inputBase} ${className} ${invalid || blank ? invalidRing : ""}`}
			value={text}
			onFocus={(e) => {
				setDraft(text);
				const el = e.currentTarget;
				// Select after the tap has placed the caret, or touch browsers undo the selection.
				requestAnimationFrame(() => {
					if (document.activeElement === el) el.select();
				});
			}}
			onChange={(e) => {
				const raw = e.currentTarget.value;
				setDraft(raw);
				onChange(parseNumber(raw));
			}}
			onBlur={() => {
				if (draft !== null) onBlurValue?.(parseNumber(draft));
				setDraft(null);
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter") e.currentTarget.blur();
			}}
		/>
	);
};

const FieldLabel = ({ children }: { children: ReactNode }) => (
	<span className="text-xs font-medium text-gray-600 dark:text-slate-400">{children}</span>
);

const Suffix = ({ children }: { children: ReactNode }) => (
	<span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-gray-400">{children}</span>
);

/**
 * Number box with the unit sitting inside the field. It can be emptied while typing; an empty box
 * reports NaN and is outlined in red. `required` also outlines it when it is 0 or less.
 */
export const NumberField = ({
	label,
	value,
	onChange,
	suffix,
	required = false,
	invalid = false,
	hint,
}: {
	label: string;
	value: number;
	onChange: (v: number) => void;
	suffix?: string;
	/** @deprecated kept for older call sites; the box accepts any decimal. */
	step?: number | "any";
	/** The value must be more than 0: outline it when it is not. */
	required?: boolean;
	invalid?: boolean;
	hint?: string;
}) => (
	<label className="flex flex-col gap-1">
		<FieldLabel>{label}</FieldLabel>
		<span className="relative block">
			<NumInput
				label={label}
				value={value}
				onChange={onChange}
				className={suffix ? "pr-16" : ""}
				invalid={invalid || (required && Number.isFinite(value) && !(value > 0))}
			/>
			{suffix ? <Suffix>{suffix}</Suffix> : null}
		</span>
		{hint ? <span className="text-xs text-gray-500 dark:text-slate-400">{hint}</span> : null}
	</label>
);

/** − / + counter for whole numbers. The box can be cleared and typed into; it snaps into range when you leave it. */
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
		"h-12 w-14 shrink-0 cursor-pointer select-none rounded-lg border border-gray-300 bg-gray-50 text-2xl leading-none transition hover:border-blue-500 active:scale-95 active:bg-blue-50 disabled:cursor-default disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:active:bg-slate-700";
	const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v)));
	const known = Number.isFinite(value);
	return (
		<div className="flex flex-col gap-1">
			<FieldLabel>{label}</FieldLabel>
			<div className="flex items-center gap-2">
				<button type="button" className={btn} disabled={known && value <= min} onClick={() => onChange(known ? clamp(value - 1) : min)} aria-label={`Fewer ${label}`}>
					−
				</button>
				<NumInput
					label={label}
					numeric
					value={value}
					className="text-center"
					invalid={known && (value < min || value > max || !Number.isInteger(value))}
					onChange={(v) => onChange(Number.isFinite(v) ? Math.round(v) : v)}
					onBlurValue={(v) => {
						if (Number.isFinite(v)) onChange(clamp(v));
					}}
				/>
				<button type="button" className={btn} disabled={known && value >= max} onClick={() => onChange(known ? clamp(value + 1) : min)} aria-label={`More ${label}`}>
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
					className={`flex min-h-11 cursor-pointer select-none items-center justify-center gap-1.5 rounded-md px-2 py-1 text-center text-sm font-medium leading-tight transition active:scale-[0.97] ${
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
	<label title={title} className="flex min-h-12 cursor-pointer select-none items-center justify-between gap-3 text-sm font-medium">
		<span>{label}</span>
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			onClick={() => onChange(!checked)}
			className={`relative h-8 w-14 shrink-0 cursor-pointer rounded-full transition ${checked ? "bg-blue-600" : "bg-gray-300 dark:bg-slate-600"}`}
		>
			<span className={`absolute top-0.5 h-7 w-7 rounded-full bg-white shadow transition-all ${checked ? "left-[26px]" : "left-0.5"}`} />
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
			value={Number.isFinite(value) ? Math.min(Math.max(value, min), Math.max(max, min)) : min}
			onChange={(e) => onChange(e.currentTarget.valueAsNumber)}
			className="touch-range w-full accent-blue-600"
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
		<FieldLabel>{label}</FieldLabel>
		<span className="relative block">
			<NumInput
				label={label}
				value={value}
				placeholder={placeholder}
				invalid={invalid}
				allowEmpty
				className={suffix ? "pr-16" : ""}
				onChange={(v) => onChange(Number.isNaN(v) ? null : v)}
			/>
			{suffix ? <Suffix>{suffix}</Suffix> : null}
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

/** Extra settings that most jobs leave alone, behind a large tap target. */
export const More = ({ label = "More options", children }: { label?: string; children: ReactNode }) => (
	<details className="group mt-3 rounded-lg border border-gray-200 dark:border-slate-700">
		<summary className="flex min-h-12 cursor-pointer select-none list-none items-center justify-between px-3 text-sm font-medium text-gray-700 dark:text-slate-300 [&::-webkit-details-marker]:hidden">
			<span>{label}</span>
			<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" className="transition group-open:rotate-180" aria-hidden>
				<path d="M6 9l6 6 6-6" />
			</svg>
		</summary>
		<div className="flex flex-col gap-3 border-t border-gray-200 p-3 dark:border-slate-700">{children}</div>
	</details>
);

/** Short explanation under a control. */
export const Hint = ({ children }: { children: ReactNode }) => (
	<p className="m-0 text-xs text-gray-500 dark:text-slate-400">{children}</p>
);

/** Label / value rows for the final check step. A row whose value is missing is flagged. */
export const Summary = ({ rows }: { rows: [label: string, value: ReactNode][] }) => (
	<dl className="m-0 divide-y divide-gray-200 rounded-lg border border-gray-200 text-sm dark:divide-slate-700 dark:border-slate-700">
		{rows.map(([label, value]) => (
			<div key={label} className="flex items-baseline justify-between gap-3 px-3 py-2">
				<dt className="text-gray-500 dark:text-slate-400">{label}</dt>
				<dd className="m-0 text-right font-medium tabular-nums">{value}</dd>
			</div>
		))}
	</dl>
);

/** Formats a length (stored in mm) for display, or a dash when it is missing. */
export const lengthLabel = (mm: number, units: "mm" | "in"): string =>
	Number.isFinite(mm) ? `${Number((units === "in" ? mm / 25.4 : mm).toFixed(units === "in" ? 3 : 2))} ${units}` : "–";
