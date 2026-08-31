import { at, frame, rect, text } from "./shared.ts";
import { makeNode } from "../edits.ts";
import {
	type Machine,
	RULES_HEADER,
	type Scene,
	type SceneNode,
	starterTokens,
} from "../scene.ts";
import { derive, propVar, ref, single } from "../values.ts";

/**
 * A transport bar driven from outside: three inputs, three guarded edges, two
 * layers — and **exactly as many designs as the same bar with no machine at
 * all**.
 *
 * `machine` makes that claim about *states*. This one makes it about the whole
 * rest of the ladder, which is the harder half and the one where a cheaper
 * encoding would finally have given up. Under a choice rule a state is a design;
 * two layers of it are a product of two choice rules; and a four-state layer
 * beside a three-state layer is twelve universes nobody is choosing between
 * eleven of. Worse, the question a person actually asks about layers — "does the
 * meter still line up when the bar is also playing?" — becomes unaskable,
 * because the two layers' states are in two different answer sets.
 *
 * Under copies, both layers are true at once in one answer set, the composite is
 * a rule, and this template is two designs before and after. Adding a third
 * layer would cost nothing at all.
 *
 * The three rungs, and what each is doing here:
 *
 *   - **Inputs** are what a host hands the machine — see {@link MachineInput}.
 *     `armed` is a boolean, `level` is a number with a closed range, `spike` is
 *     a trigger. An input is a runtime value and emphatically not a design-space
 *     one: nothing in the picture, nothing in the base layer of the export and
 *     no projected atom moves when one changes, which is why three of them add
 *     no universes and why their comparands are plain strings rather than
 *     {@link Value}s.
 *
 *   - **Guards** are what has to hold as well as the trigger. All three inputs
 *     are read by one, which is not tidiness — `machine_input_read` is a check,
 *     and an input nothing consults is a wire somebody forgot to connect. The
 *     conjunction is total and there is no `or`, so "two ways in" is two edges
 *     with two ids, and a violation names the impossible one rather than half of
 *     a boolean expression.
 *
 *   - **Layers** are two states on screen at once. `transport` moves the knob,
 *     `meter` repaints the track, and **they touch different things on
 *     purpose**: two layers writing one property of one part is a fight, the
 *     later layer wins by position, and `machine_layers_agree` reports it. A
 *     template that shipped with a finding in it would be teaching the finding,
 *     so this one is clean on all eleven checks — and making it dirty is one of
 *     the things the rules panel below suggests trying.
 *
 * The instance is drawn in one state of *each* layer, which is what
 * {@link SceneNode.states} is for: two layers composed into one picture, beside
 * the definition, in the same answer set. A sprite sheet cannot do that, because
 * the two would be two documents.
 */
