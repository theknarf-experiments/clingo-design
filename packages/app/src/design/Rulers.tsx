import {
	type CSSProperties,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	type Emu,
	type Point,
	type Ruler,
	type Unit,
	UNITS,
	quantizeGesture,
	rulerFor,
} from "@clingo-design/design-core";
import type { CameraStore } from "@clingo-design/canvas";

import { cx } from "./cx";
import styles from "./Rulers.module.css";
import {
	canvasPx,
	documentLength,
	documentPoint,
	documentRange,
	screenPx,
} from "./viewport";

/**
 * How thick a strip is, in CSS pixels.
 *
 * Set as a custom property on the root rather than written into the stylesheet,
 * because three things have to agree about it — the strip's own size, the
 * corner that covers the intersection, and the offset the other strip starts at
 * — and a number typed into a CSS file three times is a number that drifts.
 */
const THICKNESS = 22;

export interface RulersProps {
	/**
	 * The camera, shared with the canvas. Subscribed to rather than sampled: the
	 * ruler has to move with a pan, and a pan does not re-render the studio.
	 */
	camera: CameraStore;
	/** What the ticks are read in — the document's display unit. */
	unit: Unit;
	/** Where zero is, in the document's own coordinates. */
	zero: Point;
	onZeroChange: (zero: Point) => void;
	/**
	 * A line pulled out of a strip and let go over the design, as a point in the
	 * document's own coordinates.
	 *
	 * The axis is the line's, not the strip's, and the two are deliberately not
	 * the same: the ruler along the top *measures* x, and what you pull out of it
	 * is a horizontal line, whose position is a y. Which surface the line then
	 * belongs to is the document's question and is answered by the caller — this
	 * component knows about pixels, a unit and a zero point, and nothing about
	 * what is drawn under it.
	 */
	onDrawGuide?: (axis: "x" | "y", at: Point) => void;
}

/**
 * Rulers down the canvas's top and left edges, with a zero point the designer
 * can put wherever they are measuring from.
 *
 * Mounted as a sibling of the canvas rather than inside it, which is the whole
 * architectural point: `packages/canvas` is a generic pan/zoom surface that
 * knows about a camera and nothing else, and a ruler is made of the two things
 * it must never learn — a unit and a document origin. It needs nothing new from
 * that package either; `cameraStore` and `getCamera()` already exist, so this
 * subscribes to the same store the canvas draws from and lays itself out over
 * the top, untransformed.
 *
 * The split inside the editor is the same one everywhere else: where the ticks
 * fall and what they read is arithmetic, and it lives in design-core's
 * `ruler.ts` in the document's own EMU; where they land on a screen is this
 * file, and every one of those coordinates crosses through `viewport.ts`.
 * Nothing here converts a unit by hand.
 *
 * The one gesture a strip has is the one every tool with rulers and guides
 * gives it: press on a strip and drag out onto the design, and a line comes
 * with you. That is why the zero point is on the *corner* rather than anywhere
 * along a strip — the strips were spoken for. Let go without leaving the strip
 * and nothing is drawn, which is the undo for a gesture that has not happened
 * yet.
 */
