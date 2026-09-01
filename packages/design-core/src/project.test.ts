import assert from "node:assert/strict";
import { test } from "node:test";

import { setUnit } from "./edits.ts";
import { pointsBounds } from "./geometry.ts";
import {
	createProject,
	findProject,
	normalizeScene,
	sortProjects,
	uniqueProjectName,
} from "./project.ts";
import {
	CHILD_PROPS,
	CONTAINER_PROPS,
	DEFAULT_EASING,
	DEFAULT_FRAME,
	DIMENSIONS,
	GUIDE_PROPS,
	GUIDE_PROP_NAMES,
	LAYOUT_PROPS,
	PROPS,
	type PropName,
	type Scene,
	type SceneNode,
	constraintValue,
	dimension,
	easingOf,
	emptyScene,
	frameDim,
	frameOf,
	guideAt,
	guideCount,
	guideLength,
	guideLines,
	isGridded,
	layoutLength,
	stateTouches,
	turnMdeg,
} from "./scene.ts";
import { TEMPLATES } from "./templates/index.ts";
import { EMU_PER_PX, UNIT_NAMES, UNITS, emuOf } from "./units.ts";
import {
	type Value,
	type ValueType,
	isLengthType,
	lit,
	msOf,
	single,
} from "./values.ts";

const P = EMU_PER_PX;

const at = (n: number) => ({ now: n });

test("createProject seeds a default scene and timestamps", () => {
	const p = createProject({ id: "a", name: "Kiln", ...at(100) });
	assert.equal(p.id, "a");
	assert.equal(p.name, "Kiln");
	assert.equal(p.createdAt, 100);
	assert.equal(p.updatedAt, 100);
	assert.ok(p.scene.tokens.length > 0);
	assert.equal(p.scene.nodes.length, 1, "a new document has one frame");
	assert.equal(p.scene.nodes[0].kind, "frame");
});

test("createProject falls back to Untitled for blank names", () => {
	assert.equal(createProject({ id: "a", name: "   " }).name, "Untitled");
	assert.equal(createProject({ id: "b" }).name, "Untitled");
});

test("uniqueProjectName avoids collisions", () => {
	const list = [
		createProject({ id: "1", name: "Untitled" }),
		createProject({ id: "2", name: "Untitled 2" }),
	];
	assert.equal(uniqueProjectName([]), "Untitled");
	assert.equal(uniqueProjectName(list), "Untitled 3");
	assert.equal(uniqueProjectName(list, "Kiln"), "Kiln");
});

test("sortProjects lists most recently updated first", () => {
	const list = [
		createProject({ id: "old", ...at(10) }),
		createProject({ id: "new", ...at(30) }),
		createProject({ id: "mid", ...at(20) }),
	];
	assert.deepEqual(sortProjects(list).map((p) => p.id), ["new", "mid", "old"]);
});

test("findProject handles a missing or undefined id", () => {
	const list = [createProject({ id: "a" })];
	assert.equal(findProject(list, "a")?.id, "a");
	assert.equal(findProject(list, "b"), undefined);
	assert.equal(findProject(list, undefined), undefined);
});

test("normalizeScene fills every missing field", () => {
	const s = normalizeScene({});
	assert.ok(s.tokens.length > 0, "a document always has its starter variables");
	assert.deepEqual(frameOf(s.nodes[0]), { x: 0, y: 0, ...DEFAULT_FRAME });
	assert.equal(s.nodes.length, 1);
	assert.equal(typeof s.rules, "string");
});

test("a legacy artboard is migrated, and nonsense dimensions fall back", () => {
	// Its two numbers were pixels — the document is older than frames, let alone
	// units — so they cross into EMU beside a fallback that is already EMU.
	assert.deepEqual(
		frameOf(
			normalizeScene({ artboard: { width: 900, height: 500 }, nodes: [] }).nodes[0],
		),
		{ x: 0, y: 0, width: 900 * P, height: 500 * P },
	);
	assert.deepEqual(
		frameOf(normalizeScene({ artboard: { width: "wide", height: null } }).nodes[0]),
		{ x: 0, y: 0, ...DEFAULT_FRAME },
	);
	assert.equal(normalizeScene("nope").rules, emptyScene().rules);
});

test("a stored geometric constraint survives a round trip, garbage does not", () => {
	const good = {
		id: "k1",
		kind: "pin",
		prop: "fill",
		nodes: ["a"],
		edge: "centerX",
		value: 120,
		enabled: true,
	};
	const scene = normalizeScene({
		constraints: [
			good,
			// A rule naming an edge nothing understands would compile into a fact
			// no rule matches, and read as a solver bug from the outside.
			{ ...good, id: "k2", edge: "sideways" },
			{ ...good, id: "k3", value: "twelve" },
		],
	});
	assert.deepEqual(
		scene.constraints.map((c) => c.id),
		["k1"],
	);
	assert.equal(scene.constraints[0].edge, "centerX");
	// Stored as a bare number before a dimension could name a token; read back
	// as the value it now is, so nothing downstream has two shapes to handle.
	// The number was pixels, and 120 EMU is not 120 pixels — it is a hundredth
	// of one, which is what makes this the migration's business.
	assert.deepEqual(scene.constraints[0].value, dimension(120 * P));
});

test("a layout stored as plain numbers and words reads back as values", () => {
	const scene = normalizeScene({
		tokens: [],
		nodes: [
			{
				id: "box",
				kind: "frame",
				name: "Box",
				frame: { x: 0, y: 0, width: 100, height: 100 },
				props: {},
				layout: { direction: "column", gap: 24, padding: 8 },
				children: [
					{
						id: "kid",
						kind: "rect",
						name: "Kid",
						frame: { x: 0, y: 0, width: 10, height: 10 },
						props: {},
						grow: true,
						alignSelf: "center",
					},
				],
			},
		],
		constraints: [],
		rules: "",
	});
	const box = scene.nodes[0];
	assert.deepEqual(box.layout?.direction, [{ kind: "literal", value: "column" }]);
	assert.deepEqual(box.layout?.gap, [{ kind: "literal", value: "24px" }]);
	assert.deepEqual(
		box.layout?.justify,
		[{ kind: "literal", value: "start" }],
		"a setting stored before it existed takes the table's default",
	);
	const kid = box.children?.[0];
	assert.deepEqual(kid?.grow, [{ kind: "literal", value: "grow" }]);
	assert.deepEqual(kid?.alignSelf, [{ kind: "literal", value: "center" }]);
});

test("a child that was never singled out stays that way", () => {
	const scene = normalizeScene({
		tokens: [],
		nodes: [
			{
				id: "box",
				kind: "frame",
				name: "Box",
				frame: { x: 0, y: 0, width: 100, height: 100 },
				props: {},
				layout: {},
				children: [
					{
						id: "kid",
						kind: "rect",
						name: "Kid",
						frame: { x: 0, y: 0, width: 10, height: 10 },
						props: {},
						grow: false,
					},
				],
			},
		],
		constraints: [],
		rules: "",
	});
	const kid = scene.nodes[0].children?.[0];
	assert.equal(kid?.grow, undefined, "a cleared checkbox is nothing at all");
	assert.ok(!("grow" in (kid as object)));
});

/* ------------------------------------------------------------------ */
/* Margins, a grid, and lines drawn by hand                            */
/* ------------------------------------------------------------------ */

/** A surface with a grid and two guides on it, as a document stores one. */
const ruled = (node: Record<string, unknown> = {}) => ({
	tokens: [],
	nodes: [
		{
			id: "page",
			kind: "frame",
			name: "Page",
			frame: { x: [lit("0px")], y: [lit("0px")], width: [lit("960px")], height: [lit("640px")] },
			props: {},
			guides: {
				marginLeft: [lit("48px")],
				marginRight: [lit("48px")],
				columns: [lit("12"), lit("6")],
				gutter: [lit("24px")],
			},
			lines: [
				{ id: "fold", axis: "y", at: [lit("600px")], locked: true },
				{ id: "eye", axis: "x", at: [lit("0.25in")] },
			],
			...node,
		},
	],
	constraints: [],
	rules: "",
	unit: "px",
});

test("a document with no guides opens with none, and is given none", () => {
	// Absence is what "no grid" means, so a reader that filled the table in would
	// rule every artboard ever drawn with a grid nobody asked for — and hand the
	// compiler one to emit for every document in the world.
	const scene = normalizeScene({ ...ruled(), nodes: [] });
	const page = scene.nodes[0];
	assert.equal(page.guides, undefined);
	assert.equal(page.lines, undefined);
	assert.equal(isGridded(page), false);
	assert.ok(!("guides" in page) && !("lines" in page));
});

