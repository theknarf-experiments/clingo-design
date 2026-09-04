/**
 * The sketch layer, read off an answer set and written back into one.
 *
 * clingo-lpx decides linear arithmetic, and three relations a design tool wants
 * are not linear: how far apart two things are, which way one lies from another,
 * and whether three of them fall on one line at any angle. The program states
 * those rules and states nothing about their numbers — see
 * `SKETCH_CONSTRAINT_RULES` in compile.ts — and this file is what turns the
 * question it left behind into a {@link SketchRequest} for PlaneGCS and turns
 * the answer back into the EMU frames the rest of the tool draws.
 *
 * Pure, and with no wasm anywhere in it. The solver lives in
 * `@clingo-design/planegcs`, which knows nothing of EMU and nothing of scenes;
 * every conversion between the two worlds is here, in the two directions
 * {@link sketchRequest} and {@link sketchSolved} name. See
 * `docs/planegcs-spec.md` §3 and §7.3.
 *
 * Three things about the arithmetic, because getting any of them wrong is
 * silent:
 *
 * 1. **World coordinates in, local ones out.** `readSolved` reads `lv/2`, which
 *    is parent-local, and a Euclidean distance between two numbers in two
 *    different parents is not a distance. So the chain is summed on the way in
 *    through `placedNodes` — the same function the overlay uses, so the point
 *    the system solves for and the point `annotate.ts` draws are the same point
 *    by construction — and subtracted on the way out.
 * 2. **CSS pixels in the middle.** PlaneGCS's convergence threshold, its
 *    Levenberg–Marquardt damping and its DogLeg trust radius are absolute
 *    quantities tuned in a plane where a shape is tens or hundreds of units
 *    across. A plane where the same shape is a million units across is a
 *    different numerical problem. So `cssPxFromEmu` on the way in and
 *    `emuFromCssPx` on the way out, and nothing else converts.
 * 3. **A pinned coordinate never comes back.** The package returns free
 *    coordinates only, so a number simplex decided exactly cannot be re-derived
 *    from a residual. What this file adds is the other half: it never asks about
 *    one either.
 */
import { parseAtom } from "./atoms.ts";
import { parseInstancePart } from "./components.ts";
import type { Frame, Point } from "./geometry.ts";
import { parseKeyCopy, parseStatePart } from "./machines.ts";
import {
	type Anchor,
	ANCHORS,
	CONSTRAINT_KINDS,
	type Constraint,
	EDGES,
	type Scene,
	type SceneNode,
	TURN_NAMES,
	datumLabel,
	frameOf,
	isTurned,
	parseDatum,
	turnOf,
} from "./scene.ts";
import { constraintMemberNode } from "./spatial.ts";
import { findInTree, placedNodes } from "./tree.ts";
import { cssPxFromEmu, emuFromCssPx, wholeEmu } from "./units.ts";
import type { Picks, ResolveContext } from "./values.ts";

import type {
	SketchOutcome,
	SketchRequest,
	SketchRule,
} from "@clingo-design/planegcs";

/** The two axes a point has. The sketch plane is the document plane. */
const AXES = ["x", "y"] as const;
type Axis = (typeof AXES)[number];

/** Code-unit order, so a canonical order is an order and not a preference. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The `sk*` atoms of one answer set, read once and passed around.
 *
 * Declared here and not in `model.ts` so that this file depends on nothing
 * downstream of it: {@link readSketchFacts} is the only reader of these atoms in
 * the tree, and it lives beside the only consumer.
 */
export interface SketchFacts {
	/** `skon(C)` — the rules that are switched on, in id order. */
	readonly rules: readonly string[];
	/**
	 * `skmember(C,N,I)` — members by slot, per rule.
	 *
	 * Every rule the program compiled, switched on or not: `skmember/3` heads off
	 * `skcon/1` rather than `skon/1`, for `sksolved/1`'s reason exactly — which
	 * unknowns exist must not depend on which rules are assumed.
	 */
	readonly members: ReadonlyMap<string, readonly string[]>;
	/** `skanchor(C,A)`. */
	readonly anchors: ReadonlyMap<string, Anchor>;
	/** `sk_length(C,V)` in EMU. */
	readonly lengths: ReadonlyMap<string, number>;
	/** `sk_angle(C,V)` in thousandths of a degree. */
	readonly angles: ReadonlyMap<string, number>;
	/** `sksolved(N)`. */
	readonly solved: ReadonlySet<string>;
	/**
	 * `skpoint(N,A)`, as `"<node>:<anchor>"` — the points that really exist.
	 *
	 * Read rather than inferred, and the distinction is load-bearing since the
	 * turn refusal became per-anchor. A node can be `sksolved` and still have no
	 * `topLeft`: a card turned 30° keeps its centre and loses its corners, so a
	 * builder that minted one point per anchor its rules happened to name would
	 * mint a point the program refused, and solve a rule about a corner the
	 * picture does not contain. `skoffcentre/2` is the only thing that knows, it
	 * stays inside clingo, and this is its answer.
	 */
	readonly points: ReadonlySet<string>;
	/** `skheld(N,A)`, as `"<node>:<x|y>"`. */
	readonly held: ReadonlySet<string>;
}

