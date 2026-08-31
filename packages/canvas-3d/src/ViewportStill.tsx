/**
 * What a viewport shows when it is not drawing.
 *
 * **Not a placeholder for a missing feature.** Browsers cap live WebGL contexts
 * at somewhere around sixteen and start dropping the oldest past that, and the
 * studio lays out a couple of dozen universes side by side. So a still is what
 * twenty simultaneous 3D views *have to be*, and saying so is better than a
 * studio that goes black on the ninth artboard. `docs/three-d-spec.md` §8.3 says
 * which eight get to be live: the pinned universe, then the hovered one, then
 * document order.
 *
 * Three states, in the order they are preferred:
 *
 *   1. a **poster** — the last frame this viewport actually rendered, as a data
 *      URL, kept by whoever mounted it. A universe that has been live once and
 *      scrolled away from shows what it looked like;
 *   2. the viewport's **own fill**, which is a real property of a real rectangle
 *      and is exactly what shows behind a transparent scene, plus a label;
 *   3. nothing but the label, if the fill did not resolve to a colour.
 *
 * It is plain DOM, deliberately: no `<Canvas>`, no three.js, no WebGL context.
 * That is the entire point of the component — a still that cost a context would
 * not be a still.
 */
import { looksLikeColour } from "./units3.ts";

export interface ViewportStillProps {
	/**
	 * The viewport's own resolved properties — `ModelNode.rendered`. Only `fill`
	 * is read, and only when there is no poster.
	 */
	rendered?: { fill?: string };
	/** The last frame, as a data URL. */
	poster?: string;
	/** What to say where there is no poster: "3D view · 24 objects". */
	label: string;
}

export function ViewportStill({ rendered, poster, label }: ViewportStillProps) {
	const fill = looksLikeColour(rendered?.fill) ? rendered.fill : undefined;
	return (
		<div
			// `inset: 0` inside whatever absolutely-positioned box the artboard drew,
			// so this fills the viewport's frame exactly as the canvas would, and
			// swapping one for the other never moves a pixel.
			style={{
				position: "absolute",
				inset: 0,
				display: "grid",
				placeItems: "center",
				overflow: "hidden",
				background: poster ? `center / cover no-repeat url(${poster})` : fill,
			}}
			data-role="viewport-still"
		>
			{/*
			  * The label is hidden behind a poster rather than drawn over it: a
			  * poster *is* the picture, and a caption on top of it would be an
			  * annotation on a design nobody asked for. With no poster the label is
			  * the only thing there is to say.
			  */}
			{poster ? null : (
				<span
					style={{
						font: "500 12px/1.4 ui-sans-serif, system-ui, sans-serif",
						// Legible on the dark default fill and on a light one, without
						// knowing which it is: a translucent white pill on a dark plate.
						color: "#e2e8f0",
						background: "rgba(15, 23, 42, 0.55)",
						padding: "4px 10px",
						borderRadius: 999,
						pointerEvents: "none",
					}}
				>
					{label}
				</span>
			)}
		</div>
	);
}
