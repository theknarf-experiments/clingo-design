import assert from "node:assert/strict";
import { test } from "node:test";

import { directSolver } from "./directSolver.ts";
import { deleteNodes, updateConstraint } from "./edits.ts";
import { exportUniverse } from "./export.ts";
import { explore, varyingVars } from "./explore.ts";
import { compareCosts } from "./sampling.ts";
import { frameOf, sceneContext, wornProps } from "./scene.ts";
import { isSpatialScene } from "./spatial.ts";
import { findInTree, flatten } from "./tree.ts";
import { TEMPLATES, findTemplate } from "./templates/index.ts";
import { EMU_PER_PX } from "./units.ts";
import { single, styleVar } from "./values.ts";

test("every template has a unique id and a findable entry", () => {
	const ids = TEMPLATES.map((t) => t.id);
	assert.equal(new Set(ids).size, ids.length);
	for (const id of ids) assert.equal(findTemplate(id)?.id, id);
	assert.equal(findTemplate("nope"), undefined);
});

for (const template of TEMPLATES) {
	test(`template "${template.id}" is solvable and laid out`, async () => {
		const scene = template.create();
		const result = await explore(scene, directSolver, { limit: 64 });
		assert.ok(result.count > 0, "expected at least one universe");

		const all = flatten(scene.nodes);
		const context = sceneContext(scene);
		for (const node of all) {
			assert.ok(result.universes[0].visible.has(node.id), `${node.id} should render`);
			// Every node must have a real position and size.
			const box = frameOf(node, context);
			assert.ok(box.width > 0 && box.height > 0, `${node.id} has no size`);
			assert.ok(Number.isFinite(box.x) && Number.isFinite(box.y));
		}
		// Node ids must be unique or selection and hit testing break.
		const ids = all.map((n) => n.id);
		assert.equal(new Set(ids).size, ids.length);
	});
}

test("every template's top level is frames", () => {
	for (const template of TEMPLATES) {
		const scene = template.create();
		assert.ok(scene.nodes.length > 0, `${template.id} has no frames`);
		for (const node of scene.nodes) {
			assert.equal(node.kind, "frame", `${template.id}/${node.id} is not a frame`);
		}
	}
});

test("template contents stay inside their frame", () => {
	for (const template of TEMPLATES) {
		const scene = template.create();
		const check = (parent: (typeof scene.nodes)[number]) => {
			const outer = frameOf(parent);
			for (const child of parent.children ?? []) {
				// Coordinates are relative, so containment is a local check.
				const box = frameOf(child);
				assert.ok(
					box.x >= 0 &&
						box.y >= 0 &&
						box.x + box.width <= outer.width &&
						box.y + box.height <= outer.height,
					`${template.id}/${child.id} escapes ${parent.id}`,
				);
				check(child);
			}
		};
		for (const root of scene.nodes) check(root);
	}
});

test("blank is one empty frame, and settled", async () => {
	const scene = findTemplate("blank")!.create();
	assert.equal(scene.nodes.length, 1);
	assert.equal(scene.nodes[0].kind, "frame");
	assert.deepEqual(scene.nodes[0].children, []);

	const result = await explore(scene, directSolver, { limit: 8 });
	assert.equal(result.count, 1);
	assert.deepEqual(varyingVars(result), []);
});

test("card varies through two shared tokens", async () => {
	const result = await explore(findTemplate("card")!.create(), directSolver, {
		limit: 64,
		sample: "first",
	});
	// 5 accents x 3 radii, and every reference moves together.
	assert.equal(result.count, 15);
	assert.deepEqual(varyingVars(result).sort(), ["tok(accent)", "tok(radius)"]);
});

test("button set varies per assignment, not through a token", async () => {
	const result = await explore(findTemplate("buttons")!.create(), directSolver, {
		limit: 64,
		sample: "first",
	});
	// Three independent choices of three: 27.
	assert.equal(result.count, 27);
	assert.deepEqual(varyingVars(result).sort(), [
		"prop(one,fill)",
		"prop(three,fill)",
		"prop(two,fill)",
	]);
});

