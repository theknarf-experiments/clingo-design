/**
 * Reads a drawable scene back out of one answer set.
 *
 * The generated program has always *described* the picture — `node/1`,
 * `kind/2`, `child/2`, `order/2`, `frame/3`, `rendered/3`, `visible/1` — but
 * only the decisions were shown, so every renderer so far has walked the
 * TypeScript document and applied the picks to it. That works exactly as long
 * as the document and the answer set agree about the picture, which is to say
 * exactly as long as no rule touches the scene predicates. This reader is the
 * other direction: the answer set is the description, and the document is only
 * where it came from.
 *
 * The canvas is what consumes it. It is pure, so it can be tested against the
 * real solver without a canvas anywhere near it — and because it needs the
 * scene predicates to say anything at all, an answer set that was asked for
 * without them reads as an empty document rather than as an error. That is why
 * a solve is only allowed to skip the picture where the result is a
 * {@link Candidate} and not a `Universe`; see explore.ts.
 *
 * A machine's states arrive through the same door, and they are the reason the
 * door is worth having. Every state of every instance is in the *same* answer
 * set — that is the invariant the whole feature turns on, see machines.ts — so
 * what comes back is not one picture but one picture plus every other picture
 * the same document could be showing. {@link ModelScene.states} is that second
 * half, and it is deliberately kept out of {@link ModelScene.byId}: a state copy
 * is not a `node/1`, must never be drawn as one, and the two readers that want
 * it — the export, which turns states into classes, and the studio's playback,
 * which draws one instead of the shown one without solving again — both ask for
 * it by name.
 */
import { parseAtom, unquote } from "./atoms.ts";
import { parseInstancePart } from "./components.ts";
import type { Frame } from "./geometry.ts";
import { parseKeyCopy, parseStatePart, statePart } from "./machines.ts";
import { type Emu, wholeEmu } from "./units.ts";
import {
	DEFAULT_EASING,
	KINDS,
	type LoopMode,
	type NodeKind,
	PROP_NAMES,
	PROPS,
	type PropName,
	type Spatial,
	SPATIALS,
	type Turn,
	TURN_NAMES,
	TURNS,
	sharedPropsOfKinds,
} from "./scene.ts";
import { curveOf } from "./values.ts";

/**
 * Six numbers in EMU: a {@link Frame} and its third axis.
 *
 * **Local and unexported on purpose, and this is a note about ordering rather
 * than about design** — the same note, word for word in intent, that
 * `spatial.ts` carries above its own copy. `docs/merged-plan.md` §2 gives this
 * type to `geometry.ts` as `Box = Frame & SpatialFrame`, owned by step M2, which
 * has not landed at the time this file was written. Exporting a second `Box`
 * from here would put two of them in the barrel and make the day M2 lands a
 * merge rather than a deletion.
 *
 * Spelled structurally so the two are **mutually assignable the moment M2
 * exists**: `Record<Spatial, number>` is exactly `SpatialFrame`, so every
 * signature below already accepts and returns M2's type — including
 * {@link ModelNode.spatial}, which the merge's naming table calls
 * `SpatialFrame` — and the change when it arrives is this alias becoming an
 * import.
 */
type Box = Frame & Record<Spatial, number>;

export interface ModelNode {
	id: string;
	kind: NodeKind;
	/** Where it sits among its siblings, 1-based — the paint order. */
	order: number;
	/**
	 * Relative to the parent, as in the document, with anything the solver
	 * worked out winning over the stored frame. Same precedence as
	 * `placedNodes`, so a consumer can walk this tree the same way.
	 */
	frame: Frame;
	/**
	 * Where it is on the third axis, when the answer set said anything about it.
	 *
	 * Beside {@link frame} rather than folded into it, and that is the whole
	 * no-regression story in one field: `Frame` is four numbers, every gesture,
	 * every snap, every hit test and every existing test reads four numbers, and
	 * a document with no third axis produces no `frame(N,z,_)` at all, so this
	 * stays `undefined` on every node of every flat document. A reader that wants
	 * six calls {@link boxOf3}.
	 *
	 * **Present means the answer set spoke, not that both numbers were stated.**
	 * The program's own default is `frame(N,z,0)` for an `s3` node and silence
	 * for everything else, so absence here is "this node is not in the third
	 * axis" and a zero here is "it is, at the origin" — two different claims that
	 * a four-plus-two record with a default would have collapsed into one. Where
	 * it is present it holds both numbers, because absent-is-zero is what the
	 * program means by a missing dimension and a caller should never have to ask
	 * twice.
	 */
	spatial?: Record<Spatial, number>;
	/**
	 * How it is turned, in thousandths of a degree per axis — `turn/3`.
	 *
	 * Thousandths for the reason {@link TURNS} gives: a fact has to be an integer,
	 * a designer types `22.5deg` on the first day, and a thousandth of a degree is
	 * finer than any screen resolves. Absent exactly as {@link spatial} is absent,
	 * and complete for the same reason where it is present — a node the answer set
	 * turned about one axis is not turned about the other two, and saying so with
	 * a zero is cheaper for every reader than saying it with a hole.
	 */
	turn?: Record<Turn, number>;
	/** What it draws with: final text per property, tokens already followed. */
	rendered: Partial<Record<PropName, string>>;
	/**
	 * Where in the project's tree the payload it draws lives — `asset/2`.
	 *
	 * On the node as well as in {@link ModelScene.assets}, because the two are
	 * asked by different readers: a renderer walking the tree has the node and
	 * wants its picture, and anything auditing a project wants the whole map
	 * without walking. One fact, two shapes, both built in the same pass.
	 *
	 * Absent on every kind that draws no payload, which is most of them.
	 */
	asset?: string;
	/**
	 * Which part of that file it draws — `meshpart/3`, the glTF node index and
	 * the primitive index within that node's mesh.
	 *
	 * The other half of {@link asset}'s sentence, and it has to be a second atom
	 * rather than a fragment on the path for the reason `compile.ts` argues where
	 * it states them: a path with a `#node=3` on the end is not a path, and every
	 * reader that treats `asset/2` as one — `resolveAsset`, the exporter's
	 * `files` lookup, a rule asking which files a design uses — would need a
	 * strip first.
	 *
	 * **On the node and deliberately not in a second map on {@link ModelScene}.**
	 * `ModelScene.assets` exists so a project can be audited without walking the
	 * tree — how much does this design weigh, which files does it need, which are
	 * missing — and a primitive index answers none of those questions. Only a
	 * renderer standing at a node wants it, and a renderer standing at a node has
	 * the node.
	 *
	 * Absent wherever {@link asset} is absent, and absent as a pair: a file with
	 * no part is a reference to a whole chair where a leg was meant, and the
	 * renderer refuses it rather than defaulting to `{0, 0}` — see `modelPart` in
	 * `canvas-3d/src/gltfexport.ts`, which makes the same choice for the same
	 * reason. Guessing here would paper over a `#show meshpart/3` that stopped
	 * reaching the answer set, which is precisely the failure `f2b6316` spent a
	 * release not noticing.
	 */
	part?: { node: number; primitive: number };
	children: ModelNode[];
}

/**
 * A model node's six numbers, with the two it may not have read as zero.
 *
 * The one place a caller is allowed to stop caring whether a node is in the
 * third axis. Everything else in this file keeps the distinction, because
 * "absent" and "zero" are different claims about a document; a renderer placing
 * a box does not care, and this is where it says so.
 */
export const boxOf3 = (node: { frame: Frame; spatial?: Record<Spatial, number> }): Box => ({
	...node.frame,
	z: node.spatial?.z ?? 0,
	depth: node.spatial?.depth ?? 0,
});

/** A node wearing a style the document does not say it wears. */
export interface ModelWearer {
	/** The node id, which may be an instance part — `inst(i,label)`. */
	node: string;
	/** Which of the style's properties it takes from it, in table order. */
	props: PropName[];
}

/** One alternative of a variable a rule minted. */
export interface ModelAlternative {
	/**
	 * The solver's own index for it — what `pick/2` carries and what a pin
	 * assumes. A rule numbers its alternatives however it likes, so this is not
	 * the position in the list.
	 */
	index: number;
	/** What it says, with the literal table already followed. */
	text: string;
}

/**
 * One state copy — instance `I`'s part `N` as state `S` has it — read out of
 * the same answer set as the picture.
 *
 * Where it is and what it draws with, as a {@link ModelNode} carries them, and
 * then everything that would make it drawable is gone. No kind, because the copy
 * has none: what it is is decided by the definition part, which is a node of the
 * picture and already says so. No children, because the copies do not form a
 * tree — they hang off
 * the instance's parts in `child/2` only so that a geometric constraint naming
 * one gets a world chain, and a consumer that wants the shape of a state walks
 * the instance's tree and looks each part up here. No `order`, for the same
 * reason: a state changes what a part looks like, never where it sits among its
 * siblings.
 */
export interface ModelState {
	/** The instance node id. */
	instance: string;
	/** The state id. */
	state: string;
	/** The definition part id — which may itself be a term, for a nested instance. */
	part: string;
	/**
	 * Relative to the parent, as {@link ModelNode.frame} is, with solved geometry
	 * folded in — by the same lines, because it is the same question.
	 */
	frame: Frame;
	/**
	 * The same two optional halves {@link ModelNode} carries, read the same way
	 * and absent under the same conditions.
	 *
	 * Not a convenience: a state that lifts a mesh 40px forward is a state whose
	 * copy differs from the picture in `z` and in nothing else, and a copy that
	 * carried only four numbers would be a pose the canvas cannot draw and a diff
	 * the export cannot write. The program narrows the copy's own defaults to
	 * `s3(stt(I,S,N))` exactly so that these stay absent on the four-state button
	 * in a document whose viewport is on another artboard — see merged-plan §4 —
	 * and this field is where that narrowing becomes observable.
	 */
	spatial?: Record<Spatial, number>;
	turn?: Record<Turn, number>;
	/** What it draws with in this state: final text per property, tokens followed. */
	rendered: Partial<Record<PropName, string>>;
	/**
	 * True where this state takes the part out of the picture — `mhidden/3`.
	 *
	 * Per copy and not closed downward, deliberately. Both readers close it
	 * themselves and close it in their own medium: the export writes
	 * `display: none` on the one node and CSS takes the subtree with it, and the
	 * canvas stops walking, exactly as {@link drawn} stops walking for a hidden
	 * node. Closing it here would say the same thing twice and would make "this
	 * state hides this part" — which is what a panel wants to show and what the
	 * document actually said — unaskable.
	 */
	hidden: boolean;
}

