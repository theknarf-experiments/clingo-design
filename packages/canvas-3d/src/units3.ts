/**
 * The crossing: EMU and thousandths of a degree on one side, three.js numbers on
 * the other.
 *
 * **This is the only module in the package that is allowed to convert.** Every
 * other file here takes numbers that have already been through here, and the
 * discipline that makes that checkable is naming: anything holding renderer
 * units has `world` in its name, and nothing else in this package does. It is
 * the same discipline `design-core`'s `spatial.ts` keeps with `render`, and the
 * two names are different on purpose — see {@link worldFromEmu}.
 *
 * The arithmetic itself is **not written here**. `renderFromEmu`, `radFromMdeg`
 * and `renderPoint` live in `design-core/src/spatial.ts`, are exercised by
 * `spatial.test.ts` under `node --test` with no browser in the room, and are
 * re-exported below under the names `docs/three-d-spec.md` §6.2 gives them. Two
 * conversion sites would be two answers and only one of them could ever be
 * checked headless; `docs/merged-plan.md` §6.5 makes exactly that argument about
 * where a clamp lives, and it is the same argument.
 *
 * What *is* written here is the one thing the pure package has no opinion about,
 * because it is a fact about three.js's Euler convention rather than about the
 * document: {@link worldEuler}. Read its comment — it corrects a claim in
 * `spatial.ts`'s own prose, and getting it wrong is a scene that is right in one
 * component and mirrored in the next.
 */
import {
	type Turn,
	emuOf,
	mdegOf,
	numeralOf,
	radFromMdeg,
	renderFromEmu,
	renderPoint,
	emuFromRender,
} from "@clingo-design/design-core";

/**
 * EMU to the units this package's scene graph is in, which are **CSS pixels**.
 *
 * A renaming re-export and deliberately nothing more. `spatial.ts` spells it
 * `renderFromEmu` because `worldOrigin`, `worldFrame` and `gworld/2` have meant
 * *absolute canvas coordinates in EMU* in that package since long before there
 * was a third axis, and a `worldFromEmu` beside them would have made one word
 * mean two things one import apart. In here the word is free: there is no canvas
 * space in this package at all, only a scene graph, so `world` means what
 * `docs/three-d-spec.md` §6.2 says it means and the rest of the package can be
 * read by looking for it.
 */
export const worldFromEmu = renderFromEmu;

/** Renderer units back to EMU, quantized once, at this boundary and no other. */
export const emuFromWorld = emuFromRender;

/** Thousandths of a degree to radians. Lossy, once, by name — `spatial.ts`'s. */
export { radFromMdeg };

/**
 * The six numbers of a box, as three.js wants them: where its centre is, and how
 * big it is.
 *
 * `Box` is `design-core`'s six EMU — a {@link Frame} and its third axis — read
 * off one answer set. Note the two halves cross differently, and that is not an
 * inconsistency:
 *
 *   - the **centre** goes through `renderPoint`, which negates y and z, because
 *     it is a point in a coordinate system that is the mirror of ours in two
 *     axes;
 *   - the **size** does not, because a size is a magnitude. Negating an axis
 *     does not make a 100px box −100px wide, and a negative scale in three.js is
 *     a reflection that turns every face inside out.
 */
export interface WorldBox {
	/** The centre, in renderer units, in three.js's frame. */
	position: [number, number, number];
	/** Width, height and depth, in renderer units. Always non-negative. */
	size: [number, number, number];
}

/** The six EMU of a node, as {@link WorldBox}. */
export function worldBox(box: {
	x: number;
	y: number;
	width: number;
	height: number;
	z: number;
	depth: number;
}): WorldBox {
	return {
		position: renderPoint({
			x: box.x + box.width / 2,
			y: box.y + box.height / 2,
			z: box.z + box.depth / 2,
		}),
		size: [
			Math.abs(worldFromEmu(box.width)),
			Math.abs(worldFromEmu(box.height)),
			Math.abs(worldFromEmu(box.depth)),
		],
	};
}

/**
 * The offset from a node's **centre** to its **origin**, in renderer units — the
 * step every child takes before its own place means anything.
 *
 * `design-core`'s `originMatrix` is `localMatrix · T(−half)`: a child's frame is
 * relative to its parent's near-top-left corner, a parent's transform speaks
 * about its centre, and the difference between the two is one translation by
 * half the size. This is that translation, crossed.
 *
 * It is crossed by the **conjugation** rule rather than by `renderPoint`, and
 * the two happen to agree here only because the vector is the negated half-size:
 * `F·(−w/2, −h/2, −d/2)` is `(−w/2, +h/2, +d/2)`, which is what
 * `renderPoint({x:−w/2, y:−h/2, z:−d/2})` also gives. Written out rather than
 * routed through `renderPoint` because a translation vector and a point are
 * different things that cross by different rules, and the day one of them stops
 * agreeing is the day a silent version of this would be very hard to find.
 */
export function worldOriginOffset(size: readonly [number, number, number]): [number, number, number] {
	return [-size[0] / 2, size[1] / 2, size[2] / 2];
}