test("preference orders the whole space, and the tiers decide", async () => {
	const scene = findTemplate("ranked")!.create();
	const out = await explore(scene, directSolver, { limit: 24 });
	// Nine designs, all of them legal and all of them shown: two preferences
	// that cannot both hold are a ranking, not a smaller space.
	assert.equal(out.count, 9);
	assert.equal(out.optimized, true);
	assert.equal(out.truncated, false);
	// Three tiers, strongest first, and the best design pays the cheaper rule.
	assert.deepEqual(out.levels, [3, 2, 1]);
	assert.deepEqual(out.costs, [0, 1, 0]);
	const costs = out.universes.map((u) => u.costs);
	assert.deepEqual(costs[0], out.costs, "best first");
	for (let i = 1; i < costs.length; i++) {
		assert.ok(compareCosts(costs[i - 1], costs[i]) <= 0);
	}
	// The winner is an all-different design, which is what the stronger tier
	// asked for; the restraint it gave up shows as the point at the second level.
	const [a, b, c] = ["one", "two", "three"].map(
		(id) => out.universes[0].model.byId[id]?.rendered.fill,
	);
	assert.equal(new Set([a, b, c]).size, 3);

	// Swap the two tiers and the same space, the same nine designs, ranks the
	// other way round. Nothing else about the document changes.
	let swapped = updateConstraint(scene, "variety", { strength: "prefer" });
	swapped = updateConstraint(swapped, "restraint", { strength: "strong" });
	const other = await explore(swapped, directSolver, { limit: 24 });
	assert.equal(other.count, 9);
	assert.deepEqual(other.costs, [0, 1, 0]);
	const winner = ["one", "two", "three"].map(
		(id) => other.universes[0].model.byId[id]?.rendered.fill,
	);
	assert.ok(new Set(winner).size <= 2, "restraint now wins");
});

test("two frames share one accent variable", async () => {
	const scene = findTemplate("pair")!.create();
	assert.equal(scene.nodes.length, 2, "two artboards");

	const result = await explore(scene, directSolver, { limit: 32, sample: "first" });
	// One shared token, so both frames move together: three designs, not nine.
	assert.equal(result.count, 3);
	assert.deepEqual(varyingVars(result), ["tok(accent)"]);
});

test("two typographies is one variable, and both of its designs are coherent", async () => {
	// The template exists to make one argument, so this is that argument as an
	// assertion. Four correlated fields — family, size, weight, leading — held
	// as four two-value tokens would be sixteen designs and fourteen of them
	// incoherent; held as one style they are two.
	const scene = findTemplate("typography")!.create();
	const out = await explore(scene, directSolver, { limit: 24 });
	assert.deepEqual(varyingVars(out), [styleVar("prose")], "one variable");
	assert.equal(out.count, 2, "two designs");

	const body = ["deck", "first", "second", "footnote"];
	const treatments = out.universes
		.map((u) => {
			const n = u.model.byId.deck;
			return [n.rendered.size, n.rendered.weight, n.rendered.lineHeight].join("/");
		})
		.sort();
	assert.deepEqual(treatments, ["15px/450/1.3", "18px/400/1.75"]);
	for (const universe of out.universes) {
		// The correlation, per universe: one pick, and every wearer took the
		// same whole record from it.
		for (const prop of ["size", "weight", "lineHeight", "fontFamily"] as const) {
			const values = new Set(body.map((id) => universe.model.byId[id].rendered[prop]));
			assert.equal(values.size, 1, `${prop} agrees across the page`);
		}
	}

	// And the heading is the ordinary case rather than the pure one: it states
	// its own size and weight and takes the family and the leading.
	const title = findInTree(scene.nodes, "title");
	assert.ok(title);
	assert.deepEqual(wornProps(scene, title), ["fontFamily", "lineHeight"]);
});

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