/**
 * One keyframe copy — instance `I`'s pose partway through timeline `W` — read
 * out of the same answer set as the picture. The twin of {@link ModelState}.
 *
 * **Rationed harder than a state copy, and the default is none.** A timeline on
 * its own mints no copies at all: it costs two variables per keyframe and one
 * per timeline, and that is enough for the export, which needs times and lets
 * the compositor interpolate, and enough for the canvas, which lerps between two
 * entries of an answer set it already holds. A copy appears only where a
 * geometric rule named a `kfr(...)` term, which is `keyframeParts`' answer. So
 * {@link ModelScene.keyframes} is empty on almost every document that has
 * timelines, and that is the feature working rather than the feature missing.
 *
 * A copy is not a `node/1` and must never be drawn as one, for
 * {@link ModelState}'s reasons exactly: a drawable copy per keyframe would paint
 * every moment of every animation on top of the picture and grow the layer list
 * by the keyframe count.
 */
export interface ModelKeyframe {
	/** The instance node id. */
	instance: string;
	/** The timeline id, in the machine that drives this instance. */
	timeline: string;
	/** The track term — `trkp(label,ink)`, `trkd(panel,y)` or `trkr(cube,rotateY)`. */
	track: string;
	/** 1-based, the index the term names — the document's own order. */
	index: number;
	/**
	 * The millisecond this universe put it at — `mkat/5`.
	 *
	 * A universe's answer and not the document's: a keyframe's time is a `Value`,
	 * so a timeline that names a motion scale retimes with it, and two universes
	 * of one document really can put the same keyframe at two milliseconds. A
	 * keyframe whose time reads as no duration at all sits at 0, which is the same
	 * answer `solvedKeys` gives and for the same reason — it is a keyframe
	 * somebody wrote, and dropping it would renumber the ones after it.
	 */
	at: number;
	/** Relative to the parent, as {@link ModelState.frame} is, with solved geometry folded in. */
	frame: Frame;
	/**
	 * The third axis and the rotation, absent under the same conditions they are
	 * absent on a node — merged-plan §6.5, which added them here because a
	 * keyframe copy of a mesh carrying only four numbers is a pose the canvas
	 * cannot draw.
	 */
	spatial?: Record<Spatial, number>;
	turn?: Record<Turn, number>;
	/** What it draws with at that moment: final text per property, tokens followed. */
	rendered: Partial<Record<PropName, string>>;
	/**
	 * The curve *out of* this keyframe — `mkeasing/5`.
	 *
	 * Text rather than an `Easing`, because that predicate stopped being a fact
	 * and started being derived when a curve became a {@link Value}: it carries a
	 * menu word or a `cubicBezier(X1,Y1,X2,Y2)` term, and the second of those is
	 * not a member of the union. The same widening `TrackSample.easing` takes one
	 * file over, for the same reason and in the same commit.
	 */
	easing: string;
}

/**
 * One timeline, as one answer set describes it.
 *
 * **What is here is what the answer set decided, which is the times and not the
 * values.** A keyframe's value is a `Value` in the document and reaches the
 * program as `kval(M,W,R,K)`; the program derives `kf_value/5` from it and
 * `#project`s it, so two alternatives really are two universes — but nothing
 * `#show`s it, because the reader that wants a keyframe's value has the document
 * and the universe's picks in hand and asks `solvedKeys` / `sampleTimeline` in
 * machines.ts. The times are the other way round: `mkat/5` is the resolution of
 * a `duration` Value against this universe, so a panel that asked the document
 * would get a different animation from the one the solver answered with.
 *
 * See the note in this step's return value: `rive-ladder-spec.md` §6.2 typed a
 * `value: string` into each entry, and no shown predicate carries one.
 */
export interface ModelTimeline {
	/** How long it runs, in milliseconds — `mtlen/3`, stated or derived from the last key. */
	length: number;
	loop: LoopMode;
	/**
	 * Track term -> its keyframes, in the order this universe puts them in.
	 *
	 * Sorted on the resolved time with the index as the tie-break, which is the
	 * same stable order `solvedKeys` uses — so "key 3" is the same keyframe in the
	 * panel, in the `kfr(...)` term and here. A universe where a token sent one
	 * keyframe behind the one in front of it is a real universe, reported as
	 * {@link ModelMachine.backwardsKeys} and sorted through rather than refused.
	 */
	tracks: Record<string, Array<{ index: number; at: number; easing: string }>>;
}

/**
 * What one answer set says about one machine.
 *
 * Two different kinds of thing, and they are together because they have the
 * same source and the same audience. The four health lists are the program's
 * own answers to the four questions `machineHealth` answers off the document in
 * machines.ts — deliberately duplicated, because a panel has to be able to say
 * "nothing reaches this state" while the document is unsatisfiable and there is
 * no answer set at all, and a rule has to be able to say it as a `viol/1` that
 * lands in a core with a name. The three motion maps are the other kind: a
 * duration is a *value*, so which milliseconds a transition runs for is a thing
 * this universe decided rather than a thing the document holds, and the export
 * cannot write `transition:` without asking.
 *
 * A machine the answer set says nothing about is absent rather than empty. That
 * is not the same claim as "this machine is healthy": a solve asked for without
 * `scenery` shows none of these, so a reader that wants to *report* health has
 * to have asked for the picture, and one that only wants a number should treat
 * a missing machine as a missing answer.
 */
export interface ModelMachine {
	/** States `mreach/2` does not reach — `munreached/2`. */
	unreachable: string[];
	/** States nothing leaves — `mdeadend/2`. */
	deadEnds: string[];
	/** `[state, trigger]` pairs where one trigger leaves a state twice — `mnondet/3`. */
	nondeterministic: Array<[string, string]>;
	/** Transitions naming a state the machine has not got — `mdangling/2`. */
	dangling: string[];
	/** Transition id -> the milliseconds this universe resolved it to. */
	duration: Record<string, number>;
	delay: Record<string, number>;
	stagger: Record<string, number>;
	/**
	 * Transition id -> the curve this universe resolved it to — `measing/3`.
	 *
	 * The fourth motion table, and the first one that is not a number. It is here
	 * for the three durations' reason exactly: an easing is a {@link Value} now, so
	 * which curve a transition uses is an answer the solver gave rather than a
	 * word the document holds, and a `curve` token with two alternatives is two
	 * universes that differ in this field and in nothing else the gallery draws.
	 * A reader that asked the document instead would show one design for a
	 * document that plainly holds two.
	 *
	 * A **string** and not an `Easing`, for `easingOf`'s reason: the answer may be
	 * a menu word or the term `cubicBezier(200,0,0,1000)`, and every consumer
	 * hands it to `cssEasing`, which takes text.
	 *
	 * Every transition has one, because the program supplies `mdefease` where the
	 * document is silent — the same sentence {@link exit} makes about a duration.
	 */
	easing: Record<string, string>;
	/* ---- the ladder ---- */
	/**
	 * Transition id -> the exit time this universe resolved it to — `mexit/3`.
	 *
	 * The fourth motion table and it belongs beside the other three: an exit time
	 * is a `duration` Value like a delay, it clamps at zero like a delay, and the
	 * program `#project`s it like a delay, so a debounce scale holding two ends
	 * really is two designs. Every transition has one, because the program
	 * supplies its own default where the document is silent.
	 */
	exit: Record<string, number>;
	/** Transitions whose guard cannot be satisfied by any input — `mguardnever/2`. */
	impossible: string[];
	/**
	 * States no *feasible* chain of transitions reaches — `mgunreached/2`.
	 *
	 * A superset of {@link unreachable}: the ordinary reachability walk ignores
	 * guards, this one refuses to walk an edge no valuation can take. A state in
	 * here and not in there is a state that is reachable on paper and unreachable
	 * in the machine, which is the whole reason the two are separate lists.
	 */
	unreachableWithGuards: string[];
	/** Transitions naming a reserved id in the wrong position — `mmisplaced/2`. */
	misplaced: string[];
	/**
	 * `[layer, layer, part, prop]` — two layers that both paint one property of
	 * one part, `mfight/5`.
	 *
	 * Static, and a claim about the machine rather than about this instance: it
	 * says these two layers *would* argue, whether or not both of their states are
	 * on screen. {@link ModelScene.fightsAt} is the same fight as drawn.
	 */
	fights: Array<[string, string, string, string]>;
	/** `[layer, layer, part, dimension]` — the same over geometry, `mffight/5`. */
	frameFights: Array<[string, string, string, string]>;
	/**
	 * `[layer, layer, part, rotation]` — the same over a turn, `mrfight/5`.
	 *
	 * **Not in `rive-ladder-spec.md` §6.2's list of eight**, and it is here for the
	 * reason the merge invented the predicate: rotation arrived with the third
	 * axis after the layer machinery was written, and a `turn/3` derived twice for
	 * one (part, axis) is not two designs but one arbitrary answer. The program
	 * derives it and shows it; a panel that could name the other two fights and
	 * not this one would be silent about the only one a mesh can have.
	 */
	rotationFights: Array<[string, string, string, string]>;
	/** `[state, stop index]` pairs outside the blend input's own range — `mstopout/3`. */
	stopsOutOfRange: Array<[string, number]>;
	/**
	 * Blend states whose stops do not cover their input's range — `mstopgap/2`.
	 *
	 * The converse of {@link stopsOutOfRange} and deliberately not an error: part
	 * of the axis plays one timeline flat, which is legal, sometimes meant, and
	 * worth being able to ask about.
	 */
	stopGaps: string[];
	/** States holding both a timeline and a blend — `mtwosource/2`. Reported, never repaired. */
	twoSource: string[];
	/** Transitions whose exit time is past their from-state's timeline — `mexitpast/2`. */
	exitPast: string[];
	/**
	 * `[timeline, track, index]` for a keyframe this universe put *before* the one
	 * in front of it — `mkbackwards/4`.
	 *
	 * Not something a linter over the document could catch: a keyframe's time is a
	 * Value, so this is a property of an answer rather than of a document, and it
	 * is exactly the class of bug a multiverse invents.
	 */
	backwardsKeys: Array<[string, string, number]>;
	/**
	 * The machine's layers, in the order they are stacked — `mlindex/3`.
	 *
	 * The position is the priority, so this array *is* the priority, lowest
	 * first. A machine the document gave no layers has exactly one, called `base`,
	 * which the reader mints — so this is never empty for a machine the answer set
	 * knows about, and a one-layer machine reads as the un-layered one it is.
	 */
	layers: string[];
	/** Timeline id -> what this universe made of it. */
	timelines: Record<string, ModelTimeline>;
}