/**
 * Reads them. Returns empty sets on an answer set with no sketch rule in it.
 *
 * Eight predicates, which is exactly the eight the program `#show`s — the rest
 * of the sketch vocabulary is derived and stays inside clingo. A bare candidate
 * solve carries no `scenery` and therefore none of these, so this answers
 * nothing for one rather than failing, which is what lets the pass be asked of
 * any answer set at all.
 */
export function readSketchFacts(atoms: readonly string[]): SketchFacts {
	const rules: string[] = [];
	const slots = new Map<string, { slot: number; node: string }[]>();
	const anchors = new Map<string, Anchor>();
	const lengths = new Map<string, number>();
	const angles = new Map<string, number>();
	const solved = new Set<string>();
	const points = new Set<string>();
	const held = new Set<string>();

	for (const text of atoms) {
		// Every predicate this reads begins `sk`, and an answer set is thousands of
		// atoms long: the prefix test is what keeps this a scan rather than a parse
		// of the whole model.
		if (!text.startsWith("sk")) continue;
		const atom = parseAtom(text);
		if (!atom) continue;
		switch (atom.name) {
			case "skon":
				if (atom.args.length === 1) rules.push(atom.args[0]);
				break;
			case "skmember": {
				if (atom.args.length !== 3) break;
				const slot = Number(atom.args[2]);
				if (!Number.isInteger(slot)) break;
				const list = slots.get(atom.args[0]);
				const entry = { slot, node: atom.args[1] };
				if (list) list.push(entry);
				else slots.set(atom.args[0], [entry]);
				break;
			}
			case "skanchor":
				if (atom.args.length === 2 && Object.hasOwn(ANCHORS, atom.args[1])) {
					anchors.set(atom.args[0], atom.args[1] as Anchor);
				}
				break;
			case "sk_length": {
				if (atom.args.length !== 2) break;
				const emu = Number(atom.args[1]);
				if (Number.isFinite(emu)) lengths.set(atom.args[0], emu);
				break;
			}
			case "sk_angle": {
				if (atom.args.length !== 2) break;
				const mdeg = Number(atom.args[1]);
				if (Number.isFinite(mdeg)) angles.set(atom.args[0], mdeg);
				break;
			}
			case "sksolved":
				if (atom.args.length === 1) solved.add(atom.args[0]);
				break;
			case "skpoint":
				if (atom.args.length === 2 && Object.hasOwn(ANCHORS, atom.args[1])) {
					points.add(`${atom.args[0]}:${atom.args[1]}`);
				}
				break;
			case "skheld":
				if (atom.args.length === 2 && isAxis(atom.args[1])) {
					held.add(coordinate(atom.args[0], atom.args[1]));
				}
				break;
		}
	}

	// Slot order is the document's member order, and it is what a `distance`
	// reads its pair off and what a `collinear`'s first two mean. clingo prints
	// atoms in whatever order it likes, so the order is restored here rather than
	// trusted.
	const members = new Map<string, readonly string[]>();
	for (const [id, list] of slots) {
		members.set(
			id,
			list.sort((a, b) => a.slot - b.slot || cmp(a.node, b.node)).map((m) => m.node),
		);
	}
	return {
		rules: rules.sort(cmp),
		members,
		anchors,
		lengths,
		angles,
		solved,
		points,
		held,
	};
}

function isAxis(text: string): text is Axis {
	return text === "x" || text === "y";
}

/** How `skheld/2` and `SketchReport.owned` spell one coordinate. */
const coordinate = (node: string, axis: Axis): string => `${node}:${axis}`;

/**
 * How a pin is tagged inside the sketch system, so that a conflict naming one
 * says *which* coordinate the linear layer had already decided.
 *
 * A term rather than a colon-joined pair, and deliberately: it cannot collide
 * with a `Constraint.id`, which is an ASP constant, so the two halves of a
 * conflicting set come apart again without a second list to check against.
 */
