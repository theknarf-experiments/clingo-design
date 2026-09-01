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
 * program: {@link machineHealth} answers the same questions `munreached/2`,
 * `mdeadend/2`, `mnondet/3`, `mdangling/2`, `mguardnever/2`, `mgunreached/2`,
 * `mmisplaced/2`, `mfight/5`, `mffight/5`, `mrfight/5` and `mstopout/3` answer.
 * That is not a smell to factor away. The panel has to be able to grey a row
 * while the document is unsatisfiable and there is no answer set at all, and a
 * rule has to be able to say it as a `viol/1` so that it lands in an unsat core
 * with a name a person can read. Neither can do the other's job, and
 * `machines.test.ts` is where the two answers are held equal.
 *
 * Five more kinds of thing arrived after the states did, and each of them had to
 * earn the invariant again. It is worth writing the five arguments down here,
 * because every function below is shaped by one of them:
 *
 *   - **An input earns it by being invisible to the picture.** Nothing that is
 *     `#project`ed depends on an input's value; `shown/2` is a fact the compiler
 *     emits from the document, so which state an instance is *drawn* in never
 *     consults one. Two universes differing only in an input would be
 *     pixel-identical and would collapse — so an input is not a variable at all,
 *     and {@link inputInitial} and {@link inputRange} read plain strings rather
 *     than {@link Value}s.
 *   - **A condition earns it by being decided at grounding.** Every comparison
 *     here is between two *constants*: the range the input declared and the
 *     literal the condition named. {@link normalizeCondition} is where that
 *     arithmetic lives, once, so that "this guard can never be met" is a claim
 *     about the document rather than about a run.
 *   - **A default state earns it by being sugar.** `entry`, `exit` and `any` add
 *     three reserved ids, and no states, no copies and no variables. They are
 *     read in {@link machineHealth} and in the runtime table and nowhere else.
 *   - **A layer earns it by composing rather than choosing.** Two layers are two
 *     `shown/2` facts in one answer set, not a choice between them, and the
 *     composition is deterministic — {@link composeStates}. This is the rung
 *     where the copy encoding pays for itself: had a state been a choice rule,
 *     two layers would have been a *product* of universes, and the thing a
 *     designer wanted — both layers running at once — would have been the one
 *     thing the encoding could not express.
 *   - **A timeline earns it by being keyframes.** The solver decides a
 *     keyframe's time and a keyframe's value, both ordinary {@link Value}s that
 *     branch only where a designer wrote alternatives. It never decides a
 *     *frame*: there is no frame rate in this file, in the program, in the model
 *     or in the export, and {@link sampleTimeline} is the whole of what playing
 *     costs.
 */
import { parseAtom } from "./atoms.ts";
import { componentDef, instanceNodes, isInstance, parseInstancePart } from "./components.ts";
import {
	type Axis3,
	type Blend,
	type CompareOp,
	COMPARE_OPS,
	CONSTRAINT_KINDS,
	type Condition,
	FRAME_DIMS,
	INPUT_KINDS,
	type InputKind,
	type Keyframe,
	type LoopMode,
	type Machine,
	type MachineInput,
	type MachineLayer,
	type MachineState,
	MOTION_PROPS,
	type MotionProp,
	PROPS,
	type PropName,
	SPATIAL_DIMS,
	type Scene,
	type SceneNode,
	type StatePart,
	type Timeline,
	type Track,
	type Transition,
	type Trigger,
	TURNS,
	type Turn,
	dimensionSpec,
	isReservedState,
	stateTouches,
} from "./scene.ts";
import { findInTree, nodeNames, parentMap } from "./tree.ts";
import {
	DEFAULT_EASING,
	MAX_PERMILLE,
	type ResolveContext,
	type Value,
	curveOf,
	keyEaseVar,
	keyTimeVar,
	motionVar,
	msOf,
	permilleOf,
	resolveValue,
	timelineLenVar,
	wordOf,
} from "./values.ts";

/**
 * No tokens and no picks — what every reader here falls back to when a caller
 * has no universe to hand it.
 *
 * `scene.ts` keeps one of these and keeps it private, and copying the two fields
 * rather than exporting it is the cheaper of the two wrongs: exporting it would
 * put a mutable-looking singleton in the barrel that every panel could reach for
 * instead of the universe it is actually looking at, and a shared empty context
 * is exactly the thing that reads as "the answer" when it is really "no answer
 * yet". Two fields, stated here, cannot be mistaken for anybody's universe.
 */
const NO_CONTEXT: ResolveContext = { tokens: [], picks: {} };

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
 * One rotation a state overrides: `srval(I,S,N,R)`. The third of the family.
 *
 * A separate key from {@link stateFrameVar} rather than a seventh dimension of
 * it, for the reason `rotateVar` is separate from `frameVar` one level down: a
 * dimension is a length read by `emuOf` and a rotation is an angle read by
 * `mdegOf`, and the two readers refuse each other's texts. One family would have
 * meant one reader guessing from the field name, and guessing wrong silently —
 * `40` is a plausible `y` and a plausible `rotateZ`.
 *
 * Here rather than in the 3D track's own files because the term scheme lives
 * where its grammar does: {@link parseStateVar} is the only parser of these
 * keys, and a fourth spelling parsed somewhere else would be a fourth place that
 * has to agree about what `sfval` means.
 */
export const stateTurnVar = (
	instanceId: string,
	stateId: string,
	nodeId: string,
	turn: string,
): string => `srval(${instanceId},${stateId},${nodeId},${turn})`;

/**
 * The four keys above are deliberately absent from `parseVariable`.
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
function parseStateVar(variable: string): {
	instance: string;
	state: string;
	node: string;
	field: string;
	/** Which of the three tables the field is a row of. */
	kind: "prop" | "frame" | "turn";
} | null {
	const atom = parseAtom(variable);
	if (!atom || atom.args.length !== 4) return null;
	const kind =
		atom.name === "sprop"
			? "prop"
			: atom.name === "sfval"
				? "frame"
				: atom.name === "srval"
					? "turn"
					: undefined;
	if (kind === undefined) return null;
	return {
		instance: atom.args[0],
		state: atom.args[1],
		node: atom.args[2],
		field: atom.args[3],
		kind,
	};
}

/**
 * The two `mval` settings that are variable keys and not {@link MotionProp}s.
 *
 * `MOTION_PROPS` is a table of *durations*: `motionMs` calls `msOf` on every
 * member, `MOTION_DEFAULT_PREDICATES` writes a millisecond fact for each, and
 * `capAxes` counts them. `exit` is out of it because the table has not grown to
 * hold it yet, and `easing` is out of it permanently — a curve is not a number
 * and `motionMs` would answer `0` for one. Both are nonetheless `mval(M,T,F)`
 * keys the panel mints, pins, and hands to the why-probe.
 *
 * So they are named here, once, rather than left to fall through
 * {@link parseMotionVar} and out the other side. The caption is the whole reason
 * this list exists: `Studio.tsx`'s label chain ends in the raw key, and a
 * sentence about why a swatch is greyed that reads `mval(m1,over,easing)` in the
 * middle of it is a receipt rather than a sentence — which is exactly what the
 * comment beside that chain says must not happen. A row a designer can pin has
 * to be a row the tool can name.
 *
 * The two words are written twice — `Transitions.tsx` labels the same two rows —
 * and that is accepted rather than factored, because the alternative is a third
 * table beside `MOTION_PROPS` that exists only to hold two strings, which is the
 * `MotionProp` column the whole feature refused. The day `exit` joins
 * `MOTION_PROPS` its entry here comes out and nothing else moves, because the
 * lookup below tries the table first.
 */
const MOTION_ASIDES: Record<string, string> = {
	exit: "Hold first",
	easing: "Easing",
};

function parseMotionVar(
	variable: string,
): { machine: string; transition: string; label: string } | null {
	const atom = parseAtom(variable);
	if (!atom || atom.name !== "mval" || atom.args.length !== 3) return null;
	const field = atom.args[2];
	const label = Object.hasOwn(MOTION_PROPS, field)
		? MOTION_PROPS[field as MotionProp].label
		: MOTION_ASIDES[field];
	if (label === undefined) return null;
	return { machine: atom.args[0], transition: atom.args[1], label };
}

/* ------------------------------------------------------------------ */
/* The term scheme, second half: tracks and keyframe copies            */
/* ------------------------------------------------------------------ */

/**
 * A track, as the term the program names it by: `trkp(panel,fill)`.
 *
 * **Three shapes rather than one with a tag**, and that is the decision worth
 * arguing. A rule that only cares about geometry writes `trkd(_,D)` in its body
 * and grounds against nothing else — no filtering literal, no second argument to
 * ignore — and the same for paint and for rotation. One shape with a tag would
 * have made every one of those rules carry a `Kind` it then had to test, which
 * is three tests where the functor already answered.
 *
 * A track is per part *and* per field for the reason a fight is: two layers
 * arguing over `opacity` of `panel` is a sentence about one property, and a
 * per-part track would have made it a sentence about six.
 */
export const trackProp = (nodeId: string, prop: string): string =>
	`trkp(${nodeId},${prop})`;
/** A track over one of the six axes — see {@link trackProp}. */
export const trackDim = (nodeId: string, dim: string): string =>
	`trkd(${nodeId},${dim})`;
/**
 * A track over one rotation — see {@link trackProp}.
 *
 * The merge widened {@link Track} with a `turn` field and specified the rules for
 * it "in the shape of the dimension pair", but never named its term. `trkr/2` is
 * that name, minted here because this file owns the grammar; a step that finds a
 * different spelling in a later document should change it here and nowhere else.
 */
export const trackTurn = (nodeId: string, turn: string): string =>
	`trkr(${nodeId},${turn})`;

/**
 * The term a track holds, whichever of the three it is, or nothing for a track
 * that names none.
 *
 * "Names none" is a real state and it is not repaired here: a half-built track a
 * panel has just added has a part and no field yet, and the document reader
 * drops it on the way in. This reader answering `undefined` is what lets every
 * caller — the analysis, the label, the table — skip it with one check instead
 * of each inventing a default field.
 *
 * A track that names **two** takes `prop`, then `dim`, then `turn`, in that
 * order and deliberately without complaint. The type forbids it, the reader
 * drops the extra fields, and a tie-break that threw would turn a document that
 * has been hand-edited into a document that will not open.
 */
export function trackTerm(track: Track): string | undefined {
	if (track.prop !== undefined) return trackProp(track.part, track.prop);
	if (track.dim !== undefined) return trackDim(track.part, track.dim);
	if (track.turn !== undefined) return trackTurn(track.part, track.turn);
	return undefined;
}

/**
 * The inverse of the three above, for anything showing one to a human.
 *
 * Through {@link parseAtom} rather than a split for {@link parseStatePart}'s
 * reason exactly: the part may itself be a term — a generated cell, an instance
 * part of a nested definition — and the parser counts brackets.
 */
export function parseTrack(
	id: string,
): { node: string; prop?: string; dim?: string; turn?: string } | null {
	const atom = parseAtom(id);
	if (!atom || atom.args.length !== 2) return null;
	if (atom.name === "trkp") return { node: atom.args[0], prop: atom.args[1] };
	if (atom.name === "trkd") return { node: atom.args[0], dim: atom.args[1] };
	if (atom.name === "trkr") return { node: atom.args[0], turn: atom.args[1] };
	return null;
}

/**
 * A keyframe copy: `kfr(c1,open,trkd(panel,y),3)`.
 *
 * Instance, timeline, track term, 1-based index. **Never a `node/1`**, for
 * {@link statePart}'s reasons exactly — a drawable copy per keyframe would paint
 * every moment of every animation on top of the picture, and the layer list
 * would grow by the keyframe count.
 *
 * Per *instance*, like a state copy and unlike the `kat`/`kval` variables, and
 * the split is the budget. A keyframe's **time** and **value** belong to the
 * machine, because every instance moves by the same clock and holds the same
 * colour; a keyframe's **placement** belongs to the instance, because that is
 * what simplex solves and two cards sit in two places. So a timeline costs
 * `2·keyframes + 1` variables however many instances it drives, and costs copies
 * only where a rule named one. See {@link keyframeParts}.
 */
export const keyCopy = (
	instanceId: string,
	timelineId: string,
	track: string,
	index: number,
): string => `kfr(${instanceId},${timelineId},${track},${index})`;

