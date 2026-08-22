import type { ReactNode } from "react";

import type { Tool } from "./Editor";

/**
 * The toolbar glyphs, drawn on a 16×16 grid.
 *
 * Inline markup rather than an icon font or a sprite sheet: the studio fetches
 * nothing it did not build, and four paths are cheaper than the request that
 * would bring them in. Everything is stroked in `currentColor` so a button
 * carries its own colour — the pointer is filled because a hairline arrow at
 * this size reads as a smudge.
 */
const GLYPHS: Partial<Record<Tool, ReactNode>> = {
	select: (
		<path
			d="M3.4 1.4 3.4 13.4 6.4 10.5 8.3 14.4 10.2 13.5 8.3 9.7 12.4 9.4Z"
			fill="currentColor"
			stroke="none"
		/>
	),
	frame: <path d="M5.6 1.9v12.2M10.4 1.9v12.2M1.9 5.6h12.2M1.9 10.4h12.2" />,
	rect: <rect x="2.7" y="3.7" width="10.6" height="8.6" rx="1.6" />,
	text: <path d="M3.4 4.7V3.3h9.2v1.4M8 3.3v9.4M6.1 12.7h3.8" />,
};

export function ToolIcon({ tool }: { tool: Tool }) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.4"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			{GLYPHS[tool]}
		</svg>
	);
}
