/**
 * A material, a lamp and a lens, read off the properties one universe resolved.
 *
 * **This file is in the wrong package and it says so in its own header.**
 * `docs/merged-plan.md` §6.5 is explicit: `materialOf`, `lampOf` and `lensOf`
 * belong in `design-core/src/spatial.ts`, they are "the only place a roughness is
 * clamped to [0,1] or a negative intensity to zero", and *"`canvas-3d` reads them
 * and must not re-clamp: two clamp sites is two answers, and the one in the pure
 * package is the one a headless test can check."*
 *
 * That is right and this file does not disagree with it. Step M4 landed
 * `spatial.ts` without those three functions — they are not there, under any
 * spelling, at the time this package was written — and this package is not
 * allowed to add them, because `design-core` is somebody else's file this run.
 * So the choice was between a renderer that cannot read a material and a reader
 * in the wrong package, and this is the second one, written so that the day the
 * three land upstream **this file becomes three re-export lines and a deletion**
 * rather than a merge:
 *
 *   - the signatures below take exactly what `ModelNode.rendered` is, a
 *     `Partial<Record<PropName, string>>`, so an upstream version that takes a
 *     `SceneNode` and a `ResolveContext` is *not* the same function and the two
 *     will not be confused for one another;
 *   - every clamp is one line with the rule beside it, so moving it is moving a
 *     line rather than reconstructing an intention;
 *   - nothing else in this package clamps anything. There is exactly one site
 *     per rule here, which is the property §6.5 is actually protecting, one
 *     package to the left of where it wanted it.
 *
 * **Report this as an outstanding hand-off, not as a feature.**
 *
 * Everything below reads *text*, because that is what an answer set holds:
 * `rendered/3` carries the literal a property resolved to in this universe, with
 * the tokens followed and the alternative already picked. There is no document
 * here and there is no resolving here.
 */
import type { PropName } from "@clingo-design/design-core";
import { degreesOf, looksLikeColour, ratioOf, worldLength } from "./units3.ts";

/** What one universe said a node draws with — `ModelNode.rendered`. */
export type Rendered = Partial<Record<PropName, string>>;

/** Nothing below the floor and nothing above the ceiling, in one place. */
const clamp = (n: number, low: number, high: number): number =>
	n < low ? low : n > high ? high : n;

/* ------------------------------------------------------------------ */
/* A surface                                                           */
/* ------------------------------------------------------------------ */

/**
 * What a `mesh` or a `model` is made of, as a `meshStandardMaterial` takes it.
 *
 * The document's four surface properties map onto glTF's metallic-roughness
 * model exactly, which is not a coincidence — `PROPS.roughness` and
 * `PROPS.metalness` were named after it — so this is a rename and two clamps
 * rather than an interpretation.
 */
export interface Material {
	/** A CSS colour three.js will take, or `undefined` for "leave it alone". */
	colour: string | undefined;
	/** 0 is a mirror, 1 is chalk. */
	roughness: number;
	metalness: number;
	opacity: number;
	/**
	 * Whether to ask for the transparent pipeline at all.
	 *
	 * A separate flag rather than `opacity < 1`, because a transparent material
	 * is sorted rather than depth-tested and two transparent solids that
	 * intersect will draw in an order that depends on where the camera is. An
	 * opaque document must never pay that, so the flag is off at opacity 1 and
	 * the difference is visible in exactly the documents that asked for it.
	 */
	transparent: boolean;
}

