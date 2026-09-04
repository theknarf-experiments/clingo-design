/**
 * The sketch kinds, as a claim about the generated program — through the real
 * compiler and the real solver, never through a hand-written atom list.
 *
 * `spatialprogram.test.ts` is the model this follows, and for the same reason:
 * every sentence the feature says is a sentence about what clingo grounds. The
 * three kinds that ship here — `distance`, `bearing`, `collinear` — are decided
 * by a *second* solver, so what this file has to prove is mostly a set of
 * absences: that a sketch rule mints no theory variable, that its members are
 * not `gsolved`, that a document with none of them compiles to the program it
 * always did, and that the members the whitelist turns away never become points.
 * None of those can be checked by reading the rule text, because every one of
 * them is a rule that would ground when it should not.
 *
 * **The first test is the one that matters most and is deliberately first.**
 * `gkind/1` used to be a pure mirror of `ConstraintSpec.geometric`; a sketch
 * kind left in it hands one rectangle to simplex and to PlaneGCS at once, and
 * the picture is then whichever of them wrote last — silently, with every rule
 * reporting itself satisfied. See docs/planegcs-spec.md §10.1.
 *
 * Written in pixels at the document end and EMU in the middle, the seam
 * `spatialprogram.test.ts` and `geometric.test.ts` both name.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseAtom } from "./atoms.ts";
import { CONTRACT, PULL_ATOM, SCENERY_ATOM, compile } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { explore } from "./explore.ts";
import {
	ANCHORS,
	ANCHOR_NAMES,
	CONSTRAINT_KINDS,
	CONSTRAINT_NAMES,
	type Constraint,
	type Scene,
	type SceneNode,
	dimension,
	emptyScene,
	makeFrame,
	makeLayout,
	rangesOverGroup,
} from "./scene.ts";
import { TEMPLATES } from "./templates/index.ts";
import { EMU_PER_PX } from "./units.ts";
import { single } from "./values.ts";

/**
 * The one template that states something about the sketch layer.
 *
 * Every guard below that says "no template does X" means "no template but this
 * one", and each names it here rather than carrying its own literal, so that
 * retiring the exemption is one edit and forgetting one of them is impossible.
 */
const SKETCHING_TEMPLATE = "orbit";

const P = EMU_PER_PX;
const px = (n: number): number => n * P;

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

const at = (
	id: string,
	box: { x: number; y: number; w: number; h: number },
	extra: Partial<SceneNode> = {},
): SceneNode => ({
	id,
	kind: "rect",
	name: id,
	frame: makeFrame({
		x: px(box.x),
		y: px(box.y),
		width: px(box.w),
		height: px(box.h),
	}),
	props: {},
	...extra,
});

const scened = (nodes: SceneNode[], constraints: Constraint[]): Scene => ({
	...emptyScene(),
	nodes,
	constraints,
});

/** Two boxes a hand put down, which is the case a sketch rule is *for*. */
const twoBoxes = (): SceneNode[] => [
	at("card", { x: 0, y: 0, w: 100, h: 60 }),
	at("badge", { x: 200, y: 40, w: 40, h: 40 }),
];

const rule = (c: Partial<Constraint> & Pick<Constraint, "id" | "kind">): Constraint => ({
	prop: "fill",
	nodes: [],
	enabled: true,
	...c,
});

/* ------------------------------------------------------------------ */
/* Reading the program back                                            */
/* ------------------------------------------------------------------ */

/**
 * One answer set, with whatever extra `#show` the caller needs.
 *
 * Half the predicates this file is about are derived and *not* shown —
 * `skpoint/2`, `sknopoint/1`, `skcon/1`, `gsolved/1` — because nothing in the
 * studio reads them. Asking for them here rather than showing them from the
 * compiler is the honest way round: a `#show` added for a test is a cost every
 * solve in the app would pay for a fact no panel wants.
 */
