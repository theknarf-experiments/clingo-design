/**
 * Margins, a grid of tracks, and lines drawn by hand — what the document holds
 * and what a reader gets back out of it.
 *
 * Everything here is pure: no grounding and no solver, because the claims are
 * about the document alone. Which settings exist, what absence means, what a
 * count is allowed to be, and what a constraint is naming when one of its
 * members is not a node. What the *solver* then does with a datum is the
 * compiler's business and is tested where the equations are.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	addGuide,
	deleteNodes,
	drawGuideAt,
	moveGuide,
	pinToDatum,
	pinnedTo,
	pruneConstraints,
	removeGuide,
	setGuideAt,
	setGuideLocked,
	setGuideValue,
	setGuides,
} from "./edits.ts";
import {
	type Constraint,
	EDGES,
	GUIDE_PROPS,
	GUIDE_PROP_NAMES,
	type Guide,
	type GuideProp,
	type Scene,
	type SceneNode,
	countOn,
	datumIds,
	datumLabel,
	emptyScene,
	findGuide,
	guideAt,
	guideCount,
	guideFrozen,
	guideLength,
	guideLines,
	guideSetting,
	gutterOn,
	holdsDatum,
	isDatum,
	isGridded,
	lineDatum,
	makeGuides,
	marginOn,
	nextGuideId,
	parseDatum,
	trackDatum,
} from "./scene.ts";
import { findInTree } from "./tree.ts";
import { EMU_PER_PX, emuOf } from "./units.ts";
import {
	MAX_TALLY,
	type Token,
	VALUE_TYPES,
	guideAtVar,
	guideVar,
	isLengthType,
	lit,
	ref,
	single,
	tallyOf,
	wordOf,
} from "./values.ts";

const P = EMU_PER_PX;

const surface = (node: Partial<SceneNode> = {}): SceneNode => ({
	id: "page",
	kind: "frame",
	name: "Page",
	frame: {
		x: single("0px"),
		y: single("0px"),
		width: single("960px"),
		height: single("640px"),
	},
	props: {},
	...node,
});

const line = (guide: Partial<Guide> = {}): Guide => ({
	id: "g1",
	axis: "x",
	at: single("120px"),
	...guide,
});

const context = (tokens: Token[] = [], picks: Record<string, number> = {}) => ({
	tokens,
	picks,
});

/* ------------------------------------------------------------------ */
/* The table of truth                                                  */
/* ------------------------------------------------------------------ */

test("every guide setting names a type, and falls back to a value of it", () => {
	for (const prop of GUIDE_PROP_NAMES) {
		const spec = GUIDE_PROPS[prop];
		assert.ok(VALUE_TYPES[spec.type], `${prop} has an unknown type`);
		// A fallback is read by the same exact-or-nothing readers a stored value
		// is, so an entry no unit can spell would make the setting say nothing at
		// all rather than say what it looks like it says.
		if (isLengthType(spec.type)) {
			assert.notEqual(emuOf(spec.fallback), undefined, `${prop} falls back to "${spec.fallback}"`);
		} else {
			assert.notEqual(tallyOf(spec.fallback), undefined, `${prop} falls back to "${spec.fallback}"`);
		}
	}
});

test("the settings cover both axes and both ends, exactly once each", () => {
	// The lookups are what the track equation is written in terms of, so a table
	// they cannot answer from is a rule that has to name `x` — which is the one
	// thing the geometry side of this compiler never does.
	const found: GuideProp[] = [];
	for (const axis of ["x", "y"] as const) {
		found.push(countOn(axis), gutterOn(axis));
		for (const place of ["lead", "trail"] as const) {
			found.push(marginOn(axis, place));
		}
	}
	assert.equal(new Set(found).size, found.length, "two settings answer to one name");
	assert.deepEqual(
		[...found].sort(),
		[...GUIDE_PROP_NAMES].sort(),
		"a setting no lookup reaches is a setting no rule can read",
	);

	// And the ends line up with the geometry the rest of the document is written
	// in: the left margin is measured from the same end of the same axis the
	// `left` edge is.
	assert.equal(marginOn("x", "lead"), "marginLeft");
	assert.equal(marginOn("y", "trail"), "marginBottom");
	assert.equal(EDGES.left.axis, GUIDE_PROPS.marginLeft.axis);
	assert.equal(EDGES.left.place, GUIDE_PROPS.marginLeft.place);
});

