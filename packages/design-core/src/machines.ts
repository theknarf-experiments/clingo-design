/**
 * State machines, as behaviour that is not a design space.
 *
 * This file is to `Machine` what `components.ts` is to a component definition:
 * the term scheme, the lookups, the analysis and the labels, all of it a pure
 * reading of the document or of one answer set. Nothing here compiles, solves or
 * renders.
 *
 * The one sentence the whole feature turns on, and the one this file exists to
 * keep true:
 *
 * **A machine state is never an `alt/2` alternative and never gets a `pick/2`.**
 *
 * A component is a design space and its variants *are* universes — that is the
 * claim `components.ts` opens with, and it is what makes an instance a point in
 * a space rather than a copy of a master. A machine is the other thing. Its
 * states are not alternatives the solver chooses between; they are all true at
 * once, in one answer set, side by side. A button with four states and three
 * variants is three designs each of which has four states, not twelve designs.
 * Variants × states is a matrix, and a matrix is not a cross product of
 * universes.
 *
 * The cheap encoding was a choice rule — `1 { mstate_pick(I,S) : mstate(M,S) } 1.`
 * — and it was rejected twice over. It makes the multiverse a sprite sheet: every
 * state of every machine multiplies the universe count, so adding "pressed" to a
 * button doubles the number of designs a person has to look through, for a thing
 * that is not a decision anybody is making. And it makes the interesting question
 * unaskable. "Is the label still inside the box when the button grows on hover?"
 * relates two states, and under a choice rule the two states are in two different
 * answer sets, where nothing can relate them and simplex is free to place the same
 * node in two different places in two independent solves.
 *
 * So a state is a **copy**. `stt(I,S,N)` carries `frame/3` and `rendered/3` for
 * instance `I`'s part `N` in state `S`, in the same answer set as every other
 * state, and a rule that compares two of them is an ordinary rule with an unusual
 * member. Deliberately **not a `node/1`**: `node/1` is what makes a thing
 * drawable, and a drawable copy per state would paint every state on top of every
 * other, grow the layer list by the state count and teach hit-testing a case it
 * does not need. `inst(I,N)` — the thing that draws — becomes a *view* of
 * whichever state is shown, so the canvas, the layer list, `isPartOf`,
 * `partLabel`, `derivedNodes` and both export renderers never learn that states
 * exist.
 *
 * Two consequences shape almost everything in this file:
 *
 *   - **What a state does not touch, it shares.** A property no state mentions is
 *     read by every state copy from the instance's one `prop(inst(I,N),P)`
 *     variable. Minting a copy per state would make a two-alternative fill under
 *     four states sixteen designs where the document holds two. Only a delta mints
 *     a variable, and a delta branches only where the designer wrote alternatives
 *     inside it — which is a design decision like any other and branches like any
 *     other.
 *   - **Copies cost grounding, so they are rationed.** {@link materializedParts}
 *     is the whole of that rationing and carries the longest comment here.
 *
 * The reading in this file is duplicated, on purpose, by rules in the generated
 * program: {@link machineHealth} answers the same four questions `munreached/2`,
 * `mdeadend/2`, `mnondet/3` and `mdangling/2` answer. That is not a smell to
 * factor away. The panel has to be able to grey a row while the document is
 * unsatisfiable and there is no answer set at all, and a rule has to be able to
 * say it as a `viol/1` so that it lands in an unsat core with a name a person can
 * read. Neither can do the other's job, and `machines.test.ts` is where the two
 * answers are held equal.
 */
import { parseAtom } from "./atoms.ts";
import { componentDef, instanceNodes, isInstance, parseInstancePart } from "./components.ts";
import {
	CONSTRAINT_KINDS,
	type Dimension,
	FRAME_DIMS,
	type Machine,
	type MachineState,
	MOTION_PROPS,
	type MotionProp,
	PROPS,
	type PropName,
	type Scene,
	type SceneNode,
	type Transition,
	type Trigger,
	stateTouches,
} from "./scene.ts";
import { findInTree, nodeNames, parentMap } from "./tree.ts";

/* ------------------------------------------------------------------ */
/* The term scheme                                                     */
/* ------------------------------------------------------------------ */

/**
 * How one state's copy of a definition part is named: `stt(i1,hover,label)`.
 *
 * A term rather than a string, exactly as {@link instancePart} is one, and for
 * the same two reasons: it parses back out with {@link parseAtom}, and it can
 * never collide with a document node id however a person names their nodes.
 *
 * Three arguments rather than two because the copy is per *instance*. Two
 * instances of a button may be drawn in different states at once and a rule may
 * say something about one of them, so `stt(hover,label)` — a copy per definition
 * — would be a term naming a picture that is not on the canvas.
 */
