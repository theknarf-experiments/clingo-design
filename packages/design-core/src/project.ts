/**
 * Projects: a named {@link Scene} plus metadata, and the pure operations the
 * overview page needs. Storage is the caller's problem — everything here is
 * plain data in, plain data out, so it can be tested without a browser.
 *
 * A project used to be an entry in one JSON blob, which is why the reader for
 * that blob still lives at the bottom of this file. Everything a document has
 * ever been written as is read there, one last time, on the way in.
 */
import type { PathPoint, Point } from "./geometry.ts";
import {
	DEFAULT_UNIT,
	type Emu,
	EMU_PER_PX,
	formatLength,
	emuOf,
	isUnit,
	nearestEmu,
	snapToUnit,
	unitOf,
} from "./units.ts";
import {
	type Term,
	VALUE_TYPES,
	type Value,
	type ValueType,
	isLengthType,
	lit,
	msOf,
	single,
	wordOf,
} from "./values.ts";
import {
	type AutoLayout,
	type AssetInfo,
	type Axis3,
	BLEND_KINDS,
	type Blend,
	type BlendKind,
	type BlendStop,
	CHILD_PROPS,
	COMPARE_OPS,
	CONTAINER_PROPS,
	type CompareOp,
	type Condition,
	DIMENSIONS_3D,
	FRAME_DIMS,
	GUIDE_PROPS,
	GUIDE_PROP_NAMES,
	type Guide,
	INPUT_KINDS,
	type InputKind,
	type Keyframe,
	LAYOUT_PROPS,
	type LoopMode,
	CONSTRAINT_KINDS,
	DIMENSIONS,
	EDGES,
	MOTION_PROPS,
	MOTION_PROP_NAMES,
	PROP_NAMES,
	SPATIALS,
	SPATIAL_DIMS,
	TRIGGERS,
	TURNS,
	TURN_NAMES,
	type Constraint,
	DEFAULT_FRAME,
	type Dimension,
	type FontAxis,
	type FontFile,
	type FrameValue,
	KINDS,
	type Machine,
	type MachineInput,
	type MachineLayer,
	type MachineState,
	type MeshRef,
	type MotionProp,
	PROPS,
	type PropName,
	RESERVED_STATES,
	RULES_HEADER,
	STRENGTHS,
	STYLE_PROPS,
	type Scene,
	type SceneNode,
	type Spatial,
	type SpatialValue,
	type StatePart,
	type Style,
	type SurfaceGuides,
	type StyleVariant,
	type Timeline,
	type Track,
	type Transition,
	type Trigger,
	type Turn,
	type TurnValue,
	dimension,
	dimensionSpec,
	emptyScene,
	makeFrame,
	starterTokens,
	uniqueName,
} from "./scene.ts";

/**
 * An alias rather than an interface: only aliases get an implicit index
 * signature, and stores that take `Record<string, unknown>` want one.
 */
export type Project = {
	id: string;
	name: string;
	scene: Scene;
	createdAt: number;
	updatedAt: number;
};

function newId(): string {
	// Available in browsers and Node >= 19.
	return globalThis.crypto?.randomUUID?.() ?? `p-${Date.now().toString(36)}`;
}

export interface CreateProjectOptions {
	name?: string;
	id?: string;
	now?: number;
	scene?: Scene;
}

export function createProject(options: CreateProjectOptions = {}): Project {
	const now = options.now ?? Date.now();
	return {
		id: options.id ?? newId(),
		name: options.name?.trim() || "Untitled",
		// A scene handed in is one this code just built — a template. It is not
		// run through `normalizeScene`, which is a reader for documents written
		// by *older* code and would quietly drop anything a template got wrong
		// instead of failing its own test. What it does get is the unit stamp,
		// because a document that reaches storage without one says it predates
		// EMU, and a template drawn on today would be read as pixels-in-EMU the
		// next time it was opened. See {@link Scene.unit}.
		scene: options.scene
			? { ...options.scene, unit: options.scene.unit ?? DEFAULT_UNIT }
			: emptyScene(),
		createdAt: now,
		updatedAt: now,
	};
}

/** "Untitled", then "Untitled 2", "Untitled 3", … */
export function uniqueProjectName(
	existing: readonly Project[],
	base = "Untitled",
): string {
	return uniqueName(
		existing.map((p) => p.name),
		base,
	);
}

