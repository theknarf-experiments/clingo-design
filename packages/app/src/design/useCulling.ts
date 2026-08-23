import { type RefObject, useEffect, useState } from "react";
import { type Frame, expandFrame, framesIntersect } from "@clingo-design/design-core";
import type { CameraStore } from "@clingo-design/canvas";

/**
 * How far past the viewport an artboard still counts as visible, in screen
 * pixels. Wide enough that a flick of the wheel lands on something already
 * mounted rather than on a blank hole waiting for React.
 */
const MARGIN = 400;

function same(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
	if (a.size !== b.size) return false;
	for (const i of a) if (!b.has(i)) return false;
	return true;
}

/**
 * Which of `boxes` the camera can currently see, or null before the host has
 * been measured — meaning "no opinion yet", so nothing is hidden on the first
 * frame.
 *
 * The multiverse lays out two dozen full copies of the document, and at any
 * zoom worth editing at most of them are somewhere off in the corner. Rendering
 * them costs a React subtree and a pile of DOM each, for pixels nobody can see.
 *
 * State changes only when the *set* does. Panning fires the camera's listeners
 * on every pointer move, and a pan that reveals nothing new must not re-render
 * the studio — so the comparison happens outside React and only a genuine
 * change is handed to it.
 *
 * Strictly a reader: the camera belongs to the user, and nothing here moves it.
 */
export function useCulling(
	camera: CameraStore,
	host: RefObject<HTMLElement | null>,
	boxes: readonly Frame[],
): ReadonlySet<number> | null {
	const [visible, setVisible] = useState<ReadonlySet<number> | null>(null);

	useEffect(() => {
		const el = host.current;
		if (!el) return;
		let shown: ReadonlySet<number> | null = null;

		const update = () => {
			const rect = el.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) return;
			const cam = camera.get();
			// The camera's x/y is the canvas point at the viewport's top-left,
			// and a screen pixel is 1/scale canvas units across.
			const region = expandFrame(
				{
					x: cam.x,
					y: cam.y,
					width: rect.width / cam.scale,
					height: rect.height / cam.scale,
				},
				MARGIN / cam.scale,
			);
			const next = new Set<number>();
			boxes.forEach((box, i) => {
				if (framesIntersect(box, region)) next.add(i);
			});
			if (shown !== null && same(shown, next)) return;
			shown = next;
			setVisible(next);
		};

		update();
		const unsubscribe = camera.subscribe(update);
		// The panels either side of the canvas can resize it without the camera
		// moving at all.
		const observer = new ResizeObserver(update);
		observer.observe(el);
		return () => {
			unsubscribe();
			observer.disconnect();
		};
	}, [camera, host, boxes]);

	return visible;
}