export const statePart = (
	instanceId: string,
	stateId: string,
	nodeId: string,
): string => `stt(${instanceId},${stateId},${nodeId})`;

/**
 * The inverse of {@link statePart}, for anything showing one to a human.
 *
 * The node argument may itself be a term — a copy of an instance part inside a
 * nested definition, or a generated id like `cell(1,1)` — which is why this goes
 * through {@link parseAtom} rather than splitting on commas: the parser counts
 * brackets, so a nested term stays one argument.
 */
export function parseStatePart(
	id: string,
): { instance: string; state: string; node: string } | null {
	const atom = parseAtom(id);
	if (!atom || atom.name !== "stt" || atom.args.length !== 3) return null;
	return { instance: atom.args[0], state: atom.args[1], node: atom.args[2] };
}

/**
 * One property a state overrides, as the variable it is: `sprop(I,S,N,P)`.
 *
 * Per instance and per state, because that is where the override actually is: a
 * delta belongs to the definition's machine, but the *value* it resolves to is
 * the instance's, so two instances of one button can hover to two different
 * fills exactly as they can rest at two different fills.
 *
 * Only a property some state *says something about* gets one of these. Everything
 * else is read from `prop(inst(I,N),P)`, shared by every state copy at once — see
 * the note at the top of this file, which is the whole invariant in one rule.
 */
export const statePropVar = (
	instanceId: string,
	stateId: string,
	nodeId: string,
	prop: string,
): string => `sprop(${instanceId},${stateId},${nodeId},${prop})`;

/** One dimension a state overrides: `sfval(I,S,N,D)`. The twin of {@link statePropVar}. */
export const stateFrameVar = (
	instanceId: string,
	stateId: string,
	nodeId: string,
	dim: string,
): string => `sfval(${instanceId},${stateId},${nodeId},${dim})`;

/**
 * The three keys above are deliberately absent from `parseVariable`.
 *
 * They join `spart` in the set of keys that never parse back, for the reason
 * recorded there: every caller that reads a key back is asking about something
 * the *inspector's generic rows* can act on, and three more cases none of them
 * could act on would be three cases all of them had to handle. The panels that
 * build these keys know what they are, and {@link stateVarLabel} and
 * {@link motionLabel} are how they get a human name for one.
 *
 * These two private readers are the only parsers of them, and they exist here
 * rather than in `values.ts` for exactly that reason: this is the file that knows
 * the grammar.
 */
function parseStateVar(
	variable: string,
): { instance: string; state: string; node: string; field: string; frame: boolean } | null {
	const atom = parseAtom(variable);
	if (!atom || atom.args.length !== 4) return null;
	if (atom.name !== "sprop" && atom.name !== "sfval") return null;
	return {
		instance: atom.args[0],
		state: atom.args[1],
		node: atom.args[2],
		field: atom.args[3],
		frame: atom.name === "sfval",
	};
}

function parseMotionVar(
	variable: string,
): { machine: string; transition: string; field: MotionProp } | null {
	const atom = parseAtom(variable);
	if (!atom || atom.name !== "mval" || atom.args.length !== 3) return null;
	const field = atom.args[2];
	if (!Object.hasOwn(MOTION_PROPS, field)) return null;
	return { machine: atom.args[0], transition: atom.args[1], field: field as MotionProp };
}

/* ------------------------------------------------------------------ */
/* Lookups over the document                                           */
/* ------------------------------------------------------------------ */

/** The machine with this id, if the document holds one — the twin of `findStyle`. */
export const findMachine = (
	machines: readonly Machine[],
	id: string | undefined,
): Machine | undefined =>
	id === undefined ? undefined : machines.find((m) => m.id === id);

/**
 * The machine driving this definition root, if the document holds one.
 *
 * Blunt on purpose: it asks what the machine *names*, not whether that node is
 * still a definition. A machine whose root has been released is a machine that
 * says nothing to the program — `machine_of(M,R)` joins `instance(I,R)` and finds
 * nobody — but it is still a record in the document with states, transitions and
 * a panel showing it, and answering "there is no machine here" would make the
 * panel unable to show the thing it is being asked to repair. The place that
 * *does* insist on a definition is {@link materializedParts}, which returns an
 * empty set and so mints no copies at all.
 */
export function machineForRoot(
	scene: Scene,
	rootId: string | undefined,
): Machine | undefined {
	if (rootId === undefined) return undefined;
	return scene.machines.find((m) => m.root === rootId);
}