/** Most recently touched first — the order the overview lists them in. */
export function sortProjects(list: readonly Project[]): Project[] {
	return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function findProject(
	list: readonly Project[],
	id: string | undefined,
): Project | undefined {
	if (!id) return undefined;
	return list.find((p) => p.id === id);
}

/* ------------------------------------------------------------------ */
/* The localStorage format, kept only to read it one last time         */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------------------ */
/* Reading a document written before geometry was EMU                  */
/* ------------------------------------------------------------------ */

/*
 * Two things, and only two, changed under a stored document's feet when
 * internal geometry became EMU.
 *
 * **A bare number.** Every number a document ever stored without a unit was
 * pixels: a frame from before dimensions were values, a gap from before
 * settings were, a legacy artboard's size, a constraint's dimension, and a
 * path's vertices. The first four are shapes this code no longer writes, so a
 * bare number in one of them is unambiguously old and {@link fromLegacyPx} is
 * the whole migration. A path's vertices are the exception, and they are why
 * `Scene.unit` doubles as a format marker: they are bare numbers in the
 * *current* format too, so nothing in the value itself says which era it came
 * from. A document with no `unit` predates EMU and its vertices are pixels; one
 * with a unit has already been through here.
 *
 * **A length off the EMU lattice.** `"24px"` means exactly what it always did —
 * that is what keeping unit-suffixed strings on disk bought, and it is why
 * nothing here *converts* a length. The walk over them is a narrower errand:
 * `"20.5px"` is 195262.5 EMU, and 9525 is odd, so half a pixel is no length at
 * all — `emuOf` is exact or nothing and reads it as nothing, which sends the
 * node to the origin. {@link snapLength} moves it onto its own unit's lattice
 * once, on the way in — `"20.52px"` — because a rewrite a designer can see is
 * better than a silent zero, and because doing it here rather than in the
 * reader keeps `emuOf` honest for everything written since.
 *
 * Both passes are idempotent, which they have to be: the store normalises on
 * every load and writes back what moved, so a migration that changed its answer
 * the second time would walk the document away a little further every time it
 * was opened.
 */

/** A number a document stored with no unit on it. It was pixels, always. */
const fromLegacyPx = (px: number): Emu => px * EMU_PER_PX;

/** A legacy bare number as the length text a document holds now. */
const legacyLength = (px: number): string =>
	formatLength(snapToUnit(fromLegacyPx(px)));

/**
 * A stored length text, snapped onto its own unit's lattice if it is not on it
 * already. Anything that is not a length — a colour, a word, `"50%"` — comes
 * back untouched, because deciding it was a length is the one mistake that
 * would rewrite a value nobody asked about.
 *
 * The pre-round through {@link nearestEmu} is what lets this reuse the two
 * named roundings instead of parsing decimals a third time, and it cannot move
 * the answer: every `step` in the table is odd, so a lattice midpoint always
 * falls exactly halfway between two integers, and rounding to the nearest
 * integer therefore never crosses one. A value sitting *on* a midpoint is a tie,
 * and both roundings break ties away from zero.
 */
function snapLength(text: string): string {
	if (emuOf(text) !== undefined) return text;
	const unit = unitOf(text);
	const near = nearestEmu(text);
	if (unit === undefined || near === undefined) return text;
	return formatLength(snapToUnit(near, unit), unit);
}

/**
 * True when a value of this type holds lengths — the question
 * {@link isLengthType} answers, asked of a type a stored document supplied and
 * so not necessarily one that exists.
 */
const holdsLengths = (type: unknown): boolean =>
	typeof type === "string" &&
	Object.hasOwn(VALUE_TYPES, type) &&
	isLengthType(type as ValueType);

function snapTerm(term: Term, type: unknown): Term {
	if (term.kind !== "literal" || !holdsLengths(type)) return term;
	const text = snapLength(term.value);
	return text === term.value ? term : lit(text);
}

/**
 * Every alternative of a stored value, with any off-lattice length snapped.
 *
 * `type` is what keeps a line height of `1.35` and a headline's prose out of
 * it: the sweep is over the `length` quantity, read off the same table the
 * compiler and the exporter read it off, rather than over everything that
 * looks like a number.
 *
 * Returns the array it was given when nothing moved, so a caller can still tell
 * a rewrite from a no-op by identity — which the child-property loop below
 * does, and which is what keeps a setting nobody edited out of the diff.
 */
function snapValue(value: Value, type: unknown): Value {
	if (!holdsLengths(type)) return value;
	let moved = false;
	const out = value.map((term) => {
		const next = snapTerm(term, type);
		if (next !== term) moved = true;
		return next;
	});
	return moved ? out : value;
}

const legacyPoint = (p: Point): Point => ({
	x: fromLegacyPx(Number(p.x)),
	y: fromLegacyPx(Number(p.y)),
});

/**
 * A path's vertices, which are the one geometry in the document that is bare
 * numbers rather than length text — anchors and their two handles, all of them
 * relative to the node's own frame, and so all of them in whatever unit that
 * frame is in.
 */
function legacyPoints(points: readonly PathPoint[]): PathPoint[] {
	return points.map((p) => ({
		...legacyPoint(p),
		...(p.in ? { in: legacyPoint(p.in) } : {}),
		...(p.out ? { out: legacyPoint(p.out) } : {}),
	}));
}

/**
 * Fills in anything a stored scene is missing.
 *
 * Saved projects outlive the code that wrote them, so every field falls back
 * to a default rather than reaching the renderer as undefined. Documents from
 * before frames were nodes carry a global `artboard`; their contents are
 * wrapped in a frame of that size so nothing is orphaned on the canvas.
 *
 * It is also where a pre-EMU document becomes an EMU one — see the section
 * above for what that does and does not touch. The stamp goes on last: a scene
 * that leaves here always says what unit it is in, so it is only ever migrated
 * once however many times it is opened.
 */
export function normalizeScene(input: unknown): Scene {
	const base = emptyScene();
	if (!isRecord(input)) return base;

	// The marker, read before anything uses it. Absent means the bare numbers
	// in this document are still pixels.
	const legacy = input.unit === undefined;

	return {
		tokens:
			Array.isArray(input.tokens) && input.tokens.every(isToken)
				? (input.tokens as Scene["tokens"]).map((t) => ({
						...t,
						// A `length` token is a spacing scale, and a scale written
						// in half-pixels is exactly the case that would otherwise
						// read as no length at all — everywhere at once, since a
						// token is shared.
						value: snapValue(t.value, t.type),
					}))
				: starterTokens(),
		// Documents written before styles existed simply have none, which is
		// what every document written before them *was*. Unlike the tokens this
		// filters rather than rejecting wholesale: one malformed style is one
		// style to drop, and a node wearing it then decides its own appearance,
		// which is exactly what a dangling reference already means.
		styles: Array.isArray(input.styles)
			? input.styles.filter(isStyle).map(normalizeStyle)
			: [],
		// Documents written before machines existed have none, which is what
		// every document written before them *was*. Filtered rather than
		// rejected wholesale, like the styles and for the same reason: one
		// unreadable machine is one machine to drop, and the definition it drove
		// goes back to being a component with no behaviour, which is what every
		// other component in the document already is.
		machines: Array.isArray(input.machines)
			? normalizeMachines(input.machines)
			: [],
		// Nodes from a document written before absolute geometry existed have
		// no frame, and would render at 0x0. Dropping them is better than
		// showing an invisible layer list.
		nodes: migrateNodes(input, legacy),
		// Documents written before constraints existed simply have none.
		constraints: Array.isArray(input.constraints)
			? input.constraints.filter(isConstraint).map(migrateConstraint)
			: [],
		rules: typeof input.rules === "string" ? input.rules : RULES_HEADER,
		// Last, and only here. Whatever the document said it was measured in it
		// still is; what it did not say is that it is an EMU document at all, and
		// now it does. A unit nothing recognises falls back rather than being
		// carried, since the inspector would have no table row to show it with.
		unit:
			typeof input.unit === "string" && isUnit(input.unit)
				? input.unit
				: DEFAULT_UNIT,
		// Absent stays absent, and that is the whole of the decision: a document
		// with no imported geometry has no asset index, `{}` would be a second
		// spelling of the same claim, and `referencedAssets` would then have two
		// shapes to answer for. Entries nothing references are **kept** on the way
		// in — a paste may be about to reference one, and dropping them here would
		// make opening a file a destructive act. `pruneAssets` drops them on an
		// edit, which is where a person is present to have meant it.
		...normalizeAssets(input.assets),
		// Beside the assets and read the same way, and absent for the same reason:
		// a document that declares no fonts writes no key. Every document written
		// before this field existed is one of those, and reads exactly as it always
		// did — which is the whole of what "a font is a declaration the compiler
		// never hears about" buys on the way in.
		...normalizeFonts(input.fonts),
	};
}

/**
 * The font roster, or nothing where the document declares none.
 *
 * Filtered rather than rejected wholesale, like the styles and the machines and
 * for their reason: one unreadable entry is one face the page cannot set text
 * in, and every value that named it still paints the rest of its stack — which
 * is exactly what a page opened without its assets already does. Losing the
 * whole roster would turn one bad row into a document that had never heard of
 * any of its typefaces.
 *
 * Four fields are required and three of them are strings a person edits: a
 * declaration with no `src` names no bytes, one with no `family` names nothing a
 * value could point at, and one whose `weight` or `style` is missing would emit
 * an `@font-face` with a hole in it. They are **defaulted rather than rejected**
 * where a default is honest — `"400"` and `"normal"` are what a face with no
 * descriptor means to CSS — and the two that cannot be guessed drop the entry.
 *
 * `bytes` falls back to zero rather than dropping the row, because it is a
 * number for a panel to print and nothing reads it to decide anything: a roster
 * that lost a face over an unreadable size would be a design that stopped
 * painting because a total was wrong.
 */
function normalizeFonts(value: unknown): { fonts?: FontFile[] } {
	if (!Array.isArray(value)) return {};
	const out: FontFile[] = [];
	for (const raw of value) {
		if (!isRecord(raw)) continue;
		if (typeof raw.src !== "string" || raw.src === "") continue;
		if (typeof raw.family !== "string" || raw.family === "") continue;
		const bytes = Number(raw.bytes);
		const axes = Array.isArray(raw.axes)
			? raw.axes.map(fontAxis).filter((a): a is FontAxis => a !== undefined)
			: undefined;
		out.push({
			src: raw.src,
			family: raw.family,
			weight: typeof raw.weight === "string" && raw.weight !== "" ? raw.weight : "400",
			style: typeof raw.style === "string" && raw.style !== "" ? raw.style : "normal",
			...(typeof raw.stretch === "string" && raw.stretch !== ""
				? { stretch: raw.stretch }
				: {}),
			bytes: Number.isFinite(bytes) ? bytes : 0,
			// The name is what a person reads and nothing else reads it, so a missing
			// one is not a reason to lose the entry. The path is the honest fallback,
			// as it is for an asset, and for the same reason: it is something a person
			// can go and look for.
			name: typeof raw.name === "string" && raw.name !== "" ? raw.name : raw.src,
			...(axes && axes.length > 0 ? { axes } : {}),
		});
	}
	return out.length > 0 ? { fonts: out } : {};
}

/**
 * An axis is three finite numbers and a tag, or it is nothing.
 *
 * A reader rather than a type guard, which is the difference between checking a
 * row and *having* one. A guard that asked `Number.isFinite(Number(raw.min))`
 * and then let the row through by reference would admit `min: "100"` — finite,
 * and a string — into a field typed `number`, and the lie would surface as
 * `wght 100–900` printing correctly right up until somebody did arithmetic on
 * it. The whole point of a normalizer is that what comes out is the type it
 * claims to be, so the numbers are converted here and not merely tested.
 */
function fontAxis(value: unknown): FontAxis | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.tag !== "string" || value.tag === "") return undefined;
	const min = Number(value.min);
	const max = Number(value.max);
	const def = Number(value.def);
	if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(def)) {
		return undefined;
	}
	return { tag: value.tag, min, max, def };
}

/**
 * The asset index, or nothing where the document holds none.
 *
 * Filtered rather than rejected wholesale, like the styles and the machines and
 * for their reason: one unreadable entry is one asset the studio cannot show a
 * size for, and the models that reference it still draw as their bounding boxes
 * and still say so. Losing the whole index would turn one bad row into every
 * model in the document going unnamed.
 *
 * Returned as a fragment to spread rather than as a value, so that "no assets"
 * writes no key at all — see {@link Scene.assets}.
 *
 * **Keyed by tree path, and a key that is not one is migrated in place.** The
 * index used to be keyed by content hash, one entry per *primitive*; it is now
 * one entry per file, and `bytes` therefore means the size of the file a person
 * imported rather than the size of a fragment nobody chose. A document written
 * under the old scheme is rewritten here in the same pass that rewrites its
 * refs, so the two halves of the migration cannot land separately — see
 * `migrateMeshRef` for the geometry side and for the argument that the rewrite
 * is exact.
 *
 * A path is told from a hash by its leading slash, which is not a heuristic in
 * either direction: every path this index can legally hold comes from the
 * project's tree and is absolute, and a SHA-256 rendered as hex has no slash in
 * it at all. The alternative — a 64-hex-characters test — would be the same
 * check written to be fooled by a shorter hash from some other scheme.
 */
function normalizeAssets(value: unknown): { assets?: Record<string, AssetInfo> } {
	if (!isRecord(value)) return {};
	const out: Record<string, AssetInfo> = {};
	for (const [key, raw] of Object.entries(value)) {
		if (!isRecord(raw)) continue;
		if (raw.format !== "gltf" && raw.format !== "glb") continue;
		const bytes = Number(raw.bytes);
		const triangles = Number(raw.triangles);
		if (!Number.isFinite(bytes) || !Number.isFinite(triangles)) continue;
		const src = key.startsWith("/") ? key : legacyAssetPath(key);
		out[src] = {
			format: raw.format,
			bytes,
			triangles,
			// The name is what a person reads and nothing else reads it, so a
			// missing one is not a reason to lose the entry. The key is the honest
			// fallback: it is what a relink dialogue would have to print anyway, and
			// now that the key is a path that fallback is something a person can go
			// and look for rather than sixty-four characters of hex.
			name: typeof raw.name === "string" ? raw.name : src,
		};
	}
	return Object.keys(out).length > 0 ? { assets: out } : {};
}

function isConstraint(value: unknown): value is Constraint {
	if (!isRecord(value)) return false;
	if (typeof value.id !== "string" || !value.id) return false;
	if (typeof value.kind !== "string" || !(value.kind in CONSTRAINT_KINDS)) {
		return false;
	}
	if (typeof value.prop !== "string" || !(value.prop in PROPS)) return false;
	// The geometric fields are optional, but a bogus one would compile into a
	// fact no rule matches — a rule that silently does nothing.
	if (value.edge !== undefined && !(String(value.edge) in EDGES)) return false;
	// A bogus strength is worse than a bogus edge: it would compile to a
	// priority level nothing names, so the rule would be ranked at a tier the
	// panel cannot show and the cost vector would gain an entry nobody can read.
	if (value.strength !== undefined && !(String(value.strength) in STRENGTHS)) {
		return false;
	}
	if (
		value.value !== undefined &&
		!Number.isFinite(value.value) &&
		!Array.isArray(value.value)
	) {
		return false;
	}
	if (!Array.isArray(value.nodes)) return false;
	return value.nodes.every((n) => typeof n === "string");
}

