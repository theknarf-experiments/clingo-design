import assert from "node:assert/strict";
import { test } from "node:test";

import {
	DUPLICATE_OFFSET,
	addBlendStop,
	addCamera,
	addCondition,
	addConstraint,
	addInput,
	addInstance,
	addKeyframe,
	addLayer,
	addLight,
	addMachine,
	addMesh,
	addModel,
	addNode,
	addNodeTo,
	addPivot,
	addState,
	addTimeline,
	addToken,
	addTrack,
	addTransition,
	addViewport,
	clearSpatial,
	clearStatePart,
	clearTurn,
	defineComponent,
	deleteBlendStop,
	deleteCondition,
	deleteInput,
	deleteKeyframe,
	deleteLayer,
	deleteMachine,
	deleteNodes,
	deleteState,
	deleteTimeline,
	deleteTrack,
	deleteTransition,
	duplicateNodes,
	makeNode,
	moveNodes,
	pruneAssets,
	pruneMachines,
	releaseComponent,
	renameInput,
	renameLayer,
	renameMachine,
	renameNode,
	renameState,
	renameTimeline,
	reorderLayer,
	reorderNodes,
	reorderState,
	setBlendInput,
	setFrame,
	setFrameValue,
	setFrames,
	setInputInitial,
	setInputKind,
	setInputRange,
	setNodeLayerState,
	setNodeState,
	setProp,
	setSpatialValue,
	setStateBlend,
	setStateFrame,
	setStateHidden,
	setStateLayer,
	setStateProp,
	setStateTimeline,
	setStateTurn,
	setText,
	setTimelineLength,
	setTimelineLoop,
	setTurnValue,
	setViewportCamera,
	updateBlendStop,
	updateCondition,
	updateKeyframe,
	updateTransition,
} from "./edits.ts";
import { type Frame, MIN_NODE_SIZE } from "./geometry.ts";
import { keyCopy, statePart, trackDim, trackTerm } from "./machines.ts";
import { normalizeScene } from "./project.ts";
import {
	type Blend,
	type Keyframe,
	type Machine,
	type MeshRef,
	type Scene,
	type SceneNode,
	type Timeline,
	type Track,
	type Trigger,
	emptyScene,
	frameOf,
} from "./scene.ts";
import { flatten, mapTree } from "./tree.ts";
import { EMU_PER_PX } from "./units.ts";
import { lit, propVar, ref, resolveValue, single, wordOf } from "./values.ts";

/**
 * Cases are stated in pixels and frames are read in EMU, so the two helpers
 * below do the multiplying. Nothing an edit does cares which unit it is in —
 * the arithmetic would be the same in furlongs — but a document's minimum size
 * and a gesture's quantum are both pixel counts, so the cases that are *about*
 * those two have to be written in a unit that can express them.
 */
const P = EMU_PER_PX;

const box = (x: number, y: number, width: number, height: number): Frame => ({
	x: x * P,
	y: y * P,
	width: width * P,
	height: height * P,
});

function withBoxes(n: number): Scene {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	for (let i = 0; i < n; i++) {
		scene = addNode(
			scene,
			makeNode("rect", box(i * 50, 0, 40, 40), {
				id: `b${i}`,
				name: `Box ${i}`,
			}),
		);
	}
	return scene;
}

const ids = (scene: Scene) => scene.nodes.map((n) => n.id);

test("makeNode gives a rect sensible defaults", () => {
	const node = makeNode("rect", box(5.4, 5.6, 100, 80));
	assert.equal(node.kind, "rect");
	// The fractional pixels are gone: a frame arrives from a gesture, and a
	// gesture means a whole pixel however finely the pointer reports it.
	assert.deepEqual(frameOf(node), box(5, 6, 100, 80));
	assert.equal(node.props.fill?.[0]?.kind, "literal");
	assert.ok(node.id.length > 0);
});

test("makeNode gives a text node content", () => {
	const node = makeNode("text", box(0, 0, 100, 20));
	assert.equal(node.kind, "text");
	// Content is a property now, so a new text node arrives with one alternative.
	assert.equal(node.props.text?.length, 1);
	assert.equal(node.props.text?.[0].kind, "literal");
});

test("new node ids are unique", () => {
	const seen = new Set(
		Array.from({ length: 200 }, () => makeNode("rect", box(0, 0, 1, 1)).id),
	);
	assert.equal(seen.size, 200);
});

test("add and delete", () => {
	const scene = withBoxes(3);
	assert.deepEqual(ids(scene), ["b0", "b1", "b2"]);
	assert.deepEqual(ids(deleteNodes(scene, ["b1"])), ["b0", "b2"]);
	assert.deepEqual(ids(deleteNodes(scene, ["b0", "b2"])), ["b1"]);
	assert.deepEqual(ids(deleteNodes(scene, ["nope"])), ["b0", "b1", "b2"]);
});

test("moveNodes translates only the named nodes", () => {
	const moved = moveNodes(withBoxes(3), ["b0", "b2"], 10 * P, -5 * P);
	assert.deepEqual(frameOf(moved.nodes[0]), box(10, -5, 40, 40));
	assert.deepEqual(frameOf(moved.nodes[1]), box(50, 0, 40, 40));
	assert.deepEqual(frameOf(moved.nodes[2]), box(110, -5, 40, 40));
});

test("moveNodes rounds to whole pixels", () => {
	// Still whole pixels, and now for the only reason left: a hand means a
	// pixel, and a shared document should not fill up with sub-pixel diffs. The
	// compiler no longer needs it — see `normaliseFrame`.
	const moved = moveNodes(withBoxes(1), ["b0"], 0.4 * P, 0.6 * P);
	assert.deepEqual(frameOf(moved.nodes[0]), box(0, 1, 40, 40));
});

test("setFrame and setFrames enforce the minimum size", () => {
	const one = setFrame(withBoxes(1), "b0", box(0, 0, 0, 0));
	assert.ok(frameOf(one.nodes[0]).width >= MIN_NODE_SIZE);

	const many = setFrames(withBoxes(2), new Map([["b1", box(9, 9, 11, 12)]]));
	assert.deepEqual(frameOf(many.nodes[1]), box(9, 9, 11, 12));
	assert.deepEqual(frameOf(many.nodes[0]), box(0, 0, 40, 40));
});

test("setProp replaces the whole list of alternatives", () => {
	let scene = withBoxes(1);
	scene = setProp(scene, ["b0"], "fill", [ref("accent")]);
	assert.deepEqual(scene.nodes[0].props.fill, [{ kind: "token", token: "accent" }]);

	scene = setProp(scene, ["b0"], "fill", [lit("#ff0000"), lit("#00ff00")]);
	assert.equal(scene.nodes[0].props.fill?.length, 2);

	scene = setProp(scene, ["b0"], "fill", undefined);
	assert.equal(scene.nodes[0].props.fill, undefined);
});

test("a linked property follows its token, a literal does not", () => {
	let scene = withBoxes(1);
	scene = setProp(scene, ["b0"], "fill", [ref("accent")]);
	const key = propVar("b0", "fill");
	const ctx = (picks: Record<string, number>) => ({ tokens: scene.tokens, picks });

	// The starter accent has one value, so it resolves the same either way.
	assert.equal(resolveValue(ctx({}), scene.nodes[0].props.fill, key), "#3b82f6");

	const withLiteral = setProp(scene, ["b0"], "fill", single("#123456"));
	assert.equal(
		resolveValue(
			{ tokens: withLiteral.tokens, picks: {} },
			withLiteral.nodes[0].props.fill,
			key,
		),
		"#123456",
	);
});

test("setText and renameNode", () => {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode("text", { x: 0, y: 0, width: 80, height: 20 }, { id: "t" }),
	);
	scene = setText(scene, "t", "Hello");
	assert.deepEqual(scene.nodes[0].props.text, [{ kind: "literal", value: "Hello" }]);
	scene = renameNode(scene, "t", "  Heading  ");
	assert.equal(scene.nodes[0].name, "Heading");
	// A blank name is rejected rather than leaving an unlabelled layer.
	scene = renameNode(scene, "t", "   ");
	assert.equal(scene.nodes[0].name, "Heading");
});

test("reorder to front and back", () => {
	const scene = withBoxes(4);
	assert.deepEqual(ids(reorderNodes(scene, ["b0"], "front")), ["b1", "b2", "b3", "b0"]);
	assert.deepEqual(ids(reorderNodes(scene, ["b3"], "back")), ["b3", "b0", "b1", "b2"]);
	// A multi-selection keeps its relative order.
	assert.deepEqual(
		ids(reorderNodes(scene, ["b0", "b1"], "front")),
		["b2", "b3", "b0", "b1"],
	);
});