test("a grid stored as plain numbers and words reads back as values", () => {
	const scene = normalizeScene(
		ruled({ guides: { marginTop: 40, columns: 12, gutter: "1pc" } }),
	);
	const page = scene.nodes[0];
	assert.ok(isGridded(page));
	// A bare number in a length is the pixels every document has always meant by
	// one; a bare number in a count is twelve columns, not twelve pixels' worth.
	assert.equal(guideLength(page, "marginTop"), 40 * P);
	assert.equal(guideCount(page, "columns"), 12);
	assert.equal(guideLength(page, "gutter"), 16 * P);
	// A setting stored before it existed takes the table's default, exactly as a
	// layout's does.
	assert.deepEqual(page.guides?.rows, single(GUIDE_PROPS.rows.fallback));
	for (const prop of GUIDE_PROP_NAMES) {
		assert.ok(page.guides?.[prop], `${prop} came back unset`);
	}
});

test("a line that could not reach the program is dropped, and the page is not", () => {
	const scene = normalizeScene(
		ruled({
			lines: [
				// Every one of these is a line that would compile into a datum term
				// the program cannot hold: an id that is not a constant, a second
				// line answering to a name already taken on this surface, an axis
				// that is neither of the two, and a thing that is not a line at all.
				{ id: "Fold Line", axis: "y", at: [lit("600px")] },
				{ id: "eye", axis: "x", at: [lit("40px")] },
				{ id: "eye", axis: "y", at: [lit("80px")] },
				{ id: "skew", axis: "z", at: [lit("40px")] },
				"nonsense",
				// A position that reads as nothing is *not* one of them: it takes
				// the origin, exactly as a frame dimension does.
				{ id: "loose", axis: "x" },
			],
		}),
	);
	const page = scene.nodes[0];
	assert.deepEqual(
		guideLines(page).map((g) => g.id),
		["eye", "loose"],
		"the artboard survives whatever was drawn on it",
	);
	assert.equal(guideAt(page, guideLines(page)[0]), 40 * P);
	assert.equal(guideAt(page, guideLines(page)[1]), 0);

	// No lines left is no lines at all — one spelling for the empty case rather
	// than two, so nothing downstream has to tell them apart.
	const bare = normalizeScene(ruled({ lines: [] }));
	assert.equal(bare.nodes[0].lines, undefined);
	assert.equal(normalizeScene(ruled({ lines: "yes" })).nodes[0].lines, undefined);
	// And a `guides` that is not a record loses the grid rather than gaining a
	// default one, which is the same judgement the other way round.
	assert.equal(normalizeScene(ruled({ guides: 4 })).nodes[0].guides, undefined);
});

test("guides come back exactly as they went in, however often the file is opened", () => {
	const once = normalizeScene(ruled());
	const page = once.nodes[0];
	assert.equal(guideLength(page, "marginLeft"), 48 * P);
	assert.equal(guideCount(page, "columns"), 12);
	assert.equal(
		guideCount(page, "columns", { tokens: [], picks: { "gval(page,columns)": 1 } }),
		6,
		"a responsive grid keeps both of its answers",
	);
	assert.equal(guideAt(page, guideLines(page)[0]), 600 * P);
	assert.equal(guideLines(page)[0].locked, true);
	// A lock is a fact about the guide; whether guides are *shown* is a fact
	// about the person looking and never reaches the document at all.
	assert.equal("locked" in guideLines(page)[1], false);

	const twice = normalizeScene(JSON.parse(JSON.stringify(once)));
	assert.deepEqual(twice, once);
});

test("the lattice sweep reaches a margin and a guide", () => {
	// The sweep is over the `length` quantity wherever it is held, not over the
	// places lengths have historically been found — so a grid written by hand in
	// half-pixels is snapped like anything else, and a count is not touched.
	const scene = normalizeScene(
		ruled({
			guides: { marginLeft: [lit("20.5px")], columns: [lit("12")] },
			lines: [{ id: "fold", axis: "y", at: [lit("20.5px")] }],
		}),
	);
	const page = scene.nodes[0];
	assert.deepEqual(page.guides?.marginLeft, single("20.52px"));
	assert.deepEqual(page.guides?.columns, single("12"));
	assert.equal(guideAt(page, guideLines(page)[0]), 195453);
});

/* ------------------------------------------------------------------ */
/* Opening a document written before geometry was EMU                  */
/* ------------------------------------------------------------------ */

/**
 * A document as the release before EMU wrote one, with one of every shape the
 * migration has to answer for: lengths as unit-suffixed strings, a frame and a
 * layout setting and a constraint's dimension as bare numbers, a path's
 * vertices as bare numbers, a ratio that must not be mistaken for a length, and
 * no unit stamp anywhere.
 *
 * A plain object rather than a `Scene`, deliberately: the whole point is that
 * this is not the shape this code writes, and typing it as one would let a
 * field added later appear in it without anyone noticing.
 */
const written = () => ({
	tokens: [
		{ id: "gutter", name: "gutter", type: "length", value: [lit("24px")] },
		// A spacing scale a designer typed in halves. Half a pixel is 4762.5 EMU
		// and 9525 is odd, so it is not a length at all — and a token is shared,
		// so it is the one value that can go missing everywhere at once.
		{ id: "rhythm", name: "rhythm", type: "length", value: [lit("20.5px")] },
		{ id: "ink", name: "ink", type: "color", value: [lit("#0f172a")] },
	],
	styles: [
		{
			id: "body",
			name: "Body",
			variants: [
				{ name: "Compact", parts: { size: lit("15px"), lineHeight: lit("1.35") } },
			],
		},
	],
	nodes: [
		{
			id: "page",
			kind: "frame",
			name: "Page",
			frame: { x: [lit("40px")], y: [lit("40px")], width: [lit("720px")], height: [lit("480px")] },
			props: {},
			layout: { direction: "row", gap: 24, padding: "16px" },
			children: [
				// The oldest shape of all: four bare numbers, from before a
				// dimension could hold alternatives.
				{
					id: "crumb",
					kind: "rect",
					name: "Crumb",
					frame: { x: 12, y: 8, width: 96, height: 24 },
					props: {},
					grow: true,
				},
				{
					id: "plate",
					kind: "rect",
					name: "Plate",
					frame: {
						x: [{ kind: "token", token: "gutter" }],
						y: [lit("20.5px")],
						width: [lit("120px")],
						height: [lit("18pt")],
					},
					props: { radius: [lit("8px")], opacity: [lit("0.5")] },
					style: "body",
				},
				{
					id: "shape",
					kind: "path",
					name: "Shape",
					frame: { x: 200, y: 200, width: 100, height: 80 },
					props: {},
					closed: true,
					points: [
						{ x: 0, y: 0 },
						{ x: 100, y: 0, in: { x: -10, y: 0 } },
						{ x: 100, y: 80 },
						{ x: 0, y: 80 },
					],
				},
			],
		},
	],
	constraints: [
		{
			id: "k_pin",
			kind: "pin",
			prop: "fill",
			nodes: ["plate"],
			edge: "left",
			value: 120,
			enabled: true,
		},
		{
			id: "k_gap",
			kind: "gap",
			prop: "fill",
			nodes: ["crumb", "plate"],
			edge: "x",
			value: [lit("20.5px")],
			enabled: true,
		},
	],
	rules: "",
});

const childOf = (scene: Scene, id: string): SceneNode => {
	const found = scene.nodes[0].children?.find((n) => n.id === id);
	assert.ok(found, `${id} survived the read`);
	return found;
};

test("a document written in pixels opens at exactly the geometry it was drawn at", () => {
	const scene = normalizeScene(written());
	const context = { tokens: scene.tokens, picks: {} };

	// The claim the whole change rests on: a px string means the same distance
	// it always did, so the only arithmetic here is 1px = 9525 EMU.
	assert.deepEqual(frameOf(scene.nodes[0]), {
		x: 40 * P,
		y: 40 * P,
		width: 720 * P,
		height: 480 * P,
	});
	// Four bare numbers, which were pixels and could not have been anything else.
	assert.deepEqual(frameOf(childOf(scene, "crumb")), {
		x: 12 * P,
		y: 8 * P,
		width: 96 * P,
		height: 24 * P,
	});
	// A dimension that names a token still comes back through it.
	assert.equal(frameDim(childOf(scene, "plate"), "x", context), 24 * P);
	// 18pt is a quarter of an inch, which is 24px, which is what it always was.
	assert.equal(frameDim(childOf(scene, "plate"), "height", context), 24 * P);
	// A gap stored as a bare number and a padding stored as a string are one
	// kind of number now.
	assert.equal(layoutLength(scene.nodes[0], "gap"), 24 * P);
	assert.equal(layoutLength(scene.nodes[0], "padding"), 16 * P);
	// A rule's dimension, from before it could name a token. 120 EMU is a
	// hundredth of a pixel, so reading it as EMU would quietly move the plate
	// to the left edge.
	assert.equal(constraintValue(scene, scene.constraints[0]), 120 * P);
});

