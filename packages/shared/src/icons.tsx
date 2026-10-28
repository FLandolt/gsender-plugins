import type { ReactNode } from "react";

/** Small line icons for segmented buttons. They follow the text colour. */
const Icon = ({ children }: { children: ReactNode }) => (
	<svg
		viewBox="0 0 24 24"
		width="20"
		height="20"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.8"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden
	>
		{children}
	</svg>
);

export const ArrowsH = () => (
	<Icon>
		<path d="M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3" />
	</Icon>
);
export const ArrowsV = () => (
	<Icon>
		<path d="M12 4v16M9 7l3-3 3 3M9 17l3 3 3-3" />
	</Icon>
);
export const ArcIcon = () => (
	<Icon>
		<path d="M4 19a15 15 0 0 1 16-14" />
	</Icon>
);
export const LineIcon = () => (
	<Icon>
		<path d="M5 19 19 5" />
	</Icon>
);
/** Passes that run past the area (dashed) before turning. */
export const TurnOutside = () => (
	<Icon>
		<rect x="7" y="5" width="10" height="14" strokeDasharray="2 2" strokeWidth="1.2" opacity=".6" />
		<path d="M3 8h18v8H3" />
	</Icon>
);
/** Passes that turn on the edge of the area. */
export const TurnInside = () => (
	<Icon>
		<rect x="7" y="5" width="10" height="14" strokeDasharray="2 2" strokeWidth="1.2" opacity=".6" />
		<path d="M7 8h10v8H7" />
	</Icon>
);
export const Snake = () => (
	<Icon>
		<path d="M4 6h16v6H4v6h16" />
	</Icon>
);
export const SameWay = () => (
	<Icon>
		<path d="M4 6h15m-3-2.5L19 6l-3 2.5M4 12h15m-3-2.5 3 2.5-3 2.5M4 18h15m-3-2.5 3 2.5-3 2.5" />
	</Icon>
);
export const RectIcon = () => (
	<Icon>
		<rect x="4" y="6.5" width="16" height="11" rx="2" />
	</Icon>
);
export const CircleIcon = () => (
	<Icon>
		<circle cx="12" cy="12" r="7.5" />
	</Icon>
);
/** Turning clockwise / counter-clockwise: an open circle with an arrowhead. */
export const RotateCw = () => (
	<Icon>
		<path d="M19 12a7 7 0 1 1-2.05-4.95M19 4.5v3.5h-3.5" />
	</Icon>
);
export const RotateCcw = () => (
	<Icon>
		<path d="M5 12a7 7 0 1 0 2.05-4.95M5 4.5v3.5h3.5" />
	</Icon>
);

export const TextIcon = () => (
	<Icon>
		<path d="M5 6h14M12 6v13M9 19h6" />
	</Icon>
);
export const ShapesIcon = () => (
	<Icon>
		<path d="M8 19 14 7l6 12z" />
		<circle cx="7.5" cy="8.5" r="3.5" />
	</Icon>
);
export const ImageIcon = () => (
	<Icon>
		<rect x="4" y="5" width="16" height="14" rx="2" />
		<path d="m4 16 4-4 4 4 3-3 5 5" />
	</Icon>
);