export const heldTag = (node: string, axis: Axis): string =>
	`held(${node},${axis})`;

/**
 * The node and axis a {@link heldTag} names, or nothing where the tag is a
 * rule's rather than a pin's.
 */
export function readHeldTag(tag: string): string | undefined {
	const atom = parseAtom(tag);
	if (!atom || atom.name !== "held" || atom.args.length !== 2) return undefined;
	if (!isAxis(atom.args[1])) return undefined;
	return coordinate(atom.args[0], atom.args[1]);
}

/**
 * Where one anchor of one frame is, in that frame's own coordinate system.
 *
 * The one place {@link ANCHORS} becomes arithmetic, so the point the system
 * solves for and the point the overlay draws are the same expression. Takes a
 * `Frame` and not an id because both callers already hold a *world* frame.
 */
export function anchorPoint(frame: Frame, anchor: Anchor): Point {
	const at = ANCHORS[anchor] ?? ANCHORS.center;
	return {
		x: frame.x + along(frame.width, EDGES[at.x].place),
		y: frame.y + along(frame.height, EDGES[at.y].place),
	};
}

/** How much of a node's own size lies before one of its three places. */
function along(size: number, place: "lead" | "mid" | "trail" | undefined): number {
	return place === "trail" ? size : place === "mid" ? size / 2 : 0;
}

/* ------------------------------------------------------------------ */
/* The starting point                                                  */
/* ------------------------------------------------------------------ */

/**
 * `"<x>,<y>"` in whole EMU, or nothing where the string is not that.
 *
 * The node's **world origin** — its top-left on the canvas, in the same
 * coordinates `placedNodes` answers in — rather than the anchor point a rule is
 * about. A node has one place and may be named by rules about two different
 * corners of it, so the aim is stored where the node is and the anchor is
 * applied on top of it.
 */
export function seedOf(node: SceneNode): Point | undefined {
	const text = node.sketchSeed;
	if (typeof text !== "string") return undefined;
	const parts = text.split(",");
	if (parts.length !== 2) return undefined;
	// Spelled rather than parsed with `Number`, which reads `""` as zero and
	// `"1e3"` as a thousand: a seed is two whole EMU written out, and anything
	// else is a string some other version of this tool meant something else by.
	if (!parts.every((part) => /^-?\d+$/.test(part))) return undefined;
	const x = Number(parts[0]);
	const y = Number(parts[1]);
	if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return undefined;
	return { x, y };
}

/** The inverse, and the only thing that writes the spelling. */
export function spellSeed(at: Point): string {
	return `${wholeEmu(at.x)},${wholeEmu(at.y)}`;
}

/* ------------------------------------------------------------------ */
/* Building the system                                                 */
/* ------------------------------------------------------------------ */

/** One node's place in this universe: its world frame and its parent's origin. */
interface Placement {
	node: SceneNode;
	world: Frame;
	/** Where the node's parent sits, which is what turns world back into local. */
	origin: Point;
}

/**
 * Every node's world frame and its parent's origin, in one walk.
 *
 * Both directions need both numbers — the way in adds the origin, the way out
 * subtracts it — so they are computed together and from the same source, which
 * is the only way the two can be guaranteed to be inverses. `placedNodes` is
 * that source: it is what the editor hit-tests against and what `annotate.ts`
 * measures, so a sketch point is where the pointer would land.
 */
function placement(
	scene: Scene,
	solved: Readonly<Record<string, Partial<Frame>>>,
	context: ResolveContext,
): Map<string, Placement> {
	const out = new Map<string, Placement>();
	for (const placed of placedNodes(scene.nodes, solved, context)) {
		const local = { ...frameOf(placed.node, context), ...solved[placed.node.id] };
		out.set(placed.node.id, {
			node: placed.node,
			world: placed.world,
			origin: {
				x: placed.world.x - local.x,
				y: placed.world.y - local.y,
			},
		});
	}
	return out;
}