test("a length no unit can spell is snapped once, where it would have read as nothing", () => {
	const scene = normalizeScene(written());

	// The value the migration exists for: half a pixel is 4762.5 EMU, so
	// "20.5px" is not a length, `emuOf` says nothing, and `frameDim` would fall
	// back to the program's own `frame(N,A,0)` — the node at the origin.
	assert.equal(emuOf("20.5px"), undefined);

	const plate = childOf(scene, "plate");
	assert.deepEqual(plate.frame.y, single("20.52px"));
	assert.equal(frameDim(plate, "y"), 195453);
	// Two hundredths of a pixel, and written down where a designer can see it
	// rather than lost inside a reader.
	assert.ok(Math.abs(195453 - 20.5 * P) <= P / 50);

	// The snap rounds to the nearest EMU before it snaps, and what makes that
	// free is that every lattice step is odd: a midpoint then falls exactly
	// halfway between two integers, so rounding to the nearest one never crosses
	// it. If a step ever became even the pre-round could move a value across a
	// midpoint and this would be the migration answering a hair differently.
	for (const unit of UNIT_NAMES) {
		assert.equal(UNITS[unit].step % 2, 1, `${unit} has an even step`);
	}

	// Everywhere else the same value could be hiding: a shared token, and a
	// rule's dimension.
	assert.deepEqual(
		scene.tokens.find((t) => t.id === "rhythm")?.value,
		single("20.52px"),
	);
	assert.equal(constraintValue(scene, scene.constraints[1]), 195453);
});

test("a ratio is not a length, and a sweep that guessed would say it was", () => {
	const scene = normalizeScene(written());

	// Read as pixels, 1.35 is 12858.75 EMU, off the lattice, and would come back
	// as "1.36" — a leading nobody typed, on every node wearing the style. The
	// type is what stops it: `lineHeight` is a ratio in the same table the
	// compiler reads.
	assert.deepEqual(scene.styles[0].variants[0].parts.lineHeight, lit("1.35"));
	assert.deepEqual(scene.styles[0].variants[0].parts.size, lit("15px"));
	assert.deepEqual(childOf(scene, "plate").props.opacity, single("0.5"));
});

test("a path's vertices cross with the frame that bounds them", () => {
	const scene = normalizeScene(written());
	const shape = childOf(scene, "shape");

	// Vertices are the one geometry stored as bare numbers rather than as length
	// text, so they are the one thing the marker is needed for. The law is that
	// they and the frame describe the same box: leave them behind and the shape
	// is a ten-thousandth of the outline the canvas draws.
	assert.deepEqual(shape.points?.[2], { x: 100 * P, y: 80 * P });
	assert.deepEqual(shape.points?.[1].in, { x: -10 * P, y: 0 });
	const bounds = pointsBounds(shape.points ?? []);
	assert.equal(bounds?.width, frameDim(shape, "width"));
	assert.equal(bounds?.height, frameDim(shape, "height"));
});

test("a document is migrated once, however many times it is opened", () => {
	// The store normalises on every load and writes back whatever moved, so a
	// migration that answered differently the second time would walk the
	// document a little further away every time somebody opened it.
	const once = normalizeScene(written());
	const twice = normalizeScene(JSON.parse(JSON.stringify(once)));
	assert.deepEqual(twice, once);
	assert.equal(once.unit, "px");
});

test("the unit a document states is what marks it as an EMU one", () => {
	assert.equal(normalizeScene({}).unit, "px");
	assert.equal(normalizeScene({ unit: "mm" }).unit, "mm");
	// A unit no table row names would leave the inspector with nothing to show.
	assert.equal(normalizeScene({ unit: "furlong" }).unit, "px");

	// The same document, but stamped: its vertices are already EMU and must not
	// cross a second time.
	const stamped = normalizeScene({ ...written(), unit: "px" });
	assert.deepEqual(stamped.nodes[0].children?.[2].points?.[2], { x: 100, y: 80 });

	// A template is written by this code, so it is stamped rather than read.
	const made = createProject({ id: "p", scene: { ...emptyScene(), unit: undefined } });
	assert.equal(made.scene.unit, "px");
});

test("changing the display unit cannot un-mark a document", () => {
	// The inspector's unit menu is the only other writer of the field, and the
	// marker is what keeps a migrated document from being migrated again — so
	// the one thing `setUnit` must never do is take it away.
	const opened = normalizeScene(written());
	const metric = setUnit(opened, "mm");
	assert.equal(metric.unit, "mm");
	assert.equal(setUnit(metric, "mm"), metric, "an unchanged unit is not an edit");

	// And it changes no value: a display unit governs no read, so the geometry
	// of the document is the same document's geometry afterwards.
	assert.deepEqual(metric.nodes, opened.nodes);
	assert.deepEqual(normalizeScene(metric), metric);
});

/** Every literal in the document that its type says is a length. */
function lengthsIn(scene: Scene): Array<[string, string]> {
	const out: Array<[string, string]> = [];
	const take = (where: string, value: Value | undefined, type: ValueType) => {
		if (!value || !isLengthType(type)) return;
		for (const term of value) {
			if (term.kind === "literal") out.push([where, term.value]);
		}
	};
	for (const token of scene.tokens) take(`token ${token.id}`, token.value, token.type);
	for (const style of scene.styles) {
		for (const variant of style.variants) {
			for (const [prop, term] of Object.entries(variant.parts)) {
				take(`style ${style.id}.${prop}`, [term], PROPS[prop as PropName].type);
			}
		}
	}
	for (const rule of scene.constraints) take(`rule ${rule.id}`, rule.value, "length");
	const walk = (node: SceneNode) => {
		for (const dim of DIMENSIONS) take(`${node.id}.${dim}`, node.frame[dim], "length");
		for (const [prop, value] of Object.entries(node.props)) {
			take(`${node.id}.${prop}`, value, PROPS[prop as PropName].type);
		}
		for (const prop of CONTAINER_PROPS) {
			take(`${node.id} ${prop}`, node.layout?.[prop], LAYOUT_PROPS[prop].type);
		}
		for (const prop of CHILD_PROPS) {
			take(`${node.id} ${prop}`, node[prop], LAYOUT_PROPS[prop].type);
		}
		for (const prop of GUIDE_PROP_NAMES) {
			take(`${node.id} ${prop}`, node.guides?.[prop], GUIDE_PROPS[prop].type);
		}
		for (const guide of guideLines(node)) {
			take(`${node.id} guide ${guide.id}`, guide.at, "length");
		}
		for (const child of node.children ?? []) walk(child);
	};
	for (const node of scene.nodes) walk(node);
	return out;
}

test("nothing a migrated document calls a length is unreadable", () => {
	// The law, swept rather than spot-checked: after the read, every literal the
	// tables say is a length is one `emuOf` can read. A value that fails this is
	// not a wrong number, it is a property that silently says nothing at all —
	// and the readers are exact-or-nothing precisely so that the answer has to
	// be made right here instead.
	const scene = normalizeScene(written());
	const found = lengthsIn(scene);
	assert.ok(found.length >= 12, "the sweep reached the whole document");
	for (const [where, text] of found) {
		assert.notEqual(emuOf(text), undefined, `${where} holds "${text}"`);
	}

	// The same law over the settings a page is ruled with, which are lengths in
	// the same table and are read by the same exact-or-nothing reader.
	const ruled = lengthsIn(
		normalizeScene({
			...written(),
			nodes: [
				{
					...written().nodes[0],
					guides: { marginLeft: [lit("20.5px")], gutter: [lit("1.5px")] },
					lines: [{ id: "fold", axis: "y", at: [lit("20.5px")] }],
				},
			],
		}),
	);
	assert.ok(
		ruled.some(([where]) => where.endsWith("marginLeft")) &&
			ruled.some(([where]) => where.includes("guide fold")),
		"the sweep reached the guides",
	);
	for (const [where, text] of ruled) {
		assert.notEqual(emuOf(text), undefined, `${where} holds "${text}"`);
	}
});

/* ------------------------------------------------------------------ */
/* Machines                                                            */
/* ------------------------------------------------------------------ */

/**
 * A document with a two-state machine on a component definition, as a document
 * stores one.
 *
 * A plain object rather than a `Scene`, for the reason {@link written} is one:
 * the point of a reader is what it does with shapes this code did not write,
 * and typing the fixture would let the type checker answer the questions the
 * test is asking.
 */
