import assert from "node:assert/strict";
import { test } from "node:test";

import { compile } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { addNode, addToken, makeNode, setProp } from "./edits.ts";
import { explore, varyingVars } from "./explore.ts";
import {
	KINDS,
	NODE_KINDS,
	PROPS,
	type PropName,
	type Scene,
	emptyScene,
} from "./scene.ts";
import {
	VALUE_TYPES,
	VALUE_TYPE_NAMES,
	lit,
	optionLabel,
	propVar,
	resolveToken,
	single,
	tokenVar,
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
		if (!spec.drawable) assert.deepEqual(spec.props, []);
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
		const paints = KINDS[kind].props.length > 0;
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