/**
 * The machine driving this node: its definition's, if it is an instance.
 *
 * Two cases and deliberately not three. An **instance** is driven by the machine
 * of the definition it names — that is the whole of what a machine does. A
 * **definition root** is driven by the machine that names it, which is what the
 * inspector needs when the thing selected on the canvas is the component itself.
 *
 * The third case — a part *inside* a definition — answers nothing here, and the
 * omission is the argument. A delta is authored against a definition part, but
 * the panel doing the authoring already knows which machine it is showing: the
 * part is the *subject* of a row, not the thing that finds the machine. Walking
 * ancestors to guess a machine from a selected part would make a click on a
 * label inside a component silently switch which machine the panel was editing.
 */
export function machineForNode(scene: Scene, node: SceneNode): Machine | undefined {
	return isInstance(node)
		? machineForRoot(scene, node.instanceOf)
		: machineForRoot(scene, node.id);
}

export const findState = (
	machine: Machine,
	id: string | undefined,
): MachineState | undefined =>
	id === undefined ? undefined : machine.states.find((s) => s.id === id);

export const findTransition = (
	machine: Machine,
	id: string | undefined,
): Transition | undefined =>
	id === undefined ? undefined : machine.transitions.find((t) => t.id === id);

/**
 * The initial state: the first one.
 *
 * There is no `initial` flag and there is not going to be one. The order *is* the
 * answer, the same way `order/2` is the paint order and nothing carries an
 * `onTop` flag — so changing which state a machine starts in is one edit
 * (reordering) rather than two that can disagree with each other.
 *
 * `normalizeScene` drops a machine with no states, so the array is never empty on
 * a document that was read; a hand-built one can be, and the callers here that
 * would divide by that check for it rather than making every caller do so.
 */
export const initialState = (machine: Machine): MachineState => machine.states[0];

/**
 * Which state a node is drawn in: what it says, or the initial one.
 *
 * A `state` naming something the machine no longer holds falls back rather than
 * failing, exactly as a dropped hold does and for the same reason: a machine
 * edited down must leave its instances legal, not broken. Nothing is corrected on
 * the way in either — `normalizeScene` keeps the stored string — so deleting a
 * state and undoing puts every instance back where it was.
 */
export function shownState(machine: Machine, node: SceneNode): string {
	if (node.state !== undefined && findState(machine, node.state)) return node.state;
	const first = machine.states[0];
	return first ? first.id : "";
}

/** State id -> what it is called, falling back to the id. */
export const stateName = (machine: Machine, id: string): string =>
	findState(machine, id)?.name?.trim() || id;

/* ------------------------------------------------------------------ */
/* Names, for the panels and the sentences                             */
/* ------------------------------------------------------------------ */

/**
 * A word with a capital on the front, for the one thing in this feature that has
 * an id and no name: a transition.
 *
 * A {@link Transition} carries no `name` field on purpose — an edge is not a
 * thing a designer names twice, it is `press`, the constant that appears in
 * `mval(m1,press,duration)` and in every fact about it — so the only editorial
 * act available is to start it with a capital and let it read as a sentence.
 * Naming it by its ends instead ("Rest → Hover") was considered and rejected: the
 * Transitions panel's row header says exactly that, and a motion row that said it
 * a second way would describe one edge with two names.
 */
const capitalise = (word: string): string =>
	word.length === 0 ? word : word[0].toUpperCase() + word.slice(1);

/**
 * A state copy in the words a person uses: `"Label · Hover — Button 1"`.
 *
 * The third member of the family `partLabel` and `datumLabel` are in, and here
 * for the same reason both of those sit beside their own grammar: a state copy is
 * a member a rule can name and a designer cannot point at, so every sentence the
 * tool builds out of a rule's members has to be able to say it. "*Align on Label ·
 * Rest — Button 1, Label · Hover — Button 1* forces this" is an answer to why the
 * label is where it is; the raw term is only a receipt.
 *
 * Nothing for a term that is not a state copy, so a caller chains this after
 * `partLabel` and `datumLabel` and falls through to the raw id.
 *
 * The names are read as far as the document still holds them and no further: a
 * copy naming a deleted instance still reads as its term's ids, which is more use
 * than nothing while a rule is being repaired. That is `datumLabel`'s judgement,
 * and it applies here for the same reason — this term was typed into a rule by a
 * person, and the rule outlives the thing it names.
 */
export function stateLabel(scene: Scene, term: string): string | undefined {
	const parsed = parseStatePart(term);
	if (!parsed) return undefined;
	const names = nodeNames(scene.nodes);
	const node = findInTree(scene.nodes, parsed.instance);
	const machine = node ? machineForNode(scene, node) : undefined;
	const state = machine ? stateName(machine, parsed.state) : parsed.state;
	return `${names[parsed.node] ?? parsed.node} · ${state} — ${names[parsed.instance] ?? parsed.instance}`;
}