test("reorder one step at a time", () => {
	const scene = withBoxes(4);
	assert.deepEqual(ids(reorderNodes(scene, ["b1"], "forward")), ["b0", "b2", "b1", "b3"]);
	assert.deepEqual(ids(reorderNodes(scene, ["b1"], "backward")), ["b1", "b0", "b2", "b3"]);
	// Already at the edge: nothing moves, and nothing is lost.
	assert.deepEqual(ids(reorderNodes(scene, ["b3"], "forward")), ["b0", "b1", "b2", "b3"]);
	assert.deepEqual(ids(reorderNodes(scene, ["b0"], "backward")), ["b0", "b1", "b2", "b3"]);
});

test("duplicate offsets the copies and reports their ids", () => {
	const scene = withBoxes(2);
	const { scene: next, ids: created } = duplicateNodes(
		scene,
		["b0"],
		DUPLICATE_OFFSET,
	);

	assert.equal(next.nodes.length, 3);
	assert.equal(created.length, 1);
	// The copy lands directly above its original, the way every editor does.
	assert.deepEqual(ids(next), ["b0", created[0], "b1"]);

	const byId = (s: Scene, id: string) => s.nodes.find((n) => n.id === id);
	const copy = byId(next, created[0]);
	assert.ok(copy);
	assert.deepEqual(frameOf(copy), box(16, 16, 40, 40));
	assert.notEqual(created[0], "b0");

	// The copy is independent of the original.
	const edited = setProp(next, [created[0]], "fill", single("#000000"));
	assert.notDeepEqual(
		byId(edited, "b0")?.props.fill,
		byId(edited, created[0])?.props.fill,
	);
});

test("edits never mutate the input scene", () => {
	const scene = withBoxes(2);
	const snapshot = JSON.stringify(scene);
	moveNodes(scene, ["b0"], 10 * P, 10 * P);
	deleteNodes(scene, ["b0"]);
	setProp(scene, ["b0"], "fill", single("#fff"));
	reorderNodes(scene, ["b0"], "front");
	duplicateNodes(scene, ["b0"]);
	assert.equal(JSON.stringify(scene), snapshot, "undo relies on immutability");
});

/* ------------------------------------------------------------------ */
/* State machines                                                      */
/* ------------------------------------------------------------------ */

/**
 * A button definition with a label in it, one use of it, and an unrelated box
 * standing beside the pair.
 *
 * The unrelated box is the whole of what makes the pruning test mean anything:
 * the regression these edits exist to prevent is a cross-state rule vanishing
 * because somebody deleted a rectangle at the other end of the canvas, and a
 * document with nothing else in it could not have caught it.
 */
function withButton(): { scene: Scene; instance: string } {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode("frame", box(0, 0, 120, 40), { id: "btn", name: "Button" }),
	);
	scene = addNodeTo(
		scene,
		"btn",
		makeNode("text", box(10, 10, 100, 20), { id: "label", name: "Label" }),
	);
	scene = addNode(scene, makeNode("rect", box(400, 0, 40, 40), { id: "spare", name: "Spare" }));
	scene = defineComponent(scene, "btn");
	const placed = addInstance(scene, "btn");
	return { scene: placed.scene, instance: placed.id };
}

/** One node out of a document, wherever in the tree it is. */
const node = (scene: Scene, id: string) => flatten(scene.nodes).find((n) => n.id === id);

/** The machine this document holds exactly one of, for a test to read fields off. */
const only = (scene: Scene) => scene.machines[0];

test("a fresh machine is the component's rest state and nothing else", () => {
	const { scene } = withButton();
	const added = addMachine(scene, "btn");
	const machine = only(added.scene);

	assert.equal(machine.id, added.id);
	assert.equal(machine.root, "btn");
	assert.deepEqual(
		machine.states.map((s) => s.id),
		["rest"],
	);
	// The empty delta is the point rather than a placeholder: `stateTouches`
	// reads it as saying nothing, so the analysis materialises no part and the
	// program gains not one state copy. A document that has just gained a machine
	// grounds to exactly what it grounded to a moment ago.
	assert.deepEqual(machine.states[0].parts, {});
	assert.deepEqual(machine.transitions, []);
	// And the id is spellable as an ASP constant, or `normalizeScene` would drop
	// the machine the next time the document was read back — a loss with no error
	// and nowhere to look.
	assert.equal(wordOf(machine.id), machine.id);
});

test("a machine is refused where there is no definition, and never doubled", () => {
	const { scene } = withButton();
	// A rectangle is not a component, and a machine on one is a mistake at the
	// moment it is made rather than a record worth repairing.
	assert.equal(addMachine(scene, "spare").scene, scene);
	assert.equal(addMachine(scene, "nobody").scene, scene);

	const first = addMachine(scene, "btn");
	const second = addMachine(first.scene, "btn");
	// The existing one comes back rather than a second record: `machineForRoot`
	// takes the first, and every reader in the tool follows it, so a second
	// machine on one definition would be a behaviour nothing reads.
	assert.equal(second.scene, first.scene);
	assert.equal(second.id, first.id);
});

test("a state's id is derived from its name, and a rename never touches it", () => {
	const { scene } = withButton();
	const withMachine = addMachine(scene, "btn").scene;
	const m = only(withMachine).id;

	const hover = addState(withMachine, m, "Hover");
	assert.equal(hover.id, "hover");
	// Two words are camel case, which is the spelling `spaceBetween` and
	// `easeInOut` already use — one house spelling for a multi-word constant.
	const pressed = addState(hover.scene, m, "Pressed Down");
	assert.equal(pressed.id, "pressedDown");
	// A name with nothing constant-shaped in it still gets a usable id.
	const emoji = addState(pressed.scene, m, "✨");
	assert.equal(emoji.id, "state");

	// Renaming moves what a person reads and leaves every term where it was: the
	// id is inside `stt(I,S,N)`, inside every `sprop` key a pin refers to, and
	// inside the `data-state` an exported page switches on.
	const renamed = renameState(emoji.scene, m, "hover", "Pointer over");
	const state = only(renamed).states.find((s) => s.id === "hover");
	assert.equal(state?.name, "Pointer over");
	assert.deepEqual(
		only(renamed).states.map((s) => s.id),
		["rest", "hover", "pressedDown", "state"],
	);
});

test("deleting a state promotes the next, takes its edges, and stops at the last", () => {
	const { scene } = withButton();
	let doc = addMachine(scene, "btn").scene;
	const m = only(doc).id;
	doc = addState(doc, m, "Hover").scene;
	doc = addTransition(doc, m, "rest", "hover", "pointerenter").scene;
	doc = addTransition(doc, m, "hover", "rest", "pointerleave").scene;
	// One edge with nothing to do with the deletion, to prove the sweep is not a
	// clearance.
	doc = addTransition(doc, m, "hover", "hover", "click").scene;

	const gone = deleteState(doc, m, "rest");
	assert.deepEqual(
		only(gone).states.map((s) => s.id),
		["hover"],
	);
	// The order *is* the answer, so the promotion needs no arranging: whatever is
	// first is initial.
	assert.equal(only(gone).states[0].id, "hover");
	// Both edges that had an end in `rest` go with it. An edge this edit orphaned
	// is not a mistake the designer made, so reporting it through `mdangling/2`
	// would be putting a violation in the panel nobody wrote.
	assert.deepEqual(
		only(gone).transitions.map((t) => t.id),
		["click"],
	);

	// And the last state stays: `initialState` is `states[0]`, so a machine with
	// none has nothing to draw an instance in and `normalizeScene` drops the whole
	// record. Somebody who wants the machine gone deletes the machine.
	assert.equal(deleteState(gone, m, "hover"), gone);
});

test("reordering to the front changes which state is initial and nothing else", () => {
	const { scene } = withButton();
	let doc = addMachine(scene, "btn").scene;
	const m = only(doc).id;
	doc = addState(doc, m, "Hover").scene;
	doc = setStateProp(doc, m, "hover", "label", "fill", single("#f00"));
	doc = addTransition(doc, m, "rest", "hover", "pointerenter").scene;

	const moved = reorderState(doc, m, "hover", 0);
	assert.deepEqual(
		only(moved).states.map((s) => s.id),
		["hover", "rest"],
	);
	assert.deepEqual(only(moved).states[0].parts, only(doc).states[1].parts);
	assert.deepEqual(only(moved).transitions, only(doc).transitions);
	// Past the end is the end, because this is a drag.
	assert.deepEqual(
		only(reorderState(doc, m, "rest", 99)).states.map((s) => s.id),
		["hover", "rest"],
	);
});

