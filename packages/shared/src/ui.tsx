import type { ReactNode } from "react";

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

/** Pill-style choice between a few options. */
export const Segmented = <T extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label?: string;
	value: T;
	options: { value: T; label: string }[];
	onChange: (v: T) => void;
}) => (
	<div className="flex flex-col gap-1">
		{label ? <span className="text-xs font-medium text-gray-600 dark:text-slate-400">{label}</span> : null}
		<div className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-gray-100 p-1 dark:bg-slate-800">
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					onClick={() => onChange(o.value)}
					className={`h-10 cursor-pointer rounded-md px-2 text-sm font-medium transition ${
						o.value === value
							? "bg-white text-blue-700 shadow-sm dark:bg-slate-600 dark:text-white"
							: "text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100"
					}`}
				>
					{o.label}
				</button>
			))}
		</div>
	</div>
);

/** On/off switch with a label. */
export const Toggle = ({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: (v: boolean) => void;
}) => (
	<label className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium">
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
