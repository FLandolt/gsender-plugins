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

/** Buttons as on the website: black (white in dark mode) for the main action, hairline outline for the rest. */
const baseBtn =
	"inline-flex h-[var(--ctl)] shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium transition duration-150 active:scale-[0.97] disabled:cursor-default disabled:opacity-35 disabled:active:scale-100";

const navBtn = `${baseBtn} border border-gray-200 bg-paper text-gray-900 shadow-[0_1px_2px_rgb(0_0_0/0.04)] hover:border-gray-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-slate-300`;

export const primaryBtn = `${baseBtn} bg-blue-600 px-5 text-white hover:bg-blue-700 dark:bg-blue-500 dark:text-slate-950 dark:hover:bg-blue-400`;

export const secondaryBtn = navBtn;

const Chevron = ({ dir }: { dir: "left" | "right" }) => (
	<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
		<path d={dir === "left" ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"} />
	</svg>
);

/** The website's mark: a ring with an accent dot, like the bit seen from above. */
const Mark = () => (
	<span aria-hidden className="relative inline-block h-4 w-4 shrink-0 rounded-full border-2 border-gray-900 dark:border-slate-100">
		<span className="absolute inset-[3px] rounded-full bg-blue-600 dark:bg-blue-400" />
	</span>
);

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
 * - The preview is always on screen: beside the settings on a landscape screen, below them on a
 *   portrait (9:16) or narrow one. Only the settings scroll.
 * - Back / Next, G-code and Load sit in the top bar; problems float in a card over the preview.
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
	/** The main buttons (Load to gSender, …), at the right of the top bar. */
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
		<div className="flex h-full flex-col bg-gray-50 text-gray-900 antialiased dark:bg-slate-950 dark:text-slate-100">
			<header className="shrink-0 border-b border-gray-200 bg-white/80 px-4 pt-2.5 backdrop-blur-xl backdrop-saturate-150 dark:border-slate-800 dark:bg-slate-950/70">
				{/* Title on the left, the controls on the right: Back / Next, G-code and the main actions. */}
				<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
					<div className="flex min-w-0 flex-1 basis-56 items-center gap-2.5">
						<Mark />
						<h1 className="m-0 shrink-0 text-[17px] font-semibold tracking-tight">{title}</h1>
						<p className="m-0 min-w-0 truncate text-[13px] text-gray-500 dark:text-slate-400" title={intro}>
							{intro}
						</p>
					</div>
					<div className="flex w-full flex-wrap items-center justify-end gap-2 sm:ml-auto sm:w-auto">
						<button type="button" className={`${navBtn} max-sm:px-3`} disabled={at === 0} onClick={() => setIndex(at - 1)} aria-label="Previous step">
							<Chevron dir="left" /> <span className="max-sm:hidden">Back</span>
						</button>
						<button type="button" className={`${navBtn} max-sm:px-3`} disabled={at === steps.length - 1} onClick={() => setIndex(at + 1)} aria-label="Next step">
							<span className="max-sm:hidden">Next</span> <Chevron dir="right" />
						</button>
						<span aria-hidden className="mx-1 hidden h-6 w-px bg-gray-200 sm:block dark:bg-slate-700" />
						<button type="button" className={secondaryBtn} disabled={!code} onClick={() => setShowCode((v) => !v)}>
							{showCode ? "Hide G-code" : "G-code"}
						</button>
						{actions}
					</div>
				</div>
				{status && (
					<p className={`m-0 mt-2 text-right text-[13px] ${status.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{status.text}</p>
				)}
				<nav aria-label="Steps" ref={tabs} className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 pb-2.5 pt-2.5">
					{steps.map((s, i) => {
						const current = i === at;
						return (
							<button
								key={s.id}
								type="button"
								aria-current={current ? "step" : undefined}
								onClick={() => setIndex(i)}
								className={`relative flex h-[var(--ctl)] shrink-0 cursor-pointer select-none items-center gap-2 rounded-full pl-1.5 pr-4 text-sm font-medium transition duration-150 active:scale-[0.97] ${
									current
										? "bg-gray-900 text-white dark:bg-slate-100 dark:text-gray-900"
										: "text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
								}`}
							>
								<span
									className={`flex h-7 w-7 items-center justify-center rounded-full font-mono text-[11px] font-semibold tabular-nums ${
										current
											? "bg-white/20 text-white dark:bg-gray-900/10 dark:text-gray-900"
											: s.issue
												? "bg-red-50 text-red-600 ring-1 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900"
												: "bg-white text-gray-600 ring-1 ring-gray-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
									}`}
								>
									{i + 1}
								</span>
								{s.label}
								{s.issue && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-950" aria-label="needs attention" />}
							</button>
						);
					})}
				</nav>
			</header>

			<main className="relative grid min-h-0 grow grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(200px,44%)] wide:grid-cols-[minmax(330px,430px)_minmax(0,1fr)] wide:grid-rows-1">
				{/* Preview: at the bottom in portrait, on the right in landscape. Never scrolls away. */}
				<section aria-label="Preview" className="order-2 flex min-h-0 min-w-0 flex-col gap-2.5 border-t border-gray-200 p-4 dark:border-slate-800 wide:border-t-0 wide:pl-0">
					{stats}
					<div className="relative min-h-0 grow">
						{showCode && code ? (
							<pre className="m-0 h-full overflow-auto rounded-xl border border-gray-200 bg-white p-4 font-mono text-[11px] leading-relaxed text-gray-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">{code}</pre>
						) : (
							preview
						)}
					</div>
				</section>

				{/* Settings for the current step */}
				<section ref={scroller} aria-label="Settings" className="order-1 min-h-0 overflow-y-auto overscroll-contain p-4">
					<div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_2px_rgb(0_0_0/0.03),0_8px_24px_-12px_rgb(0_0_0/0.08)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
						<header className="mb-4">
							<p className="m-0 font-mono text-[11px] uppercase tracking-[0.08em] text-gray-500 dark:text-slate-400">
								Step {at + 1} of {steps.length}
							</p>
							<h2 className="m-0 mt-1 text-[22px] font-semibold leading-tight tracking-[-0.02em]">{step.label}</h2>
							{step.hint ? <p className="m-0 mt-1 text-[13px] leading-snug text-gray-500 dark:text-slate-400">{step.hint}</p> : null}
						</header>
						<div className="flex flex-col gap-4">{step.content}</div>
					</div>
					{at < steps.length - 1 && (
						<button type="button" onClick={() => setIndex(at + 1)} className={`${navBtn} mt-3 w-full`}>
							Next: {steps[at + 1].label} <Chevron dir="right" />
						</button>
					)}
				</section>
				{/* Problems float over the bottom-right of the preview, so nothing shifts when they come and go. */}
				{notices ? <div className="pointer-events-none absolute bottom-4 right-4 z-20 flex max-w-[calc(100%-2rem)] justify-end">{notices}</div> : null}
			</main>

		</div>
	);
};

export default PluginLayout;

/** Shown in place of the 3D view while something still has to be fixed. */
export const PreviewPlaceholder = ({ text = "Fix the items marked in red to see the toolpath." }: { text?: string }) => (
	<div className="dot-grid flex h-full items-center justify-center rounded-xl border border-gray-200 bg-white p-4 text-center text-sm text-gray-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
		{text}
	</div>
);