test("a delta that says nothing leaves no entry saying it", () => {
	const { scene } = withButton();
	let doc = addMachine(scene, "btn").scene;
	const m = only(doc).id;
	doc = addState(doc, m, "Hover").scene;

	const written = setStateProp(doc, m, "hover", "label", "fill", single("#f00"));
	const hover = (s: Scene) => only(s).states[1];
	assert.deepEqual(hover(written).parts.label.props?.fill, single("#f00"));

	// Clearing the last field takes the entry with it. "This state changes
	// nothing about this part" has one spelling — no entry — and an entry holding
	// `{ props: {} }` would be a second, which a panel headed "what this state
	// changes" would list a part under.
	const cleared = setStateProp(written, m, "hover", "label", "fill", undefined);
	assert.deepEqual(cleared.machines[0].states[1].parts, {});

	// The frame and the hidden flag are the same rule with no case of their own.
	const moved = setStateFrame(doc, m, "hover", "label", "y", single("20px"));
	assert.equal(Object.hasOwn(hover(moved).parts, "label"), true);
	assert.deepEqual(
		setStateFrame(moved, m, "hover", "label", "y", undefined).machines[0].states[1].parts,
		{},
	);
	const hidden = setStateHidden(doc, m, "hover", "label", true);
	assert.equal(hover(hidden).parts.label.hidden, true);
	assert.deepEqual(
		setStateHidden(hidden, m, "hover", "label", false).machines[0].states[1].parts,
		{},
	);

	// And the whole entry goes in one gesture, which is the same claim said once.
	const both = setStateFrame(written, m, "hover", "label", "y", single("20px"));
	assert.deepEqual(clearStatePart(both, m, "hover", "label").machines[0].states[1].parts, {});
});

test("a transition is named for the move, and its ends are not repaired", () => {
	const { scene } = withButton();
	let doc = addMachine(scene, "btn").scene;
	const m = only(doc).id;
	doc = addState(doc, m, "Hover").scene;

	const enter = addTransition(doc, m, "rest", "hover", "pointerenter");
	assert.equal(enter.id, "enter");
	const press = addTransition(enter.scene, m, "rest", "hover", "pointerdown");
	// The id is the only word anybody reads an edge by — `motionLabel` capitalises
	// it into "Press · Duration" on a motion row — so it is a verb rather than the
	// name of the input device.
	assert.equal(press.id, "press");
	const again = addTransition(press.scene, m, "hover", "rest", "pointerdown");
	assert.equal(again.id, "press2");

	// Nothing about the pacing is written down. An unpaced edge falls to
	// `mdefdur/1`, so a designer who wants the whole document a little slower
	// changes one number instead of N.
	const edge = only(enter.scene).transitions[0];
	assert.equal(edge.duration, undefined);
	assert.equal(edge.easing, undefined);
	assert.equal(edge.enabled, true);

	// An end naming a state the machine has not got is *kept*. It is the one
	// broken thing this document is built to report, `mdangling/2` derives it, and
	// an edit that refused to make one would take away the symptom too.
	const dangling = addTransition(doc, m, "rest", "pressed", "click");
	assert.equal(only(dangling.scene).transitions[0].to, "pressed");
	// An end that could never be a state id is refused, because
	// `mto(m1,t1,Not A State)` is a syntax error rather than a mistake.
	assert.equal(addTransition(doc, m, "rest", "Not A State", "click").scene, doc);
});

test("a transition is patched in one call, and never re-identified", () => {
	const { scene } = withButton();
	let doc = addMachine(scene, "btn").scene;
	const m = only(doc).id;
	doc = addState(doc, m, "Hover").scene;
	doc = addTransition(doc, m, "rest", "hover", "pointerenter").scene;

	const paced = updateTransition(doc, m, "enter", {
		duration: single("120ms"),
		easing: "linear",
		enabled: false,
	});
	const edge = only(paced).transitions[0];
	assert.deepEqual(edge.duration, single("120ms"));
	assert.equal(edge.easing, "linear");
	assert.equal(edge.enabled, false);
	assert.equal(edge.id, "enter");

	// A patch that would produce a term nothing can hold is refused whole, the
	// same three checks `normalizeTransitions` makes in the only other place a
	// transition gets written.
	assert.equal(updateTransition(doc, m, "enter", { to: "Not A State" }), doc);
	assert.equal(
		updateTransition(doc, m, "enter", { trigger: "wiggle" as Trigger }),
		doc,
	);

	assert.deepEqual(only(deleteTransition(paced, m, "enter")).transitions, []);
});

test("setNodeState is read on an instance and nowhere else", () => {
	const { scene, instance } = withButton();
	let doc = addMachine(scene, "btn").scene;
	const m = only(doc).id;
	doc = addState(doc, m, "Hover").scene;

	const drawn = setNodeState(doc, instance, "hover");
	assert.equal(node(drawn, instance)?.state, "hover");
	assert.equal(node(setNodeState(drawn, instance, null), instance)?.state, undefined);

	// A definition on the canvas is always its rest state: its parts' frames are
	// facts every instance inherits, and a fact cannot be un-said by a rule, so
	// drawing the definition in another state would move the component itself for
	// everyone.
	assert.equal(setNodeState(doc, "btn", "hover"), doc);
	assert.equal(setNodeState(doc, "spare", "hover"), doc);

	// The state is not checked against the machine. `shownState` falls back to
	// the initial one, so deleting a state and undoing puts every instance back
	// where it was rather than back at the start.
	const orphaned = deleteState(drawn, m, "hover");
	assert.equal(node(orphaned, instance)?.state, "hover");
});

test("a cross-state rule survives an unrelated deletion and goes with its instance", () => {
	const { scene, instance } = withButton();
	let doc = addMachine(scene, "btn").scene;
	const m = only(doc).id;
	doc = addState(doc, m, "Hover").scene;
	doc = setStateFrame(doc, m, "hover", "label", "y", single("20px"));

	// "The label does not jump when you hover" — an ordinary align with two
	// unusual members.
	const member = (state: string) => statePart(instance, state, "label");
	const added = addConstraint(
		doc,
		"align",
		[member("rest"), member("hover")],
		undefined,
		"centerY",
	);
	doc = added.scene;

	// The regression this whole clause exists to prevent: `alive` is the set of
	// document node ids, a state copy is not one, and without `holdsStateCopy`
	// deleting a rectangle at the other end of the canvas would strip both members
	// and then delete the rule for falling below `minNodes`.
	const afterSpare = deleteNodes(doc, ["spare"]);
	const survived = afterSpare.constraints.find((c) => c.id === added.id);
	assert.deepEqual(survived?.nodes, [member("rest"), member("hover")]);

	// It is blunt on purpose: clearing the delta stops the part being materialised
	// and the member currently names no copy, but the rule stays, because getting
	// it back should mean retyping the delta rather than the rule.
	const unmaterialised = deleteNodes(
		clearStatePart(doc, m, "hover", "label"),
		["spare"],
	);
	assert.equal(
		unmaterialised.constraints.find((c) => c.id === added.id)?.nodes.length,
		2,
	);

	// And it goes when the thing it is about goes.
	assert.equal(
		deleteNodes(doc, [instance]).constraints.some((c) => c.id === added.id),
		false,
	);

	// The same clause, one spelling over. An instance *part* is not a document
	// node either, and a rule naming one used to be stripped and then deleted by
	// the next unrelated delete — a hole older than machines that nothing hit,
	// because nothing offered such a member. States offer it now: the analysis
	// treats `label`, `inst(b1,label)` and `stt(b1,hover,label)` as three ways of
	// handing the same part to simplex, so all three have to survive the same
	// deletes.
	const part = `inst(${instance},label)`;
	const pinned = addConstraint(doc, "align", [part, instance], undefined, "left");
	assert.deepEqual(
		deleteNodes(pinned.scene, ["spare"]).constraints.find((c) => c.id === pinned.id)
			?.nodes,
		[part, instance],
	);
	// Held because the instance and the part are both in the document; not held
	// once the instance goes, at which point the member names nothing at all.
	assert.equal(
		deleteNodes(pinned.scene, [instance]).constraints.some((c) => c.id === pinned.id),
		false,
	);
});

