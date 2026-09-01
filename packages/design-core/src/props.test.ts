import assert from "node:assert/strict";
import { test } from "node:test";

import { compile } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { addNode, addToken, makeNode, setProp } from "./edits.ts";
import { explore, varyingVars } from "./explore.ts";
import { CUSTOM_PROPERTY_RULES, PAINT, SURFACE_BOX } from "./paint.ts";
import {
	KINDS,
	NODE_KINDS,
	PROPS,
	type PropName,
	type Scene,
	emptyScene,
} from "./scene.ts";
import {
	GRADIENT_FROM,
	GRADIENT_TO,
	VALUE_TYPES,
	VALUE_TYPE_NAMES,
	lit,
	optionLabel,
	propVar,
	resolveToken,
	single,
	tokenVar,
	wordOf,
} from "./values.ts";

const PROP_NAMES = Object.keys(PROPS) as PropName[];

function box(props: Partial<Record<PropName, ReturnType<typeof single>>>): Scene {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode("rect", { x: 0, y: 0, width: 10, height: 10 }, { id: "box" }),
	);
	for (const [prop, value] of Object.entries(props)) {
		scene = setProp(scene, ["box"], prop as PropName, value);
	}
	return scene;
}

test("every property names a type the editor knows how to render", () => {
	for (const prop of PROP_NAMES) {
		const spec = PROPS[prop];
		assert.ok(VALUE_TYPES[spec.type], `${prop} has an unknown type`);
		// A closed type whose fallback is off the menu would open every new row
		// on a value the menu cannot show.
		const options = VALUE_TYPES[spec.type].options;
		if (options) {
			assert.ok(
				options.some((o) => o.value === spec.fallback),
				`${prop} falls back to something not on its menu`,
			);
		}
	}
});

test("a kind only lists properties that exist, and only if it paints", () => {
	for (const kind of NODE_KINDS) {
		const spec = KINDS[kind];
		for (const prop of spec.props) {
			assert.ok(PROPS[prop], `${kind} lists an undeclared property ${prop}`);
		}
		assert.equal(
			new Set(spec.props).size,
			spec.props.length,
			`${kind} lists a property twice`,
		);
		// A default for a property the inspector never shows is unreachable.
		for (const prop of Object.keys(spec.defaults) as PropName[]) {
			assert.ok(spec.props.includes(prop), `${kind} defaults an unlisted ${prop}`);
		}
		// A kind with no pixels of its own used to be a kind with no properties,
		// and for eight kinds that is still exactly right: a group is whatever
		// its children are, and an instance is the copy its definition derives
		// inside it.
		//
		// A camera and a light broke the equivalence, and they broke it honestly.
		// `drawable` is a claim about *pixels this node paints on the canvas* —
		// it decides hit testing, snapping and paint order — while a lens and a
		// lamp are numbers the 3D renderer reads to decide what everything *else*
		// looks like. So the invariant is narrower than it was and says what it
		// always meant: a kind with no pixels and nothing in three dimensions to
		// answer for has nothing to hold.
		if (!spec.drawable && !spec.spatial) assert.deepEqual(spec.props, []);
	}
});

test("a shadow goes on the box kinds, never on a stroked one", () => {
	for (const kind of ["frame", "rect", "ellipse"] as const) {
		assert.ok(KINDS[kind].props.includes("shadow"));
		assert.ok(KINDS[kind].props.includes("stroke"));
	}
	// A box-shadow follows the node's box, which for these is only the
	// rectangle the stroke spans.
	for (const kind of ["line", "arrow", "path"] as const) {
		assert.ok(!KINDS[kind].props.includes("shadow"));
	}
});

test("everything with an appearance of its own can be faded", () => {
	for (const kind of NODE_KINDS) {
		// A kind with no properties has no appearance of its own to fade: a group
		// is whatever its children are, and an instance is the copy its
		// definition derives inside it.
		//
		// `drawable` as well as the count, and the second half is what a camera
		// and a light added. Both hold properties and neither has a silhouette,
		// and fading a lamp is not dimming it — `opacity` is how much of the
		// pixels a node paints you can see through, so on a node that paints none
		// it is a control that would do nothing at all. Brightness is
		// `intensity`, which the lamp holds instead and which means what it says.
		const paints = KINDS[kind].drawable && KINDS[kind].props.length > 0;
		assert.equal(KINDS[kind].props.includes("opacity"), paints);
	}
	for (const kind of ["group", "instance"] as const) {
		assert.deepEqual(KINDS[kind].props, []);
		assert.deepEqual(KINDS[kind].defaults, {});
	}
});