/**
 * The `machine` template exists to make one claim, so these are that claim as
 * assertions, in the order the template's own doc-comment makes them.
 *
 * The first is the load-bearing one and it is deliberately first: a document
 * with a three-state machine, and the same document with the machine cut out of
 * it, enumerate the same designs. Every other test in this block would pass
 * under the cheap encoding — a choice rule over the states — and this one is the
 * one that would not.
 */
test("states are not a design space: the machine changes no universe count", async () => {
	const scene = findTemplate("machine")!.create();

	const withMachine = await explore(scene, directSolver, { limit: 64 });
	const without = await explore({ ...scene, machines: [] }, directSolver, {
		limit: 64,
	});

	// The same *variables*, not merely the same number of them. A count could
	// coincide; two identical lists cannot, and this is what says the machine
	// added no axis rather than adding one and removing another.
	assert.deepEqual(
		varyingVars(withMachine).sort(),
		varyingVars(without).sort(),
		"a machine is behaviour, not a design decision",
	);
	assert.equal(withMachine.count, without.count);
	assert.ok(withMachine.count > 1, "there is a space for the machine not to change");

	// And a fourth state is free, which is the claim in the form somebody would
	// actually hit it: adding a state must not multiply anything. Under a choice
	// rule this would be `count * 4/3`.
	const fourth = {
		...scene,
		machines: scene.machines.map((m) => ({
			...m,
			states: [...m.states, { id: "busy", name: "Busy", parts: {} }],
		})),
	};
	assert.equal((await explore(fourth, directSolver, { limit: 64 })).count, withMachine.count);

	// No variable anywhere is a state, and no answer set holds a pick over one.
	for (const variable of varyingVars(withMachine)) {
		assert.ok(!variable.includes("stt("), `${variable} is a state copy`);
		assert.ok(!variable.startsWith("sprop("), `${variable} branches per state`);
	}
});

test("every state of the button is in the one answer set, beside the picture", async () => {
	const scene = findTemplate("machine")!.create();
	const out = await explore(scene, directSolver, { limit: 8 });
	const model = out.universes[0].model;

	// Three states, two materialised parts, two uses. The label is materialised
	// because `pressed` gives it a delta; nothing else in the definition is,
	// which is the analysis paying for itself.
	assert.deepEqual(
		Object.keys(model.states).sort(),
		[
			"stt(hovering,hover,button)",
			"stt(hovering,hover,label)",
			"stt(hovering,pressed,button)",
			"stt(hovering,pressed,label)",
			"stt(hovering,rest,button)",
			"stt(hovering,rest,label)",
			"stt(resting,hover,button)",
			"stt(resting,hover,label)",
			"stt(resting,pressed,button)",
			"stt(resting,pressed,label)",
			"stt(resting,rest,button)",
			"stt(resting,rest,label)",
		],
		"every state of every use, in one answer set",
	);

	// A state copy is never a node, which is what keeps it out of the layer list,
	// out of hit testing and out of both exporters — none of which had to learn a
	// case for it.
	for (const id of Object.keys(model.byId)) {
		assert.ok(!id.startsWith("stt("), `${id} is drawn, and a state copy must not be`);
	}

	// The three states really are three pictures: the lift, the rest, the press.
	const y = (state: string) => model.states[`stt(resting,${state},button)`].frame.y;
	assert.ok(y("hover") < y("rest"), "hover lifts");
	assert.ok(y("pressed") > y("rest"), "a press takes the weight");

	// Two uses in two states at once, each drawing its own — which is the thing a
	// sprite sheet cannot do, since the two would be in two answer sets.
	assert.deepEqual(model.shown, { resting: "rest", hovering: "hover" });
	assert.equal(model.byId["inst(resting,button)"].frame.y, y("rest"));
	assert.equal(model.byId["inst(hovering,button)"].frame.y, y("hover"));

	// What a state does not touch, it shares. Hover says nothing about the fill,
	// so its copy paints the literal the instance's own one variable resolved to
	// — not a second variable that happens to agree.
	assert.equal(
		model.states["stt(resting,hover,button)"].rendered.fill,
		model.byId["inst(resting,button)"].rendered.fill,
	);
	// And the one property a state does own is the one that differs.
	assert.notEqual(
		model.states["stt(resting,pressed,button)"].rendered.fill,
		model.states["stt(resting,rest,button)"].rendered.fill,
	);

	// The machine is sound, and the answer set says so in the four predicates the
	// canned checks read. A template that shipped with a finding in it would be
	// teaching the finding.
	const health = model.machines.buttonStates;
	assert.deepEqual(health.unreachable, []);
	assert.deepEqual(health.deadEnds, []);
	assert.deepEqual(health.nondeterministic, []);
	assert.deepEqual(health.dangling, []);
	// The motion scale resolved, and the one edge that names its own number kept
	// it: a press is immediate, everything else follows the token.
	assert.deepEqual(health.duration, {
		enter: 160,
		leave: 160,
		release: 160,
		press: 60,
	});
});