/**
 * Which anchor a node's *own* point stands for — its home anchor.
 *
 * Every node in the system has exactly one point keyed by its bare id, and this
 * says which of the nine places on the box that point is. It is the one the
 * lowest-id active rule naming the node asked for, and the centre where no
 * active rule names it: an order and not a preference, so that the same document
 * builds the same system twice.
 *
 * It is **not** the anchor every rule about the node is measured at — that was
 * the old reading, and it was wrong. A `distance` about two corners and a
 * `bearing` about two centres are both meaningful and a document may hold both,
 * so collapsing them onto one point solved a rule nobody wrote: the panel and
 * the overlay said corners while PlaneGCS measured centres, and the design ended
 * up geometry nobody asked for. A rule about any other anchor gets a point of
 * its own — see {@link anchorKey} — held to this one by a constant offset. What
 * survives of the old reading is only this: which point is the one whose
 * coordinates are the node's, and therefore the one a pin nails and the one
 * {@link sketchSolved} reads a frame back off.
 *
 * **`facts.rules` and not `facts.members`, and the difference is a switch.**
 * `skmember/3` heads off `skcon/1`, so it names the members of every sketch rule
 * the document holds, switched on or not — deliberately, because which unknowns
 * exist must not depend on which rules are assumed. A home anchor is the
 * opposite question: it decides which point of a box carries the node's frame,
 * and a rule the solver turned off asks nothing of any point. Ranging over the
 * members would let an inactive rule move the home to a corner, and with it the
 * point a `skheld/2` pin nails — the linear layer's decision applied to a place
 * on the box it never decided.
 */
function homeAnchors(facts: SketchFacts): Map<string, Anchor> {
	const out = new Map<string, Anchor>();
	for (const id of [...facts.rules].sort(cmp)) {
		const anchor = facts.anchors.get(id) ?? "center";
		for (const member of facts.members.get(id) ?? []) {
			if (!out.has(member)) out.set(member, anchor);
		}
	}
	return out;
}

/**
 * How a point that is *not* a node's home is named inside one request.
 *
 * A `SketchRequest` keys points by an opaque string, and every other key in one
 * is a node id read out of an answer set. The leading `#` is what makes a
 * collision impossible rather than unlikely: an ASP term cannot begin with one,
 * so no `node/1` the program derived — not `cell(1,1)`, not `stt(b1,hover,x)` —
 * can ever spell what this spells. {@link sketchSolved} leans on exactly that
 * when it reads only the keys it recognises as nodes.
 */
const anchorKey = (node: string, anchor: Anchor): string =>
	`#anchor(${node},${anchor})`;

/**
 * What holds one of those points to its node, for a conflicting set to name.
 *
 * A link is this file's arithmetic and not the document's, so it is spelled the
 * way {@link heldTag} is and for the same reason: `explore.ts` keeps a
 * conflicting set's rule tags by testing them against `facts.rules` and its pin
 * tags through `readHeldTag`, and a tag that is neither is dropped. A rigid link
 * between two points of one box cannot be the thing a designer got wrong, so
 * being unnameable in the panel is the correct outcome and not a gap.
 */
const linkTag = (node: string, anchor: Anchor): string =>
	`#link(${node},${anchor})`;

/**
 * Build the system from one answer set: the world chain, CSS pixels, and the
 * two categories a coordinate can be in.
 *
 * **A point per (node, anchor) the rules actually name, not one per node.** The
 * anchor is a property of the *rule* — `Constraint.anchor` says which point of a
 * box that row is measured about — so a document holding a `distance` about two
 * corners and a `bearing` about the same two centres is asking two questions,
 * and answering both as if they were about one place is answering neither. Each
 * node's home point ({@link homeAnchors}) carries its frame and its pins; every
 * other anchor a built rule asks for becomes a second point, held to the home by
 * a constant offset in `links`. Constant because a node's *size* is not an
 * unknown of this system: the linear layer decided the box, and
 * {@link anchorPoint}'s offset from the origin is arithmetic on numbers already
 * known. So the extra point adds two coordinates and two equations, `dof` counts
 * what the design left open, and the overlay, the panel and the solver are all
 * measuring the same place.
 *
 * `undefined` when `facts.rules` is empty — which is every document that holds
 * no sketch rule, and is what makes the whole feature cost nothing on one.
 */