test("a count is a count, not a length", () => {
	// The failure this column exists to stop: read as a length, a column count of
	// 12 is 114300 EMU, and a rule grounding `1..N` off it builds 114300 tracks.
	for (const axis of ["x", "y"] as const) {
		assert.equal(GUIDE_PROPS[countOn(axis)].type, "count");
		assert.ok(isLengthType(GUIDE_PROPS[gutterOn(axis)].type));
	}
});

/* ------------------------------------------------------------------ */
/* Absence is off                                                      */
/* ------------------------------------------------------------------ */

test("a surface with no guides has no grid, and needs no switch to say so", () => {
	assert.equal(isGridded(surface()), false);
	assert.equal(guideLines(surface()).length, 0);
	// One track, no margins: the degenerate grid is indistinguishable from no
	// grid, which is why there is no `enabled` flag to keep in step.
	const off = surface({ guides: makeGuides() });
	assert.equal(isGridded(off), true);
	assert.equal(guideCount(off, "columns"), 1);
	assert.equal(guideLength(off, "marginLeft"), 0);
});

test("a grid on something that is not a surface says nothing", () => {
	// Read off KINDS rather than corrected on the way in: a stored document is
	// read, not repaired, and the two readers that matter both ask the table.
	const rect = surface({ kind: "rect", guides: makeGuides({ columns: 12 }) });
	assert.equal(isGridded(rect), false);
	assert.equal(datumIds({ ...emptyScene(), nodes: [rect] }).length, 0);
});

test("makeGuides fills every setting, and a count is a number of things", () => {
	const guides = makeGuides({ columns: 12, gutter: 24, marginLeft: "0.5in" });
	for (const prop of GUIDE_PROP_NAMES) {
		assert.ok(guides[prop], `${prop} is unset`);
	}
	const node = surface({ guides });
	assert.equal(guideCount(node, "columns"), 12);
	assert.equal(guideLength(node, "gutter"), 24 * P);
	assert.equal(guideLength(node, "marginLeft"), 48 * P);
	// A bare number in a length is pixels; a bare number in a count is twelve
	// columns rather than twelve pixels' worth of them.
	assert.deepEqual(guides.columns, single("12"));
	assert.deepEqual(guides.gutter, single("24px"));
});

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

test("a margin that names a token is the page's spacing scale", () => {
	const tokens: Token[] = [
		{ id: "edge", name: "edge", type: "length", value: single("18mm") },
	];
	const node = surface({
		guides: { ...makeGuides(), marginLeft: [ref("edge")] },
	});
	assert.equal(guideLength(node, "marginLeft", context(tokens)), 648000);
	// A dangling link says nothing, and the table answers instead — the same
	// thing the generated program does when a `resolved/2` goes underived.
	assert.equal(guideLength(node, "marginLeft", context()), 0);
});

test("a setting the document does not hold falls back to the table", () => {
	const bare = surface({ guides: { ...makeGuides(), gutter: [] } });
	assert.equal(guideSetting(bare, "gutter"), undefined);
	assert.equal(guideLength(bare, "gutter"), emuOf(GUIDE_PROPS.gutter.fallback));
});

test("a margin is never negative, whatever the document says", () => {
	// The track equation would read -8 as room rather than as a mistake.
	const node = surface({ guides: makeGuides({ marginTop: "-8px" }) });
	assert.equal(guideLength(node, "marginTop"), 0);
});