const wired = (machine: Record<string, unknown> = {}) => ({
	tokens: [],
	styles: [],
	nodes: [
		{
			id: "btn",
			kind: "frame",
			name: "Button",
			frame: { x: 0, y: 0, width: 120, height: 40 },
			props: { fill: [lit("#2563eb")] },
			component: true,
			children: [
				{
					id: "label",
					kind: "text",
					name: "Label",
					frame: { x: 12, y: 10, width: 96, height: 20 },
					props: { text: [lit("Save")] },
				},
			],
		},
		{
			id: "b1",
			kind: "instance",
			name: "Button 1",
			frame: { x: 400, y: 40, width: 120, height: 40 },
			props: {},
			instanceOf: "btn",
			state: "hover",
		},
	],
	constraints: [],
	rules: "",
	unit: "px",
	machines: [
		{
			id: "m1",
			name: "Button",
			root: "btn",
			states: [
				{ id: "rest", name: "Rest", parts: {} },
				{
					id: "hover",
					name: "Hover",
					parts: {
						btn: { props: { fill: [lit("#1d4ed8")] } },
						label: { frame: { y: [lit("8px")] } },
					},
				},
			],
			transitions: [
				{
					id: "over",
					from: "rest",
					to: "hover",
					trigger: "pointerenter",
					duration: [lit("200ms")],
					easing: "easeOut",
					enabled: true,
				},
				{
					id: "out",
					from: "hover",
					to: "rest",
					trigger: "pointerleave",
					enabled: true,
				},
			],
			...machine,
		},
	],
});

test("a document written before machines existed reads back with none", () => {
	// Which is what every document written before them *was* — the same answer
	// the styles get, and for the same reason: absence is not a malformed
	// machine, it is a component with no behaviour, which is what every
	// component in every document already is.
	assert.deepEqual(normalizeScene({}).machines, []);
	assert.deepEqual(normalizeScene({ machines: "soon" }).machines, []);
	assert.deepEqual(emptyScene().machines, []);
});

test("a machine survives a round trip whole", () => {
	const scene = normalizeScene(wired());
	assert.equal(scene.machines.length, 1);
	const m = scene.machines[0];
	assert.deepEqual(
		m.states.map((s) => s.id),
		["rest", "hover"],
		"the order is the answer: the first state is the initial one",
	);
	assert.deepEqual(m.states[1].parts.btn.props?.fill, [lit("#1d4ed8")]);
	// A delta's frame is per dimension, and the dimensions it says nothing about
	// stay unsaid — unlike a node's frame, which is defaulted to all four,
	// because the program's guard is per dimension and silence is what lets the
	// instance's own width through.
	assert.deepEqual(Object.keys(m.states[1].parts.label.frame ?? {}), ["y"]);
	assert.equal(m.transitions[0].trigger, "pointerenter");
	assert.equal(m.transitions[0].easing, "easeOut");
	assert.deepEqual(m.transitions[0].duration, [lit("200ms")]);
	assert.equal(m.transitions[1].duration, undefined, "absent takes the table's");
	// The instance's drawn state is a decision about this use of the definition,
	// and it comes back untouched.
	assert.equal(scene.nodes[1].state, "hover");
});

test("a machine the program could not hold is dropped, the document is not", () => {
	const scene = normalizeScene({
		...wired(),
		machines: [
			// An id that is not an ASP constant is not a badly named machine, it
			// is `machine(My Machine)` in the generated text and a syntax error
			// that takes the whole document down with it.
			{ ...wired().machines[0], id: "My Machine" },
			// A machine with no states has no initial state, so `minitial/2` is
			// empty and every instance of the definition is drawn in no state at
			// all — the shape a `Style` with no variants has, and the same call.
			{ ...wired().machines[0], id: "m0", states: [] },
			{ ...wired().machines[0], id: "m2", states: "none" },
			// A root that is not a string at all: `machine_of(M,R)` has nothing to
			// join `instance(I,R)` against.
			{ ...wired().machines[0], id: "m3", root: 7 },
			"nonsense",
			wired().machines[0],
			// Two machines answering to one name are one machine as far as the
			// solver is concerned, and which one it turns out to be is whichever
			// fact grounds last.
			{ ...wired().machines[0], name: "Impostor" },
		],
	});
	assert.deepEqual(
		scene.machines.map((m) => m.id),
		["m1"],
	);
	assert.equal(scene.machines[0].name, "Button", "the first of a name wins");
	assert.equal(scene.nodes.length, 2, "the document outlives the machine");

	// A root naming a node the document has not got is *kept*, which is the
	// twin of a dangling `instanceOf`: it says nothing rather than failing, and
	// a definition released and re-made brings its machine back with it.
	const orphan = normalizeScene({
		...wired(),
		machines: [{ ...wired().machines[0], root: "gone" }],
	});
	assert.equal(orphan.machines[0].root, "gone");
});

test("a state id is unique in its machine, and the first of a name wins", () => {
	const scene = normalizeScene(
		wired({
			states: [
				{ id: "rest", name: "Rest", parts: {} },
				// Dropping the *first* instead could change which state a machine
				// starts in, and a reader that can re-point a machine's initial
				// state is a reader that changes what every instance draws.
				{ id: "rest", name: "Impostor", parts: {} },
				{ id: "Hover State", name: "Hover", parts: {} },
				{ id: 4, name: "Four", parts: {} },
				{ id: "hover", name: "Hover", parts: {} },
			],
		}),
	);
	assert.deepEqual(
		scene.machines[0].states.map((s) => `${s.id}:${s.name}`),
		["rest:Rest", "hover:Hover"],
	);
});

test("a transition naming a state the machine has not got is kept", () => {
	// `mdangling/2` exists to report exactly this, the Machines panel offers a
	// canned rule that forbids it by name, and a reader that deleted the edge
	// would take away both the symptom and any way of finding out.
	const scene = normalizeScene(
		wired({
			transitions: [
				{ id: "away", from: "rest", to: "gone", trigger: "click", enabled: true },
				// These three are different: none of them could reach the program
				// as the thing it claims to be. An id that is not a constant names
				// `mtrans(M,T)` and three variable keys; a `from` that is not one
				// names something no state could ever be called, so it is a syntax
				// error rather than a dangling reference; and a trigger the table
				// has not got is a fact no rule matches and no browser fires.
				{ id: "Bad Id", from: "rest", to: "hover", trigger: "click", enabled: true },
				{ id: "loose", from: "Not A State", to: "hover", trigger: "click", enabled: true },
				{ id: "swipe", from: "rest", to: "hover", trigger: "longpress", enabled: true },
				{ id: "away", from: "hover", to: "rest", trigger: "click", enabled: true },
			],
		}),
	);
	assert.deepEqual(
		scene.machines[0].transitions.map((t) => t.id),
		["away"],
	);
	assert.equal(scene.machines[0].transitions[0].to, "gone");
});

test("a transition's pacing is normalised, and only its trigger is load-bearing", () => {
	const scene = normalizeScene(
		wired({
			transitions: [
				{
					id: "press",
					from: "rest",
					to: "hover",
					trigger: "pointerdown",
					// Stored before a motion setting was a value, and as the two
					// other shapes `settingValue` has always read.
					duration: "120ms",
					delay: 0,
					stagger: [lit("40ms")],
					// An easing the table has not got falls back rather than losing
					// the transition: a trigger decides *whether* the machine ever
					// moves, while an easing is only the shape of the curve.
					easing: "bouncy",
					only: ["fill", "sideways", 7],
					enabled: false,
				},
			],
		}),
	);
	const t = scene.machines[0].transitions[0];
	assert.deepEqual(t.duration, single("120ms"));
	// A bare number in a duration stays a bare number: `msOf` refuses it as
	// ambiguous by a factor of a thousand, so the transition falls to the
	// table's default rather than to a unit somebody guessed.
	assert.deepEqual(t.delay, single("0"));
	assert.equal(msOf("0"), 0, "except zero, which reads the same either way");
	assert.deepEqual(t.stagger, [lit("40ms")]);
	assert.equal(t.easing, undefined);
	assert.equal(easingOf(t), DEFAULT_EASING);
	assert.deepEqual(t.only, ["fill"]);
	assert.equal(t.enabled, false, "off keeps it in the document, out of the program");

	// Absent and empty mean different things — everything the delta touches,
	// against nothing at all — so the one that is not a list becomes absent and
	// the one that filters down to nothing stays empty.
	const loose = normalizeScene(
		wired({
			transitions: [
				{ id: "a", from: "rest", to: "hover", trigger: "click", only: "fill" },
				{ id: "b", from: "rest", to: "hover", trigger: "click", only: ["nope"] },
			],
		}),
	).machines[0].transitions;
	assert.equal(loose[0].only, undefined);
	assert.deepEqual(loose[1].only, []);
	// A transition written before the switch existed is one somebody wanted.
	assert.equal(loose[0].enabled, true);
});

