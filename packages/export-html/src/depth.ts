/**
 * The third axis, where CSS is a complete answer.
 *
 * HTML's alone: an SVG says once, about the format, that it is flat, so it has
 * no reading of a turned box to be given.
 */
import type {
	Emu,
	ModelNode,
	ModelScene,
	Spatial,
	Turn,
} from "@clingo-design/design-core";
import {
	KINDS,
	PROPS,
	TURNS,
	TURN_NAMES,
	cssLength,
	cssPx,
	writeAngle,
} from "@clingo-design/design-core";

import {
	stopsHere,
} from "@clingo-design/export-core";

/* ------------------------------------------------------------------ */
/* The third axis, where CSS is a complete answer                      */
/* ------------------------------------------------------------------ */

/**
 * A place and a rotation, as one `transform`.
 *
 * **This is the half of the third axis the flat targets get exactly right, and
 * it is worth being clear that it is exact rather than approximate.** A `rect`
 * with a `z` and a `rotateY` is a flat box in space, and `translate3d` plus the
 * three rotation functions is precisely what a flat box in space is in CSS —
 * same origin, same order, same numbers. Nothing is dropped, nothing is
 * projected by hand, and the browser's compositor does the projection the canvas
 * does. What CSS has no word for is *geometry*, which is why the line falls at
 * the `viewport` kind and nowhere else — see {@link stopsHere}.
 *
 * **The order is `rotateX rotateY rotateZ`, and it is not §10.4's example.** The
 * frozen spec's §2.3 fixes the order of *application* as rotateZ, then rotateY,
 * then rotateX, and says in the same paragraph that this is "CSS's own order for
 * `rotateX(..) rotateY(..) rotateZ(..)` read left to right" — because CSS
 * composes a transform list left to right and so applies the **rightmost**
 * function to the point first. `spatial.ts`'s {@link rotationMatrix} is `Rx · Ry
 * · Rz` for the same reason and says so. §10.4's illustration writes the three in
 * the other order, which contradicts both, and following the illustration would
 * have exported a rotation the canvas and the solver do not agree with. So the
 * normative sentence wins and the example is treated as the typo it is; this is
 * called out in the step's return value rather than quietly reversed.
 *
 * A zero term is omitted rather than written as `rotateX(0deg)`. It is the
 * identity, so the picture is the same either way, and the reason to leave it
 * out is that this string is also what a *state* rule writes — a whole `transform`
 * replaces a whole `transform`, so every rule that writes one writes the complete
 * pose — and a file where every card carries three rotations it does not have is
 * a file nobody reads. Where the pose is entirely flat and unmoved this answers
 * `undefined`, and the document that has never heard of the third axis gets the
 * bytes it got before, which is invariant 4 in one line.
 *
 * The translation is `translate3d` only where there is a z, and plain
 * `translate` otherwise, for that same reason: a 2D document's state move has
 * always come out as `translate(12px, 0px)` and still does.
 */
export function transformOf(
	dx: Emu,
	dy: Emu,
	z: Emu,
	turn: Readonly<Record<Turn, number>> | undefined,
): string | undefined {
	const parts: string[] = [];
	if (z !== 0) parts.push(`translate3d(${cssPx(dx)}px, ${cssPx(dy)}px, ${cssPx(z)}px)`);
	else if (dx !== 0 || dy !== 0) parts.push(`translate(${cssPx(dx)}px, ${cssPx(dy)}px)`);
	for (const name of TURN_NAMES) {
		const mdeg = turn?.[name] ?? 0;
		if (mdeg !== 0) parts.push(`${TURNS[name].css}(${writeAngle(mdeg)})`);
	}
	return parts.length === 0 ? undefined : parts.join(" ");
}

/** A pose, as the two callers that have one hold it. */
interface Posed {
	spatial?: Readonly<Record<Spatial, number>>;
	turn?: Readonly<Record<Turn, number>>;
}

/** How far forward something is, with "the answer set said nothing" read as zero. */
export const liftOf = (posed: Posed): Emu => posed.spatial?.z ?? 0;

/**
 * True where a pose needs a 3D rendering context around it rather than just a
 * transform on it.
 *
 * A `rotateZ` is a rotation *in the plane*: it needs no `perspective` and no
 * `preserve-3d`, it has worked in every browser since before either existed, and
 * putting a perspective on its parent would change nothing about it. A `z` or a
 * lean about x or y is the other thing, and without the context above it the
 * browser flattens it — which is a picture that is silently, subtly wrong rather
 * than obviously missing, and is the failure this test exists to prevent.
 */
export const needsDepth = (posed: Posed): boolean =>
	liftOf(posed) !== 0 ||
	(posed.turn?.rotateX ?? 0) !== 0 ||
	(posed.turn?.rotateY ?? 0) !== 0;

/**
 * Which elements have to be told the scene is three dimensional, and where the
 * eye stands.
 *
 * Two declarations, and neither of them belongs to the node that is actually
 * turned: `perspective` goes on the surface the turned things sit *on*, because
 * that is the choice of where the viewer is and it is one choice for everything
 * standing on that surface; `transform-style: preserve-3d` goes on every element
 * between the two, because the default is `flat` and a flat ancestor collapses
 * its whole subtree back into the plane before the perspective ever sees it.
 *
 * The nearest {@link KindSpec.surface} ancestor is the perspective root, which is
 * `PROPS.perspective`'s own claim — it is offered on `frame` and on nothing else
 * — and a turned node with no surface above it puts the perspective on `.design`,
 * the element this file wraps the whole document in. That is the honest answer
 * rather than a refusal: the document *is* the surface then, and a card leaning
 * off the top level with no perspective anywhere would be drawn flat.
 *
 * Nothing here is emitted for a `rotateZ` alone — see {@link needsDepth} — and
 * nothing at all is emitted for a document with no third axis in it, which is
 * every document that shipped before this. The walk stops at a viewport like
 * every other walk here.
 */
interface Depth {
	/** Node ids that need `transform-style: preserve-3d`. */
	preserve: Set<string>;
	/** Node id -> the `perspective` length its children are seen through. */
	perspective: Map<string, string>;
	/** The same, for the wrapper, where a turned node has no surface above it. */
	onDocument?: string;
	/** True where anything outside a viewport is turned at all — for the loss. */
	turned: boolean;
}

export function depthOf(model: ModelScene): Depth {
	const out: Depth = { preserve: new Set(), perspective: new Map(), turned: false };
	const eye = (node: ModelNode): string =>
		cssLength(node.rendered.perspective ?? PROPS.perspective.fallback);
	const walk = (node: ModelNode, chain: ModelNode[]): void => {
		if (transformOf(0, 0, liftOf(node), node.turn) !== undefined) out.turned = true;
		if (needsDepth(node)) {
			// Outwards from the node's own parent until a surface answers. The
			// surface takes the perspective and stops the walk; everything passed on
			// the way there has to keep the subtree unflattened.
			let seated = false;
			for (let i = chain.length - 1; i >= 0; i--) {
				const up = chain[i];
				if (KINDS[up.kind].surface) {
					out.perspective.set(up.id, eye(up));
					seated = true;
					break;
				}
				out.preserve.add(up.id);
			}
			if (!seated) out.onDocument = cssLength(PROPS.perspective.fallback);
		}
		if (stopsHere(node.kind)) return;
		for (const child of node.children) walk(child, [...chain, node]);
	};
	for (const root of model.roots) walk(root, []);
	return out;
}