test("a count holds at least one track, whatever it is asked", () => {
	// Every one of these is a grid the width equation would divide by zero, hang
	// the grounder over, or read as a fraction of a column.
	for (const said of ["0", "-3", "1.5", "many", String(MAX_TALLY + 1)]) {
		const node = surface({ guides: makeGuides({ columns: said }) });
		assert.equal(guideCount(node, "columns"), 1, said);
	}
	assert.equal(
		guideCount(surface({ guides: makeGuides({ columns: MAX_TALLY }) }), "columns"),
		MAX_TALLY,
	);
});

test("a grid with two counts is a responsive grid, and the universe picks", () => {
	// The thing a page-layout tool cannot say: twelve columns wide and six
	// narrow, in one document, with the solver free to choose between them.
	const node = surface({
		guides: { ...makeGuides(), columns: [lit("12"), lit("6")] },
	});
	const key = guideVar("page", "columns");
	assert.equal(guideCount(node, "columns", context([], {})), 12);
	assert.equal(guideCount(node, "columns", context([], { [key]: 1 })), 6);
});

test("a guide sits where its own value says, in the surface's coordinates", () => {
	const node = surface({ lines: [line({ at: single("2in") })] });
	const guide = guideLines(node)[0];
	assert.equal(guideAt(node, guide), 192 * P);
	assert.equal(findGuide(node, "g1"), guide);
	assert.equal(findGuide(node, "nope"), undefined);

	// A position that reads as nothing is the origin, which is what the program's
	// own default says too — not a guide that vanishes.
	assert.equal(guideAt(node, line({ at: single("50%") })), 0);
});

test("a new guide gets a name the program can hold, and nobody else's", () => {
	const node = surface({ lines: [line(), line({ id: "g2" })] });
	assert.equal(nextGuideId(surface()), "g1");
	assert.equal(nextGuideId(node), "g3");
	// It has to be spellable as a constant: the id reaches ASP inside a datum
	// term and inside its own variable key, and neither can hold a space.
	assert.equal(wordOf(nextGuideId(node)), nextGuideId(node));
	assert.equal(isDatum(lineDatum("page", nextGuideId(node))), true);
});

test("a guide that names a token moves with the token", () => {
	const tokens: Token[] = [
		{ id: "fold", name: "fold", type: "length", value: [lit("300px"), lit("480px")] },
	];
	const node = surface({ lines: [line({ at: [ref("fold")] })] });
	const guide = guideLines(node)[0];
	assert.equal(guideAt(node, guide, context(tokens)), 300 * P);
	// Its own variable key, so pinning the *token's* universe moves it — the
	// whole thesis, applied to the guide itself.
	assert.equal(guideAt(node, guide, context(tokens, { "tok(fold)": 1 })), 480 * P);
	// And the key is the guide's own, not the grid's: a surface with both cannot
	// have one pick standing for the other.
	assert.notEqual(guideAtVar("page", "g1"), guideVar("page", "columns"));
});

/* ------------------------------------------------------------------ */
/* Datums                                                              */
/* ------------------------------------------------------------------ */

test("a datum term reads back as what it was written from", () => {
	assert.deepEqual(parseDatum(trackDatum("page", 3, "left")), {
		kind: "track",
		surface: "page",
		index: 3,
		edge: "left",
	});
	assert.deepEqual(parseDatum(lineDatum("page", "g1")), {
		kind: "line",
		surface: "page",
		guide: "g1",
	});
	// A surface id may itself be a term, so the arguments are parsed rather than
	// split — `cg(cell(1,1),3,left)` is three arguments, two of which hold commas.
	assert.deepEqual(parseDatum(trackDatum("cell(1,1)", 2, "top")), {
		kind: "track",
		surface: "cell(1,1)",
		index: 2,
		edge: "top",
	});
});

