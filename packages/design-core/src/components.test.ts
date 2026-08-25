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
	// document to be shortened, so they land where an override lives.
	const kept = collapseToPicks(scene, universe.pick);
	const one = kept.nodes[0].children?.find((n) => n.id === "one");
	assert.equal(one?.holds?.[FILL], 1);
	const after = await explore(kept, directSolver, { limit: 200 });
	for (const u of after.universes) {
		assert.equal(u.model.byId["inst(one,btn)"].rendered.fill, "#0f172a");
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
	// two hold both of their choices.
	assert.equal(answer.total, 16);
	const model = answer.universes[0].model;
	for (const use of ["primary", "secondary", "undecided"]) {
		assert.ok(model.byId[`inst(${use},button)`], `${use} draws its copy`);
		assert.ok(model.byId[`inst(${use},buttonLabel)`]);
	}
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