test("text carries the typography a designer expects", () => {
	const wanted = ["fontFamily", "size", "weight", "lineHeight", "align"] as const;
	for (const prop of wanted) {
		assert.ok(KINDS.text.props.includes(prop), `text should offer ${prop}`);
	}
});

test("an enumerated value is stored as the CSS it paints with", () => {
	// No name-to-declaration table on the renderer's side: the option's value
	// *is* the declaration, and the label is only what the menu calls it.
	const serif = VALUE_TYPES.font.options?.find((o) => o.label === "Serif");
	assert.ok(serif);
	assert.match(serif.value, /serif$/);
	assert.equal(optionLabel("font", serif.value), "Serif");
	assert.equal(optionLabel("align", "center"), "Centre");
	// Something off the list reads as itself rather than disappearing.
	assert.equal(optionLabel("shadow", "0 0 1px red"), "0 0 1px red");
	assert.equal(optionLabel("color", "#abcdef"), "#abcdef");
});

test("a token of every type can be made and resolves to its fallback", () => {
	for (const type of VALUE_TYPE_NAMES) {
		const { scene, id } = addToken(emptyScene(), type);
		assert.equal(
			resolveToken({ tokens: scene.tokens, picks: {} }, id),
			VALUE_TYPES[type].fallback,
			`a ${type} token should start at its fallback`,
		);
		assert.equal(compile(scene).variables[tokenVar(id)], 1);
	}
});

test("a font stack survives ASP quoting intact", () => {
	const stack = VALUE_TYPES.font.fallback;
	const scene = box({ fontFamily: single(stack) });
	const { generated } = compile(scene);
	const id = /alt_literal\(prop\(box,fontFamily\),0,(l\d+)\)/.exec(generated)?.[1];
	assert.ok(id, "the stack should be interned like any other literal");

	const row = new RegExp(`^literal\\(${id},"(.*)"\\)\\.$`, "m").exec(generated);
	assert.ok(row, "the interned text should be on one line");
	// A font stack carries quotes and commas of its own, so the program has to
	// escape them rather than end the literal early.
	assert.ok(row[1].includes('\\"Segoe UI\\"'), "quotes are escaped");
	assert.equal(row[1].replace(/\\(.)/g, "$1"), stack, "and it unescapes back");
});

test("two values on a new property branch the space like any other", async () => {
	const scene = box({ opacity: [lit("1"), lit("0.5")] });
	const result = await explore(scene, directSolver, { limit: 16, sample: "first" });
	assert.equal(result.count, 2);
	assert.deepEqual(varyingVars(result), [propVar("box", "opacity")]);
});

test("a shadow branches too, and the alternatives stay distinct", async () => {
	const [subtle, floating] = [
		VALUE_TYPES.shadow.options?.[1].value ?? "",
		VALUE_TYPES.shadow.options?.[4].value ?? "",
	];
	const scene = box({ shadow: [lit(subtle), lit(floating)] });
	const result = await explore(scene, directSolver, { limit: 16, sample: "first" });
	assert.equal(result.count, 2);
});

/* ------------------------------------------------------------------ */
/* The paint layer above a fill                                        */
/* ------------------------------------------------------------------ */

/** Every gradient recipe the menu offers, without the `none` that opens it. */
const RECIPES = (VALUE_TYPES.gradient.options ?? [])
	.map((o) => o.value)
	.filter((v) => v !== "none");

/**
 * **The most important assertion in this file**, which is a strange thing to
 * say about one word.
 *
 * `background` is a shorthand and it resets `background-image`, so a fill that
 * wrote one would erase a gradient — not in the base rule, where an ordering
 * saves it, but in every layer that repaints only the fill: a machine state's
 * hover rule, a style class, a keyframe. The card has a sheen, you hover it, the
 * sheen vanishes, and nothing about that reads as a shorthand. The longhand is
 * the fix and this is the guard, because the shorthand was correct until it was
 * not, and the next person to write `background:` here will be right about
 * everything except the one thing this test knows.
 */
test("a fill is a background colour, so a gradient can sit over it", () => {
	assert.deepEqual(Object.keys(PAINT.fill?.("#fff") ?? {}), ["backgroundColor"]);
	// The same for the ground a surface paints under everything on it, which
	// would otherwise reset the gradient before a node's own properties ran.
	assert.equal(SURFACE_BOX.background, undefined);
	assert.equal(SURFACE_BOX.backgroundColor, "#ffffff");
	// And the gradient itself is the longhand the fill leaves alone, so the two
	// stack rather than fight: a colour under an image is CSS's own layering and
	// is the whole of "two fills" this tool offers.
	assert.deepEqual(Object.keys(PAINT.gradient?.("none") ?? {}), ["backgroundImage"]);
});

