import assert from "node:assert/strict";
import { test } from "node:test";

import {
	DUPLICATE_OFFSET,
	addConstraint,
	addInstance,
	addMachine,
	addNode,
	addNodeTo,
	addState,
	addTransition,
	clearStatePart,
	defineComponent,
	deleteMachine,
	deleteNodes,
	deleteState,
	deleteTransition,
	duplicateNodes,
	makeNode,
	moveNodes,
	pruneMachines,
	releaseComponent,
	renameMachine,
	renameNode,
	renameState,
	reorderNodes,
	reorderState,
	setFrame,
	setFrames,
	setNodeState,
	setProp,
	setStateFrame,
	setStateHidden,
	setStateProp,
	setText,
	updateTransition,
} from "./edits.ts";
import { type Frame, MIN_NODE_SIZE } from "./geometry.ts";
import { statePart } from "./machines.ts";
import { type Scene, type Trigger, emptyScene, frameOf } from "./scene.ts";
import { flatten } from "./tree.ts";
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
