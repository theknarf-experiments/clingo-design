/**
 * Several designs as one artefact, where that is sound.
 *
 * In the core rather than in `export-html`, though HTML is the only target that
 * can currently use it: what it computes is a fact about the *document* — do
 * these universes differ in exactly one variable, and is that variable a theme
 * or a breakpoint — and the answer does not depend on what is going to be
 * written. A second target that grows media queries reads this as it stands.
 */
import type {
	Dimension,
	Emu,
	GuideProp,
	LayoutProp,
	ModelNode,
	ModelScene,
	PropName,
	Scene,
	Style,
} from "@clingo-design/design-core";

import type { Layer } from "./document.ts";
import { modelBounds } from "./document.ts";
import type { ExportUniverse } from "./options.ts";
import {
	DIMENSIONS,
	FRAME_DIMS,
	GUIDE_PROPS,
	KINDS,
	LAYOUT_PROPS,
	PAINT,
	PROPS,
	PROP_NAMES,
	cssPx,
	emuOf,
	findStyle,
	findToken,
	flatten,
	guideAtIn,
	isLengthType,
	layoutVar,
	lineHeightEmu,
	luminance,
	parseVariable,
	resolveValue,
	styleProps,
	tokenVar,
	variantLabel,
	wornProps,
} from "@clingo-design/design-core";

/* ------------------------------------------------------------------ */
/* The space as one artefact                                           */
/* ------------------------------------------------------------------ */

export type CollapseKind = "theme" | "breakpoint";

export interface Collapse {
	kind: CollapseKind;
	/** The one variable the universes differ by. */
	variable: string;
	/** What to call it. */
	label: string;
	/** The universes, in the order the target wants them. */
	layers: Layer[];
	/** One line explaining what the output is. */
	note: string;
}

export interface NotCollapsible {
	reason: string;
}

/**
 * Where two models disagree about anything but a frame.
 *
 * The id lists are joined on NUL because a node id may be a term with commas in
 * it — `inst(primary,button)` — so any printable separator could make two
 * different lists compare equal. Written as the escape rather than as the byte
 * itself: a raw NUL makes grep treat the whole file as binary and report *no
 * matches* rather than skipping it loudly, which hid this file from every
 * search run across the source.
 */
function sameStructure(a: ModelScene, b: ModelScene): boolean {
	const ids = Object.keys(a.byId).sort();
	if (ids.join("\u0000") !== Object.keys(b.byId).sort().join("\u0000")) return false;
	for (const id of ids) {
		const x = a.byId[id];
		const y = b.byId[id];
		if (x.kind !== y.kind || x.order !== y.order) return false;
		if (x.children.length !== y.children.length) return false;
		for (let i = 0; i < x.children.length; i++) {
			if (x.children[i].id !== y.children[i].id) return false;
		}
		// Content is markup, not CSS, so a layer cannot override it.
		if (x.rendered.text !== y.rendered.text) return false;
	}
	return a.roots.map((r) => r.id).join() === b.roots.map((r) => r.id).join();
}

/** True when every node sits in exactly the same box in both. */
function sameGeometry(a: ModelScene, b: ModelScene): boolean {
	return Object.keys(a.byId).every((id) =>
		DIMENSIONS.every((dim) => a.byId[id].frame[dim] === b.byId[id].frame[dim]),
	);
}

/** The variables the universes do not agree about. */
function disagreements(universes: readonly ExportUniverse[]): string[] {
	const first = universes[0].pick;
	const keys = new Set(universes.flatMap((u) => Object.keys(u.pick)));
	return [...keys].filter((key) =>
		universes.some((u) => u.pick[key] !== first[key]),
	);
}

/**
 * Where the markup itself carries geometry, and so cannot be shared.
 *
 * A line, an arrow and a path draw *inside* their box: the numbers are in the
 * `<line>`'s coordinates and the `<path>`'s `d`, not in a declaration. The
 * markup is emitted once, from the base layer, so a layer that moved one of
 * these would show the base's shape in this layer's frame. Read off
 * `KINDS` — `diagonal` and `plotted` are exactly the two kinds of "its real
 * geometry is not its frame" — so a new kind of either sort is covered without
 * an entry here.
 */
function drawnGeometry(model: ModelScene): ModelNode[] {
	return Object.values(model.byId).filter(
		(node) => KINDS[node.kind].diagonal || KINDS[node.kind].plotted,
	);
}

