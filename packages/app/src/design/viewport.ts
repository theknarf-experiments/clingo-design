/**
 * Where the canvas's pixels meet the document's EMU.
 *
 * The document is EMU throughout — a frame, a gap, a path's vertex, every
 * number `design-core` hands back. The canvas is CSS pixels, and cannot be
 * anything else: it lays out real DOM, its camera is a CSS transform, and a
 * browser measures in pixels. So the editor sits astride two coordinate systems
 * whose values are both a plain `number` and whose ratio is 9525, and nothing
 * but discipline stops one being added to the other. A brand on `Emu` was
 * considered and rejected in `units.ts` for reasons that hold everywhere else in
 * the tree; here, where the mistake is a screen pixel landing in a document
 * coordinate, the answer is instead to have exactly one file that crosses.
 *
 * That file is this one. Five functions cross, and each is named for the
 * direction it goes rather than for what it is used for:
 *
 * | function         | in                     | out                      |
 * | ---------------- | ---------------------- | ------------------------ |
 * | `documentPoint`  | a pointer event        | where it is in the design |
 * | `documentSpan`   | a distance on screen   | the same distance, in the design |
 * | `documentLength` | a length on the canvas | the same length, in the design |
 * | `documentRange`  | a stretch of screen    | what of the design is under it |
 * | `canvasPx`       | a length in the design | how far to draw it       |
 * | `canvasPoint`    | a point in the design  | where to draw it         |
 * | `canvasRect`     | a frame in the design  | where to draw it         |
 * | `screenPx`       | a coordinate in the design | how far along the viewport it falls |
 *
 * The asymmetry in the inbound pair is the whole reason it is a pair, and it is
 * the one thing here worth reading twice. A pointer *position* is divided by
 * the camera scale and then offset by where the surface is looking, so it
 * depends on the camera in two ways. A pointer *tolerance* — "close the path if
 * the click lands within ten pixels of the first point" — is a claim about how
 * near a hand has to come to a target on a screen, so it is divided by the scale
 * and offset by nothing: zoom in and it covers less of the document, which is
 * exactly what keeps the target the same size under the cursor at every zoom.
 *
 * Distances that are *not* about aim do not come through here at all, because
 * they do not depend on the camera. Six pixels of snap tolerance, four pixels of
 * minimum node size, two hundred pixels of open-ended travel mark: those are
 * furniture of the *canvas*, fixed in the document's own plane, and they are
 * written `n * EMU_PER_PX` where they are declared, exactly as `geometry.ts`
 * writes its own three. Sending them through `documentSpan` would make them
 * shrink as you zoomed in, which is a different feature and not one anybody
 * asked for.
 */
import {
	type Emu,
	type Frame,
	type Point,
	cssPxFromEmu,
	emuFromCssPx,
} from "@clingo-design/design-core";

/**
 * Where a pointer event landed, in the document's own coordinates.
 *
 * `surface` is the editing surface's client rectangle, `scale` the camera's,
 * and `origin` the document point the surface's top-left corner shows — so the
 * three of them between them say everything about where the canvas is looking.
 *
 * The result is whole EMU, because it is the number a gesture will eventually
 * write: `emuFromCssPx` quantizes at a ten-thousandth of a pixel, which is four
 * decimal orders finer than anything a pointer device reports.
 */
export function documentPoint(
	event: { clientX: number; clientY: number },
	surface: { left: number; top: number },
	scale: number,
	origin: Point,
): Point {
	return {
		x: emuFromCssPx((event.clientX - surface.left) / scale) + origin.x,
		y: emuFromCssPx((event.clientY - surface.top) / scale) + origin.y,
	};
}

/**
 * How much of the document `screen` pixels cover at this zoom.
 *
 * For tolerances only — see the header. A hit radius stated this way stays the
 * same size under the cursor whatever the camera is doing, which is the whole
 * point of stating it in screen pixels in the first place.
 */
export const documentSpan = (screen: number, scale: number): Emu =>
	emuFromCssPx(screen / scale);

/**
 * A length in the design, as a length on the canvas.
 *
 * `design-core`'s `cssPxFromEmu` under the name the editor uses, so that every
 * conversion in the editor comes through this module and a stray one shows up
 * in an import list rather than in a rectangle drawn in the wrong place.
 */
export const canvasPx = (emu: Emu): number => cssPxFromEmu(emu);

/** A point in the design, as somewhere to draw. */
export const canvasPoint = (at: Point): Point => ({
	x: canvasPx(at.x),
	y: canvasPx(at.y),
});

/** A frame in the design, as somewhere to draw. */
export const canvasRect = (frame: Frame): Frame => ({
	x: canvasPx(frame.x),
	y: canvasPx(frame.y),
	width: canvasPx(frame.width),
	height: canvasPx(frame.height),
});

/**
 * The exact inverse of {@link canvasPx}: something already in the canvas's own
 * plane, read back as the design.
 *
 * Its caller is the ruler, and that is not an accident. Everything else in the
 * editor starts from a pointer event, which is why the inbound pair above take
 * a scale — but the *camera* is in canvas units, not screen ones, and asking
 * "what is the design showing at the left edge" is asking about `cam.x`. A
 * coordinate and a length convert identically here, because the two planes
 * differ by a scaling and no offset, so one function answers both.
 */
export const documentLength = (canvas: number): Emu => emuFromCssPx(canvas);

/**
 * What stretch of the design is showing across `pixels` CSS pixels of screen,
 * starting from the canvas coordinate `at`.
 *
 * The two conversions are deliberately different and this is the one place they
 * meet: `at` is a canvas coordinate and crosses on its own, while `pixels` is a
 * measurement of the window and has to be divided by the zoom first. Getting
 * that backwards gives a ruler that is right at 100% and wrong everywhere else,
 * which is the kind of bug a screenshot does not show.
 */
export function documentRange(
	at: number,
	pixels: number,
	scale: number,
): { from: Emu; to: Emu } {
	const from = documentLength(at);
	return { from, to: from + documentSpan(pixels, scale) };
}

/**
 * How far along the viewport a design coordinate falls, in CSS pixels from its
 * near edge — `canvasToViewport` with the EMU conversion folded in, one axis at
 * a time, because a ruler is one-dimensional and pairing its coordinates up
 * only to take them apart again is noise.
 *
 * `cameraAt` is the camera's `x` for a horizontal ruler and its `y` for a
 * vertical one: the canvas coordinate the viewport's near edge is showing.
 */
export const screenPx = (emu: Emu, cameraAt: number, scale: number): number =>
	(canvasPx(emu) - cameraAt) * scale;
