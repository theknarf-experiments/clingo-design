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
 * A button with three states, used twice — and **the same number of designs as
 * the same button with no machine at all**.
 *
 * That last clause is the whole template. Every other tool that has states makes
 * a state a *variant*: four states and three variants are twelve things to look
 * at, the multiverse becomes a sprite sheet, and the question a designer actually
 * asks — "is the label still inside the box when the button grows on hover?" —
 * becomes unaskable, because the two states are two different documents and
 * nothing can relate them. Here every state of every use is true at once in one
 * answer set. Variants and states are a **matrix**, not a cross product.
 *
 * So this document's fill holds two alternatives and that is the whole of its
 * design space: two universes, before the machine and after it. `machine.test.ts`
 * asserts exactly that by deleting the machine and counting again.
 *
 * What each of the three states is for:
 *
 *   - **Rest** says nothing at all. Its delta is empty, which is not a
 *     placeholder — the definition *is* the rest state, and an empty delta
 *     materialises no state copy, so the initial state of every machine is free.
 *   - **Hover** lifts the whole button by two pixels and says nothing else. The
 *     lift is on the *frame*, in the coordinates of the box the instance draws
 *     in, so the label comes along without a copy of its own. That asymmetry —
 *     downward free, upward paid for — is the materialisation analysis.
 *   - **Pressed** puts the button back down, gives it the pressed colour, and
 *     gives the label a delta of its own. The label's delta is the one thing here
 *     that materialises a second part, so `stt(I,rest,label)`,
 *     `stt(I,hover,label)` and `stt(I,pressed,label)` all exist and a rule may
 *     name any of them.
 *
 * The fill is the invariant made visible. `accent` and `slate` are two designs;
 * hover says nothing about the fill, so both of its uses go on reading the one
 * variable the instance minted, and a hovering button and a resting one are the
 * *same* two designs rather than four. A state copy reads the instance's own
 * `prop(inst(I,N),P)` for everything its state says nothing about, and mints a
 * variable of its own only for what it does say — which is why a fourth state
 * would cost this document nothing at all.
 *
 * The two uses are drawn in different states, which `SceneNode.state` is for and
 * which is the twin of a held variant: a decision the document remembers about
 * one use of a shared definition. The second one is drawn hovering so that the
 * canvas shows two states of one component at once — beside each other, in one
 * picture, which is the thing a sprite sheet cannot do.
 */