/**
 * One artefact, themed: the base plus one conditional layer per remaining
 * universe.
 *
 * Two universes are light and dark, because that is the one thing
 * `prefers-color-scheme` asks for, and the caller has already put the lighter
 * one first. More than two has no light and dark to be, so they are named
 * themes instead — calling the third one "dark" would be a lie.
 *
 * Shared by a colour token and a colour-only style, which are the same artefact
 * with the declarations in a different place: a custom property for the token,
 * a class for the style. Both are switched by exactly this selector.
 */
function themeCollapse(
	variable: string,
	label: string,
	ordered: readonly ExportUniverse[],
	subject: string,
): Collapse {
	if (ordered.length === 2) {
		const [light, dark] = ordered;
		return {
			kind: "theme",
			variable,
			label,
			// The preference is a *default*, so it goes on the media query alone;
			// the attribute is the same universe again, so that a page can force
			// either way whatever the browser says.
			layers: [
				{ universe: light, media: null, under: null, label: `${label}: the light value` },
				{
					universe: dark,
					media: "(prefers-color-scheme: dark)",
					under: null,
					label: `${label}: the darker value, when the reader prefers a dark scheme`,
				},
				{
					universe: dark,
					media: null,
					under: '[data-theme="dark"]',
					label: `${label}: the darker value, forced`,
				},
			],
			note: `One artefact, themed on ${subject}: the darker value under prefers-color-scheme: dark, or forced with data-theme="dark".`,
		};
	}
	return {
		kind: "theme",
		variable,
		label,
		layers: ordered.map((universe, i) => ({
			universe,
			media: null,
			under: i === 0 ? null : `[data-theme="alt-${i}"]`,
			label: i === 0 ? `${label}: the default` : `${label}: [data-theme="alt-${i}"]`,
		})),
		note: `One artefact with ${ordered.length} themes on ${subject}, selected with data-theme.`,
	};
}

/**
 * One artefact with a breakpoint: mobile first, the wide design under a query.
 *
 * The width is the one the wide design actually occupies, which is the only
 * number in the document that means anything here — and the same number the
 * direction collapse uses, because it is the same question.
 */
function breakpointCollapse(
	variable: string,
	label: string,
	narrow: ExportUniverse,
	wide: ExportUniverse,
	narrowLabel: string,
	wideLabel: string,
): Collapse {
	// A media query is a statement about the viewport, so this one is in CSS
	// pixels like every other number that leaves this file, and rounded up: at
	// exactly the design's own width the wide layer should already hold.
	const width = Math.ceil(cssPx(modelBounds(wide.model).width));
	return {
		kind: "breakpoint",
		variable,
		label,
		layers: [
			{
				universe: narrow,
				media: null,
				under: null,
				label: `${narrowLabel}: the narrow design, and the base`,
			},
			{
				universe: wide,
				media: `(min-width: ${width}px)`,
				under: null,
				label: `${wideLabel}: from ${width}px, the width the wide design actually needs`,
			},
		],
		note: `One artefact with a breakpoint on ${label}: ${narrowLabel} below ${width}px and ${wideLabel} at or above it.`,
	};
}

/**
 * Whether this space is one artefact rather than N designs.
 *
 * The claim being tested is narrow and worth stating exactly. A document whose
 * universes differ only by layout `direction` *is* a media query; one whose
 * universes differ only by colour *is* a theme; one whose universes differ only
 * by a *style* is whichever of the two the treatment says — see
 * {@link styleCollapse}. All are true, and all stop being true the moment
 * anything else differs — so the test is:
 *
 *   1. the universes differ in exactly one variable;
 *   2. that variable has a meaning the target understands, which today means
 *      a colour token (a theme), a container's direction (a breakpoint), or a
 *      style (either, depending on what its variants disagree about);
 *   3. everything the target cannot express as a variable is identical: the
 *      tree, the paint order, and the text.
 *
 * The second condition is the one that does the work, and it is not a
 * formality. A frame variable — "the panel sits here or there" — passes (1) and
 * (3) and is still *not* soundly one artefact, because nothing in the document
 * says which of the two positions is the narrow screen. Direction is different
 * precisely because `column` means narrow to every designer and every target
 * that has ever had a breakpoint. Where that meaning is missing, this returns
 * the reason instead of guessing, and the caller exports one universe.
 *
 * A colour theme additionally has to leave the geometry alone. It always does —
 * a colour moves nothing — but it is checked rather than assumed, because the
 * check is three lines and the failure mode is an export that silently drops
 * half the positions.
 *
 * A breakpoint, by contrast, is *expected* to move things, and that is sound
 * because every layer re-emits its own boxes: what a layer holds is the diff
 * against the base, so a node that moved arrives as the coordinates the solver
 * worked out for that layer. The one thing a layer cannot re-emit is markup,
 * which is why {@link drawnGeometry} is checked for every collapse.
 */
