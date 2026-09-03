/**
 * Geometric constraints, as marks on the canvas.
 *
 * A rule the eye cannot see is a rule the designer will fight: something moves
 * and nothing on screen says why. So a selected node's constraints draw
 * themselves — the line its edges share, the distance it holds, the mirror it
 * balances across.
 *
 * Everything here is measured off the *solved* geometry rather than off the
 * constraint's stored number, so a mark always says where the design actually
 * ended up. Which mark a kind gets is one field in `CONSTRAINT_KINDS`, so a new
 * kind picks a shape instead of growing this file a case.
 *
 * A member is not always a node. A column line and a hand-drawn guide reach a
 * constraint as a *datum*, and the reason those marks matter more than the rest
 * is that a datum is the one member a designer cannot see. A card sitting at 480
 * with nothing beside it looks like a card somebody dragged to 480; the mark is
 * what says "column three of the page put it there", and it is also what lets
 * the why-panel's sentence about that rule land on something visible. Where a
 * datum stands is `lines.ts`'s answer rather than one worked out here — see
 * {@link datumFrame}, which is also where a datum that answers nothing is
 * refused.
 */
import type { Frame, Point } from "./geometry.ts";
import { type RuledLine, ruledLines } from "./lines.ts";
import {
	CONSTRAINT_KINDS,
	type Constraint,
	type ConstraintKind,
	EDGES,
	type Edge,
	type Scene,
} from "./scene.ts";
import { anchorPoint, refusedAnchor } from "./sketch.ts";
import { placedNodes } from "./tree.ts";
import {
	DEFAULT_UNIT,
	EMU_PER_PX,
	type Unit,
	displayLength,
	wholeEmu,
} from "./units.ts";
import { type ResolveContext, writeAngle } from "./values.ts";

/**
 * Everything the two axial marks share.
 *
 * A `line` stands across the design at `at` on its axis and runs from `from`
 * to `to` down the other one; a `span` measures along its axis from `from` to
 * `to` and sits at `at` on the other. In both, `at` is the coordinate that
 * does not move and `axis` is the axis the constraint talks about.
 *
 * Written once and intersected with each `shape` below rather than spelled
 * twice, because the two differ in how they are *drawn* and in nothing they
 * carry — and the paragraph about the third axis is long enough that a second
 * copy of it would start drifting the day one of them was edited.
 */
interface AxialMark {
	/** The constraint this draws, so a blamed rule can be picked out. */
	constraint: string;
	kind: ConstraintKind;
	/**
	 * The axis the constraint talks about — and **the planar pair, where
	 * `EdgeSpec.axis` has three.**
	 *
	 * That difference is the one design decision the third axis asked of this
	 * file, and the answer is that a rule about depth draws **nothing**. A mark
	 * is a line ruled across the design or a distance measured along it, and
	 * both of those are lengths *on the page*: `front`, `centerZ`, `back` and
	 * `depth` are none of them. Projecting one onto the plane would put a
	 * measurement on screen for a number the page does not contain — a card and
	 * a cube "aligned on centerZ" would grow a line between them that means
	 * nothing anyone can see — and drawing it somewhere arbitrary would be worse
	 * than drawing nothing.
	 *
	 * So {@link annotate} skips a constraint whose edge is on `z` and this type
	 * keeps its two axes. It is the same refusal `axisBounds` makes about a
	 * turned node in the other file that draws, and it is made visible the same
	 * way: `refusedEdge` and the Rules panel say what the rule is about, in
	 * words, where a mark cannot.
	 */
	axis: "x" | "y";
	at: number;
	from: number;
	to: number;
	/**
	 * A number worth reading — a distance, a size, a pinned coordinate.
	 *
	 * Already spelled, in the document's own unit: `"60px"`, `"12pt"`. The
	 * coordinates beside it are EMU because a renderer has to do arithmetic on
	 * them, but this one is only ever read, and 571500 is not a thing to put in
	 * front of a designer who drew a 60-pixel gap.
	 */
	label?: string;
}

