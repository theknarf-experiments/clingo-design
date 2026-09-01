/**
 * The two descriptions of the same picture, held against each other.
 *
 * Until now a renderer walked the TypeScript document and resolved every
 * property itself; now it reads {@link readModel}. The swap is only allowed to
 * be invisible if the two agree everywhere, on every template, in every
 * universe — so this asserts exactly that, against the real solver, rather
 * than trusting that they were derived from the same source.
 *
 * It is also the alarm for the other direction. The day a rule moves a node or
 * repaints it, the answer set is right and the document is stale, and one of
 * these assertions will fire on a document that meant it to. That is the point
 * at which the expectation, not the renderer, is what has to change.
 *
 * That day came: `sudoku` builds its 81 cells with a rule, so the answer set
 * holds nodes the document has no account of and the two readings can only be
 * held against each other where both have something to say. So the comparison
 * runs over the document's own ids — which is the whole of what the swap
 * promised not to disturb — and the surplus is asserted to be *derived*, rather
 * than being quietly tolerated.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { PULL_ATOM, SCENERY_ATOM, compile } from "./compile.ts";
import { derivedNodes, documentIds } from "./derived.ts";
import { directSolver } from "./directSolver.ts";
import { setProp } from "./edits.ts";
import { explore } from "./explore.ts";
import { readModel, type ModelNode, type ModelScene } from "./model.ts";
import {
	type Dimension,
	KINDS,
	type PropName,
	type Scene,
	type SceneNode,
	type Spatial,
	frameOf,
	propValueOf,
} from "./scene.ts";
import { card } from "./templates/card.ts";
import { TEMPLATES } from "./templates/index.ts";
import { flatten, placedNodes, propValues } from "./tree.ts";
import { VALUE_TYPES, propVar, resolveValue, single } from "./values.ts";

/** Every answer set for a scene, capped so a wide template stays quick. */
async function models(scene: Scene, limit: number): Promise<string[][]> {
	const { program, guards } = compile(scene);
	const session = await directSolver.open(program, "--project");
	try {
		const out = await session.solve({
			models: limit,
			assumptions: [...guards, PULL_ATOM, SCENERY_ATOM].map((atom) => ({ atom })),
		});
		assert.equal(out.result, "SATISFIABLE");
		return out.models;
	} finally {
		await session.close();
	}
}

/** What the old renderer drew: the document, with this universe's picks. */
function drawnFromDocument(
	scene: Scene,
	picks: Record<string, number>,
	solved: Record<string, Partial<{ x: number; y: number; width: number; height: number }>>,
	visible: ReadonlySet<string>,
): Map<string, { frame: unknown; paint: Record<string, string> }> {
	const context = {
		tokens: scene.tokens,
		picks,
		props: propValues(scene.nodes),
	};
	const out = new Map<string, { frame: unknown; paint: Record<string, string> }>();
	const walk = (list: readonly SceneNode[]) => {
		for (const node of list) {
			if (!visible.has(node.id)) continue;
			const fixed = solved[node.id];
			const paint: Record<string, string> = {};
			for (const prop of KINDS[node.kind].props) {
				// Through `propValueOf`, so a node wearing a style is read the way
				// the generated program resolves it: its own value where it has
				// one, and this universe's variant where it does not.
				const value = resolveValue(
					context,
					propValueOf(scene, node, prop, picks),
					propVar(node.id, prop),
				);
				if (value !== undefined) paint[prop] = value;
			}
			const stored = frameOf(node, context);
			out.set(node.id, {
				frame: fixed ? { ...stored, ...fixed } : stored,
				paint,
			});
			if (node.children) walk(node.children);
		}
	};
	walk(scene.nodes);
	return out;
}

/** Depth-first over the read scene, parents before children. */
function walkModel(nodes: readonly ModelNode[]): ModelNode[] {
	return nodes.flatMap((n) => [n, ...walkModel(n.children)]);
}

/** The picks and visibility an answer set carries, without `explore`. */
function decisions(atoms: readonly string[]): {
	picks: Record<string, number>;
	visible: Set<string>;
} {
	const picks: Record<string, number> = {};
	const visible = new Set<string>();
	for (const text of atoms) {
		const pick = /^pick\((.+),(\d+)\)$/.exec(text);
		if (pick) picks[pick[1]] = Number(pick[2]);
		const seen = /^visible\((.+)\)$/.exec(text);
		if (seen) visible.add(seen[1]);
	}
	return { picks, visible };
}