test("the button leaves as a stylesheet with the states in it", async () => {
	const scene = findTemplate("machine")!.create();
	const out = await explore(scene, directSolver, { limit: 8 });
	const html = exportUniverse(scene, out.universes[0], {
		target: "html",
		title: "machine",
	});

	// `pressed` is entered and left by a pointer down and up *from hover* rather
	// than from the initial state, so it is not a pseudo-class state and the file
	// carries the table-driven runtime instead. The rest/hover pair on its own
	// would have collapsed to `:hover` and emitted no script at all.
	assert.match(html.text, /\[data-state="pressed"\]/);
	assert.match(html.text, /<script>/);
	// Paced from the answer set rather than from a number in the emitter.
	assert.match(html.text, /transition:[^;]*160ms/);

	// And what it cannot carry, it says: the second use is drawn in a state other
	// than the machine's initial one, so the file starts there and every state is
	// a data-state rule.
	assert.ok(
		html.lost.some((entry) => entry.includes("Hovering")),
		"the export names the state it starts in",
	);

	// SVG has no states at all, and says so rather than shipping a still frame
	// that looks like the whole design.
	const svg = exportUniverse(scene, out.universes[0], {
		target: "svg",
		title: "machine",
	});
	assert.ok(svg.lost.some((entry) => entry.startsWith("Behaviour.")));
});

/* ------------------------------------------------------------------ */
/* Inputs, guards and layers                                           */
/* ------------------------------------------------------------------ */

/**
 * The `deck` template exists to make one claim about the whole ladder, so these
 * are that claim as assertions.
 *
 * The first is the load-bearing one, and it is the same shape as the states
 * one above for the same reason: every other test in this block would pass under
 * an encoding where a layer was a choice rule, and this one is the one that would
 * not. Two layers under a choice rule is a product, and a product is what makes
 * "does the meter still line up while the deck is playing" a question with no
 * answer set to ask it in.
 */