test("a released definition keeps its machine; a deleted one does not", () => {
	const { scene } = withButton();
	let doc = addMachine(scene, "btn").scene;
	const m = only(doc).id;
	doc = addState(doc, m, "Hover").scene;
	doc = setStateProp(doc, m, "hover", "label", "fill", single("#f00"));

	// Released is repairable, and two panels are built to say so — the inspector
	// offers "mark that subtree as a component again and they come back". Dropping
	// the machine here would take away every state and every delta on the strength
	// of a click that a second click undoes, and would make that sentence a lie.
	const released = pruneMachines(releaseComponent(doc, "btn"));
	assert.equal(released.machines.length, 1);
	assert.deepEqual(only(released).states[1].parts.label.props?.fill, single("#f00"));

	// Deleted is different in kind: there is no subtree to mark again, and the
	// record left behind names nothing at all.
	assert.deepEqual(deleteNodes(doc, ["btn"]).machines, []);
});

test("every machine edit returns the same scene when nothing changed", () => {
	const { scene, instance } = withButton();
	let doc = addMachine(scene, "btn").scene;
	const m = only(doc).id;
	doc = addState(doc, m, "Hover").scene;
	doc = addTransition(doc, m, "rest", "hover", "pointerenter").scene;

	// The house rule the rest of this file keeps, asserted across the whole
	// section at once: undo is a stack of documents and React's memos are
	// identity comparisons, so an edit that changed nothing must not mint a new
	// object for either of them to think it did.
	assert.equal(deleteMachine(doc, "nobody"), doc);
	assert.equal(renameMachine(doc, m, only(doc).name), doc);
	assert.equal(renameMachine(doc, m, "   "), doc);
	assert.equal(addState(doc, "nobody").scene, doc);
	assert.equal(renameState(doc, m, "hover", "Hover"), doc);
	assert.equal(renameState(doc, m, "nobody", "X"), doc);
	assert.equal(deleteState(doc, m, "nobody"), doc);
	assert.equal(reorderState(doc, m, "hover", 1), doc);
	assert.equal(setStateProp(doc, m, "hover", "label", "fill", undefined), doc);
	assert.equal(setStateFrame(doc, m, "hover", "label", "y", undefined), doc);
	assert.equal(setStateHidden(doc, m, "hover", "label", false), doc);
	assert.equal(clearStatePart(doc, m, "hover", "label"), doc);
	assert.equal(addTransition(doc, "nobody", "rest", "hover", "click").scene, doc);
	assert.equal(updateTransition(doc, m, "nobody", { enabled: false }), doc);
	assert.equal(updateTransition(doc, m, "enter", { enabled: true }), doc);
	assert.equal(deleteTransition(doc, m, "nobody"), doc);
	assert.equal(setNodeState(doc, instance, null), doc);
	assert.equal(pruneMachines(doc), doc);
});

/* ------------------------------------------------------------------ */
/* Three dimensions                                                    */
/* ------------------------------------------------------------------ */

/** Every node of a kind, wherever in the tree it is. */
const ofKind = (scene: Scene, kind: string) =>
	flatten(scene.nodes).filter((n) => n.kind === kind);

/** The one node of a kind this document holds, for a test to read fields off. */
const oneOf = (scene: Scene, kind: string) => ofKind(scene, kind)[0];

/** A document with one 3D view in it, and the two nodes it arrived with. */
function withView(): { scene: Scene; view: string } {
	const scene = addViewport({ ...emptyScene(), nodes: [] }, null, box(0, 0, 400, 300));
	return { scene, view: oneOf(scene, "viewport").id };
}

test("a viewport arrives able to show something, in ordinary nodes", () => {
	const { scene } = withView();
	const node = oneOf(scene, "viewport");

	// Two and not none. An empty machine still draws the component and an empty
	// style still leaves the nodes painted; a viewport with no camera and no
	// light is a black rectangle, and every question a person then asks is a
	// question about the tool rather than about the design.
	assert.deepEqual(
		(node.children ?? []).map((n) => n.kind),
		["camera", "light"],
	);
	const camera = oneOf(scene, "camera");
	assert.equal(node.camera, camera.id);

	// They are in the layer list like everything else — invariant 2, asserted
	// rather than read. `flatten` is what the layer strip, the selection and the
	// compiler all walk.
	const ids = flatten(scene.nodes).map((n) => n.id);
	assert.ok(ids.includes(camera.id));
	assert.ok(ids.includes(oneOf(scene, "light").id));

	// The camera is one viewport-height back on the near side and looks down the
	// axis: -z is toward the viewer, and 50° of field of view frames about one
	// viewport height at the origin plane, which is where `addMesh` puts a solid.
	assert.deepEqual(camera.spatial?.z, single("-300px"));
	// Its centre is the middle of the view, not its origin: a camera has no size,
	// `makeNode` stores the minimum so the pointer can grab it, and everything
	// that draws or measures one reads its centre.
	assert.equal(frameOf(camera).x + frameOf(camera).width / 2, 200 * P);
});

test("a mesh, a camera and a light go into a view's own space", () => {
	const { scene, view } = withView();

	// The middle of the view's origin plane, in the view's own coordinates — not
	// canvas ones. `addNodeTo` converts a pointer's canvas position; there is no
	// pointer here, and rebasing a number that was already local would put the
	// mesh an artboard's width away from the view it was added to.
	const withMesh = addMesh(scene, view, "sphere");
	const mesh = oneOf(withMesh, "mesh");
	const at = frameOf(mesh);
	assert.equal(at.x + at.width / 2, 200 * P);
	assert.equal(at.y + at.height / 2, 150 * P);
	// A cube rather than a card: `plane` is one of the six primitives and a solid
	// that arrived flat would be indistinguishable from one. `z` stays absent,
	// which reads as zero — two spellings of "flat" is the one thing the third
	// axis was designed not to have.
	assert.deepEqual(mesh.spatial?.depth, single("100px"));
	assert.equal(mesh.spatial?.z, undefined);
	// The primitive is a Value on a property, not a field, so `[box, sphere]` is
	// a design question with two answers rather than a variation outside the
	// multiverse.
	assert.deepEqual(mesh.props?.solid, single("sphere"));
	// An unknown word is kept rather than repaired; only an empty one falls back.
	assert.deepEqual(oneOf(addMesh(scene, view, "tessellate"), "mesh").props?.solid, single("tessellate"));
	assert.deepEqual(oneOf(addMesh(scene, view, "  "), "mesh").props?.solid, single("box"));

	// The second camera does not overrule the first. The first camera somebody
	// adds is obviously the one to look through and the third obviously is not.
	const two = addCamera(withMesh, view);
	assert.equal(ofKind(two, "camera").length, 2);
	assert.equal(node(two, view)?.camera, oneOf(scene, "camera").id);

	const lit = addLight(two, view, "directional");
	assert.deepEqual(ofKind(lit, "light")[1].props?.lamp, single("directional"));

	// And nothing at all happens where the target is not a view: adding is *into*
	// a view, and putting a mesh further down the tree is `reparent`.
	assert.equal(addMesh(scene, "nobody", "box"), scene);
	assert.equal(addCamera(scene, oneOf(scene, "camera").id), scene);
	assert.equal(addLight(scene, "nobody", "point"), scene);
});

test("which camera a view looks through is checked, and null takes the field away", () => {
	const { scene, view } = withView();
	const camera = oneOf(scene, "camera");
	const light = oneOf(scene, "light");

	// A view that named a rectangle, or a camera belonging to the view next to
	// it, would be a view whose picture the document and the renderer disagree
	// about — `vcam/2`'s own three conditions.
	assert.equal(setViewportCamera(scene, view, light.id), scene);
	assert.equal(setViewportCamera(scene, view, "nobody"), scene);
	const other = addViewport(scene, null, box(500, 0, 200, 200));
	const elsewhere = ofKind(other, "camera")[1];
	assert.equal(
		node(setViewportCamera(other, view, elsewhere.id), view)?.camera,
		camera.id,
	);

	// `null` removes the field rather than writing an empty string: the two
	// behave alike in the program and differ everywhere a person looks.
	const blind = setViewportCamera(scene, view, null);
	assert.equal(Object.hasOwn(node(blind, view) as object, "camera"), false);
	assert.equal(setViewportCamera(blind, view, null), blind);
});