for (const template of TEMPLATES) {
	test(`${template.id}: the answer set draws what the document drew`, async () => {
		const scene = template.create();
		// Four universes rather than one: a template whose tokens branch has to
		// agree in each of them, not merely in whichever came back first.
		for (const atoms of await models(scene, 4)) {
			const model: ModelScene = readModel(atoms);
			const { picks, visible } = decisions(atoms);
			const expected = drawnFromDocument(scene, picks, {}, visible);
			const held = documentIds(scene);
			const all = walkModel(model.roots);
			const got = all.filter((n) => held.has(n.id));

			// Same nodes, in the same paint order. A node a rule derived was never
			// drawn from the document, so it is held out here — and asserted to be
			// exactly that, rather than quietly tolerated.
			assert.deepEqual(
				all.filter((n) => !held.has(n.id)).map((n) => n.id).sort(),
				derivedNodes(model, held).map((d) => d.node.id).sort(),
			);
			assert.deepEqual(
				got.map((n) => n.id),
				[...expected.keys()],
			);

			for (const node of got) {
				const want = expected.get(node.id);
				assert.ok(want, `${node.id} unexpected`);
				// Only what the kind actually paints: `rendered/3` carries every
				// property the node stores, which is a superset.
				const paint: Record<string, string> = {};
				for (const prop of KINDS[node.kind].props as readonly PropName[]) {
					const value = node.rendered[prop];
					if (value !== undefined) paint[prop] = value;
				}
				assert.deepEqual(paint, want.paint, `${node.id} paints differently`);
			}
		}
	});

	test(`${template.id}: frames match placedNodes, the editor's own reading`, async () => {
		const scene = template.create();
		const [atoms] = await models(scene, 1);
		const model = readModel(atoms);
		const { visible } = decisions(atoms);
		// `readSolved` is what `Universe.solved` is built from, so feeding it to
		// `placedNodes` is exactly what hit testing sees.
		// Split the way the model splits, which is the way `readSolved` splits.
		// `lv/2` and `lsz/2` answer for **six** dimensions now, and `readModel` puts
		// the planar four on `ModelNode.frame` and the other two on
		// `ModelNode.spatial` — deliberately, so that a two-dimensional reader asking
		// a node for its frame gets four numbers whatever else the document holds.
		// Poured into one record, the third axis would arrive on the left of an
		// assertion about the frame and the frame would be missing it on the right,
		// which is a disagreement between the test and the reader rather than
		// between the reader and the editor.
		const solved: Record<string, Partial<Record<Dimension, number>>> = {};
		const spatial: Record<string, Partial<Record<Spatial, number>>> = {};
		for (const text of atoms) {
			const m = /^__lpx\((lv|lsz)\(([^,]+),([a-z]+)\),"([^"]*)"\)$/.exec(text);
			if (!m) continue;
			const slash = m[4].indexOf("/");
			const n =
				slash === -1
					? Number(m[4])
					: Number(m[4].slice(0, slash)) / Number(m[4].slice(slash + 1));
			if (m[3] === "z" || m[3] === "depth") (spatial[m[2]] ??= {})[m[3]] = n;
			else (solved[m[2]] ??= {})[m[3] as Dimension] = n;
		}
		const { picks } = decisions(atoms);
		const context = { tokens: scene.tokens, picks };
		for (const placed of placedNodes(scene.nodes, solved, context)) {
			if (!visible.has(placed.node.id)) continue;
			const read = model.byId[placed.node.id];
			assert.ok(read, `${placed.node.id} missing from the model`);
			const stored = frameOf(placed.node, context);
			assert.deepEqual(
				read.frame,
				solved[placed.node.id]
					? { ...stored, ...solved[placed.node.id] }
					: stored,
				`${placed.node.id} sits somewhere else`,
			);
			// The other two, where the solver answered for them. Held to the same
			// standard rather than merely kept out of the frame: a `depth` the
			// equations decided and the reader dropped would otherwise be a silent
			// hole exactly where the split above was made.
			for (const [dim, value] of Object.entries(spatial[placed.node.id] ?? {})) {
				assert.equal(
					read.spatial?.[dim as Spatial],
					value,
					`${placed.node.id} is ${dim} somewhere else`,
				);
			}
		}
		// And nothing in the document is missing from the picture. The other
		// direction no longer holds: a rule may put more in it than the document
		// has, which is what `derivedNodes` is for.
		const held = documentIds(scene);
		assert.deepEqual(
			walkModel(model.roots)
				.filter((n) => held.has(n.id))
				.map((n) => n.id)
				.sort(),
			flatten(scene.nodes)
				.filter((n) => visible.has(n.id))
				.map((n) => n.id)
				.sort(),
		);
	});
}

