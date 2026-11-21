import { type ReactNode, useEffect, useRef, useState } from "react";

import { Stat } from "./ui";

export type Step = {
	id: string;
	/** Short name on the step's tab. */
	label: string;
	/** One line under the step's heading: what this step is for. */
	hint?: string;
	/** Something on this step still needs fixing: marks its tab. */
	issue?: boolean;
	content: ReactNode;
};

export type Status = { ok: boolean; text: string } | null;

const navBtn =
	"inline-flex h-12 shrink-0 cursor-pointer select-none items-center justify-center gap-1 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium transition hover:border-blue-500 active:scale-95 disabled:cursor-default disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800";

export const primaryBtn =
	"inline-flex h-12 shrink-0 cursor-pointer select-none items-center justify-center rounded-lg bg-blue-600 px-5 text-base font-semibold text-white shadow-sm transition hover:bg-blue-500 active:scale-95 disabled:cursor-default disabled:opacity-40";

export const secondaryBtn =
	"inline-flex h-12 shrink-0 cursor-pointer select-none items-center justify-center rounded-lg border border-gray-300 px-4 text-sm font-medium transition hover:border-blue-500 active:scale-95 disabled:cursor-default disabled:opacity-40 dark:border-slate-600";

/** The three figures over the preview. */
export const StatRow = ({ items }: { items: [label: string, value: string][] }) => (
	<div className={`grid shrink-0 gap-2 ${items.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
		{items.map(([label, value]) => (
			<Stat key={label} label={label} value={value} />
		))}
	</div>
);

/**
 * The frame every plugin shares, laid out for touch screens of any shape:
 *
 * - The settings are split into steps, shown one at a time. Tabs along the top jump to any step,
 *   Back / Next walk through them in order, and a red dot marks a step that still needs something.
 * - The preview is always on screen: beside the settings on a landscape screen, above them on a
 *   portrait (9:16) or narrow one. Only the settings scroll.
 * - Problems and the Load button stay pinned to the bottom.
 */
const PluginLayout = ({
	title,
	intro,
	steps,
	stats,
	preview,
	code,
	notices,
	actions,
	status,
}: {
	title: string;
	intro: string;
	steps: Step[];
	/** Figures shown over the preview. */
	stats?: ReactNode;
	/** The live visualisation; replaced by the G-code while that is shown. */
	preview: ReactNode;
	/** The program, for Show G-code. Empty disables the button. */
	code: string;
	notices?: ReactNode;
	/** The main buttons (Load to gSender, …), right-aligned in the bottom bar. */
	actions: ReactNode;
	status?: Status;
}) => {
	const [index, setIndex] = useState(0);
	const [showCode, setShowCode] = useState(false);
	const scroller = useRef<HTMLDivElement>(null);
	const tabs = useRef<HTMLDivElement>(null);
	const at = Math.min(index, steps.length - 1);
	const step = steps[at];

	useEffect(() => {
		scroller.current?.scrollTo({ top: 0 });
		const tab = tabs.current?.children[at] as HTMLElement | undefined;
		tab?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "smooth" });
	}, [at]);

	useEffect(() => {
		if (!code) setShowCode(false);
	}, [code]);

	return (
		<div className="flex h-full flex-col bg-gray-50 text-gray-900 dark:bg-slate-950 dark:text-slate-100">
			<header className="shrink-0 border-b border-gray-200 bg-white px-3 pt-2 dark:border-slate-800 dark:bg-slate-900">
				<div className="flex min-w-0 items-baseline gap-3">
					<h1 className="m-0 shrink-0 text-lg font-semibold">{title}</h1>
					<p className="m-0 min-w-0 truncate text-xs text-gray-500 dark:text-slate-400" title={intro}>
						{intro}
					</p>
				</div>
				<nav aria-label="Steps" ref={tabs} className="no-scrollbar -mx-3 flex gap-1 overflow-x-auto px-3 pb-2 pt-1.5">
					{steps.map((s, i) => {
						const current = i === at;
						return (
							<button
								key={s.id}
								type="button"
								aria-current={current ? "step" : undefined}
								onClick={() => setIndex(i)}
								className={`relative flex min-h-11 shrink-0 cursor-pointer select-none items-center gap-2 rounded-full border py-1 pl-1.5 pr-3.5 text-sm font-medium transition active:scale-95 ${
									current
										? "border-blue-600 bg-blue-600 text-white shadow-sm"
										: "border-gray-200 bg-gray-50 text-gray-700 hover:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
								}`}
							>
								<span
									className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
										current ? "bg-white/25 text-white" : s.issue ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-slate-200"
									}`}
								>
									{i + 1}
								</span>
								{s.label}
								{s.issue && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-900" aria-label="needs attention" />}
							</button>
						);
					})}
				</nav>
			</header>

			<main className="grid min-h-0 grow grid-cols-1 grid-rows-[minmax(190px,44%)_minmax(0,1fr)] wide:grid-cols-[minmax(330px,430px)_minmax(0,1fr)] wide:grid-rows-1">
				{/* Preview: on top in portrait, on the right in landscape. Never scrolls away. */}
				<section aria-label="Preview" className="order-1 flex min-h-0 min-w-0 flex-col gap-2 border-b border-gray-200 p-3 dark:border-slate-800 wide:order-2 wide:border-b-0 wide:pl-0">
					{stats}
					<div className="relative min-h-0 grow">
						{showCode && code ? (
							<pre className="m-0 h-full overflow-auto rounded-xl bg-gray-100 p-3 font-mono text-[11px] leading-relaxed dark:bg-slate-900">{code}</pre>
						) : (
							preview
						)}
					</div>
				</section>

				{/* Settings for the current step */}
				<section ref={scroller} aria-label="Settings" className="order-2 min-h-0 overflow-y-auto overscroll-contain p-3 wide:order-1">
					<div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
						<header className="mb-3">
							<p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
								Step {at + 1} of {steps.length}
							</p>
							<h2 className="m-0 text-base font-semibold">{step.label}</h2>
							{step.hint ? <p className="m-0 mt-0.5 text-xs text-gray-500 dark:text-slate-400">{step.hint}</p> : null}
						</header>
						<div className="flex flex-col gap-3">{step.content}</div>
					</div>
					{at < steps.length - 1 && (
						<button type="button" onClick={() => setIndex(at + 1)} className={`${navBtn} mt-3 w-full`}>
							Next: {steps[at + 1].label} ›
						</button>
					)}
				</section>
			</main>

			{notices}

			<footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-gray-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
				<button type="button" className={navBtn} disabled={at === 0} onClick={() => setIndex(at - 1)} aria-label="Previous step">
					‹ Back
				</button>
				<button type="button" className={navBtn} disabled={at === steps.length - 1} onClick={() => setIndex(at + 1)} aria-label="Next step">
					Next ›
				</button>
				{status && (
					<span className={`min-w-0 text-sm ${status.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{status.text}</span>
				)}
				<div className="ml-auto flex flex-wrap items-center justify-end gap-2">
					<button type="button" className={secondaryBtn} disabled={!code} onClick={() => setShowCode((v) => !v)}>
						{showCode ? "Hide G-code" : "G-code"}
					</button>
					{actions}
				</div>
			</footer>
		</div>
	);
};

export default PluginLayout;

/** Shown in place of the 3D view while something still has to be fixed. */
export const PreviewPlaceholder = ({ text = "Fix the items marked in red to see the toolpath." }: { text?: string }) => (
	<div className="flex h-full items-center justify-center rounded-xl border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500 dark:border-slate-700 dark:text-slate-400">
		{text}
	</div>
);