/**
 * A dimension written before it could name a token is a bare number of pixels.
 * Widening it here rather than at every read keeps the rest of the code with
 * one shape to think about.
 *
 * A dimension that is already a value gets the lattice pass instead: a `gap`
 * rule holding `"20.5px"` would otherwise measure nothing at all, and a rule
 * with no distance in it is a rule that silently stops holding.
 */
function migrateConstraint(c: Constraint): Constraint {
	const stored = c.value as unknown;
	if (typeof stored === "number") {
		return { ...c, value: dimension(fromLegacyPx(stored)) };
	}
	if (!Array.isArray(stored)) return c;
	const value = snapValue(stored as Value, "length");
	return value === stored ? c : { ...c, value };
}

/**
 * Reads nodes, wrapping a legacy artboard's contents in a real frame.
 *
 * The artboard's own size is two bare numbers of pixels from a document old
 * enough not to have had frames at all, so it crosses into EMU here; the
 * fallback beside it is already EMU, which is exactly the pair of numbers that
 * would otherwise be added up as if they were the same thing.
 */
function migrateNodes(input: Record<string, unknown>, legacy: boolean): SceneNode[] {
	const nodes = Array.isArray(input.nodes) ? pruneNodes(input.nodes, legacy) : [];
	const artboard = isRecord(input.artboard) ? input.artboard : null;
	if (!artboard) return nodes.length > 0 ? nodes : emptyScene().nodes;

	const size = (value: unknown, fallback: Emu) => {
		const n = Number(value);
		return Number.isFinite(n) && n > 0 ? fromLegacyPx(n) : fallback;
	};
	return [
		{
			id: "frame1",
			kind: "frame",
			name: "Frame 1",
			frame: makeFrame({
				x: 0,
				y: 0,
				width: size(artboard.width, DEFAULT_FRAME.width),
				height: size(artboard.height, DEFAULT_FRAME.height),
			}),
			props: {},
			children: nodes,
		},
	];
}

/**
 * A token needs a name, a type and at least one alternative. The value model
 * changed shape, so a document written against the old one is rejected here
 * and replaced with the starter set rather than half-loaded.
 */
function isToken(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (typeof value.id !== "string" || typeof value.name !== "string") return false;
	if (!Array.isArray(value.value) || value.value.length === 0) return false;
	return value.value.every(
		(term) =>
			isRecord(term) &&
			((term.kind === "literal" && typeof term.value === "string") ||
				(term.kind === "token" && typeof term.token === "string")),
	);
}

/**
 * A style needs an id, a name and at least one variant.
 *
 * A style with no variants is not a degenerate style, it is a variable with no
 * alternatives: the choice rule would demand a pick and there would be none, so
 * this is the one shape that has to be rejected rather than normalised.
 */
function isStyle(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (typeof value.id !== "string" || !value.id) return false;
	if (typeof value.name !== "string") return false;
	if (!Array.isArray(value.variants) || value.variants.length === 0) return false;
	return value.variants.every(
		(v) => isRecord(v) && (v.parts === undefined || isRecord(v.parts)),
	);
}

/**
 * Drops whatever a stored style says that this code would not have written: a
 * part naming a property no style may decide, and a part that is not a term.
 *
 * A variant left with nothing is kept, not dropped. "This treatment says
 * nothing" is a real alternative — it is how "styled or plain" is one
 * variable — and silently deleting it would renumber every variant after it,
 * which is what a pin and an instance's held picks are counted in.
 */
function normalizeStyle(value: unknown): Style {
	const raw = value as {
		id: string;
		name: string;
		variants: Array<Record<string, unknown>>;
	};
	return {
		id: raw.id,
		name: raw.name,
		variants: raw.variants.map((variant) => {
			const stored = isRecord(variant.parts) ? variant.parts : {};
			const parts: StyleVariant["parts"] = {};
			for (const prop of STYLE_PROPS) {
				const term = stored[prop];
				// A style is where a type ramp's sizes live, so it is one of the
				// two places a whole scale of lengths can be off the lattice at
				// once — the other being the tokens.
				if (isTerm(term)) {
					parts[prop] = snapTerm(term as Term, PROPS[prop].type);
				}
			}
			const name = variant.name;
			return typeof name === "string" ? { name, parts } : { parts };
		}),
	};
}

function isTerm(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (value.kind === "literal") return typeof value.value === "string";
	if (value.kind === "token") return typeof value.token === "string";
	return value.kind === "derived" && typeof value.from === "string";
}

/* ------------------------------------------------------------------ */
/* Reading a machine                                                   */
/* ------------------------------------------------------------------ */

/*
 * A machine is the first thing in the document whose *identifiers* reach the
 * generated program as terms of their own — `machine(m1)`, `mstate(m1,hover)`,
 * `mval(m1,press,duration)`, `stt(i1,hover,label)` — so the reader below is
 * stricter than the ones above it in exactly one respect and looser in every
 * other. The one rule worth stating before the code, because it decides every
 * question in it:
 *
 *   **Drop what could not be what it says it is. Keep what is merely wrong.**
 *
 * An id that is not spellable as an ASP constant is the first kind. It is not a
 * machine with a bad name, it is a term the program cannot hold; carrying it
 * would put `machine(My Machine)` in the text and take the whole document down
 * with a syntax error, which is a document nobody can open rather than a
 * machine nobody can use. Same for a duplicate id: two machines answering to one
 * name are one machine as far as the solver is concerned, and which of them it
 * turns out to be is decided by whichever fact grounds last. This is the
 * judgement {@link normalizeLines} already makes about a guide, for the same two
 * reasons, and the precedent is what makes it a rule rather than a preference.
 *
 * A transition pointing at a state the machine has not got is the second kind,
 * and it is deliberately kept. `mdangling(M,T)` exists to report exactly that,
 * the Machines panel offers a one-click rule that forbids it by name, and a
 * reader that quietly deleted the edge would repair the document into silence:
 * the designer would open a machine that had lost a transition and be told
 * nothing about why. The document is read, not corrected — the same sentence
 * that keeps a `guides` record on a rectangle and a dangling `instanceOf` on an
 * instance.
 *
 * A machine with no states at all is the one shape that has to go, and for the
 * reason a {@link Style} with no variants does. `initialState` is `states[0]`,
 * `mindex(M,S,1)` never grounds, `minitial/2` is empty, and so `shown/2` has
 * nothing to default to — every instance of the definition would be drawn in no
 * state whatsoever, which is not a degenerate machine but an absent one wearing
 * a machine's name.
 */

/**
 * Every machine the document still holds, in order.
 *
 * A machine's id is unique **in the document** — unlike a state id, which is
 * unique within its machine — because it is the first argument of every
 * machine-scoped predicate there is, and it is what makes `hover` a state of one
 * machine rather than a state of all of them.
 *
 * The `root` is not checked against the document's nodes. A machine whose root
 * has been deleted, or was never there, says nothing at all: `machine_of(M,R)`
 * joins against `instance(I,R)` and finds nobody, so no copy is minted and no
 * state is drawn. That is precisely the silence a dangling
 * {@link SceneNode.instanceOf} already leaves, and it is worth keeping for the
 * same reason — a definition released and re-made, or a machine copied between
 * documents ahead of the component it drives, comes back to life rather than
 * having to be rebuilt from memory.
 */
function normalizeMachines(list: readonly unknown[]): Machine[] {
	const out: Machine[] = [];
	const taken = new Set<string>();
	for (const raw of list) {
		if (!isRecord(raw)) continue;
		const id = raw.id;
		if (typeof id !== "string" || wordOf(id) !== id || taken.has(id)) continue;
		if (typeof raw.root !== "string" || !raw.root) continue;
		const states = normalizeStates(raw.states);
		// The one shape that cannot be normalised into anything — see above.
		if (states.length === 0) continue;
		taken.add(id);
		out.push({
			id,
			// A name is what a person reads and nothing else reads it, so a
			// missing one is not a reason to lose the machine. The id is the
			// honest fallback: it is what every other surface would have to
			// print anyway.
			name: typeof raw.name === "string" ? raw.name : id,
			root: raw.root,
			states,
			transitions: normalizeTransitions(raw.transitions),
			// Three optional lists, and all three keep their absence. A machine
			// with no `inputs` is a machine nobody drives from outside, which is
			// every machine any document written before this rung holds; a reader
			// that wrote `[]` would still be right and a reader that wrote a
			// default input would change what those documents mean. `layers` is
			// the same claim about a one-layer machine, and the program mints
			// `mlayer(M,base)` for it rather than the document doing so.
			...listField("inputs", normalizeInputs(raw.inputs)),
			...listField("layers", normalizeLayers(raw.layers)),
			...listField("timelines", normalizeTimelines(raw.timelines)),
		});
	}
	return out;
}

/**
 * An optional list as a fragment to spread: the key where there is something to
 * say, and no key at all where there is not.
 *
 * Three fields want this and each of them means something by the absence, so it
 * is one helper rather than three ternaries — the shape `normalizeLines` already
 * uses to keep "no lines" spelled once.
 */
