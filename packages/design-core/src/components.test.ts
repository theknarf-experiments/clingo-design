/**
 * Components, against the real solver.
 *
 * Every claim the feature makes is a claim about the *program* — that an
 * instance's contents are derived rather than stored, that its variables are
 * the definition's minted again, that a held pick narrows the space — so
 * everything here goes through clingo rather than through a hand-written atom
 * list.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	componentDef,
	heldPicks,
	instancePart,
	instanceVariable,
	openVariables,
	parseInstancePart,
	partLabel,
	shownVariant,
	variantsOf,
} from "./components.ts";
import { compile } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import {
	addInstance,
	collapseToPicks,
	defineComponent,
	makeNode,
	releaseComponent,
	setHold,
	setVariant,
} from "./edits.ts";
import { explore } from "./explore.ts";
import type { Scene, SceneNode } from "./scene.ts";
import { component } from "./templates/component.ts";
import { derive, lit, propVar, ref, single } from "./values.ts";

/**
 * A button definition and however many uses of it.
 *
 * Written out rather than taken from the template so a test can say exactly
 * what it depends on: two alternatives on the root's fill, two on the label's
 * text, and a derived ink that reads the root's fill.
 */
function buttons(uses: Array<{ id: string; holds?: Record<string, number> }>): Scene {
	const label: SceneNode = {
		...makeNode("text", { x: 12, y: 14, width: 136, height: 20 }, {
			id: "label",
			name: "Label",
		}),
		props: {
			text: [lit("Go"), lit("Stop")],
			ink: [derive("contrast", propVar("btn", "fill"))],
			size: single("14px"),
			weight: single("600"),
		},
	};
	const definition: SceneNode = {
		...makeNode("frame", { x: 20, y: 20, width: 160, height: 48 }, {
			id: "btn",
			name: "Button",
		}),
		props: { fill: [lit("#3b82f6"), lit("#0f172a")], radius: single("8px") },
		children: [label],
		component: true,
	};
	return {
		styles: [],
		tokens: [],
		constraints: [],
		rules: "",
		nodes: [
			{
				...makeNode("frame", { x: 0, y: 0, width: 600, height: 400 }, {
					id: "page",
					name: "Page",
				}),
				props: { fill: [lit("#ffffff")] },
				children: [
					definition,
					...uses.map((use, i) => ({
						...makeNode("instance", { x: 300, y: 20 + i * 64, width: 160, height: 48 }, {
							id: use.id,
							name: use.id,
						}),
						instanceOf: "btn",
						...(use.holds ? { holds: use.holds } : {}),
					})),
				],
			},
		],
	};
}

const FILL = propVar("btn", "fill");
const TEXT = propVar("label", "text");

/* ------------------------------------------------------------------ */
/* Reading a definition                                                */
/* ------------------------------------------------------------------ */

test("a definition's open variables are the properties that hold a choice", () => {
	const scene = buttons([]);
	const def = componentDef(scene, "btn");
	assert.ok(def);
	assert.deepEqual(
		openVariables(def).map((v) => v.variable).sort(),
		[FILL, TEXT].sort(),
	);
	// The radius holds one value, so it is the definition's decision and not
	// something an instance gets a say in.
	assert.ok(!openVariables(def).some((v) => v.prop === "radius"));
});

test("variants are the cross product of what the definition left open", () => {
	const scene = buttons([]);
	const def = componentDef(scene, "btn");
	assert.ok(def);
	const { variants, truncated } = variantsOf(scene, def);
	assert.equal(truncated, false);
	assert.equal(variants.length, 4);
	// Emergent, and named by the alternatives themselves.
	assert.deepEqual(variants.map((v) => v.label), [
		"#3b82f6 · Go",
		"#3b82f6 · Stop",
		"#0f172a · Go",
		"#0f172a · Stop",
	]);
});

test("two combinations that render alike are one variant", () => {
	const scene = buttons([]);
	// A second spelling of the same colour is not a second design, exactly as
	// `#project rendered/3` says it is not a second universe.
	const twin = {
		...scene,
		nodes: [
			{
				...scene.nodes[0],
				children: scene.nodes[0].children?.map((n) =>
					n.id === "btn"
						? { ...n, props: { ...n.props, fill: [lit("#3b82f6"), lit("#3b82f6")] } }
						: n,
				),
			},
		],
	} as Scene;
	const def = componentDef(twin, "btn");
	assert.ok(def);
	assert.equal(variantsOf(twin, def).variants.length, 2);
});