test("a transform is written on every kind, and 'flat' keeps one spelling", () => {
	const scene = withBoxes(1);

	// Offered on every kind, and that is the invariant rather than an oversight:
	// a rect with a z and a rotateY on a plain artboard is what the CSS-3D half
	// of the export is for. The document decides what is in the third axis, not
	// the kind.
	let doc = setSpatialValue(scene, "b0", "z", single("40px"));
	doc = setTurnValue(doc, "b0", "rotateY", single("22.5deg"));
	assert.deepEqual(node(doc, "b0")?.spatial, { z: single("40px") });
	assert.deepEqual(node(doc, "b0")?.turn, { rotateY: single("22.5deg") });

	// The record goes with its last entry, so a viewport-free file does not enter
	// three dimensions because somebody lifted a rectangle and put it back.
	const flat = clearTurn(clearSpatial(doc, "b0", "z"), "b0", "rotateY");
	assert.equal(Object.hasOwn(node(flat, "b0") as object, "spatial"), false);
	assert.equal(Object.hasOwn(node(flat, "b0") as object, "turn"), false);
	// An empty Value is the same gesture, so "this node says nothing about z"
	// keeps having one spelling however a panel arrived at it.
	assert.deepEqual(setSpatialValue(doc, "b0", "z", []), clearSpatial(doc, "b0", "z"));
});

test("a pivot takes its children's middle without moving any of them", () => {
	const { scene, view } = withView();
	let doc = addMesh(scene, view, "box");
	const first = oneOf(doc, "mesh").id;
	doc = setFrame(doc, first, box(0, 0, 100, 100));
	doc = addMesh(doc, view, "sphere");
	const second = ofKind(doc, "mesh")[1].id;
	doc = setFrame(doc, second, box(100, 100, 100, 100));

	const before = { x: frameOf(node(doc, first) as SceneNode).x, y: frameOf(node(doc, first) as SceneNode).y };
	const grouped = addPivot(doc, view, [first, second]);
	const pivot = oneOf(grouped, "pivot");
	assert.deepEqual(
		(pivot.children ?? []).map((n) => n.id),
		[first, second],
	);
	// A pivot rather than a group: a group re-fits to its children's 2D bounding
	// box, and inside a view that is exactly the trigonometry a linear solver
	// cannot do.
	assert.equal(pivot.kind, "pivot");

	// The picture is identical, which is what the rebase is for. The pivot's own
	// origin is read back off the node rather than recomputed, because `makeNode`
	// quantizes and half a pixel of drift per axis is still drift.
	const origin = frameOf(pivot);
	const child = (pivot.children ?? [])[0];
	assert.equal(frameOf(child).x, before.x - origin.x);
	assert.equal(frameOf(child).y, before.y - origin.y);
	// Both solids are 100px deep and neither states a z, so the middle of the
	// third axis is 50px and each child is pushed back by it.
	assert.deepEqual(child.spatial?.z, single("-50px"));

	// A child whose x is a link cannot be rebased — `withFrame` will not overwrite
	// a token's decision — so the whole edit is refused rather than moving it by
	// the pivot's offset. The panel greys the button and says why.
	const token = addToken(doc, "length", single("8px"));
	const linked = setFrameValue(token.scene, [first], "x", [ref(token.id)]);
	assert.equal(addPivot(linked, view, [first, second]), linked);

	assert.equal(addPivot(doc, view, []), doc);
	assert.equal(addPivot(doc, "nobody", [first]), doc);
});

test("a 3D node needs no pruning clause, and an unused asset is dropped", () => {
	const { scene, view } = withView();
	let doc = addMesh(scene, view, "box");
	const mesh = oneOf(doc, "mesh").id;

	// The claim the whole invariant rests on, asserted rather than assumed: a
	// mesh is `node/1` with a `kind/2`, so it is in `alive`, so `pruneConstraints`
	// had to learn nothing about the third axis. "Nothing had to change" is a
	// claim like any other.
	const rule = addConstraint(doc, "align", [mesh, view], undefined, "left");
	doc = rule.scene;
	const spare = addNode(doc, makeNode("rect", box(900, 0, 40, 40), { id: "spare2" }));
	assert.deepEqual(
		deleteNodes(spare, ["spare2"]).constraints.find((c) => c.id === rule.id)?.nodes,
		[mesh, view],
	);
	// And it goes when the thing it is about goes, by the ordinary path.
	assert.equal(
		deleteNodes(doc, [mesh]).constraints.some((c) => c.id === rule.id),
		false,
	);

	// The asset index is a cache of what the document references. Unreferenced
	// entries are kept on *read* — a paste may be about to name one — and dropped
	// on an *edit*, because by then somebody who was looking at the document has
	// changed it. Undo is a stack of documents, so the entry comes back with the
	// model it belonged to.
	const ref3d: MeshRef = {
		asset: "sha-1",
		format: "gltf",
		bounds: { x: 0, y: 0, width: 200 * P, height: 100 * P, z: 0, depth: 50 * P },
		triangles: 1200,
	};
	const imported = addModel(scene, view, ref3d, {
		format: "gltf",
		bytes: 4096,
		triangles: 1200,
		name: "Chair",
	});
	const model = oneOf(imported, "model");
	assert.equal(model.mesh?.asset, "sha-1");
	// The model's box is the model's own bounds, so an import arrives at the size
	// it really is rather than at a size this file invented.
	assert.equal(frameOf(model).width, 200 * P);
	assert.deepEqual(model.spatial?.depth, single("50px"));
	assert.deepEqual(Object.keys(imported.assets ?? {}), ["sha-1"]);
	assert.equal(deleteNodes(imported, [model.id]).assets, undefined);
	assert.equal(pruneAssets(imported), imported);
});

/* ------------------------------------------------------------------ */
/* The ladder: inputs, layers, timelines, blends                       */
/* ------------------------------------------------------------------ */

/** A button with a machine on it, and the machine's id. */
function withMachine(): { scene: Scene; instance: string; m: string } {
	const { scene, instance } = withButton();
	const added = addMachine(scene, "btn");
	return { scene: added.scene, instance, m: added.id };
}

/** The machine, after an edit, for a test to read fields off. */
const machineOf = (scene: Scene, id: string) =>
	scene.machines.find((x) => x.id === id) as Machine;

/** The word a keyframe's time is spelled as, where it is spelled as a word. */
const litOf = (key: Keyframe): string | undefined =>
	key.at[0].kind === "literal" ? key.at[0].value : undefined;

/**
 * Every machine edit here has to survive a round trip through the reader, and
 * this is what asserts it in one line. The document an edit writes and the
 * document `normalizeScene` gives back must be the same object graph: absent and
 * empty must be spelled the same way on both sides, keyframes must already be in
 * the order the reader would put them in, and every id must be an ASP constant.
 * Anywhere the two disagree, a designer's document rearranges itself the next
 * time they open it — and the panel and the file stop agreeing in between.
 */
const survivesAread = (scene: Scene) =>
	assert.deepEqual(
		normalizeScene(JSON.parse(JSON.stringify(scene))).machines,
		scene.machines,
	);

test("an input is a runtime value, with an open range and a resting value", () => {
	const { scene, m } = withMachine();
	const added = addInput(scene, m, "number", "Open amount");

	// The id is derived from the name, because it is read in `minput(m1,openAmount)`
	// in the program panel, typed into a condition row, and handed to the runtime
	// by a host page. `x_3f2a` in all three places would be a machine nobody could
	// drive.
	assert.equal(added.id, "openAmount");
	const input = machineOf(added.scene, m).inputs?.[0];
	assert.equal(input?.name, "Open amount");
	assert.equal(input?.kind, "number");
	// Absent is *open*, not zero. A designer who has not said how far the drawer
	// opens has not said it does not open, and a `min: "0"` invented here would
	// have the checks reporting against a claim nobody made.
	assert.equal(Object.hasOwn(input as object, "min"), false);
	assert.equal(Object.hasOwn(input as object, "max"), false);

	// A trigger has no resting value: "not fired" is the absence of one.
	const fired = addInput(added.scene, m, "trigger", "Poke");
	assert.equal(
		Object.hasOwn(machineOf(fired.scene, m).inputs?.[1] as object, "initial"),
		false,
	);
	assert.equal(setInputInitial(fired.scene, m, "poke", "true"), fired.scene);

	let doc = setInputRange(fired.scene, m, "openAmount", "0", "1");
	assert.equal(machineOf(doc, m).inputs?.[0].max, "1");
	// `null` is "there is no maximum" and it is a different edit from "leave it
	// alone", which is why the two ends are two arguments rather than a patch.
	doc = setInputRange(doc, m, "openAmount", "0", null);
	assert.equal(Object.hasOwn(machineOf(doc, m).inputs?.[0] as object, "max"), false);

	// Nothing else is repaired when a kind changes, and that is the interesting
	// half: the mistake is shown, on the rows it is about, and one undo puts
	// every field back — which a repair that rewrote four comparands could not.
	const rekinded = setInputKind(doc, m, "openAmount", "boolean");
	assert.equal(machineOf(rekinded, m).inputs?.[0].initial, "0");
	assert.equal(machineOf(rekinded, m).inputs?.[0].min, "0");

	// A rename never reaches the id: it is in every `mcondin/4` the guards ground
	// and in the record a host page hands the runtime.
	const renamed = renameInput(doc, m, "openAmount", "Drawer");
	assert.equal(machineOf(renamed, m).inputs?.[0].id, "openAmount");
	assert.equal(machineOf(renamed, m).inputs?.[0].name, "Drawer");

	survivesAread(doc);
});