/**
 * One mark, in canvas coordinates.
 *
 * **A union rather than one interface with optional fields**, and that is
 * required rather than tidy: every shipped consumer reads `axis`, `at`, `from`
 * and `to` positionally, so a ray carrying an optional `a`/`b` beside four
 * absent numbers would have the line and span readers quietly computing a mark
 * at the origin. As three cases on `shape`, the reader that forgets the third
 * fails to compile instead — which is how `Annotations.tsx` came to be in the
 * same step as this file.
 */
export type Annotation =
	| (AxialMark & { shape: "line" })
	| (AxialMark & { shape: "span" })
	/**
	 * Two points and the hairline between them — the one shape the three sketch
	 * kinds need, and the reason none of them is a circle or an arc.
	 *
	 * No axis, no `at`, no band: a Euclidean rule is not about a coordinate, so
	 * there is no coordinate here to be misread as one. `distance` and `bearing`
	 * draw between their two anchors; `collinear` draws from the first anchor to
	 * the last, so the line it asserts is the line it shows.
	 */
	| {
			shape: "ray";
			constraint: string;
			kind: ConstraintKind;
			a: Point;
			b: Point;
			label?: string;
	  };

/** The sketch mark, for a reader that has already narrowed to it. */
export type RayAnnotation = Extract<Annotation, { shape: "ray" }>;

/**
 * The two marks that are about an axis — the whole of the overlay before the
 * sketch layer, and still everything `marksFor` makes.
 */
export type AxialAnnotation = Exclude<Annotation, RayAnnotation>;

/**
 * How far a line reaches past the members it crosses: eight pixels, as EMU.
 *
 * Without it, a rule about a selected node's own edge would run exactly under
 * that node's selection outline and be invisible — a pin especially, which has
 * only the one member to span. Eight *pixels* because it is a claim about an
 * outline's thickness rather than about the design, which is why it carries the
 * factor: at a bare 8 the overhang would be a thousandth of a pixel and the mark
 * would go back to hiding under the selection.
 */
const OVERHANG = 8 * EMU_PER_PX;

/**
 * Back onto a whole EMU.
 *
 * This used to round to a tenth of a pixel, on the grounds that half a pixel was
 * noise. At 1/914400 in there is no noise left to cut — the only fractions that
 * reach here are the halves that `across(...).size / 2` makes out of integers —
 * so what is left is the same tie rule the rest of the codebase uses, applied to
 * a coordinate that is about to be drawn.
 */
const round = wholeEmu;

/** How much of a node's own size lies before an edge. */
const OFFSET = { lead: 0, mid: 0.5, trail: 1 } as const;

/** A frame's extent along one axis: where it starts, and how long it is. */
const along = (frame: Frame, axis: "x" | "y") =>
	axis === "x"
		? { start: frame.x, size: frame.width }
		: { start: frame.y, size: frame.height };

/** The same, across the axis — which is where a mark for it is drawn. */
const across = (frame: Frame, axis: "x" | "y") =>
	along(frame, axis === "x" ? "y" : "x");

/**
 * What the solver calls `ge(N,E)`, halved: one edge of one placed node.
 *
 * `axis` is handed in already narrowed for {@link marksFor}'s reason: the only
 * caller has one, and re-reading `EDGES[edge].axis` here would be a second place
 * the third axis has to be turned away from a `Frame` that has four numbers.
 */
function edgeOf(frame: Frame, edge: Edge, axis: "x" | "y"): number {
	const spec = EDGES[edge];
	const { start, size } = along(frame, axis);
	if (spec.role === "span") return size;
	return start + size * OFFSET[spec.place ?? "lead"];
}