export function Rulers({
	camera,
	unit,
	zero,
	onZeroChange,
	onDrawGuide,
}: RulersProps) {
	const host = useRef<HTMLDivElement>(null);
	const cam = useSyncExternalStore(camera.subscribe, camera.get);
	const [size, setSize] = useState({ width: 0, height: 0 });
	/**
	 * The line being pulled out, while it is being pulled: which axis it will be
	 * on, where it is now, and whether it has left the strip yet.
	 *
	 * Held here rather than handed upward on every move, because until it is
	 * dropped it is not a guide — it is a gesture, and a gesture that wrote to
	 * the document on every pointermove would fill the undo stack with a line
	 * that does not exist yet.
	 */
	const [pulling, setPulling] = useState<
		{ axis: "x" | "y"; at: Point; out: boolean } | null
	>(null);

	// How much of the design is on screen depends on the window as well as on
	// the camera, and the panels either side can resize the canvas without the
	// camera moving at all.
	useEffect(() => {
		const el = host.current;
		if (!el) return;
		const observer = new ResizeObserver(() => {
			const rect = el.getBoundingClientRect();
			setSize((prev) =>
				prev.width === rect.width && prev.height === rect.height
					? prev
					: { width: rect.width, height: rect.height },
			);
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const spanX = documentRange(cam.x, size.width, cam.scale);
	const spanY = documentRange(cam.y, size.height, cam.scale);
	const across = rulerFor({ ...spanX, zero: zero.x, unit, scale: cam.scale });
	const down = rulerFor({ ...spanY, zero: zero.y, unit, scale: cam.scale });

	/**
	 * The unlabelled marks, as a repeating background rather than as a mark
	 * each.
	 *
	 * There can be a couple of hundred of them across a wide window, and the
	 * camera fires its listeners on every pointer move of a pan — so drawing
	 * them as DOM would mean re-laying-out a few hundred nodes per frame for
	 * hairlines nobody counts individually. A tiled gradient is the same trick
	 * the canvas's own dot grid uses, for the same reason, and it costs one
	 * style property. The labelled ticks stay real elements, because they carry
	 * text and there are a dozen of them.
	 */
	function marks(
		ruler: Ruler,
		span: { from: Emu },
		at: Emu,
		cameraAt: number,
		horizontal: boolean,
	): CSSProperties | undefined {
		if (ruler.minor >= ruler.step) return undefined;
		const gap = canvasPx(ruler.minor) * cam.scale;
		// The first mark at or past the near edge: the tile's phase, and always
		// inside one tile of it, so the browser is never asked to offset a
		// background by half the window.
		const first = at + Math.ceil((span.from - at) / ruler.minor) * ruler.minor;
		const phase = screenPx(first, cameraAt, cam.scale);
		const line = horizontal ? "to right" : "to bottom";
		return {
			backgroundImage: `linear-gradient(${line}, var(--dc-line) 0 1px, transparent 1px)`,
			backgroundSize: horizontal ? `${gap}px 6px` : `6px ${gap}px`,
			backgroundPosition: horizontal ? `${phase}px bottom` : `right ${phase}px`,
			backgroundRepeat: horizontal ? "repeat-x" : "repeat-y",
		};
	}

	/**
	 * Put the zero point under the pointer.
	 *
	 * Quantized to a whole unit of whatever the ruler is marked in, because this
	 * is a gesture and every gesture in this editor is — the same argument
	 * `quantizeGesture` makes for a drag, one step out: a zero point a
	 * thousandth of a millimetre off the corner it was aimed at makes every
	 * label on both rulers read as nearly-round for ever.
	 */
	function place(event: { clientX: number; clientY: number }, rect: DOMRect): Point {
		const current = camera.get();
		const at = documentPoint(event, rect, current.scale, {
			x: documentLength(current.x),
			y: documentLength(current.y),
		});
		return { x: quantizeGesture(at.x, unit), y: quantizeGesture(at.y, unit) };
	}

	function grabZero(event: ReactPointerEvent) {
		if (event.button !== 0) return;
		const rect = host.current?.getBoundingClientRect();
		if (!rect) return;
		event.preventDefault();
		event.stopPropagation();
		let moved = false;
		const drag = (e: globalThis.PointerEvent) => {
			moved = true;
			onZeroChange(place(e, rect));
		};
		const drop = () => {
			window.removeEventListener("pointermove", drag);
			window.removeEventListener("pointerup", drop);
			// A press that went nowhere is a click, and the only thing a click on
			// the zero point can sensibly mean is "put it back". There is nowhere
			// else to hang the reset, and it is the gesture every tool with a
			// movable zero already uses.
			if (!moved) onZeroChange({ x: 0, y: 0 });
		};
		window.addEventListener("pointermove", drag);
		window.addEventListener("pointerup", drop);
	}

	/**
	 * Pull a line out of a strip.
	 *
	 * `axis` here is the strip's — which way it measures — and the line that
	 * comes out of it is the other one: the ruler along the top measures x and
	 * yields a horizontal line, whose position is a y. The two are named apart
	 * on purpose, because getting them the same way round is the classic way to
	 * build rulers that draw guides at right angles to where they were dragged.
	 *
	 * "Out of the strip" is measured against the strip's own thickness, which is
	 * the same test the eye makes: while the pointer is still on the ruler
	 * nothing has been pulled out of it, and letting go there draws nothing.
	 */
	function pull(strip: "x" | "y", event: ReactPointerEvent) {
		if (event.button !== 0 || !onDrawGuide) return;
		const rect = host.current?.getBoundingClientRect();
		if (!rect) return;
		event.preventDefault();
		event.stopPropagation();
		const axis: "x" | "y" = strip === "x" ? "y" : "x";
		const left = (e: { clientX: number; clientY: number }) =>
			strip === "x"
				? e.clientY - rect.top > THICKNESS
				: e.clientX - rect.left > THICKNESS;
		let state = { axis, at: place(event, rect), out: left(event) };
		setPulling(state);
		const drag = (e: globalThis.PointerEvent) => {
			state = { axis, at: place(e, rect), out: left(e) };
			setPulling(state);
		};
		const drop = () => {
			window.removeEventListener("pointermove", drag);
			window.removeEventListener("pointerup", drop);
			setPulling(null);
			if (state.out) onDrawGuide(axis, state.at);
		};
		window.addEventListener("pointermove", drag);
		window.addEventListener("pointerup", drop);
	}

	const home = zero.x === 0 && zero.y === 0;

	return (
		<div
			ref={host}
			className={styles.rulers}
			data-role="rulers"
			style={{ "--ruler": `${THICKNESS}px` } as CSSProperties}
		>
			<div
				className={cx(styles.strip, styles.across)}
				data-role="ruler"
				data-axis="x"
				aria-hidden="true"
				style={marks(across, spanX, zero.x, cam.x, true)}
				onPointerDown={(e) => pull("x", e)}
			>
				{across.ticks.map((tick) => (
					<div
						key={tick.at}
						className={styles.tick}
						style={{ left: screenPx(tick.at, cam.x, cam.scale) }}
					>
						<span className={styles.label}>{tick.label}</span>
					</div>
				))}
			</div>

			<div
				className={cx(styles.strip, styles.down)}
				data-role="ruler"
				data-axis="y"
				aria-hidden="true"
				style={marks(down, spanY, zero.y, cam.y, false)}
				onPointerDown={(e) => pull("y", e)}
			>
				{down.ticks.map((tick) => (
					<div
						key={tick.at}
						className={styles.tick}
						style={{ top: screenPx(tick.at, cam.y, cam.scale) }}
					>
						<span className={styles.label}>{tick.label}</span>
					</div>
				))}
			</div>

			{/* The line as it is being pulled, drawn across the whole canvas rather
			    than across whatever surface it will land on — because until it is
			    dropped it belongs to nothing, and picking a surface early would
			    mean the preview jumping between artboards as the pointer crossed
			    them. It goes dim while the pointer is still over the strip, which
			    is the same thing as saying "let go here and nothing happens". */}
			{pulling ? (
				<div
					className={styles.pulled}
					data-role="pulled-guide"
					data-axis={pulling.axis}
					data-out={pulling.out ? "" : undefined}
					style={
						pulling.axis === "x"
							? { left: screenPx(pulling.at.x, cam.x, cam.scale), top: 0, bottom: 0 }
							: { top: screenPx(pulling.at.y, cam.y, cam.scale), left: 0, right: 0 }
					}
				/>
			) : null}

			{/* The unit is said once, here, rather than after every number down a
			    strip — which is also what makes the corner look like the handle it
			    is rather than an empty square. */}
			<button
				type="button"
				className={styles.corner}
				data-role="zero-point"
				data-home={home ? "" : undefined}
				title={
					home
						? "Drag onto the canvas to measure from somewhere else"
						: "Drag to measure from somewhere else, or click to put zero back"
				}
				aria-label="Move the ruler's zero point"
				onPointerDown={grabZero}
			>
				{UNITS[unit].symbol}
			</button>
		</div>
	);
}