export function collapseSpace(
	scene: Scene,
	universes: readonly ExportUniverse[],
): Collapse | NotCollapsible {
	if (universes.length < 2) {
		return { reason: "There is only one design here; nothing to collapse." };
	}
	const varying = disagreements(universes);
	if (varying.length === 0) {
		return { reason: "These universes make the same decisions." };
	}
	if (varying.length > 1) {
		return {
			reason: `${varying.length} variables differ across these designs. One artefact can stand for a space only where a single variable separates it — a theme, or a breakpoint — so this exports as one design at a time.`,
		};
	}
	const variable = varying[0];
	const parsed = parseVariable(variable);
	const base = universes[0];

	for (const other of universes.slice(1)) {
		if (!sameStructure(base.model, other.model)) {
			return {
				reason:
					"These designs are different pictures, not one picture in two states — the tree or the text differs, and CSS cannot switch that.",
			};
		}
	}
	for (const node of drawnGeometry(base.model)) {
		const moved = universes
			.slice(1)
			.some((u) =>
				DIMENSIONS.some((dim) => u.model.byId[node.id]?.frame[dim] !== node.frame[dim]),
			);
		if (moved) {
			return {
				reason: `${KINDS[node.kind].label} “${node.id}” is a different size in these designs, and it draws its own geometry inside its box — that markup is written once, so one file cannot hold both. Export a single design instead.`,
			};
		}
	}

	if (parsed?.kind === "token") {
		const token = findToken(scene.tokens, parsed.token);
		if (!token) {
			return { reason: "The varying token is no longer in the document." };
		}
		if (token.type !== "color") {
			return {
				reason: `Only a colour token exports as a theme; “${token.name}” is a ${token.type}. A length that varies changes where things sit, and a stylesheet cannot re-derive the layout from it.`,
			};
		}
		if (universes.slice(1).some((u) => !sameGeometry(base.model, u.model))) {
			return {
				reason: `“${token.name}” moves things as well as colouring them, so the designs are not one artefact in two states.`,
			};
		}
		// Two colours are light and dark, and which is which is not the solver's
		// enumeration order — it is which one is darker, because that is the whole
		// of what `prefers-color-scheme: dark` asks for.
		return themeCollapse(
			variable,
			token.name,
			universes.length === 2 ? byBrightness(scene, universes, parsed.token) : universes,
			`“${token.name}”`,
		);
	}

	if (parsed?.kind === "layout" && parsed.field === "direction") {
		if (universes.length !== 2) {
			return {
				reason:
					"A direction has two values and this space has more than two designs, so there is no pair of breakpoints to map them onto.",
			};
		}
		const words = universes.map((u) => directionOf(scene, u, parsed.node));
		const narrow = words.indexOf("column");
		const wide = words.indexOf("row");
		if (narrow === -1 || wide === -1) {
			return {
				reason:
					"These two designs do not lay out one as a row and the other as a column, so which is the narrow screen is not something the document says.",
			};
		}
		// Mobile first: the column is the base, and the row arrives at the width
		// it actually needs.
		return breakpointCollapse(
			variable,
			LAYOUT_PROPS.direction.label,
			universes[narrow],
			universes[wide],
			"Column",
			"Row",
		);
	}

	if (parsed?.kind === "style") {
		return styleCollapse(scene, parsed.style, variable, universes);
	}

	return {
		reason: `These designs differ only in ${describe(scene, variable)}, and no target has a mechanism for that — a stylesheet has no way to know which of the values is the narrow screen, or the dark one. Export a single design instead.`,
	};
}

/** One property a style's variants disagree about, as the answer sets rendered it. */
interface StyleChange {
	prop: PropName;
	/** The node the reading came from — one that takes this property from the style. */
	node: string;
	/** What it drew with, per universe, in the order they came in. */
	values: string[];
	/**
	 * Everything that node drew with, per universe.
	 *
	 * Kept beside the values because one property cannot always be read on its
	 * own: a line height of 1.35 is a *multiple*, and how much room it asks for
	 * is a fact about the size it multiplies — which the same style may be
	 * changing. See {@link ROOMINESS}.
	 */
	drawn: Array<Partial<Record<PropName, string>>>;
}