function listField<K extends string, T>(
	key: K,
	list: T[],
): { [P in K]?: T[] } {
	return (list.length > 0 ? { [key]: list } : {}) as { [P in K]?: T[] };
}

/**
 * The inputs of one machine.
 *
 * An id that is not an ASP constant, or one already taken in this machine, is
 * dropped for {@link normalizeStates}' reason word for word: it reaches the
 * program as `minput(M,X)` and inside `mcondin(M,T,K,X)`, so a name no term can
 * hold takes the document down with a syntax error, and two inputs answering to
 * one name are one input as far as the solver is concerned.
 *
 * A `kind` the table has not got is the third: it decides which comparisons the
 * input may be asked of and which facts it emits, so an unknown one is an input
 * with no behaviour at all rather than an input with an odd label. That is the
 * judgement a bogus {@link Trigger} gets, one rung down.
 *
 * `initial`, `min` and `max` are **kept as they were typed**, unread and
 * unrepaired, and this is the one place worth arguing. They are plain strings
 * rather than {@link Value}s on purpose — see {@link MachineInput} — and a
 * number that reads as nothing is not a broken document, it is a range the
 * checks will decline to say anything about. A reader that dropped `min: "1e9"`
 * would silently turn "this guard is impossible" into "this guard is fine".
 */
function normalizeInputs(value: unknown): MachineInput[] {
	if (!Array.isArray(value)) return [];
	const out: MachineInput[] = [];
	const taken = new Set<string>();
	for (const raw of value) {
		if (!isRecord(raw)) continue;
		const id = raw.id;
		if (typeof id !== "string" || wordOf(id) !== id || taken.has(id)) continue;
		const kind = raw.kind;
		if (typeof kind !== "string" || !Object.hasOwn(INPUT_KINDS, kind)) continue;
		taken.add(id);
		out.push({
			id,
			name: typeof raw.name === "string" ? raw.name : id,
			kind: kind as InputKind,
			...(typeof raw.initial === "string" ? { initial: raw.initial } : {}),
			...(typeof raw.min === "string" ? { min: raw.min } : {}),
			...(typeof raw.max === "string" ? { max: raw.max } : {}),
		});
	}
	return out;
}

/**
 * The layers of one machine, in order — **and the order is the priority**, the
 * way {@link normalizeStates}' order is the initial state.
 *
 * Which is why a duplicate id drops the *second* and keeps the first, exactly as
 * a duplicate state id does: dropping the first would move every later layer up
 * one and change which of them writes a contested property, and a reader that
 * could re-rank a machine's layers is a reader that changes what every instance
 * of the definition draws.
 */
function normalizeLayers(value: unknown): MachineLayer[] {
	if (!Array.isArray(value)) return [];
	const out: MachineLayer[] = [];
	const taken = new Set<string>();
	for (const raw of value) {
		if (!isRecord(raw)) continue;
		const id = raw.id;
		if (typeof id !== "string" || wordOf(id) !== id || taken.has(id)) continue;
		taken.add(id);
		out.push({ id, name: typeof raw.name === "string" ? raw.name : id });
	}
	return out;
}

/**
 * The timelines of one machine.
 *
 * A timeline nothing plays is legal and is kept: it costs a handful of variables
 * and no copies at all, and it is how somebody works on an animation before
 * wiring it up. What is dropped is a timeline the program could not name — an id
 * that is not an ASP constant, or a repeat — and a `loop` word the table has not
 * got falls back rather than losing the timeline, because the mode is the shape
 * of the playback, not whether there is any. It falls back *here*, in the reader,
 * where an unknown easing no longer does: a loop mode reaches the program as a
 * fact this file writes, so a word no rule can match would silently disable a
 * check, while an easing reaches it as a literal both readers fall back on in
 * the same place.
 */
function normalizeTimelines(value: unknown): Timeline[] {
	if (!Array.isArray(value)) return [];
	const out: Timeline[] = [];
	const taken = new Set<string>();
	for (const raw of value) {
		if (!isRecord(raw)) continue;
		const id = raw.id;
		if (typeof id !== "string" || wordOf(id) !== id || taken.has(id)) continue;
		taken.add(id);
		const length = settingValue(raw.length, "duration");
		const loop = raw.loop;
		out.push({
			id,
			name: typeof raw.name === "string" ? raw.name : id,
			tracks: normalizeTracks(raw.tracks),
			// Absent is the last keyframe's time, derived rather than stored, so a
			// timeline cannot disagree with its own contents — which means a
			// `length` that reads as nothing has to stay absent rather than become
			// zero, or a document with a mistyped duration would play nothing.
			...(length ? { length } : {}),
			...(loop === "none" || loop === "loop" || loop === "pingPong"
				? { loop: loop as LoopMode }
				: {}),
		});
	}
	return out;
}

/**
 * The tracks of one timeline.
 *
 * **A track that names none of `prop`, `dim` and `turn` is read as no track at
 * all**, and this is the one place the machine reader drops something for saying
 * nothing rather than for being unspellable. The reason is that a track's whole
 * identity is what it animates: it reaches the program as `trkp(N,P)` or
 * `trkd(N,D)`, a term built out of exactly that, so a track with no subject has
 * no term, and its keyframes would be values keyed by nothing. A track that
 * names *two* keeps the first in table order — property, then dimension, then
 * rotation — because two subjects is two tracks sharing a keyframe list, and
 * splitting them here would invent a track the designer never wrote.
 *
 * The `part` is **not** checked against the definition, the way a state's delta
 * key is not: a part deleted and drawn again should find its animation waiting
 * rather than gone.
 */
function normalizeTracks(value: unknown): Track[] {
	if (!Array.isArray(value)) return [];
	const out: Track[] = [];
	for (const raw of value) {
		if (!isRecord(raw)) continue;
		const part = raw.part;
		if (typeof part !== "string" || !part) continue;
		const prop =
			typeof raw.prop === "string" && Object.hasOwn(PROPS, raw.prop)
				? (raw.prop as PropName)
				: undefined;
		const dim =
			prop === undefined &&
			typeof raw.dim === "string" &&
			DIMENSIONS_3D.includes(raw.dim as Axis3)
				? (raw.dim as Axis3)
				: undefined;
		const turn =
			prop === undefined &&
			dim === undefined &&
			typeof raw.turn === "string" &&
			Object.hasOwn(TURNS, raw.turn)
				? (raw.turn as Turn)
				: undefined;
		if (prop === undefined && dim === undefined && turn === undefined) continue;
		// What a keyframe's value *is* decides whether it gets the lattice sweep: a
		// property carries its own type, a dimension is a length whichever of the
		// six it is, and a rotation is an angle, which has no lattice at all.
		const type: ValueType =
			prop !== undefined
				? PROPS[prop].type
				: dim !== undefined
					? dimensionSpec(dim).type
					: "angle";
		out.push({
			part,
			...(prop !== undefined ? { prop } : {}),
			...(dim !== undefined ? { dim } : {}),
			...(turn !== undefined ? { turn } : {}),
			keys: orderKeys(normalizeKeyframes(raw.keys, type)),
		});
	}
	return out;
}

/** One track's keyframes, in the shape the document holds them now. */
function normalizeKeyframes(value: unknown, type: ValueType): Keyframe[] {
	if (!Array.isArray(value)) return [];
	const out: Keyframe[] = [];
	for (const raw of value) {
		if (!isRecord(raw)) continue;
		const at = settingValue(raw.at, "duration");
		const what = settingValue(raw.value, type);
		// A keyframe with no time or no value is not a keyframe that says
		// something odd, it is half a keyframe: the program mints `kat` and `kval`
		// per key and the export interpolates between two of them, so one with
		// neither end would be a segment with nowhere to start. Both are required
		// where the three fields of a {@link Track} are not, because a track can
		// be being built and a key cannot be half-placed.
		if (!at || !what) continue;
		// The same widening a transition's easing takes, in the same commit and for
		// the same reason — see {@link Keyframe.easing}. A stored `"easeOut"` comes
		// back as `[lit("easeOut")]` through `snapValue`, which does nothing for a
		// type with no `length` quantity, so the migration is this one line and it
		// adds no universes: a one-alternative value is not a choice anybody makes.
		const easing = settingValue(raw.easing, "easing");
		out.push({
			at,
			value: what,
			...(easing ? { easing } : {}),
		});
	}
	return out;
}

/**
 * A track's keys in time order, with two keys at one time collapsed to the
 * first.
 *
 * **Only where every key's time is a literal this reader can read.** A
 * keyframe's `at` is a {@link Value}, so it may name a token, and a token may
 * hold two alternatives — which means "time order" is a fact about a *universe*
 * rather than about the document, and a reader that sorted on the first
 * alternative would reorder somebody's timeline on the strength of a design they
 * are not looking at. Where any time is unreadable the document's own order
 * stands, and a key that lands before its predecessor in some universe is
 * derived as `mkbackwards/4` and reported — which is exactly the class of bug a
 * multiverse invents and a linter over the document cannot catch.
 *
 * Idempotent, as every pass in this file has to be: sorting a sorted list is the
 * same list, and a de-duplicated one has nothing left to collapse.
 */
function orderKeys(keys: Keyframe[]): Keyframe[] {
	const times = keys.map((key) =>
		key.at.length === 1 && key.at[0].kind === "literal"
			? msOf(key.at[0].value)
			: undefined,
	);
	if (times.some((ms) => ms === undefined)) return keys;
	const order = keys
		.map((key, index) => ({ key, ms: times[index] as number, index }))
		.sort((a, b) => a.ms - b.ms || a.index - b.index);
	const out: Keyframe[] = [];
	const at = new Set<number>();
	for (const entry of order) {
		if (at.has(entry.ms)) continue;
		at.add(entry.ms);
		out.push(entry.key);
	}
	return out;
}