test("the whole ladder is free: inputs, guards and layers change no universe count", async () => {
	const scene = findTemplate("deck")!.create();

	const withLadder = await explore(scene, directSolver, { limit: 64 });
	const without = await explore({ ...scene, machines: [] }, directSolver, {
		limit: 64,
	});

	// The same *variables*, not merely the same number of them. A count could
	// coincide; two identical lists cannot, and this is what says the ladder added
	// no axis rather than adding one and removing another.
	assert.deepEqual(
		varyingVars(withLadder).sort(),
		varyingVars(without).sort(),
		"a ladder is behaviour, not a design decision",
	);
	assert.equal(withLadder.count, without.count);
	assert.ok(withLadder.count > 1, "there is a space for the ladder not to change");

	// And the rungs really are in the document, so the equality above is about
	// something. A template that had quietly lost its inputs would pass every
	// assertion in this test but this one.
	const machine = scene.machines[0];
	assert.equal(machine.inputs?.length, 3, "three inputs");
	assert.deepEqual(
		machine.inputs?.map((i) => i.kind).sort(),
		["boolean", "number", "trigger"],
		"one of each kind",
	);
	assert.equal(machine.layers?.length, 2, "two layers");
	assert.equal(
		machine.transitions.filter((t) => (t.conditions?.length ?? 0) > 0).length,
		3,
		"three guarded edges",
	);

	// A third layer with two states of its own is free, which is the claim in the
	// form somebody would actually hit it. Under a choice rule this would be twice
	// the count.
	const third = {
		...scene,
		machines: [
			{
				...machine,
				layers: [...(machine.layers ?? []), { id: "trim", name: "Trim" }],
				states: [
					...machine.states,
					{ id: "plain", name: "Plain", parts: {}, layer: "trim" },
					{
						id: "ruled",
						name: "Ruled",
						layer: "trim",
						parts: { label: { props: { weight: single("800") } } },
					},
				],
			},
		],
	};
	assert.equal((await explore(third, directSolver, { limit: 64 })).count, withLadder.count);

	// No variable anywhere is a state, a layer or an input. An input especially:
	// it is a runtime value, and a runtime value with a shadow in the design space
	// would be two universes identical in every projected atom.
	for (const variable of varyingVars(withLadder)) {
		assert.ok(!variable.includes("stt("), `${variable} is a state copy`);
		assert.ok(!variable.startsWith("sprop("), `${variable} branches per state`);
		assert.ok(!variable.includes("min("), `${variable} branches per input`);
		assert.ok(!variable.includes("mcond"), `${variable} branches per guard`);
	}
});

test("both layers are on screen at once, and the machine is sound on all eleven checks", async () => {
	const scene = findTemplate("deck")!.create();
	const out = await explore(scene, directSolver, { limit: 8 });
	const model = out.universes[0].model;

	// Two layers, two states, one answer set, one instance. `shown` answers for
	// the first layer so that every reader written before layers means what it
	// meant; `shownByLayer` is where the whole answer lives.
	assert.deepEqual(model.shownByLayer, {
		deckOne: { transport: "playing", meter: "loud" },
	});
	assert.deepEqual(model.shown, { deckOne: "playing" });

	// The two layers really are composed into one picture: the knob is at the
	// far end because `playing` moved it, and the track is the alarm colour
	// because `loud` painted it — in the same universe, at the same time.
	assert.equal(
		model.byId["inst(deckOne,knob)"].frame.x,
		model.states["stt(deckOne,playing,knob)"].frame.x,
		"the drawn knob is the playing layer's",
	);
	assert.notEqual(
		model.byId["inst(deckOne,track)"].rendered.fill,
		model.byId["inst(deckOne,label)"].rendered.fill,
	);
	assert.equal(
		model.byId["inst(deckOne,track)"].rendered.fill,
		model.states["stt(deckOne,loud,track)"].rendered.fill,
		"the drawn track is the meter layer's",
	);

	// A template that shipped with a finding in it would be teaching the finding,
	// so every list the eleven checks read is empty — including the three fight
	// lists, which is what the two layers touching different things buys.
	const health = model.machines.deck;
	assert.deepEqual(health.layers, ["transport", "meter"], "in priority order");
	for (const list of [
		"unreachable",
		"deadEnds",
		"nondeterministic",
		"dangling",
		"impossible",
		"unreachableWithGuards",
		"misplaced",
		"fights",
		"frameFights",
		"rotationFights",
		"stopsOutOfRange",
		"stopGaps",
		"twoSource",
		"exitPast",
		"backwardsKeys",
	] as const) {
		assert.deepEqual(health[list], [], `${list} is not empty`);
	}

	// The motion scale resolved, and the one edge that names its own number kept
	// it: an alarm is immediate, everything else follows the token. The debounce
	// follows it too, which is the point of an exit time being pacing rather than
	// a comparand.
	assert.equal(health.duration.alarm, 90);
	assert.equal(health.duration.play, 180);
	assert.equal(health.exit.settle, 180, "the debounce follows the motion scale");
});