/**
 * The order of `KINDS[kind].props` *is* the declaration order in both
 * renderers, because `Declarations` is a plain object and every walk that builds
 * one iterates that list. So this is a legibility claim rather than a
 * correctness one — the longhand above is what made it legibility — and it is
 * pinned so a tidy-up cannot silently put the sheen under the fill.
 */
test("a gradient's parts sit together, and after the fill", () => {
	for (const kind of NODE_KINDS) {
		const props = KINDS[kind].props;
		if (!props.includes("gradient")) continue;
		const at = props.indexOf("gradient");
		assert.ok(props.indexOf("fill") < at, `${kind} paints its gradient before its fill`);
		assert.equal(props[at + 1], "gradientFrom", `${kind} splits the gradient up`);
		assert.equal(props[at + 2], "gradientTo", `${kind} splits the gradient up`);
	}
});

/**
 * The twin of the shadow test above, and it makes the same argument twice with
 * the answers the other way round.
 *
 * `backdrop-filter` blurs the backdrop of the element's *box*, and for a
 * diagonal, a polygon or a paragraph the box is only the rectangle the ink
 * happens to span — a frosted rectangle behind a line is a shape the document
 * does not contain. `filter: blur()` smears *the pixels the element painted*, so
 * a blurred diagonal is a blurred diagonal and every drawable kind gets one.
 */
test("a backdrop blur goes on the box kinds, never on a stroked one", () => {
	for (const kind of ["frame", "rect", "ellipse"] as const) {
		assert.ok(KINDS[kind].props.includes("backdropBlur"), `${kind} should frost`);
	}
	for (const kind of ["line", "arrow", "path", "text", "image"] as const) {
		assert.ok(!KINDS[kind].props.includes("backdropBlur"), `${kind} has no box to frost`);
		assert.ok(KINDS[kind].props.includes("blur"), `${kind} should still smear`);
	}
});

/**
 * A gradient needs a background to paint on, and three kinds have one.
 *
 * A path redirects its fill onto the polygon, so a `background-image` would
 * paint a rectangle behind a shape the document does not contain; text would
 * need `background-clip` and a transparent ink; an image covers its own box; and
 * a viewport already spends `background-image` on the poster the export writes
 * for it, which would be two writers for one declaration.
 */
test("a gradient only goes where there is a box to paint it on", () => {
	const carries = NODE_KINDS.filter((k) => KINDS[k].props.includes("gradient"));
	assert.deepEqual(carries, ["frame", "rect", "ellipse"]);
	// And where the recipe goes the two colours go, or a direction would name
	// custom properties nothing in the inspector can set.
	for (const kind of carries) {
		assert.ok(KINDS[kind].props.includes("gradientFrom"));
		assert.ok(KINDS[kind].props.includes("gradientTo"));
	}
});

/**
 * The invariant four blend modes were given up for.
 *
 * `wordOf` takes `/^[a-z][A-Za-z0-9_]*$/`, so a hyphenated value reaches the
 * program as a quoted string with no `word/2` beside it — legal, and it would
 * make this the first enumerated roster where a rule reading `word(L,multiply)`
 * is right about eight entries and quietly wrong about four. If this ever fails,
 * the roster grew a dash.
 */
test("every mix mode is one word, so a rule can name it", () => {
	const modes = VALUE_TYPES.mix.options ?? [];
	assert.ok(modes.length > 0);
	for (const o of modes) {
		assert.equal(wordOf(o.value), o.value, `${o.value} is not a legal constant`);
	}
	// `soft-light` and its three hyphenated siblings are out on purpose. Named
	// here so that adding one fails a test rather than a rule nobody ran.
	assert.ok(!modes.some((o) => o.value.includes("-")));
});

/**
 * A direction on its own is still a gradient.
 *
 * A `var()` with no fallback and no registration makes the whole declaration
 * invalid at computed-value time, which in CSS means the gradient silently
 * disappears — so a designer who chose "Linear, down" and nothing else would get
 * nothing at all, and the row would say otherwise.
 */
test("a gradient paints even when only its direction is set", () => {
	assert.ok(RECIPES.length > 0);
	for (const recipe of RECIPES) {
		assert.ok(recipe.includes(`var(--gfrom, ${GRADIENT_FROM})`), recipe);
		assert.ok(recipe.includes(`var(--gto, ${GRADIENT_TO})`), recipe);
	}
});