export interface ModelScene {
	/** Top-level nodes, in paint order. */
	roots: ModelNode[];
	/**
	 * Every node in the tree, by id, **in id order**.
	 *
	 * The order is a promise rather than an accident, for the reason given where
	 * it is built: one reader walks these keys in sequence, and `node/1` reaches
	 * this file in whatever order clingo printed it.
	 */
	byId: Record<string, ModelNode>;
	/**
	 * Sets a rule named, with their members: `group/1` and `member/2`.
	 *
	 * A constraint can be pointed at one instead of listing ids, which is the
	 * only way to constrain nine nodes a rule brought into being. The editor
	 * offers these where it offers node ids; see {@link Constraint.group}.
	 */
	groups: Record<string, string[]>;
	/**
	 * Variables a rule minted, by key, with their alternatives in index order.
	 *
	 * `alt/2` is derivable, so a document is not the only thing that can create
	 * a choice. The document knows its own variables' alternatives; these are
	 * the ones it cannot know, and without them a derived node's property row
	 * would have nothing to offer, dim or pin.
	 */
	variables: Record<string, ModelAlternative[]>;
	/**
	 * Wearing the answer set knows about and the document does not, by style id —
	 * `sty_derived/3`.
	 *
	 * Two ways to be in here, and the reading is the same for both: an
	 * instance's copy of a definition part that wears a style, and a node a
	 * hand-written rule dressed. Only this half is shown, because the document's
	 * own wearing is already in the document — the same argument as
	 * {@link variables}.
	 *
	 * Read by the export, which cannot otherwise share the class with a wearer
	 * the document never named, and by the studio, which measures text from the
	 * document *before* this solve and so has to admit which boxes it sized in
	 * the wrong font.
	 */
	wears: Record<string, ModelWearer[]>;
	/**
	 * Every state copy, by its whole `stt(I,S,N)` term.
	 *
	 * Not folded into {@link byId}, because a state copy is not a node and must
	 * never be drawn as one: this is the *other* states, sitting beside the
	 * picture rather than in it. Keyed by the term rather than nested
	 * instance-by-state-by-part because that is how every reader arrives — with a
	 * term a rule named, or with one it built from {@link statePart} — and a
	 * three-level map would make the common lookup three lookups and the
	 * uncommon one an impossibility.
	 *
	 * In term order, so that two readings of one answer set are the same reading.
	 */
	states: Record<string, ModelState>;
	/**
	 * Which state each instance is drawn in — `shown/2`, by instance node id.
	 *
	 * This is what makes {@link states} usable as a diff: the shown copy is the
	 * one already folded into {@link byId} through the alias rules, so the export
	 * asks what *changed* by comparing the other copies against this one.
	 *
	 * It is also read *while* {@link byId} is being built, which is the one place
	 * this reader does more than transcribe. The program's alias carries the shown
	 * copy's `frame/3` onto `inst(I,N)` and cannot carry its solved geometry,
	 * because that is a theory answer rather than an atom a rule can restate — so
	 * where a geometric rule placed the shown copy, the drawn part takes the copy's
	 * offset from here. See `solvedView`.
	 */
	shown: Record<string, string>;
	/**
	 * Which state each instance is drawn in **per layer** — instance -> layer ->
	 * state.
	 *
	 * {@link shown} is kept, and is this map's *first* layer: it is what every
	 * reader written before layers existed is asking about, and on a machine with
	 * no layers in the document there is exactly one entry here and the two say the
	 * same thing. A machine with three layers is three states on screen at once —
	 * that is what a layer is for — so a reader that took `shown` alone would be
	 * showing one third of the picture and would have no way to know it.
	 *
	 * The layer a state belongs to comes from `mslayer/3` and the stacking order
	 * from `mlindex/3`, both of which the program shows for exactly this reason:
	 * without them a reader holding two `shown/2` for one instance cannot tell a
	 * machine doing its job from two pictures on top of each other.
	 */
	shownByLayer: Record<string, Record<string, string>>;
	/**
	 * Every keyframe copy the answer set mentions, by its whole `kfr(I,W,R,K)`
	 * term.
	 *
	 * Beside {@link states} and not folded into it, because they answer different
	 * questions: a state copy is a pose the machine settles in, a keyframe copy is
	 * a pose it passes through, and a reader that wanted "every pose" would still
	 * have to know which was which to draw either.
	 */
	keyframes: Record<string, ModelKeyframe>;
	/** What the answer set says about each machine, by machine id. */
	machines: Record<string, ModelMachine>;
	/**
	 * Two layers arguing over one property of one part **of one instance on
	 * screen** — `mfightat/5`, by instance node id.
	 *
	 * {@link ModelMachine.fights} is the same argument in principle; this is the
	 * one a designer is looking at. Both of the fighting layers have to have a
	 * state drawn before a single entry appears here, which is why a machine can
	 * have a fight in it and no instance be showing one.
	 *
	 * **Not named by either frozen spec.** `rive-ladder-spec.md` §4.4 says
	 * `mfightat/5` "is there for the panel" and then leaves it out of §6.2's
	 * reader; the compiler step added the `#show` on the grounds that a predicate
	 * no atom carries is dead code, and this field is the other half of that. The
	 * name is this step's and is flagged as such in its return value.
	 */
	fightsAt: Record<string, Array<[string, string, string, string]>>;
	/**
	 * Model node id -> how many triangles it holds — `tris/2`.
	 *
	 * Only an imported `model` has one; a primitive `mesh` is counted by the
	 * renderer from its own geometry and a rect has none. Here so the status line
	 * can add them up without loading a single asset, and so
	 * `viol(mesh_budget) :- tris(_,K), K > 200000.` is a rule somebody can write
	 * against the same number the panel shows.
	 */
	triangles: Record<string, number>;
	/**
	 * Model node id -> where in the project's tree the geometry it draws lives —
	 * `asset/2`.
	 *
	 * The one thing a `model` needs that the picture could not otherwise carry.
	 * Everything else about it is here already — its box, its turn, its material,
	 * its triangle count — but the vertices are in a file, and a renderer that
	 * read the path off the *document* would be a renderer drawing something
	 * other than the answer set. So the compiler states it and this reads it, and
	 * `canvas-3d` resolves it through a function that knows nothing about where
	 * bytes are kept.
	 *
	 * A **path**, not a content hash, since `f2b6316`: replacing the file under
	 * the path replaces the picture, which is the whole point of a project having
	 * a tree. That change was one expression on the writing side and none at all
	 * here, because this only ever held whatever string `asset/2` carried.
	 *
	 * Deliberately still one map of one string. Which *part* of the file a node
	 * draws is on {@link ModelNode.part} and is not mirrored here, because the
	 * questions this map exists to answer without walking the tree — what does
	 * this design weigh, which files does it need, which are missing — are all
	 * questions about files, and a primitive index answers none of them.
	 *
	 * Absent for a node the answer set gave no asset — a primitive `mesh`, and a
	 * `model` a rule minted without one — which is what makes the stand-in box the
	 * ordinary case rather than an error path.
	 */
	assets: Record<string, string>;
	/**
	 * Viewport node id -> the camera node it looks through — `vcam/2`, and
	 * `vcam/2` rather than `looks/2` deliberately.
	 *
	 * `looks/2` is what the document *says*; `vcam/2` is what survived being
	 * checked — the named node really is a `camera`, really is in the third axis,
	 * and the view really is a `viewport`. A viewport whose camera was deleted is
	 * absent from here and the renderer frames the subtree itself, which is the
	 * same silence a dangling `instanceOf` leaves.
	 *
	 * Deliberately **not** filtered by `visible/1`: hiding a camera means stop
	 * drawing its marker, never stop looking through it.
	 */
	looks: Record<string, string>;
}

/**
 * A theory value, as EMU: `"320/3"` is 107.
 *
 * clingo-lpx answers in exact rationals, and it has to — three children sharing
 * a container's leftover space is a third of something, and simplex has no way
 * to say that in integers. Every length in the program is EMU, so what arrives
 * is a *rational number of EMU*, and `320/3` is not one.
 *
 * So this is the one place the solver's answer is quantized, and it is worth
 * being plain about rather than calling it a conversion. It is not that EMU
 * absorbs the rationals — it is that a third of an EMU is a thirty-millionth of
 * an inch, four decimal orders below what any output medium can hold, so the
 * discarded remainder cannot reach a pixel, a printer or an export. Before EMU
 * the same divide threw away a third of a *pixel*, which very much could.
 *
 * {@link wholeEmu} rather than a bare `Math.round`, so this rounding breaks its
 * ties the same way every other rounding in the codebase does — away from zero
 * — and so that the name says a quantization happened.
 */
function emuFromRational(text: string): Emu | undefined {
	const slash = text.indexOf("/");
	const n =
		slash === -1
			? Number(text)
			: Number(text.slice(0, slash)) / Number(text.slice(slash + 1));
	return Number.isFinite(n) ? wholeEmu(n) : undefined;
}