/**
 * Where a datum stands, as a box the marks can be measured off.
 *
 * A datum is a **zero-size box** along the axis it is about, which is exactly
 * what the solver makes of it, and the surface's whole extent across that axis,
 * which the solver deliberately leaves free — `lsz(D,·)` is fixed on the
 * datum's own axis only, because a column line has no opinion about a height.
 * So the cross extent is not the model's to give, and it is not this file's
 * either: it is the band `ruledLines` draws its lines across, which is what
 * keeps a mark and the line it is about the same length. A column line drawn
 * the height of its page reads as a column line; one drawn the height of the
 * card beside it reads as a coincidence.
 *
 * **The line is the overlay's line, not a second reading of it.** This used to
 * take the term to the answer set itself — `solved[term]?.[axis]` — and that is
 * one lookup too few. clingo-lpx reports a value for every theory variable in
 * the ground program whether or not this answer set constrained it, so in the
 * four-column universe of a responsive grid `lv(cg(page,5,left))` comes back
 * all the same, at zero. A mark built from it asserts an alignment against a
 * line that is not in this design, sitting on the near margin, for a rule that
 * correctly moved nothing. `lines.ts` names that trap and guards it by asking
 * the document how many tracks there are — see `trackCount`, and the reason the
 * answer set cannot be asked — so the fix is not to guard it twice but to read
 * the lines the design actually has. Both files' headers promised the two
 * readers agree; now they are one reader.
 *
 * That also settles the rest for free: a document nobody has solved is ruled
 * with no lines and so draws no datum marks, which is the honest report rather
 * than a gap; and a hand-drawn guide is found the same way a track is, because
 * `ruledLines` walks both.
 *
 * **A datum answers on its own axis and nowhere else**, which is the one
 * refusal left here and is not a caution: it is the silence the generated
 * program already answers with, said in the same place. `gdaxis/2` gives a datum
 * equations on one axis, so an `align` on `top` against a column line grounds a
 * free variable and the rule states nothing — and a mark for it would state
 * something. The rule then falls to the `minNodes` check with a member short,
 * which is where a rule that says nothing has always gone.
 *
 * An ordinary node has already been found before this is asked, so a rule that
 * minted a node called `cg(page,3,left)` keeps its own frame.
 */
function datumFrame(
	term: string,
	edge: Edge,
	lines: ReadonlyMap<string, RuledLine>,
): Frame | undefined {
	const line = lines.get(term);
	if (!line || line.axis !== EDGES[edge].axis) return undefined;
	const band = line.to - line.from;
	return line.axis === "x"
		? { x: line.at, y: line.from, width: 0, height: band }
		: { x: line.from, y: line.at, width: band, height: 0 };
}

/**
 * Every mark the selection earns.
 *
 * A constraint draws only while one of its members is selected: the point is
 * to explain the thing being looked at, not to turn the canvas into a
 * blueprint. Disabled rules draw nothing, because they do nothing.
 *
 * The edge is settled here rather than inside {@link marksFor} because a datum
 * cannot be placed without it — which line of the track a term names is one
 * question, and whether *this rule* is about that axis at all is another. A
 * member that answers nothing simply does not arrive, and the `minNodes` check
 * below then drops the rule the same way it drops one whose nodes were deleted.
 */