test("a condition is a conjunct, numbered from one, and deleting its input takes it", () => {
	const { scene, m } = withMachine();
	let doc = addState(scene, m, "Open").scene;
	doc = addTransition(doc, m, "rest", "open", "click").scene;
	doc = addInput(doc, m, "boolean", "Enabled").scene;
	doc = addInput(doc, m, "trigger", "Poke").scene;

	// A fresh row says something true and harmless — "while `enabled` is false" —
	// rather than something this file invented; a trigger takes `fired` and no
	// comparand, because "the trigger happened" is the whole of what there is to
	// say about a moment.
	doc = addCondition(doc, m, "click", "enabled");
	doc = addCondition(doc, m, "click", "poke");
	const guard = () => machineOf(doc, m).transitions[0].conditions ?? [];
	assert.deepEqual(guard()[0], { input: "enabled", op: "eq", value: "false" });
	assert.deepEqual(guard()[1], { input: "poke", op: "fired" });

	// One-based, matching what the compiler emits and therefore what a person
	// reads in a violation.
	doc = updateCondition(doc, m, "click", 1, { op: "gt", value: "0.5" });
	assert.deepEqual(guard()[0], { input: "enabled", op: "gt", value: "0.5" });
	// An operator the table has not got is a syntax error and is refused; an
	// operator the input's *kind* does not take is a mistake with a name —
	// `mcbad/3` — and is kept, so the panel can grey the row and explain.
	assert.equal(updateCondition(doc, m, "click", 1, { op: "wobble" as never }), doc);
	assert.equal(updateCondition(doc, m, "click", 0, { op: "eq" }), doc);
	assert.equal(updateCondition(doc, m, "click", 3, { op: "eq" }), doc);
	// A comparand set to nothing leaves as a key rather than as an explicit
	// `undefined`, so `Object.hasOwn` — which is what the reader asks — agrees.
	const cleared = updateCondition(doc, m, "click", 1, { value: undefined });
	assert.equal(
		Object.hasOwn(
			(machineOf(cleared, m).transitions[0].conditions ?? [])[0] as object,
			"value",
		),
		false,
	);

	// Deleting an input takes the conditions about it, because a leftover that
	// would *accuse* somebody goes and a leftover that would merely wait stays: a
	// condition with a missing input derives `mcbad/3`, a violation the designer
	// did not write and cannot read the cause of.
	const gone = deleteInput(doc, m, "enabled");
	assert.deepEqual(machineOf(gone, m).transitions[0].conditions, [
		{ input: "poke", op: "fired" },
	]);
	// And the last one going leaves no key at all, so "no guard" has one spelling.
	const bare = deleteInput(gone, m, "poke");
	assert.equal(
		Object.hasOwn(machineOf(bare, m).transitions[0] as object, "conditions"),
		false,
	);
	assert.equal(Object.hasOwn(machineOf(bare, m) as object, "inputs"), false);

	// A condition names an input; one that named nothing would be `mcbad/3` at
	// the instant it was created.
	assert.equal(addCondition(bare, m, "click"), bare);

	survivesAread(doc);
});

test("the first layer added is the one that was already there", () => {
	const { scene, m } = withMachine();
	let doc = addState(scene, m, "Hover").scene;

	// The load-bearing line in the whole rung, and it is one word long:
	// `machineLayers` rather than `machine.layers`. A machine that says nothing
	// about layers has exactly one, called `base`, and its states carry no
	// `layer`; appending to `machine.layers ?? []` would make the new layer the
	// *first* one and move every existing state onto it in one click.
	const added = addLayer(doc, m, "Glow");
	doc = added.scene;
	assert.deepEqual(
		machineOf(doc, m).layers?.map((l) => l.id),
		["base", "glow"],
	);
	assert.equal(added.id, "glow");

	doc = setStateLayer(doc, m, "hover", "glow");
	assert.equal(machineOf(doc, m).states[1].layer, "glow");
	// A state naming a layer the machine has not got is the *first* layer, so
	// deleting a layer leaves its states where they are and undo brings the layer
	// back with all of them still on it.
	const dropped = deleteLayer(doc, m, "glow");
	assert.equal(machineOf(dropped, m).states[1].layer, "glow");
	assert.deepEqual(machineOf(dropped, m).layers?.map((l) => l.id), ["base"]);

	// The order *is* the priority — `mlindex/3` numbers this list and `mfwriter/4`
	// takes the highest index that writes a property — so a glow that should sit
	// under the press goes there by being moved, with no second field to disagree.
	const moved = reorderLayer(doc, m, "glow", 0);
	assert.deepEqual(machineOf(moved, m).layers?.map((l) => l.id), ["glow", "base"]);
	assert.deepEqual(reorderLayer(doc, m, "glow", 99), doc);

	// Renaming never reaches the id: it is in `mlayer/2` and `mslayer/3`.
	assert.equal(machineOf(renameLayer(doc, m, "glow", "Halo"), m).layers?.[1].id, "glow");

	survivesAread(doc);
});

test("an instance says its first layer's state in one string, and never in two", () => {
	const { scene, instance, m } = withMachine();
	let doc = addState(scene, m, "Hover").scene;
	doc = addState(doc, m, "Lit").scene;
	doc = addLayer(doc, m, "Glow").scene;
	doc = setStateLayer(doc, m, "lit", "glow");

	// Two fields for one idea is a smell paid for on purpose — every instance
	// that exists today says its state in one string — and this is where the bill
	// comes due. Writing the *first* layer writes `state` and clears the record
	// entry, so a one-layer document goes on looking exactly like the one-layer
	// documents that already exist.
	doc = setNodeLayerState(doc, instance, "base", "hover");
	assert.equal(node(doc, instance)?.state, "hover");
	assert.equal(Object.hasOwn(node(doc, instance) as object, "states"), false);

	// Any other layer goes in the record, and the record is a record. This is a
	// regression: `withList` typechecks against `Object.entries(...)` and would
	// have written `states: [["glow","lit"]]` — a wrong picture, silently, with
	// `shownStates` finding nothing under any layer and every instance falling
	// back to the initial state.
	doc = setNodeLayerState(doc, instance, "glow", "lit");
	assert.deepEqual(node(doc, instance)?.states, { glow: "lit" });
	assert.equal(node(doc, instance)?.state, "hover");

	// Clearing the last entry takes the record away, so "this instance says
	// nothing about any other layer" has one spelling.
	const cleared = setNodeLayerState(doc, instance, "glow", null);
	assert.equal(Object.hasOwn(node(cleared, instance) as object, "states"), false);

	// Writing the first layer while the record holds an entry for it clears the
	// entry rather than leaving two spellings of one claim in one node.
	const doubled = setNodeLayerState(
		{
			...doc,
			nodes: mapTree(doc.nodes, (n) =>
				n.id === instance ? { ...n, states: { base: "lit", glow: "lit" } } : n,
			),
		},
		instance,
		"base",
		"hover",
	);
	assert.deepEqual(node(doubled, instance)?.states, { glow: "lit" });
	assert.equal(node(doubled, instance)?.state, "hover");

	// Read on an instance and nowhere else, like `setNodeState`.
	assert.equal(setNodeLayerState(doc, "btn", "glow", "lit"), doc);
	assert.equal(setNodeLayerState(doc, instance, "glow", "Not A State"), doc);
});