test("a delta decides more than a style variant, and drops what it cannot", () => {
	const scene = normalizeScene(
		wired({
			states: [
				{ id: "rest", name: "Rest", parts: {} },
				{
					id: "busy",
					name: "Busy",
					parts: {
						label: {
							props: {
								// `text` and `opacity` are exactly the two properties a
								// style may not decide, and a state may: "the label
								// says Saving…" is what a state is *for*, while a
								// treatment several nodes wear must not put words in
								// any of their mouths.
								text: [lit("Saving…")],
								opacity: [lit("0.5")],
								// A length in a delta is one more home for the lattice
								// sweep, and one more place a half-pixel would have
								// read as no length at all.
								radius: [lit("20.5px")],
								sideways: [lit("yes")],
								size: "16px",
							},
							frame: { y: [lit("2px")], sideways: [lit("4px")] },
							hidden: false,
						},
						// A key naming a part the definition has not got is kept: the
						// materialisation analysis skips it, so it emits nothing, and
						// a part deleted and drawn again finds its delta waiting.
						ghost: { hidden: true },
						// An entry that says nothing is kept too. `clearStatePart`
						// removes one because a person asked; a reader is not being
						// asked anything, and `stateTouches` already reads an empty
						// delta and an absent one as the same claim.
						quiet: { props: { fill: [] } },
						broken: "nonsense",
					},
				},
			],
		}),
	);
	const busy = scene.machines[0].states[1];
	assert.deepEqual(Object.keys(busy.parts).sort(), ["ghost", "label", "quiet"]);
	const label = busy.parts.label;
	assert.deepEqual(label.props?.text, [lit("Saving…")]);
	assert.deepEqual(label.props?.opacity, [lit("0.5")]);
	assert.deepEqual(label.props?.radius, [lit("20.52px")]);
	assert.equal(emuOf("20.52px") !== undefined, true, "and it reads as a length now");
	assert.ok(!("sideways" in (label.props ?? {})), "a property PROPS has not got");
	assert.equal(label.props?.size, undefined, "a value that is not a list of them");
	assert.deepEqual(label.frame, { y: [lit("2px")] });
	// `true` or absent, with no `false`: a part is drawn unless a state says
	// otherwise, so a stored `false` is the same statement as silence.
	assert.equal(label.hidden, undefined);
	assert.equal(busy.parts.ghost.hidden, true);
	assert.equal(stateTouches(busy.parts.quiet), false);
	assert.equal(stateTouches(busy.parts.ghost), true);
});

test("a drawn state is a string or nothing, and is never corrected", () => {
	const scene = normalizeScene({
		...wired(),
		nodes: [
			...wired().nodes,
			{ ...wired().nodes[1], id: "b2", state: 3 },
			{ ...wired().nodes[1], id: "b3", state: "gone" },
		],
	});
	const by = (id: string) => scene.nodes.find((n) => n.id === id);
	assert.equal(by("b1")?.state, "hover");
	// The same string-or-nothing question `style` is asked, so `shownState` has
	// one shape to think about everywhere downstream.
	const b2 = by("b2");
	assert.ok(b2 && !("state" in b2));
	// But a state the machine no longer has is *kept*. `shownState` already
	// falls back to the initial one, and a reader that rewrote the field would
	// spend a real edit — one a collaborator pulls — on a question that answers
	// itself every time it is asked.
	assert.equal(by("b3")?.state, "gone");
});

test("a document with a machine is read once, however many times it is opened", () => {
	// The store normalises on every load and writes back whatever moved, so a
	// reader that answered differently the second time would walk the machine a
	// little further away every time somebody opened the file.
	const once = normalizeScene(wired());
	const twice = normalizeScene(JSON.parse(JSON.stringify(once)));
	assert.deepEqual(twice, once);

	// And the same over the document that exercises every branch above, where
	// the second read is the one that sees this reader's own output.
	const messy = normalizeScene({
		...wired({
			states: [
				{ id: "rest", name: "Rest", parts: { label: { props: { size: "16px" } } } },
				{ id: "Bad", name: "Bad", parts: {} },
			],
			transitions: [
				{ id: "away", from: "rest", to: "gone", trigger: "click" },
				{ id: "swipe", from: "rest", to: "hover", trigger: "longpress" },
			],
		}),
		nodes: [...wired().nodes, { ...wired().nodes[1], id: "b2", state: 3 }],
	});
	assert.deepEqual(normalizeScene(JSON.parse(JSON.stringify(messy))), messy);
});

/* ------------------------------------------------------------------ */
/* Reading a document that has a third axis in it                      */
/* ------------------------------------------------------------------ */

/** A page with a 3D view on it, in the shape a stored document holds one. */
const staged = (over: Record<string, unknown> = {}) => ({
	tokens: [],
	styles: [],
	machines: [],
	constraints: [],
	rules: "",
	unit: "px",
	nodes: [
		{
			id: "page",
			kind: "frame",
			name: "Page",
			frame: { x: [lit("0px")], y: [lit("0px")], width: [lit("800px")], height: [lit("600px")] },
			props: {},
			children: [
				{
					id: "view",
					kind: "viewport",
					name: "Hero",
					frame: { x: [lit("0px")], y: [lit("0px")], width: [lit("480px")], height: [lit("320px")] },
					props: {},
					camera: "cam",
					children: [
						{
							id: "cam",
							kind: "camera",
							name: "Camera",
							frame: { x: [lit("0px")], y: [lit("0px")], width: [lit("0px")], height: [lit("0px")] },
							props: {},
						},
						{
							id: "cube",
							kind: "mesh",
							name: "Cube",
							frame: { x: [lit("0px")], y: [lit("0px")], width: [lit("100px")], height: [lit("100px")] },
							props: {},
							spatial: { z: [lit("24px")], depth: [lit("40px")] },
							turn: { rotateY: [lit("22.5deg")] },
						},
					],
				},
			],
		},
	],
	...over,
});

/** The node with this id, wherever it is. */
const nodeAt = (scene: Scene, id: string): SceneNode | undefined => {
	const walk = (nodes: readonly SceneNode[]): SceneNode | undefined => {
		for (const node of nodes) {
			if (node.id === id) return node;
			const found = node.children ? walk(node.children) : undefined;
			if (found) return found;
		}
		return undefined;
	};
	return walk(scene.nodes);
};

test("a document with no imported geometry opens with no asset index at all", () => {
	// Absent rather than `{}`, so "this document holds no imported geometry" has
	// one spelling and `referencedAssets` has one shape to answer for.
	assert.equal(normalizeScene({}).assets, undefined);
	assert.equal(normalizeScene({ assets: {} }).assets, undefined);
	assert.equal(normalizeScene({ assets: "later" }).assets, undefined);
	assert.ok(!Object.hasOwn(normalizeScene({}), "assets"));
});

test("an asset index survives whole, and one bad row is one row", () => {
	const scene = normalizeScene(
		staged({
			assets: {
				"/assets/chair.glb": { format: "glb", bytes: 2048, triangles: 900, name: "Chair" },
				// No format nothing can parse, so nothing could ever read the bytes.
				"/assets/mystery.bin": { bytes: 1, triangles: 1, name: "Mystery" },
				"/assets/unnamed.gltf": { format: "gltf", bytes: 12, triangles: 4 },
				// A key with no leading slash is a content hash from before geometry
				// was a file, and it is rewritten to where those bytes are rather than
				// being dropped: an index this reader threw away would be every model
				// in the document going unnamed and unsized at once.
				h4: { format: "glb", bytes: 64, triangles: 2, name: "Legacy" },
			},
		}),
	);
	assert.deepEqual(scene.assets?.["/assets/chair.glb"], {
		format: "glb",
		bytes: 2048,
		triangles: 900,
		name: "Chair",
	});
	assert.equal(scene.assets?.["/assets/mystery.bin"], undefined, "an unparseable row is dropped");
	// A name is what a person reads and nothing else reads it, so the key stands
	// in rather than the entry being lost — and now that the key is a path, the
	// stand-in is something a person could go and look for.
	assert.equal(scene.assets?.["/assets/unnamed.gltf"].name, "/assets/unnamed.gltf");
	assert.equal(scene.assets?.h4, undefined, "a hash key is not left as a key");
	assert.equal(scene.assets?.["/assets/h4"]?.name, "Legacy");
});

test("a third axis is sparse on the way in, and flat has one spelling", () => {
	const scene = normalizeScene(
		staged({
			nodes: [
				{
					id: "solo",
					kind: "mesh",
					name: "Solo",
					frame: { x: [lit("0px")], y: [lit("0px")], width: [lit("10px")], height: [lit("10px")] },
					props: {},
					// A non-value entry is not a dimension; an empty one says nothing.
					spatial: { z: "24px", depth: [] },
					turn: {},
				},
			],
		}),
	);
	const solo = nodeAt(scene, "solo");
	assert.ok(solo);
	// Nothing usable survived either record, so neither key is written — a
	// leftover `{}` would otherwise put a whole document into three dimensions.
	assert.ok(!Object.hasOwn(solo, "spatial"));
	assert.ok(!Object.hasOwn(solo, "turn"));
});