test("an ordinary member is not a datum, and neither is a term that names no line", () => {
	assert.equal(isDatum("plate"), false);
	assert.equal(isDatum("cell(1,1)"), false);
	// A size and an axis are not places on a track, so they name no line.
	assert.equal(isDatum("cg(page,3,width)"), false);
	assert.equal(isDatum("cg(page,3,x)"), false);
	// Tracks are 1-based, as the `1..N` a rule grounds is.
	assert.equal(isDatum("cg(page,0,left)"), false);
	assert.equal(isDatum("cg(page,left)"), false);
});

test("a gridded surface offers three lines per track, on both axes", () => {
	const node = surface({ guides: makeGuides({ columns: 3, rows: 2 }) });
	const ids = datumIds({ ...emptyScene(), nodes: [node] });

	// Three places per track — the two boundaries and the middle — because
	// centring a card in column three is the second thing anybody does with a
	// grid, and `align` forces the same edge on both members.
	assert.equal(ids.length, (3 + 2) * 3);
	assert.ok(ids.includes(trackDatum("page", 3, "left")));
	assert.ok(ids.includes(trackDatum("page", 3, "centerX")));
	assert.ok(ids.includes(trackDatum("page", 2, "bottom")));
	assert.ok(!ids.includes(trackDatum("page", 4, "left")));
});

test("a datum that exists in some universe is one a rule may name", () => {
	// The widest reading, not the current one: the twelfth column is real in the
	// universe that picked twelve, so the editor may offer it in either.
	const node = surface({
		guides: { ...makeGuides(), columns: [lit("6"), lit("12")] },
	});
	const ids = datumIds({ ...emptyScene(), nodes: [node] });
	assert.ok(ids.includes(trackDatum("page", 12, "left")));
});

test("the lines a designer drew are datums too, and travel with their surface", () => {
	const nested = surface({
		id: "outer",
		children: [surface({ id: "inner", lines: [line(), line({ id: "g2", axis: "y" })] })],
	});
	const ids = datumIds({ ...emptyScene(), nodes: [nested] });
	assert.deepEqual(ids, [lineDatum("inner", "g1"), lineDatum("inner", "g2")]);
	// Per surface rather than per document, which is what makes duplicating an
	// artboard free: the copy's lines keep their names under a new surface id.
	assert.notEqual(lineDatum("inner", "g1"), lineDatum("outer", "g1"));
});

test("what the document holds is asked of the grid, not of the track", () => {
	const scene: Scene = {
		...emptyScene(),
		nodes: [surface({ guides: makeGuides({ columns: 6 }), lines: [line()] })],
	};
	assert.equal(holdsDatum(scene, trackDatum("page", 2, "left")), true);
	// Deliberately blunt: a member past the end of today's grid says nothing
	// until the grid grows again, and deleting the rule would mean retyping it
	// rather than the count.
	assert.equal(holdsDatum(scene, trackDatum("page", 99, "left")), true);
	assert.equal(holdsDatum(scene, trackDatum("gone", 1, "left")), false);
	assert.equal(holdsDatum(scene, lineDatum("page", "g1")), true);
	assert.equal(holdsDatum(scene, lineDatum("page", "g9")), false);
	assert.equal(holdsDatum(scene, "page"), false);

	const plain: Scene = { ...emptyScene(), nodes: [surface()] };
	assert.equal(holdsDatum(plain, trackDatum("page", 1, "left")), false);
});