/**
 * A state's blend, or nothing.
 *
 * A `kind` the table has not got loses the blend rather than the state, because
 * the kind decides how the stops are read: `oneD` lays them along an input's
 * axis and `direct` weights each by its own input, and a third word would be a
 * mixing rule nothing implements. A stop whose `at` is outside the input's
 * declared range is **kept** — that is `mstopout/3`'s whole job, the Machines
 * panel offers a canned rule that forbids it by name, and a reader that dropped
 * the stop would take away the symptom and any way of finding out. The same
 * goes for a stop naming a timeline the machine has not got, for the reason a
 * transition naming a missing state is kept.
 */
function normalizeBlend(value: unknown): Blend | undefined {
	if (!isRecord(value)) return undefined;
	const kind = value.kind;
	if (typeof kind !== "string" || !Object.hasOwn(BLEND_KINDS, kind)) {
		return undefined;
	}
	const stops: BlendStop[] = [];
	if (Array.isArray(value.stops)) {
		for (const raw of value.stops) {
			if (!isRecord(raw)) continue;
			if (typeof raw.timeline !== "string" || !raw.timeline) continue;
			stops.push({
				timeline: raw.timeline,
				...(typeof raw.at === "string" ? { at: raw.at } : {}),
				...(typeof raw.by === "string" ? { by: raw.by } : {}),
			});
		}
	}
	const input = value.input;
	return {
		kind: kind as BlendKind,
		...(typeof input === "string" ? { input } : {}),
		stops,
	};
}

/**
 * One transition's guard.
 *
 * **A condition naming an input the machine has not got is kept**, and it is the
 * fourth dangling reference this file deliberately preserves. `mcbad(M,T,K)`
 * exists to report exactly that — along with an operator the input's kind does
 * not take and a comparand that reads as no number — and `mguardnever/2` reads
 * it, so the edge shows up as impossible with a name attached. A reader that
 * dropped the condition would turn a guarded edge into an unguarded one, which
 * is not a smaller mistake than the one it was hiding: it is a machine that
 * silently starts firing.
 *
 * What is dropped is a condition the program could not hold: an `input` that is
 * not an ASP constant, since it is an argument of `mcondin/4`, and an `op` the
 * table has not got, since the op is what decides which fact the condition
 * becomes and an unknown one would become none of them.
 */
function normalizeConditions(value: unknown): Condition[] {
	if (!Array.isArray(value)) return [];
	const out: Condition[] = [];
	for (const raw of value) {
		if (!isRecord(raw)) continue;
		const input = raw.input;
		if (typeof input !== "string" || wordOf(input) !== input) continue;
		const op = raw.op;
		if (typeof op !== "string" || !Object.hasOwn(COMPARE_OPS, op)) continue;
		out.push({
			input,
			op: op as CompareOp,
			// Kept as typed, for {@link normalizeInputs}' reason: a comparand that
			// reads as nothing is what `mcbad/3` is looking for, and repairing it
			// here would be repairing the document into silence.
			...(typeof raw.value === "string" ? { value: raw.value } : {}),
		});
	}
	return out;
}

/**
 * The states of one machine, in document order — **and the order is the
 * answer**, because the first state is the initial one and there is no flag
 * that says so.
 *
 * Which is why a duplicate id drops the *second* and keeps the first: dropping
 * the first instead could change which state a machine starts in, and a reader
 * that could re-point a machine's initial state is a reader that changes what
 * every instance of the definition draws. Keeping the earlier one is also what
 * {@link normalizeLines} does with a repeated guide name, and one rule for
 * "first wins" is worth more than a per-case argument.
 *
 * A state whose id is one of {@link RESERVED_STATES} is dropped, on that same
 * "could not be what it says it is" judgement. `entry`, `exit` and `any` are
 * words the program reads as *positions on an edge* — where a machine begins,
 * where a layer stops, and an edge that may be taken from anywhere — so a state
 * called `exit` is a term the rules already mean something else by, and keeping
 * it would make one picture wrong in a way nothing reports: `mefrom/3` would
 * offer it as an ordinary source and as the sugar at the same time.
 */
function normalizeStates(value: unknown): MachineState[] {
	if (!Array.isArray(value)) return [];
	const out: MachineState[] = [];
	const taken = new Set<string>();
	for (const raw of value) {
		if (!isRecord(raw)) continue;
		const id = raw.id;
		// Unique within the machine, and an ASP constant: it reaches the program
		// inside `stt(I,S,N)` and inside every variable key a delta mints, so a
		// state called `Pressed Down` is a term nothing can hold.
		if (typeof id !== "string" || wordOf(id) !== id || taken.has(id)) continue;
		if (RESERVED_STATES.has(id)) continue;
		taken.add(id);
		const layer = raw.layer;
		const timeline = raw.timeline;
		const clock = raw.clock;
		const blend = normalizeBlend(raw.blend);
		out.push({
			id,
			name: typeof raw.name === "string" ? raw.name : id,
			parts: normalizeStateParts(raw.parts),
			// A layer id and a timeline id are strings or nothing, and neither is
			// checked against the machine's own lists — the same string-or-nothing
			// question {@link SceneNode.state} gets, and the same answer. A state
			// naming a layer that was deleted is the *first* layer, which is what
			// `layerOf` already falls back to, and a state naming a timeline that
			// was deleted plays nothing and says so through `mtplays/3` finding no
			// `mtimeline/2`. Repairing either would spend a real edit — one a
			// collaborator pulls — on a question that answers itself.
			...(typeof layer === "string" ? { layer } : {}),
			...(typeof timeline === "string" ? { timeline } : {}),
			// A clock, unlike the two ids above it, is checked against its own table
			// — and the asymmetry is the difference between a *reference* and a
			// *word*. A layer id names something else in the document and may
			// legitimately be waiting for it to come back; a clock names one of three
			// constants this build knows, and a fourth would reach `mclock/3` as a
			// term no rule can match, which silently disables the `mexitpast/2`
			// narrowing rather than changing it. The same reading `loop` gets, one
			// record over, and for the same reason.
			...(clock === "time" || clock === "view" || clock === "pageScroll"
				? { clock }
				: {}),
			...(blend ? { blend } : {}),
		});
	}
	return out;
}

/**
 * One state's deltas, keyed by definition part id.
 *
 * A key naming a part the definition has not got is **kept**. It is the third
 * dangling reference in this file and it behaves like the other two: the
 * materialisation analysis asks `parts.has(nodeId)` and skips it, so it emits
 * nothing and costs nothing. What keeping it buys is the case that actually
 * happens — a part deleted from a definition and drawn again, or a definition
 * edited in one branch and a machine in another — where the delta is waiting
 * rather than gone.
 *
 * An entry that survives with nothing usable in it is kept too, and this is the
 * one place that is worth spelling out, because `clearStatePart` deliberately
 * removes such an entry and this reader deliberately does not. The difference is
 * who is speaking. An edit is a person saying "this state changes nothing here",
 * and it should leave one spelling of that behind rather than two. A reader is
 * not being asked anything; it is being handed a file. `stateTouches` already
 * reads an empty delta and an absent one as the same claim, so nothing
 * downstream can tell them apart, and tidying it would be a rewrite of somebody
 * else's document bought with nothing at all.
 */
function normalizeStateParts(value: unknown): Record<string, StatePart> {
	if (!isRecord(value)) return {};
	const out: Record<string, StatePart> = {};
	for (const [nodeId, raw] of Object.entries(value)) {
		if (!isRecord(raw)) continue;
		out[nodeId] = normalizeStatePart(raw);
	}
	return out;
}

/**
 * One delta: what this state changes about one part.
 *
 * The three fields are filtered against the three tables that say what they can
 * be — {@link PROP_NAMES}, {@link DIMENSIONS}, and `true`. A delta spans *all*
 * of `PROPS` rather than {@link STYLE_PROPS}, which is the one place this reader
 * is looser than {@link normalizeStyle}, and the reason is on
 * {@link StatePart}: a style is a treatment several unrelated nodes wear, while
 * a state is one machine's account of one definition, and "the label says
 * Saving…" is exactly what a state is for and exactly what a style must not be.
 *
 * The lengths among the properties get the lattice pass, because a delta is one
 * more place a document can hold `"20.5px"` and one more place that would
 * otherwise read as no length at all — same sweep, new home. Durations do not
 * appear here at all; they are on the transition, and time has no lattice to
 * snap to.
 */
function normalizeStatePart(raw: Record<string, unknown>): StatePart {
	const part: StatePart = {};
	if (isRecord(raw.props)) {
		const props: NonNullable<StatePart["props"]> = {};
		for (const prop of PROP_NAMES) {
			const value = raw.props[prop];
			if (Array.isArray(value)) {
				props[prop] = snapValue(value as Value, PROPS[prop].type);
			}
		}
		part.props = props;
	}
	if (isRecord(raw.frame)) {
		const frame: NonNullable<StatePart["frame"]> = {};
		// All six, not four. A state that lifts a mesh is the same kind of claim
		// as one that moves a button two pixels down, and the loop is over the
		// combined table so that the day a seventh axis exists this line is
		// already right. A flat document holds no `z` or `depth` entry, so the two
		// extra passes read nothing and write nothing.
		for (const dim of DIMENSIONS_3D) {
			const value = raw.frame[dim];
			// A dimension a state does not mention is the instance's own — the
			// guard in the program is per dimension — so unlike a node's frame
			// there is nothing to default here and a missing one is the point.
			if (Array.isArray(value)) {
				frame[dim] = snapValue(value as Value, dimensionSpec(dim).type);
			}
		}
		part.frame = frame;
	}
	if (isRecord(raw.turn)) {
		const turn: NonNullable<StatePart["turn"]> = {};
		for (const axis of TURN_NAMES) {
			const value = raw.turn[axis];
			if (Array.isArray(value)) {
				// Through the same sweep every other stored value goes through,
				// which asks the type table whether this quantity has a lattice to
				// be off. `angle` says no — `mdegOf` is exact or nothing and a
				// stored `"22.5deg"` is exactly 22500 thousandths — so this is a
				// no-op by construction rather than by omission, and it stays right
				// if an angle ever grows one.
				turn[axis] = snapValue(value as Value, "angle");
			}
		}
		part.turn = turn;
	}
	// `true` or absent, with no `false`, exactly as {@link SceneNode.component}
	// is: a part is drawn unless a state says otherwise, so "shown" needs no
	// spelling and a stored `false` is the same statement as silence.
	if (raw.hidden === true) part.hidden = true;
	return part;
}