async function answer(scene: Scene, extra = ""): Promise<string[]> {
	const { program, guards } = compile(scene);
	const session = await directSolver.open(`${program}\n${extra}\n`, "--project");
	try {
		const out = await session.solve({
			models: 1,
			assumptions: [...guards, PULL_ATOM, SCENERY_ATOM].map((atom) => ({ atom })),
		});
		assert.equal(out.result, "SATISFIABLE", "expected a design");
		return out.models[0] ?? [];
	} finally {
		await session.close();
	}
}

/** Every atom of one predicate, as its argument lists. */
const of = (atoms: readonly string[], name: string): string[][] =>
	atoms.flatMap((text) => {
		const atom = parseAtom(text);
		return atom && atom.name === name ? [atom.args] : [];
	});

/** Whether any theory variable in the answer is about this node. */
const hasTheoryVar = (atoms: readonly string[], node: string): boolean =>
	atoms.some((text) => /^__lpx\(/.test(text) && text.includes(`(${node},`));

/* ------------------------------------------------------------------ */
/* 1. The two lists, and the line that keeps them apart                */
/* ------------------------------------------------------------------ */

test("gkind names the five simplex decides and not one more", () => {
	// The single most important assertion in this file. `gkind(K)` is what heads
	// `gcon/1`, which heads `gedgeof/2`, which mints `ge/2` and enrols a node in
	// the shared minimisation. A sketch kind here would be a rectangle under two
	// solvers at once.
	const { program } = compile(scened(twoBoxes(), []));
	const named = program
		.split("\n")
		.flatMap((line) => {
			const m = /^gkind\((\w+)\)\.$/.exec(line);
			return m ? [m[1]] : [];
		});
	assert.deepEqual(named, ["align", "gap", "equalSize", "symmetric", "pin"]);
});

test("skind names the three it decides, on every document there is", () => {
	// Unconditional, beside its twin and for its twin's reason: `skcon/1` is
	// something a hand-written rule may assert, and this is the table it would be
	// asserting against. Three facts that derive nothing on their own.
	const { program } = compile(emptyScene());
	const named = program
		.split("\n")
		.flatMap((line) => {
			const m = /^skind\((\w+)\)\.$/.exec(line);
			return m ? [m[1]] : [];
		});
	assert.deepEqual(named, ["distance", "bearing", "collinear"]);
	// And they sit where §2.2 says, immediately after the gkind facts, so the
	// no-regression promise below is a promise about three named lines rather
	// than about wherever they happened to land.
	const lines = program.split("\n");
	assert.equal(lines[lines.indexOf("skind(distance).") - 1], "gkind(pin).");
});

test("the two lists are exhaustive and disjoint over the geometric kinds", () => {
	// Read off the one table that says what a kind is, which is what stops the
	// pair drifting: a new geometric kind has to name an engine, and naming one
	// puts it in exactly one of these two lists.
	const geometric = CONSTRAINT_NAMES.filter((k) => CONSTRAINT_KINDS[k].geometric);
	const linear = geometric.filter((k) => CONSTRAINT_KINDS[k].engine === "linear");
	const sketch = geometric.filter((k) => CONSTRAINT_KINDS[k].engine === "sketch");
	assert.deepEqual([...linear, ...sketch].sort(), [...geometric].sort());
	assert.equal(linear.some((k) => sketch.includes(k)), false);
	// And exactly one of `edges` and `anchors` is non-empty on every kind that
	// has a subject at all, which is the question the compiler branches on.
	for (const kind of geometric) {
		const spec = CONSTRAINT_KINDS[kind];
		assert.equal(
			spec.edges.length > 0,
			spec.anchors.length === 0,
			`${kind} reads both an edge and a point, or neither`,
		);
		assert.equal(spec.anchors.length > 0, spec.engine === "sketch", kind);
	}
});

test("an anchor is a pair of edges, and the fifth of the nine is the centre", () => {
	assert.deepEqual(ANCHOR_NAMES, [
		"topLeft",
		"top",
		"topRight",
		"left",
		"center",
		"right",
		"bottomLeft",
		"bottom",
		"bottomRight",
	]);
	// Derived from EDGES rather than written out, so the table cannot drift from
	// the vocabulary the program states.
	assert.deepEqual(ANCHORS.center, { x: "centerX", y: "centerY" });
	assert.deepEqual(ANCHORS.topLeft, { x: "left", y: "top" });
	assert.deepEqual(ANCHORS.bottomRight, { x: "right", y: "bottom" });
	// Index 4 is the default the compiler, `shapeFor` and the overlay all write.
	assert.equal(ANCHOR_NAMES[4], "center");
	for (const kind of CONSTRAINT_NAMES) {
		const spec = CONSTRAINT_KINDS[kind];
		if (spec.anchors.length === 0) continue;
		assert.equal(spec.anchors[4], "center", kind);
	}
});

test("a sketch kind reads its members by position, so a group cannot fill it", () => {
	// `collinear` is unbounded and still ordered — the first two members are the
	// line the rest fall on — and every sketch member needs a layer to keep a
	// starting aim on, which a set a rule derived has not got.
	assert.equal(rangesOverGroup("collinear"), false);
	assert.equal(rangesOverGroup("distance"), false);
	assert.equal(rangesOverGroup("bearing"), false);
	// ...while the linear unbounded kinds still range over one.
	assert.equal(rangesOverGroup("align"), true);
	assert.equal(rangesOverGroup("match"), true);
});

/* ------------------------------------------------------------------ */
/* 2. No regression: a document with no sketch rule                    */
/* ------------------------------------------------------------------ */

test("a document with no sketch rule gains three facts and nothing else", () => {
	// Promise 1 of the spec's §11, over every template the tool ships. The three
	// `skind/1` facts are unconditional; everything else — the rules, their
	// `#defined` lines, their `#show`s and their two `#project`s — is gated, so
	// on a document that never met a sketch rule the word `sk` appears exactly
	// three times in the whole program.
	//
	// Byte-equality against the program as it stood before this step was checked
	// out of band, template by template, by compiling both trees: all fifteen
	// were identical once these three lines were removed. What is asserted here
	// is the shape that keeps it true.
	const gained = ["skind(distance).", "skind(bearing).", "skind(collinear)."];
	for (const template of TEMPLATES) {
		// ...every template but the one written to show the sketch layer off. It
		// is exempted by name rather than by a predicate over its constraints,
		// because a predicate would quietly stop guarding the day a second
		// template gained a sketch rule by accident — which is the whole thing
		// this test is here to catch.
		if (template.id === SKETCHING_TEMPLATE) continue;
		const { program } = compile(template.create());
		const rest = program
			.split("\n")
			.filter((line) => !gained.includes(line))
			.join("\n");
		assert.equal(
			/\bsk\w*[( /]/.test(rest),
			false,
			`${template.id} states something about the sketch layer`,
		);
		for (const fact of gained) {
			assert.equal(
				program.split("\n").filter((l) => l === fact).length,
				1,
				`${template.id}: ${fact}`,
			);
		}
	}
});

test("and no template's answer set holds a sketch atom", async () => {
	// Promise 4. The `#show`s are inside the gated block, so a template cannot
	// show one — but the reason to check the *answer* rather than the program is
	// that a stray unconditional rule would be invisible in the text of a
	// program nobody reads line by line.
	for (const template of TEMPLATES) {
		const atoms = await answer(template.create());
		const stray = atoms.filter((a) => /^sk/.test(a));
		if (template.id === SKETCHING_TEMPLATE) {
			// The exception proves the rule, and it has to prove it out loud: an
			// exemption that only ever skips is indistinguishable from a template
			// that quietly stopped sketching.
			assert.notDeepEqual(stray, [], `${template.id} sketches nothing`);
			continue;
		}
		assert.deepEqual(stray, [], template.id);
	}
});

/* ------------------------------------------------------------------ */
/* 3. What a sketch rule compiles to                                   */
/* ------------------------------------------------------------------ */

test("a distance states its rule and says nothing about its numbers", async () => {
	const scene = scened(
		twoBoxes(),
		[
			rule({
				id: "apart",
				kind: "distance",
				nodes: ["card", "badge"],
				value: dimension(px(120)),
			}),
		],
	);
	const { program } = compile(scene);
	// No edge, and this is the trap §2.3 catches: written off `spec.geometric`
	// the compiler would have emitted `c_edge(apart,undefined)`, which is not a
	// term at all.
	assert.equal(program.includes("c_edge(apart"), false);
	assert.equal(program.includes("c_anchor(apart,center)."), true);
	// The whitelist, one fact per node the document holds.
	assert.equal(program.includes("sknode(card)."), true);
	assert.equal(program.includes("sknode(badge)."), true);
	// And not one theory atom about it. `&sum` is what the linear kinds compile
	// to; a sketch kind compiles to a question.
	for (const line of program.split("\n")) {
		if (!line.includes("&sum")) continue;
		assert.equal(/distance|bearing|collinear/.test(line), false, line);
	}

	const atoms = await answer(scene, "#show gsolved/1.\n#show skcon/1.\n");
	assert.deepEqual(of(atoms, "skcon"), [["apart"]]);
	assert.deepEqual(of(atoms, "skon"), [["apart"]]);
	assert.deepEqual(of(atoms, "skanchor"), [["apart", "center"]]);
	assert.deepEqual(of(atoms, "skmember").sort(), [
		["apart", "badge", "2"],
		["apart", "card", "1"],
	]);
	// EMU, through numeral/2 — the same bridge every length in the program
	// crosses.
	assert.deepEqual(of(atoms, "sk_length"), [["apart", String(px(120))]]);
	assert.deepEqual(of(atoms, "sk_angle"), []);
	assert.deepEqual(of(atoms, "sksolved").sort(), [["badge"], ["card"]]);
	// Nothing was held, because nothing linear placed either box — which is the
	// case this feature exists for, and the case in which it has room to move.
	assert.deepEqual(of(atoms, "skheld"), []);
	// And the safety property, stated as an absence: the members never reached
	// simplex, so neither is gsolved and neither has a theory variable.
	assert.deepEqual(of(atoms, "gsolved"), []);
	assert.equal(hasTheoryVar(atoms, "card"), false);
	assert.equal(hasTheoryVar(atoms, "badge"), false);
});

test("a bearing carries thousandths of a degree, and never a length", async () => {
	// The one kind in this tool whose value is not a length. Two predicates
	// rather than one because the units cannot be got from each other, and a
	// single `sk_value/2` would have been a number whose meaning depended on
	// which kind read it.
	const scene = scened(
		twoBoxes(),
		[
			rule({
				id: "lean",
				kind: "bearing",
				nodes: ["card", "badge"],
				value: single("30deg"),
			}),
		],
	);
	const atoms = await answer(scene);
	assert.deepEqual(of(atoms, "sk_angle"), [["lean", "30000"]]);
	assert.deepEqual(of(atoms, "sk_length"), []);
	assert.equal(hasTheoryVar(atoms, "card"), false);
});

test("a value that reads as no number leaves the rule with no number", async () => {
	// A percentage is not a length. The rule still exists, is still switched on
	// and is still nameable in a core; it simply carries nothing, and the sketch
	// layer drops it visibly rather than treating it as zero.
	const scene = scened(
		twoBoxes(),
		[
			rule({
				id: "apart",
				kind: "distance",
				nodes: ["card", "badge"],
				value: single("50%"),
			}),
		],
	);
	const atoms = await answer(scene);
	assert.deepEqual(of(atoms, "skon"), [["apart"]]);
	assert.deepEqual(of(atoms, "sk_length"), []);
});

test("a collinear keeps its order, because the first two are the line", async () => {
	const scene = scened(
		[...twoBoxes(), at("tag", { x: 400, y: 80, w: 30, h: 30 })],
		[rule({ id: "row", kind: "collinear", nodes: ["card", "badge", "tag"] })],
	);
	const atoms = await answer(scene);
	assert.deepEqual(of(atoms, "skmember").sort(), [
		["row", "badge", "2"],
		["row", "card", "1"],
		["row", "tag", "3"],
	]);
	// No value at all: three points on one line is a rule about nothing but the
	// points, so the kind has no `valueType` and the program states no number.
	assert.deepEqual(of(atoms, "sk_length"), []);
	assert.deepEqual(of(atoms, "sk_angle"), []);
	assert.deepEqual(of(atoms, "sksolved").sort(), [["badge"], ["card"], ["tag"]]);
});

test("a rule too small to say anything is not compiled at all", () => {
	// Two points are on a line by arithmetic, so a two-member `collinear` says
	// nothing — the same `minNodes` test every kind takes, and the same silence.
	const { program } = compile(
		scened(twoBoxes(), [
			rule({ id: "row", kind: "collinear", nodes: ["card", "badge"] }),
		]),
	);
	assert.equal(program.includes("constraint(row)"), false);
	// ...and with nothing sketched, the whole block stays out of the program.
	assert.equal(program.includes("skcon(C)"), false);
	assert.equal(program.includes("sknode(card)."), false);
});

/* ------------------------------------------------------------------ */
/* 4. Who may be a point                                               */
/* ------------------------------------------------------------------ */

const SHOW_POINTS = "#show skpoint/2.\n#show sknopoint/1.\n#show skoffcentre/1.\n";

test("a datum is a line, so it is not a point", async () => {
	// A column line has a place on one axis and nothing at all on the other, so
	// an anchor of one would be half a coordinate the document does not contain.
	const scene = scened(
		twoBoxes(),
		[
			rule({
				id: "apart",
				kind: "distance",
				nodes: ["card", "cg(page,3,left)"],
				value: dimension(px(40)),
			}),
		],
	);
	const atoms = await answer(scene, SHOW_POINTS);
	assert.deepEqual(of(atoms, "sknopoint"), [["cg(page,3,left)"]]);
	assert.deepEqual(of(atoms, "skpoint"), [["card", "center"]]);
	assert.deepEqual(of(atoms, "sksolved"), [["card"]]);
});

test("a member no node/1 fact heads is refused by the whitelist, not by a list of shapes", async () => {
	// The door an enumeration cannot close. `node(cell(R,C))` is a documented
	// thing for a rule to derive, and such a node has no layer to drag and
	// nowhere to keep a starting aim — so it is a node and it is not a point. A
	// blacklist of the four shapes we happen to know about would have let it
	// through and given PlaneGCS a coin flip.
	const scene = scened(
		twoBoxes(),
		[
			rule({
				id: "apart",
				kind: "distance",
				nodes: ["card", "cell(1,1)"],
				value: dimension(px(40)),
			}),
		],
	);
	const atoms = await answer(
		scene,
		`node(cell(1,1)).\n${SHOW_POINTS}`,
	);
	// It really is a node in this program...
	assert.deepEqual(of(atoms, "sknopoint"), []);
	// ...and it is still not a point, because `sknode/1` is stated from
	// `scene.nodes` and from nothing else.
	assert.deepEqual(of(atoms, "skpoint"), [["card", "center"]]);
	assert.deepEqual(of(atoms, "sksolved"), [["card"]]);
});

test("a turned box keeps its centre and loses its corners", async () => {
	// The refusal `gnoedge/2` already makes about a face, one relation over: a
	// turn about the centre moves no linear quantity, so the centre is exactly
	// where the document says and a corner is not.
	const nodes = [
		at("card", { x: 0, y: 0, w: 100, h: 60 }, {
			turn: { rotateZ: single("30deg") },
		}),
		at("badge", { x: 200, y: 40, w: 40, h: 40 }),
	];
	const corner = await answer(
		scened(nodes, [
			rule({
				id: "apart",
				kind: "distance",
				nodes: ["card", "badge"],
				anchor: "topLeft",
				value: dimension(px(120)),
			}),
		]),
		SHOW_POINTS,
	);
	assert.deepEqual(of(corner, "skoffcentre"), [["card"]]);
	assert.deepEqual(of(corner, "skpoint"), [["badge", "topLeft"]]);
	assert.deepEqual(of(corner, "sksolved"), [["badge"]]);

	// ...and the same document about the centre holds both members.
	const centre = await answer(
		scened(nodes, [
			rule({
				id: "apart",
				kind: "distance",
				nodes: ["card", "badge"],
				anchor: "center",
				value: dimension(px(120)),
			}),
		]),
		SHOW_POINTS,
	);
	assert.deepEqual(of(centre, "skoffcentre"), []);
	assert.deepEqual(of(centre, "sksolved").sort(), [["badge"], ["card"]]);
});

/* ------------------------------------------------------------------ */
/* 5. What the linear layer already decided                            */
/* ------------------------------------------------------------------ */

test("skheld names the coordinates simplex owns, off gcoord and not off gpos", async () => {
	// The one predicate that makes the two solvers a sequence rather than a
	// race. An `align` makes both members gsolved, which gives them gpos on both
	// planar axes, so all four coordinates are held and the distance has nothing
	// left to move — the intended answer, and the reason §5.2 has no release
	// loop.
	const scene = scened(twoBoxes(), [
		rule({
			id: "flush",
			kind: "align",
			nodes: ["card", "badge"],
			edge: "left",
		}),
		rule({
			id: "apart",
			kind: "distance",
			nodes: ["card", "badge"],
			value: dimension(px(120)),
		}),
	]);
	const atoms = await answer(scene);
	assert.deepEqual(of(atoms, "skheld").sort(), [
		["badge", "x"],
		["badge", "y"],
		["card", "x"],
		["card", "y"],
	]);
	// ...and here the theory variables *are* minted, which is what makes their
	// absence in the distance-only document above a claim rather than a quirk of
	// the reader.
	assert.equal(hasTheoryVar(atoms, "card"), true);
	assert.equal(hasTheoryVar(atoms, "badge"), true);
});

test("a child of a stack is held too, which gpos alone would have missed", async () => {
	// Written against `gpos/2` this would have been empty: a node in a stack is
	// placed by the layout equations and reaches the answer through `lslot/3`,
	// never through `gpos/2`. The sketch layer would then have treated the child
	// as free and moved it out of its slot while the row still claimed to
	// arrange it.
	const scene = scened(
		[
			at("row", { x: 0, y: 0, w: 400, h: 120 }, {
				kind: "frame",
				layout: makeLayout({ direction: "row" }),
				children: [
					at("one", { x: 0, y: 0, w: 60, h: 60 }),
					at("two", { x: 0, y: 0, w: 60, h: 60 }),
				],
			}),
			at("badge", { x: 300, y: 300, w: 40, h: 40 }),
		],
		[
			rule({
				id: "apart",
				kind: "distance",
				nodes: ["one", "badge"],
				value: dimension(px(120)),
			}),
		],
	);
	const atoms = await answer(scene);
	assert.deepEqual(of(atoms, "sksolved").sort(), [["badge"], ["one"]]);
	assert.deepEqual(of(atoms, "skheld").sort(), [
		["one", "x"],
		["one", "y"],
	]);
});

test("the switch decides what holds, never which unknowns exist", async () => {
	// Read exactly as `gsolved/1` is read. `sksolved/1` and `skheld/2` are blind
	// to `active/1`, so turning a rule off does not change which coordinates the
	// sketch layer is responsible for — only whether the relation is asserted.
	const scene = scened(twoBoxes(), [
		rule({
			id: "apart",
			kind: "distance",
			nodes: ["card", "badge"],
			value: dimension(px(120)),
		}),
	]);
	const { program, guards } = compile(scene);
	const session = await directSolver.open(program, "--project");
	try {
		const out = await session.solve({
			models: 1,
			assumptions: [
				...guards.map((atom) => ({ atom, sign: false })),
				{ atom: PULL_ATOM },
				{ atom: SCENERY_ATOM },
			],
		});
		assert.equal(out.result, "SATISFIABLE");
		const atoms = out.models[0] ?? [];
		assert.deepEqual(of(atoms, "skon"), []);
		assert.deepEqual(of(atoms, "sksolved").sort(), [["badge"], ["card"]]);
	} finally {
		await session.close();
	}
});

/* ------------------------------------------------------------------ */
/* 6. Quiet, either way                                                */
/* ------------------------------------------------------------------ */

test("a sketch document is as clean as every other, so a badge means your rule", async () => {
	// The reason the `#show`s live in the gated block rather than in the
	// unconditional `output` section. This app surfaces clingo's "#show for a
	// predicate nothing derives" info message in the power panel, so seven
	// unconditional ones would put seven diagnostics nobody wrote into every
	// document in the tool — and, once they are gated, a `collinear` that heads
	// neither `sk_length/2` nor `sk_angle/2` must still be silent, because both
	// have a rule even where no fact reaches it.
	for (const c of [
		rule({
			id: "apart",
			kind: "distance",
			nodes: ["card", "badge"],
			value: dimension(px(120)),
		}),
		rule({ id: "lean", kind: "bearing", nodes: ["card", "badge"], value: single("30deg") }),
		rule({ id: "row", kind: "collinear", nodes: ["card", "badge", "tag"] }),
	]) {
		const scene = scened([...twoBoxes(), at("tag", { x: 400, y: 80, w: 30, h: 30 })], [c]);
		const { diagnostics } = await explore(scene, directSolver, {
			limit: 2,
			sample: "first",
		});
		assert.equal(diagnostics, "", `${c.kind}: ${diagnostics}`);
	}
});

/* ------------------------------------------------------------------ */
/* 7. The contract                                                     */
/* ------------------------------------------------------------------ */

test("the contract names every predicate the sketch layer puts in the program", () => {
	// The CONTRACT block is what a designer reads in the power panel before
	// writing a rule, so a predicate the program derives and the contract does
	// not name is a predicate nobody can find. A drift guard rather than a prose
	// check: the list below is read off the emission and the rules in
	// `compile.ts`, and the moment one gains a predicate without gaining a line
	// there, this fails and says which.
	const sketch = [
		"skind",
		"sknode",
		"skcon",
		"skon",
		"skanchor",
		"skpoint",
		"sknopoint",
		"skoffcentre",
		"sksolved",
		"skheld",
		"skmember",
		"sk_length",
		"sk_angle",
		"c_anchor",
	];
	for (const predicate of sketch) {
		assert.ok(
			CONTRACT.includes(predicate),
			`the contract never mentions ${predicate}, so nobody can find it`,
		);
	}
	// And the sentence the whole section rests on, which a later edit is most
	// likely to soften into something that is no longer a promise.
	assert.match(CONTRACT, /a sketch rule carries no &sum/);
});

test("the contract stopped saying the third axis has no edges", () => {
	// False since the third axis landed: EDGES carries five z rows and EDGE_FACTS
	// emits all five behind `:- spatial.` A rule-writer reading the contract was
	// being told they do not exist.
	assert.equal(CONTRACT.includes("there are none yet"), false);
	assert.ok(CONTRACT.includes("gedge(E, x|y|z, pos|span|axis)"));
});