test("an instance part id is a term that reads back", () => {
	assert.equal(instancePart("i1", "label"), "inst(i1,label)");
	assert.deepEqual(parseInstancePart("inst(i1,label)"), {
		instance: "i1",
		node: "label",
	});
	assert.equal(parseInstancePart("label"), null);
	assert.equal(partLabel(buttons([{ id: "one" }]), "inst(one,label)"), "Label — one");
});

/* ------------------------------------------------------------------ */
/* What the solver makes of it                                         */
/* ------------------------------------------------------------------ */

test("an instance's contents are derived, not held by the document", async () => {
	const scene = buttons([{ id: "one" }]);
	const answer = await explore(scene, directSolver, { limit: 40 });
	const model = answer.universes[0].model;
	// Nothing named `inst(...)` is in the document, and all of it is in the
	// picture.
	assert.ok(model.byId["inst(one,btn)"], "the root copy is drawn");
	assert.ok(model.byId["inst(one,label)"], "the label copy is drawn");
	assert.deepEqual(
		model.byId["inst(one,btn)"].children.map((c) => c.id),
		["inst(one,label)"],
	);
	// The root copy fills the instance's own box and sits at its origin; what is
	// inside keeps the definition's arrangement.
	assert.deepEqual(model.byId["inst(one,btn)"].frame, {
		x: 0,
		y: 0,
		width: 160,
		height: 48,
	});
	assert.deepEqual(model.byId["inst(one,label)"].frame, {
		x: 12,
		y: 14,
		width: 136,
		height: 20,
	});
	assert.equal(model.byId["inst(one,btn)"].kind, "frame");
	assert.equal(model.byId["inst(one,label)"].kind, "text");
});

test("editing the definition changes every instance", async () => {
	const scene = buttons([{ id: "one" }, { id: "two" }]);
	const edited: Scene = {
		...scene,
		nodes: [
			{
				...scene.nodes[0],
				children: scene.nodes[0].children?.map((n) =>
					n.id === "btn" ? { ...n, props: { ...n.props, radius: single("22px") } } : n,
				),
			},
		],
	};
	const answer = await explore(edited, directSolver, { limit: 40 });
	for (const universe of answer.universes) {
		for (const id of ["inst(one,btn)", "inst(two,btn)"]) {
			assert.equal(universe.model.byId[id].rendered.radius, "22px");
		}
	}
});

test("two instances can differ where the definition left a choice", async () => {
	const scene = buttons([{ id: "one" }, { id: "two" }]);
	const answer = await explore(scene, directSolver, { limit: 200 });
	// Definition (4) x one (4) x two (4).
	assert.equal(answer.total, 64);
	const differ = answer.universes.some(
		(u) =>
			u.model.byId["inst(one,btn)"].rendered.fill !==
			u.model.byId["inst(two,btn)"].rendered.fill,
	);
	assert.ok(differ, "some universe paints the two instances differently");
});

test("an instance cannot differ where the definition decided", async () => {
	const scene = buttons([{ id: "one" }, { id: "two" }]);
	const answer = await explore(scene, directSolver, { limit: 200 });
	// The radius holds one alternative, so there is no variable to pick and
	// every instance in every universe has the same one.
	for (const universe of answer.universes) {
		for (const id of ["inst(one,btn)", "inst(two,btn)", "btn"]) {
			assert.equal(universe.model.byId[id].rendered.radius, "8px");
		}
	}
	// The variable exists — it is minted like any other — it simply has one
	// alternative, so there is no second thing it could ever have said.
	assert.deepEqual(answer.brave.pick[propVar("inst(one,btn)", "radius")], new Set([0]));
	assert.deepEqual(answer.brave.pick[propVar("inst(one,btn)", "fill")], new Set([0, 1]));
});