test("a timeline is a shape with no schedule in it", () => {
	const { scene, m } = withMachine();
	const added = addTimeline(scene, m, "Open");
	let doc = added.scene;
	assert.equal(added.id, "open");

	const timeline = () => machineOf(doc, m).timelines?.[0] as Timeline;
	assert.deepEqual(timeline().tracks, []);
	// No length and no loop. Absent is *derived* — the last keyframe's time — so
	// a fresh timeline that stored `0ms` would play nothing and would disagree
	// with its own contents the moment a key was added.
	assert.equal(Object.hasOwn(timeline() as object, "length"), false);
	assert.equal(Object.hasOwn(timeline() as object, "loop"), false);

	doc = setTimelineLength(doc, m, "open", single("400ms"));
	assert.deepEqual(timeline().length, single("400ms"));
	doc = setTimelineLoop(doc, m, "open", "pingPong");
	assert.equal(timeline().loop, "pingPong");
	// `none` takes the key away rather than storing the word: absent and "none"
	// are read alike, so a document that could hold either would diff against
	// itself.
	doc = setTimelineLoop(doc, m, "open", "none");
	assert.equal(Object.hasOwn(timeline() as object, "loop"), false);
	// And an empty Value is `null`, so "as long as its contents" has one spelling.
	doc = setTimelineLength(doc, m, "open", []);
	assert.equal(Object.hasOwn(timeline() as object, "length"), false);

	assert.equal(machineOf(renameTimeline(doc, m, "open", "Opening"), m).timelines?.[0].id, "open");
	survivesAread(doc);
});

test("a track is named by its term, and keyframes fall into time order", () => {
	const { scene, m } = withMachine();
	let doc = addTimeline(scene, m, "Open").scene;

	const added = addTrack(doc, m, "open", "label", { dim: "y" });
	doc = added.scene;
	assert.equal(added.track, trackDim("label", "y"));
	// One track per term. Two tracks with one term would be one track as far as
	// `mtrack/3`, `mkey/4` and every `kfr(…)` member are concerned, with the
	// second's keyframes reachable by nothing — so asking again hands back the
	// one that is there.
	const again = addTrack(doc, m, "open", "label", { dim: "y" });
	assert.equal(again.scene, doc);
	assert.equal(again.track, added.track);
	// A field the document does not know has no term at all, which is a syntax
	// error rather than a mistake.
	assert.equal(addTrack(doc, m, "open", "label", { prop: "wobble" as never }).track, "");
	assert.equal(addTrack(doc, m, "nobody", "label", { dim: "y" }).track, "");

	// A track over the *third* axis and over a rotation, because a line that let
	// a state lift a mesh in z while forbidding a timeline from doing it would be
	// an arbitrary line through one feature.
	doc = addTrack(doc, m, "open", "label", { dim: "z" }).scene;
	doc = addTrack(doc, m, "open", "label", { turn: "rotateY" }).scene;
	assert.equal(machineOf(doc, m).timelines?.[0].tracks.length, 3);

	const track = added.track;
	const keys = () =>
		(machineOf(doc, m).timelines?.[0].tracks.find((t) => trackTerm(t) === track) as Track)
			.keys;

	doc = addKeyframe(doc, m, "open", track, single("200ms"), single("20px"));
	doc = addKeyframe(doc, m, "open", track, single("0ms"), single("0px"));
	doc = addKeyframe(doc, m, "open", track, single("100ms"), single("40px"), "easeOut");
	// Sorted where it can be, because `orderKeys` sorts on read: an edit that
	// appended would produce a document that rearranged itself the next time
	// somebody opened it, with a rule naming `kfr(…,3)` pointing at two different
	// moments on the two sides of a save.
	assert.deepEqual(keys().map(litOf), ["0ms", "100ms", "200ms"]);
	assert.equal(keys()[1].easing, "easeOut");

	// Refused onto an occupied moment: two keys at one time collapse to the first
	// on read, so writing one would be writing a keyframe the next read deletes.
	assert.equal(addKeyframe(doc, m, "open", track, single("100ms"), single("9px")), doc);
	// Both ends are required. A key with no time or no value is not a key that
	// says something odd, it is half a segment.
	assert.equal(addKeyframe(doc, m, "open", track, [], single("1px")), doc);
	assert.equal(addKeyframe(doc, m, "open", track, single("1ms"), []), doc);
	// An easing the table has not got would reach the export as a timing function
	// no browser parses.
	assert.equal(addKeyframe(doc, m, "open", track, single("50ms"), single("1px"), "boing" as never), doc);

	// Moving a key past its neighbour really does move the indices, which is the
	// honest consequence of the drag rather than a wrinkle to hide: the reader
	// would do it on the next read anyway.
	const dragged = updateKeyframe(doc, m, "open", track, 1, { at: single("300ms") });
	assert.deepEqual(
		((machineOf(dragged, m).timelines?.[0].tracks[0] as Track).keys).map(litOf),
		["100ms", "200ms", "300ms"],
	);
	assert.equal(updateKeyframe(doc, m, "open", track, 1, { at: single("200ms") }), doc);
	assert.equal(updateKeyframe(doc, m, "open", track, 4, { value: single("1px") }), doc);

	// A track with no keys is a track being built, so emptying one is not a
	// reason to take away the row the designer is working in.
	let emptied = doc;
	for (const at of [3, 2, 1]) emptied = deleteKeyframe(emptied, m, "open", track, at);
	assert.deepEqual(
		(machineOf(emptied, m).timelines?.[0].tracks[0] as Track).keys,
		[],
	);
	assert.equal(machineOf(emptied, m).timelines?.[0].tracks.length, 3);

	// A time nothing can read leaves the order the designer typed, because "time
	// order" is then a fact about a universe rather than about the document.
	const token = addToken(doc, "duration", single("50ms"));
	const linked = addKeyframe(token.scene, m, "open", track, [ref(token.id)], single("5px"));
	assert.equal(
		((machineOf(linked, m).timelines?.[0].tracks[0] as Track).keys).length,
		4,
	);
	assert.equal(
		((machineOf(linked, m).timelines?.[0].tracks[0] as Track).keys)[3].at[0].kind,
		"token",
	);

	survivesAread(doc);
});

test("a rule about a moment survives an unrelated delete and goes with the moment", () => {
	const { scene, instance, m } = withMachine();
	let doc = addTimeline(scene, m, "Open").scene;
	const track = addTrack(doc, m, "open", "label", { dim: "y" }).track;
	doc = addTrack(doc, m, "open", "label", { dim: "y" }).scene;
	doc = addKeyframe(doc, m, "open", track, single("0ms"), single("0px"));
	doc = addKeyframe(doc, m, "open", track, single("200ms"), single("20px"));

	const member = keyCopy(instance, "open", track, 2);
	const rule = addConstraint(doc, "align", [member, instance], undefined, "left");
	doc = rule.scene;
	const held = (s: Scene) => s.constraints.find((c) => c.id === rule.id)?.nodes;

	// The regression this clause exists to prevent: `alive` is the set of
	// document node ids, a keyframe copy is not one, and without `holdsKeyCopy`
	// deleting a rectangle at the other end of the canvas would strip the member
	// and then delete the rule for falling below `minNodes`.
	assert.deepEqual(held(deleteNodes(doc, ["spare"])), [member, instance]);

	// And here the loss is worse than elsewhere, because the rule is the only
	// thing that makes the copy exist at all — `keyframeParts` is seeded from
	// `scene.constraints`. So deleting the moment takes the rule *here*, in the
	// gesture that caused it, where one undo restores both, rather than leaving
	// it to be stripped later by an unrelated edit for no visible reason.
	assert.equal(held(deleteKeyframe(doc, m, "open", track, 2)), undefined);
	assert.equal(held(deleteTrack(doc, m, "open", track)), undefined);
	assert.equal(held(deleteTimeline(doc, m, "open")), undefined);
	assert.equal(held(deleteNodes(doc, [instance])), undefined);
	// Deleting the *first* key leaves two moments minus one: the copy the rule
	// names is index 2, and there is now no index 2.
	assert.equal(held(deleteKeyframe(doc, m, "open", track, 1)), undefined);

	// The states that played it are left exactly as they were: `statePlays` finds
	// no timeline, `mtplays/3` derives nothing, and undo brings the wiring back.
	const playing = setStateTimeline(doc, m, "rest", "open");
	assert.equal(machineOf(deleteTimeline(playing, m, "open"), m).states[0].timeline, "open");
});