/**
 * One of a delta's variables in the same words: `"Label · Fill · Hover — Button 1"`.
 *
 * The word order is {@link stateLabel}'s with the field inserted where `varLabel`
 * puts it — part, then what about it, then the situation and whose. A dimension's
 * label is `FRAME_DIMS`' own lowercase `"x"` rather than a title-cased one,
 * because that is the word the inspector's geometry row already uses and a
 * variable should read as the row it belongs to.
 *
 * Nothing for a key whose field is not a property or a dimension. That is not
 * defensive tidiness: the panels mint these keys from a real property of a real
 * part, so a key with a field no table holds is a caller bug, and labelling it
 * confidently would hide the bug behind a sentence.
 */
export function stateVarLabel(scene: Scene, variable: string): string | undefined {
	const parsed = parseStateVar(variable);
	if (!parsed) return undefined;
	const table = parsed.frame ? FRAME_DIMS : PROPS;
	if (!Object.hasOwn(table, parsed.field)) return undefined;
	const field = parsed.frame
		? FRAME_DIMS[parsed.field as Dimension].label
		: PROPS[parsed.field as PropName].label;
	const names = nodeNames(scene.nodes);
	const node = findInTree(scene.nodes, parsed.instance);
	const machine = node ? machineForNode(scene, node) : undefined;
	const state = machine ? stateName(machine, parsed.state) : parsed.state;
	const part = names[parsed.node] ?? parsed.node;
	return `${part} · ${field} · ${state} — ${names[parsed.instance] ?? parsed.instance}`;
}

/**
 * `"Press · Duration"`, for a motion row and for a why-sentence.
 *
 * Answers nothing where the document no longer holds that machine or that
 * transition — the **opposite** of what {@link stateLabel} and `datumLabel` do,
 * and the difference is worth stating because it looks like an inconsistency.
 * A state copy or a datum is a term a *designer typed into a rule*, so it has to
 * stay readable while the rule is being repaired. A `mval` key is never typed: it
 * is minted by a panel out of a transition it is looking at, so a key that no
 * longer matches the document is a bug in the caller rather than a rule to fix,
 * and a confident label would hide it exactly where it needs to be visible.
 */
export function motionLabel(scene: Scene, variable: string): string | undefined {
	const parsed = parseMotionVar(variable);
	if (!parsed) return undefined;
	const machine = findMachine(scene.machines, parsed.machine);
	const transition = machine ? findTransition(machine, parsed.transition) : undefined;
	if (!transition) return undefined;
	return `${capitalise(transition.id)} · ${MOTION_PROPS[parsed.field].label}`;
}

/* ------------------------------------------------------------------ */
/* What a rule may name                                                */
/* ------------------------------------------------------------------ */

/**
 * Every state copy this document holds, as constraint members — the twin of
 * `datumIds`, and what the Rules panel offers beside the node ids.
 *
 * Instance by instance, state by state, part by part, and **only the materialised
 * parts**: a term for a part with no copy is a member that says nothing, and
 * offering it would be offering a rule that silently never holds. Within a
 * machine the parts come out in the definition's own document order rather than
 * in whatever order {@link materializedParts} discovered them, because this is a
 * menu a person reads and a menu should be in the order the layer list is.
 *
 * A constraint naming one of these is an ordinary constraint. `c_node/2` takes a
 * state copy exactly where it takes a node id, and `gsolved/1`, `lv/2`, `lsz/2`
 * and `ge/2` never asked for `node/1` — which is precisely what lets "the label
 * does not jump when you hover" be an `align` with a name, a switch, a place in
 * an unsat core and a `why`.
 */
export function stateCopyIds(scene: Scene): string[] {
	const out: string[] = [];
	// One analysis per machine rather than one per instance: the parts are a fact
	// about the definition, and the instances multiply them here for nothing —
	// which is the same split the program makes, where `mpart/2` is emitted once
	// and `mcopy/3` derives the instances from it.
	const cache = new Map<string, string[]>();
	for (const node of instanceNodes(scene)) {
		const machine = machineForNode(scene, node);
		if (!machine) continue;
		let parts = cache.get(machine.id);
		if (parts === undefined) {
			const materialised = materializedParts(scene, machine);
			const def = componentDef(scene, machine.root);
			parts = (def?.parts ?? [])
				.filter((part) => materialised.has(part.id))
				.map((part) => part.id);
			cache.set(machine.id, parts);
		}
		for (const state of machine.states) {
			for (const part of parts) out.push(statePart(node.id, state.id, part));
		}
	}
	return out;
}