const AXIS = { x: "x", y: "y", width: "width", height: "height" } as const;

/**
 * The other two, kept in a second table rather than added to the first — and
 * the split is the whole no-regression argument in one line.
 *
 * `AXIS` is what decides whether a number lands in a {@link Frame}, and a
 * `Frame` has four members in every consumer of this package. So the third axis
 * gets its own lookup, its own map in {@link Facts} and its own optional field,
 * and the code below asks the first table, then this one, then gives up. A
 * document with no viewport and no lifted node grounds neither `frame(N,z,_)`
 * nor `lv(N,z)`, so this table is consulted and answers nothing.
 */
const SPATIAL_AXIS = { z: "z", depth: "depth" } as const;

/**
 * Pulls `__lpx(lv(n,x),"114300")` and `__lpx(lsz(n,width),"762000")` out of a
 * model, in EMU.
 *
 * Parsed rather than matched, because a node id is no longer always a plain
 * constant: a rule that brings nodes into being names them with terms, and
 * `lv(cell(1,1),x)` has two commas that are not argument separators.
 *
 * **Six axes now, not four**, because `gpos(N,z)` and `gsize(N,depth)` mint
 * `lv(N,z)` and `lsz(N,depth)` for a node in the third axis exactly as they mint
 * the planar four — a mesh in a viewport is placed by the same simplex, in the
 * same units, by the same rules. The return type widens with them, and it widens
 * *compatibly*: `Partial<Box>` is assignable to `Partial<Frame>`, so
 * `Universe.solved` in explore.ts keeps its declared type and keeps its meaning.
 * A flat document produces no theory variable on either spatial axis, so nothing
 * in the returned record moves.
 */
export function readSolved(
	atoms: readonly string[],
): Record<string, Partial<Box>> {
	const out: Record<string, Partial<Box>> = {};
	for (const text of atoms) {
		if (!text.startsWith("__lpx(")) continue;
		const outer = parseAtom(text);
		if (!outer || outer.name !== "__lpx" || outer.args.length !== 2) continue;
		const variable = parseAtom(outer.args[0]);
		if (!variable || variable.args.length !== 2) continue;
		if (variable.name !== "lv" && variable.name !== "lsz") continue;
		const name = variable.args[1];
		const axis =
			AXIS[name as keyof typeof AXIS] ?? SPATIAL_AXIS[name as keyof typeof SPATIAL_AXIS];
		const value = emuFromRational(unquote(outer.args[1]));
		if (axis === undefined || value === undefined) continue;
		(out[variable.args[0]] ??= {})[axis] = value;
	}
	return out;
}

/** The four a {@link Frame} holds, out of a record that may hold six. */
function planarPart(box: Partial<Box> | undefined): Partial<Frame> {
	if (box === undefined) return {};
	const out: Partial<Frame> = {};
	for (const axis of ["x", "y", "width", "height"] as const) {
		if (box[axis] !== undefined) out[axis] = box[axis];
	}
	return out;
}

/** And the other two — the twin of {@link planarPart}, over the same record. */
function spatialPart(box: Partial<Box> | undefined): Partial<Record<Spatial, number>> {
	if (box === undefined) return {};
	const out: Partial<Record<Spatial, number>> = {};
	for (const axis of SPATIALS) {
		if (box[axis] !== undefined) out[axis] = box[axis];
	}
	return out;
}

/** Everything one pass over the atoms picks up, before any of it is a tree. */
interface Facts {
	nodes: Set<string>;
	kind: Map<string, NodeKind>;
	order: Map<string, number>;
	frame: Map<string, Partial<Frame>>;
	/** The third axis, in its own map so that {@link boxOf} keeps returning four. */
	spatial: Map<string, Partial<Record<Spatial, number>>>;
	/** `turn/3`, in thousandths of a degree. */
	turn: Map<string, Map<Turn, number>>;
	parent: Map<string, string>;
	rendered: Map<string, Map<PropName, string>>;
	literal: Map<string, string>;
	visible: Set<string>;
	groups: Map<string, string[]>;
	/** variable key -> solver index -> literal id */
	variables: Map<string, Map<number, string>>;
	/** style id -> node id -> the properties it takes from that style */
	wears: Map<string, Map<string, Set<PropName>>>;
	/**
	 * instance id -> **every** state it is drawn in, one per layer.
	 *
	 * A set rather than a single id, and that is a change with a reason rather
	 * than a widening for its own sake: `shown/2` was one atom per instance until
	 * layers arrived, and it is now one per *layer* — three shown states at once is
	 * what a layer is for, and `mtwoshown/1` is reserved for two in the **same**
	 * layer, which is the case that really is two pictures on top of each other.
	 * {@link ModelScene.shown} still answers with one, and which one it answers
	 * with is decided in {@link shownInLayerOrder} rather than by whichever atom
	 * arrived first.
	 */
	shown: Map<string, Set<string>>;
	/** the `stt(I,S,N)` terms `mhidden/3` takes out of the picture */
	stateHidden: Set<string>;
	/**
	 * state id -> the machine and layer it belongs to — `mslayer/3`.
	 *
	 * Keyed by the state rather than by the machine because every question this
	 * file asks of it starts from a `shown/2` atom, which carries an instance and
	 * a state and no machine at all. `minstance/2` is shown by nothing — an
	 * instance's machine is a fact about the document, and the document is where
	 * such questions belong — so this map is also how a keyframe copy finds the
	 * machine whose timeline it is a moment of. Two machines that both hold a state
	 * called `hover` would be ambiguous here; the first in sorted order wins,
	 * deterministically, and the alternative was showing `minstance/2` on every
	 * solve of every document for a join two readers make.
	 */
	stateLayer: Map<string, { machine: string; layer: string }>;
	/** machine id -> layer id -> its 1-based position, which is its priority — `mlindex/3`. */
	layerIndex: Map<string, Map<string, number>>;
	/** instance id -> the fights actually on screen — `mfightat/5`. */
	fightsAt: Map<string, Array<[string, string, string, string]>>;
	/** node id -> its triangle count — `tris/2`. */
	triangles: Map<string, number>;
	/** model node id -> the tree path of the file it draws — `asset/2`. */
	assets: Map<string, string>;
	/** model node id -> which part of that file — `meshpart/3`. */
	parts: Map<string, { node: number; primitive: number }>;
	/** viewport id -> the camera it looks through — `vcam/2`. */
	looks: Map<string, string>;
	/**
	 * machine -> timeline -> what this universe made of it, assembled in place.
	 *
	 * Four predicates land here — `mtlen/3`, `mloop/3`, `mkat/5` and `mkeasing/5`
	 * — and no two of them are guaranteed to arrive together, so a keyframe is a
	 * mutable pair that both halves write into and {@link readModel} freezes. The
	 * alternative, four parallel maps joined at the end, is the same data with
	 * four chances to disagree about which keys exist.
	 */
	timelines: Map<string, Map<string, TimelineFacts>>;
	/**
	 * machine id -> its health and its motion, filled in as the atoms arrive.
	 *
	 * The result type, mutated in place rather than a parallel one accumulated
	 * and converted: every predicate lands in a field it already has. Ordering is
	 * the only thing that is not final here, and {@link readModel} sorts it at the
	 * end.
	 */
	machines: Map<string, ModelMachine>;
}

/** One timeline mid-assembly: track term -> key index -> the two halves of a key. */
interface TimelineFacts {
	length?: number;
	loop?: LoopMode;
	tracks: Map<string, Map<number, { at?: number; easing?: string }>>;
}

/** The record for one machine, minted by whichever of its atoms arrives first. */
function machineFacts(facts: Facts, id: string): ModelMachine {
	let machine = facts.machines.get(id);
	if (!machine) {
		machine = {
			unreachable: [],
			deadEnds: [],
			nondeterministic: [],
			dangling: [],
			duration: {},
			delay: {},
			stagger: {},
			easing: {},
			exit: {},
			impossible: [],
			unreachableWithGuards: [],
			misplaced: [],
			fights: [],
			frameFights: [],
			rotationFights: [],
			stopsOutOfRange: [],
			stopGaps: [],
			twoSource: [],
			exitPast: [],
			backwardsKeys: [],
			layers: [],
			timelines: {},
		};
		facts.machines.set(id, machine);
	}
	return machine;
}

/** The record for one timeline, minted by whichever of its four atoms arrives first. */
function timelineFacts(facts: Facts, machine: string, timeline: string): TimelineFacts {
	let byTimeline = facts.timelines.get(machine);
	if (!byTimeline) facts.timelines.set(machine, (byTimeline = new Map()));
	let found = byTimeline.get(timeline);
	if (!found) byTimeline.set(timeline, (found = { tracks: new Map() }));
	return found;
}

/** ...and the record for one keyframe of one of its tracks. */
function keyFacts(
	facts: Facts,
	machine: string,
	timeline: string,
	track: string,
	index: number,
): { at?: number; easing?: string } {
	const line = timelineFacts(facts, machine, timeline);
	let keys = line.tracks.get(track);
	if (!keys) line.tracks.set(track, (keys = new Map()));
	let key = keys.get(index);
	if (!key) keys.set(index, (key = {}));
	return key;
}