/* ------------------------------------------------------------------ */
/* The paint layer, and the compiler it did not touch                  */
/* ------------------------------------------------------------------ */

/**
 * The same document with every paint property this tool has just learned set on
 * every node whose kind offers one.
 *
 * Six properties over thirteen templates, which is the widest form of "a
 * document that uses the whole feature" available without inventing a fixture
 * that would need updating every time a template does.
 */
function painted(scene: Scene): Scene {
	let out = scene;
	const recipe = VALUE_TYPES.gradient.options?.[1].value ?? "none";
	for (const node of flatten(scene.nodes)) {
		for (const [prop, value] of [
			["gradient", recipe],
			["gradientFrom", "#7c3aed"],
			["gradientTo", "#0f172a"],
			["blur", "4px"],
			["backdropBlur", "12px"],
			["mix", "multiply"],
		] as const) {
			if (!KINDS[node.kind].props.includes(prop)) continue;
			out = setProp(out, [node.id], prop, single(value));
		}
	}
	return out;
}

/**
 * Every predicate name a program mentions, head or body, once each.
 *
 * The quoted strings come out first, and that is not tidiness: a gradient
 * recipe *is* `linear-gradient(180deg, …)`, so a scan that read inside a literal
 * would report `gradient` and `var` as predicates of the program and this whole
 * assertion would pass for the wrong reason — or, here, fail for one.
 */
function predicates(program: string): string[] {
	const bare = program.replace(/"(\\.|[^"\\])*"/g, '""');
	const found = new Set<string>();
	for (const [, name] of bare.matchAll(/\b([a-z][A-Za-z0-9_]*)\(/g)) found.add(name);
	return [...found].sort();
}

/**
 * A program's facts with every literal id replaced by the text it interns.
 *
 * `LiteralTable` numbers by interning order, so a document that interns one more
 * value renumbers every id after it — and an atom that merely *names* a literal,
 * `derived_of(contrast,l10,l1)`, then differs without anything about it having
 * changed. Comparing the texts rather than the ids is what tells a renumbering
 * apart from a new fact, which is the distinction this assertion is about.
 */
function factsByText(scene: Scene): Set<string> {
	const generated = compile(scene).generated;
	const text = new Map<string, string>();
	for (const [, id, body] of generated.matchAll(/^literal\((l\d+),"((?:\\.|[^"\\])*)"\)\.$/gm)) {
		text.set(id, body);
	}
	return new Set(
		generated
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "" && !line.startsWith("%"))
			.map((line) => line.replace(/\bl(\d+)\b/g, (id) => `«${text.get(id) ?? id}»`)),
	);
}

/**
 * The six shipped readings of a literal's text, which are nobody's feature.
 *
 * A bridge is emitted by one generic loop over `literals.texts()`, keyed by what
 * the text *is* and never by who wrote it: `"multiply"` is a constant so it
 * carries `word/2`, `"4px"` is a length so it carries `numeral/2`. So a document
 * whose every literal happened to be a colour or a length mentions `word` for
 * the first time the moment any property anywhere stores a bare lower-case word
 * — a `fit` of `cover` would have done it exactly as a mix mode does.
 *
 * Named here and subtracted below so that the assertion says *paint added no
 * predicate of its own* rather than *the program's vocabulary did not grow*. The
 * second sentence is not true and never was; pretending otherwise would mean
 * either a fixture rigged to reuse a word every template already holds, or an
 * assertion loosened later by somebody who could not see why it failed.
 */
const LITERAL_BRIDGES = new Set([
	"numeral",
	"tally",
	"word",
	"millis",
	"mdeg",
	"permille",
]);