export function materialOf(rendered: Rendered): Material {
	// A fill that is not a colour is not a material's business — a gradient is a
	// real thing to paint a rectangle with, and handing it to three.js paints the
	// solid black with a console warning, which reads as a lighting bug.
	const fill = rendered.fill;
	const colour = looksLikeColour(fill) ? fill : undefined;
	// Clamped here and nowhere else in this package. `PROPS.roughness` says so in
	// its own comment: the property is a bare `number` so that a token can drive
	// it and so that `numeralOf` reads it with no new reader, and the [0,1] rule
	// is the reader's rather than the type's.
	const roughness = clamp(ratioOf(rendered.roughness) ?? 0.6, 0, 1);
	const metalness = clamp(ratioOf(rendered.metalness) ?? 0, 0, 1);
	const opacity = clamp(ratioOf(rendered.opacity) ?? 1, 0, 1);
	return { colour, roughness, metalness, opacity, transparent: opacity < 1 };
}

/* ------------------------------------------------------------------ */
/* A lamp                                                              */
/* ------------------------------------------------------------------ */

/** The four `VALUE_TYPES.lamp` options, as a type this package can switch on. */
export type LampKind = "ambient" | "directional" | "point" | "spot";

const LAMP_KINDS: readonly LampKind[] = ["ambient", "directional", "point", "spot"];

export interface Lamp {
	kind: LampKind;
	colour: string;
	/** Never negative. Unbounded above, exactly as `PROPS.intensity` says. */
	intensity: number;
}

export function lampOf(rendered: Rendered): Lamp {
	const word = rendered.lamp;
	// An unknown word falls back rather than throwing, which is the same answer
	// `edits.ts` gives for an unknown solid: a value can come from a token and a
	// token can hold anything, and a document that says `lamp: "sunshine"` is a
	// document with a typo in it, not a document that cannot be drawn.
	// `directional` rather than `ambient` because it is `VALUE_TYPES.lamp`'s own
	// fallback (`LAMPS[1]`), and two fallbacks would be two answers.
	const kind = LAMP_KINDS.find((k) => k === word) ?? "directional";
	const ink = rendered.ink;
	const colour = looksLikeColour(ink) ? ink : "#ffffff";
	// Negative is clamped to zero rather than refused: a light with a negative
	// intensity is a light that is off, which is a drawable thing, and there is
	// nothing here to report a refusal to.
	const intensity = Math.max(0, ratioOf(rendered.intensity) ?? 1);
	return { kind, colour, intensity };
}

/* ------------------------------------------------------------------ */
/* A lens                                                              */
/* ------------------------------------------------------------------ */

/** Three numbers in the units three.js's `PerspectiveCamera` takes them in. */
export interface Lens {
	/** Vertical field of view, in **degrees** — three.js's `fov`. */
	fov: number;
	/** Clip planes, in renderer units. */
	near: number;
	far: number;
}

/**
 * The default lens, which is `PROPS.fov`, `PROPS.near` and `PROPS.far`'s own
 * fallbacks read through this file's converters — 50°, 1px, 20000px.
 *
 * Spelled as a function rather than a constant so a caller cannot mutate the one
 * every camera in the studio shares.
 */
export const defaultLens = (): Lens => ({ fov: 50, near: 1, far: 20000 });

export function lensOf(rendered: Rendered): Lens {
	const base = defaultLens();
	// A field of view of 0 or 180 is a degenerate projection matrix rather than
	// an extreme lens, so the interval is open at both ends and a document that
	// asks for one gets the fallback. Clamped rather than refused for the reason
	// a negative intensity is: there is nobody here to refuse to.
	const fov = clamp(degreesOf(rendered.fov) ?? base.fov, 1, 179);
	const near = Math.max(worldLength(rendered.near) ?? base.near, 1e-3);
	const far = worldLength(rendered.far) ?? base.far;
	// `far` below `near` is the one combination that is not a bad number but a
	// contradiction, and it draws nothing at all. `PROPS.far`'s comment says it
	// is "refused by `lensOf` rather than clamped" — this is that refusal, and
	// what it refuses is the pair rather than the number: the stated `near` is
	// kept, because it is not the one that is wrong, and `far` goes back to the
	// fallback where that is still ahead of it and to `near` doubled where it is
	// not.
	return { fov, near, far: far > near ? far : Math.max(base.far, near * 2) };
}