export function sketchRequest(
	scene: Scene,
	facts: SketchFacts,
	solved: Readonly<Record<string, Partial<Frame>>>,
	context: ResolveContext,
): SketchRequest | undefined {
	if (facts.rules.length === 0) return undefined;

	const where = placement(scene, solved, context);
	const homeOf = homeAnchors(facts);
	const pinned: { node: string; axis: Axis; tag: string }[] = [];

	// Where each node starts, once the aim and the pins have had their say. Kept
	// as a frame rather than as a point because the anchors are read off it more
	// than once: the home point, and one per further anchor a rule asks for.
	const aim = new Map<string, Frame>();
	for (const node of [...facts.solved].sort(cmp)) {
		const place = where.get(node);
		// A member whose world origin cannot be computed is refused, which is the
		// same door a datum and a copy come to. `sknode/1` is stated from
		// `scene.nodes`, so this is unreachable on an answer set the compiler
		// produced; it is here because an answer set is not always one it did.
		if (!place) continue;
		const seed = seedOf(place.node);
		// A held coordinate starts where the linear layer put it and is pinned
		// there; a free one starts at the document's aim, or where the node sits
		// when nobody has aimed it. Per axis, because a node in a stack is held on
		// both while a node in a plain frame is held on neither.
		const box: Frame = {
			x: place.world.x,
			y: place.world.y,
			width: place.world.width,
			height: place.world.height,
		};
		for (const axis of AXES) {
			if (facts.held.has(coordinate(node, axis))) {
				pinned.push({ node, axis, tag: heldTag(node, axis) });
			} else if (seed) {
				box[axis] = seed[axis];
			}
		}
		aim.set(node, box);
	}

	// The rules are built before the points because they are what decides which
	// anchor points exist: an anchor nothing is measured about is an unknown the
	// system would carry for nobody, and a rule dropped below for a value that read
	// as no number never asks for one. So `asked` is filled by `pointOf`, which
	// only the pushes call.
	const asked = new Map<string, { node: string; anchor: Anchor }>();
	const pointOf = (node: string, anchor: Anchor): string => {
		if (anchor === (homeOf.get(node) ?? "center")) return node;
		const key = anchorKey(node, anchor);
		asked.set(key, { node, anchor });
		return key;
	};

	const byId = new Map(scene.constraints.map((c) => [c.id, c] as const));
	const rules: SketchRule[] = [];
	for (const id of facts.rules) {
		// The kind comes off the document rather than off the answer set, because
		// the program deliberately says nothing about a sketch rule's numbers and
		// therefore nothing that distinguishes a `distance` with an unreadable
		// value from a `bearing` with one. A `skcon/1` some hand-written rule
		// asserted has no row in the document to be about, so it is passed over
		// rather than guessed at.
		const constraint = byId.get(id);
		if (!constraint) continue;
		if (CONSTRAINT_KINDS[constraint.kind].engine !== "sketch") continue;
		// The rule's own anchor, and the default stated here as the program states
		// it: `skanchor/2` is written for every sketch rule, so the fallback is for
		// an answer set the compiler did not produce.
		const anchor = facts.anchors.get(id) ?? "center";
		// Two questions, and since the turn refusal became per-anchor they are no
		// longer one. `aim.has` asks whether the node is a point at all — a datum
		// and a copy are not — and `facts.points` asks whether it is a point *at
		// this anchor*, which a turned box is at its centre and is not at any of
		// its corners. Asked of the program rather than re-derived here, for the
		// reason `SketchReport.owned`'s comment gives: a second answer computed in
		// TypeScript would differ the first time a member was turned, and differ
		// silently. A rule left under its `minNodes` by this is dropped below, and
		// `refusedMembers` is what tells the panel why.
		const members = (facts.members.get(id) ?? []).filter(
			(m) => aim.has(m) && facts.points.has(`${m}:${anchor}`),
		);
		switch (constraint.kind) {
			case "distance": {
				const px = facts.lengths.get(id);
				// A value that read as no number at all reaches here with no number,
				// and is dropped rather than meaning zero — which is what a
				// `p2p_distance` of nothing would have asserted.
				if (px === undefined || members.length < 2) break;
				rules.push({
					tag: id,
					kind: "distance",
					a: pointOf(members[0], anchor),
					b: pointOf(members[1], anchor),
					px: cssPxFromEmu(px),
				});
				break;
			}
			case "bearing": {
				const mdeg = facts.angles.get(id);
				if (mdeg === undefined || members.length < 2) break;
				rules.push({
					tag: id,
					kind: "bearing",
					a: pointOf(members[0], anchor),
					b: pointOf(members[1], anchor),
					deg: mdeg / 1000,
				});
				break;
			}
			case "collinear": {
				if (members.length < 3) break;
				rules.push({
					tag: id,
					kind: "collinear",
					members: members.map((member) => pointOf(member, anchor)),
				});
				break;
			}
		}
	}

	const points: { node: string; x: number; y: number }[] = [];
	for (const [node, box] of aim) {
		const home = anchorPoint(box, homeOf.get(node) ?? "center");
		points.push({ node, x: cssPxFromEmu(home.x), y: cssPxFromEmu(home.y) });
	}

	// The offsets are taken about a zero origin rather than as a difference of two
	// world points, so a link on a node a metre down the canvas carries the same
	// number as the same node at (0,0): half a box's width is exact in the pixel
	// plane, and the world coordinate it would otherwise be added to and taken
	// away from again is not.
	type Link = { tag: string; from: string; to: string; dx: number; dy: number };
	const links: Link[] = [];
	for (const [key, { node, anchor }] of [...asked].sort(([a], [b]) => cmp(a, b))) {
		const box = aim.get(node);
		if (!box) continue;
		const size = { x: 0, y: 0, width: box.width, height: box.height };
		const home = anchorPoint(size, homeOf.get(node) ?? "center");
		const off = anchorPoint(size, anchor);
		const at = anchorPoint(box, anchor);
		points.push({ node: key, x: cssPxFromEmu(at.x), y: cssPxFromEmu(at.y) });
		links.push({
			tag: linkTag(node, anchor),
			from: node,
			to: key,
			dx: cssPxFromEmu(off.x - home.x),
			dy: cssPxFromEmu(off.y - home.y),
		});
	}
	points.sort((a, b) => cmp(a.node, b.node));

	return { points, pinned, rules, links };
}