export function annotate(
	scene: Scene,
	selection: ReadonlySet<string>,
	solved: Readonly<Record<string, Partial<Frame>>> = {},
	context?: ResolveContext,
): Annotation[] {
	if (selection.size === 0) return [];
	const placed = new Map(
		placedNodes(scene.nodes, solved, context).map((p) => [p.node.id, p]),
	);
	/**
	 * The lines this design is ruled with, by term — built at most once, and
	 * only if some member turns out not to be a node at all. Most selections
	 * name nothing but nodes, and `ruledLines` walks the tree.
	 */
	let ruled: Map<string, RuledLine> | undefined;
	const lines = () =>
		(ruled ??= new Map(
			ruledLines(scene, solved, context).map((line) => [line.term, line]),
		));
	const out: Annotation[] = [];
	for (const c of scene.constraints ?? []) {
		const spec = CONSTRAINT_KINDS[c.kind];
		if (spec.annotation === "none" || !c.enabled) continue;
		if (!c.nodes.some((id) => selection.has(id))) continue;
		/**
		 * The sketch layer leaves the loop here, before an edge is looked for and
		 * not inside the branch that looks for one.
		 *
		 * A sketch kind has `edges: []`, so `c.edge ?? spec.edges[0]` is
		 * `undefined` and the two lines below would drop the rule at the `!edge`
		 * guard — before the axis test, before `datumFrame`, before any of it.
		 * The overlay would be a silent no-op that typechecks. So the split is at
		 * the top, and it is made on the two tables rather than on
		 * `spec.geometric`, which both layers answer yes to.
		 *
		 * No edge, no axis and no datum: a ray is between two *points*, so the
		 * members have to be asked the same question `sknopoint/1` asks in the
		 * program, and asked here rather than assumed. This function walks
		 * `scene.constraints` and never sees an answer set, so nothing upstream
		 * has filtered anything: a turned box still has a `world` frame, and
		 * without the `refusedAnchor` call below a `distance` on `topLeft`
		 * between a card turned 30 degrees and another node would draw a
		 * corner-to-corner hairline, with a length label, for a rule the solver
		 * withheld both points from. A mark that says a rule holds is worse than
		 * no mark, which is the same reason `gnoedge/2` has an overlay twin.
		 */
		if (spec.anchors.length > 0) {
			const frames = c.nodes
				.map((id) =>
					refusedAnchor(scene, c, id, context?.picks)
						? undefined
						: placed.get(id)?.world,
				)
				.filter((f): f is Frame => f !== undefined);
			if (frames.length < spec.minNodes) continue;
			out.push(...raysFor(c, frames, scene.unit ?? DEFAULT_UNIT));
			continue;
		}
		const edge = c.edge ?? spec.edges[0];
		if (!edge) continue;
		// A depth rule draws nothing — see {@link Annotation.axis}. Skipped here
		// rather than filtered by the caller, because every caller would have to
		// know the same thing and one of them would forget.
		const axis = EDGES[edge].axis;
		if (axis !== "x" && axis !== "y") continue;
		const frames = c.nodes
			.map((id) => placed.get(id)?.world ?? datumFrame(id, edge, lines()))
			.filter((f): f is Frame => f !== undefined);
		if (frames.length < spec.minNodes) continue;
		out.push(...marksFor(c, edge, axis, frames, scene.unit ?? DEFAULT_UNIT));
	}
	return out;
}

/**
 * The one mark a sketch rule earns: the line between the points it is about.
 *
 * Beside {@link marksFor} and not inside it, because the two have almost
 * nothing in common. `marksFor` takes an `edge` and an `axis` as required
 * arguments and resolves datums through {@link datumFrame}; a ray has none of
 * those and needs none of them. Sharing a body would mean threading two
 * arguments that are meaningless here through a function that would then have
 * to ignore them.
 *
 * **From the first member to the last, with no case for the kind.** For a
 * `distance` and a `bearing` that is the second, because both cap at two
 * members; for a `collinear` it is the far end of the line being asserted, and
 * the points between it are on that line by the rule's own claim. One
 * expression covers all three, which keeps the promise in this file's header
 * that a kind picks a shape rather than growing a case.
 *
 * The label is measured off the frames, like every other label here, so it says
 * where the design ended up rather than what the rule asked for — and which
 * measurement it is comes off the kind's `valueType`, the same field that
 * decides how the Rules panel spells the number. A `collinear` has no
 * value type and so no label: three points being in a line is not a quantity.
 */
