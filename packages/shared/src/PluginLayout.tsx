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

/** Buttons: one control height (--ctl), orange for the main action, a hairline outline for the rest. */
const baseBtn =
	"inline-flex h-[var(--ctl)] shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition duration-150 active:scale-[0.97] disabled:cursor-default disabled:opacity-35 disabled:active:scale-100";

const navBtn = `${baseBtn} border border-gray-200 bg-paper text-gray-900 shadow-[0_1px_2px_rgb(0_0_0/0.04)] hover:border-gray-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-slate-300`;

export const primaryBtn = `${baseBtn} bg-blue-600 px-6 text-white hover:bg-blue-700 dark:bg-blue-500 dark:text-slate-950 dark:hover:bg-blue-400`;

export const secondaryBtn = navBtn;

/** A ring with an accent dot, like the bit seen from above. */
const Mark = () => (
	<span aria-hidden className="relative inline-block h-4 w-4 shrink-0 rounded-full border-2 border-gray-900 dark:border-slate-100">
		<span className="absolute inset-[3px] rounded-full bg-blue-600 dark:bg-blue-400" />
	</span>
);

/**
 * The figures under the preview: big mono readouts in a ruled row (hairlines come from a 1 px gap
 * over a border-coloured background, so any number of cells lines up).
 */
export const StatRow = ({ items }: { items: [label: string, value: string][] }) => (
	<div className={`grid shrink-0 gap-px border-t border-gray-200 bg-gray-200 dark:border-slate-700 dark:bg-slate-700 ${items.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
		{items.map(([label, value]) => (
			<Stat key={label} label={label} value={value} />
		))}
	</div>
);

const panel =
	"flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgb(0_0_0/0.05),0_6px_20px_-8px_rgb(0_0_0/0.1)] dark:border dark:border-slate-700 dark:bg-slate-900 dark:shadow-none";

/**
 * The frame every plugin shares. Two panels that keep their size whatever you do:
 *
 * - Left: the settings. A segmented tab bar picks the step (a red dot marks a step that still needs
 *   something); only the step's content scrolls.
 * - Right: the live preview, the figures, and one bar with the main action.
 *
 * On a landscape screen the panels sit side by side; on a portrait (9:16) or narrow screen the
 * settings come first with the preview below. Problems float over the preview, so nothing shifts
 * when they come and go.
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
	/** Figures shown under the preview. */
	stats?: ReactNode;
	/** The live visualisation; replaced by the G-code while that is shown. */
	preview: ReactNode;
	/** The program, for Show G-code. Empty disables the button. */
	code: string;
	notices?: ReactNode;
	/** The main buttons (Load to gSender, …), at the right of the bottom bar. */
	actions: ReactNode;
	status?: Status;
}) => {
	const [index, setIndex] = useState(0);
	const [showCode, setShowCode] = useState(false);
	const scroller = useRef<HTMLDivElement>(null);
	const tabs = useRef<HTMLElement>(null);
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
		<div className="flex h-full flex-col gap-4 bg-gray-50 p-4 text-gray-900 antialiased dark:bg-slate-950 dark:text-slate-100 wide:gap-5 wide:p-6">
			<header className="flex shrink-0 items-center gap-2.5 px-1">
				<Mark />
				<h1 className="m-0 shrink-0 text-[19px] font-semibold tracking-tight">{title}</h1>
				<p className="m-0 min-w-0 truncate text-[13px] text-gray-500 dark:text-slate-400" title={intro}>
					{intro}
				</p>
			</header>

			<main className="grid min-h-0 grow grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(300px,52%)] gap-4 wide:grid-cols-[minmax(340px,440px)_minmax(0,1fr)] wide:grid-rows-1 wide:gap-5">
				{/* Settings */}
				<section aria-label="Settings" className={panel}>
					<nav
						aria-label="Steps"
						ref={tabs}
						className="no-scrollbar m-3 mb-0 flex h-[var(--ctl)] shrink-0 gap-0.5 overflow-x-auto rounded-[13px] bg-gray-100 p-[3px] dark:bg-slate-800"
					>
						{steps.map((s, i) => {
							const current = i === at;
							return (
								<button
									key={s.id}
									type="button"
									aria-current={current ? "step" : undefined}
									onClick={() => setIndex(i)}
									className={`relative flex h-[calc(var(--ctl)-6px)] flex-1 shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap rounded-[10px] px-2 text-[13px] transition duration-200 active:scale-[0.97] ${
										current
											? "bg-paper font-semibold text-gray-900 shadow-[0_3px_8px_rgb(0_0_0/0.12),0_3px_1px_rgb(0_0_0/0.04)] dark:bg-slate-600 dark:text-white"
											: "font-medium text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100"
									}`}
								>
									{s.label}
									{s.issue && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" aria-label="needs attention" />}
								</button>
							);
						})}
					</nav>
					<div ref={scroller} className="min-h-0 grow overflow-y-auto overscroll-contain p-5">
						<h2 className="m-0 text-[22px] font-semibold leading-tight tracking-[-0.02em]">{step.label}</h2>
						{step.hint ? <p className="m-0 mt-1 text-[13px] leading-snug text-gray-500 dark:text-slate-400">{step.hint}</p> : null}
						<div className="mt-5 flex flex-col gap-4">{step.content}</div>
					</div>
				</section>

				{/* Preview, figures and the main action */}
				<section aria-label="Preview" className={panel}>
					<div className="relative min-h-0 grow p-4">
						{showCode && code ? (
							<pre className="m-0 h-full overflow-auto rounded-xl border border-gray-200 bg-paper p-4 font-mono text-[11px] leading-relaxed text-gray-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">{code}</pre>
						) : (
							preview
						)}
						{notices ? <div className="pointer-events-none absolute bottom-6 right-6 z-20 flex max-w-[calc(100%-3rem)] justify-end">{notices}</div> : null}
					</div>
					{stats}
					<div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-gray-200 px-5 py-4 dark:border-slate-700">
						<p className="m-0 min-w-0 flex-1 basis-48 text-[13px] text-gray-500 dark:text-slate-400">
							{status ? (
								<span className={status.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}>{status.text}</span>
							) : (
								<>
									<b className="font-semibold text-gray-900 dark:text-slate-100">Always air-cut first.</b> Check the preview before cutting material.
								</>
							)}
						</p>
						<div className="flex flex-wrap items-center justify-end gap-2">
							<button type="button" className={secondaryBtn} disabled={!code} onClick={() => setShowCode((v) => !v)}>
								{showCode ? "Hide G-code" : "G-code"}
							</button>
							{actions}
						</div>
					</div>
				</section>
			</main>
		</div>
	);
};

export default PluginLayout;

/** Shown in place of the 3D view while something still has to be fixed. */
export const PreviewPlaceholder = ({ text = "Fix the items marked in red to see the toolpath." }: { text?: string }) => (
	<div className="dot-grid flex h-full items-center justify-center rounded-xl border border-gray-200 bg-paper p-4 text-center text-sm text-gray-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
		{text}
	</div>
);