/**
 * **The standing form of "paint did not touch the compiler".**
 *
 * The obvious assertion — `compile(scene).program` is byte-identical before and
 * after — is a claim about a git diff. It is true the day it lands and false
 * from the next feature onward, because a later step emits facts for every
 * document with a machine in it whether or not anybody asked for a curve; so it
 * would be deleted by that step, or worse, weakened by it. (It was run once, as
 * a one-off, inside the commit that landed this: captured before the first line
 * and asserted after the last.)
 *
 * This is what paint actually claims, and it survives everything: a gradient, a
 * blur and a mix mode are *ordinary properties holding ordinary Values*, so they
 * reach the program through the same generic loop a fill does and add no
 * predicate of their own. If somebody ever adds a `gstop/4` — the shape a
 * draggable gradient stop would need — this fails loudly, which is the whole
 * point of writing it down.
 *
 * Two halves rather than one equality, and the asymmetry is deliberate. Nothing
 * may be **lost**, ever, and that half is exact: a program that stopped
 * mentioning a predicate because a node grew a gradient would mean paint had
 * reached a rule. What may be **gained** is a literal bridge and nothing else —
 * see {@link LITERAL_BRIDGES} for why that is the value system rather than this
 * feature.
 */
test("paint adds no predicate", () => {
	for (const template of TEMPLATES) {
		const plain = predicates(compile(template.create()).program);
		const full = predicates(compile(painted(template.create())).program);
		assert.deepEqual(
			plain.filter((name) => !full.includes(name)),
			[],
			`"${template.id}" stopped mentioning a predicate when it grew a gradient`,
		);
		assert.deepEqual(
			full.filter((name) => !plain.includes(name) && !LITERAL_BRIDGES.has(name)),
			[],
			`"${template.id}" grew a predicate when it grew a gradient`,
		);
	}
});

/**
 * The same claim one grain finer, and it is what makes "a gradient recipe
 * carries no bridge at all" checkable.
 *
 * A property becomes `alt/2`, `alt_literal/3` and an interned `literal/2`, plus
 * whichever of the six bridges its *text* admits — chosen by what the value is
 * and never by who is asking. A mix mode is one lower-case word so it picks up
 * `word/2`; a blur is a length so it picks up `numeral/2` in EMU, which is what
 * makes `:- rendered(N,blur,L), numeral(L,V), V > 76200.` ground with nothing
 * added; and a gradient recipe has parentheses, commas and hashes in it, so it
 * picks up nothing, which is the same company a colour and a `box-shadow`
 * already keep.
 *
 * `docvar/1` is in the allowed set because it is one per variable and a new
 * property is a new variable — the editor cannot offer alternatives it cannot
 * read. `derived_of/3` is in it for the same shape one step out: a derivation is
 * compiled to a lookup table over *every literal in the document*, so a new
 * colour is a new row of it — `derived_of(contrast,«#7c3aed»,«#ffffff»)` — for
 * precisely the reason a new colour is a new `literal/2`, and a fill set to the
 * same purple would have added the identical fact. It is an atom about paint's
 * literal, which is what this test's name allows, rather than an atom about the
 * scene, which is what it forbids. Everything else in a generated program is a
 * fact about the scene, the geometry or the rules, and none of those heard about
 * any of this.
 */
test("paint changes no atom but its own literals", () => {
	const mine = new Set([
		"alt",
		"alt_literal",
		"alt_token",
		"derived_of",
		"docvar",
		"literal",
		...LITERAL_BRIDGES,
	]);
	for (const template of TEMPLATES) {
		const plain = factsByText(template.create());
		const full = factsByText(painted(template.create()));
		const moved = [
			...[...full].filter((line) => !plain.has(line)),
			...[...plain].filter((line) => !full.has(line)),
		];
		assert.ok(moved.length > 0, `"${template.id}" did not paint anything at all`);
		for (const line of moved) {
			const name = /^([a-z][A-Za-z0-9_]*)\(/.exec(line)?.[1];
			assert.ok(
				name !== undefined && mine.has(name),
				`"${template.id}" moved an atom paint has no business moving: ${line}`,
			);
		}
	}
});

test("a universe carries the picture it decided on, built once", async () => {
	// What the renderer actually reads. `model` is lazy — a sampling run
	// interprets hundreds of candidates and draws two dozen — so this also
	// pins that asking twice does not read the atoms twice.
	const exploration = await explore(card(), directSolver, { limit: 3 });
	for (const universe of exploration.universes) {
		const model = universe.model;
		assert.equal(universe.model, model, "model is rebuilt per access");
		// Same picture, same decisions: the fill the answer set drew the badge
		// with is the alternative `pick` says it chose.
		assert.deepEqual(
			new Set(Object.keys(model.byId)),
			universe.visible,
		);
		assert.ok(model.byId.badge?.rendered.fill);
	}
	// Two universes that picked differently draw differently.
	const fills = new Set(
		exploration.universes.map((u) => u.model.byId.badge?.rendered.fill),
	);
	assert.ok(fills.size > 1, "expected the accent to differ across universes");
});