test("a datum has a name a sentence can hold", () => {
	const scene: Scene = {
		...emptyScene(),
		nodes: [surface({ guides: makeGuides({ columns: 4, rows: 3 }), lines: [line()] })],
	};
	// The surface's own name rather than its id, because this ends up inside "…
	// forces this" in the why-panel, and `cg(page,3,left)` in the middle of a
	// sentence about why a card is where it is undoes the sentence.
	assert.equal(datumLabel(scene, trackDatum("page", 3, "left")), "Column 3 left — Page");
	assert.equal(datumLabel(scene, trackDatum("page", 3, "centerX")), "Column 3 centre — Page");
	// The two axes disagree about English, which is why the words are a table and
	// not `EDGES[edge].label`: the middle line of a row is its middle.
	assert.equal(datumLabel(scene, trackDatum("page", 2, "centerY")), "Row 2 middle — Page");
	assert.equal(datumLabel(scene, trackDatum("page", 2, "bottom")), "Row 2 bottom — Page");
	assert.equal(datumLabel(scene, lineDatum("page", "g1")), "Guide g1 — Page");

	// Nothing for a member that is not a datum, so a caller can chain this after
	// the document's own names and fall through to the id.
	assert.equal(datumLabel(scene, "page"), undefined);
	assert.equal(datumLabel(scene, "cg(page,3,width)"), undefined);
	// A surface the document no longer holds still reads as its term's own id,
	// which is more use than nothing while a rule is being repaired.
	assert.equal(datumLabel(scene, trackDatum("gone", 1, "left")), "Column 1 left — gone");
});

test("deleting a node does not strip the datums from the rules that survive", () => {
	// The failure this guards: `pruneConstraints` filters members against the
	// live *nodes*, so without a second question the first deletion anywhere in
	// the document would quietly unpin everything from the grid — and take the
	// rule with it wherever that dropped it under `minNodes`.
	const pinned: Constraint = {
		id: "on_column",
		kind: "align",
		prop: "fill",
		nodes: ["card", trackDatum("page", 3, "left")],
		edge: "left",
		enabled: true,
	};
	const scene: Scene = {
		...emptyScene(),
		nodes: [
			surface({
				guides: makeGuides({ columns: 12 }),
				children: [
					surface({ id: "card", kind: "rect" }),
					surface({ id: "spare", kind: "rect" }),
				],
			}),
		],
		constraints: [pinned],
	};
	assert.equal(pruneConstraints(scene), scene, "nothing moved, so nothing is rewritten");

	const after = deleteNodes(scene, ["spare"]);
	assert.deepEqual(after.constraints[0]?.nodes, pinned.nodes);

	// And a datum whose surface stops being gridded is a ghost like any other.
	const ungridded: Scene = {
		...scene,
		nodes: [{ ...scene.nodes[0], guides: undefined }],
	};
	assert.deepEqual(pruneConstraints(ungridded).constraints, []);
});

/* ------------------------------------------------------------------ */
/* Drawing, moving, locking and rubbing out                            */
/* ------------------------------------------------------------------ */

const paged = (node: Partial<SceneNode> = {}): Scene => ({
	...emptyScene(),
	nodes: [surface(node)],
	constraints: [],
});

const linesOn = (scene: Scene, id = "page"): readonly Guide[] =>
	guideLines(scene.nodes.find((n) => n.id === id) as SceneNode);

test("a guide is drawn where the gesture left it, in the document's unit", () => {
	const first = addGuide(paged(), "page", "x", 137 * P);
	assert.equal(first.id, "g1");
	const drawn = linesOn(first.scene)[0];
	assert.deepEqual([drawn.axis, drawn.at], ["x", single("137px")]);

	// A second one takes the next free name on *this* surface — which is the
	// scope a guide id is unique in, so nothing has to renumber when a page is
	// duplicated.
	const second = addGuide(first.scene, "page", "y", 40 * P);
	assert.equal(second.id, "g2");
	assert.deepEqual(linesOn(second.scene).map((g) => g.id), ["g1", "g2"]);

	// The document's own unit, because unlike a frame this edit has the document
	// in hand: 1 in is 96 px is 72 pt, and the drag is quantized to a whole pixel
	// before it is spelled.
	const points = addGuide({ ...paged(), unit: "pt" }, "page", "x", 96 * P);
	assert.deepEqual(linesOn(points.scene)[0].at, single("72pt"));
});