test("an alternative that links or computes is in the row like any other", async () => {
	// An instance's properties are variables no *document* value named, so the
	// only account of their alternatives is `dalt/3` in the answer set. It used to
	// report the literal ones and stop, which showed a definition that offers a
	// hex or a token as a row with one alternative in it: the pencil marks were
	// short by exactly the interesting one, and nothing said so.
	const base = buttons([{ id: "one" }]);
	const scene: Scene = {
		...base,
		tokens: [{ id: "brand", name: "Brand", type: "color", value: [lit("#ef4444")] }],
		nodes: [
			{
				...base.nodes[0],
				children: base.nodes[0].children?.map((n) =>
					n.id === "btn"
						? { ...n, props: { ...n.props, fill: [lit("#3b82f6"), ref("brand")] } }
						: n,
				),
			},
		],
	};
	const answer = await explore(scene, directSolver, { limit: 40 });
	const fill = propVar("inst(one,btn)", "fill");
	const ink = propVar("inst(one,label)", "ink");
	assert.deepEqual(answer.brave.pick[fill], new Set([0, 1]), "both are reachable");
	for (const universe of answer.universes) {
		// Reported as what it comes to, which for a link is the token's value and
		// for a derivation is whatever this universe's source made it.
		assert.deepEqual(universe.model.variables[fill], [
			{ index: 0, text: "#3b82f6" },
			{ index: 1, text: "#ef4444" },
		]);
		assert.deepEqual(universe.model.variables[ink], [
			{ index: 0, text: "#ffffff" },
		]);
		// And the row's own alternative is the one the design drew with.
		const drawn = universe.model.byId["inst(one,btn)"].rendered.fill;
		const at = universe.pick[fill];
		assert.equal(universe.model.variables[fill][at].text, drawn);
	}
});

test("a derivation inside a definition follows the instance's own copy", async () => {
	const scene = buttons([{ id: "one" }, { id: "two" }]);
	const answer = await explore(scene, directSolver, { limit: 200 });
	const readable = (fill: string | undefined) =>
		fill === "#3b82f6" ? "#ffffff" : "#ffffff";
	assert.equal(answer.universes.length > 1, true);
	for (const universe of answer.universes) {
		for (const use of ["one", "two"]) {
			const fill = universe.model.byId[`inst(${use},btn)`].rendered.fill;
			const ink = universe.model.byId[`inst(${use},label)`].rendered.ink;
			// Both fills are dark enough to want white ink; what matters is that the
			// ink was computed per instance rather than copied from the definition,
			// which the next assertion pins down.
			assert.equal(ink, readable(fill));
		}
	}
	// The source really was remapped: the instance's ink is its own variable.
	assert.ok(propVar("inst(one,label)", "ink") in answer.brave.pick);
});

/* ------------------------------------------------------------------ */
/* Overrides                                                           */
/* ------------------------------------------------------------------ */

test("a held pick is a pin the document remembers", async () => {
	const scene = buttons([{ id: "one", holds: { [FILL]: 1 } }, { id: "two" }]);
	assert.deepEqual(heldPicks(scene), {
		[instanceVariable("one", "btn", "fill")]: 1,
	});
	const answer = await explore(scene, directSolver, { limit: 200 });
	// One instance has half the freedom it had, so half the universes.
	assert.equal(answer.total, 32);
	for (const universe of answer.universes) {
		assert.equal(universe.model.byId["inst(one,btn)"].rendered.fill, "#0f172a");
	}
});

test("a held pick out of range is dropped rather than made unsatisfiable", async () => {
	const scene = buttons([{ id: "one", holds: { [FILL]: 7, "prop(gone,fill)": 0 } }]);
	assert.deepEqual(heldPicks(scene), {});
	const answer = await explore(scene, directSolver, { limit: 40 });
	assert.equal(answer.total, 16);
});

test("holding every open choice leaves the instance one design", async () => {
	const scene = buttons([{ id: "one", holds: { [FILL]: 0, [TEXT]: 1 } }]);
	const answer = await explore(scene, directSolver, { limit: 40 });
	// Only the definition still varies.
	assert.equal(answer.total, 4);
	for (const universe of answer.universes) {
		assert.equal(universe.model.byId["inst(one,btn)"].rendered.fill, "#3b82f6");
		assert.equal(universe.model.byId["inst(one,label)"].rendered.text, "Stop");
	}
});