test("a z is snapped onto its unit's lattice, and an angle is not", () => {
	const scene = normalizeScene(
		staged({
			nodes: [
				{
					id: "solo",
					kind: "mesh",
					name: "Solo",
					frame: { x: [lit("0px")], y: [lit("0px")], width: [lit("10px")], height: [lit("10px")] },
					props: {},
					// Half a pixel is 4762.5 EMU, which is no length at all, so it
					// would have read as zero and put the mesh back on the page.
					spatial: { z: [lit("20.5px")] },
					// An angle has no lattice to be off: `mdegOf` is exact or
					// nothing and 22.5 degrees is exactly 22500 thousandths.
					turn: { rotateY: [lit("22.5deg")], rotateZ: [lit("0.25turn")] },
				},
			],
		}),
	);
	const solo = nodeAt(scene, "solo");
	assert.ok(solo);
	assert.notDeepEqual(solo.spatial?.z, [lit("20.5px")]);
	assert.ok(emuOf(String((solo.spatial?.z?.[0] as { value: string }).value)) !== undefined);
	assert.deepEqual(solo.turn?.rotateY, [lit("22.5deg")]);
	assert.deepEqual(solo.turn?.rotateZ, [lit("0.25turn")]);
	assert.equal(turnMdeg(solo, "rotateY"), 22500);
});

test("a camera a viewport no longer holds is kept, because deleting one must leave a legal document", () => {
	const scene = normalizeScene(
		staged({
			nodes: [
				{
					id: "view",
					kind: "viewport",
					name: "Hero",
					frame: { x: [lit("0px")], y: [lit("0px")], width: [lit("480px")], height: [lit("320px")] },
					props: {},
					// The camera it named has been deleted out from under it.
					camera: "cam",
					children: [],
				},
				{
					id: "other",
					kind: "viewport",
					name: "Other",
					frame: { x: [lit("0px")], y: [lit("0px")], width: [lit("10px")], height: [lit("10px")] },
					props: {},
					camera: 7,
					children: [],
				},
			],
		}),
	);
	// The dangling `instanceOf` argument, one field over: `vcam/2` derives
	// nothing, the renderer frames the subtree itself and says so, and undoing
	// the deletion gives back a view that is still looking through the camera.
	assert.equal(nodeAt(scene, "view")?.camera, "cam");
	// A camera that is not an id at all is a different question, and gets the
	// answer `style` and `state` get.
	assert.ok(!Object.hasOwn(nodeAt(scene, "other") as SceneNode, "camera"));
});

test("a model whose file is missing is a relink, and half a reference is not a model", () => {
	const bounds = { x: 0, y: 0, width: 100, height: 100, z: 0, depth: 100 };
	const part = { node: 0, primitive: 0 };
	const scene = normalizeScene(
		staged({
			// The index has never heard of `/assets/gone.glb`, which is a missing
			// file. Note that the reader is not asked to check the project's *tree*
			// either, and could not: it is handed a document, and whether the bytes
			// are there is a question that changes after this runs.
			assets: {
				"/assets/here.glb": { format: "glb", bytes: 4, triangles: 2, name: "Here" },
			},
			nodes: [
				{
					id: "chair",
					kind: "model",
					name: "Chair",
					frame: { x: [lit("0px")], y: [lit("0px")], width: [lit("100px")], height: [lit("100px")] },
					props: {},
					mesh: { src: "/assets/gone.glb", format: "glb", part, bounds, triangles: 900 },
				},
				{
					id: "half",
					kind: "model",
					name: "Half",
					frame: { x: [lit("0px")], y: [lit("0px")], width: [lit("100px")], height: [lit("100px")] },
					props: {},
					// No bounds: nothing to draw while the file is away, and the same
					// judgement a path with no usable vertices gets.
					mesh: { src: "/assets/here.glb", format: "glb", part, triangles: 4 },
				},
				{
					id: "partless",
					kind: "model",
					name: "Partless",
					frame: { x: [lit("0px")], y: [lit("0px")], width: [lit("100px")], height: [lit("100px")] },
					props: {},
					// A file and no part is the other half of the same judgement, and
					// it is new: a path alone says which chair and never which leg, so
					// the loader would have to guess `{0, 0}` on every frame — which
					// is exactly the plausible-looking wrong answer `modelPart` refuses
					// to give in the exporter.
					mesh: { src: "/assets/here.glb", format: "glb", bounds, triangles: 4 },
				},
				{
					id: "fractional",
					kind: "model",
					name: "Fractional",
					frame: { x: [lit("0px")], y: [lit("0px")], width: [lit("100px")], height: [lit("100px")] },
					props: {},
					// Indices into the file's own arrays. A fraction is not a
					// subscript that misses, it is a number that came from somewhere
					// other than an import.
					mesh: {
						src: "/assets/here.glb",
						format: "glb",
						part: { node: 0.5, primitive: 0 },
						bounds,
						triangles: 4,
					},
				},
			],
		}),
	);
	assert.equal(nodeAt(scene, "chair")?.mesh?.src, "/assets/gone.glb");
	assert.deepEqual(nodeAt(scene, "chair")?.mesh?.part, part);
	assert.equal(nodeAt(scene, "chair")?.mesh?.triangles, 900);
	assert.ok(!Object.hasOwn(nodeAt(scene, "half") as SceneNode, "mesh"));
	assert.ok(!Object.hasOwn(nodeAt(scene, "partless") as SceneNode, "mesh"));
	assert.ok(!Object.hasOwn(nodeAt(scene, "fractional") as SceneNode, "mesh"));
	// And the node itself is never lost for any of those reasons — "relink this"
	// and "your chair is gone" are two sentences and only the first one is true.
	assert.ok(nodeAt(scene, "half"));
	assert.ok(nodeAt(scene, "partless"));
	assert.ok(nodeAt(scene, "fractional"));
});

test("a document written when geometry was a hash opens as one written today", () => {
	// Invariant 4 for the third axis, and it is exact rather than approximate —
	// which is a property of what the old payloads *were*. `putAsset` wrote each
	// primitive to `/assets/<hash>` as a standalone glTF holding one node, one
	// mesh, one primitive, already scaled and already centred, so `{node: 0,
	// primitive: 0}` is not a guess: it is the only part such a file has. Every
	// step of the new loader is then the identity on it — the derived scale chain
	// is `[1,1,1]` because the writer emitted no scale, and `centreTriangles`
	// returns its input untouched because it has an early return for a box that is
	// already centred. `gltfimport.test.ts` proves that half against real bytes;
	// this proves the document half, which is that the ref and the index arrive
	// pointing at the same place.
	const bounds = { x: 0, y: 0, width: 100, height: 100, z: 0, depth: 100 };
	const hash = "9f2c4b8e";
	const scene = normalizeScene(
		staged({
			assets: { [hash]: { format: "glb", bytes: 4096, triangles: 900, name: "Chair" } },
			nodes: [
				{
					id: "chair",
					kind: "model",
					name: "Chair",
					frame: { x: [lit("0px")], y: [lit("0px")], width: [lit("100px")], height: [lit("100px")] },
					props: {},
					// The shape a document saved before this change holds, `source`
					// and all.
					mesh: {
						asset: hash,
						format: "glb",
						bounds,
						triangles: 900,
						source: "chair.glb",
					},
				},
			],
		}),
	);
	const mesh = nodeAt(scene, "chair")?.mesh;
	assert.equal(mesh?.src, `/assets/${hash}`, "the ref points at where the bytes are");
	assert.deepEqual(mesh?.part, { node: 0, primitive: 0 }, "the only part such a file has");
	assert.equal(mesh?.triangles, 900, "and nothing else about it moved");
	assert.deepEqual(mesh?.bounds, bounds);
	// `source` is dropped rather than carried: it was a free-form second answer to
	// "which file did this come from" and `src` is now the first one.
	assert.ok(!Object.hasOwn(mesh as object, "source"));
	assert.ok(!Object.hasOwn(mesh as object, "asset"));
	// And the index is rekeyed in the same pass, so the two halves of the
	// migration cannot land separately — a ref pointing at a path the index still
	// held under a hash would be a model with no name and no size in every panel.
	assert.deepEqual(Object.keys(scene.assets ?? {}), [`/assets/${hash}`]);
	assert.equal(scene.assets?.[`/assets/${hash}`]?.name, "Chair");
	// Idempotent: reading the migrated document again is not a second migration.
	// `/assets/9f2c4b8e` already starts with a slash, so it is left as the path it
	// is rather than becoming `/assets//assets/9f2c4b8e`.
	assert.deepEqual(normalizeScene(scene), scene);
});