function collect(atoms: readonly string[]): Facts {
	const facts: Facts = {
		nodes: new Set(),
		kind: new Map(),
		order: new Map(),
		frame: new Map(),
		spatial: new Map(),
		turn: new Map(),
		parent: new Map(),
		rendered: new Map(),
		literal: new Map(),
		visible: new Set(),
		groups: new Map(),
		variables: new Map(),
		wears: new Map(),
		shown: new Map(),
		stateHidden: new Set(),
		stateLayer: new Map(),
		layerIndex: new Map(),
		fightsAt: new Map(),
		triangles: new Map(),
		assets: new Map(),
		parts: new Map(),
		looks: new Map(),
		timelines: new Map(),
		machines: new Map(),
	};
	for (const text of atoms) {
		const atom = parseAtom(text);
		if (!atom) continue;
		const [a, b, c] = atom.args;
		switch (`${atom.name}/${atom.args.length}`) {
			case "node/1":
				facts.nodes.add(a);
				break;
			case "kind/2":
				// A kind the table does not know is not drawable by anything here.
				if (b in KINDS) facts.kind.set(a, b as NodeKind);
				break;
			case "order/2": {
				const n = Number(b);
				if (Number.isFinite(n)) facts.order.set(a, n);
				break;
			}
			case "child/2":
				// First parent wins, so a rule that gives a node two of them gets a
				// tree rather than a crash.
				if (!facts.parent.has(b)) facts.parent.set(b, a);
				break;
			case "frame/3": {
				const value = Number(c);
				if (!Number.isFinite(value)) break;
				// The planar four and the spatial two land in two different maps, and
				// the order of these two lookups is the no-regression promise: a
				// `frame(N,z,V)` must never reach `facts.frame`, or `boxOf` would
				// return five numbers and every consumer of `Frame` in the monorepo
				// would be reading a shape it does not have a field for.
				const axis = AXIS[b as keyof typeof AXIS];
				if (axis !== undefined) {
					let box = facts.frame.get(a);
					if (!box) facts.frame.set(a, (box = {}));
					box[axis] = value;
					break;
				}
				const spatial = SPATIAL_AXIS[b as keyof typeof SPATIAL_AXIS];
				if (spatial === undefined) break;
				let solid = facts.spatial.get(a);
				if (!solid) facts.spatial.set(a, (solid = {}));
				solid[spatial] = value;
				break;
			}
			case "turn/3": {
				// Thousandths of a degree, and an integer by construction — `mdeg/2`
				// is exact-or-nothing, so a rotation the program could not read emits
				// no atom at all rather than a rounding nobody typed. A non-numeric
				// third argument therefore came from a hand-written rule and is
				// dropped exactly as a non-numeric `order/2` is.
				if (!(b in TURNS)) break;
				const mdeg = Number(c);
				if (!Number.isFinite(mdeg)) break;
				let turns = facts.turn.get(a);
				if (!turns) facts.turn.set(a, (turns = new Map()));
				turns.set(b as Turn, mdeg);
				break;
			}
			case "rendered/3": {
				if (!(b in PROPS)) break;
				let props = facts.rendered.get(a);
				if (!props) facts.rendered.set(a, (props = new Map()));
				props.set(b as PropName, c);
				break;
			}
			case "literal/2":
				facts.literal.set(a, unquote(b));
				break;
			case "visible/1":
				facts.visible.add(a);
				break;
			case "group/1":
				// A group with no members is still a group: it is offered, and a
				// constraint over it simply says nothing yet.
				if (!facts.groups.has(a)) facts.groups.set(a, []);
				break;
			case "member/2": {
				const members = facts.groups.get(a);
				if (members) members.push(b);
				else facts.groups.set(a, [b]);
				break;
			}
			// A variable no document value named. Its alternatives are worth
			// collecting for exactly one reason: the editor cannot look them up
			// anywhere else.
			case "dvar/1":
				if (!facts.variables.has(a)) facts.variables.set(a, new Map());
				break;
			case "dalt/3": {
				const index = Number(b);
				if (!Number.isFinite(index)) break;
				let alts = facts.variables.get(a);
				if (!alts) facts.variables.set(a, (alts = new Map()));
				alts.set(index, c);
				break;
			}
			// Wearing the document did not state. Keyed by the style, because both
			// readers ask "who wears this one" rather than "what does this node
			// wear" — though a rule may well answer the second with two.
			case "sty_derived/3": {
				if (!(c in PROPS)) break;
				let nodes = facts.wears.get(b);
				if (!nodes) facts.wears.set(b, (nodes = new Map()));
				let props = nodes.get(a);
				if (!props) nodes.set(a, (props = new Set()));
				props.add(c as PropName);
				break;
			}
			// ---- state machines ----
			// A state copy's own frame/3 and rendered/3 need no case of their own:
			// both are already collected for whatever id they name, and
			// `stt(i1,hover,label)` is an id like any other. What is left is the
			// handful of predicates carrying something no other predicate does.
			case "shown/2": {
				// One instance is drawn in one state **per layer**, and the program
				// says so: `shown/2` is a fact rather than a choice precisely so that
				// states do not multiply universes, and the layer argument is not in
				// the atom because `mslayer/3` already answers which layer a state is
				// in. So every one of them is kept here, and the collapse to a single
				// state — which is what `ModelScene.shown` still promises — happens
				// once, in layer order, in `shownInLayerOrder`.
				//
				// Two shown states of the *same* layer is the case the shipped reader
				// was guarding against, and it is still guarded: the program reports it
				// as `mtwoshown/1`, and the tie-break below is the lower state id, so
				// that reading one answer set twice cannot give two different pictures.
				let states = facts.shown.get(a);
				if (!states) facts.shown.set(a, (states = new Set()));
				states.add(b);
				break;
			}
			case "mhidden/3":
				// Rebuilt into the term rather than kept as three arguments, because
				// the term is the key everything downstream holds a copy by.
				facts.stateHidden.add(statePart(a, b, c));
				break;
			case "munreached/2":
				machineFacts(facts, a).unreachable.push(b);
				break;
			case "mdeadend/2":
				machineFacts(facts, a).deadEnds.push(b);
				break;
			case "mnondet/3":
				machineFacts(facts, a).nondeterministic.push([b, c]);
				break;
			case "mdangling/2":
				machineFacts(facts, a).dangling.push(b);
				break;
			// The three motion tables. Whole milliseconds by construction — the
			// `millis/2` bridge is exact-or-nothing and the program clamps the two
			// that must not go negative — so a value that is not a number at all
			// came from a hand-written atom, and it is dropped exactly as a
			// non-numeric `order/2` is.
			case "mdur/3":
			case "mdelay/3":
			case "mstagger/3":
			// The fourth belongs with them exactly: an exit time is a `duration`
			// Value, it clamps at zero the way a delay does, and it is projected the
			// way a duration is. It arrived a feature later and nothing else about it
			// is different.
			case "mexit/3": {
				const ms = Number(c);
				if (!Number.isFinite(ms)) break;
				const field =
					atom.name === "mdur"
						? "duration"
						: atom.name === "mdelay"
							? "delay"
							: atom.name === "mstagger"
								? "stagger"
								: "exit";
				machineFacts(facts, a)[field][b] = ms;
				break;
			}
			// The fifth motion table, and the only one that is not a number, so it is
			// its own case rather than a fifth branch of the ternary above. Read
			// through `curveOf` for `mkeasing/5`'s reason: the predicate carries two
			// spellings, one of which is a term, and a curve neither reader knows is
			// dropped here so that the export takes `DEFAULT_EASING` — which is what
			// the program itself did through `not mreadsease(M,T)` before it ever got
			// here, so in practice this guard only ever catches a hand-written atom.
			case "measing/3": {
				const curve = curveOf(c);
				if (curve === undefined) break;
				machineFacts(facts, a).easing[b] = curve;
				break;
			}
			// ---- the ladder ----
			// The health lists, which are the program's own answers to questions
			// `machineHealth` also answers off the document — deliberately duplicated,
			// for the reason the shipped four are: a panel has to be able to say
			// "no valuation can take this edge" while the document is unsatisfiable
			// and there is no answer set at all.
			case "mguardnever/2":
				machineFacts(facts, a).impossible.push(b);
				break;
			case "mgunreached/2":
				machineFacts(facts, a).unreachableWithGuards.push(b);
				break;
			case "mmisplaced/2":
				machineFacts(facts, a).misplaced.push(b);
				break;
			case "mstopgap/2":
				machineFacts(facts, a).stopGaps.push(b);
				break;
			case "mtwosource/2":
				machineFacts(facts, a).twoSource.push(b);
				break;
			case "mexitpast/2":
				machineFacts(facts, a).exitPast.push(b);
				break;
			// The three fights, which are one shape three times over: two layers, a
			// part, and the thing they are arguing about. Three fields rather than one
			// with a tag, because "these two layers both paint the fill" and "these two
			// layers both turn it" are two sentences a panel writes differently and
			// because the third argument is drawn from three different vocabularies.
			case "mfight/5":
			case "mffight/5":
			case "mrfight/5": {
				const [, l1, l2, node, over] = atom.args;
				const field =
					atom.name === "mfight"
						? "fights"
						: atom.name === "mffight"
							? "frameFights"
							: "rotationFights";
				machineFacts(facts, a)[field].push([l1, l2, node, over]);
				break;
			}
			// ...and the same fight as *drawn*, which is about an instance and not
			// about a machine, so it lands beside the picture rather than beside the
			// health.
			case "mfightat/5": {
				const [instance, l1, l2, node, prop] = atom.args;
				let at = facts.fightsAt.get(instance);
				if (!at) facts.fightsAt.set(instance, (at = []));
				at.push([l1, l2, node, prop]);
				break;
			}
			case "mstopout/3": {
				const stop = Number(c);
				if (!Number.isInteger(stop)) break;
				machineFacts(facts, a).stopsOutOfRange.push([b, stop]);
				break;
			}
			case "mkbackwards/4": {
				const index = Number(atom.args[3]);
				if (!Number.isInteger(index)) break;
				machineFacts(facts, a).backwardsKeys.push([b, c, index]);
				break;
			}
			// Which layer a state is in and where a layer sits. Read by nothing a
			// panel calls directly and by everything here: the join from an instance
			// to its machine, the order `ModelScene.shown` collapses in, and the
			// timeline a keyframe copy is a moment of all come through these two.
			case "mslayer/3":
				// First in sorted order wins where two machines share a state id — see
				// `Facts.stateLayer`. Sorted rather than first-seen, so that clingo's
				// print order cannot decide it.
				if (!facts.stateLayer.has(b) || a < (facts.stateLayer.get(b)?.machine ?? "")) {
					facts.stateLayer.set(b, { machine: a, layer: c });
				}
				break;
			case "mlindex/3": {
				const index = Number(c);
				if (!Number.isFinite(index)) break;
				let layers = facts.layerIndex.get(a);
				if (!layers) facts.layerIndex.set(a, (layers = new Map()));
				layers.set(b, index);
				break;
			}
			// ---- timelines ----
			// A keyframe copy's frame/3, rendered/3 and turn/3 need no case of their
			// own, exactly as a state copy's do not: `kfr(b1,pulse,trkd(label,y),2)`
			// is an id like any other. What is left is what no other predicate says.
			case "mtlen/3": {
				const ms = Number(c);
				if (!Number.isFinite(ms)) break;
				timelineFacts(facts, a, b).length = ms;
				break;
			}
			case "mloop/3":
				// A mode outside the three is a mode no rule can match, and treating it
				// as `none` would silently disable a loop somebody wrote. Dropped, so
				// the default below is what answers, and the default is `none`.
				if (c === "none" || c === "loop" || c === "pingPong") {
					timelineFacts(facts, a, b).loop = c;
				}
				break;
			case "mkat/5": {
				const [, timeline, track, index, ms] = atom.args;
				const key = Number(index);
				const at = Number(ms);
				if (!Number.isInteger(key) || !Number.isFinite(at)) break;
				keyFacts(facts, a, timeline, track, key).at = at;
				break;
			}
			// Two spellings, one reader, and it is `curveOf` — the same function the
			// document side falls back through — rather than a membership test against
			// `EASINGS`. A menu-word test was what shipped here, and it was right for
			// exactly as long as `mkeasing/5` was a fact this repository wrote: it is
			// derived now, and its second rule puts `cubicBezier(200,0,0,1000)` in the
			// answer set, which a membership test would drop on the floor. A curve
			// neither spelling knows is dropped and the default is taken below, which
			// is what `mdefease/1` says in the program.
			case "mkeasing/5": {
				const [, timeline, track, index, easing] = atom.args;
				const key = Number(index);
				const curve = curveOf(easing);
				if (!Number.isInteger(key) || curve === undefined) break;
				keyFacts(facts, a, timeline, track, key).easing = curve;
				break;
			}
			// ---- three dimensions ----
			case "tris/2": {
				const count = Number(b);
				if (!Number.isFinite(count)) break;
				facts.triangles.set(a, count);
				break;
			}
			// A quoted term, because a tree path holds slashes and dots and a bare
			// one is not a constant a grounder would take. It was quoted when it
			// held a SHA-256 for the neighbouring reason — 64 hex characters
			// starting with a digit — and stayed quoted when it became a path,
			// which is why `f2b6316` was a one-expression change on the writing
			// side and no change at all here.
			case "asset/2": {
				const path = unquote(b);
				if (path === "") break;
				facts.assets.set(a, path);
				break;
			}
			// The other half of that sentence: which part of the file. Two bare
			// integers, not quoted, because they are numbers and a grounder takes
			// them as numbers — see `compile.ts`, which argues at length why this
			// is a second atom rather than a `#node=3` on the end of the path.
			//
			// Both must parse and both must be whole and non-negative, and a half
			// that fails takes the whole pair down: `part` is stored as a pair
			// because a node index without a primitive index addresses nothing, and
			// filling the missing half with a zero would hand the renderer a
			// well-formed reference to geometry nobody asked for. A hand-written
			// rule stating `meshpart(n, foo, 0)` therefore leaves the node drawing
			// its stand-in box, which is the same silence a missing `asset/2`
			// leaves and is read the same way by the same code.
			case "meshpart/3": {
				const node = Number(b);
				const primitive = Number(c);
				if (!Number.isInteger(node) || node < 0) break;
				if (!Number.isInteger(primitive) || primitive < 0) break;
				facts.parts.set(a, { node, primitive });
				break;
			}
			case "vcam/2":
				// `vcam/2` and not `looks/2`: this is the claim that survived being
				// checked. The lower camera id wins where a rule named two, for the
				// reason `shown/2`'s tie-break exists — one answer set has to read the
				// same way twice.
				if (!facts.looks.has(a) || b < (facts.looks.get(a) ?? "")) facts.looks.set(a, b);
				break;
		}
	}
	return facts;
}