/**
 * True when the document still holds what a state-copy term names — the question
 * `pruneConstraints` has to ask of every member that is neither a node nor a
 * datum.
 *
 * Deliberately blunter than {@link stateCopyIds}, exactly as `holdsDatum` is
 * blunter than `datumIds`: held when the instance exists and its definition's
 * machine has that state, whatever the materialisation says and whatever the
 * definition's parts are today. Asking whether the *copy* exists would delete a
 * designer's rule the moment they cleared the delta that made the part
 * materialise, and getting it back would mean retyping the rule rather than the
 * delta. A member that currently names no copy says nothing until it does again,
 * which is what an alternative in a value already means everywhere else in this
 * document.
 *
 * Without this, `pruneConstraints` would silently delete every cross-state rule
 * the next time anything called `deleteNodes`, `groupNodes`, `setGuides` or
 * `removeGuide` — because `alive` is the set of *document* node ids and a state
 * copy is not one.
 */
export function holdsStateCopy(scene: Scene, term: string): boolean {
	const parsed = parseStatePart(term);
	if (!parsed) return false;
	const node = findInTree(scene.nodes, parsed.instance);
	if (!node || !isInstance(node)) return false;
	const machine = machineForNode(scene, node);
	return machine !== undefined && findState(machine, parsed.state) !== undefined;
}

/* ------------------------------------------------------------------ */
/* The materialisation analysis                                        */
/* ------------------------------------------------------------------ */

/**
 * The definition part a constraint member names, if it names one of *these*.
 *
 * Three spellings reduce to a part id and they are tried in order, because they
 * are three ways of saying the same thing at three removes: the part itself
 * (`label`, which is what a rule written against the definition says), the
 * instance's copy of it (`inst(i1,label)`), and one state's copy of that
 * (`stt(i1,hover,label)`). All three hand the part to simplex, so all three are a
 * reason to materialise it.
 */
function definitionPartOf(parts: ReadonlySet<string>, member: string): string | undefined {
	if (parts.has(member)) return member;
	const reduced = parseInstancePart(member)?.node ?? parseStatePart(member)?.node;
	return reduced !== undefined && parts.has(reduced) ? reduced : undefined;
}

/**
 * Which definition parts need a copy per state — the analysis that keeps
 * grounding affordable, and the reason this feature is usable on a real document.
 *
 * Without it, a four-state machine on a twelve-part definition placed twenty
 * times is 960 state copies, each carrying up to four `frame/3` atoms and a whole
 * rendered set. With it, the usual button is two parts: the one the hover delta
 * touches and its root.
 *
 * All of it runs over the **definition**, once per machine, never per instance.
 * The instances multiply the answer in ASP, through
 * `mcopy(I,S,N) :- minstance(I,M), mstate(M,S), mpart(M,N)`, which costs one fact
 * per machine here and nothing per use.
 *
 * Three sources feed the set, and then it closes upward.
 *
 * **A part some state touches.** The obvious one, and the only subtlety is what
 * "touches" means: {@link stateTouches} treats `{}`, `{ props: {} }` and
 * `{ props: { fill: [] } }` as the same claim as no entry at all, because an
 * entry left behind by an edit that cleared its last property is a leftover
 * rather than a decision, and materialising a part — and minting a `sprop`
 * variable with no alternatives — on the strength of one would be answering a
 * question nobody asked.
 *
 * **A part a geometric constraint names.** Naming a node in a geometric
 * constraint is what hands it to simplex, and a node simplex places has to be
 * placeable *per state*: if only the shown state had a copy, the two states would
 * share one answer and the constraint would be a statement about neither. This is
 * the "only a `gsolved` child needs its own copy" half of the design, and it is
 * why the seed reads `c.nodes` through {@link definitionPartOf} rather than
 * looking only for bare part ids — a cross-state rule names `stt(i1,hover,label)`,
 * and that is a rule about `label`.
 *
 * **Their ancestors — upward only.** The asymmetry *is* the analysis:
 *
 *   - **Downward is free.** A frame is parent-relative, so a state that moves a
 *     container moves everything inside it with no copy for any of them. That is
 *     the whole reason {@link StatePart.frame} is specified in the part's own
 *     parent-relative coordinates rather than in world ones, and it is what makes
 *     the common case — "the whole card lifts on hover" — cost exactly one copy.
 *   - **Upward is not.** A copy's world coordinate is its parent's plus its own
 *     offset, chained through `child/2`, and the rule that gives a copy a parent
 *     is `child(inst(I,P),stt(I,S,N))`. Stopping short of the root would leave a
 *     link of that chain missing, `gworld/2` would treat the copy as a root, and
 *     simplex would place it in the instance's own coordinates rather than on the
 *     canvas — which looks like a constraint that is wrong by exactly the offset
 *     of the enclosing frame, and is the kind of bug nobody finds by reading.
 *
 * A machine whose root is not a definition materialises nothing: it says nothing
 * to the program at all, exactly as an instance of a deleted definition derives
 * nothing. So does a machine all of whose states are empty — legal, useless, and
 * free.
 */