test("the deck leaves as a file whose script holds the guards and the debounce", async () => {
	const scene = findTemplate("deck")!.create();
	const out = await explore(scene, directSolver, { limit: 8 });
	const html = exportUniverse(scene, out.universes[0], { target: "html", title: "deck" });

	// The second layer writes its own attribute, which is the twin of
	// `attributeOf` in the runtime: plain `data-state` for the first layer and
	// `data-state-<layer>` after it, so the CSS cascade settles a fight the way
	// `mwriter/4` does.
	assert.match(html.text, /data-state-meter/);
	// The guards ride the table rather than the stylesheet, because a guard is a
	// comparison a script makes and CSS has no word for one.
	assert.match(html.text, /"input":"armed"/);
	assert.match(html.text, /"op":"gt","value":500/, "a number guard is thousandths");
	assert.match(html.text, /"op":"fired"/);
	// And the debounce is in the file, at the number the token resolved to. This
	// is the regression guard for a real defect: built without the universe's
	// context, the table dropped a token-paced exit time as a zero while this
	// same file's losses announced the wait.
	assert.match(html.text, /"exit":180/);
});

/* ------------------------------------------------------------------ */
/* Three dimensions                                                    */
/* ------------------------------------------------------------------ */

/**
 * The `solids` template exists to make one claim, so these are that claim as
 * assertions, in the order its own doc-comment makes them.
 *
 * The first is the load-bearing one: a 3D view **joins** the design space rather
 * than creating one beside it. Every tool that grows a third dimension grows a
 * second document, and the tell is always the same — the count moves, because the
 * scene brought its own variables with it.
 */
test("a view joins the design space rather than multiplying it", async () => {
	const scene = findTemplate("solids")!.create();
	assert.equal(isSpatialScene(scene), true, "the template really is in three dimensions");

	const withView = await explore(scene, directSolver, { limit: 64 });
	// The same page with the whole view cut out, through the *editor's* own
	// delete — so the rules that named the meshes are pruned exactly as the
	// gesture would prune them, rather than by a tidier hand than a user has.
	const without = await explore(deleteNodes(scene, ["stage"]), directSolver, {
		limit: 64,
	});

	assert.deepEqual(
		varyingVars(withView).sort(),
		varyingVars(without).sort(),
		"a view is geometry, not a design decision",
	);
	assert.equal(withView.count, without.count);
	assert.ok(withView.count > 1, "there is a space for the view not to change");

	// And it is in the space rather than beside it: every solid in the row
	// repaints with the flat swatch, in every universe, because they read one
	// variable. This is what makes the equality above interesting rather than
	// merely the absence of a second document.
	for (const universe of withView.universes) {
		const swatch = universe.model.byId.swatch.rendered.fill;
		for (const id of ["cube", "ball", "post"]) {
			assert.equal(universe.model.byId[id].rendered.fill, swatch, `${id} in a universe`);
		}
	}
	assert.equal(
		new Set(withView.universes.map((u) => u.model.byId.cube.rendered.fill)).size,
		withView.count,
		"a different colour in each",
	);
});