/**
 * How much room a property's value asks for — bigger is roomier — or nothing
 * where two of its values cannot be put in that order at all.
 *
 * This is the table the breakpoint collapse turns on, and it is a table rather
 * than a type test because `PROPS[p].type` gets one property wrong and the
 * wrongness is not the type's fault. Every `length` is its own answer: 15px is
 * tighter than 18px, and that is what a type ramp means. A **line height** is
 * typed `number` because it is a ratio and it genuinely is one — making it a
 * length would put `8px` in the inspector's placeholder and let a token of
 * lengths link to it — but the ratio is not the quantity: 1.2 of 24px is 28.8px
 * of leading and 1.5 of 16px is 24px, so the tighter *number* is the roomier
 * *line*. Ordering by what is written is how a real responsive ramp — bigger
 * type, tighter leading — comes out as "the lengths disagree" and refuses.
 *
 * So the entry reads the leading as a length, which is the same arithmetic the
 * text measurement uses, and both halves of such a ramp then agree.
 *
 * Everything here is EMU, and only the *sign* of a difference is ever read —
 * see {@link room} — so the unit matters solely in that all the entries share
 * one. Reading a length with `emuOf` rather than a bare-number parser is what
 * makes `18px` and `0.25in` comparable at all, which a type ramp written in
 * points beside a margin written in pixels needs.
 *
 * Everything else stays out and stays out on purpose: no stylesheet can know
 * which of two weights, two families or two alignments belongs on a narrow
 * screen, and a table with an entry for them would be a guess wearing a number.
 */
const ROOMINESS: Partial<
	Record<PropName, (drawn: Partial<Record<PropName, string>>) => Emu | undefined>
> = {
	...Object.fromEntries(
		PROP_NAMES.filter((prop) => isLengthType(PROPS[prop].type)).map((prop) => [
			prop,
			(drawn: Partial<Record<PropName, string>>) => emuOf(drawn[prop] ?? ""),
		]),
	),
	lineHeight: (drawn) =>
		drawn.lineHeight === undefined
			? undefined
			: lineHeightEmu(drawn.size, drawn.lineHeight),
};

/** How much room one universe's reading asks for, if the property is orderable. */
const roomOf = (change: StyleChange, universe: number): number | undefined =>
	ROOMINESS[change.prop]?.(change.drawn[universe]);

/**
 * What the variants of one style actually disagree about, read off the answer
 * sets rather than off the document.
 *
 * A variant's field is a {@link Term}: it may name a token, or be derived, and
 * two variants naming two tokens that resolve to the same colour do not
 * disagree about anything. `rendered/3` has already settled all of that, so the
 * comparison is between what was *drawn* — and it is taken from a node that
 * takes the property from the style, because a node that overrides it draws its
 * own value and would report no change at all.
 */
function styleChanges(
	scene: Scene,
	style: Style,
	universes: readonly ExportUniverse[],
): StyleChange[] {
	const wearers = flatten(scene.nodes).filter((n) => n.style === style.id);
	const out: StyleChange[] = [];
	for (const prop of styleProps(style)) {
		for (const node of wearers) {
			if (!wornProps(scene, node).includes(prop)) continue;
			const drawn = universes.map((u) => u.model.byId[node.id]?.rendered ?? {});
			const values = drawn.map((rendered) => rendered[prop]);
			if (values.some((v) => v === undefined)) continue;
			const said = values as string[];
			if (new Set(said).size > 1) {
				out.push({ prop, node: node.id, values: said, drawn });
			}
			break;
		}
	}
	return out;
}