test("a mesh outside every viewport is kept, and says nothing", () => {
	// It is `node/1` with a `kind/2` like everything else, no viewport contains
	// it so no renderer ever sees it, and it is exactly what dragging a mesh out
	// of a view in the layer list leaves behind. Correcting it would be
	// correcting something a designer did on purpose.
	const scene = normalizeScene(
		staged({
			nodes: [
				{
					id: "stray",
					kind: "mesh",
					name: "Stray",
					frame: { x: [lit("0px")], y: [lit("0px")], width: [lit("10px")], height: [lit("10px")] },
					props: {},
				},
			],
		}),
	);
	assert.equal(nodeAt(scene, "stray")?.kind, "mesh");
});

test("a document with a 3D view is read once, however many times it is opened", () => {
	const once = normalizeScene(
		staged({ assets: { h1: { format: "glb", bytes: 8, triangles: 3, name: "Chair" } } }),
	);
	const twice = normalizeScene(JSON.parse(JSON.stringify(once)));
	assert.deepEqual(twice, once);
	// And over the document that exercises every branch above.
	const messy = normalizeScene(
		staged({
			assets: { h1: { bytes: 8 } },
			nodes: [
				{
					id: "solo",
					kind: "mesh",
					name: "Solo",
					frame: { x: [lit("0px")], y: [lit("0px")], width: [lit("10px")], height: [lit("10px")] },
					props: {},
					spatial: { z: [lit("20.5px")], depth: "no" },
					turn: { rotateY: [lit("22.5deg")] },
					camera: 7,
					mesh: { asset: "h1" },
				},
			],
		}),
	);
	assert.deepEqual(normalizeScene(JSON.parse(JSON.stringify(messy))), messy);
});

/* ------------------------------------------------------------------ */
/* Reading the rest of the ladder                                      */
/* ------------------------------------------------------------------ */

test("a state id the program already means something by is dropped", () => {
	// `entry`, `exit` and `any` are positions on an edge — where a machine
	// begins, where a layer stops, and an edge that may be taken from anywhere.
	// A state called `exit` would be offered by `mefrom/3` as an ordinary source
	// and as the sugar at once, which is one picture wrong in a way nothing
	// reports.
	const scene = normalizeScene(
		wired({
			states: [
				{ id: "rest", name: "Rest", parts: {} },
				{ id: "entry", name: "Entry", parts: {} },
				{ id: "exit", name: "Exit", parts: {} },
				{ id: "any", name: "Any", parts: {} },
				{ id: "hover", name: "Hover", parts: {} },
			],
		}),
	);
	assert.deepEqual(
		scene.machines[0].states.map((s) => s.id),
		["rest", "hover"],
	);
	// The edges that name them are kept, which is the whole point of the words.
	assert.equal(
		normalizeScene(
			wired({
				transitions: [
					{ id: "start", from: "entry", to: "rest", trigger: "load" },
					{ id: "stop", from: "rest", to: "exit", trigger: "click" },
				],
			}),
		).machines[0].transitions.length,
		2,
	);
});

test("an input the program could not name is dropped, and a range nobody can read is kept", () => {
	const scene = normalizeScene(
		wired({
			inputs: [
				{ id: "open", name: "Open", kind: "number", initial: "0", min: "0", max: "1" },
				{ id: "open", name: "Twice", kind: "boolean" },
				{ id: "Not A Term", name: "Bad", kind: "boolean" },
				{ id: "odd", name: "Odd", kind: "colour" },
				{ id: "saved", kind: "trigger" },
				// A range that reads as no number is not a broken document: it is a
				// range the checks decline to say anything about, and dropping it
				// would silently turn "this guard is impossible" into "this is fine".
				{ id: "wide", name: "Wide", kind: "number", min: "1e9" },
			],
		}),
	);
	const inputs = scene.machines[0].inputs ?? [];
	assert.deepEqual(
		inputs.map((i) => i.id),
		["open", "saved", "wide"],
		"a repeat keeps the first, a non-constant and an unknown kind go",
	);
	assert.equal(inputs[0].kind, "number");
	assert.equal(inputs[0].min, "0");
	assert.equal(inputs[1].name, "saved", "a missing name falls back to the id");
	assert.equal(inputs[2].min, "1e9");
	// Absence keeps meaning "nobody drives this machine from outside", which is
	// every machine any document written before this rung holds.
	assert.equal(normalizeScene(wired()).machines[0].inputs, undefined);
});

test("a guard naming an input the machine has not got is kept, so something can report it", () => {
	const scene = normalizeScene(
		wired({
			inputs: [{ id: "open", name: "Open", kind: "number" }],
			transitions: [
				{
					id: "over",
					from: "rest",
					to: "hover",
					trigger: "pointerenter",
					conditions: [
						{ input: "open", op: "gt", value: "0.5" },
						// The input was deleted. `mcbad/3` is looking for exactly this.
						{ input: "gone", op: "eq", value: "true" },
						// An operator the table has not got would become none of the
						// condition facts at all, so it is not a condition.
						{ input: "open", op: "approx", value: "1" },
						{ input: "Not A Term", op: "eq", value: "1" },
					],
				},
				{ id: "out", from: "hover", to: "rest", trigger: "pointerleave", conditions: [] },
			],
		}),
	);
	const [over, out] = scene.machines[0].transitions;
	assert.deepEqual(over.conditions, [
		{ input: "open", op: "gt", value: "0.5" },
		{ input: "gone", op: "eq", value: "true" },
	]);
	// Absent and empty are the same claim here — an unguarded edge — so an empty
	// list is dropped and every transition written before guards existed still
	// costs nothing.
	assert.ok(!Object.hasOwn(out, "conditions"));
});

test("an exit time is a duration value, read the way the other three are", () => {
	const scene = normalizeScene(
		wired({
			transitions: [
				{ id: "a", from: "rest", to: "hover", trigger: "click", exit: "300ms" },
				{ id: "b", from: "hover", to: "rest", trigger: "click", exit: 300 },
				{ id: "c", from: "rest", to: "hover", trigger: "load" },
			],
		}),
	);
	const [a, b, c] = scene.machines[0].transitions;
	assert.deepEqual(a.exit, [lit("300ms")]);
	// A bare number is ambiguous by a factor of a thousand, so it comes back as
	// itself and `msOf` refuses it — the same answer `duration` already gives,
	// and better than guessing which unit somebody meant.
	assert.deepEqual(b.exit, [lit("300")]);
	assert.equal(msOf("300"), undefined);
	assert.ok(!Object.hasOwn(c, "exit"));
});

test("the order of the layers is the priority, so a repeat keeps the first", () => {
	const scene = normalizeScene(
		wired({
			layers: [
				{ id: "base", name: "Base" },
				{ id: "glow", name: "Glow" },
				{ id: "base", name: "Second base" },
				{ id: "Not A Term", name: "Bad" },
			],
			states: [
				{ id: "rest", name: "Rest", parts: {}, layer: "base" },
				{ id: "lit", name: "Lit", parts: {}, layer: "gone" },
			],
		}),
	);
	const machine = scene.machines[0];
	assert.deepEqual(
		(machine.layers ?? []).map((l) => l.id),
		["base", "glow"],
	);
	assert.equal(machine.layers?.[0].name, "Base", "dropping the first would re-rank");
	// A state naming a layer that was deleted is the first layer, which is what
	// `layerOf` already falls back to — nothing is corrected on the way in.
	assert.equal(machine.states[1].layer, "gone");
	assert.equal(normalizeScene(wired()).machines[0].layers, undefined);
});

test("a timeline keeps its keys in time order, where the document says what time is", () => {
	const scene = normalizeScene(
		wired({
			timelines: [
				{
					id: "open",
					name: "Open",
					loop: "pingPong",
					length: "600ms",
					tracks: [
						{
							part: "label",
							dim: "y",
							keys: [
								{ at: "200ms", value: "8px" },
								{ at: "0ms", value: "0px", easing: "easeIn" },
								{ at: "200ms", value: "99px" },
							],
						},
						{ part: "label", turn: "rotateZ", keys: [{ at: "0ms", value: "30deg" }] },
						// A track with no subject has no term to reach the program as,
						// so its keys would be values keyed by nothing.
						{ part: "label", keys: [{ at: "0ms", value: "1" }] },
						{ part: "label", prop: "nosuchprop", keys: [] },
					],
				},
				{ id: "open", name: "Twice", tracks: [] },
				{ id: "Not A Term", name: "Bad", tracks: [] },
			],
		}),
	);
	const timelines = scene.machines[0].timelines ?? [];
	assert.deepEqual(
		timelines.map((t) => t.id),
		["open"],
	);
	const tracks = timelines[0].tracks;
	assert.deepEqual(
		tracks.map((t) => t.dim ?? t.turn ?? t.prop),
		["y", "rotateZ"],
	);
	assert.equal(timelines[0].loop, "pingPong");
	assert.deepEqual(timelines[0].length, [lit("600ms")]);
	// Sorted, and two keys at one time keep the first.
	assert.deepEqual(
		tracks[0].keys.map((k) => k.at),
		[[lit("0ms")], [lit("200ms")]],
	);
	assert.deepEqual(tracks[0].keys[0].easing, "easeIn");
	assert.deepEqual(tracks[0].keys[1].value, [lit("8px")]);
	// A rotation track's value is an angle, which has no lattice, so it comes
	// back exactly as it was typed.
	assert.deepEqual(tracks[1].keys[0].value, [lit("30deg")]);
});