function raysFor(c: Constraint, frames: readonly Frame[], unit: Unit): Annotation[] {
	const spec = CONSTRAINT_KINDS[c.kind];
	const anchor = c.anchor ?? "center";
	const a = anchorPoint(frames[0], anchor);
	const b = anchorPoint(frames[frames.length - 1], anchor);
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	/**
	 * Clockwise from straight right — x grows rightwards and y downwards, so the
	 * plane the overlay draws in is the plane the solver was handed and the
	 * degrees are converted rather than negated. Wrapped into a single turn after
	 * rounding, so a direction a thousandth short of due east reads as 0 and not
	 * as 360. The same arithmetic a fresh rule is seeded with, which is what makes
	 * the mark and the panel agree on an untouched constraint.
	 */
	const bearing = () => {
		const mdeg = Math.round((Math.atan2(dy, dx) * 180000) / Math.PI);
		return writeAngle(((mdeg % 360000) + 360000) % 360000);
	};
	const label =
		spec.valueType === "angle"
			? bearing()
			: spec.valueType === "length"
				? displayLength(round(Math.hypot(dx, dy)), unit)
				: undefined;
	return [
		{
			shape: "ray",
			constraint: c.id,
			kind: c.kind,
			a: { x: round(a.x), y: round(a.y) },
			b: { x: round(b.x), y: round(b.y) },
			...(label !== undefined ? { label } : {}),
		},
	];
}

function marksFor(
	c: Constraint,
	edge: Edge,
	/**
	 * The axis, handed in already narrowed to the two this file can draw.
	 *
	 * An argument rather than a second `EDGES[edge].axis` read, so that the one
	 * place the third axis is turned away — {@link annotate}'s loop — is also the
	 * only place that has to know it exists.
	 */
	axis: "x" | "y",
	frames: readonly Frame[],
	unit: Unit,
): Annotation[] {
	const spec = CONSTRAINT_KINDS[c.kind];
	/** Every label on a mark, in the unit the document is read in. */
	const say = (emu: number) => displayLength(emu, unit);
	const of = { constraint: c.id, kind: c.kind, axis } as const;

	/** The band a line has to cross to touch every member. */
	const band = () => {
		const starts = frames.map((f) => across(f, axis).start);
		const ends = frames.map((f) => across(f, axis).start + across(f, axis).size);
		return {
			from: round(Math.min(...starts) - OVERHANG),
			to: round(Math.max(...ends) + OVERHANG),
		};
	};

	if (spec.annotation === "between") {
		const [a, b] = frames;
		const lead = along(b, axis).start;
		const trail = along(a, axis).start + along(a, axis).size;
		return [
			{
				...of,
				shape: "span",
				// Between the two centres, so the dimension reads as belonging to
				// both rather than sitting on either.
				at: round(
					(across(a, axis).start +
						across(a, axis).size / 2 +
						across(b, axis).start +
						across(b, axis).size / 2) /
						2,
				),
				from: round(trail),
				to: round(lead),
				label: say(round(lead - trail)),
			},
		];
	}

	if (spec.annotation === "mirror") {
		// Read off the two members rather than off the stored value: with a
		// third member the mirror *is* that node's centre, and either way this
		// is where the design settled.
		const mid = (f: Frame) => along(f, axis).start + along(f, axis).size / 2;
		const at = round((mid(frames[0]) + mid(frames[1])) / 2);
		return [{ ...of, shape: "line", at, ...band(), label: say(at) }];
	}

	// "edges": a size is a thing each member has of its own, so it draws one
	// mark per member; a place is one they share, so it draws one line.
	if (EDGES[edge].role === "span") {
		return frames.map((f) => ({
			...of,
			shape: "span" as const,
			at: round(across(f, axis).start + across(f, axis).size / 2),
			from: round(along(f, axis).start),
			to: round(along(f, axis).start + along(f, axis).size),
			label: say(round(along(f, axis).size)),
		}));
	}
	const at = round(edgeOf(frames[0], edge, axis));
	return [
		{
			...of,
			shape: "line",
			at,
			...band(),
			// Only where the number is the point: an alignment is about the
			// edges meeting, not about which coordinate they met at.
			...(spec.valueType ? { label: say(at) } : {}),
		},
	];
}