export function materializedParts(scene: Scene, machine: Machine): Set<string> {
	const def = componentDef(scene, machine.root);
	if (!def) return new Set();

	const parts = new Set(def.parts.map((part) => part.id));
	// Parents *within the definition subtree*, so the climb terminates at the
	// definition's own root rather than walking out into the page that holds it:
	// the page is not part of the component and has no copy to be a link in.
	const parent = parentMap([def.root]);
	const out = new Set<string>();

	for (const state of machine.states) {
		for (const [nodeId, delta] of Object.entries(state.parts)) {
			if (parts.has(nodeId) && stateTouches(delta)) out.add(nodeId);
		}
	}

	for (const constraint of scene.constraints) {
		if (!constraint.enabled) continue;
		if (!CONSTRAINT_KINDS[constraint.kind].geometric) continue;
		for (const member of constraint.nodes) {
			const part = definitionPartOf(parts, member);
			if (part !== undefined) out.add(part);
		}
	}

	// Climbed once per seed, all the way to the root, with no short-circuit on an
	// ancestor already in the set. Stopping early is correct — an id in the set
	// either is a seed still to be processed or was added by a climb that carried
	// on past it — but it is correct by an argument, and this loop runs once per
	// machine over a set that is small by construction. Cheap is not worth being
	// clever about here.
	for (const seed of [...out]) {
		let up = parent.get(seed);
		while (up !== undefined) {
			out.add(up.id);
			up = parent.get(up.id);
		}
	}
	return out;
}

/* ------------------------------------------------------------------ */
/* Machine health, read off the document                               */
/* ------------------------------------------------------------------ */

export interface MachineHealth {
	/** States no chain of transitions reaches from the initial one. */
	unreachable: string[];
	/** States nothing leaves. */
	deadEnds: string[];
	/** `[state, trigger]` pairs two enabled transitions both leave on. */
	nondeterministic: Array<[state: string, trigger: Trigger]>;
	/** Transitions naming a state the machine does not have. */
	dangling: string[];
}

/**
 * The same four questions the program answers, answered here.
 *
 * Two readers, and the duplication is the point rather than a smell — see the
 * note at the top of this file. `machines.test.ts` holds the two answers equal on
 * every shape it tests, which is what keeps a greyed row in the panel and a name
 * in an unsat core saying the same thing.
 *
 * **Only enabled transitions count**, in all four answers, because only they
 * reach the program: `mtrans/2`, `mfrom/3` and `mto/3` are emitted for enabled
 * transitions and nothing else. So switching an edge off can make a state
 * unreachable or a dead end, which is exactly what a person means by switching it
 * off — a transition in the document but out of the program is a transition the
 * design does not have.
 *
 * Two details are inherited from the rules rather than chosen here, and both look
 * like oversights until you read the rule beside them. Reachability follows an
 * edge whose destination is not a state at all (`mreach/2` does not check
 * `mstate/2`), so a dangling edge is reported as dangling and not *also* as the
 * reason a real state went unreached. And a nondeterministic pair may be reported
 * on a `from` the machine has not got (`mnondet/3`'s `S` is whatever `mfrom/3`
 * says), because two edges leaving the same missing state are still two edges the
 * designer wrote and meant.
 */