test("a keyframe whose time names a token leaves the document's own order alone", () => {
	// "Time order" is a fact about a *universe* once a time can name a token, and
	// a reader that sorted on the first alternative would reorder somebody's
	// timeline on the strength of a design they are not looking at. The program
	// derives `mkbackwards/4` for the case a linter cannot catch.
	const scene = normalizeScene(
		wired({
			timelines: [
				{
					id: "open",
					name: "Open",
					tracks: [
						{
							part: "label",
							dim: "y",
							keys: [
								{ at: "300ms", value: "8px" },
								{ at: [{ kind: "token", token: "beat" }], value: "0px" },
								{ at: "100ms", value: "4px" },
							],
						},
					],
				},
			],
		}),
	);
	assert.deepEqual(
		scene.machines[0].timelines?.[0].tracks[0].keys.map((k) => k.value),
		[[lit("8px")], [lit("0px")], [lit("4px")]],
	);
});

test("a blend keeps stops nothing can satisfy, and loses a mixing rule nothing implements", () => {
	const scene = normalizeScene(
		wired({
			inputs: [{ id: "open", name: "Open", kind: "number", min: "0", max: "1" }],
			states: [
				{
					id: "rest",
					name: "Rest",
					parts: {},
					blend: {
						kind: "oneD",
						input: "open",
						stops: [
							{ timeline: "shut", at: "0" },
							// Outside the input's declared range: `mstopout/3` is looking
							// for exactly this, and the panel offers a rule that forbids
							// it by name. Dropping it would take away the symptom.
							{ timeline: "wide", at: "4" },
							{ at: "1" },
						],
					},
				},
				{ id: "hover", name: "Hover", parts: {}, blend: { kind: "twoD", stops: [] } },
			],
		}),
	);
	const [rest, hover] = scene.machines[0].states;
	assert.equal(rest.blend?.kind, "oneD");
	assert.equal(rest.blend?.input, "open");
	assert.deepEqual(rest.blend?.stops, [
		{ timeline: "shut", at: "0" },
		{ timeline: "wide", at: "4" },
	]);
	// A kind the table has not got is a mixing rule nothing implements, so the
	// blend goes and the state stays — a state with no source draws its delta.
	assert.ok(!Object.hasOwn(hover, "blend"));
});

test("an instance says which state of each further layer it is drawn in", () => {
	const scene = normalizeScene({
		...wired(),
		nodes: [
			wired().nodes[0],
			{ ...wired().nodes[1], states: { glow: "lit", trim: 7 } },
			{ ...wired().nodes[1], id: "b2", states: {} },
		],
	});
	// `state` keeps saying what it says about the first layer; entries that are
	// not state ids go one at a time rather than losing the record.
	assert.equal(scene.nodes[1].state, "hover");
	assert.deepEqual(scene.nodes[1].states, { glow: "lit" });
	assert.ok(!Object.hasOwn(scene.nodes[2], "states"));
});

test("a document with the whole ladder in it is read once, however many times it is opened", () => {
	const once = normalizeScene(
		wired({
			inputs: [{ id: "open", name: "Open", kind: "number", min: "0", max: "1" }],
			layers: [{ id: "base", name: "Base" }, { id: "glow", name: "Glow" }],
			timelines: [
				{
					id: "open",
					name: "Open",
					loop: "loop",
					tracks: [
						{ part: "label", dim: "z", keys: [{ at: "0ms", value: "0px" }, { at: "1s", value: "40px" }] },
						{ part: "label", turn: "rotateY", keys: [{ at: "0ms", value: "0deg" }] },
					],
				},
			],
			states: [
				{ id: "rest", name: "Rest", parts: {}, layer: "base", timeline: "open" },
				{
					id: "lit",
					name: "Lit",
					layer: "glow",
					parts: {
						label: {
							frame: { z: [lit("40px")], y: [lit("8px")] },
							turn: { rotateY: [lit("30deg")] },
						},
					},
				},
			],
			transitions: [
				{
					id: "over",
					from: "any",
					to: "lit",
					trigger: "pointerenter",
					exit: "300ms",
					conditions: [{ input: "open", op: "ge", value: "0.5" }],
				},
			],
		}),
	);
	const twice = normalizeScene(JSON.parse(JSON.stringify(once)));
	assert.deepEqual(twice, once);
	// And the state delta really does carry the third axis and a rotation.
	const lit40 = once.machines[0].states[1].parts.label;
	assert.deepEqual(lit40.frame?.z, [lit("40px")]);
	assert.deepEqual(lit40.turn?.rotateY, [lit("30deg")]);
	assert.equal(stateTouches({ turn: lit40.turn }), true);
});

/* ------------------------------------------------------------------ */
/* No regression: every existing document reads back as it always did  */
/* ------------------------------------------------------------------ */

/**
 * The templates written *after* the third axis and the ladder, which hold their
 * fields on purpose.
 *
 * Named rather than detected, for the reason `SPATIAL_TEMPLATES` in
 * `spatial.test.ts` is: a loop that skipped whatever happened to hold a new
 * field would excuse exactly the regression it exists to catch. Both directions
 * are asserted below, so a template cannot be parked in here to quieten it —
 * being in this set is a claim that the document really does exercise the new
 * fields, and it fails if it does not.
 */
const MODERN_TEMPLATES = new Set(["deck", "solids"]);

test("no template gains a single field the third axis or the ladder added", () => {
	// The invariant, asserted rather than assumed. Every field these steps added
	// is optional and absence means what it always meant, so a document written
	// before any of it existed has to come back holding none of it — otherwise
	// the compiler's `spatial.` gate opens on a file that never asked for it, and
	// a viewport on page four puts the whole document into three dimensions.
	//
	// The two templates that *do* ask for it are held to the opposite claim, in
	// the same walk: they must come back holding what they were written with, and
	// they must round-trip identically doing it. A field that survived one read
	// and vanished on the second would be a document that changed the first time
	// somebody saved it.
	for (const template of TEMPLATES) {
		const raw = JSON.parse(JSON.stringify(template.create()));
		const once = normalizeScene(raw);
		const twice = normalizeScene(JSON.parse(JSON.stringify(once)));
		assert.deepEqual(twice, once, `${template.id} is read once`);
		assert.ok(!Object.hasOwn(once, "assets"), `${template.id} has no assets`);

		const seen: string[] = [];
		const walk = (nodes: readonly SceneNode[]) => {
			for (const node of nodes) {
				for (const key of ["spatial", "turn", "camera", "mesh", "states"]) {
					if (Object.hasOwn(node, key)) seen.push(`${node.id}.${key}`);
				}
				if (node.children) walk(node.children);
			}
		};
		walk(once.nodes);
		for (const machine of once.machines) {
			for (const key of ["inputs", "layers", "timelines"]) {
				if (Object.hasOwn(machine, key)) seen.push(`${machine.id}.${key}`);
			}
			for (const state of machine.states) {
				for (const key of ["layer", "timeline", "blend"]) {
					if (Object.hasOwn(state, key)) seen.push(`${state.id}.${key}`);
				}
				for (const [part, delta] of Object.entries(state.parts)) {
					if (Object.hasOwn(delta, "turn")) seen.push(`${state.id}.${part}.turn`);
					for (const dim of ["z", "depth"]) {
						if (delta.frame && Object.hasOwn(delta.frame, dim)) {
							seen.push(`${state.id}.${part}.${dim}`);
						}
					}
				}
			}
			for (const transition of machine.transitions) {
				for (const key of ["conditions", "exit"]) {
					if (Object.hasOwn(transition, key)) seen.push(`${transition.id}.${key}`);
				}
			}
		}
		if (MODERN_TEMPLATES.has(template.id)) {
			assert.ok(
				seen.length > 0,
				`${template.id} is listed as modern and holds none of the new fields`,
			);
			continue;
		}
		assert.deepEqual(seen, [], `${template.id} gained ${seen.join(", ")}`);
	}
});