test("a line dropped on the canvas belongs to the page under it", () => {
	// The ruler's drag ends in canvas coordinates and knows nothing about what is
	// under it; where the line then lives is the document's question.
	const scene: Scene = {
		...emptyScene(),
		nodes: [
			surface({
				id: "outer",
				frame: {
					x: single("100px"),
					y: single("100px"),
					width: single("800px"),
					height: single("600px"),
				},
				children: [
					surface({
						id: "inner",
						frame: {
							x: single("50px"),
							y: single("20px"),
							width: single("400px"),
							height: single("200px"),
						},
					}),
				],
			}),
		],
		constraints: [],
	};

	// Inside both, so the innermost wins — the same answer a newly drawn node
	// gets — and the position is measured from that surface's own origin.
	const inner = drawGuideAt(scene, "x", { x: 300 * P, y: 200 * P });
	const on = findInTree(inner.scene.nodes, "inner") as SceneNode;
	assert.deepEqual(guideLines(on)[0].at, single("150px"));

	// Outside the inner one but inside the page.
	const outer = drawGuideAt(scene, "y", { x: 700 * P, y: 500 * P });
	assert.deepEqual(
		guideLines(findInTree(outer.scene.nodes, "outer") as SceneNode)[0].at,
		single("400px"),
	);

	// And on nothing at all: a guide has to belong to a surface, so a line
	// dropped on the canvas is not drawn rather than being drawn in a world
	// coordinate whose meaning evaporates when the artboard moves.
	const nowhere = drawGuideAt(scene, "x", { x: 2000 * P, y: 2000 * P });
	assert.equal(nowhere.id, null);
	assert.equal(nowhere.scene, scene);
});

test("a guide is a line on a page, not on a rectangle", () => {
	const scene = paged({ kind: "rect" });
	const drawn = addGuide(scene, "page", "x", 100 * P);
	assert.equal(drawn.id, null);
	assert.equal(drawn.scene, scene);
	assert.equal(addGuide(scene, "nobody", "x", 100 * P).id, null);
});

test("moving a guide writes the alternative on screen, in its own spelling", () => {
	const scene = paged({ lines: [line({ at: [lit("10pt"), lit("30pt")] })] });
	// A pixel is exactly 0.75pt, so a design in points stays in points across a
	// drag — the same promise `withFrame` makes for a frame.
	const moved = moveGuide(scene, "page", "g1", 44 * P, { [guideAtVar("page", "g1")]: 1 });
	assert.deepEqual(linesOn(moved)[0].at, [lit("10pt"), lit("33pt")]);

	// And nothing at all when the drag ended where it began, so a gesture that
	// went nowhere writes no undo entry and cannot pull an exact value onto the
	// pixel grid on its way past.
	const still = moveGuide(scene, "page", "g1", emuOf("10pt") as number);
	assert.equal(still, scene);
});

test("a locked guide is not moved, by any road", () => {
	const scene = paged({ lines: [line({ locked: true })] });
	assert.equal(moveGuide(scene, "page", "g1", 400 * P), scene);
	assert.equal(guideFrozen(scene.nodes[0], line({ locked: true })), true);

	// Nor is one whose position is a link: that number belongs to the token, and
	// quietly replacing the link would unwire the very thing the guide shows off.
	const linked = paged({ lines: [line({ at: [ref("t_side")] })] });
	assert.equal(moveGuide(linked, "page", "g1", 400 * P), linked);
	assert.equal(guideFrozen(linked.nodes[0], linked.nodes[0].lines?.[0] as Guide), true);

	// Typing a number is a different act from dragging one, and it goes through.
	const typed = setGuideAt(scene, "page", "g1", single("400px"));
	assert.deepEqual(linesOn(typed)[0].at, single("400px"));
});

test("locking is stored only when it is asked for", () => {
	const scene = paged({ lines: [line()] });
	const locked = setGuideLocked(scene, "page", "g1", true);
	assert.equal(linesOn(locked)[0].locked, true);
	// Off is stored as nothing at all, so a document only carries the lines
	// somebody deliberately pinned down.
	assert.equal(Object.hasOwn(linesOn(setGuideLocked(locked, "page", "g1", false))[0], "locked"), false);
});