export function machineHealth(machine: Machine): MachineHealth {
	const ids = new Set(machine.states.map((state) => state.id));
	const live = machine.transitions.filter((transition) => transition.enabled);

	const reached = new Set<string>();
	const first = machine.states[0];
	if (first) {
		reached.add(first.id);
		// A worklist rather than recursion: a machine is a graph, not a tree, and a
		// cycle between two states is the *normal* shape — rest to hover and back.
		const queue = [first.id];
		for (let at = 0; at < queue.length; at++) {
			for (const transition of live) {
				if (transition.from !== queue[at] || reached.has(transition.to)) continue;
				reached.add(transition.to);
				queue.push(transition.to);
			}
		}
	}

	const leaves = new Set(live.map((transition) => transition.from));
	const seen = new Set<string>();
	const reported = new Set<string>();
	const nondeterministic: Array<[string, Trigger]> = [];
	for (const transition of live) {
		// Joined on NUL because a state id and a trigger word are both constants but
		// nothing here guarantees the pair cannot key alike under a plainer
		// separator, and this is the same escape `variantsOf` writes for the same
		// reason: a raw NUL hides the whole file from grep.
		const key = `${transition.from}\u0000${transition.trigger}`;
		if (!seen.has(key)) {
			seen.add(key);
			continue;
		}
		if (reported.has(key)) continue;
		reported.add(key);
		nondeterministic.push([transition.from, transition.trigger]);
	}

	return {
		unreachable: machine.states
			.filter((state) => !reached.has(state.id))
			.map((state) => state.id),
		deadEnds: machine.states
			.filter((state) => !leaves.has(state.id))
			.map((state) => state.id),
		nondeterministic,
		dangling: live
			.filter((transition) => !ids.has(transition.from) || !ids.has(transition.to))
			.map((transition) => transition.id),
	};
}

/**
 * The four checks the Machines panel offers with one click, as ordinary `custom`
 * constraints.
 *
 * There is no new constraint kind and no new machinery, and that is the whole
 * design: the program *derives* what is wrong with a machine rather than
 * forbidding it, so forbidding it is a rule of the designer's own. Which means
 * each of these gets an enable switch, a name in the unsat core, a strength that
 * can be softened to a preference, and `why` and `relax` for free — precisely
 * what a bare `:- …` typed into the Rules panel could never have.
 *
 * The `id` is both the constraint's term and what the body's head says, because
 * for a `custom` constraint those are one thing: `viol(machine_reachable)` is how
 * the rule reaches the switch, so a second identity would have to be mapped back
 * at every hop and the core would name something the document does not hold.
 *
 * The bodies are anonymous in every argument (`munreached(_,_)`) because a check
 * is a claim about the document rather than about one machine. A designer who
 * wants "this machine, specifically" edits the rule, which is a thing the Rules
 * panel already is for.
 */
export const MACHINE_CHECKS: Array<{ id: string; label: string; rule: string }> = [
	{
		id: "machine_reachable",
		label: "Every state is reachable",
		rule: "viol(machine_reachable) :- munreached(_,_).",
	},
	{
		id: "machine_no_dead_ends",
		label: "No dead ends",
		rule: "viol(machine_no_dead_ends) :- mdeadend(_,_).",
	},
	{
		id: "machine_deterministic",
		label: "One edge per trigger",
		rule: "viol(machine_deterministic) :- mnondet(_,_,_).",
	},
	{
		id: "machine_wired",
		label: "Every transition is wired",
		rule: "viol(machine_wired) :- mdangling(_,_).",
	},
];

/* ------------------------------------------------------------------ */
/* The runtime table, shared by the export and the studio              */
/* ------------------------------------------------------------------ */

export interface MachineTable {
	/** Instance node id -> machine id. Only instances a machine drives. */
	instances: Record<string, { machine: string; initial: string }>;
	machines: Record<
		string,
		{
			initial: string;
			states: string[];
			/** from -> trigger -> to. First enabled transition wins. */
			edges: Record<string, Partial<Record<Trigger, string>>>;
		}
	>;
}

/**
 * Every machine the document actually runs, flattened into the smallest thing an
 * interpreter needs.
 *
 * A table rather than generated code per machine, because the same table is read
 * by two interpreters that must not be able to disagree: {@link stepMachine} in
 * the studio, and the thirty lines of `MACHINE_RUNTIME` in the exported file. One
 * lookup, one answer, and `runtime.test.ts` runs the emitted text against this to
 * prove it.
 *
 * Four decisions are worth writing down, because each drops something a reader
 * might expect to find:
 *
 *   - **`initial` is per instance, not per machine.** The machine's own initial
 *     state is in `machines[m].initial`; the instance's is what
 *     {@link shownState} says, which is the machine's initial unless the document
 *     put that instance in another state. That is what `SceneNode.state` means in
 *     an export: the file starts where the document was drawn, and the *CSS base*
 *     is still the machine's initial state — a different question, answered in
 *     `export.ts`.
 *   - **Only machines something uses.** A machine driving no instance is a table
 *     entry no interpreter reads, and an export whose table is empty emits no
 *     script at all — which is the case worth protecting, since the whole point
 *     of the pseudo-class collapse is a file with no behaviour in it.
 *   - **Disabled and dangling edges are left out.** A disabled edge is out of the
 *     program, and an edge to a state the machine has not got would write a
 *     `data-state` no rule in the file matches — a runtime that silently stops
 *     matching anything is worse than one that does not move.
 *   - **A state with no outgoing edge gets no row.** Absent and empty mean the
 *     same thing to the lookup, and this table is JSON in a `<script>` tag in
 *     somebody's exported page.
 */