/**
 * What a `rendered/3` or an alternative's third argument actually says.
 *
 * The generated program always names an interned literal, so the id is a
 * constant and the table has it. A hand-written rule may spell the text out
 * instead — `rendered(cell(1,1),fill,"#38bdf8")` — and a quoted term can never
 * be an id, so there is no ambiguity to resolve.
 *
 * `undefined` for a literal id the table has not got: that is a dangling id, not
 * an empty string, and every caller drops it rather than rendering nothing as
 * if it were something.
 */
function textOf(literal: string, facts: Facts): string | undefined {
	return literal.startsWith('"') ? unquote(literal) : facts.literal.get(literal);
}

/**
 * Everything one term draws with, as final text.
 *
 * One function for a node and for a state copy because it is one question: the
 * program says `rendered/3` about both and means the same thing by it, and the
 * only difference between the two is which term is being asked about. A second
 * copy of this loop for states is how the two would drift.
 */
function renderedTexts(id: string, facts: Facts): Partial<Record<PropName, string>> {
	const rendered: Partial<Record<PropName, string>> = {};
	for (const [prop, literal] of facts.rendered.get(id) ?? []) {
		const text = textOf(literal, facts);
		if (text !== undefined) rendered[prop] = text;
	}
	return rendered;
}

/**
 * What simplex worked out for a term — **and the other half of the shown-state
 * alias**, which is here rather than in the program because it has to be.
 *
 * The program says `inst(I,N)` is a view of the shown state's copy, and it says
 * it in the only place a rule can: `frame(inst(I,N),D,V) :- frame(stt(I,S,N),D,V),
 * shown(I,S)`. That carries the *stated* geometry across and cannot carry the
 * solved geometry, because solved geometry is not in `frame/3` at all — it is a
 * theory answer, `__lpx(lv(stt(i1,rest,label),y),"1714500")`, and a theory atom
 * is not something an ASP rule can read and re-state under another term. So the
 * alias is written twice: once as a rule over `frame/3`, and once here, over the
 * layer the rule cannot reach.
 *
 * Without this, a `pin` on `stt(b1,rest,label)` in a document whose instance is
 * drawn in `rest` moves the copy and leaves the drawn element where the
 * definition put it — one state and two pictures, on the canvas, in the layer
 * list's geometry and in the exported stylesheet. Spec §1's promise that
 * `gsolved/1` and `ge/2` not needing `node/1` is "exactly what lets a rule place
 * two states" is only true if placing the shown one also places what is drawn.
 *
 * The instance part's *own* solved geometry still wins where it has any, and the
 * asymmetry is deliberate: a rule that names `inst(I,N)` in a geometric
 * constraint is talking about the drawn element directly, while one that names
 * the copy is talking about a state that happens to be the one on show. Where
 * both are named the picture can only be one of them, and the nearer claim wins.
 * Per dimension rather than per node, for the reason the `mfshadow/3` guard is:
 * a rule that pins the copy's `top` leaves its width to whoever else has an
 * opinion about it.
 *
 * **Layers make "the shown copy" plural**, and the loop below is where that is
 * dealt with. The alias in the program is not over `shown/2` alone: it is
 * `frame(inst(I,N),D,V) :- frame(stt(I,S,N),D,V), shown(I,S), mslayer(M,S,L),
 * mfwriter(M,L,N,D)`, so the state whose geometry reaches the drawn part is the
 * one in the *last* layer with an opinion about that dimension. `mfwriter/4` is
 * derived and not shown — nothing outside the program reads it — so this walks
 * the shown copies in layer order and lets the later ones win, which is the same
 * answer wherever exactly one layer has solved geometry for a dimension, and is
 * the last layer's where two do. On a machine with no layers there is one shown
 * copy and this is the shipped line, atom for atom.
 */
function solvedView(
	id: string,
	facts: Facts,
	solved: Record<string, Partial<Box>>,
): Partial<Box> | undefined {
	const own = solved[id];
	// Only an instance part can be a view of a copy. A state copy asking this
	// about itself would be asking about `stt(I,S,stt(...))`, which is nothing.
	const part = parseInstancePart(id);
	if (!part) return own;
	let across: Partial<Box> | undefined;
	for (const state of shownInLayerOrder(facts, part.instance)) {
		const copy = solved[statePart(part.instance, state, part.node)];
		if (copy === undefined) continue;
		across = across === undefined ? copy : { ...across, ...copy };
	}
	if (across === undefined) return own;
	return own === undefined ? across : { ...across, ...own };
}

/**
 * Where one term is: the stated frame, with anything simplex worked out on top.
 *
 * The same precedence for a state copy as for a node, and the same lines, which
 * is the point of it being a function. A copy reaches `gsolved/1` exactly as a
 * node does — a geometric constraint may name one, which is the whole reason
 * `stt/3` is not a `node/1` — so `__lpx(lv(stt(i1,hover,label),x),…)` has to
 * beat the copy's own `frame/3` for the same reason a node's does.
 *
 * Four numbers, still and deliberately. A solved `z` is in the same record as a
 * solved `x` and is filtered out here rather than at the source, because the
 * source is one theory answer about one term and this is the one function whose
 * promise is a {@link Frame}.
 */
function boxOf(id: string, facts: Facts, solved: Record<string, Partial<Box>>): Frame {
	return {
		x: 0,
		y: 0,
		width: 0,
		height: 0,
		...facts.frame.get(id),
		...planarPart(solvedView(id, facts, solved)),
	};
}

/**
 * The other two, or nothing at all — and "nothing at all" is the answer that
 * matters.
 *
 * A node is in the third axis or it is not: `s3/1` decides, the program states
 * `frame(N,z,0)` only for the ones that are, and a document with no viewport and
 * no lifted node states none. So absence here is a claim — "this is a flat thing
 * in a flat place" — rather than a missing field, and it is what keeps every
 * existing assertion about every existing template true without one of them being
 * rewritten.
 *
 * Where the answer set said *anything*, both numbers come back, with the one it
 * did not mention read as zero. That is what the program means by a dimension it
 * did not state, it is what `spatialDim` in scene.ts answers off the document,
 * and it spares every caller the question.
 */
