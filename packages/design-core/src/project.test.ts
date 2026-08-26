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
	emptyScene,
	frameDim,
	frameOf,
	guideAt,
	guideCount,
	guideLength,
	guideLines,
	isGridded,
	layoutLength,
} from "./scene.ts";
import { EMU_PER_PX, UNIT_NAMES, UNITS, emuOf } from "./units.ts";
import { type Value, type ValueType, isLengthType, lit, single } from "./values.ts";

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