test("a browsing pin looks past an override rather than contradicting it", async () => {
	const scene = buttons([{ id: "one", holds: { [FILL]: 0 } }]);
	const answer = await explore(scene, directSolver, {
		limit: 40,
		pins: { [instanceVariable("one", "btn", "fill")]: 1 },
	});
	assert.ok(answer.universes.length > 0);
	for (const universe of answer.universes) {
		assert.equal(universe.model.byId["inst(one,btn)"].rendered.fill, "#0f172a");
	}
});

test("the shown variant is read out of the universe on screen", async () => {
	const scene = buttons([{ id: "one", holds: { [FILL]: 1, [TEXT]: 0 } }]);
	const def = componentDef(scene, "btn");
	assert.ok(def);
	const { variants } = variantsOf(scene, def);
	const answer = await explore(scene, directSolver, { limit: 40 });
	const at = shownVariant(variants, def, "one", answer.universes[0].pick);
	assert.ok(at >= 0);
	assert.deepEqual(variants[at].picks, { [FILL]: 1, [TEXT]: 0 });
});

/* ------------------------------------------------------------------ */
/* Edits                                                               */
/* ------------------------------------------------------------------ */

test("defining, instancing and releasing", async () => {
	let scene = buttons([]);
	scene = releaseComponent(scene, "btn");
	assert.equal(componentDef(scene, "btn"), undefined);
	// A definition has to be able to hold something.
	assert.equal(defineComponent(scene, "label").nodes[0].children?.[0].component, undefined);

	scene = defineComponent(scene, "btn");
	assert.ok(componentDef(scene, "btn"));
	const placed = addInstance(scene, "btn");
	scene = placed.scene;
	const created = scene.nodes[0].children?.find((n) => n.id === placed.id);
	assert.ok(created);
	assert.equal(created.kind, "instance");
	assert.equal(created.instanceOf, "btn");
	// Beside the definition, at its size.
	assert.deepEqual(
		["x", "y", "width", "height"].map((d) => created.frame[d as "x"][0]),
		[lit("220px"), lit("20px"), lit("160px"), lit("48px")],
	);
	const answer = await explore(scene, directSolver, { limit: 40 });
	assert.ok(answer.universes[0].model.byId[`inst(${placed.id},label)`]);
});

test("an instance of a definition that is no longer one draws nothing", async () => {
	const scene = releaseComponent(buttons([{ id: "one" }]), "btn");
	const answer = await explore(scene, directSolver, { limit: 40 });
	const model = answer.universes[0].model;
	// The instance node itself survives — it is in the document — but there is
	// nothing to derive inside it.
	assert.ok(model.byId.one);
	assert.equal(model.byId.one.children.length, 0);
});

test("keeping a pinned universe writes an instance's picks as overrides", async () => {
	const scene = buttons([{ id: "one" }, { id: "two" }]);
	const answer = await explore(scene, directSolver, { limit: 200 });
	const universe = answer.universes.find(
		(u) => u.model.byId["inst(one,btn)"].rendered.fill === "#0f172a",
	);
	assert.ok(universe);
	// What the multiverse's "Keep" does: the picks of the design on screen,
	// written into the document. An instance's variables are nowhere in the
	// document to be shortened, so they land where an override lives — and the
	// definition's lists are what those overrides index into, so they stay.
	const kept = collapseToPicks(scene, universe.pick);
	const one = kept.nodes[0].children?.find((n) => n.id === "one");
	assert.equal(one?.holds?.[FILL], 1);
	const def = kept.nodes[0].children?.find((n) => n.id === "btn");
	assert.equal(def?.props.fill?.length, 2, "the space an override indexes into");
	assert.equal(def?.holds?.[FILL], universe.pick[FILL]);
	const after = await explore(kept, directSolver, { limit: 200 });
	for (const u of after.universes) {
		assert.equal(u.model.byId["inst(one,btn)"].rendered.fill, "#0f172a");
	}
});