/**
 * A style as one artefact — the interesting half of this file.
 *
 * A bare length token is refused as a collapse, and a style whose variants
 * differ in lengths is admitted. That is not a double standard, and the three
 * reasons are worth stating because each of them is checkable:
 *
 *   1. **A style cannot be a coordinate.** `STYLE_PROPS` is the styleable
 *      *properties*, and a property is never a frame dimension nor a layout
 *      setting — so the variable that varies here appears in the output only
 *      inside a class's declarations, never inside a `left`, a `top` or a
 *      `width`. A token can be all of those: point one at a dimension and the
 *      stylesheet would have to re-derive a solved layout from a custom
 *      property, which is exactly the thing CSS cannot do. Every coordinate in
 *      every layer of a style collapse is a literal pixel the solver worked out
 *      *for that layer*.
 *   2. **The treatment is complete.** A variant is one record naming every
 *      field it decides, so both sides of the breakpoint are designs somebody
 *      authored, and the switch is one class redefinition plus the boxes that
 *      moved. Switching one loose length gives a design nobody wrote down.
 *   3. **The document states the order.** One variant asks for less room than
 *      the other everywhere, and the tighter type scale is the narrow screen —
 *      which is what every responsive type ramp there has ever been means. Where
 *      they disagree about which variant is the tighter one, there is no narrow
 *      design to pick and this refuses. How much room a value asks for is
 *      {@link ROOMINESS}, and it is a table because one property's number is not
 *      its size: a line height is a *multiple* of a size the same style may be
 *      changing, so the textbook ramp — bigger type, tighter leading — reads as
 *      a contradiction until the leading is counted in pixels.
 *
 * And where the variants differ only in colour, the same argument makes it a
 * theme instead, ordered by the ground it paints.
 *
 * The limits, all of them:
 *
 *   - two variants for a breakpoint. A third has no pair of screens to be, the
 *     same way a third direction would not;
 *   - at least one *size* has to differ, and the sizes have to agree. A style
 *     that varies only its weight, its family or its alignment carries no claim
 *     about screen width, and is refused rather than guessed at;
 *   - the breakpoint is the width the wide design occupies, so a treatment that
 *     changes only the leading — which moves a column's height and not its
 *     width — comes out as a query at the design's own width. Coarse, and the
 *     same coarseness a radius ramp has always had;
 *   - a wearer that states its own value for a property does not change across
 *     the breakpoint. That is what an override means, and it is visible in the
 *     output: the declaration sits in the node's own rule, not in the class;
 *   - HTML only, like every collapse — see {@link exportSpace}.
 */
function styleCollapse(
	scene: Scene,
	styleId: string,
	variable: string,
	universes: readonly ExportUniverse[],
): Collapse | NotCollapsible {
	const style = findStyle(scene.styles, styleId);
	if (!style) {
		return { reason: "The varying style is no longer in the document." };
	}
	const changes = styleChanges(scene, style, universes);
	if (changes.length === 0) {
		return {
			reason: `Nothing drawn takes anything from “${style.name}” that its variants disagree about, so these designs differ in a decision no stylesheet can see.`,
		};
	}
	const subject = `the style “${style.name}”`;

	// Colour only: a treatment that changes nothing but colour is a theme, and it
	// is the class that is themed rather than a custom property.
	if (changes.every((change) => PROPS[change.prop].type === "color")) {
		if (universes.slice(1).some((u) => !sameGeometry(universes[0].model, u.model))) {
			return {
				reason: `“${style.name}” moves things as well as colouring them, so the designs are not one artefact in two states.`,
			};
		}
		return themeCollapse(
			variable,
			style.name,
			universes.length === 2 ? byTreatment(changes, universes) : universes,
			subject,
		);
	}

	// Otherwise the sizes decide, if they agree.
	const lengths = changes.filter(readable);
	if (lengths.length === 0) {
		const named = changes
			.map((change) => PROPS[change.prop].label.toLowerCase())
			.join(", ");
		return {
			reason: `The variants of “${style.name}” differ in ${named}, and none of that is a size. A stylesheet has no way to know which of two weights or two families is the narrow screen, so this exports as one design at a time.`,
		};
	}
	if (universes.length !== 2) {
		return {
			reason: `“${style.name}” has ${universes.length} treatments in play and a breakpoint has two sides, so there is no pair of screens to map them onto.`,
		};
	}
	const ways = new Set(
		lengths.map((change) => Math.sign(room(change, 1) - room(change, 0))),
	);
	if (ways.size !== 1) {
		return {
			reason: `The sizes in “${style.name}” disagree about which treatment is the tighter one — one of them grows where another shrinks — so neither variant is the narrow screen.`,
		};
	}
	const [narrow, wide] = ways.has(1) ? [0, 1] : [1, 0];
	return breakpointCollapse(
		variable,
		style.name,
		universes[narrow],
		universes[wide],
		variantLabel(style, universes[narrow].pick[variable] ?? 0),
		variantLabel(style, universes[wide].pick[variable] ?? 0),
	);
}

