import { type CSSProperties, type ReactNode, useState } from "react";

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
	<section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
		<header className="mb-3">
			<h2 className="m-0 text-[15px] font-semibold tracking-tight text-gray-900 dark:text-slate-100">
				{title}
			</h2>
			{hint ? <p className="m-0 mt-0.5 text-xs text-gray-500 dark:text-slate-400">{hint}</p> : null}
		</header>
		{children}
	</section>
);

const inputBase =
	"h-12 w-full rounded-lg border border-gray-200 bg-white px-3.5 text-[17px] tabular-nums text-gray-900 shadow-[0_1px_2px_rgb(0_0_0/0.04)] outline-none transition placeholder:text-gray-400 hover:border-gray-300 focus:border-gray-900 focus:ring-4 focus:ring-gray-900/[0.07] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:hover:border-slate-600 dark:focus:border-slate-200 dark:focus:ring-white/10";
const invalidRing = "!border-red-500 !ring-4 !ring-red-500/15";

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
	<span className="text-[13px] font-medium text-gray-600 dark:text-slate-400">{children}</span>
);

const Suffix = ({ children }: { children: ReactNode }) => (
	<span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center font-mono text-xs text-gray-400 dark:text-slate-500">{children}</span>
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
	<label className="flex flex-col gap-1.5">
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
		{hint ? <span className="text-[13px] text-gray-500 dark:text-slate-400">{hint}</span> : null}
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
		"flex h-12 w-14 shrink-0 cursor-pointer select-none items-center justify-center rounded-lg border border-gray-200 bg-white text-2xl font-light leading-none text-gray-900 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition hover:border-gray-400 active:scale-95 active:bg-gray-100 disabled:cursor-default disabled:opacity-35 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-500 dark:active:bg-slate-800";
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
	<div className="min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
		<div className="truncate font-mono text-[10px] uppercase tracking-[0.08em] text-gray-500 dark:text-slate-400">{label}</div>
		<div className="truncate text-[15px] font-semibold tracking-tight tabular-nums">{value}</div>
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
	<div className="flex flex-col gap-1.5" title={title}>
		{label ? <span className="text-[13px] font-medium text-gray-600 dark:text-slate-400">{label}</span> : null}
		<div className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-[11px] bg-gray-100 p-[3px] dark:bg-slate-800">
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					title={o.title}
					aria-pressed={o.value === value}
					onClick={() => onChange(o.value)}
					className={`flex min-h-11 cursor-pointer select-none items-center justify-center gap-1.5 rounded-[9px] px-2 py-1 text-center text-sm leading-tight transition duration-200 active:scale-[0.97] ${
						o.value === value
							? "bg-white font-semibold text-gray-900 shadow-[0_3px_8px_rgb(0_0_0/0.12),0_3px_1px_rgb(0_0_0/0.04)] dark:bg-slate-600 dark:text-white"
							: "font-medium text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100"
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
			className={`relative h-[31px] w-[51px] shrink-0 cursor-pointer rounded-full transition ${checked ? "bg-blue-600" : "bg-gray-200 dark:bg-slate-600"}`}
		>
			<span className={`absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgb(0_0_0/0.15),0_3px_1px_rgb(0_0_0/0.06)] transition-all ${checked ? "left-[22px]" : "left-[2px]"}`} />
		</button>
	</label>
);

/**
 * Slider paired with the number field it drives. The slider moves in steps of `step` (0.5 by
 * default) so it lands on round numbers; the box still takes any exact value.
 */
export const SliderField = ({
	label,
	value,
	min,
	max,
	step = 0.5,
	suffix,
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	/** Slider increment, in the shown units. */
	step?: number;
	suffix?: string;
	onChange: (v: number) => void;
}) => {
	// Top of the slider: the largest whole step that fits under the maximum.
	const top = Number.isFinite(max) ? Math.max(min, min + Math.floor((max - min) / step + 1e-9) * step) : min;
	return (
		<div className="flex flex-col gap-1">
			<NumberField label={label} value={value} suffix={suffix} onChange={onChange} />
			<input
				type="range"
				min={min}
				max={top}
				step={step}
				value={Number.isFinite(value) ? Math.min(Math.max(value, min), top) : min}
				onChange={(e) => onChange(Number((Math.round(e.currentTarget.valueAsNumber / step) * step).toFixed(4)))}
				className="touch-range w-full"
				style={{ "--fill": `${top > min && Number.isFinite(value) ? (Math.min(Math.max(value, min), top) - min) / (top - min) * 100 : 0}%` } as CSSProperties}
				aria-label={`${label} slider`}
			/>
		</div>
	);
};

/**
 * Problems, warnings and things still to do, in a strip that sits above the action bar. It is
 * outside the scrolling settings column, so it stays in view however far the form is scrolled.
 */
export const Notices = ({ errors = [], warnings = [], info = [] }: { errors?: string[]; warnings?: string[]; info?: string[] }) => {
	if (errors.length === 0 && warnings.length === 0 && info.length === 0) return null;
	const icon = (kind: "e" | "w" | "i") => (
		<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden className={`mt-[2px] shrink-0 ${kind === "e" ? "text-red-600 dark:text-red-400" : kind === "w" ? "text-amber-600 dark:text-amber-400" : "text-blue-600 dark:text-blue-400"}`}>
			{kind === "w" ? (
				<path fill="currentColor" d="M8.9 1.6a1 1 0 0 0-1.8 0L.6 13.5A1 1 0 0 0 1.5 15h13a1 1 0 0 0 .9-1.5L8.9 1.6ZM7.25 6h1.5v4.5h-1.5V6Zm.75 7.25a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
			) : kind === "e" ? (
				<path fill="currentColor" d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm-.75 3.5h1.5v6h-1.5v-6ZM8 12.75a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
			) : (
				<path fill="currentColor" d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm.75 12.5h-1.5v-6h1.5v6ZM8 5.25a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
			)}
		</svg>
	);
	const row = (text: string, kind: "e" | "w" | "i") => (
		<li key={`${kind}-${text}`} className="flex gap-2.5 py-1">
			{icon(kind)}
			<span>{text}</span>
		</li>
	);
	return (
		<div role="alert" className="shrink-0 border-t border-gray-200 bg-white/85 px-4 py-1.5 text-[13px] text-gray-800 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/85 dark:text-slate-200">
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
	<label className="flex flex-col gap-1.5">
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
		{hint ? <span className="text-[13px] text-gray-500 dark:text-slate-400">{hint}</span> : null}
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
		<span className="flex h-11 shrink-0 items-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition hover:border-gray-900 active:scale-95 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-300">
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
	<details className="group mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
		<summary className="flex min-h-12 cursor-pointer select-none list-none items-center justify-between px-4 text-sm font-medium text-gray-900 transition hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800 [&::-webkit-details-marker]:hidden">
			<span>{label}</span>
			<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-400 transition duration-200 group-open:rotate-180" aria-hidden>
				<path d="M6 9l6 6 6-6" />
			</svg>
		</summary>
		<div className="flex flex-col gap-4 border-t border-gray-200 p-4 dark:border-slate-700">{children}</div>
	</details>
);

/** Short explanation under a control. */
export const Hint = ({ children }: { children: ReactNode }) => (
	<p className="m-0 text-[13px] leading-snug text-gray-500 dark:text-slate-400">{children}</p>
);

/** Label / value rows for the final check step. A row whose value is missing is flagged. */
export const Summary = ({ rows }: { rows: [label: string, value: ReactNode][] }) => (
	<dl className="m-0 divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white text-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900">
		{rows.map(([label, value]) => (
			<div key={label} className="flex min-h-11 items-center justify-between gap-4 px-4 py-2">
				<dt className="text-gray-500 dark:text-slate-400">{label}</dt>
				<dd className="m-0 text-right font-medium tabular-nums text-gray-900 dark:text-slate-100">{value}</dd>
			</div>
		))}
	</dl>
);

/** Formats a length (stored in mm) for display, or a dash when it is missing. */
export const lengthLabel = (mm: number, units: "mm" | "in"): string =>
	Number.isFinite(mm) ? `${Number((units === "in" ? mm / 25.4 : mm).toFixed(units === "in" ? 3 : 2))} ${units}` : "–";