function spatialOfTerm(
	id: string,
	facts: Facts,
	solved: Record<string, Partial<Box>>,
): Record<Spatial, number> | undefined {
	const stated = facts.spatial.get(id);
	const worked = spatialPart(solvedView(id, facts, solved));
	if (stated === undefined && worked.z === undefined && worked.depth === undefined) {
		return undefined;
	}
	return { z: 0, depth: 0, ...stated, ...worked };
}

/**
 * How one term is turned, or nothing at all — the twin of {@link spatialOfTerm}
 * one quantity over, and absent for the same reason.
 *
 * No solved half, and that is not an omission: a rotation is never a theory
 * variable. `turn/3` holds thousandths of a degree, a rotation about the centre
 * leaves every linear quantity exactly where it was, and simplex is never asked
 * about an angle — which is the decision the whole rotation feature rests on and
 * why a turned node keeps its centre and loses its faces.
 */
function turnOfTerm(id: string, facts: Facts): Record<Turn, number> | undefined {
	const stated = facts.turn.get(id);
	if (stated === undefined) return undefined;
	const out = { rotateX: 0, rotateY: 0, rotateZ: 0 };
	for (const axis of TURN_NAMES) {
		const mdeg = stated.get(axis);
		if (mdeg !== undefined) out[axis] = mdeg;
	}
	return out;
}

/**
 * The two optional halves of a pose, as a patch a spread can apply.
 *
 * One function for a node, a state copy and a keyframe copy, for
 * {@link renderedTexts}' reason exactly: the program says `frame/3` and `turn/3`
 * about all three and means the same thing by them, and a second copy of this
 * per term kind is how the three would drift.
 */
function poseExtras(
	id: string,
	facts: Facts,
	solved: Record<string, Partial<Box>>,
): { spatial?: Record<Spatial, number>; turn?: Record<Turn, number> } {
	const spatial = spatialOfTerm(id, facts, solved);
	const turn = turnOfTerm(id, facts);
	return { ...(spatial && { spatial }), ...(turn && { turn }) };
}

/**
 * Which layer a machine stacks this one at, lowest first — the priority
 * `mlindex/3` carries, with the unknown pushed to the end.
 *
 * A layer the answer set has no index for is a layer some hand-written rule
 * invented, and it goes last rather than first: an unknown priority that beat
 * every stated one would let one asserted atom silently take over the picture.
 */