/** The inverse of {@link keyCopy}. Nothing for an index that is not a whole number. */
export function parseKeyCopy(
	id: string,
): { instance: string; timeline: string; track: string; index: number } | null {
	const atom = parseAtom(id);
	if (!atom || atom.name !== "kfr" || atom.args.length !== 4) return null;
	// The index is spelled back through `String` before it is trusted, so that
	// `kfr(c1,open,trkd(p,y),03)` and `kfr(c1,open,trkd(p,y),3.0)` — neither of
	// which any minting here writes — are read as no keyframe copy rather than as
	// keyframe 3. A term that does not round-trip is a term nothing in this
	// document made, and treating it as one would let a hand-typed rule name a
	// copy the program never mints and then wonder why it says nothing.
	const index = Number(atom.args[3]);
	if (!Number.isInteger(index) || String(index) !== atom.args[3]) return null;
	return {
		instance: atom.args[0],
		timeline: atom.args[1],
		track: atom.args[2],
		index,
	};
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
 * The rest of the family, over the three lists a machine grew on the ladder.
 *
 * Written out four times rather than as one generic `byId` helper, and the
 * repetition is deliberate: each returns its own type, each is what a panel
 * calls by name, and a generic would have taken a list plus an id and given back
 * a union that every caller then had to narrow. Four lines of duplication buys
 * four honest signatures.
 */
export const findInput = (
	machine: Machine,
	id: string | undefined,
): MachineInput | undefined =>
	id === undefined ? undefined : (machine.inputs ?? []).find((x) => x.id === id);

export const findTimeline = (
	machine: Machine,
	id: string | undefined,
): Timeline | undefined =>
	id === undefined ? undefined : (machine.timelines ?? []).find((w) => w.id === id);

export const findLayer = (
	machine: Machine,
	id: string | undefined,
): MachineLayer | undefined =>
	id === undefined ? undefined : machineLayers(machine).find((l) => l.id === id);

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
/* Layers                                                              */
/* ------------------------------------------------------------------ */

/**
 * The id of the layer a machine with no layers has.
 *
 * A constant rather than a string typed in four places, because it reaches the
 * generated program as `mlayer(M,base)` and appears in the export's
 * `data-state-base` decision — and the one thing that must stay true of it is
 * that a one-layer document never mentions it *anywhere a person can see*. The
 * export writes plain `data-state` for the first layer for exactly that reason.
 */
export const BASE_LAYER = "base";

/**
 * The layers of a machine, in order, minting one where the document has none.
 *
 * Every machine has at least one layer, and a machine that says nothing about
 * layers has exactly one — which is every machine in every document written
 * before layers existed. Minting it here rather than at each caller is what lets
 * every rule below be written once: `layerOf`, `layerInitial`, the health walk
 * and the runtime table all quantify over "the layers", and a special case for
 * "or the implicit one" in each of them would be four places that can disagree
 * about what a machine with an empty `layers: []` means.
 *
 * An empty array is treated as absent, not as a machine with no layers at all. A
 * machine with no layer would be a machine with no states, since every state
 * belongs to one, and that is not a thing the document can mean — it is a thing
 * an edit that deleted the last layer leaves behind, and the honest reading of
 * it is the reading a document that never had layers gets.
 */
export function machineLayers(machine: Machine): MachineLayer[] {
	const layers = machine.layers ?? [];
	return layers.length > 0 ? [...layers] : [{ id: BASE_LAYER, name: "Base" }];
}

/**
 * The layer a state belongs to: what it says, or the first.
 *
 * Absent-is-first rather than absent-is-invalid, for `SceneNode.state`'s reason:
 * a document written before layers existed must mean exactly what it meant, and
 * a machine edited down — a layer deleted while four states still named it —
 * must leave its states legal rather than orphaned. A state naming a layer the
 * machine has not got falls back the same way and for the same reason a
 * `SceneNode.state` naming a deleted state does.
 */
export function layerOf(machine: Machine, state: MachineState): string {
	const layers = machineLayers(machine);
	return state.layer !== undefined && layers.some((l) => l.id === state.layer)
		? state.layer
		: layers[0].id;
}

/** Every state of one layer, in document order. */
export function layerStates(machine: Machine, layer: string): MachineState[] {
	return machine.states.filter((state) => layerOf(machine, state) === layer);
}

/**
 * The state a layer starts in: its first, in document order.
 *
 * `minitial/2` — the machine's own initial state — is **kept** and is the first
 * layer's, which is what every existing caller means. This is the per-layer one,
 * and it is a different function rather than a widened one for the reason the
 * program keeps `mlinitial/3` a different predicate from `minitial/2`: two
 * arities of one name in a file people read by grep is a cruelty.
 *
 * Nothing for a layer with no states — which is what a layer somebody has just
 * added is, and is why the caller that would divide by it checks.
 */
export function layerInitial(
	machine: Machine,
	layer: string,
): MachineState | undefined {
	return machine.states.find((state) => layerOf(machine, state) === layer);
}

/**
 * Which state a node is drawn in, per layer — layer id to state id, for every
 * layer of the machine.
 *
 * The one reader everything multi-layer goes through, and the two fields it
 * reconciles are two on purpose. `SceneNode.state` is a string and says the
 * **first** layer's state; `SceneNode.states` is a record and says any layer's.
 * An entry in the record for the first layer wins over the string, so there is
 * exactly one place a multi-layer document says the whole answer, and a document
 * that has never heard of layers goes on meaning precisely what it meant.
 *
 * A stored state the machine no longer holds falls back to the layer's own
 * initial, exactly as {@link shownState} does. Nothing is corrected on the way
 * in: a machine edited down leaves its instances legal, and undoing puts every
 * instance back where it was.
 *
 * A layer with no states at all gets **no entry**, rather than an entry naming
 * nothing. "This instance is in no state of that layer" is true and sayable; an
 * entry mapping a layer to `""` would be a state id that matches no `stt/3` term
 * and no CSS rule, and every reader downstream would have to know that.
 */
export function shownStates(
	machine: Machine,
	node: SceneNode,
): Record<string, string> {
	const out: Record<string, string> = {};
	const layers = machineLayers(machine);
	for (const [index, layer] of layers.entries()) {
		const stored = node.states?.[layer.id] ?? (index === 0 ? node.state : undefined);
		const held =
			stored !== undefined && findState(machine, stored) !== undefined
				? findState(machine, stored)
				: undefined;
		// The stored state has to be a state *of this layer*, not merely a state of
		// the machine. Without that check a document that moved `hover` from layer
		// one to layer two would draw the instance in `hover` on both — one picture
		// on top of itself, which is what `mtwoshown/1` reports and what nothing
		// here should be able to cause.
		const state = held && layerOf(machine, held) === layer.id
			? held
			: layerInitial(machine, layer.id);
		if (state !== undefined) out[layer.id] = state.id;
	}
	return out;
}

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
	const field = stateFieldLabel(parsed.kind, parsed.field);
	if (field === undefined) return undefined;
	const names = nodeNames(scene.nodes);
	const node = findInTree(scene.nodes, parsed.instance);
	const machine = node ? machineForNode(scene, node) : undefined;
	const state = machine ? stateName(machine, parsed.state) : parsed.state;
	const part = names[parsed.node] ?? parsed.node;
	return `${part} · ${field} · ${state} — ${names[parsed.instance] ?? parsed.instance}`;
}

/**
 * The word for one delta field, out of whichever of the three tables owns it.
 *
 * Three lookups rather than one merged table, because the three tables are three
 * different things and merging them would need a key that says which — which is
 * exactly what the term's own functor already says. A dimension reads its
 * lowercase `"x"` out of `dimensionSpec` so it spans all **six** axes and not the
 * planar four: a state may lift a mesh, so a variable for that lift has to have
 * a name, and a reader that only knew `FRAME_DIMS` would answer nothing for
 * `sfval(i1,hover,cube,z)` and the panel would show a raw term.
 */
function stateFieldLabel(
	kind: "prop" | "frame" | "turn",
	field: string,
): string | undefined {
	if (kind === "prop") {
		return Object.hasOwn(PROPS, field) ? PROPS[field as PropName].label : undefined;
	}
	if (kind === "frame") {
		return Object.hasOwn(FRAME_DIMS, field) || Object.hasOwn(SPATIAL_DIMS, field)
			? dimensionSpec(field as Axis3).label
			: undefined;
	}
	return Object.hasOwn(TURNS, field) ? TURNS[field as Turn].label : undefined;
}

/**
 * A rotation delta's variable in words: `"Card · Turn about Z · Hover — Card 1"`.
 *
 * Narrower than {@link stateVarLabel} on purpose rather than redundantly with
 * it. The 3D inspector's rotation rows ask about rotation *specifically* — they
 * are built from `TURN_NAMES` and they mint `srval` keys — and a reader that
 * cheerfully answered for a fill as well would let a rotation row label
 * something that is not a rotation the first time a key was built wrong. That is
 * the same argument {@link motionLabel} makes for refusing a key the document no
 * longer matches: a key that is never typed by a person is a caller's, and a
 * confident label hides the caller's bug.
 */
export function stateTurnLabel(scene: Scene, variable: string): string | undefined {
	const parsed = parseStateVar(variable);
	if (!parsed || parsed.kind !== "turn") return undefined;
	return stateVarLabel(scene, variable);
}

/**
 * `"Press · Duration"`, `"Over · Easing"`, for a motion row and for a
 * why-sentence.
 *
 * All five settings a transition mints a variable for, and not the three in
 * `MOTION_PROPS` — see {@link MOTION_ASIDES}, which is where the other two are
 * named and why.
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
	return `${capitalise(transition.id)} · ${parsed.label}`;
}

/**
 * A track in the words a person uses: `"Panel · y"`, `"Panel · Fill"`.
 *
 * The node's name where the document still holds it, its id otherwise. Shared by
 * the two labels below and by the timeline panel's row headers, so a track is
 * described one way wherever it appears.
 */
function trackWords(
	names: Record<string, string>,
	track: string,
): string | undefined {
	const parsed = parseTrack(track);
	if (!parsed) return undefined;
	const field =
		parsed.prop !== undefined
			? stateFieldLabel("prop", parsed.prop)
			: parsed.dim !== undefined
				? stateFieldLabel("frame", parsed.dim)
				: parsed.turn !== undefined
					? stateFieldLabel("turn", parsed.turn)
					: undefined;
	if (field === undefined) return undefined;
	return `${names[parsed.node] ?? parsed.node} · ${field}`;
}

/**
 * One of a timeline's variables in words: `"Panel · y · Open · key 3"`.
 *
 * Reads all three keys a timeline mints — `kat`, `kval` and `tlen` — because
 * they are three questions about one row of one panel and a caller that had to
 * choose a reader by key would be a caller that had already parsed the key.
 * A `tlen` key is `"Open · length"`: it has no track and no index, and saying so
 * with a word rather than an empty slot is what keeps the sentence readable.
 *
 * {@link motionLabel}'s judgement, not {@link stateLabel}'s: nothing at all
 * where the document no longer holds that machine or that timeline. These keys
 * are minted by a panel out of a timeline it is looking at, never typed into a
 * rule by a person, so a key that no longer matches is a caller's bug and a
 * confident sentence would hide it.
 */
export function keyframeLabel(scene: Scene, variable: string): string | undefined {
	const atom = parseAtom(variable);
	if (!atom) return undefined;
	const isKey = atom.name === "kat" || atom.name === "kval";
	if (!isKey && atom.name !== "tlen") return undefined;
	if (atom.args.length !== (isKey ? 4 : 2)) return undefined;

	const machine = findMachine(scene.machines, atom.args[0]);
	const timeline = machine ? findTimeline(machine, atom.args[1]) : undefined;
	if (!timeline) return undefined;
	const label = timeline.name?.trim() || timeline.id;
	if (!isKey) return `${label} · length`;

	const words = trackWords(nodeNames(scene.nodes), atom.args[2]);
	if (words === undefined) return undefined;
	const what = atom.name === "kat" ? "at" : "value";
	return `${words} · ${label} · key ${atom.args[3]} · ${what}`;
}

/**
 * A keyframe copy in the words a person uses:
 * `"Panel · y · Open · key 3 — Card 1"`.
 *
 * The fourth member of the family `partLabel`, `datumLabel` and
 * {@link stateLabel} are in, and it is here for the same reason all three are: a
 * keyframe copy is a member a rule can name and a designer cannot point at, so
 * every sentence the tool builds out of a rule's members has to be able to say
 * it. `Studio.tsx`'s label chain ends
 * `… ?? stateLabel(scene,n) ?? keyCopyLabel(scene,n) ?? n`.
 *
 * {@link stateLabel}'s judgement rather than {@link keyframeLabel}'s, and the
 * difference between the two neighbours is worth stating because it looks like
 * an inconsistency: this term was **typed into a rule by a person**, and the
 * rule outlives the thing it names, so it stays readable as far as the document
 * still holds each piece and reads as its own ids past that. A key a panel
 * minted gets the opposite treatment one function up.
 */