/**
 * Three readers, one source.
 *
 * The recipes' `var()` fallbacks, the two inspector rows' `fallback`s and the
 * registrations' `initial-value`s are the same two colours, and a design where
 * the row shows one colour and the box paints another does not look like a bug,
 * it looks like the picture.
 */
test("the two gradient colours are spelled once", () => {
	assert.equal(PROPS.gradientFrom.fallback, GRADIENT_FROM);
	assert.equal(PROPS.gradientTo.fallback, GRADIENT_TO);
	assert.ok(CUSTOM_PROPERTY_RULES.includes(`initial-value: ${GRADIENT_FROM}`));
	assert.ok(CUSTOM_PROPERTY_RULES.includes(`initial-value: ${GRADIENT_TO}`));
	// And both registrations say the two things the table claims: a custom
	// property that inherited would leak a frame's gradient colour into every
	// gradient inside it, and one with no syntax could not be interpolated at all.
	assert.equal(CUSTOM_PROPERTY_RULES.match(/inherits: false;/g)?.length, 2);
	assert.equal(CUSTOM_PROPERTY_RULES.match(/syntax: "<color>";/g)?.length, 2);
});

/**
 * The two rows that wait for another one, and the column that is a claim about
 * the inspector rather than about the document.
 */
test("a gradient's colours are a detail of its direction", () => {
	assert.equal(PROPS.gradientFrom.needs, "gradient");
	assert.equal(PROPS.gradientTo.needs, "gradient");
	// Nothing else in the table has an answer here, which is what makes the
	// column optional rather than a fourth thing every entry has to say.
	const detailed = PROP_NAMES.filter((p) => PROPS[p].needs !== undefined);
	assert.deepEqual(detailed, ["gradientFrom", "gradientTo"]);
	// Six new properties, all styleable — a sheen and a frosting are treatments
	// several nodes wear — and none inherited, which is what leaves DOCUMENT_BASE
	// alone and what the registrations above had to make true rather than assert.
	for (const prop of [
		"gradient",
		"gradientFrom",
		"gradientTo",
		"blur",
		"backdropBlur",
		"mix",
	] as const) {
		assert.equal(PROPS[prop].styleable, true, `${prop} should be a treatment`);
		assert.equal(PROPS[prop].inherited, false, `${prop} should not inherit`);
	}
});

test("a mix mode branches the space like any other value", async () => {
	const scene = box({ mix: [lit("normal"), lit("multiply")] });
	const result = await explore(scene, directSolver, { limit: 16, sample: "first" });
	assert.equal(result.count, 2);
	assert.deepEqual(varyingVars(result), [propVar("box", "mix")]);
});

/**
 * The whole argument for splitting a gradient into three properties, as a
 * number: a colour branches because it is an ordinary `color` Value, a direction
 * branches because it is an ordinary enumerated one, and together they are the
 * product — which a frozen roster of complete gradient strings could not have
 * said at all.
 */
test("a gradient's colour branches, and its direction does too", async () => {
	const colours = box({ gradientTo: [lit("#0f172a"), lit("#7c3aed")] });
	const one = await explore(colours, directSolver, { limit: 16, sample: "first" });
	assert.equal(one.count, 2);
	assert.deepEqual(varyingVars(one), [propVar("box", "gradientTo")]);

	const both = box({
		gradient: [lit(RECIPES[0]), lit(RECIPES[3])],
		gradientTo: [lit("#0f172a"), lit("#7c3aed")],
	});
	const two = await explore(both, directSolver, { limit: 16, sample: "first" });
	assert.equal(two.count, 4);
});

/**
 * The clamp, on the table where both renderers cross it.
 *
 * `blur(-4px)` is not a length the function accepts and an unparsable argument
 * invalidates the whole declaration — so a minus sign would *lose* the blur
 * rather than produce none of it, which are two different pictures.
 */
test("a negative blur is clamped where it is read", () => {
	assert.deepEqual(PAINT.blur?.("-4px"), { filter: "blur(0px)" });
	assert.deepEqual(PAINT.blur?.("8px"), { filter: "blur(8px)" });
	assert.deepEqual(PAINT.backdropBlur?.("-1px"), { backdropFilter: "blur(0px)" });
	// A token is passed through untouched: what it holds is resolved by the
	// browser at computed-value time, and guarding it here would mean inventing a
	// second substitution engine.
	assert.deepEqual(PAINT.blur?.("var(--x)"), { filter: "blur(var(--x))" });
	// `tweenedKeys` calls every paint function with `""` to read back which keys
	// it writes, and a `blur()` of nothing is a perfectly good value to throw away.
	assert.deepEqual(Object.keys(PAINT.blur?.("") ?? {}), ["filter"]);
});