function layerRank(facts: Facts, machine: string | undefined, layer: string | undefined): number {
	if (machine === undefined || layer === undefined) return Number.MAX_SAFE_INTEGER;
	return facts.layerIndex.get(machine)?.get(layer) ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Every state one instance is drawn in, in the order its layers are stacked.
 *
 * The single place `shown/2`'s plurality is turned back into an order, and every
 * reader of it — {@link ModelScene.shown}, {@link ModelScene.shownByLayer} and
 * {@link solvedView} — goes through here so that the three cannot disagree about
 * which state is "the" one. Lowest layer index first, with the state id as the
 * tie-break, so two states of one layer (which is `mtwoshown/1`, and which is a
 * document being reported on rather than repaired) still read the same way
 * twice.
 */
function shownInLayerOrder(facts: Facts, instance: string): string[] {
	const states = facts.shown.get(instance);
	if (states === undefined) return [];
	return [...states].sort((s1, s2) => {
		const a = facts.stateLayer.get(s1);
		const b = facts.stateLayer.get(s2);
		return (
			layerRank(facts, a?.machine, a?.layer) - layerRank(facts, b?.machine, b?.layer) ||
			cmp(s1, s2)
		);
	});
}

/**
 * Which machine drives one instance, joined through the state it is drawn in.
 *
 * `minstance/2` is shown by nothing and that is deliberate — an instance's
 * machine is a fact about the *document*, and the panel that wants it reads it
 * there. But two things in this file need it against an *answer set* that may
 * describe an instance a rule brought into being: a keyframe copy has to find
 * the timeline it is a moment of, and a shown state has to find the layer order
 * it is ranked by. `shown/2` and `mslayer/3` are both shown, and their join is
 * exactly this, at the cost of one ambiguity — two machines holding a state of
 * the same id — which `Facts.stateLayer` settles by taking the lower machine id.
 */
function machineOfInstance(facts: Facts, instance: string): string | undefined {
	for (const state of shownInLayerOrder(facts, instance)) {
		const at = facts.stateLayer.get(state);
		if (at) return at.machine;
	}
	return undefined;
}

/**
 * Whether a node is drawn: it has to be visible itself, and so does everything
 * it hangs from. Hiding a frame hides what is inside it, which is what the
 * editor already does and what anyone asserting `hidden/1` means.
 */
function drawn(id: string, facts: Facts): boolean {
	// A cycle in child/2 is only reachable from a hand-written rule, but it is
	// reachable, and an unguarded walk up would not come back.
	const seen = new Set<string>();
	for (let at: string | undefined = id; at !== undefined; at = facts.parent.get(at)) {
		if (seen.has(at)) return false;
		seen.add(at);
		if (!facts.visible.has(at)) return false;
		if (!facts.kind.has(at)) return false;
	}
	return true;
}

/** String order, spelled once so that a sort by it reads as the sort it is. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Paint order, with the id as a tie-break so a reading is never arbitrary. */
function byOrder(a: ModelNode, b: ModelNode): number {
	return a.order - b.order || cmp(a.id, b.id);
}

/**
 * The scene one answer set describes.
 *
 * Solved geometry is folded in, so `frame` is where the node actually is
 * rather than where the document last stored it. Nodes that are not drawn —
 * hidden, or of a kind nothing knows how to draw — are absent along with
 * their subtrees, which is why this is a *renderable* scene rather than a
 * transcription of the atoms.
 *
 * The state material is the one part that is *not* filtered that way, and the
 * asymmetry is deliberate. A state copy is never drawn, so there is no such
 * thing as one being drawn or not: a state that hides a part still has that
 * part in {@link ModelScene.states} with `hidden: true`, because "this state
 * takes the panel away" is exactly what its two readers need to be told. What a
 * hidden part *looks* like where it is not hidden is still there to be read,
 * which is what lets the export write one rule and the canvas swap back.
 *
 * An answer set asked for without `scenery` has none of these predicates in it,
 * so it reads as no states, no shown instances and no machines — the same
 * reading it already gives for the picture, and for the same reason: absence is
 * a question that was not asked, not an error.
 */
export function readModel(atoms: readonly string[]): ModelScene {
	const facts = collect(atoms);
	const solved = readSolved(atoms);

	// In id order, which is the same argument that sorts the copies, the fights,
	// the health lists and the `wears` table: two readings of one answer set have
	// to be the same reading, and `node/1` arrives in whatever order clingo
	// happened to print it. This was the one map in the file that let that order
	// through, and it let it through invisibly — the same program grounds the
	// same way twice, so nothing would ever have noticed until something
	// reordered the atoms on the way in.
	//
	// What it reaches, and it is worth being exact rather than alarming: the
	// *tree* never depended on it, because `roots` and `children` are sorted by
	// `order/2` a few lines below. The keys are read in order in one place —
	// `drawnGeometry` in export.ts walks `Object.values(byId)` to find a diagonal
	// or plotted node that changed size between universes — and what that decides
	// is which node gets *named* in the refusal when two of them did. A document
	// with two resized arrows in it blamed whichever one the search printed
	// first. Every template exports byte-identically either way, checked rather
	// than assumed; this is the class of thing that is cheap now and archaeology
	// later.
	const byId: Record<string, ModelNode> = {};
	for (const id of [...facts.nodes].sort(cmp)) {
		if (!drawn(id, facts)) continue;
		const kind = facts.kind.get(id);
		if (!kind) continue;
		byId[id] = {
			id,
			kind,
			order: facts.order.get(id) ?? 1,
			frame: boxOf(id, facts, solved),
			...poseExtras(id, facts, solved),
			rendered: renderedTexts(id, facts),
			...(facts.assets.has(id) ? { asset: facts.assets.get(id) } : {}),
			...(facts.parts.has(id) ? { part: facts.parts.get(id) } : {}),
			children: [],
		};
	}

	const roots: ModelNode[] = [];
	for (const node of Object.values(byId)) {
		const parent = facts.parent.get(node.id);
		const under = parent === undefined ? undefined : byId[parent];
		if (under) under.children.push(node);
		else roots.push(node);
	}
	roots.sort(byOrder);
	for (const node of Object.values(byId)) node.children.sort(byOrder);

	const groups: Record<string, string[]> = {};
	for (const [id, members] of facts.groups) groups[id] = members.sort();
	const variables: Record<string, ModelAlternative[]> = {};
	for (const [key, alts] of facts.variables) {
		variables[key] = [...alts]
			.sort(([a], [b]) => a - b)
			// A dangling literal id is not an empty alternative; drop it, the way
			// a rendered property with no text is dropped above.
			.flatMap(([index, literal]) => {
				const text = textOf(literal, facts);
				return text === undefined ? [] : [{ index, text }];
			});
	}

	// In table order rather than in the order the atoms arrived, so a class's
	// declarations come out in the same order for a rule's wearer as for the
	// document's.
	const wears: Record<string, ModelWearer[]> = {};
	for (const [style, nodes] of facts.wears) {
		wears[style] = [...nodes]
			.sort(([a], [b]) => cmp(a, b))
			.map(([node, props]) => ({
				node,
				props: PROP_NAMES.filter((prop) => props.has(prop)),
			}));
	}

	// Every state copy the answer set mentions, whichever predicate mentioned it.
	//
	// Enumerated from the atoms rather than from a list of copies, because there
	// is no such list to read: `mcopy/3` is not shown, and it would not be enough
	// if it were — a hand-written rule may state `frame(stt(i1,hover,label),x,10)`
	// about a copy the compiler never minted, and that copy is as real as any
	// other. So the question asked is the one the reader actually cares about:
	// which terms in this answer set parse as a state copy. Four sources, because
	// a copy may have geometry, appearance, solved geometry or nothing but its
	// absence, and any one of those is enough to have something to say about it.
	//
	// Sorted, so that `Object.keys(states)` is a property of the answer set and
	// not of the order clingo happened to print it in.
	//
	// Two kinds of copy come out of one pass, because they are found the same way
	// and because a second pass over the same five key sets would be a second
	// chance to disagree about which terms exist. `turn/3` is the fifth source and
	// it is not a formality: a state whose only delta is a rotation says nothing
	// through `frame/3` or `rendered/3`, and without it that copy would be missing
	// from a document that plainly holds it.
	const states: Record<string, ModelState> = {};
	const keyframes: Record<string, ModelKeyframe> = {};
	const copies = new Set([
		...facts.frame.keys(),
		...facts.spatial.keys(),
		...facts.turn.keys(),
		...facts.rendered.keys(),
		...facts.stateHidden,
		...Object.keys(solved),
	]);
	for (const id of [...copies].sort()) {
		const parsed = parseStatePart(id);
		if (parsed) {
			states[id] = {
				instance: parsed.instance,
				state: parsed.state,
				part: parsed.node,
				frame: boxOf(id, facts, solved),
				...poseExtras(id, facts, solved),
				rendered: renderedTexts(id, facts),
				hidden: facts.stateHidden.has(id),
			};
			continue;
		}
		const key = parseKeyCopy(id);
		if (!key) continue;
		// The time and the curve belong to the *machine* and the copy belongs to the
		// instance — that split is the timeline budget, see `keyCopy` — so the two
		// are joined here, through the machine the instance's shown state names. An
		// instance whose machine cannot be found reads as 0 and the default curve
		// rather than being dropped: the copy is in the answer set, a rule asked for
		// it, and a pose with an unknown time is still a pose.
		const machine = machineOfInstance(facts, key.instance);
		const at =
			machine === undefined
				? undefined
				: facts.timelines.get(machine)?.get(key.timeline)?.tracks.get(key.track)?.get(key.index);
		keyframes[id] = {
			instance: key.instance,
			timeline: key.timeline,
			track: key.track,
			index: key.index,
			at: at?.at ?? 0,
			frame: boxOf(id, facts, solved),
			...poseExtras(id, facts, solved),
			rendered: renderedTexts(id, facts),
			easing: at?.easing ?? DEFAULT_EASING,
		};
	}

	// One instance, one state per layer, and `shown` is the first layer's — which
	// is what every reader written before layers existed is asking about, and which
	// is the only state there is on a machine the document gave no layers.
	//
	// In the order the instances arrived and **not** sorted, which is the one
	// place in this function that looks like an oversight and is not. `shown` is
	// an object, the export walks it to write one class per state, and the text it
	// writes is asserted byte-for-byte against a fixture — so sorting here would
	// reorder a stylesheet for no reason anyone asked for. The order is stable
	// anyway: it is the order one answer set prints its atoms in, which is a
	// property of that answer set. The *values* are what had to stop being
	// arbitrary, and `shownInLayerOrder` is where that happens.
	const shown: Record<string, string> = {};
	const shownByLayer: Record<string, Record<string, string>> = {};
	for (const instance of facts.shown.keys()) {
		const order = shownInLayerOrder(facts, instance);
		const first = order[0];
		if (first !== undefined) shown[instance] = first;
		const byLayer: Record<string, string> = {};
		for (const state of order) {
			const at = facts.stateLayer.get(state);
			// A shown state no `mslayer/3` places is a state some hand-written rule
			// asserted. It is in `shown` where it sorts first and it is not in here,
			// because "which state is this layer showing" has no answer for a state
			// that is in no layer, and inventing one would put a state a panel cannot
			// name into a strip indexed by layer.
			if (at === undefined) continue;
			// The lower state id wins a layer, which is `mtwoshown/1` — two pictures
			// on top of each other, reported by the program and read the same way
			// twice by this.
			if (byLayer[at.layer] === undefined) byLayer[at.layer] = state;
		}
		shownByLayer[instance] = byLayer;
	}

	// Sorted for the same reason the copies are, and by the same argument that
	// puts `wears` in table order: two readings of one answer set have to be the
	// same reading, and a panel listing three unreachable states should not
	// reorder them because a solve came back differently.
	const machines: Record<string, ModelMachine> = {};
	for (const [id, machine] of facts.machines) {
		machines[id] = {
			unreachable: machine.unreachable.sort(),
			deadEnds: machine.deadEnds.sort(),
			nondeterministic: machine.nondeterministic.sort(
				([s1, g1], [s2, g2]) => cmp(s1, s2) || cmp(g1, g2),
			),
			dangling: machine.dangling.sort(),
			duration: machine.duration,
			delay: machine.delay,
			stagger: machine.stagger,
			easing: machine.easing,
			exit: machine.exit,
			impossible: machine.impossible.sort(),
			unreachableWithGuards: machine.unreachableWithGuards.sort(),
			misplaced: machine.misplaced.sort(),
			fights: machine.fights.sort(byQuad),
			frameFights: machine.frameFights.sort(byQuad),
			rotationFights: machine.rotationFights.sort(byQuad),
			stopsOutOfRange: machine.stopsOutOfRange.sort(
				([s1, j1], [s2, j2]) => cmp(s1, s2) || j1 - j2,
			),
			stopGaps: machine.stopGaps.sort(),
			twoSource: machine.twoSource.sort(),
			exitPast: machine.exitPast.sort(),
			backwardsKeys: machine.backwardsKeys.sort(
				([w1, r1, k1], [w2, r2, k2]) => cmp(w1, w2) || cmp(r1, r2) || k1 - k2,
			),
			// The stacking order itself, which is the priority — see
			// `ModelMachine.layers`. Ties cannot happen, because `mlindex/3` is the
			// document array's own index, but the id breaks one anyway so that a
			// hand-written rule cannot make this arbitrary.
			layers: [...(facts.layerIndex.get(id) ?? new Map())]
				.sort(([l1, k1], [l2, k2]) => k1 - k2 || cmp(l1, l2))
				.map(([layer]) => layer),
			timelines: readTimelines(facts.timelines.get(id)),
		};
	}

	const fightsAt: Record<string, Array<[string, string, string, string]>> = {};
	for (const [instance, fights] of facts.fightsAt) fightsAt[instance] = fights.sort(byQuad);

	const triangles: Record<string, number> = {};
	for (const [id, count] of [...facts.triangles].sort(([a], [b]) => cmp(a, b))) {
		triangles[id] = count;
	}
	// Sorted like its neighbours, so one answer set reads the same way twice.
	const assets: Record<string, string> = {};
	for (const [id, hash] of [...facts.assets].sort(([a], [b]) => cmp(a, b))) {
		assets[id] = hash;
	}
	const looks: Record<string, string> = {};
	for (const [view, camera] of [...facts.looks].sort(([a], [b]) => cmp(a, b))) {
		looks[view] = camera;
	}

	return {
		roots,
		byId,
		groups,
		variables,
		wears,
		states,
		shown,
		shownByLayer,
		keyframes,
		machines,
		fightsAt,
		triangles,
		assets,
		looks,
	};
}

/** Four ids, compared in order — the sort every fight list gets. */
function byQuad(
	[a1, b1, c1, d1]: readonly [string, string, string, string],
	[a2, b2, c2, d2]: readonly [string, string, string, string],
): number {
	return cmp(a1, a2) || cmp(b1, b2) || cmp(c1, c2) || cmp(d1, d2);
}

/**
 * One machine's timelines, frozen out of the half-built records `collect` filled.
 *
 * The keyframes come out **in the order this universe puts them in** — resolved
 * time first, index as the tie-break — which is the same stable sort
 * `solvedKeys` uses over the document, so "key 3" is the same keyframe in the
 * panel, in the `kfr(...)` term and here. A key with an easing and no time sits
 * at 0, exactly as `solvedKeys` puts one whose `at` reads as no duration at 0:
 * it is a keyframe somebody wrote, and dropping it would renumber the ones after
 * it and quietly change which one a rule was about.
 *
 * `loop` defaults to `none` and `length` to 0. Neither default should ever be
 * reached from a compiled document — `mloop/3` is emitted per timeline and
 * `mtlen/3` is derived from the last key where the document is silent — and both
 * are here because a hand-written rule may name a timeline the compiler never
 * emitted, and the reading of a timeline nobody said anything about is a
 * zero-length one that does not repeat.
 */
function readTimelines(
	lines: Map<string, TimelineFacts> | undefined,
): Record<string, ModelTimeline> {
	const out: Record<string, ModelTimeline> = {};
	for (const [id, line] of [...(lines ?? new Map<string, TimelineFacts>())].sort(([a], [b]) =>
		cmp(a, b),
	)) {
		const tracks: Record<string, Array<{ index: number; at: number; easing: string }>> = {};
		for (const [term, keys] of [...line.tracks].sort(([a], [b]) => cmp(a, b))) {
			tracks[term] = [...keys]
				.map(([index, key]) => ({
					index,
					at: key.at ?? 0,
					easing: key.easing ?? DEFAULT_EASING,
				}))
				.sort((a, b) => a.at - b.at || a.index - b.index);
		}
		out[id] = { length: line.length ?? 0, loop: line.loop ?? "none", tracks };
	}
	return out;
}

/**
 * Properties every member of a group holds — what a rule over it may be about.
 *
 * The group's members are nodes of the answer set rather than of the document,
 * so the question is the same one {@link sharedProps} answers and the source of
 * the kinds is the only difference.
 */
export function groupProps(
	model: ModelScene,
	members: readonly string[],
): PropName[] {
	const kinds = members.flatMap((id) => {
		const node = model.byId[id];
		return node ? [node.kind] : [];
	});
	return sharedPropsOfKinds(kinds);
}