/**
 * Turn an outcome back into EMU **local** coordinates, in `readSolved`'s shape —
 * the inverse of the world sum {@link sketchRequest} applied on the way in,
 * which is why it takes the same inputs and not just the outcome.
 *
 * Only free coordinates appear in the result, so a key here is a coordinate the
 * sketch layer genuinely decided.
 *
 * The outcome also carries back the extra anchor points {@link sketchRequest}
 * minted, and they are passed over rather than read: they are the same node,
 * said twice, and a link has already made the second copy redundant with the
 * first. `facts.solved` is the whole test — it is exactly the set of nodes with a
 * home point, and an {@link anchorKey} begins with a character no ASP term can.
 *
 * The two conversions are subtracted **in pixels** rather than in EMU, and that
 * is the one place this file departs from "one `emuFromCssPx` per coordinate".
 * A `mid` anchor's offset is half a node's width, which is a half EMU on an
 * odd-sized box; rounding the world point to whole EMU before subtracting it
 * would then round the local coordinate the wrong way and move a node by an EMU
 * it was never asked to move. Subtracting first and quantizing once makes the
 * round trip exact, which is what the guarantee is worth having.
 */
export function sketchSolved(
	outcome: Extract<SketchOutcome, { status: "settled" }>,
	facts: SketchFacts,
	scene: Scene,
	solved: Readonly<Record<string, Partial<Frame>>>,
	context: ResolveContext,
): Record<string, Partial<Frame>> {
	const where = placement(scene, solved, context);
	const homeOf = homeAnchors(facts);
	const out: Record<string, Partial<Frame>> = {};
	for (const [node, point] of Object.entries(outcome.points)) {
		if (!facts.solved.has(node)) continue;
		const place = where.get(node);
		if (!place) continue;
		const anchor = homeOf.get(node) ?? "center";
		const off = anchorPoint(
			{ x: 0, y: 0, width: place.world.width, height: place.world.height },
			anchor,
		);
		const box: Partial<Frame> = {};
		for (const axis of AXES) {
			const px = point[axis];
			if (px === undefined) continue;
			box[axis] = emuFromCssPx(px - cssPxFromEmu(off[axis] + place.origin[axis]));
		}
		if (box.x !== undefined || box.y !== undefined) out[node] = box;
	}
	return out;
}

/**
 * Which coordinates the sketch owns — `sksolved` minus `skheld`, per node, in
 * canonical order.
 *
 * The single source for the Inspector's pinned rows, the Editor's seed drag and
 * the hook's probe filter. A node whose every coordinate the linear layer
 * already decided is not a key here at all: it is a node a sketch rule is
 * *about* and not one the sketch layer places.
 */
export function sketchOwned(
	facts: SketchFacts,
): Record<string, readonly Axis[]> {
	const out: Record<string, readonly Axis[]> = {};
	for (const node of [...facts.solved].sort(cmp)) {
		const axes = AXES.filter((axis) => !facts.held.has(coordinate(node, axis)));
		if (axes.length > 0) out[node] = axes;
	}
	return out;
}

/* ------------------------------------------------------------------ */
/* What a sketch rule cannot be about                                  */
/* ------------------------------------------------------------------ */