test("a solid is an ordinary node: in the tree, in the answer set, and in a rule", async () => {
	const scene = findTemplate("solids")!.create();
	const out = await explore(scene, directSolver, { limit: 8 });
	const model = out.universes[0].model;

	// In the document's own tree, which is what the layer list, hit testing and
	// the undo stack all walk. No second model, no parallel scene graph.
	const ids = flatten(scene.nodes).map((n) => n.id);
	for (const id of ["stage", "eye", "key", "wash", "floor", "cube", "ball", "post", "ring"]) {
		assert.ok(ids.includes(id), `${id} is not in the tree`);
	}

	// Six numbers where a flat node has four, and the third axis is *absent*
	// rather than zero on the page around it — which is the whole no-regression
	// story stated one node at a time.
	assert.equal(model.byId.cube.spatial?.depth, 92 * EMU_PER_PX);
	assert.equal(model.byId.ring.turn?.rotateX, 70_000, "thousandths of a degree");

	// The asymmetry between the two, which is the compiler's own and worth
	// pinning: a *dimension* the document does not state is emitted as nothing at
	// all, so a flat rect on the page beside the view holds neither of the third
	// axis's numbers and neither of them is a zero anywhere. A *rotation* is
	// emitted as a variable always for a node in the scene — "the whole rack
	// tilts, or it does not" is one angle token and two designs, which a fact
	// cannot say — so every solid reads three angles and the unturned ones read
	// zero. Absence still means absence one node to the left, which is the half
	// that carries the no-regression promise.
	assert.equal(model.byId.swatch.spatial, undefined, "a flat rect gained no third axis");
	assert.equal(model.byId.swatch.turn, undefined, "a flat rect gained no rotation");
	assert.deepEqual(
		model.byId.cube.turn,
		{ rotateX: 0, rotateY: 0, rotateZ: 0 },
		"a solid in the scene reads three angles, turned or not",
	);

	// The rules bit. An ordinary `align` and two ordinary `gap`s, holding three
	// meshes in a row — with no rule, no predicate and no reader that knows it is
	// looking at geometry rather than at rectangles.
	const [cube, ball, post] = ["cube", "ball", "post"].map((id) => model.byId[id]);
	const centre = (n: typeof cube) => n.frame.y + n.frame.height / 2;
	assert.equal(centre(cube), centre(ball));
	assert.equal(centre(ball), centre(post));
	assert.equal(ball.frame.x - (cube.frame.x + cube.frame.width), 8 * EMU_PER_PX);
	assert.equal(post.frame.x - (ball.frame.x + ball.frame.width), 8 * EMU_PER_PX);

	// A camera is looked through and not drawn; a lamp is drawn by nothing and
	// governed by `visible/1` all the same. Both are nodes, and `looks/2` is how
	// the view says which eye it is using.
	assert.deepEqual(model.looks, { stage: "eye" });
});

test("the page exports around the view, and the view says what it could not carry", async () => {
	const scene = findTemplate("solids")!.create();
	const out = await explore(scene, directSolver, { limit: 8 });

	for (const target of ["html", "svg"] as const) {
		const file = exportUniverse(scene, out.universes[0], { target, title: "solids" });
		// The rest of the page is there, and so is the view's own box — it is a
		// rectangle with a fill and a radius, and everything above the seam was
		// always able to draw one.
		assert.match(file.text, /data-node="swatch"/);
		assert.match(file.text, /data-node="stage"/);
		// What is inside it is not, in either target, because neither has a word
		// for geometry, a camera, a light or a material.
		for (const id of ["cube", "ball", "post", "floor", "ring", "eye"]) {
			assert.doesNotMatch(file.text, new RegExp(`data-node="${id}"`), `${id} in ${target}`);
		}
		// And it is a stated loss rather than a subtree that went quiet.
		assert.ok(
			file.lost.some((entry) => entry.includes("view")),
			`${target} drops a subtree with nothing said`,
		);
	}

	// The two targets say it differently, and the difference is honest rather
	// than an oversight. HTML *can* place and turn a flat box and does, so its
	// loss is specifically the geometry: eight objects, counted off the model
	// rather than off the document, with glTF named as the way out. SVG is flat
	// full stop — it has no transform story to half-tell — so it says so once,
	// unconditionally, alongside its other blanket sentences.
	const html = exportUniverse(scene, out.universes[0], { target: "html", title: "solids" });
	assert.ok(
		html.lost.some((entry) => entry.includes("8 objects inside this view")),
		"HTML does not count what it dropped",
	);
	assert.ok(html.lost.some((entry) => entry.includes("glTF")), "the way out is named");

	const svg = exportUniverse(scene, out.universes[0], { target: "svg", title: "solids" });
	assert.ok(
		svg.lost.some((entry) => entry.startsWith("Three dimensions.")),
		"SVG does not say it is flat",
	);
});