test("Keep reproduces every universe it could be pressed on, exactly", async () => {
	// The general claim, and the one that would have caught this: pressing Keep
	// on the design in front of you leaves a document that is that design and
	// nothing else. `find`-ing one universe and checking it was not enough —
	// which universe came back first turned out to depend on how much the
	// program reported, and the case that failed was the interesting one.
	//
	// It failed because a component's definition is two things at once: it is a
	// design, and it is the list every instance's override indexes into.
	// Collapsing that list to the alternative the definition took removed the
	// choice the instances were making, so every override Keep had just written
	// was out of range and dropped, and a universe in which an instance differed
	// from its definition came back as a different design.
	const scene = buttons([{ id: "one" }, { id: "two" }]);
	const answer = await explore(scene, directSolver, { limit: 200 });
	const drawn = (universe: (typeof answer.universes)[number]) =>
		["btn", "inst(one,btn)", "inst(two,btn)", "inst(one,label)", "inst(two,label)"]
			.map(
				(id) =>
					`${id}=${universe.model.byId[id].rendered.fill ?? ""}` +
					`/${universe.model.byId[id].rendered.text ?? ""}`,
			)
			.join(" ");
	// Every combination of the three fills and the three texts, minus the ones
	// that render alike — enough universes that a lucky first one proves nothing.
	assert.ok(answer.universes.length >= 16);
	// Two differing instances have to be in there, or the claim is untested.
	assert.ok(
		answer.universes.some(
			(u) =>
				u.model.byId["inst(one,btn)"].rendered.fill !==
				u.model.byId.btn.rendered.fill,
		),
		"an instance that differs from its definition",
	);
	for (const universe of answer.universes) {
		const kept = collapseToPicks(scene, universe.pick);
		const after = await explore(kept, directSolver, { limit: 8 });
		assert.equal(after.universes.length, 1, `one design: ${drawn(universe)}`);
		assert.equal(drawn(after.universes[0]), drawn(universe));
		// And it is still a component: Keep records a decision, it does not
		// delete the space the decision was made in.
		assert.ok(componentDef(kept, "btn"));
	}
});

test("setHold and setVariant write the document", () => {
	let scene = buttons([{ id: "one" }]);
	const instance = () => scene.nodes[0].children?.find((n) => n.id === "one");
	scene = setHold(scene, "one", FILL, 1);
	assert.deepEqual(instance()?.holds, { [FILL]: 1 });
	scene = setHold(scene, "one", FILL, null);
	assert.equal(instance()?.holds, undefined);
	scene = setVariant(scene, "one", { [FILL]: 0, [TEXT]: 1 });
	assert.deepEqual(instance()?.holds, { [FILL]: 0, [TEXT]: 1 });
	scene = setVariant(scene, "one", null);
	assert.equal(instance()?.holds, undefined);
});

/* ------------------------------------------------------------------ */
/* The template                                                        */
/* ------------------------------------------------------------------ */

test("the component template is a component with four variants, used three times", async () => {
	const scene = component();
	const def = componentDef(scene, "button");
	assert.ok(def);
	assert.equal(variantsOf(scene, def).variants.length, 4);

	const answer = await explore(scene, directSolver, { limit: 40 });
	// The definition (4) x the one instance nobody decided for (4). The other
	// two hold both of their choices — and the style adds none, because a
	// treatment with one variant is a decision the document already made.
	assert.equal(answer.total, 16);
	const model = answer.universes[0].model;
	for (const use of ["primary", "secondary", "undecided"]) {
		assert.ok(model.byId[`inst(${use},button)`], `${use} draws its copy`);
		assert.ok(model.byId[`inst(${use},buttonLabel)`]);
		// The definition wears the style, so every copy of that part does.
		assert.equal(model.byId[`inst(${use},buttonLabel)`].rendered.size, "14px");
	}
	assert.equal(model.byId.buttonLabel.rendered.weight, "600");
	assert.deepEqual(
		model.wears.buttonText.map((w) => w.node),
		["inst(primary,buttonLabel)", "inst(secondary,buttonLabel)", "inst(undecided,buttonLabel)"],
		"and the wearing an instance derived is reported, since the document has no account of it",
	);
	// The two decided instances never change; the undecided one does.
	const seen = new Set(
		answer.universes.map((u) => u.model.byId["inst(undecided,buttonLabel)"].rendered.text),
	);
	assert.equal(seen.size, 2);
	for (const universe of answer.universes) {
		assert.equal(
			universe.model.byId["inst(primary,buttonLabel)"].rendered.text,
			"Get started",
		);
		assert.equal(
			universe.model.byId["inst(secondary,buttonLabel)"].rendered.text,
			"Learn more",
		);
	}
});