/**
 * A document rotation as a three.js XYZ Euler triple, **in radians, with y and z
 * negated**.
 *
 * This corrects `spatial.ts`'s own prose, which says the Euler triple "goes
 * across unchanged". Half of that paragraph is exactly right and the half that
 * is wrong is worth writing out, because the two claims look like one claim:
 *
 *   - **Right**: `rotationMatrix(turn)` really is, element for element,
 *     `new Matrix4().makeRotationFromEuler(new Euler(x, y, z, "XYZ"))`. Verified
 *     numerically against three.js 0.185.1 while this file was written, for the
 *     matrix in the *document's* space.
 *   - **Wrong**: that matrix is not the matrix three.js should be handed,
 *     because three.js is not standing in the document's space. `renderPoint`
 *     maps a point by `F = diag(1, −1, −1)`, and a linear map does not carry a
 *     rotation across by being applied to it — it carries it across by
 *     conjugation: `R_world = F · R_doc · F⁻¹`, and `F⁻¹ = F`.
 *
 * Conjugating by `F` leaves a rotation about x alone (`F` and `Rx` commute) and
 * negates the angle of a rotation about y or about z:
 *
 * ```
 * F · Rx(a) · F = Rx(a)     F · Ry(b) · F = Ry(−b)     F · Rz(g) · F = Rz(−g)
 * ```
 *
 * so `F · (Rx·Ry·Rz) · F` is `Rx(a) · Ry(−b) · Rz(−g)` — the same XYZ order,
 * with two angles flipped. That is what this returns, and it was checked twice:
 * against the conjugated matrix element by element, and end to end by rotating a
 * point in document space and crossing it against crossing it and rotating it
 * here. The two agree to 1e-16.
 *
 * `F` is a rotation and not a reflection (its determinant is +1 — it is a half
 * turn about x), which is why the handedness really does survive and why a
 * *third* sign flip never appears anywhere in this package. The sign flip that
 * would be a reflection is CSS's, whose +z points at the viewer while y still
 * points down; the exporter makes that crossing itself and this function is no
 * use to it.
 */
export function worldEuler(turn: Partial<Record<Turn, number>> | undefined): [number, number, number] {
	if (!turn) return [0, 0, 0];
	return [
		radFromMdeg(turn.rotateX ?? 0),
		-radFromMdeg(turn.rotateY ?? 0),
		-radFromMdeg(turn.rotateZ ?? 0),
	];
}

/* ------------------------------------------------------------------ */
/* Reading a resolved property                                         */
/* ------------------------------------------------------------------ */

/**
 * A length property — `near`, `far` — as renderer units.
 *
 * `ModelNode.rendered` holds the *text* one universe resolved a property to:
 * `"2px"`, `"#ff0000"`, `"60deg"`, `"0.6"`. Every token has already been
 * followed, every derivation already applied, every alternative already picked.
 * So the readers below are string-to-number and nothing else — they never
 * consult the document, never resolve, and never decide anything a universe
 * decided. That is what makes this package a reader of the answer set rather
 * than a second opinion about the document.
 *
 * `undefined` where the text is not a length, which is a real possibility: a
 * property can resolve to a token's value and a token can hold anything. The
 * caller supplies the fallback, because the fallback is the caller's business —
 * a missing `near` is 1 and a missing `fill` is grey, and neither of those is a
 * fact about parsing.
 */
export const worldLength = (text: string | undefined): number | undefined => {
	if (text === undefined) return undefined;
	const emu = emuOf(text);
	return emu === undefined ? undefined : worldFromEmu(emu);
};

/** An angle property — `fov` — in **degrees**, which is what three.js takes. */
export const degreesOf = (text: string | undefined): number | undefined => {
	if (text === undefined) return undefined;
	const mdeg = mdegOf(text);
	return mdeg === undefined ? undefined : mdeg / 1000;
};

/** A bare-number property — `roughness`, `metalness`, `opacity`, `intensity`. */
export const ratioOf = (text: string | undefined): number | undefined =>
	text === undefined ? undefined : numeralOf(text);

/**
 * True when a resolved `fill` or `ink` is something three.js's `Color` will
 * actually take.
 *
 * three.js accepts `#rgb`, `#rrggbb`, `rgb()`, `hsl()` and the CSS named
 * colours, and **throws nothing** on anything else — it warns to the console and
 * leaves the colour black. A document's `fill` can perfectly well resolve to
 * `linear-gradient(...)`, which is a real thing to paint a rectangle with and
 * not a thing a material has, so a mesh whose fill is a gradient would silently
 * turn black and look like a lighting bug.
 *
 * So the test is made here and the caller falls back to its own default. It is
 * deliberately a *shape* test rather than a list of the 148 named colours: the
 * named ones are let through and three.js is left to warn about a misspelling,
 * because a typo'd colour name going grey is a much smaller lie than a gradient
 * going black.
 */
export function looksLikeColour(text: string | undefined): text is string {
	if (text === undefined) return false;
	const t = text.trim();
	if (t.length === 0) return false;
	if (/^#[0-9a-f]{3,8}$/i.test(t)) return true;
	if (/^(rgb|rgba|hsl|hsla)\(/i.test(t)) return true;
	// A bare word: a CSS colour name, or a token whose value happens to be one.
	// Anything with a bracket, a comma or a space in it is a function, a list or
	// a gradient, and is none of a material's business.
	return /^[a-z]+$/i.test(t);
}