export function machineTable(scene: Scene): MachineTable {
	const instances: MachineTable["instances"] = {};
	const machines: MachineTable["machines"] = {};

	for (const node of instanceNodes(scene)) {
		const machine = machineForNode(scene, node);
		if (!machine || machine.states.length === 0) continue;
		instances[node.id] = {
			machine: machine.id,
			initial: shownState(machine, node),
		};
		if (machines[machine.id] !== undefined) continue;

		const ids = new Set(machine.states.map((state) => state.id));
		const edges: Record<string, Partial<Record<Trigger, string>>> = {};
		for (const transition of machine.transitions) {
			if (!transition.enabled) continue;
			if (!ids.has(transition.from) || !ids.has(transition.to)) continue;
			const row = (edges[transition.from] ??= {});
			// First one wins, in document order. Which is a real answer to
			// nondeterminism rather than a shrug: the panel *reports* the pair
			// through `mnondet/3` so the designer can fix it, and until they do the
			// studio and the exported file must at least do the same thing.
			if (row[transition.trigger] === undefined) row[transition.trigger] = transition.to;
		}
		machines[machine.id] = {
			initial: initialState(machine).id,
			states: machine.states.map((state) => state.id),
			edges,
		};
	}

	return { instances, machines };
}

/**
 * Where one trigger takes one instance, or nothing where it takes it nowhere.
 *
 * **This is the shared behaviour.** The studio's canvas playback calls it
 * directly and the exported runtime interprets the same table, so "what does
 * clicking do" has one answer rather than two that drift. Playing a state costs
 * no solve at all: every state's `frame/3` and `rendered/3` are already in the
 * one answer set, so the canvas reads a different entry out of the model it
 * already has.
 */
export function stepMachine(
	table: MachineTable,
	instance: string,
	current: string,
	trigger: Trigger,
): string | undefined {
	const at = table.instances[instance];
	if (at === undefined) return undefined;
	return table.machines[at.machine]?.edges[current]?.[trigger];
}

/* ------------------------------------------------------------------ */
/* Writing a duration down                                             */
/* ------------------------------------------------------------------ */

/** The two units CSS has for time, and the only two `msOf` reads. */
export type DurationUnit = "ms" | "s";

/**
 * The unit a stored duration was written in — the twin of `unitOf`, over a table
 * with two rows instead of seven.
 *
 * Exists so {@link writeDuration} can keep it. A document whose motion scale is
 * written in seconds should stay in seconds across an edit, for the reason a
 * document drawn in points stays in points: the unit is a decision the person who
 * typed it made, and silently rewriting `"0.2s"` as `"200ms"` because someone
 * nudged it is the tool editing prose it was not asked to edit.
 */
export function durationUnitOf(
	text: string,
	fallback: DurationUnit = "ms",
): DurationUnit {
	const match = /(ms|s)\s*$/i.exec(text.trim());
	return match ? (match[1].toLowerCase() as DurationUnit) : fallback;
}

/**
 * A whole number of milliseconds, spelled back in the unit it should be written
 * in — the twin of `writeLength`, and shorter for a reason worth stating.
 *
 * `writeLength` has to quantize before it spells, because the value it is given
 * came from a pointer and a hand means a pixel. Nothing here comes from a
 * pointer: a duration is typed, and the one caller allowed to round is
 * `nearestMs`, which has a name and a reason. So this only spells, and it spells
 * exactly — a millisecond is exactly one thousandth of a second, so unlike a
 * length in millimetres there is no value in one unit that the other cannot say,
 * and there is no fallback chain to write.
 *
 * `Math.round` on the way in is the same editorial act `nearestMs` is, in the one
 * place it is unavoidable: the contract is whole milliseconds, and spelling a
 * fractional one would produce text `msOf` reads as *nothing at all*, which would
 * blank the field a person was typing into rather than showing them a number.
 */
export function writeDuration(ms: number, unit: DurationUnit = "ms"): string {
	const whole = Math.round(ms);
	if (unit === "ms") return `${whole}ms`;
	const sign = whole < 0 ? "-" : "";
	const magnitude = Math.abs(whole);
	const rest = String(magnitude % 1000).padStart(3, "0").replace(/0+$/, "");
	const seconds = Math.floor(magnitude / 1000);
	return rest.length === 0 ? `${sign}${seconds}s` : `${sign}${seconds}.${rest}s`;
}