export function keyCopyLabel(scene: Scene, term: string): string | undefined {
	const parsed = parseKeyCopy(term);
	if (!parsed) return undefined;
	const names = nodeNames(scene.nodes);
	const node = findInTree(scene.nodes, parsed.instance);
	const machine = node ? machineForNode(scene, node) : undefined;
	const timeline = machine ? findTimeline(machine, parsed.timeline) : undefined;
	const label = timeline ? timeline.name?.trim() || timeline.id : parsed.timeline;
	const words = trackWords(names, parsed.track) ?? parsed.track;
	const instance = names[parsed.instance] ?? parsed.instance;
	return `${words} · ${label} · key ${parsed.index} — ${instance}`;
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

/**
 * True when the document still holds what a keyframe-copy term names — the twin
 * of {@link holdsStateCopy}, and the clause `pruneConstraints` needs so that a
 * rule about a keyframe survives an unrelated `deleteNodes`.
 *
 * **Not optional, and it is the same latent bug `holdsStateCopy` was written
 * for.** `pruneConstraints` filters members with
 * `alive.has(id) || holdsDatum(…) || holdsStateCopy(…)`, and a `kfr(…)` term is
 * none of the three — so without a fourth clause the first `deleteNodes`,
 * `groupNodes`, `setGuides` or `removeGuide` after a keyframe rule is written
 * silently deletes it.
 *
 * Blunt in exactly the same place and for exactly the same reason: held when the
 * instance exists and its machine still holds that timeline and that track,
 * whatever {@link keyframeParts} says today. Asking whether the *copy* exists
 * would delete the designer's rule the moment they cleared it — and here the
 * loop eats itself, because the rule is the only thing that makes the copy exist
 * at all.
 *
 * The keyframe **index** is checked and the deliberate asymmetry is worth
 * stating: a track that has lost its third key really has lost it, that term
 * names a moment the timeline does not have, and there is no edit that brings it
 * back the way re-adding a delta brings a materialised part back. A rule about
 * key 3 of a two-key track is a rule about nothing, permanently.
 */
export function holdsKeyCopy(scene: Scene, term: string): boolean {
	const parsed = parseKeyCopy(term);
	if (!parsed) return false;
	const node = findInTree(scene.nodes, parsed.instance);
	if (!node || !isInstance(node)) return false;
	const machine = machineForNode(scene, node);
	const timeline = machine ? findTimeline(machine, parsed.timeline) : undefined;
	if (!timeline) return false;
	const track = timeline.tracks.find((t) => trackTerm(t) === parsed.track);
	return track !== undefined && parsed.index >= 1 && parsed.index <= track.keys.length;
}

/**
 * Every keyframe copy this document holds, as constraint members — the twin of
 * {@link stateCopyIds}, and what the Rules panel offers beside the state copies.
 *
 * Instance by instance, timeline by timeline, track by track, key by key — and,
 * unlike {@link stateCopyIds}, **not** filtered by the materialisation analysis.
 * The asymmetry is the rationing working as designed rather than an oversight: a
 * state copy exists because some state touched the part, so a term for an
 * unmaterialised part would name a copy nothing is going to mint. A keyframe
 * copy exists *because a rule named it* — {@link keyframeParts} is seeded from
 * `scene.constraints` and from nothing else — so filtering this menu by the
 * analysis would offer only the terms somebody had already used, and there would
 * be no first rule.
 */
export function keyframeCopyIds(scene: Scene): string[] {
	const out: string[] = [];
	for (const node of instanceNodes(scene)) {
		const machine = machineForNode(scene, node);
		if (!machine) continue;
		for (const timeline of machine.timelines ?? []) {
			for (const track of timeline.tracks) {
				const term = trackTerm(track);
				if (term === undefined) continue;
				for (let k = 1; k <= track.keys.length; k++) {
					out.push(keyCopy(node.id, timeline.id, term, k));
				}
			}
		}
	}
	return out;
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
 * **A part a state's timeline animates.** A state may say nothing in its
 * `parts` delta and still change the picture, because it plays a timeline: the
 * state's *settled pose* is the timeline's value at its own length, which is the
 * last keyframe of each track. So a track over `panel`'s `y` makes `panel` a
 * part that state touches, exactly as a `frame: { y }` delta would, and a
 * blend state does it through every timeline any of its stops names. Missing
 * this is not a slow document, it is a wrong one: `stt(I,S,panel)` would never
 * be minted, the settled pose would have nowhere to be, and a hover that slides
 * a panel open would draw nothing at all in a document that solves cleanly.
 *
 * A **timeline nothing plays** materialises nothing, which is the other half of
 * the same sentence and is what keeps "a timeline on its own costs no copies"
 * true. Somebody building one before wiring it up pays nothing for it.
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
		for (const timeline of statePlays(machine, state)) {
			for (const track of timeline.tracks) {
				// A track with no field is no track — the same reading `trackTerm`
				// gives it and the document reader gives it — so it materialises
				// nothing rather than materialising a part on the strength of a row
				// somebody has half-added.
				if (parts.has(track.part) && trackTerm(track) !== undefined) {
					out.add(track.part);
				}
			}
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

/**
 * Every timeline one state plays: its own, or every stop of its blend.
 *
 * A state holding **both** yields the blend's, and the pair is reported as
 * `mtwosource/2` rather than repaired — which is the document's own rule, stated
 * on {@link MachineState.blend}, and it is stated once here so that the
 * materialisation, the sampling and the table cannot each pick a different side.
 * The reason to report rather than repair is that a state with two sources is a
 * mistake a person should see; the reason to pick the blend when forced is that
 * a blend is the more specific claim and picking the other way would make a
 * half-deleted blend silently play one arbitrary timeline flat.
 *
 * A stop naming a timeline the machine has not got contributes nothing, in
 * document order, with no gap: it is the same silence a dangling `instanceOf`
 * leaves, and the check that reports it is `mstopout`'s neighbour rather than
 * this reader's business.
 */
export function statePlays(machine: Machine, state: MachineState): Timeline[] {
	if (state.blend !== undefined) {
		const out: Timeline[] = [];
		for (const stop of state.blend.stops) {
			const timeline = findTimeline(machine, stop.timeline);
			// De-duplicated, because two stops of one blend routinely name one
			// timeline — that is what a blend with a rest pose at both ends is — and
			// every caller here is asking "which timelines" rather than "how many
			// times".
			if (timeline && !out.includes(timeline)) out.push(timeline);
		}
		return out;
	}
	const only = findTimeline(machine, state.timeline);
	return only ? [only] : [];
}

/**
 * Which parts of which timelines need a copy per keyframe — the second
 * rationing, and it is harder than the first: **the default is none.**
 *
 * A timeline on its own costs no copies at all. Two variables per keyframe (its
 * time and its value) and one per timeline (its length), and nothing else — which
 * is enough for the export, which needs values and times and lets the compositor
 * do the rest, and enough for the studio canvas, which lerps between two entries
 * of an answer set it already has. Minting a copy per keyframe by default would
 * be the one decision that made this rung unaffordable: a twenty-key timeline on
 * a twelve-part definition placed twenty times is 4,800 copies of a pose nobody
 * asked to place.
 *
 * So a copy is minted **only where a rule names one**, which is the same seed
 * {@link materializedParts} uses for its second source and the same argument:
 * naming a term in a geometric constraint is what hands it to simplex, and a
 * term simplex places has to exist. Nothing else seeds this — not a track, not a
 * state that plays the timeline, not a keyframe that looks interesting.
 *
 * The return is **timeline id -> the part ids its copies are minted for**, which
 * is `mkpart(M,W,N)` exactly, and the shape is why the upward closure works. A
 * copy's world coordinate is its parent's plus its own, chained through
 * `child/2`; stopping short of the definition's root would leave a link missing,
 * `gworld/2` would treat the copy as a root, and simplex would place it in the
 * instance's own coordinates rather than on the canvas — a constraint wrong by
 * exactly the offset of the enclosing frame, which is the kind of bug nobody
 * finds by reading. **The closure adds parts, not tracks**: an ancestor of an
 * animated part gets a copy so that the chain exists, and that copy takes its
 * geometry from the state copy, because no track animates it.
 */
export function keyframeParts(
	scene: Scene,
	machine: Machine,
): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	const def = componentDef(scene, machine.root);
	if (!def) return out;

	const parts = new Set(def.parts.map((part) => part.id));
	const parent = parentMap([def.root]);

	for (const constraint of scene.constraints) {
		if (!constraint.enabled) continue;
		if (!CONSTRAINT_KINDS[constraint.kind].geometric) continue;
		for (const member of constraint.nodes) {
			const named = parseKeyCopy(member);
			if (!named) continue;
			const timeline = findTimeline(machine, named.timeline);
			if (!timeline) continue;
			// The member has to name a track this timeline actually has, and the part
			// that track animates has to be a part of *this* definition. A rule
			// naming another machine's timeline is not this machine's business, and
			// answering for it would mint copies on an instance that has no such
			// track to hang them off.
			const track = timeline.tracks.find((t) => trackTerm(t) === named.track);
			if (!track || !parts.has(track.part)) continue;
			const seeded = out.get(timeline.id) ?? new Set<string>();
			seeded.add(track.part);
			let up = parent.get(track.part);
			while (up !== undefined) {
				seeded.add(up.id);
				up = parent.get(up.id);
			}
			out.set(timeline.id, seeded);
		}
	}
	return out;
}

/* ------------------------------------------------------------------ */
/* Inputs, and the arithmetic of a guard                               */
/* ------------------------------------------------------------------ */

/**
 * What an input holds before anybody drives it, in the units the program uses.
 *
 * A boolean answers `true`/`false` through `wordOf`; a number answers a whole
 * count of **thousandths** through `permilleOf`; a trigger answers nothing at
 * all, and the nothing is the point rather than an omission — "not fired" is not
 * a value a store can hold, it is the absence of one, so a trigger is never in
 * the store and is handed in as a set of ids fired *for this evaluation* and
 * thrown away.
 *
 * Unreadable takes the kind's own fallback rather than being carried, exactly as
 * an unknown easing does: the value reaches a runtime and a runtime that started
 * a boolean at `"maybe"` would be a machine nothing could reason about. `"0.0005"`
 * is not a whole thousandth and so is not a number here, which is `permilleOf`'s
 * exact-or-nothing rule showing through where it should.
 */
export function inputInitial(input: MachineInput): boolean | number | undefined {
	if (input.kind === "trigger") return undefined;
	const stored = input.initial;
	if (input.kind === "boolean") {
		const word = stored === undefined ? undefined : wordOf(stored);
		if (word === "true" || word === "false") return word === "true";
		return INPUT_KINDS.boolean.fallback === "true";
	}
	const read = stored === undefined ? undefined : permilleOf(stored);
	return read ?? permilleOf(INPUT_KINDS.number.fallback) ?? 0;
}

/**
 * The closed ends of a number input's range, in thousandths, where it declared
 * one.
 *
 * **Absent is open, not zero**, and the two checks that read a range say nothing
 * about an end that is not there. That is the honest reading: a designer who has
 * not said how far the drawer opens has not said that it does not open at all,
 * and a reader that invented `0` would report violations against a claim nobody
 * made. An end that reads as no number is the same as an end nobody typed.
 *
 * Ignored on a boolean and on a trigger, where the range *is* the kind, and
 * answering `{}` for those rather than inventing `0..1` keeps the one place that
 * asks — {@link normalizeCondition} — from having two kinds of range to reason
 * about.
 */
export function inputRange(input: MachineInput): { min?: number; max?: number } {
	if (input.kind !== "number") return {};
	const out: { min?: number; max?: number } = {};
	const min = input.min === undefined ? undefined : permilleOf(input.min);
	const max = input.max === undefined ? undefined : permilleOf(input.max);
	if (min !== undefined) out.min = min;
	if (max !== undefined) out.max = max;
	return out;
}

/**
 * One condition, reduced to the shape the checks compare in — the whole of the
 * guard arithmetic, done once, in TypeScript, with a name.
 *
 * **A closed window rather than an operator**, and that is the decision this
 * function exists to make. Six operators compared symbolically is six pairs of
 * rules that each have to know which way `ge` points; six operators normalised
 * into an interval is one comparison, `L1 > H2`, that answers every pair. The
 * clash rules in the program are literally two lines because of it.
 *
 * `gt` becoming `v + 1` is **exact rather than an approximation**, and it is
 * exact *because* a ratio reaches the program as a whole number of thousandths:
 * the moment a quantity is a whole number of something, "greater than v" and "at
 * least v plus one" are the same claim. That is the sentence a length in EMU
 * already earned, one quantity over.
 *
 * `ne` gets **no window**, because a hole is not an interval. It clashes with
 * exactly one thing — the point it excludes — and it is carried as that point.
 *
 * The open ends are `±MAX_PERMILLE`, the same ceiling `permilleOf` refuses past,
 * so an unbounded side is a number rather than a missing field and every
 * comparison stays arithmetic.
 *
 * A condition that is not one — an input the machine has not got, an operator
 * that kind does not take, a comparand that reads as nothing — comes back as
 * `bad` with the sentence saying which. That is `mcbad/3`, and it is a *value*
 * rather than an exception because a half-written condition is the ordinary
 * state of a row somebody is typing into, and the panel has to be able to show
 * the row and say what is wrong with it.
 */
export type NormalCondition =
	| { input: string; kind: "range"; lo: number; hi: number }
	| { input: string; kind: "not"; value: number }
	| { input: string; kind: "is"; value: boolean }
	| { input: string; kind: "isNot"; value: boolean }
	| { input: string; kind: "fired" }
	| { input: string; kind: "bad"; why: string };

export function normalizeCondition(
	machine: Machine,
	condition: Condition,
): NormalCondition {
	const at = condition.input;
	const bad = (why: string): NormalCondition => ({ input: at, kind: "bad", why });

	const input = findInput(machine, at);
	if (!input) return bad(`There is no input called “${at}”.`);
	if (!Object.hasOwn(COMPARE_OPS, condition.op)) {
		return bad(`“${condition.op}” is not a comparison.`);
	}
	const spec = COMPARE_OPS[condition.op];
	if (!spec.kinds.includes(input.kind)) {
		return bad(
			`“${input.name || input.id}” is a ${INPUT_KINDS[input.kind].label.toLowerCase()}, which cannot be asked “${spec.label}”.`,
		);
	}

	if (input.kind === "trigger") return { input: at, kind: "fired" };

	if (input.kind === "boolean") {
		const word = condition.value === undefined ? undefined : wordOf(condition.value);
		if (word !== "true" && word !== "false") {
			return bad(`“${condition.value ?? ""}” is not true or false.`);
		}
		return { input: at, kind: condition.op === "ne" ? "isNot" : "is", value: word === "true" };
	}

	const value = condition.value === undefined ? undefined : permilleOf(condition.value);
	if (value === undefined) return bad(`“${condition.value ?? ""}” is not a number.`);
	switch (condition.op) {
		case "eq":
			return { input: at, kind: "range", lo: value, hi: value };
		case "ne":
			return { input: at, kind: "not", value };
		case "ge":
			return { input: at, kind: "range", lo: value, hi: MAX_PERMILLE };
		case "gt":
			return { input: at, kind: "range", lo: value + 1, hi: MAX_PERMILLE };
		case "le":
			return { input: at, kind: "range", lo: -MAX_PERMILLE, hi: value };
		default:
			return { input: at, kind: "range", lo: -MAX_PERMILLE, hi: value - 1 };
	}
}

/** Every condition of a transition, normalised. Absent is an unguarded edge. */
export const guardOf = (
	machine: Machine,
	transition: Transition,
): NormalCondition[] =>
	(transition.conditions ?? []).map((c) => normalizeCondition(machine, c));

/**
 * True where two conditions cannot both hold — the four clash rules, in the
 * order the program states them.
 *
 * Only ever asked of two conditions **about one input**, because two conditions
 * about two inputs can always both hold: there is no relation between a drawer's
 * openness and whether a row is selected, and inventing one would make the
 * checks report guards as impossible that are merely unusual.
 *
 * A `bad` condition clashes with nothing here, and that is not a shortcut. A
 * condition the compiler could not read is reported under its own name — it is
 * what makes its whole guard impossible, through {@link guardImpossible} — and
 * having it *also* clash with everything would make one mistake report as three.
 */
function clash(a: NormalCondition, b: NormalCondition): boolean {
	if (a.input !== b.input) return false;
	if (a.kind === "range" && b.kind === "range") return a.lo > b.hi || b.lo > a.hi;
	if (a.kind === "not" && b.kind === "range") return b.lo === a.value && b.hi === a.value;
	if (b.kind === "not" && a.kind === "range") return a.lo === b.value && a.hi === b.value;
	if (a.kind === "is" && b.kind === "is") return a.value !== b.value;
	if (a.kind === "is" && b.kind === "isNot") return a.value === b.value;
	if (b.kind === "is" && a.kind === "isNot") return b.value === a.value;
	return false;
}

/**
 * True where no valuation satisfies both guards — `mdisjoint/3`.
 *
 * Symmetric by construction rather than by a closure rule, because here there is
 * one function and it can simply look both ways; the program needs two rules for
 * it only because a rule is directed.
 */
export function guardsDisjoint(
	first: readonly NormalCondition[],
	second: readonly NormalCondition[],
): boolean {
	return first.some((a) => second.some((b) => clash(a, b)));
}

/**
 * True where two edges' guards are **not provably disjoint** — `moverlap/3`, and
 * the default is overlap.
 *
 * Two unguarded edges overlap, which is what keeps the determinism check on a
 * document with no conditions the check that shipped, atom for atom. "Not
 * provably disjoint" rather than "possibly both" is the honest reading: this is
 * a sound refusal to guess, not a claim that some valuation exists.
 */
export const guardsOverlap = (
	first: readonly NormalCondition[],
	second: readonly NormalCondition[],
): boolean => !guardsDisjoint(first, second);

/**
 * True where a transition's own guard can never be satisfied — `mguardnever/2`.
 *
 * Three ways, and the program states them as three rules for the same reason
 * they are three branches here: they are three different mistakes a person
 * makes. Two of the edge's own conditions contradict each other (the clash rules
 * asked of one guard against itself); a window misses the input's own declared
 * range entirely; or a condition is not a condition at all.
 *
 * A guard the checks call impossible is one **no runtime valuation can satisfy**,
 * so the edge genuinely can never be taken. That soundness is what lets
 * {@link MachineHealth.unreachableWithGuards} be strictly stronger than the
 * shipped reachability check rather than merely different from it.
 */
export function guardImpossible(machine: Machine, transition: Transition): boolean {
	const guard = guardOf(machine, transition);
	if (guard.some((c) => c.kind === "bad")) return true;
	if (guardsDisjoint(guard, guard)) return true;
	return guard.some((c) => {
		if (c.kind !== "range") return false;
		const input = findInput(machine, c.input);
		if (!input) return false;
		const { min, max } = inputRange(input);
		return (min !== undefined && min > c.hi) || (max !== undefined && c.lo > max);
	});
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
	/** Transitions whose guard cannot be satisfied — `mguardnever/2`. */
	impossible: string[];
	/**
	 * States no *feasible* chain reaches — `mgunreached/2`. A superset of
	 * {@link unreachable}, and `machines.test.ts` asserts the inclusion on every
	 * shape it builds rather than believing it.
	 */
	unreachableWithGuards: string[];
	/** Transitions naming a reserved id in the wrong position — `mmisplaced/2`. */
	misplaced: string[];
	/** `[layer, layer, part, prop]` — `mfight/5`. */
	fights: Array<[string, string, string, string]>;
	/** `[layer, layer, part, dim]` — `mffight/5`. */
	frameFights: Array<[string, string, string, string]>;
	/**
	 * `[layer, layer, part, rotation]` — `mrfight/5`.
	 *
	 * **Beyond the frozen list**, and added because the merge added the predicate
	 * without adding the member to read it back: two layers that both turn one
	 * part derive two `turn/3` atoms for one `(node, axis)`, which is one
	 * arbitrary answer rather than two designs, and a panel with nowhere to say
	 * so would report a fight over `opacity` and stay silent about a fight over
	 * `rotateZ`. Empty on every document with no rotation in it.
	 */
	turnFights: Array<[string, string, string, string]>;
	/** `[state, stop index]` outside the blend input's range — `mstopout/3`. */
	stopsOutOfRange: Array<[string, number]>;
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
	const layers = machineLayers(machine);

	/**
	 * The layer a transition belongs to — `mtlayer/3`.
	 *
	 * Its source's layer where the source is a state, and its *destination's*
	 * where the source is a reserved word, which is what makes an Entry or an Any
	 * edge belong to a layer at all: `entry` and `any` are not states and have no
	 * layer of their own, so the only thing that can say which layer such an edge
	 * runs in is the state at its other end. An edge with reserved words at both
	 * ends belongs to no layer, derives no effective source, and is reported as
	 * misplaced — which is exactly what an `any` to `exit` edge is.
	 */
	const layerOfEdge = (transition: Transition): string | undefined => {
		const from = findState(machine, transition.from);
		if (from) return layerOf(machine, from);
		if (!isReservedState(transition.from)) return undefined;
		const to = findState(machine, transition.to);
		return to ? layerOf(machine, to) : undefined;
	};

	/**
	 * What an edge may be taken *from* — `mefrom/3`, as a list.
	 *
	 * An ordinary edge from its own source; an Entry edge from its layer's
	 * initial state, because Entry is sugar over "where the runtime starts"; an
	 * Any edge from every state of its layer, because that is what Any means.
	 *
	 * Deliberately **not** requiring the source to be a state the machine has:
	 * this file has recorded since it shipped that "a nondeterministic pair may be
	 * reported on a `from` the machine has not got", because two edges leaving the
	 * same missing state are still two edges the designer wrote and meant, and the
	 * program's own rule says `not mreserved(S)` rather than `mstate(M,S)` for the
	 * same reason. Tightening it here would take that back silently, and only for
	 * the pair that has *also* lost its state — the worst moment to stop
	 * reporting anything.
	 */
	const sourcesOf = (transition: Transition): string[] => {
		if (!isReservedState(transition.from)) return [transition.from];
		const layer = layerOfEdge(transition);
		if (layer === undefined) return [];
		if (transition.from === "any") {
			return layerStates(machine, layer).map((state) => state.id);
		}
		if (transition.from === "entry") {
			const initial = layerInitial(machine, layer);
			return initial ? [initial.id] : [];
		}
		// `exit` as a source: an edge that tries to leave the end of a layer. It
		// leaves nowhere, and it is reported as misplaced rather than folded into
		// the reachability answer, because those are two different sentences.
		return [];
	};

	const edges = live.map((transition) => ({
		transition,
		sources: sourcesOf(transition),
		guard: guardOf(machine, transition),
		impossible: guardImpossible(machine, transition),
		/**
		 * Specific beats Any — Rive's rule, and the only rule that makes a fallback
		 * a fallback. Carried as a rank so that the determinism check does not
		 * scream at the ordinary idiom: one Any edge, and one specific override of
		 * it on the same trigger.
		 */
		rank: transition.from === "any" ? 2 : 1,
	}));

	/**
	 * Reachability from every layer's own initial state.
	 *
	 * Seeded per layer rather than from the machine's first state, because a layer
	 * that is never entered is not a machine with unreachable states, it is a
	 * layer. On a one-layer machine this is the shipped seed exactly.
	 *
	 * `feasible` is the switch that makes one walk serve both answers: false is
	 * `mreach/2`, true is `mgreach/2`, and because the second walks a *subset* of
	 * the first's edges, `unreachable ⊆ unreachableWithGuards` is true by
	 * construction rather than by hope. Writing the walk twice would have made
	 * that inclusion a coincidence that a later edit could quietly break.
	 */
	const reachable = (feasible: boolean): Set<string> => {
		const reached = new Set<string>();
		const queue: string[] = [];
		for (const layer of layers) {
			const initial = layerInitial(machine, layer.id);
			if (initial && !reached.has(initial.id)) {
				reached.add(initial.id);
				queue.push(initial.id);
			}
		}
		// A worklist rather than recursion: a machine is a graph, not a tree, and a
		// cycle between two states is the *normal* shape — rest to hover and back.
		for (let at = 0; at < queue.length; at++) {
			for (const edge of edges) {
				if (feasible && edge.impossible) continue;
				if (!edge.sources.includes(queue[at])) continue;
				if (reached.has(edge.transition.to)) continue;
				reached.add(edge.transition.to);
				queue.push(edge.transition.to);
			}
		}
		return reached;
	};

	const reached = reachable(false);
	const reachedWithGuards = reachable(true);

	// What anything leaves at all — `mleaves/2`, over the *effective* source, so
	// an Any edge leaves every state of its layer. A state whose only outgoing
	// edge goes to `exit` is therefore not a dead end: something leaves it, and
	// what it leaves to is the end of the layer, which is a design somebody meant.
	const leaves = new Set(edges.flatMap((edge) => edge.sources));

	/**
	 * Two edges on one trigger, from one state, that are really ambiguous.
	 *
	 * Three narrowings on the shipped rule, and each one keeps a correct idiom
	 * from being reported. The pair must share an **effective source**, so an Any
	 * edge collides with everything in its own layer and with nothing outside it.
	 * Their guards must **overlap**, because two edges that cannot both be taken
	 * are a dispatch table rather than a coin toss. And they must share a **rank**,
	 * because a specific edge beside an Any edge has an answer and it is the
	 * specific one. With no conditions every pair overlaps and with no Any edge
	 * every rank is 1, so on a document with neither this is the rule that shipped.
	 */
	const reported = new Set<string>();
	const nondeterministic: Array<[string, Trigger]> = [];
	for (const [i, first] of edges.entries()) {
		for (const second of edges.slice(i + 1)) {
			if (first.transition.trigger !== second.transition.trigger) continue;
			if (first.rank !== second.rank) continue;
			if (!guardsOverlap(first.guard, second.guard)) continue;
			for (const source of first.sources) {
				if (!second.sources.includes(source)) continue;
				// Joined on NUL because a state id and a trigger word are both
				// constants but nothing here guarantees the pair cannot key alike
				// under a plainer separator, and this is the same escape `variantsOf`
				// writes for the same reason: a raw NUL hides the whole file from grep.
				const key = `${source}\u0000${first.transition.trigger}`;
				if (reported.has(key)) continue;
				reported.add(key);
				nondeterministic.push([source, first.transition.trigger]);
			}
		}
	}

	/**
	 * An end that is neither a state nor a reserved word — `mdangling/2`.
	 *
	 * The three reserved ids are exempt, and a reserved id in the *wrong position*
	 * is reported under its own name instead, because "this edge names a state you
	 * deleted" and "this edge tries to leave Exit" are two different mistakes and
	 * a designer fixes them two different ways.
	 */
	const dangling = live
		.filter(
			(t) =>
				(!ids.has(t.from) && !isReservedState(t.from)) ||
				(!ids.has(t.to) && !isReservedState(t.to)),
		)
		.map((t) => t.id);
	const misplaced = live
		.filter((t) => t.from === "exit" || t.to === "entry" || t.to === "any")
		.map((t) => t.id);

	const { fights, frameFights, turnFights } = layerFights(machine);

	/**
	 * A 1D blend stop outside the range its own input declares — `mstopout/3`.
	 *
	 * A stop the input can never reach is an animation that is in the file and
	 * never plays, which is the most expensive kind of dead code there is: it
	 * ships. An input with **no** declared range says nothing here, in both
	 * directions, which is `MachineInput.min`'s absent-is-open showing through
	 * where it matters — a check that invented a `0`..`100` range would report
	 * violations against a claim the designer never made.
	 */
	const stopsOutOfRange: Array<[string, number]> = [];
	for (const state of machine.states) {
		const blend = state.blend;
		if (!blend || blend.kind !== "oneD") continue;
		const input = findInput(machine, blend.input);
		if (!input) continue;
		const { min, max } = inputRange(input);
		for (const [index, stop] of blend.stops.entries()) {
			const at = stop.at === undefined ? undefined : permilleOf(stop.at);
			if (at === undefined) continue;
			if ((min !== undefined && at < min) || (max !== undefined && at > max)) {
				stopsOutOfRange.push([state.id, index]);
			}
		}
	}

	return {
		unreachable: machine.states
			.filter((state) => !reached.has(state.id))
			.map((state) => state.id),
		deadEnds: machine.states
			.filter((state) => !leaves.has(state.id))
			.map((state) => state.id),
		nondeterministic,
		dangling,
		impossible: edges.filter((e) => e.impossible).map((e) => e.transition.id),
		unreachableWithGuards: machine.states
			.filter((state) => !reachedWithGuards.has(state.id))
			.map((state) => state.id),
		misplaced,
		fights,
		frameFights,
		turnFights,
		stopsOutOfRange,
	};
}

/**
 * Which layers both have an opinion about one field of one part — `mfight/5`,
 * `mffight/5` and `mrfight/5`, computed in one pass because the three differ
 * only in which of a delta's three records is being read.
 *
 * **Static**: it fires when two layers *could* both write the field, whether or
 * not the two states that do are both on screen. That is the right default and
 * it is not laziness — a machine is a claim about all of its runs, and a check
 * that only fired in the universe you happened to be looking at would be a check
 * that passed until it shipped. The per-universe question ("why is this pixel
 * this colour") is `mfightat/6`'s, and it is answered against an answer set
 * rather than here.
 *
 * The program *resolves* the fight as well as reporting it — by layer order,
 * last writer wins — because it has to draw a picture, and two literals for one
 * `rendered/3` is not two designs but one arbitrary answer, silently. Nothing
 * here needs to know that: the resolution is {@link composeStates}' business,
 * and this is only the fact that there was a decision to make.
 *
 * `hidden` is deliberately in none of the three. Hiding does not conflict: two
 * layers that both take a part out of the picture agree, and one that hides
 * while another paints is not a disagreement about a value, it is a part that is
 * not there.
 */
function layerFights(machine: Machine): {
	fights: Array<[string, string, string, string]>;
	frameFights: Array<[string, string, string, string]>;
	turnFights: Array<[string, string, string, string]>;
} {
	/** `part + field -> the layers that own it`, one table per record. */
	const owners = {
		props: new Map<string, Set<string>>(),
		frame: new Map<string, Set<string>>(),
		turn: new Map<string, Set<string>>(),
	};
	for (const state of machine.states) {
		const layer = layerOf(machine, state);
		for (const [part, delta] of Object.entries(state.parts)) {
			for (const which of ["props", "frame", "turn"] as const) {
				for (const [field, value] of Object.entries(delta[which] ?? {})) {
					// An empty value decides nothing, so it owns nothing: a property
					// cleared in place is a leftover of an edit rather than a claim, and
					// a fight reported over one would be a fight over something nobody
					// is saying. `stateTouches`' judgement, applied one field at a time.
					if ((value?.length ?? 0) === 0) continue;
					const key = `${part}\u0000${field}`;
					const at = owners[which].get(key) ?? new Set<string>();
					at.add(layer);
					owners[which].set(key, at);
				}
			}
		}
	}

	const pairs = (
		table: Map<string, Set<string>>,
	): Array<[string, string, string, string]> => {
		const out: Array<[string, string, string, string]> = [];
		for (const [key, layers] of table) {
			if (layers.size < 2) continue;
			const [part, field] = key.split("\u0000");
			// Sorted so the pair reads `L1 < L2` the way the program's own rule
			// states it, which is what stops one fight being reported twice.
			const sorted = [...layers].sort();
			for (const [i, first] of sorted.entries()) {
				for (const second of sorted.slice(i + 1)) {
					out.push([first, second, part, field]);
				}
			}
		}
		return out;
	};

	return {
		fights: pairs(owners.props),
		frameFights: pairs(owners.frame),
		turnFights: pairs(owners.turn),
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

/**
 * The six checks the ladder adds, in the order §7.6 of the ladder spec lists
 * them — and **held apart from {@link MACHINE_CHECKS} rather than appended to
 * it**, which is a departure from the merged plan and is the one departure in
 * this file worth reading in full.
 *
 * The plan asks for one array of ten. One array of ten is what this should be,
 * and it is one line to make it so — `MACHINE_CHECKS.push` is not it; the two
 * arrays are spread into one at the single call site, `machineChecks()` in
 * `machinecheck.ts`. What stops it today is that **the six bodies name
 * predicates the generated program does not derive yet.** `mguardnever/2`,
 * `mgunreached/2`, `mfight/5`, `mffight/5`, `mrfight/5`, `mstopout/3`,
 * `mexit/3` and `mexitpast/2` all arrive with the ladder's compile step, which
 * lands after this one. A canned check offered before its predicate exists is
 * not merely inert: `addMachineCheck` writes the rule into `scene.rules`, the
 * compiler appends it verbatim, and clingo remarks once per undefined predicate
 * — which lands in `diagnostics`, which the studio shows to the designer as a
 * problem with *their* document.
 *
 * So the split is temporary and it has a trigger with a name. **When the ladder's
 * compile step has emitted its `#defined` block, delete this array and paste its
 * six entries onto the end of {@link MACHINE_CHECKS}.** Nothing else has to
 * change: `machineChecks()` is `[...MACHINE_CHECKS, durationBudgetCheck(budget)]`
 * and would then return eleven, which is exactly §7.6's table.
 *
 * Every rule is **one line**, including the two that are really two disjuncts,
 * and that is not cosmetic: `addMachineCheck` replaces the first line under a
 * head and drops the rest, so a check whose text spanned two lines would be a
 * check that could be half-edited by a person and half-restored by the panel.
 * Two rules separated by a space is legal ASP and keeps the unit of replacement
 * the unit of meaning.
 */
export const LADDER_CHECKS: Array<{ id: string; label: string; rule: string }> = [
	{
		id: "machine_guards_possible",
		label: "Every guard can be met",
		rule: "viol(machine_guards_possible) :- mguardnever(_,_).",
	},
	{
		id: "machine_states_live",
		label: "Every state is reachable through its guards",
		rule: "viol(machine_states_live) :- mgunreached(_,_).",
	},
	{
		/**
		 * The one check on this list a designer will switch off on purpose, and it
		 * is built to be switched off well: it is a `custom` rule, so "these two
		 * layers may fight over opacity and no others" is one added literal in the
		 * Rules panel and is still the same constraint with the same switch and the
		 * same name in the core.
		 *
		 * Three disjuncts rather than the plan's two, because the merge added
		 * `mrfight/5` for rotation after the plan's §7.3 was written and a check
		 * that reported a fight over `opacity` while staying silent about one over
		 * `rotateZ` would be a check that says it covers layers and does not.
		 */
		id: "machine_layers_agree",
		label: "No two layers write one property",
		rule:
			"viol(machine_layers_agree) :- mfight(_,_,_,_,_). " +
			"viol(machine_layers_agree) :- mffight(_,_,_,_,_). " +
			"viol(machine_layers_agree) :- mrfight(_,_,_,_,_).",
	},
	{
		id: "machine_blend_in_range",
		label: "Every blend stop is in range",
		rule: "viol(machine_blend_in_range) :- mstopout(_,_,_).",
	},
	{
		/**
		 * The brief's own words, shipped as the brief worded them: a transition
		 * that must wait longer to become available than it takes to run. That is
		 * nearly always a typo — the two numbers are in adjacent fields of one row.
		 */
		id: "machine_exit_within_duration",
		label: "No exit time longer than its transition",
		rule: "viol(machine_exit_within_duration) :- mexit(M,T,E), mdur(M,T,D), E > D.",
	},
	{
		/**
		 * And the deeper bug the literal reading does not catch: an exit time
		 * longer than the `from` state's own timeline, which makes the transition
		 * *unreachable* rather than merely odd, because the state finishes before
		 * the exit time elapses. Both ship, side by side, rather than one being
		 * silently substituted for the other.
		 */
		id: "machine_exit_before_end",
		label: "No exit time past its own state",
		rule: "viol(machine_exit_before_end) :- mexitpast(_,_).",
	},
];

/* ------------------------------------------------------------------ */
/* The runtime table, shared by the export and the studio              */
/* ------------------------------------------------------------------ */

/**
 * What a host has set, per instance: input id -> value.
 *
 * A boolean is a boolean; a number is a whole count of **thousandths**, the same
 * unit `permille/2` carries into the program and the same unit
 * {@link inputRange} answers in. One unit, everywhere, so that a threshold, a
 * range end and a live value are three numbers that can be compared without
 * anybody dividing by a thousand — which is the mistake this unit exists to make
 * impossible.
 *
 * **Triggers are not here.** A trigger does not persist: it is true for one
 * evaluation and gone, so it is handed in as a set of ids fired *for this
 * event* rather than stored. A store that kept one true would fire every guarded
 * edge on the next unrelated event, which reads to a person as a machine that
 * has gone off on its own.
 */
export type InputValues = Readonly<Record<string, boolean | number>>;

/**
 * One edge, as the two interpreters read it.
 *
 * A record rather than a bare destination — which is what the shipped table
 * carried — because an edge can now *refuse*. A guard that is not met and an
 * exit time that has not elapsed are both "this edge does not fire, try the next
 * one", and a lookup that answered with one destination could not express the
 * next one.
 */
export interface RuntimeEdge {
	/**
	 * The state it goes to, or `null` where it stops the layer.
	 *
	 * `null` rather than the word `exit`, because a stopped layer is not in a
	 * state called Exit — it keeps whatever state it was last in, its classes stay
	 * on the element, and what changed is that it no longer answers. A runtime
	 * that wrote `data-state="exit"` would match no rule in the stylesheet and
	 * would look exactly like a machine that had failed.
	 */
	to: string | null;
	/** Every condition, all of which must hold. Absent is an unguarded edge. */
	when?: Array<{ input: string; op: CompareOp; value?: boolean | number }>;
	/** Milliseconds the from-state must have been held. Absent is zero. */
	exit?: number;
}

/**
 * One layer, as the two interpreters read it.
 *
 * Its own initial state, its own states and its own edge table, because a layer
 * is what is in exactly one state at a time. The machine is in one state *per
 * layer*, all at once, which is the whole of rung four in one sentence.
 */
export interface RuntimeLayer {
	id: string;
	initial: string;
	states: string[];
	/**
	 * from -> trigger -> the edges to try, **in order**.
	 *
	 * A list rather than one destination, because a guard can refuse and the next
	 * edge has to get its turn. Specific edges first, then Any edges, document
	 * order within each — which is the shipped "first enabled transition wins"
	 * with one tie-break in front of it, and the tie-break is Rive's: a fallback
	 * that beat the specific case would be a fallback nobody could override.
	 */
	edges: Record<string, Partial<Record<Trigger, RuntimeEdge[]>>>;
}

export interface MachineTable {
	instances: Record<
		string,
		{
			machine: string;
			/**
			 * The **first layer's** starting state — what {@link shownState} says.
			 *
			 * Kept as a single string rather than widened to a record, which is a
			 * departure from the ladder spec and is stated here rather than hidden.
			 * The spec replaces this field with `Record<layer, state>` and calls the
			 * breakage "the intended way to make it"; the two readers it breaks —
			 * `runtime.test.ts` and the studio's playback hook — belong to later
			 * steps and are not this one's to edit. So the shipped field keeps its
			 * shipped meaning, {@link layerStart} carries the per-layer answer, and
			 * when those two steps land this field goes and `layerStart` takes its
			 * name.
			 */
			initial: string;
			/**
			 * Layer id -> the state this instance starts that layer in.
			 *
			 * **Optional only because two files this step does not own build a
			 * `MachineTable` by hand**, and a required field would fail their
			 * typecheck rather than their tests. `machineTable` always fills it, so
			 * a table this file built never has it absent, and a reader that finds
			 * it missing is reading a table somebody wrote out in a fixture. When
			 * `runtime.test.ts` and the studio's playback hook move to the layered
			 * shape, this loses the `?` and `initial` above it goes.
			 */
			layerStart?: Record<string, string>;
		}
	>;
	machines: Record<
		string,
		{
			/** The **first layer's** initial state — see the note on `initial` above. */
			initial: string;
			/** Every state of the machine, every layer, in document order. */
			states: string[];
			/**
			 * from -> trigger -> to, first enabled transition wins.
			 *
			 * The shipped edge table, kept for the shipped readers and carrying the
			 * shipped answers: no guards, no Any expansion, no exit gate, one
			 * destination. {@link layers} is the same information said properly, and
			 * `stepLayer` reads that one.
			 */
			edges: Record<string, Partial<Record<Trigger, string>>>;
			/**
			 * The layers, in order. Never empty; a machine with none has one.
			 *
			 * Optional for the reason `layerStart` above is, and it goes at the same
			 * moment.
			 */
			layers?: RuntimeLayer[];
			/**
			 * What a host may hand this machine.
			 *
			 * Values are in the units {@link InputValues} states: a boolean is a
			 * boolean and a number is thousandths. A trigger has no `initial`,
			 * because "not fired" is the absence of a value rather than one.
			 */
			inputs?: Record<
				string,
				{
					kind: InputKind;
					initial?: boolean | number;
					min?: number;
					max?: number;
				}
			>;
		}
	>;
}

/**
 * Every machine the document actually runs, flattened into the smallest thing an
 * interpreter needs.
 *
 * A table rather than generated code per machine, because the same table is read
 * by two interpreters that must not be able to disagree: {@link stepLayer} in
 * the studio, and the runtime in the exported file. One lookup, one answer, and
 * `runtime.test.ts` runs the emitted text against this to prove it.
 *
 * Six decisions are worth writing down, because each drops something a reader
 * might expect to find:
 *
 *   - **`initial` is per instance, not per machine.** The machine's own initial
 *     state is in `machines[m].initial`; the instance's is what
 *     {@link shownStates} says, which is the machine's initial unless the
 *     document put that instance in another state. That is what `SceneNode.state`
 *     means in an export: the file starts where the document was drawn, and the
 *     *CSS base* is still the machine's initial state — a different question,
 *     answered in `export.ts`.
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
 *   - **An edge whose guard can never be met is left out**, for the dangling
 *     edge's reason exactly: it is an edge no valuation takes, so carrying it
 *     would ship bytes that can only ever be skipped, and the designer hears
 *     about it from `machine_guards_possible` rather than from a runtime that
 *     silently never moves.
 *   - **A cross-layer edge is left out.** A layer is in one state at a time and
 *     its states are its own; an edge from a state of layer one to a state of
 *     layer two would write, into layer one's attribute, a state id whose only
 *     rules are under layer two's selector. `mcrosslayer/2` reports it; the
 *     runtime cannot honour it, so it does not pretend to.
 *
 * `context` is the universe's, and it reaches exactly one number: an edge's
 * **exit time**, the only motion setting that lands in this table rather than in
 * a CSS `transition:` declaration. Optional and defaulting to nothing for every
 * caller that has no universe to hand — but a caller that *has* one owes it,
 * because {@link transitionExit} resolves a {@link Value}, and an exit time that
 * names a `duration` token resolves to nothing without it and is then dropped
 * from the table as a zero. That was live and silent: the exported file's own
 * `lost` sentence read the same edge *with* a context and announced a 180ms
 * debounce, while the runtime embedded three lines above it waited zero. A
 * motion scale with a hole in it is precisely what pacing-as-a-token exists to
 * prevent, so the hole is closed here rather than papered over at the reader.
 */
export function machineTable(
	scene: Scene,
	context: ResolveContext = NO_CONTEXT,
): MachineTable {
	const instances: MachineTable["instances"] = {};
	const machines: MachineTable["machines"] = {};

	for (const node of instanceNodes(scene)) {
		const machine = machineForNode(scene, node);
		if (!machine || machine.states.length === 0) continue;
		instances[node.id] = {
			machine: machine.id,
			initial: shownState(machine, node),
			layerStart: shownStates(machine, node),
		};
		if (machines[machine.id] !== undefined) continue;

		const ids = new Set(machine.states.map((state) => state.id));

		// The shipped table, built by the shipped loop, so that every reader that
		// has not learned about layers gets byte-for-byte the answers it got.
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

		const inputs: MachineTable["machines"][string]["inputs"] = {};
		for (const input of machine.inputs ?? []) {
			const initial = inputInitial(input);
			const { min, max } = inputRange(input);
			inputs[input.id] = {
				kind: input.kind,
				...(initial === undefined ? {} : { initial }),
				...(min === undefined ? {} : { min }),
				...(max === undefined ? {} : { max }),
			};
		}

		machines[machine.id] = {
			initial: initialState(machine).id,
			states: machine.states.map((state) => state.id),
			edges,
			layers: runtimeLayers(machine, context),
			inputs,
		};
	}

	return { instances, machines };
}

/**
 * The per-layer half of {@link machineTable}, split out so the loop above reads.
 *
 * `context` is carried through rather than defaulted here, because this is the
 * one place an exit time is resolved and a second default would be a second
 * answer to "what does a token-paced debounce come to".
 */
function runtimeLayers(machine: Machine, context: ResolveContext): RuntimeLayer[] {
	const out: RuntimeLayer[] = [];
	for (const layer of machineLayers(machine)) {
		const states = layerStates(machine, layer.id);
		const initial = states[0];
		const own = new Set(states.map((state) => state.id));
		const edges: RuntimeLayer["edges"] = {};

		// Two passes over the transitions rather than one pass and a sort, because
		// "specific edges first, then Any edges, document order within each" is
		// exactly two passes — and a sort would have needed a stable comparator
		// plus a rank field carried on every row so that it could be compared.
		for (const rank of [1, 2] as const) {
			for (const transition of machine.transitions) {
				if (!transition.enabled) continue;
				// An edge with a reserved word at *both* ends names no state anywhere,
				// so nothing can say which layer it runs in — `any` to `exit` is "stop
				// some layer", and there is no answer to which. It belongs to no layer
				// and is dropped, which is the same answer `machineHealth` gives it
				// through `layerOfEdge`. Without this check the destination test below
				// never runs (an `exit` destination is `null` before it is looked up)
				// and the edge would quietly be added to every layer at once.
				if (isReservedState(transition.from) && isReservedState(transition.to)) continue;
				const isAny = transition.from === "any";
				if ((isAny ? 2 : 1) !== rank) continue;
				if (guardImpossible(machine, transition)) continue;

				// Where it may be taken from, within *this* layer.
				let sources: string[];
				if (isAny) {
					sources = states.map((state) => state.id);
				} else if (transition.from === "entry") {
					sources = initial ? [initial.id] : [];
				} else if (transition.from === "exit") {
					sources = [];
				} else if (own.has(transition.from)) {
					sources = [transition.from];
				} else {
					sources = [];
				}
				if (sources.length === 0) continue;

				// Where it goes. `exit` stops the layer; anything else has to be a
				// state of this same layer, or the runtime would write an id whose
				// rules live under another layer's selector.
				let to: string | null;
				if (transition.to === "exit") to = null;
				else if (own.has(transition.to)) to = transition.to;
				else continue;

				const when = runtimeGuard(machine, transition);
				if (when === undefined) continue;
				const exit = transitionExit(machine, transition, context);

				for (const source of sources) {
					const row = (edges[source] ??= {});
					const list = (row[transition.trigger] ??= []);
					list.push({
						to,
						...(when.length === 0 ? {} : { when }),
						...(exit === 0 ? {} : { exit }),
					});
				}
			}
		}

		out.push({
			id: layer.id,
			// A layer nobody has put a state in yet has no initial state, and the
			// empty string is what a JSON table can say about that. It is a real
			// document — a layer somebody has just added — rather than a degenerate
			// one, and the runtime's own `set` already refuses to write a state id it
			// does not recognise, so an empty layer starts nothing and breaks
			// nothing.
			initial: initial ? initial.id : "",
			states: states.map((state) => state.id),
			edges,
		});
	}
	return out;
}

/**
 * A transition's conditions as the runtime evaluates them, or nothing where one
 * of them is not a condition at all.
 *
 * The comparand is converted **here**, once, into the unit the store holds —
 * `true`/`false` for a boolean, thousandths for a number — so that the two
 * interpreters compare two numbers rather than each parsing a string. A `fired`
 * condition carries no comparand, because "the trigger happened" is the whole of
 * what there is to say about a moment.
 *
 * `undefined` for a guard holding a condition the compiler would report as
 * `mcbad/3`: the edge is unusable and is dropped from the table entirely, rather
 * than shipped with a condition the runtime would have to invent an answer for.
 */
function runtimeGuard(
	machine: Machine,
	transition: Transition,
): RuntimeEdge["when"] | undefined {
	const out: NonNullable<RuntimeEdge["when"]> = [];
	for (const condition of transition.conditions ?? []) {
		const normal = normalizeCondition(machine, condition);
		if (normal.kind === "bad") return undefined;
		if (normal.kind === "fired") {
			out.push({ input: normal.input, op: "fired" });
			continue;
		}
		const value =
			normal.kind === "is" || normal.kind === "isNot"
				? normal.value
				: // A window is not what the runtime wants — it wants the operator and
					// the number the designer typed, because it is comparing against a
					// live value rather than against another window. So the comparand is
					// read straight, through the same reader the window was built with.
					permilleOf(condition.value ?? "");
		if (value === undefined) return undefined;
		out.push({ input: condition.input, op: condition.op, value });
	}
	return out;
}

/**
 * How long a transition's `from` state must have been held before the edge may
 * be taken, in whole milliseconds — Rive's exit time, and the fourth motion
 * setting.
 *
 * Read **out of band** rather than through `motionMs`, and the reason is a
 * blocker one step upstream rather than a design choice here: `MotionProp` does
 * not yet hold `"exit"`, because adding the union member breaks
 * `MOTION_DEFAULT_PREDICATES` in `compile.ts`, which is a file the document-types
 * step did not own. `Transition.exit` is a `duration` {@link Value} exactly like
 * the other three, resolved against the same `mval(M,T,exit)` key the program
 * mints, so the moment `MOTION_PROPS.exit` exists this whole function becomes
 * `motionMs(machine, transition, "exit")` and goes.
 *
 * Clamped at zero for `duration`'s reason and not `delay`'s: a negative exit time
 * would be a transition takeable before its own state began, which is not a thing
 * to ask for however generously it is read. Zero is the default, and zero means
 * "any time" — which is what every transition in every existing document means,
 * and why this reader is invisible on all of them.
 */
export function transitionExit(
	machine: Machine,
	transition: Transition,
	context: ResolveContext = NO_CONTEXT,
): number {
	const resolved = resolveValue(
		context,
		transition.exit,
		motionVar(machine.id, transition.id, "exit"),
	);
	const read = resolved === undefined ? undefined : msOf(resolved);
	return Math.max(0, read ?? 0);
}

/**
 * Whether one edge may be taken right now.
 *
 * Split out because it is the one piece three callers need — the studio, the
 * emitted runtime and the panel's explanation of a refusal — and because a guard
 * evaluated in two places is a guard that can be evaluated two ways. That is the
 * same argument the table itself makes one level up, and it is the reason
 * `runtime.test.ts` can prove the exported text and the studio agree.
 *
 * An input the host has **not set** fails every condition about it except
 * `fired`, and that is a decision rather than a fallthrough: the store is seeded
 * from every input's declared initial, so a missing entry means the input is not
 * one of this machine's at all, and a guard about a value the machine has not got
 * is a guard that cannot be met. Answering "true" would let a typo open an edge.
 *
 * The exit gate is `heldMs < exit`, strictly — an edge with a 300ms exit time
 * fires *at* 300ms. A trigger arriving before then is **dropped and not
 * remembered**, which is a stated departure from Rive: Rive would fire the
 * transition when the time elapsed if the condition still held. The reason is
 * `runtime.ts`'s own — a deferred fire is a state change nobody's finger caused,
 * arriving at a moment nothing on the page marks, and a runtime with a queue in
 * it is a second animator arguing with the compositor.
 */
export function edgeAllows(
	edge: RuntimeEdge,
	inputs: InputValues = {},
	fired: ReadonlySet<string> = new Set(),
	heldMs = Number.POSITIVE_INFINITY,
): boolean {
	if (edge.exit !== undefined && heldMs < edge.exit) return false;
	for (const condition of edge.when ?? []) {
		if (condition.op === "fired") {
			if (!fired.has(condition.input)) return false;
			continue;
		}
		const held = inputs[condition.input];
		if (held === undefined) return false;
		const want = condition.value;
		if (typeof held === "boolean" || typeof want === "boolean") {
			// A boolean answers `eq` and `ne` and nothing else, and an operator its
			// kind does not take is refused rather than read as one of the two. The
			// table never carries such an edge — `normalizeCondition` calls it `bad`
			// and `machineTable` drops it — so this is the second of two answers to
			// one question, and the two agreeing is what keeps a hand-written table
			// in a fixture from behaving differently from a generated one.
			if (typeof held !== "boolean" || typeof want !== "boolean") return false;
			if (condition.op !== "eq" && condition.op !== "ne") return false;
			if (condition.op === "eq" ? held !== want : held === want) return false;
			continue;
		}
		if (want === undefined) return false;
		const ok =
			condition.op === "eq"
				? held === want
				: condition.op === "ne"
					? held !== want
					: condition.op === "gt"
						? held > want
						: condition.op === "lt"
							? held < want
							: condition.op === "ge"
								? held >= want
								: held <= want;
		if (!ok) return false;
	}
	return true;
}

/**
 * Where one trigger takes one **layer**, or nothing where it takes it nowhere.
 *
 * Three answers, and the three are distinguishable on purpose. `undefined` is
 * "nothing moved" — no edge, or every edge refused. `null` is "the layer
 * stopped", which keeps whatever state it was last in and stops answering. A
 * string is where it went. A caller that conflated the first two would keep
 * listening to a machine that has said it is finished, and one that conflated
 * `null` with a state id would write a `data-state` no rule matches.
 *
 * The edges are tried **in the order the table holds them** — specific before
 * Any, document order within each — and the first one the guard admits wins.
 * That is the whole of the precedence rule, and it lives in the table rather
 * than here so that the exported runtime, which reads the same list, cannot
 * order it differently.
 */
export function stepLayer(
	table: MachineTable,
	instance: string,
	layer: string,
	current: string,
	trigger: Trigger,
	inputs?: InputValues,
	fired?: ReadonlySet<string>,
	heldMs?: number,
): string | null | undefined {
	const at = table.instances[instance];
	if (at === undefined) return undefined;
	const row = (table.machines[at.machine]?.layers ?? []).find((l) => l.id === layer);
	for (const edge of row?.edges[current]?.[trigger] ?? []) {
		if (edgeAllows(edge, inputs, fired, heldMs)) return edge.to;
	}
	return undefined;
}

/**
 * Where one trigger takes one instance: every layer stepped, in layer order.
 *
 * **This is the function the ladder spec calls `stepMachine`.** It is named
 * `stepInstance` here because the shipped `stepMachine` still occupies that
 * name: its signature takes one current state and returns one, and the two
 * readers that call it that way — `runtime.test.ts` and the studio's playback
 * hook — belong to later steps that this one may not edit. When those land, the
 * shipped function goes, this one takes the name, and nothing else changes. The
 * spec's judgement that there is "no honest adapter" is right, which is exactly
 * why the two are two functions rather than one with two meanings.
 *
 * Layers are stepped **independently and all at once**, which is what a layer
 * *is*: one trigger may move the press layer and leave the glow layer where it
 * was, and both answers are true in the same moment. Nothing is stepped twice
 * and no layer sees another's new state, so the order of the walk cannot change
 * the answer.
 *
 * `undefined` where nothing moved anywhere — the same answer, for the same
 * reason, that `stepLayer` gives per layer. A layer that stopped is `null` in
 * the returned record and its state is unchanged; a caller that wants only the
 * states reads the entries that are strings. That is a widening of the spec's
 * `Record<string, string>`, and it is the same widening `stepLayer` already
 * argues for: it would be strange for the per-layer answer to distinguish a stop
 * and the whole-instance answer to erase it.
 */
export function stepInstance(
	table: MachineTable,
	instance: string,
	current: Readonly<Record<string, string>>,
	trigger: Trigger,
	inputs?: InputValues,
	fired?: ReadonlySet<string>,
	heldMs?: Readonly<Record<string, number>>,
): Record<string, string | null> | undefined {
	const at = table.instances[instance];
	if (at === undefined) return undefined;
	const machine = table.machines[at.machine];
	if (machine === undefined) return undefined;

	const out: Record<string, string | null> = {};
	let moved = false;
	for (const layer of machine.layers ?? []) {
		// A layer the caller said nothing about is left out of the answer entirely
		// rather than started at its initial state. Where a layer *is* is the
		// caller's to know — it is editor state in the studio and a closure
		// variable in the exported runtime — and a stepper that filled one in would
		// be a stepper that could move a layer the caller had deliberately stopped.
		const from = current[layer.id];
		if (from === undefined) continue;
		const to = stepLayer(
			table,
			instance,
			layer.id,
			from,
			trigger,
			inputs,
			fired,
			heldMs?.[layer.id],
		);
		if (to === undefined) {
			out[layer.id] = from;
			continue;
		}
		moved = true;
		out[layer.id] = to;
	}
	return moved ? out : undefined;
}

/**
 * Where one trigger takes one instance, or nothing where it takes it nowhere.
 *
 * **The shipped signature, kept, and it means the first layer.** Every caller
 * that has it today is asking about a one-layer machine and gets exactly the
 * answer it got, off exactly the table it read: no guards, no Any expansion, no
 * exit gate. {@link stepInstance} is the same question asked properly, and it is
 * what the later steps move to.
 *
 * The studio's canvas playback calls this directly and the exported runtime
 * interprets the same rows, so "what does clicking do" has one answer rather
 * than two that drift. Playing a state costs no solve at all: every state's
 * `frame/3` and `rendered/3` are already in the one answer set, so the canvas
 * reads a different entry out of the model it already has.
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

/* ------------------------------------------------------------------ */
/* Composing layers, sampling timelines, mixing a blend                */
/* ------------------------------------------------------------------ */

/**
 * What the picture is, once every layer has had its say — the composite pose,
 * as one delta per definition part.
 *
 * This is the *only* place the layers are composed, and it is deliberately not
 * where a state copy lives. A copy — `stt(I,S,N)` — is one layer's pose **in
 * isolation**: everything it does not own it reads from the instance's own
 * variable, never from whatever layer one happens to be showing. That is the
 * only reading that keeps a copy meaningful, because a copy that composed the
 * other layers in would depend on which state every *other* layer was in, which
 * would make it a copy per combination — the cross product this whole design
 * exists not to build. The composite exists in exactly one place, `inst(I,N)`,
 * which is what draws, what exports, and what a rule about the picture names.
 *
 * **Later layers win, per field.** The order *is* the priority — the same "the
 * order is the answer" the initial state and `order/2` already use — so there is
 * no priority field to disagree with the list. The resolution is per *field* and
 * not per part: a layer that moves a badge and a layer that recolours it are not
 * fighting, and a rule that resolved per part would silently drop the move.
 *
 * The program does exactly this through `mwriter/4`, `mfwriter/4` and
 * `mrwriter/4` — the last layer that owns the field — and the two answers being
 * the same is what lets the export write the layers in document order and let
 * the cascade do the work. What the program *also* does, and Rive does not, is
 * report that there was a decision to make: {@link layerFights} derives it and
 * `machine_layers_agree` turns it into a violation with a name, a switch and a
 * `why`.
 *
 * `hidden` is a union rather than a last-writer, because hiding does not
 * conflict: two layers that both take a part out of the picture agree, and one
 * that hides while another paints is not a disagreement about a value, it is a
 * part that is not there. Any layer that hides, hides.
 */
export function composeStates(
	machine: Machine,
	shown: Readonly<Record<string, string>>,
): Record<string, StatePart> {
	const out: Record<string, StatePart> = {};
	for (const layer of machineLayers(machine)) {
		const state = findState(machine, shown[layer.id]);
		// Only the state of *this* layer counts, whatever the record says. A record
		// that named layer two's state under layer one is a caller's mistake, and
		// letting it through would compose one layer's pose twice.
		if (!state || layerOf(machine, state) !== layer.id) continue;
		for (const [part, delta] of Object.entries(state.parts)) {
			const at = (out[part] ??= {});
			if (delta.hidden === true) at.hidden = true;
			for (const which of ["props", "frame", "turn"] as const) {
				for (const [field, value] of Object.entries(delta[which] ?? {})) {
					// An empty value decides nothing and so overwrites nothing: a
					// property cleared in place is a leftover of an edit, and letting one
					// blank out a lower layer's opinion would make deleting a row in one
					// panel change the picture in another.
					if ((value?.length ?? 0) === 0) continue;
					const table = (at[which] ??= {}) as Record<string, Value>;
					table[field] = value as Value;
				}
			}
		}
	}
	return out;
}

/**
 * How a transition is paced in this universe, as the literal it resolved to.
 *
 * **Text and not an {@link Easing}**, which looks like a loss of type safety and
 * is the opposite: the answer may be a menu word (`"springSnappy"`) or a custom
 * curve (`"cubicBezier(200,0,0,1000)"`), and a union of those two shapes would
 * be a union every caller had to destructure before it could hand the thing to
 * {@link cssEasing}, which takes text. Text is the currency everywhere else in
 * this system — a literal has no type and the reader is chosen by what the value
 * *is* — and an easing is not the place to invent a second convention.
 *
 * Falls back to {@link DEFAULT_EASING} in all three of the ways the program
 * does: where the transition says nothing, where what it says resolves to
 * nothing, and where what it resolves to is neither a word the menu knows nor a
 * curve {@link bezierOf} reads. All three are `not mreadsease(M,T)` in ASP, and
 * that is the point — {@link cssEasing} would otherwise write a timing function
 * no browser parses.
 */
export function easingOf(
	machine: Machine,
	transition: Transition,
	context: ResolveContext = NO_CONTEXT,
): string {
	const resolved = resolveValue(
		context,
		transition.easing,
		motionVar(machine.id, transition.id, "easing"),
	);
	return curveOf(resolved) ?? DEFAULT_EASING;
}

/**
 * The same reader over the segment *leaving* one keyframe.
 *
 * The **last** keyframe's easing is read by nothing, because there is no segment
 * leaving it. It is kept in the document rather than refused — a keyframe that
 * stops being last should not lose what somebody typed — and it is simply never
 * asked for here.
 */
export function keyEasing(
	machine: Machine,
	timeline: Timeline,
	track: string,
	index: number,
	key: Keyframe,
	context: ResolveContext = NO_CONTEXT,
): string {
	const resolved = resolveValue(
		context,
		key.easing,
		keyEaseVar(machine.id, timeline.id, track, index),
	);
	return curveOf(resolved) ?? DEFAULT_EASING;
}

/** One keyframe of one track, with the millisecond this universe put it at. */
export interface SolvedKeyframe {
	/** 1-based, in the document's own order — the index the term names. */
	index: number;
	at: number;
	key: Keyframe;
}

/**
 * Every keyframe of one track, in the order this universe puts them in.
 *
 * The times are `Value`s, so they resolve per universe, so **a keyframe can land
 * before the one in front of it** in a universe where a token went the other way.
 * That is not something a linter over the document could ever catch — it is a
 * property of an answer, not of a document — and it is exactly the class of bug a
 * multiverse invents. The program derives it as `mkbackwards/4` and offers it to
 * the Rules panel; here it is simply sorted through, so that a sampler never has
 * to reason about a segment that runs backwards.
 *
 * A **stable** sort on the resolved time, so two keyframes at one millisecond
 * keep their document order — which is the same tie-break the document reader
 * uses when it sorts the list, and having the two agree is what keeps "key 3" the
 * same keyframe in the panel, in the term and in the answer set.
 *
 * A keyframe whose time reads as no duration at all sits at **0** rather than
 * being dropped: it is a keyframe somebody wrote, the panel has to be able to
 * show it, and dropping it would renumber every key after it and quietly change
 * which one a rule was about.
 */
export function solvedKeys(
	machine: Machine,
	timeline: Timeline,
	track: Track,
	context: ResolveContext = NO_CONTEXT,
): SolvedKeyframe[] {
	const term = trackTerm(track);
	if (term === undefined) return [];
	return track.keys
		.map((key, i) => {
			const at = resolveValue(context, key.at, keyTimeVar(machine.id, timeline.id, term, i + 1));
			const ms = at === undefined ? undefined : msOf(at);
			return { index: i + 1, at: Math.max(0, ms ?? 0), key };
		})
		.sort((a, b) => a.at - b.at || a.index - b.index);
}

/**
 * How long a timeline runs, in milliseconds: what it says, or its last keyframe.
 *
 * Derived rather than stored where the document is silent, so **a timeline
 * cannot disagree with its own contents**: a document that stored the end twice
 * would be a document where moving the last keyframe left the length behind.
 * Present and *shorter* than the last keyframe is legal and means what it says —
 * the tail is not played — which is why this is not a max of the two.
 *
 * The value is a `duration` {@link Value} like every other time here, so a
 * timeline can name the same motion scale a transition does and retime with it.
 */
export function timelineLength(
	machine: Machine,
	timeline: Timeline,
	context: ResolveContext = NO_CONTEXT,
): number {
	const stated = resolveValue(
		context,
		timeline.length,
		timelineLenVar(machine.id, timeline.id),
	);
	const read = stated === undefined ? undefined : msOf(stated);
	if (read !== undefined) return Math.max(0, read);
	let last = 0;
	for (const track of timeline.tracks) {
		for (const key of solvedKeys(machine, timeline, track, context)) {
			if (key.at > last) last = key.at;
		}
	}
	return last;
}

/**
 * Where a timeline is at a given elapsed time, once its loop mode has had its
 * say — a position inside `[0, length]`.
 *
 * Folded here rather than at each caller because the three modes are three
 * different arithmetics and a canvas that folded one way while an export folded
 * another would be two animations of one document. `pingPong` runs the timeline
 * forwards and then backwards over a period of twice its length, which is what
 * the word means and what `animation-direction: alternate` does; `loop` is the
 * remainder; `none` clamps and stays at the end.
 *
 * A zero-length timeline is at 0 forever, which is the only answer that is not a
 * division by zero — and it is a real state rather than a degenerate one, because
 * a timeline somebody has just created has no keyframes yet.
 *
 * Negative elapsed time is clamped to 0. Unlike a transition's delay, which may
 * legitimately be negative to start a move partway through, there is no reading
 * of "before the timeline started" that is not simply the first frame.
 */
export function timelinePosition(
	ms: number,
	length: number,
	loop: LoopMode = "none",
): number {
	if (length <= 0) return 0;
	const elapsed = Math.max(0, ms);
	if (loop === "none") return Math.min(elapsed, length);
	if (loop === "loop") return elapsed % length;
	const swung = elapsed % (length * 2);
	return swung <= length ? swung : length * 2 - swung;
}

/** One track, sampled: which two keyframes a moment sits between, and how far. */
export interface TrackSample {
	/** The track's own term — `trkd(panel,y)`. */
	track: string;
	part: string;
	/** The keyframe at or before the moment. Absent before the first one. */
	from?: SolvedKeyframe;
	/** The keyframe after it. Absent at or past the last one. */
	to?: SolvedKeyframe;
	/** How far between the two, 0..1. Zero wherever there is nothing to travel to. */
	t: number;
	/**
	 * The curve the segment leaving `from` uses, as the literal it resolved to.
	 *
	 * Text rather than an {@link Easing} for {@link easingOf}'s reason exactly: a
	 * custom bezier is a curve a keyframe may name and is not a member of that
	 * union, and every consumer of this field hands it to {@link cssEasing}.
	 */
	easing: string;
}

/**
 * Every track of a timeline, sampled at one moment.
 *
 * **This is the whole of what "playing" costs, and it costs no solve.** Every
 * keyframe's value is already in the one answer set — that is what the `kval`
 * variables are — so scrubbing is reading two entries out of a model the studio
 * already has and interpolating between them. There is no frame rate here, in the
 * program, in the model or in the export: the solver decides keyframes and never
 * frames, and grounding scales with how many keyframes a document holds and with
 * nothing else.
 *
 * What comes back is **which two keyframes and how far**, not a value. That is
 * the honest boundary: what is between two keyframes depends on what is being
 * animated — a colour interpolates in a colour space, a length in EMU, a
 * rotation in thousandths of a degree, and a word does not interpolate at all —
 * and this file knows about documents rather than about pixels. The canvas mixes;
 * this says what to mix.
 *
 * The easing returned is the one on `from`, because easing describes the segment
 * *leaving* a keyframe. Before the first keyframe there is no segment and the
 * default stands in.
 *
 * A track with no field is skipped entirely rather than sampled to nothing: it is
 * not a track, `trackTerm` says so, and a sample keyed by a term that does not
 * exist would be an entry no caller could ever match up with anything.
 */
export function sampleTimeline(
	machine: Machine,
	timeline: Timeline,
	ms: number,
	context: ResolveContext = NO_CONTEXT,
): Record<string, TrackSample> {
	const at = timelinePosition(
		ms,
		timelineLength(machine, timeline, context),
		timeline.loop ?? "none",
	);
	const out: Record<string, TrackSample> = {};
	for (const track of timeline.tracks) {
		const term = trackTerm(track);
		if (term === undefined) continue;
		const keys = solvedKeys(machine, timeline, track, context);

		let from: SolvedKeyframe | undefined;
		let to: SolvedKeyframe | undefined;
		for (const key of keys) {
			if (key.at <= at) from = key;
			else {
				to = key;
				break;
			}
		}
		// Zero where there is nowhere to travel to *and* where the two keyframes
		// share a millisecond, which is a legal thing to write — it is how a
		// designer says "snap" — and which would otherwise be a division by zero
		// dressed up as an interpolation.
		const span = from && to ? to.at - from.at : 0;
		const t = span > 0 && from ? (at - from.at) / span : 0;
		out[term] = {
			track: term,
			part: track.part,
			...(from === undefined ? {} : { from }),
			...(to === undefined ? {} : { to }),
			t,
			easing: from
				? keyEasing(machine, timeline, term, from.index, from.key, context)
				: DEFAULT_EASING,
		};
	}
	return out;
}

/** One stop of a blend, and how much of it is in the mix. */
export interface BlendWeight {
	/** Its position in `Blend.stops`, so a caller can point at the row. */
	index: number;
	/** The timeline it plays, as an id — dangling ids are not in the answer. */
	timeline: string;
	/** 0..1. The weights of a 1D blend sum to 1; a direct blend's need not. */
	weight: number;
}

/**
 * How much of each stop is in the picture right now.
 *
 * **None of this is solved and none of it can be**: the mixing is arithmetic over
 * a runtime value, and a runtime value is not in the program. What *is* solved is
 * everything the stops are made of — every keyframe of every timeline a stop
 * names, with its time and its value — and everything the checks need, which is
 * the thresholds against the input's declared range. So this is a pure reading
 * over a live value, exactly like {@link edgeAllows}, and it costs no solve for
 * the same reason.
 *
 * **1D** lays the stops out along one number input and mixes the two either side
 * of where it sits. Outside the outermost stops the nearest one plays flat, which
 * is what `mstopgap/2` reports as a fact about the design rather than a fault:
 * part of the axis playing one timeline unchanged is legal and sometimes meant.
 * The stops are sorted by threshold here rather than trusted in document order,
 * because the order they are *listed* in is an editing convenience and the order
 * they are *laid out* in is the design.
 *
 * **Direct** gives each stop its own weight input, read as a ratio and clamped to
 * `[0,1]`. Nothing normalises them: a direct blend with two stops at full weight
 * is what somebody asked for, and dividing by the sum would silently turn "both,
 * fully" into "half each".
 *
 * A stop whose timeline the machine has not got is left out, the same silence a
 * dangling `instanceOf` leaves. An input the store has not been given falls back
 * to the input's own declared initial, because that is what the store is seeded
 * from and answering nothing at all would make a blend look broken the instant
 * before the first event.
 *
 * **What the export carries is one stop of this**, and that is scaffolding rather
 * than a feature: CSS has no way to mix two keyframe animations by a number, so
 * the file carries the stop nearest where the input starts and says so in a
 * `lost` entry. The studio canvas does the real thing, off this function.
 */
export function blendWeights(
	machine: Machine,
	blend: Blend,
	inputs: InputValues = {},
): BlendWeight[] {
	const live = (id: string | undefined): number | undefined => {
		if (id === undefined) return undefined;
		const input = findInput(machine, id);
		if (!input || input.kind !== "number") return undefined;
		const held = inputs[id];
		if (typeof held === "number") return held;
		const initial = inputInitial(input);
		return typeof initial === "number" ? initial : undefined;
	};

	const held = blend.stops
		.map((stop, index) => ({ stop, index }))
		.filter(({ stop }) => findTimeline(machine, stop.timeline) !== undefined);

	if (blend.kind === "direct") {
		return held.map(({ stop, index }) => ({
			index,
			timeline: stop.timeline,
			weight: Math.min(1, Math.max(0, (live(stop.by) ?? 0) / 1000)),
		}));
	}

	const at = live(blend.input);
	const laid = held
		.map(({ stop, index }) => ({
			index,
			timeline: stop.timeline,
			at: stop.at === undefined ? undefined : permilleOf(stop.at),
		}))
		.filter((s): s is { index: number; timeline: string; at: number } => s.at !== undefined)
		.sort((a, b) => a.at - b.at || a.index - b.index);

	if (laid.length === 0) return [];
	const first = laid[0];
	const last = laid[laid.length - 1];
	// No input, no reading, or a half-built blend with one stop: the first stop
	// plays flat. That is the same answer the axis gives outside its own ends, and
	// giving a different one here would make a blend whose input was deleted draw
	// nothing rather than draw something.
	if (at === undefined || at <= first.at) {
		return [{ index: first.index, timeline: first.timeline, weight: 1 }];
	}
	if (at >= last.at) {
		return [{ index: last.index, timeline: last.timeline, weight: 1 }];
	}
	// Landing exactly on a stop is that stop, alone. The bracket search below
	// would arrive at the same picture — one weight of 1 and one of 0 — but it
	// would say it with an entry naming a timeline that is not playing, and every
	// caller would then have to filter zeroes before it could ask "which
	// timelines are running". The earliest stop at that threshold wins, which is
	// the same tie-break document order gets everywhere else here.
	const exact = laid.find((stop) => stop.at === at);
	if (exact) return [{ index: exact.index, timeline: exact.timeline, weight: 1 }];
	for (let i = 0; i + 1 < laid.length; i++) {
		const lo = laid[i];
		const hi = laid[i + 1];
		if (at < lo.at || at > hi.at) continue;
		const span = hi.at - lo.at;
		// Two stops at one threshold is a stack with no axis between them. The
		// earlier one wins rather than the arithmetic dividing by zero, which is
		// the same tie-break document order already gets everywhere else here.
		if (span <= 0) return [{ index: lo.index, timeline: lo.timeline, weight: 1 }];
		const t = (at - lo.at) / span;
		return [
			{ index: lo.index, timeline: lo.timeline, weight: 1 - t },
			{ index: hi.index, timeline: hi.timeline, weight: t },
		];
	}
	return [{ index: last.index, timeline: last.timeline, weight: 1 }];
}