export function deck(): Scene {
	/**
	 * The definition: a bar, a track, a knob and a label, and nothing anywhere
	 * that knows about states, inputs or layers.
	 *
	 * Worth noticing for what it is *not*, exactly as in `machine`. There is no
	 * layer field on any node here and no second copy of the subtree. The ladder
	 * is a record beside the styles that names this root; the definition is the
	 * ordinary component it was before, which is what keeps deleting the whole
	 * machine a one-line change.
	 */
	const definition: SceneNode = {
		...frame(
			"bar",
			"Bar",
			[40, 128, 232, 64],
			{
				fill: [ref("accent"), ref("slate")],
				radius: [ref("radius")],
				// Stated on the definition rather than only in the lit state, because
				// a state that changes a colour must have a colour to change: a
				// property a state paints and the definition does not is a property
				// whose base value is the kind's fallback, and a template should not
				// teach that by accident.
				stroke: single("#00000000"),
				strokeWidth: single("2px"),
			},
			[
				rect("track", "Track", [16, 40, 200, 8], {
					fill: [ref("muted")],
					radius: single("4px"),
				}),
				rect("knob", "Knob", [16, 34, 20, 20], {
					fill: [ref("surface")],
					radius: single("10px"),
				}),
				text("label", "Label", [16, 12, 200, 18], "Transport", {
					// Worked out per instance from *that* instance's fill, so a state
					// that repaints the bar keeps its own label readable without
					// anybody writing the second colour down.
					ink: [derive("contrast", propVar("bar", "fill"))],
					size: single("13px"),
					weight: single("600"),
				}),
			],
		),
		component: true,
	};

	/**
	 * Two layers, three inputs, six edges.
	 *
	 * The layers are in order and **the position is the priority** — later layers
	 * win, the same "the order *is* the answer" that makes the first state the
	 * initial one and `order/2` the paint order. Reordering the strip is how a
	 * designer settles a fight, which is one edit rather than two that can
	 * disagree.
	 */
	const transport: Machine = {
		id: "deck",
		name: "Deck",
		root: "bar",
		inputs: [
			/**
			 * Whether the deck may start at all — the boolean case, and the one that
			 * shows a guard doing the thing a guard is for.
			 *
			 * `initial: "true"`, so `play` is takeable from the moment the file
			 * loads. Set it to `"false"` and the edge is still legal and still
			 * never taken, which is a different sentence from deleting it and is
			 * why `mguardnever` reports the *impossible* guard and says nothing
			 * about this one.
			 */
			{ id: "armed", name: "armed", kind: "boolean", initial: "true" },
			/**
			 * How loud, from nothing to everything — the number case, with both ends
			 * closed.
			 *
			 * The range is stated, and absent would have been *open* rather than
			 * zero: a designer who has not said how far a thing goes has not said
			 * that it does not go anywhere, and a check that invented a `0` would
			 * report violations against a claim nobody made. Read through
			 * `permilleOf`, so `0.62` is 620 thousandths and the guard below is an
			 * integer comparison rather than a float one.
			 */
			{ id: "level", name: "level", kind: "number", initial: "0.62", min: "0", max: "1" },
			/**
			 * A pulse, not a value — see {@link INPUT_KINDS}. It holds nothing
			 * between events: "fired" is true for one evaluation and false
			 * afterwards, because a runtime that kept it true would fire every
			 * guarded edge on the next unrelated event, which reads to a person as
			 * a machine that has gone off on its own.
			 */
			{ id: "spike", name: "spike", kind: "trigger" },
		],
		layers: [
			{ id: "transport", name: "Transport" },
			{ id: "meter", name: "Meter" },
		],
		states: [
			/**
			 * Layer one. `paused` is first, so it is this layer's initial state, and
			 * its delta is empty — the component on the canvas *is* its rest state,
			 * so there is nothing for it to say and nothing for it to cost.
			 */
			{ id: "paused", name: "Paused", parts: {}, layer: "transport" },
			{
				id: "playing",
				name: "Playing",
				layer: "transport",
				parts: {
					// Geometry, and geometry only. The knob slides to the far end of
					// the track; nothing in this layer paints anything, which is what
					// keeps it out of the other layer's way.
					knob: { frame: { x: single("196px") } },
				},
			},
			/**
			 * Layer two, and its own initial state. A second layer's states live in
			 * the same list as the first's and name their layer, rather than nesting
			 * — a state id is already unique per machine, `stt(I,S,N)` carries no
			 * layer in the term, and document order is what the strip renders and
			 * what `mindex/3` numbers.
			 */
			{ id: "quiet", name: "Quiet", parts: {}, layer: "meter" },
			{
				id: "loud",
				name: "Loud",
				layer: "meter",
				parts: {
					// Paint, and a different part again. `track.fill` is written by
					// this layer and by nothing else, so `mwriter/4` has one answer
					// and `mfight/5` has none.
					track: { props: { fill: [ref("hot")] } },
					// The one property the two layers *could* have fought over, given
					// to exactly one of them. Move this line into `playing` and the
					// States panel names the fight on both rows.
					bar: { props: { stroke: [ref("hot")] } },
				},
			},
		],
		transitions: [
			/**
			 * The guarded edge, and the point of the rung: a press starts the deck
			 * **only if it is armed**.
			 *
			 * One outgoing `pointerdown` from `paused`, so there is nothing for
			 * `moverlap` to report and nothing for the nondeterminism check to
			 * find. Two ways into one state would be two edges with two guards, and
			 * the checks would then ask whether those guards can both hold.
			 */
			{
				id: "play",
				from: "paused",
				to: "playing",
				trigger: "pointerdown",
				duration: [ref("motion")],
				easing: "easeOut",
				enabled: true,
				conditions: [{ input: "armed", op: "eq", value: "true" }],
			},
			{
				id: "pause",
				from: "playing",
				to: "paused",
				trigger: "pointerdown",
				duration: [ref("motion")],
				easing: "easeOut",
				enabled: true,
			},
			/**
			 * The number guard. `gt 0.5` is the half-open window `[501, 1000000]` in
			 * thousandths, which is what `mcondval/4` carries and what makes "is this
			 * guard reachable inside the declared range" a question with an answer.
			 */
			{
				id: "raise",
				from: "quiet",
				to: "loud",
				trigger: "pointerenter",
				duration: [ref("motion")],
				easing: "easeOut",
				enabled: true,
				conditions: [{ input: "level", op: "gt", value: "0.5" }],
			},
			{
				id: "lower",
				from: "loud",
				to: "quiet",
				trigger: "pointerleave",
				duration: [ref("motion")],
				easing: "easeOut",
				enabled: true,
			},
			/**
			 * The trigger guard, and the second way into `loud`.
			 *
			 * On `pointerdown` rather than on `raise`'s `pointerenter`, which is what
			 * keeps the two apart: the same source state may have as many outgoing
			 * edges as it likes, and only two on *one* trigger whose guards can both
			 * hold are an overlap. `fired` takes no comparand, because a pulse has
			 * no value to compare against.
			 */
			{
				id: "alarm",
				from: "quiet",
				to: "loud",
				trigger: "pointerdown",
				duration: single("90ms"),
				easing: "easeOut",
				enabled: true,
				conditions: [{ input: "spike", op: "fired" }],
			},
			/**
			 * A debounce, and the one edge that says something about time other than
			 * how long it takes: `exit` is Rive's exit time, and it means a trigger
			 * arriving before `loud` has been held this long does not move the
			 * machine and is **not remembered**.
			 *
			 * A {@link Value} rather than a plain string, unlike a guard's comparand,
			 * and the difference is the point: an exit time is pacing, so it names
			 * the same motion scale everything else does. A motion scale that made
			 * the whole design brisk and left one debounce at 400ms would be a motion
			 * scale with a hole in it.
			 */
			{
				id: "settle",
				from: "loud",
				to: "quiet",
				trigger: "pointerup",
				duration: [ref("motion")],
				exit: [ref("motion")],
				easing: "easeOut",
				enabled: true,
			},
		],
	};

	/** One use of the definition, drawn in whichever state of each layer it names. */
	const use = (
		id: string,
		name: string,
		y: number,
		states?: Record<string, string>,
	): SceneNode => ({
		...makeNode("instance", at([320, y, 232, 64]), { id, name }),
		instanceOf: "bar",
		...(states ? { states } : {}),
	});

	return {
		tokens: [
			...starterTokens(),
			{ id: "slate", name: "slate", type: "color", value: single("#334155") },
			/**
			 * What "loud" looks like — one colour, named, so a *state* points at a
			 * token exactly as a node does. A state's delta is a {@link Value} like
			 * any other, which is what makes the alarm colour something the design
			 * system owns rather than a hex code buried in a machine.
			 */
			{ id: "hot", name: "hot", type: "color", value: single("#f43f5e") },
			/**
			 * The document's motion scale, pointed at by five edges and by the
			 * debounce.
			 *
			 * One alternative rather than two, so this template's design space is
			 * exactly the bar's fill: the claim it makes is that the whole ladder
			 * changes no count, and a token that doubled it would be making a
			 * different and much less interesting point in the same breath. Adding
			 * the second value is the first thing the rules panel suggests.
			 */
			{ id: "motion", name: "motion", type: "duration", value: single("180ms") },
		],
		styles: [],
		machines: [transport],
		nodes: [
			frame("page", "Page", [0, 0, 620, 300], { fill: [ref("surface")] }, [
				text("title", "Title", [40, 32, 540, 26], "Inputs, guards and two layers", {
					ink: [ref("ink")],
					size: single("20px"),
					weight: single("700"),
				}),
				text(
					"caption",
					"Caption",
					[40, 60, 540, 44],
					"Both layers are true at once in one answer set, so a rule can compare them — and the whole ladder costs this document no designs at all.",
					{ ink: [ref("subtle")], size: single("12px"), weight: single("400") },
				),
				// A plate behind the definition, so it reads as the bench it is
				// rather than as a third bar on the page.
				rect("bench", "Bench", [24, 112, 264, 96], {
					fill: [ref("muted")],
					radius: single("12px"),
					opacity: single("0.45"),
				}),
				definition,
				// Drawn in one state of each layer: playing *and* loud, composed into
				// one picture beside the definition. `states` is keyed by layer id,
				// which is where a multi-layer document says the whole answer.
				use("deckOne", "Playing, loud", 128, {
					transport: "playing",
					meter: "loud",
				}),
			]),
		],
		constraints: [],
		rules: `${RULES_HEADER}
% The whole ladder is compiled from facts like everything else. Nothing below is
% needed; these are the things worth trying.
%
%   - Open the Inputs panel and drag "level" below 0.5, then hover the bar.
%     Nothing happens, because the guard on "raise" no longer holds. Nothing is
%     solved either: an input is a runtime value, so driving one costs no solve
%     and lands in no undo.
%
%   - Set "armed" to false. "play" is still a legal edge and is never taken —
%     which is a different document from one with the edge deleted, and the
%     reason machine_guard_possible reports the guard that can *never* hold and
%     says nothing about this one.
%
%   - Move the "stroke" line out of "loud" and into "playing". Both layers now
%     write bar.stroke, the later one wins, and machine_layers_agree names the
%     fight on both rows in the Layers strip. Then drag "Meter" above
%     "Transport" and watch the winner change — the position *is* the priority.
%
%   - Add a third layer with two states of its own. The universe count does not
%     move. Under a choice rule this would have been the count times two.
%
% A rule may name a state copy of either layer, and both are in this one answer
% set. stt(I,S,N) is instance, state, part:
%
%   - :- f_value(stt(deckOne,playing,knob),x,L),
%        f_value(stt(deckOne,quiet,knob),x,L).
%     "the knob is somewhere else when the deck is playing" — a rule across two
%     layers, which is the sentence a sprite sheet cannot hold.
%
%   - viol(deck_shown) :- shown(deckOne,S), mslayer(deck,S,meter), S != loud.
%     A rule about which state of one layer is on screen, with a name, a switch
%     and a place in the unsat core.
`,
	};
}