test("rubbing a line out takes the rules that were only holding to it", () => {
	const pin: Constraint = {
		id: "k_pin",
		kind: "align",
		prop: "fill",
		nodes: ["card", lineDatum("page", "g1")],
		edge: "left",
		enabled: true,
	};
	const scene: Scene = {
		...paged({ lines: [line(), line({ id: "g2" })], children: [surface({ id: "card", kind: "rect" })] }),
		constraints: [pin],
	};
	const after = removeGuide(scene, "page", "g1");
	assert.deepEqual(linesOn(after).map((g) => g.id), ["g2"]);
	assert.deepEqual(after.constraints, [], "a rule holding to a line that is gone is a ghost");

	// The last line out leaves no empty list behind: "no lines" has one spelling.
	const bare = removeGuide(after, "page", "g2");
	assert.equal(Object.hasOwn(bare.nodes[0], "lines"), false);
});

test("ruling a surface, and stopping", () => {
	const scene = setGuides(paged(), "page", makeGuides({ columns: 12, gutter: 24 }));
	assert.equal(isGridded(scene.nodes[0]), true);
	assert.equal(guideCount(scene.nodes[0], "columns"), 12);

	const wider = setGuideValue(scene, "page", "columns", [lit("6"), lit("12")]);
	assert.equal(guideCount(wider.nodes[0], "columns", context([], { [guideVar("page", "columns")]: 1 })), 12);
	assert.equal(setGuideValue(scene, "page", "columns", []), scene, "an empty value says nothing");

	// Taking the grid away is the other half of the prune: a rule holding a card
	// to a column of a page that is no longer ruled is pointing at nothing.
	const pinned: Scene = {
		...wider,
		constraints: [
			{
				id: "k_pin",
				kind: "align",
				prop: "fill",
				nodes: ["card", trackDatum("page", 3, "left")],
				edge: "left",
				enabled: true,
			},
		],
		nodes: [{ ...wider.nodes[0], children: [surface({ id: "card", kind: "rect" })] }],
	};
	assert.deepEqual(setGuides(pinned, "page", undefined).constraints, []);
	assert.equal(isGridded(setGuides(pinned, "page", undefined).nodes[0]), false);
});

/* ------------------------------------------------------------------ */
/* A snap that became a rule                                           */
/* ------------------------------------------------------------------ */

test("a drop against a column can be said out loud, once", () => {
	const scene: Scene = paged({
		guides: makeGuides({ columns: 4 }),
		children: [surface({ id: "card", kind: "rect" })],
	});
	const term = trackDatum("page", 3, "left");
	const pinned = pinToDatum(scene, "card", term, "left");
	assert.ok(pinned.id);

	const rule = pinned.scene.constraints[0];
	assert.deepEqual(
		[rule.kind, rule.nodes, rule.edge, rule.enabled],
		["align", ["card", term], "left", true],
	);

	// Dropping on the same line again is the same rule, not a pile of them.
	const again = pinToDatum(pinned.scene, "card", term, "left");
	assert.equal(again.scene, pinned.scene);
	assert.equal(again.id, pinned.id);
	assert.equal(pinnedTo(pinned.scene, "card", term, "left"), pinned.id);
	// A different edge is a different statement, and gets its own rule.
	assert.equal(pinnedTo(pinned.scene, "card", term, "centerX"), undefined);
	assert.equal(pinToDatum(pinned.scene, "card", term, "centerX").scene.constraints.length, 2);

	// Nothing to pin to, nothing said.
	assert.equal(pinToDatum(scene, "card", trackDatum("gone", 1, "left"), "left").id, null);
	assert.equal(pinToDatum(scene, "ghost", term, "left").id, null);
});