/**
 * The edges of one machine.
 *
 * Three things get a transition dropped, and every one of them is a transition
 * that could not reach the program as the thing it claims to be:
 *
 *   - an id that is not an ASP constant, or one already taken in this machine —
 *     it names `mtrans(M,T)` and the three `mval(M,T,…)` variable keys, so a
 *     repeat is two edges the solver reads as one and a paced pair whose
 *     durations overwrite each other;
 *   - a `from` or `to` that is not an ASP constant. A state id always is one,
 *     so this is not an edge pointing at a missing state — that is kept, see
 *     below — it is an edge pointing at something no state could ever be
 *     called, and `mfrom(m1,t1,Not A State)` is a syntax error rather than a
 *     dangling reference;
 *   - a trigger the table has not got. This is {@link isConstraint}'s judgement
 *     about a bogus edge or strength, word for word: it would compile into a
 *     fact no rule matches and no browser fires, so the transition would sit in
 *     the panel looking wired and never move the machine once.
 *
 * A `from` or `to` naming a state this machine does not have is **kept**, and
 * that is the whole point of `mdangling/2`. It is the one broken thing a
 * document can hold that the program is built to *report*, the Machines panel
 * offers a canned rule that forbids it by name, and a reader that deleted the
 * edge would take away both the symptom and any way of finding out.
 */
function normalizeTransitions(value: unknown): Transition[] {
	if (!Array.isArray(value)) return [];
	const out: Transition[] = [];
	const taken = new Set<string>();
	for (const raw of value) {
		if (!isRecord(raw)) continue;
		const { id, from, to, trigger } = raw;
		if (typeof id !== "string" || wordOf(id) !== id || taken.has(id)) continue;
		if (typeof from !== "string" || wordOf(from) !== from) continue;
		if (typeof to !== "string" || wordOf(to) !== to) continue;
		if (typeof trigger !== "string" || !Object.hasOwn(TRIGGERS, trigger)) {
			continue;
		}
		taken.add(id);
		// A motion setting stored before it was a value — or as a bare number, or
		// as a word — comes back as a single-alternative value, through the same
		// {@link settingValue} every layout and grid setting goes through. What it
		// does *not* get is the lattice pass: `snapValue` asks the type table
		// whether this quantity holds lengths, `duration` says no, and time has no
		// lattice to be off in the first place. A stored `200` therefore stays
		// `"200"`, which `msOf` refuses as ambiguous by a factor of a thousand and
		// the transition falls to `mdefdur` — the same answer the program gives,
		// and a great deal better than guessing which unit somebody meant.
		const motion: Partial<Record<MotionProp, Value>> = {};
		for (const prop of MOTION_PROP_NAMES) {
			const setting = settingValue(raw[prop], MOTION_PROPS[prop].type);
			if (setting) motion[prop] = setting;
		}
		// The exit time is a fourth setting of exactly this shape and is read
		// exactly this way, against the same `duration` type. It is read out of
		// band rather than out of `MOTION_PROP_NAMES` for one reason and it is not
		// a design one — see {@link MotionProp}, which records why that union
		// cannot grow yet and what the one-line unblock is. When it does grow,
		// this line goes and the loop above covers it.
		const exit = settingValue(raw.exit, MOTION_PROPS.duration.type);
		// The fifth setting, and the only one that is not a duration. It goes
		// through the same {@link settingValue} for the same reason: a stored
		// `easing: "easeOut"` from every document written before curves were values
		// comes back as a one-alternative `easing` Value, which is the whole of the
		// migration and which costs no universes.
		const easing = settingValue(raw.easing, "easing");
		const only = raw.only;
		const conditions = normalizeConditions(raw.conditions);
		out.push({
			id,
			from,
			to,
			trigger: trigger as Trigger,
			...motion,
			...(exit ? { exit } : {}),
			// Absent and empty mean the same thing here — an unguarded edge — so
			// unlike `only` there is nothing to tell apart and an empty list is
			// dropped to absent. Every transition in every document written before
			// guards existed is unguarded, and it has to keep costing nothing.
			...(conditions.length > 0 ? { conditions } : {}),
			// An easing the table has not got is now **kept** rather than dropped,
			// which is a move of the repair from the reader to the readers rather
			// than a change of mind. It is still not the judgement a bogus trigger
			// gets — a trigger decides *whether* the machine ever moves and is
			// refused at the door — but the fallback belongs where both readers
			// take it: `measeopt/1` in the program and `curveOf` in `machines.ts`,
			// which agree by construction. A document should not lose what somebody
			// typed because a menu shrank, and a curve that came back from a
			// vocabulary this build has not got is a curve a later build may have.
			...(easing ? { easing } : {}),
			// Absent and empty mean different things — everything the delta
			// touches, against nothing at all — so an `only` that is not a list is
			// dropped to absent while a list that filters down to nothing stays
			// empty. Filtered against `PROPS` because it reaches the program as
			// `monly(M,T,P)` and a property name nothing knows is a filter that
			// silently excludes everything.
			...(Array.isArray(only)
				? {
						only: only.filter(
							(p): p is PropName =>
								typeof p === "string" && Object.hasOwn(PROPS, p),
						),
					}
				: {}),
			// Anything but a stored `false` is on. A transition written before the
			// switch existed is a transition somebody wanted, and defaulting the
			// other way would open a document with a machine that had quietly
			// stopped moving.
			enabled: raw.enabled !== false,
		});
	}
	return out;
}

/** A node is usable only if it carries a frame with all four dimensions. */
function isPlacedNode(value: unknown): value is SceneNode {
	if (!isRecord(value)) return false;
	if (typeof value.id !== "string" || !value.id) return false;
	if (typeof value.kind !== "string" || !(value.kind in KINDS)) return false;
	const frame = value.frame;
	if (!isRecord(frame)) return false;
	if (!DIMENSIONS.every((k) => dimensionValue(frame[k], k) !== undefined)) {
		return false;
	}
	if (value.children !== undefined && !Array.isArray(value.children)) return false;
	if (value.layout !== undefined && !isLayout(value.layout)) return false;
	// A path whose vertices did not survive would render as nothing at all, so
	// it is dropped rather than left as an invisible layer.
	if (value.points !== undefined && !isPoints(value.points)) return false;
	return true;
}

function isPoints(value: unknown): boolean {
	return (
		Array.isArray(value) &&
		value.every(
			(p) =>
				isRecord(p) &&
				Number.isFinite(Number(p.x)) &&
				Number.isFinite(Number(p.y)),
		)
	);
}

function isLayout(value: unknown): boolean {
	return isRecord(value);
}

/**
 * A node's own properties, with the lengths among them — a corner radius, a
 * stroke width, a font size — snapped onto the lattice.
 *
 * Which of them are lengths is read off {@link PROPS} rather than listed, so
 * `lineHeight` is safe by construction. A sweep that guessed from the shape of
 * the number instead would read `1.35` as 12858.75 EMU, find it off the lattice
 * like any other half-pixel, and write back `"1.36"` — a leading nobody typed,
 * on every node that took the property.
 */
function normalizeProps(props: SceneNode["props"]): SceneNode["props"] {
	if (!isRecord(props)) return {};
	const out: SceneNode["props"] = {};
	for (const [prop, value] of Object.entries(props)) {
		const key = prop as keyof SceneNode["props"];
		// Nothing validates a property's shape on the way in, so a stored value
		// that is not a list of alternatives is carried as it always was rather
		// than being handed to a walk that assumes one.
		out[key] =
			Array.isArray(value) && Object.hasOwn(PROPS, prop)
				? snapValue(value, PROPS[key].type)
				: value;
	}
	return out;
}

/**
 * One dimension as it is stored now: a {@link Value}.
 *
 * A frame stored before its dimensions were values is four bare numbers of
 * pixels, and comes back as four single-alternative values. It used to be
 * rounded to a whole pixel on the way in, because that rounding was what kept
 * the canvas and hit testing on the same pixel; EMU keeps them on the same
 * number exactly, so what is left is the lattice — as much of the stored number
 * as any unit can spell, which for a whole pixel is all of it.
 *
 * Undefined for anything that is neither, which is what makes a node with no
 * usable frame get dropped rather than rendered at nothing by nothing.
 */
function dimensionValue(raw: unknown, dim: Dimension): Value | undefined {
	if (Array.isArray(raw)) {
		return raw.length > 0 ? snapValue(raw as Value, FRAME_DIMS[dim].type) : undefined;
	}
	const n = Number(raw);
	// A bare string is a number here, not a word: nothing else was ever stored.
	if ((typeof raw === "number" || typeof raw === "string") && Number.isFinite(n)) {
		return single(legacyLength(n));
	}
	return undefined;
}