/** How much room a reading asks for, and 0 where it asks for nothing legible. */
const room = (change: StyleChange, universe: number): number =>
	roomOf(change, universe) ?? 0;

/** True where every universe's reading of this property is an amount of room. */
const readable = (change: StyleChange): boolean =>
	change.drawn.every((_, universe) => roomOf(change, universe) !== undefined);

/**
 * Two universes, the lighter treatment first.
 *
 * The *ground* decides where the treatment paints one, and which property is
 * the ground is read off the paint table rather than named here: it is
 * whichever one becomes a `background`. Absent a ground the ink decides, and it
 * reads the other way round — a dark theme is dark behind *light* text, so the
 * variant with the brighter ink is the dark one. Getting that inversion wrong
 * would put the light design under `prefers-color-scheme: dark`, which is the
 * one failure this function exists to prevent.
 */
function byTreatment(
	changes: readonly StyleChange[],
	universes: readonly ExportUniverse[],
): readonly ExportUniverse[] {
	const ground = changes.find((change) => {
		const paint = PAINT[change.prop];
		return paint !== undefined && "background" in paint("");
	});
	const [a, b] = (ground ?? changes[0]).values.map(luminance);
	if (a === undefined || b === undefined) return universes;
	const brighter = b > a ? [universes[1], universes[0]] : universes;
	return ground ? brighter : [brighter[1], brighter[0]];
}

/**
 * Two universes, lighter first.
 *
 * Which of two colours belongs in the dark branch is a question about the
 * colours and not about the order the solver happened to enumerate them in. A
 * value nothing can read a luminance from keeps the order it came in, because
 * guessing would be worse than the arbitrary answer.
 */
function byBrightness(
	scene: Scene,
	universes: readonly ExportUniverse[],
	tokenId: string,
): readonly ExportUniverse[] {
	const shade = (u: ExportUniverse): number | undefined => {
		const value = resolveValue(
			{ tokens: scene.tokens, picks: u.pick },
			findToken(scene.tokens, tokenId)?.value,
			tokenVar(tokenId),
		);
		return value === undefined ? undefined : luminance(value);
	};
	const [a, b] = [shade(universes[0]), shade(universes[1])];
	if (a === undefined || b === undefined) return universes;
	return b > a ? [universes[1], universes[0]] : universes;
}

/** Which way a container flows in one universe, read the way the program does. */
function directionOf(
	scene: Scene,
	universe: ExportUniverse,
	nodeId: string,
): string | undefined {
	const node = flatten(scene.nodes).find((n) => n.id === nodeId);
	const value = node?.layout?.direction;
	return resolveValue(
		{ tokens: scene.tokens, picks: universe.pick },
		value,
		layoutVar(nodeId, "direction"),
	);
}

/** A phrase for a variable, for the refusals. */
function describe(scene: Scene, variable: string): string {
	const parsed = parseVariable(variable);
	if (!parsed) return variable;
	if (parsed.kind === "token") {
		return `the token “${findToken(scene.tokens, parsed.token)?.name ?? parsed.token}”`;
	}
	if (parsed.kind === "prop") {
		return `${parsed.node}’s ${PROPS[parsed.prop as PropName]?.label.toLowerCase() ?? parsed.prop}`;
	}
	if (parsed.kind === "frame") {
		return `where ${parsed.node} sits (${FRAME_DIMS[parsed.dim as Dimension]?.label ?? parsed.dim})`;
	}
	if (parsed.kind === "layout") {
		return `${parsed.node}’s ${LAYOUT_PROPS[parsed.field as LayoutProp]?.label.toLowerCase() ?? parsed.field}`;
	}
	if (parsed.kind === "guide") {
		// A line's field is `at(g1)`, which names no row of the settings table; the
		// phrase then falls back to the guide's own name, which is what a refusal
		// about it should say anyway.
		const guide = guideAtIn(parsed.field);
		return guide === undefined
			? `${parsed.node}’s ${GUIDE_PROPS[parsed.field as GuideProp]?.label.toLowerCase() ?? parsed.field}`
			: `${parsed.node}’s guide ${guide}`;
	}
	if (parsed.kind === "style") {
		return `the style “${findStyle(scene.styles, parsed.style)?.name ?? parsed.style}”`;
	}
	return `the value of rule ${parsed.constraint}`;
}

