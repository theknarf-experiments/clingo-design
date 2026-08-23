import { useCallback, useEffect, useState } from "react";

import styles from "./PanelResizer.module.css";

/** Narrow enough to be a sliver, wide enough to still hold a layer name. */
const MIN = 150;
const MAX = 560;

const clamp = (n: number) => Math.max(MIN, Math.min(MAX, Math.round(n)));

/**
 * A remembered panel width.
 *
 * localStorage rather than the document: how wide someone likes their layer
 * list is about them, not about the design, and it has no business travelling
 * to whoever they share the file with.
 */
export function usePanelWidth(
	key: string,
	fallback: number,
): [number, (next: number) => void] {
	const [width, setWidth] = useState(() => {
		try {
			const stored = Number(localStorage.getItem(key));
			return Number.isFinite(stored) && stored > 0 ? clamp(stored) : fallback;
		} catch {
			// Blocked storage is not a reason to fail to render a sidebar.
			return fallback;
		}
	});

	useEffect(() => {
		try {
			localStorage.setItem(key, String(width));
		} catch {
			// As above: the width simply will not be remembered.
		}
	}, [key, width]);

	return [width, useCallback((next: number) => setWidth(clamp(next)), [])];
}

export interface PanelResizerProps {
	/** Which side of the window the panel it resizes is on. */
	side: "left" | "right";
	width: number;
	onResize: (next: number) => void;
	label: string;
}

/**
 * The draggable seam between a side panel and the canvas.
 *
 * Its own grid column rather than something positioned over the panel: the
 * panels scroll, and an absolutely-placed handle inside one would scroll away
 * with the content it is supposed to sit beside.
 */
export function PanelResizer({ side, width, onResize, label }: PanelResizerProps) {
	const [dragging, setDragging] = useState(false);

	function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
		if (event.button !== 0) return;
		event.preventDefault();
		const body = event.currentTarget.parentElement?.getBoundingClientRect();
		if (!body) return;
		setDragging(true);

		const move = (e: PointerEvent) => {
			onResize(side === "left" ? e.clientX - body.left : body.right - e.clientX);
		};
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			setDragging(false);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	}

	return (
		<div
			className={dragging ? `${styles.seam} ${styles.active}` : styles.seam}
			data-resizer={side}
			data-dragging={dragging ? "" : undefined}
			role="separator"
			aria-orientation="vertical"
			aria-label={label}
			aria-valuenow={width}
			aria-valuemin={MIN}
			aria-valuemax={MAX}
			tabIndex={0}
			onPointerDown={onPointerDown}
			// A seam that can only be dragged is a seam some people cannot move.
			onKeyDown={(e) => {
				const step = e.shiftKey ? 32 : 8;
				const away = side === "left" ? 1 : -1;
				if (e.key === "ArrowLeft") onResize(width - step * away);
				else if (e.key === "ArrowRight") onResize(width + step * away);
				else return;
				e.preventDefault();
			}}
		/>
	);
}