/** Every dimension in the shape the document holds now. */
function normalizeFrame(raw: Record<string, unknown>): FrameValue {
	const out = {} as FrameValue;
	for (const dim of DIMENSIONS) {
		out[dim] = dimensionValue(raw[dim], dim) ?? single(FRAME_DIMS[dim].fallback);
	}
	return out;
}

/**
 * One layout setting as it is stored now: a {@link Value}.
 *
 * A setting stored before it was one is a bare word, a number or a boolean, and
 * comes back as a single-alternative value; a setting stored before it existed
 * takes the table's default. Not a migration to maintain — the same
 * shape-normalisation everything else on the way in gets.
 *
 * `type` is what the setting holds, from {@link LAYOUT_PROPS} or
 * {@link GUIDE_PROPS}, and it does two jobs: it keeps the lattice pass off a
 * setting that is a word, and it says what a bare *number* was. A number in a
 * length is the pixels every legacy document meant by one; a number in anything
 * else is the number itself, which is what a column count of 12 is. A count that
 * arrives fractional is written back as it was rather than truncated — `tallyOf`
 * refuses it and the reader falls back to one track, which is a grid a designer
 * can see is wrong, where 12.5 quietly becoming 12 is not.
 */
function settingValue(raw: unknown, type: ValueType): Value | undefined {
	if (Array.isArray(raw)) {
		return raw.length > 0 ? snapValue(raw as Value, type) : undefined;
	}
	if (typeof raw === "number") {
		return single(isLengthType(type) ? legacyLength(raw) : String(raw));
	}
	if (typeof raw === "string") return snapValue(single(raw), type);
	// `grow` was a checkbox before it was two named options.
	if (typeof raw === "boolean") return raw ? single("grow") : undefined;
	return undefined;
}

/** Every setting a container holds, defaulted where it holds none. */
function normalizeLayout(value: unknown): AutoLayout {
	const raw = isRecord(value) ? value : {};
	const out = {} as AutoLayout;
	for (const prop of CONTAINER_PROPS) {
		out[prop] =
			settingValue(raw[prop], LAYOUT_PROPS[prop].type) ??
			single(LAYOUT_PROPS[prop].fallback);
	}
	return out;
}

/**
 * Every setting of a surface's grid, defaulted where it holds none — the twin of
 * {@link normalizeLayout}, over the twin table.
 *
 * Only reached where the document holds a `guides` field at all, because absence
 * is what "no grid" means: filling one in for every surface would rule every
 * artboard ever drawn with a one-column grid it never asked for, and the
 * compiler would then have a grid to emit for every document in the world.
 */
function normalizeGuides(value: unknown): SurfaceGuides {
	const raw = isRecord(value) ? value : {};
	const out = {} as SurfaceGuides;
	for (const prop of GUIDE_PROP_NAMES) {
		out[prop] =
			settingValue(raw[prop], GUIDE_PROPS[prop].type) ??
			single(GUIDE_PROPS[prop].fallback);
	}
	return out;
}

/**
 * The lines drawn on one surface, or nothing where there are none left.
 *
 * Three things get a line dropped, and each of them is a line that would
 * otherwise reach the generated program as something it cannot be: an id that is
 * not spellable as an ASP constant (it becomes a term — see {@link lineDatum}),
 * an id already used on this surface (two datums with one name), and an axis
 * that is neither of the two. A position that reads as nothing is *not* one of
 * them: it takes the origin, exactly as a frame dimension does, so a guide
 * linked to a token that was deleted stays a guide.
 *
 * An empty list comes back as nothing at all, so "no lines" has one spelling
 * rather than two. And unlike a malformed `layout`, a malformed line loses the
 * line rather than the node: an artboard is worth keeping even when the thing
 * drawn on it is not.
 */
function normalizeLines(value: unknown): Guide[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out: Guide[] = [];
	const taken = new Set<string>();
	for (const raw of value) {
		if (!isRecord(raw)) continue;
		const id = raw.id;
		if (typeof id !== "string" || wordOf(id) !== id || taken.has(id)) continue;
		const axis = raw.axis;
		if (axis !== "x" && axis !== "y") continue;
		const at = settingValue(raw.at, "length") ?? single(FRAME_DIMS.x.fallback);
		taken.add(id);
		out.push({ id, axis, at, ...(raw.locked === true ? { locked: true } : {}) });
	}
	return out.length > 0 ? out : undefined;
}

/**
 * Where a node sits on the third axis, or nothing where it says nothing usable.
 *
 * Sparse in, sparse out: a dimension the document does not mention is z 0 or
 * depth 0, exactly as the program's own default rule makes it for a node in the
 * third axis, so there is nothing to fill in and a missing entry is the point.
 * That is the opposite of {@link normalizeFrame}, which defaults every one of
 * its four, and the difference is the whole no-regression story — a document
 * with no 3D in it must come back holding no `spatial` anywhere, or the
 * compiler's gate opens on a file that never asked for it.
 *
 * The lengths get the lattice sweep, because a `z` is one more place a document
 * can hold `"20.5px"` and one more place that would otherwise read as no length
 * at all and quietly put the node back on the page.
 */