test("the generated program carries components as facts, not as shape", () => {
	const withOne = compile(component()).generated;
	const without = compile({ ...component(), nodes: [] }).generated;
	// The rules are the same either way; only the facts differ. A document
	// changes the data, never the program.
	const rules = (text: string) =>
		text.slice(text.indexOf("% ---- component rules ----"));
	assert.equal(rules(withOne), rules(without));
	assert.ok(withOne.includes("component(button)."));
	assert.ok(withOne.includes("cpart(button,buttonLabel)."));
	assert.ok(withOne.includes("cinner(button,buttonLabel)."));
	assert.ok(withOne.includes("instance(primary,button)."));
	// The root is a part of itself, and never an inner one.
	assert.ok(withOne.includes("cpart(button,button)."));
	assert.ok(!withOne.includes("cinner(button,button)."));
});

test("a token an instance links to is still the document's one token", async () => {
	const scene: Scene = {
		...buttons([{ id: "one" }]),
		tokens: [
			{ id: "brand", name: "brand", type: "color", value: [lit("#0ea5e9")] },
		],
	};
	const linked: Scene = {
		...scene,
		nodes: [
			{
				...scene.nodes[0],
				children: scene.nodes[0].children?.map((n) =>
					n.id === "btn"
						? { ...n, props: { ...n.props, fill: [ref("brand"), lit("#0f172a")] } }
						: n,
				),
			},
		],
	};
	const answer = await explore(linked, directSolver, { limit: 40 });
	const followed = answer.universes.some(
		(u) => u.model.byId["inst(one,btn)"].rendered.fill === "#0ea5e9",
	);
	assert.ok(followed, "the instance follows the token link, not a frozen colour");
});

test("a style a definition wears reaches every instance, at the same variant", async () => {
	// The other half of the sentence above, and the sharper half: a style is the
	// document's, like a token, so an instance's copy takes the *same* pick
	// rather than minting one. Two instances may differ in a fill the definition
	// left open; they may not differ in treatment, and that is what makes "these
	// all look alike" a promise rather than a coincidence.
	const base = buttons([{ id: "one" }, { id: "two" }]);
	const scene: Scene = {
		...base,
		styles: [
			{
				id: "cap",
				name: "Caption",
				variants: [
					{ name: "Small", parts: { size: lit("12px"), weight: lit("500") } },
					{ name: "Large", parts: { size: lit("20px"), weight: lit("800") } },
				],
			},
		],
		nodes: [
			{
				...base.nodes[0],
				children: base.nodes[0].children?.map((n) =>
					n.id !== "btn"
						? n
						: {
								...n,
								children: n.children?.map((c) =>
									// Its own size and weight go, or the node would win and the
									// style would decide nothing.
									c.id === "label"
										? {
												...c,
												style: "cap",
												props: { text: c.props.text, ink: c.props.ink },
											}
										: c,
								),
							},
				),
			},
		],
	};

	const answer = await explore(scene, directSolver, { limit: 60 });
	const parts = ["label", "inst(one,label)", "inst(two,label)"];
	for (const universe of answer.universes) {
		const sizes = parts.map((id) => universe.model.byId[id].rendered.size);
		assert.ok(
			sizes.every((size) => size === "12px" || size === "20px"),
			`every copy is styled: ${sizes.join(" ")}`,
		);
		assert.equal(new Set(sizes).size, 1, "and at one treatment, definition included");
	}
	// Both treatments are reachable, or the assertion above is vacuous.
	assert.deepEqual(
		[...new Set(answer.universes.map((u) => u.model.byId["inst(one,label)"].rendered.size))].sort(),
		["12px", "20px"],
	);
	// And the wearing an instance derived is reported, because the document has
	// no account of `inst(one,label)` to read it off.
	assert.deepEqual(answer.universes[0].model.wears, {
		cap: [
			{ node: "inst(one,label)", props: ["size", "weight"] },
			{ node: "inst(two,label)", props: ["size", "weight"] },
		],
	});
});