export function machine(): Scene {
	/**
	 * The definition: a frame with a label in it, and nothing that knows about
	 * states.
	 *
	 * Worth noticing for what it is *not*. There is no state field on any node
	 * here, no second copy of the subtree, and no marker of any kind. A machine is
	 * a record beside the styles that names this root; the definition is the
	 * ordinary component it was before, which is what makes deleting the machine
	 * a one-line change rather than an unpicking.
	 */
	const definition: SceneNode = {
		...frame(
			"button",
			"Button",
			[48, 108, 168, 44],
			{
				fill: [ref("accent"), ref("slate")],
				radius: [ref("radius")],
			},
			[
				text(
					"label",
					"Label",
					[16, 13, 136, 18],
					"Add to basket",
					{
						// Worked out per instance from *that* instance's fill, so a state
						// that darkens the button keeps its own label readable without
						// anybody writing the second colour down.
						ink: [derive("contrast", propVar("button", "fill"))],
						size: single("14px"),
						weight: single("600"),
						align: single("center"),
					},
				),
			],
		),
		component: true,
	};

	/**
	 * Three states, in order, and **the order is which one is initial** — there is
	 * no flag, the way `order/2` is the paint order and nothing carries an `onTop`
	 * flag. Reordering the strip is how a machine changes where it starts, which is
	 * one edit rather than two that can disagree.
	 */
	const button: Machine = {
		id: "buttonStates",
		name: "Button states",
		root: "button",
		states: [
			// Empty on purpose: the component on the canvas is its rest state, so
			// there is nothing for this state to say and nothing for it to cost.
			{ id: "rest", name: "Rest", parts: {} },
			{
				id: "hover",
				name: "Hover",
				parts: {
					/**
					 * Two pixels up, and **nothing else** — which is the invariant with a
					 * picture attached.
					 *
					 * Hover says nothing about the fill, so both uses go on reading the
					 * one `prop(inst(I,button),fill)` the instance minted: a hovering
					 * button and a resting one are the *same* two designs rather than
					 * four. If each state copy re-minted the definition's two-alternative
					 * fill, three states would be eight designs where the document holds
					 * two, and a fourth state would make it sixteen.
					 *
					 * The lift is on the root part, in the coordinates of the box the
					 * instance draws in, so the label comes along without a copy of its
					 * own. Downward is free because a frame is parent-relative; upward is
					 * not, because the world chain climbs `child/2` — which is exactly
					 * why the materialisation analysis closes one way and not the other.
					 */
					button: { frame: { y: single("-2px") } },
				},
			},
			{
				id: "pressed",
				name: "Pressed",
				parts: {
					button: {
						// The one property any state overrides, which is what puts
						// `mshadow(inst(I,button),fill)` in the program: from here on the
						// instance draws its fill from the shown state's copy rather than
						// from its own variable. Per *property*, so the radius beside it
						// is untouched and still the definition's.
						props: { fill: [ref("pressed")] },
						// Back down, and one pixel below rest: a press reads as the
						// surface taking the weight.
						frame: { y: single("1px") },
					},
					// The one part besides the root with a delta of its own, so the
					// document really does hold three copies of the label and a rule can
					// name any of them. See the rules panel.
					label: { frame: { y: single("14px") } },
				},
			},
		],
		/**
		 * Four edges, which is what a real button is: in and out of hover, down and
		 * up inside it.
		 *
		 * The pacing is named once, through a `duration` token, which is the point
		 * of time being a quantity rather than a number on a transition. `motion` is
		 * a **motion scale**: one place that decides how quickly the whole design
		 * moves, pointed at by every edge, exactly as every gap points at a spacing
		 * token. Give it a second value and this document becomes two designs — the
		 * brisk one and the considered one — which is the one thing about a machine
		 * that really is a design decision, and `#project mdur/3` is what keeps the
		 * two apart instead of collapsing them into an arbitrary pick.
		 */
		transitions: [
			{
				id: "enter",
				from: "rest",
				to: "hover",
				trigger: "pointerenter",
				duration: [ref("motion")],
				easing: single("easeOut"),
				enabled: true,
			},
			{
				id: "leave",
				from: "hover",
				to: "rest",
				trigger: "pointerleave",
				duration: [ref("motion")],
				easing: single("easeOut"),
				enabled: true,
			},
			// A press should feel immediate and the release should settle, which is
			// two different numbers for the two directions of one gesture — and the
			// reason pacing lives on the edge rather than on the state.
			{
				id: "press",
				from: "hover",
				to: "pressed",
				trigger: "pointerdown",
				duration: single("60ms"),
				easing: single("easeOut"),
				enabled: true,
			},
			{
				id: "release",
				from: "pressed",
				to: "hover",
				trigger: "pointerup",
				duration: [ref("motion")],
				easing: single("easeOut"),
				enabled: true,
			},
		],
	};

	/** One use of the definition, optionally drawn in a state other than the first. */
	const use = (id: string, name: string, y: number, state?: string): SceneNode => ({
		...makeNode("instance", at([300, y, 168, 44]), { id, name }),
		instanceOf: "button",
		...(state ? { state } : {}),
	});

	return {
		tokens: [
			...starterTokens(),
			{ id: "slate", name: "slate", type: "color", value: single("#334155") },
			/**
			 * What a press looks like: one colour, named, so the *state* points at a
			 * token exactly as a node does.
			 *
			 * A state's delta is a {@link Value} like any other — it can be a
			 * literal, a link to a token, a derivation, or a list of alternatives —
			 * and that is not a convenience. It is what makes "the pressed colour"
			 * something the design system owns rather than a hex code buried in a
			 * machine.
			 */
			{ id: "pressed", name: "pressed", type: "color", value: single("#1e293b") },
			/**
			 * The document's motion scale — one number, named, that every edge
			 * points at.
			 *
			 * One alternative rather than two, so this template's design space is
			 * exactly the fill's: the claim the whole template makes is that adding a
			 * machine changes nothing about the number of designs, and a token that
			 * doubled it would be making a different and much less interesting point
			 * in the same breath. Adding the second value is the first thing the
			 * rules panel suggests trying.
			 */
			{ id: "motion", name: "motion", type: "duration", value: single("160ms") },
		],
		styles: [],
		machines: [button],
		nodes: [
			frame("page", "Page", [0, 0, 540, 320], { fill: [ref("surface")] }, [
				text("title", "Title", [48, 36, 444, 26], "One button, three states", {
					ink: [ref("ink")],
					size: single("20px"),
					weight: single("700"),
				}),
				text(
					"caption",
					"Caption",
					[48, 62, 444, 30],
					"Two designs, before the machine and after it. Every state is true at once in this one answer set — that is why a rule can compare two of them.",
					{ ink: [ref("subtle")], size: single("12px"), weight: single("400") },
				),
				// A plate behind the definition, so it reads as the bench it is rather
				// than as a third button on the page.
				rect("bench", "Bench", [32, 96, 200, 68], {
					fill: [ref("muted")],
					radius: single("12px"),
					opacity: single("0.45"),
				}),
				definition,
				use("resting", "Resting", 108),
				// Drawn hovering, which `SceneNode.state` is for: the twin of a held
				// variant, a decision the document remembers about one use and leaves
				// alone for every other. So the canvas shows two states of one
				// component side by side, in one picture.
				use("hovering", "Hovering", 176, "hover"),
			]),
		],
		constraints: [],
		rules: `${RULES_HEADER}
% The machine is compiled from facts like everything else. Nothing below is
% needed; these are the things worth trying.
%
%   - Select "Resting" and press ▶ on Hover in the States panel. The canvas
%     draws that state and *nothing* is solved: every state's frame and
%     rendered set is already in this answer set. Nothing lands in undo either,
%     because nothing about the document changed.
%
%   - Give the "motion" token a second value in the Variables panel. The
%     document becomes two designs, brisk and considered, and both are shown.
%     That is a design decision, so it branches. Adding a fourth *state* is not,
%     so it does not — try it and watch the universe count stay where it is.
%
%   - Delete the whole machine. Same two designs. That is the invariant, and it
%     is the sentence this template exists to be an assertion of.
%
%   - :- rendered(inst(resting,button),fill,C),
%        rendered(inst(hovering,button),fill,C).
%     Two uses that must not look alike — and because they are drawn in
%     different states, this is a rule about a rest fill and a hover fill in the
%     same breath.
%
% A rule may name a state copy directly. stt(I,S,N) is instance, state, part,
% and it carries frame/3 and rendered/3 and deliberately nothing else — it is
% not a node/1, which is what keeps it out of the layer list, out of hit testing
% and out of both exporters. c_node/2 never asked for node/1, so:
%
%   - Add an "Align" rule in the Rules panel over "Resting" and press + state…
%     twice to name stt(resting,rest,label) and stt(resting,pressed,label) on
%     centerY. That is "the label does not jump when you press", as an ordinary
%     rule with a name, a switch, a strength and a place in the unsat core. Then
%     add a Gap of 20px between the same two and watch the two rules land in the
%     core together — one of them has to go, and the panel offers you the way out.
%
%   - viol(machine_reachable) :- munreached(_,_).
%     The States panel offers this one and three others as tick boxes. Switch
%     off the "enter" transition and this document has three states it can
%     never reach.
`,
	};
}