/** The nine anchors in the words a sentence needs them in. */
const ANCHOR_WORDS: Record<Anchor, string> = {
	topLeft: "top-left corner",
	top: "top edge",
	topRight: "top-right corner",
	left: "left edge",
	center: "centre",
	right: "right edge",
	bottomLeft: "bottom-left corner",
	bottom: "bottom edge",
	bottomRight: "bottom-right corner",
};

/**
 * How a node is turned, for a sentence: `30° about Y`.
 *
 * A second copy of `spatial.ts`'s private helper of the same name, which is not
 * a thing to do lightly. The alternative was exporting it, and `spatial.ts` is a
 * file this track may not touch — so the choice was between a duplicated
 * six-line formatter and a turn refusal that reads differently from the two that
 * shipped, which is the worse of the two by some distance: a designer meeting
 * this sentence has already met `refusedEdge`'s.
 */
function describeTurn(node: SceneNode, context: ResolveContext): string {
	const turn = turnOf(node, context);
	const parts = TURN_NAMES.filter((name) => turn[name] !== 0).map(
		(name) =>
			`${String(Number((turn[name] / 1000).toFixed(3)))}° about ${name.slice("rotate".length)}`,
	);
	if (parts.length === 0) return "0°";
	if (parts.length === 1) return parts[0];
	return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * Why this rule cannot be about this member — or nothing where it can.
 *
 * The TypeScript twin of `sknopoint/1` and of the `sknode/1` whitelist, and the
 * third reader in the family `refusedEdge` and `crossesViewport` already hold:
 * the panel has to grey the row while there is no answer set at all, and the
 * program has to refuse the point while there is.
 *
 * Takes the whole constraint, not just the member, because one of the four
 * refusals is about the *anchor*: a turned box keeps its centre and loses its
 * corners, so whether this member is refused depends on which point the rule
 * asked for. `spatial.ts`'s `inertMembers` cannot carry that one — it returns
 * `[]` the moment `constraint.edge` is absent, which is every sketch kind — so
 * without this a `distance` on `topLeft` between a card turned 30° and another
 * node would hold a point the picture does not contain, with no mark anywhere.
 */
export function refusedAnchor(
	scene: Scene,
	constraint: Constraint,
	member: string,
	picks: Picks = {},
): string | undefined {
	const spec = CONSTRAINT_KINDS[constraint.kind];
	// Asked of the table rather than of the engine, exactly as the compiler asks
	// it: the question is whether this kind is about a point at all.
	if (spec.anchors.length === 0) return undefined;

	if (parseDatum(member)) {
		const label = datumLabel(scene, member) ?? member;
		return `“${label}” is a line on the canvas, not a box, so it has a place on one axis and none at all on the other. ${spec.label} is measured between points, so a line cannot be a member of it. Name the node the line guides instead, or use a rule about the one axis the line has.`;
	}

	// A copy is refused for a different reason and it is worth stating: a sketch
	// rule's starting point is stored on the node it moves, and a state copy, a
	// keyframe copy and an instance part are not nodes and have nowhere to keep
	// one. Checked before the tree, because every one of them reduces to a node
	// that *is* in the tree.
	const copy = parseStatePart(member)
		? { what: "a copy of a part inside a state", fix: "on the part itself, or on the instance" }
		: parseKeyCopy(member)
			? { what: "a copy of a part at a keyframe", fix: "on the part itself, or on the instance" }
			: parseInstancePart(member)
				? { what: "one instance's copy of a part", fix: "on the part itself" }
				: undefined;
	if (copy) {
		const name = constraintMemberNode(scene, member)?.name ?? member;
		return `“${name}” here is ${copy.what}, and a sketch rule starts from a point you can drag — which a copy has nowhere to keep. Put the rule ${copy.fix}.`;
	}

	// The whitelist, and it is a whitelist on purpose. `node/1` is not only a
	// fact: a hand-written rule may derive one, and such a node has no layer to
	// drag and nowhere to keep a starting point. A blacklist of the shapes we
	// happen to know about would let `cell(1,1)` through and give PlaneGCS a coin
	// flip.
	const node = findInTree(scene.nodes, member);
	if (!node) {
		return `“${member}” comes from a rule rather than from the document, so there is no layer to drag and nowhere to keep a starting point. A sketch rule needs a node the design actually contains.`;
	}

	const anchor = constraint.anchor ?? spec.anchors[4] ?? "center";
	const context: ResolveContext = { tokens: scene.tokens, picks };
	// This rule's own anchor, and nothing about any other rule's. `skoffcentre/2`
	// refuses one point of one box rather than the whole box, so a `distance`
	// about the corners of a turned card is refused while a `bearing` about its
	// centre standing beside it holds — which is what the sentence below has
	// always claimed, and for a while was not true: the predicate was per node
	// and quantified its constraint existentially, so the corner rule took the
	// centre rule down with it and the centre rule was told it was fine.
	if (anchor !== "center" && isTurned(node, context)) {
		return `“${node.name}” is turned ${describeTurn(node, context)}, and a turned box has no ${ANCHOR_WORDS[anchor]} where the design says it has one — that is why an ${CONSTRAINT_KINDS.align.label} cannot read its edges either. Its centre is the one place a turn leaves alone, so a rule about the centre still holds. Use the centre here, or take the turn off.`;
	}
	return undefined;
}

/** One member of a rule that {@link refusedAnchor} turns away, and why. */
export interface RefusedMember {
	/** The constraint's own term — `constraint(C)`, as `InertConstraint` spells it. */
	constraint: string;
	/** The member as the document spells it, copy terms and all. */
	member: string;
	why: string;
}

/**
 * Every member of one rule the sketch layer will hold no point for.
 *
 * **The sentence-carrier, and the reason the four refusals are not write-only.**
 * {@link refusedAnchor} answers about one member because that is the question
 * `sketchPlacers` asks — is *this* node placed by this rule — and a panel row asks
 * the other one: what does this rule fail to say, about whom. `spatial.ts`'s
 * `inertMembers` is that reader for every linear kind and returns `[]` on its
 * first line for a sketch one, because an `InertConstraint` is keyed by the `Edge`
 * a sketch kind has none of. So this is that function's shape minus the field it
 * cannot fill, and the Rules panel renders the two lists through one block: to a
 * designer, "this rule says nothing about this member" is one fact and not two.
 *
 * A refusal really does silence the rule about that member, which is what earns
 * the row the same mark a linear inert rule gets. `sknopoint/1` withholds the
 * point, so the member never reaches `facts.solved`, so {@link sketchRequest}
 * filters it out of `facts.members` — and a `distance` left holding one member
 * builds no `p2p_distance` at all.
 *
 * `constraint.nodes` and not a group's expansion, for `inertMembers`'s reason:
 * a group's membership is derived by a rule and is not the document's to walk.
 * The switch is the caller's question too, again as there — an off rule is not
 * inert, it is off.
 */
export function refusedMembers(
	scene: Scene,
	constraint: Constraint,
	picks: Picks = {},
): RefusedMember[] {
	const out: RefusedMember[] = [];
	// A rule naming one node twice is one refusal and not a sentence said twice:
	// the member is what the reason is about, and it has not changed.
	const said = new Set<string>();
	for (const member of constraint.nodes) {
		if (said.has(member)) continue;
		said.add(member);
		const why = refusedAnchor(scene, constraint, member, picks);
		if (why !== undefined) out.push({ constraint: constraint.id, member, why });
	}
	return out;
}

/**
 * Which sketch rules put this node where it is — the ones that hold a point
 * that *is* this node.
 *
 * The other half of {@link refusedAnchor}, and it exists because the panel had
 * been asking a looser question: "does any member of this rule reduce to this
 * node". That reduction is `constraintMemberNode`'s, and it is the right one for
 * a linear rule, where `stt(b1,hover,label)` really is `label` as far as simplex
 * is concerned. A sketch rule is the one family where it is wrong: every copy
 * term is `sknopoint/1` — a rule's starting point is stored on the node it
 * moves, and a copy has nowhere to keep one — so a `distance` naming
 * `stt(b1,hover,label)` has that member refused, holds no point for `label`, and
 * placed nothing. Crediting it in the Inspector's "Placed by a sketch rule" rows
 * would name a rule the designer could edit forever without moving the layer.
 *
 * So the member has to be the node itself, and it has to be one this rule can
 * actually be about — which is `refusedAnchor` and not a second copy of its four
 * cases. The kinds and the switch are asked here too, so the caller's question
 * is the whole question: an off rule places nothing either.
 */
export function sketchPlacers(
	scene: Scene,
	node: SceneNode,
	picks: Picks = {},
): Constraint[] {
	return scene.constraints.filter(
		(c) =>
			c.enabled &&
			CONSTRAINT_KINDS[c.kind].engine === "sketch" &&
			c.nodes.some(
				(member) =>
					// The bare id and not a reduction of one: `sknode/1` is stated from
					// `scene.nodes`, so a member is a point only where it names a node
					// outright.
					member === node.id &&
					refusedAnchor(scene, c, member, picks) === undefined,
			),
	);
}