test("a state plays a timeline or blends several, and holding both is reported", () => {
	const { scene, m } = withMachine();
	let doc = addTimeline(scene, m, "Open").scene;
	doc = addTimeline(doc, m, "Shut").scene;
	doc = addInput(doc, m, "number", "Amount").scene;
	doc = setStateTimeline(doc, m, "rest", "open");
	assert.equal(machineOf(doc, m).states[0].timeline, "open");

	doc = setStateBlend(doc, m, "rest", { kind: "oneD", stops: [] });
	// A state holding both is "a mistake a person should see rather than one a
	// reader should quietly pick a side in" — `MachineState.blend` settles it and
	// `mtwosource/2` names the state. Clearing the timeline to tidy the document
	// would be deleting somebody's wiring on the strength of a click.
	assert.equal(machineOf(doc, m).states[0].timeline, "open");
	assert.equal(machineOf(doc, m).states[0].blend?.kind, "oneD");
	// A kind the table has not got would be a mixing rule nothing implements.
	assert.equal(setStateBlend(doc, m, "rest", { kind: "twoD" as never, stops: [] }), doc);

	doc = setBlendInput(doc, m, "rest", "amount");
	doc = addBlendStop(doc, m, "rest", "shut", "0");
	doc = addBlendStop(doc, m, "rest", "open", "1000");
	const blend = () => machineOf(doc, m).states[0].blend as Blend;
	assert.equal(blend().input, "amount");
	assert.deepEqual(blend().stops, [
		{ timeline: "shut", at: "0" },
		{ timeline: "open", at: "1000" },
	]);
	// Thresholds are plain strings kept as typed, which is `MachineInput`'s shape
	// and its argument: there is no universe in which the drawer is 40% open and
	// 60% open at once, so a `Value` here would have put a runtime reading inside
	// the multiverse. A threshold that reads as no number states nothing, and
	// `mstopout/3` says so in the panel rather than this file repairing text
	// somebody is still typing.
	doc = updateBlendStop(doc, m, "rest", 2, { at: "nonsense" });
	assert.equal(blend().stops[1].at, "nonsense");
	// `null` unplaces a stop; `undefined` leaves it alone. Two different edits,
	// and a single `undefined` would spell both.
	doc = updateBlendStop(doc, m, "rest", 2, { at: null });
	assert.equal(Object.hasOwn(blend().stops[1] as object, "at"), false);
	assert.equal(updateBlendStop(doc, m, "rest", 3, { at: "1" }), doc);

	// A blend with no stops is a blend being built, so emptying it is not a
	// reason to stop the state being one.
	let bare = deleteBlendStop(doc, m, "rest", 2);
	bare = deleteBlendStop(bare, m, "rest", 1);
	assert.deepEqual(machineOf(bare, m).states[0].blend?.stops, []);
	// And `null` takes the field away rather than writing `{ stops: [] }`.
	const plain = setStateBlend(bare, m, "rest", null);
	assert.equal(Object.hasOwn(machineOf(plain, m).states[0] as object, "blend"), false);
	// There is nothing to add a stop to on a state that is not a blend.
	assert.equal(addBlendStop(plain, m, "rest", "open", "0"), plain);
	assert.equal(setBlendInput(plain, m, "rest", "amount"), plain);

	survivesAread(doc);
});

test("every ladder and 3D edit returns the same scene when nothing changed", () => {
	const { scene, instance, m } = withMachine();
	let doc = addInput(scene, m, "boolean", "Enabled").scene;
	doc = addLayer(doc, m, "Glow").scene;
	doc = addTimeline(doc, m, "Open").scene;
	const track = addTrack(doc, m, "open", "label", { dim: "y" }).track;
	doc = addTrack(doc, m, "open", "label", { dim: "y" }).scene;
	doc = addKeyframe(doc, m, "open", track, single("0ms"), single("0px"));
	doc = setStateBlend(doc, m, "rest", { kind: "direct", stops: [] });
	const view = addViewport(doc, null, box(600, 0, 200, 200));
	const viewId = oneOf(view, "viewport").id;

	// The house rule the rest of this file keeps, asserted across two whole
	// features at once: undo is a stack of documents and React's memos are
	// identity comparisons, so an edit that changed nothing must not mint a new
	// object for either of them to think it did.
	assert.equal(addInput(doc, "nobody").scene, doc);
	assert.equal(addInput(doc, m, "wobble" as never).scene, doc);
	assert.equal(renameInput(doc, m, "enabled", "Enabled"), doc);
	assert.equal(renameInput(doc, m, "nobody", "X"), doc);
	assert.equal(setInputKind(doc, m, "enabled", "boolean"), doc);
	assert.equal(setInputKind(doc, m, "enabled", "wobble" as never), doc);
	assert.equal(setInputInitial(doc, m, "enabled", "false"), doc);
	assert.equal(setInputRange(doc, m, "enabled", null, null), doc);
	assert.equal(deleteInput(doc, m, "nobody"), doc);
	assert.equal(addCondition(doc, m, "nobody", "enabled"), doc);
	assert.equal(updateCondition(doc, m, "nobody", 1, { op: "eq" }), doc);
	assert.equal(deleteCondition(doc, m, "nobody", 1), doc);
	assert.equal(addLayer(doc, "nobody").scene, doc);
	assert.equal(renameLayer(doc, m, "glow", "Glow"), doc);
	assert.equal(renameLayer(doc, m, "nobody", "X"), doc);
	assert.equal(deleteLayer(doc, m, "nobody"), doc);
	assert.equal(reorderLayer(doc, m, "glow", 1), doc);
	assert.equal(reorderLayer(doc, m, "nobody", 0), doc);
	assert.equal(setStateLayer(doc, m, "rest", null), doc);
	assert.equal(setNodeLayerState(doc, instance, "glow", null), doc);
	assert.equal(addTimeline(doc, "nobody").scene, doc);
	assert.equal(renameTimeline(doc, m, "open", "Open"), doc);
	assert.equal(setTimelineLength(doc, m, "open", null), doc);
	assert.equal(setTimelineLoop(doc, m, "open", "none"), doc);
	assert.equal(setTimelineLoop(doc, m, "open", "spin" as never), doc);
	assert.equal(deleteTimeline(doc, m, "nobody"), doc);
	assert.equal(addTrack(doc, m, "nobody", "label", { dim: "y" }).scene, doc);
	assert.equal(deleteTrack(doc, m, "open", "trkd(nobody,y)"), doc);
	assert.equal(addKeyframe(doc, m, "open", "trkd(nobody,y)", single("1ms"), single("1px")), doc);
	assert.equal(updateKeyframe(doc, m, "open", track, 1, {}), doc);
	assert.equal(deleteKeyframe(doc, m, "open", track, 9), doc);
	assert.equal(setStateTimeline(doc, m, "rest", null), doc);
	assert.equal(setStateBlend(doc, m, "hover", null), doc);
	assert.equal(setBlendInput(doc, m, "rest", null), doc);
	assert.equal(addBlendStop(doc, m, "rest", ""), doc);
	assert.equal(updateBlendStop(doc, m, "rest", 1, { at: "0" }), doc);
	assert.equal(deleteBlendStop(doc, m, "rest", 1), doc);
	assert.equal(setViewportCamera(view, viewId, oneOf(view, "camera").id), view);
	assert.equal(setSpatialValue(view, viewId, "z", []), view);
	assert.equal(clearSpatial(view, viewId, "z"), view);
	assert.equal(clearTurn(view, viewId, "rotateX"), view);
	assert.equal(setTurnValue(view, viewId, "spin" as never, single("1deg")), view);
	assert.equal(setStateTurn(doc, m, "rest", "label", "rotateY", undefined), doc);
	assert.equal(pruneAssets(doc), doc);
});

test("ladder and 3D edits never mutate the input scene", () => {
	const { scene, m } = withMachine();
	let doc = addTimeline(scene, m, "Open").scene;
	doc = addTrack(doc, m, "open", "label", { dim: "y" }).scene;
	doc = addLayer(doc, m, "Glow").scene;
	const snapshot = JSON.stringify(doc);
	const track = trackDim("label", "y");
	addKeyframe(doc, m, "open", track, single("0ms"), single("0px"));
	deleteTimeline(doc, m, "open");
	addInput(doc, m, "number", "Amount");
	reorderLayer(doc, m, "glow", 0);
	setStateBlend(doc, m, "rest", { kind: "oneD", stops: [] });
	addViewport(doc, null, box(0, 0, 100, 100));
	assert.equal(JSON.stringify(doc), snapshot, "undo relies on immutability");
});