function normalizeSpatial(value: unknown): SpatialValue | undefined {
	if (!isRecord(value)) return undefined;
	const out: SpatialValue = {};
	for (const dim of SPATIALS) {
		const stored = value[dim];
		// A dimension that is not a list of alternatives is not a dimension: the
		// third axis has no legacy bare-number spelling to migrate, because it did
		// not exist before values did.
		if (!Array.isArray(stored) || stored.length === 0) continue;
		out[dim] = snapValue(stored as Value, SPATIAL_DIMS[dim].type);
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * How a node is turned, or nothing.
 *
 * The twin of {@link normalizeSpatial}, over the twin table, with one difference
 * stated rather than absorbed: **an angle is not snapped.** `snapValue` asks the
 * type table whether the quantity has a lattice to be off, and `angle` has none
 * — `mdegOf` is exact or nothing and a stored `"22.5deg"` is exactly 22500
 * thousandths of a degree, which no rewriting could improve on. The call is made
 * anyway, through the same one reader, so that the answer stays in the table
 * rather than in a comment somebody has to find.
 */
function normalizeTurn(value: unknown): TurnValue | undefined {
	if (!isRecord(value)) return undefined;
	const out: TurnValue = {};
	for (const axis of TURN_NAMES) {
		const stored = value[axis];
		if (!Array.isArray(stored) || stored.length === 0) continue;
		out[axis] = snapValue(stored as Value, "angle");
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Which state an instance is drawn in on each further layer, or nothing.
 *
 * Both halves are plain ids and neither is checked against a machine, for
 * {@link SceneNode.state}'s reason exactly: `shownStates` falls back to each
 * layer's own initial state, so a machine edited down leaves its instances
 * legal, and a reader that rewrote them would spend a real edit on a question
 * that answers itself every time it is asked.
 */
function normalizeNodeStates(
	value: unknown,
): Record<string, string> | undefined {
	if (!isRecord(value)) return undefined;
	const out: Record<string, string> = {};
	for (const [layer, state] of Object.entries(value)) {
		if (typeof state === "string" && state) out[layer] = state;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The path a legacy payload's bytes are at, given its content hash.
 *
 * One expression in one place, so the two things that must agree — the ref
 * {@link migrateMeshRef} builds and the key {@link normalizeAssets} rewrites the
 * index to — cannot drift apart into two spellings of one directory name.
 *
 * `/assets/<hash>` is where `putAsset` wrote, and those files are still in the
 * trees of documents that were made while it existed. Nothing writes there any
 * more; everything still reads there, because this points at it.
 *
 * A `function` and not the `const` arrow this file's other one-liners are, for
 * one reason: `normalizeAssets` calls it from four hundred lines above, and a
 * module that normalised a scene while it was still evaluating — which a
 * template built at import time would — would hit the temporal dead zone of a
 * `const`. Hoisting here is not a style preference, it is the difference between
 * working and not.
 */
function legacyAssetPath(hash: string): string {
	return `/assets/${hash}`;
}

/**
 * True when a stored value is the whole of a {@link MeshRef}.
 *
 * Every field is required, and that is not strictness for its own sake: the
 * path is the only way back to the bytes, the part is the only way to pick this
 * node's geometry out of them, the format decides which parser reads them, the
 * bounds are what the node draws as while the file is missing or being fetched,
 * and the triangle count is what the budget rule and the layer row are about. A
 * reference missing any of them is a model that would draw at no size from no
 * file, which is the judgement a path with no usable vertices already gets.
 *
 * `part` is checked as a pair of whole, non-negative numbers rather than as
 * merely present. They index the file's own arrays, and a fractional or negative
 * index is not a subscript that misses — it is a value that came from somewhere
 * other than an import, and a node carrying one would ask the loader a question
 * with no answer on every frame. Zero is legal and is the overwhelmingly common
 * case: a one-mesh file is node 0, primitive 0.
 *
 * What is deliberately *not* asked is whether {@link Scene.assets} knows the
 * path, or whether the project's tree holds a file there. See the call site.
 */
function isMeshRef(value: unknown): value is MeshRef {
	if (!isRecord(value)) return false;
	if (typeof value.src !== "string" || !value.src) return false;
	if (value.format !== "gltf" && value.format !== "glb") return false;
	if (!Number.isFinite(Number(value.triangles))) return false;
	const part = value.part;
	if (!isRecord(part)) return false;
	for (const index of [part.node, part.primitive]) {
		if (!Number.isInteger(index) || (index as number) < 0) return false;
	}
	const bounds = value.bounds;
	if (!isRecord(bounds)) return false;
	const axes: readonly (Dimension | Spatial)[] = [...DIMENSIONS, ...SPATIALS];
	return axes.every((axis) => Number.isFinite(Number(bounds[axis])));
}

/**
 * A `MeshRef` written before geometry was a file, rewritten as one.
 *
 * **The migration is exact, and that is a property of what the old payloads
 * were.** An old ref is `{ asset: "<hash>", format, bounds, triangles, source? }`
 * and its bytes are at `/assets/<hash>`: a standalone glTF holding *one node,
 * one mesh, one primitive*, written by `gltfWriter` from geometry the importer
 * had already scaled and already centred. So `{ node: 0, primitive: 0 }` is not
 * a guess — it is the only part such a file has — and running the new loader's
 * `meshPart` over it is the identity in all three of its steps: the derived
 * scale chain is `[1,1,1]` because the writer emitted no scale, and
 * `centreTriangles` returns its input untouched because it has an explicit early
 * return for a box that is already centred.
 *
 * **The migrated node therefore draws the same vertices it drew before, through
 * the new code path, with no legacy branch anywhere in the loader.** That is
 * where invariant 4 is discharged for the third axis, and it is asserted rather
 * than asserted-of: `gltfimport.test.ts`'s "a payload the old importer wrote
 * normalises to itself" runs a `gltfWriter` file through `meshPart` and compares
 * the positions.
 *
 * *Rejected: a `legacy` branch in `useAsset.ts` that reads a hash-shaped `asset`
 * field.* It would have been fewer lines here and it would have put a second
 * meaning for "where the geometry is" into the one function whose whole job is
 * that there is one. A migration runs once per document on read; a branch in the
 * loader runs on every frame of every document forever.
 *
 * `source` is dropped rather than carried: it was the free-form name of the file
 * the geometry came from, and the path now *is* that, which is the argument
 * {@link MeshRef.src} makes. Keeping it would leave two answers to one question
 * with nothing keeping the second one true.
 *
 * Returns the value untouched when it is not the legacy shape, so this is safe
 * to run over every mesh on every read: a ref already in the new shape has no
 * string `asset` and falls straight through to {@link isMeshRef}.
 */
function migrateMeshRef(value: unknown): unknown {
	if (!isRecord(value)) return value;
	if (typeof value.asset !== "string" || !value.asset) return value;
	if (value.src !== undefined) return value;
	const { asset, source: _dropped, ...rest } = value;
	return {
		...rest,
		src: legacyAssetPath(asset),
		part: { node: 0, primitive: 0 },
	};
}

/**
 * Keeps only placeable nodes, at every depth.
 *
 * `legacy` says the document predates EMU, and it reaches exactly one thing: a
 * path's vertices, the only geometry stored as bare numbers rather than as
 * length text. Everything else on a node either carries its unit in the string
 * or is a shape this code stopped writing long enough ago that a bare number in
 * it can only be pixels.
 */
function pruneNodes(list: readonly unknown[], legacy: boolean): SceneNode[] {
	const out: SceneNode[] = [];
	for (const raw of list) {
		if (!isPlacedNode(raw)) continue;
		const node = raw as SceneNode;
		// Content used to be a bare string beside the properties. Nothing is
		// published, so this is not a migration to maintain — it is the same
		// shape-normalisation everything else on the way in gets.
		const carried =
			typeof (node as { text?: unknown }).text === "string"
				? {
						...node,
						props: {
							...node.props,
							text: single((node as unknown as { text: string }).text),
						},
					}
				: node;
		const withGeometry = {
			...carried,
			frame: normalizeFrame(
				(raw as { frame: Record<string, unknown> }).frame,
			),
			props: normalizeProps(carried.props),
			// A path's frame is the bounding box of its vertices, so the two have
			// to cross into EMU together or the shape stops filling the box the
			// canvas draws and the pen edits.
			...(legacy && node.points ? { points: legacyPoints(node.points) } : {}),
		};
		let fixed = withGeometry.layout
			? { ...withGeometry, layout: normalizeLayout(withGeometry.layout) }
			: withGeometry;
		// Both guide fields are absence-as-off, so both are touched only where the
		// document holds them — and a `guides` that is not a record at all is
		// dropped rather than defaulted, since inventing a grid is worse than
		// losing whatever that was.
		if (fixed.guides !== undefined) {
			if (isRecord(fixed.guides)) {
				fixed = { ...fixed, guides: normalizeGuides(fixed.guides) };
			} else {
				const { guides: _dropped, ...rest } = fixed;
				fixed = rest as SceneNode;
			}
		}
		if (fixed.lines !== undefined) {
			const lines = normalizeLines(fixed.lines);
			if (lines) {
				fixed = { ...fixed, lines };
			} else {
				const { lines: _dropped, ...rest } = fixed;
				fixed = rest as SceneNode;
			}
		}
		for (const prop of CHILD_PROPS) {
			const setting = settingValue(fixed[prop], LAYOUT_PROPS[prop].type);
			if (setting === fixed[prop]) continue;
			const { [prop]: _old, ...rest } = fixed;
			fixed = setting ? { ...rest, [prop]: setting } : (rest as SceneNode);
		}
		// A style reference is an id and nothing else. Anything else is dropped
		// rather than carried, so `styleOf` is asking a string-or-nothing
		// question everywhere downstream.
		if (fixed.style !== undefined && typeof fixed.style !== "string") {
			const { style: _dropped, ...rest } = fixed;
			fixed = rest as SceneNode;
		}
		// And a drawn state is a state id and nothing else — the same
		// string-or-nothing question, asked of the field that is structurally
		// the twin of `holds`.
		//
		// What is *not* checked here is whether the machine still has that
		// state, and the reason is that `shownState` already falls back to the
		// initial one. A machine edited down leaves its instances legal, and a
		// reader that rewrote them would spend a real edit — one that shows up in
		// the file a collaborator pulls — on a question that answers itself every
		// time it is asked. It is the dangling `instanceOf` argument, one field
		// over, and the field's own doc-comment promises it in as many words.
		if (fixed.state !== undefined && typeof fixed.state !== "string") {
			const { state: _dropped, ...rest } = fixed;
			fixed = rest as SceneNode;
		}
		// And the per-layer twin of it. Entries that are not state ids are dropped
		// one at a time rather than losing the record, because an instance that
		// lost one entry should still be drawn in the states it can still name —
		// and a record left with nothing goes entirely, so that "this instance says
		// nothing about the further layers" has one spelling.
		if (fixed.states !== undefined) {
			const states = normalizeNodeStates(fixed.states);
			if (states) {
				fixed = { ...fixed, states };
			} else {
				const { states: _dropped, ...rest } = fixed;
				fixed = rest as SceneNode;
			}
		}
		// The third axis, and how the node is turned. Both are absence-as-flat, so
		// both are touched only where the document holds them and both go entirely
		// when nothing usable survives — "this node is flat" and "this node is not
		// turned" each get one spelling, which is what keeps a leftover `{}` from
		// putting a whole document into three dimensions.
		if (fixed.spatial !== undefined) {
			const spatial = normalizeSpatial(fixed.spatial);
			if (spatial) {
				fixed = { ...fixed, spatial };
			} else {
				const { spatial: _dropped, ...rest } = fixed;
				fixed = rest as SceneNode;
			}
		}
		if (fixed.turn !== undefined) {
			const turn = normalizeTurn(fixed.turn);
			if (turn) {
				fixed = { ...fixed, turn };
			} else {
				const { turn: _dropped, ...rest } = fixed;
				fixed = rest as SceneNode;
			}
		}
		// Which camera a view looks through is an id and nothing else — the same
		// string-or-nothing question `style` and `state` get. **A camera naming a
		// node the document no longer holds is kept**, and that is the whole of the
		// decision: it is the dangling `instanceOf` argument one field over,
		// deleting a camera has to leave a legal document, and `vcam/2` simply
		// derives nothing so the renderer frames the subtree itself and the status
		// line says so. A reader that cleared the field would make undoing the
		// deletion give back the camera and not the view that looked through it.
		if (fixed.camera !== undefined && typeof fixed.camera !== "string") {
			const { camera: _dropped, ...rest } = fixed;
			fixed = rest as SceneNode;
		}
		// Imported geometry. Migrated first, then checked: a document written while
		// geometry was content-addressed carries `{asset: "<hash>"}` and becomes
		// `{src: "/assets/<hash>", part: {node: 0, primitive: 0}}` here, which is an
		// exact rewrite rather than a best effort — see `migrateMeshRef`, which
		// argues why every step of the new loader is the identity on such a file.
		// The order matters: checking first would drop every legacy model as
		// malformed and take invariant 4 with it.
		//
		// Then dropped when it is not the shape a {@link MeshRef} is, because half a
		// reference is a model that would draw at no size from no file — the
		// judgement a path with no usable vertices gets. **Kept when the asset index
		// has never heard of its path, and kept when the project's tree holds no
		// file there**, because that is a missing file rather than a broken
		// document: `spatialBudget` lists it, the export names it in `lost`, and the
		// model draws as its own bounding box meanwhile. The difference is the
		// difference between "relink this" and "your chair is gone", and only one of
		// the two is ever true. This reader could not check the tree if it wanted to
		// — it is handed a document and not a project — and that is the right shape:
		// whether the bytes are there is a question that changes after this runs.
		if (fixed.mesh !== undefined) {
			const mesh = migrateMeshRef(fixed.mesh);
			if (isMeshRef(mesh)) {
				fixed = { ...fixed, mesh } as SceneNode;
			} else {
				const { mesh: _dropped, ...rest } = fixed;
				fixed = rest as SceneNode;
			}
		}
		out.push(
			fixed.children
				? { ...fixed, children: pruneNodes(fixed.children, legacy) }
				: fixed,
		);
	}
	return out;
}

