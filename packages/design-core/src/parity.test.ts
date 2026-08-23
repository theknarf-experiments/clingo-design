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
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { PULL_ATOM, compile } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { explore } from "./explore.ts";
import { readModel, type ModelNode, type ModelScene } from "./model.ts";
import {
	KINDS,
	type PropName,
	type Scene,
	type SceneNode,
} from "./scene.ts";
import { card } from "./templates/card.ts";
import { TEMPLATES } from "./templates/index.ts";
import { flatten, placedNodes, propValues } from "./tree.ts";
import { propVar, resolveValue } from "./values.ts";

/** Every answer set for a scene, capped so a wide template stays quick. */
async function models(scene: Scene, limit: number): Promise<string[][]> {
	const { program, guards } = compile(scene);
	const session = await directSolver.open(program, "--project");
	try {
		const out = await session.solve({
			models: limit,
			assumptions: [...guards, PULL_ATOM].map((atom) => ({ atom })),
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
				const value = resolveValue(
					context,
					node.props[prop],
					propVar(node.id, prop),
				);
				if (value !== undefined) paint[prop] = value;
			}
			out.set(node.id, {
				frame: fixed ? { ...node.frame, ...fixed } : node.frame,
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
			const got = walkModel(model.roots);

			// Same nodes, in the same paint order.
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
		const solved: Record<string, Partial<Record<"x" | "y" | "width" | "height", number>>> = {};
		for (const text of atoms) {
			const m = /^__lpx\((lv|lsz)\(([^,]+),([a-z]+)\),"([^"]*)"\)$/.exec(text);
			if (!m) continue;
			const slash = m[4].indexOf("/");
			const n =
				slash === -1
					? Number(m[4])
					: Number(m[4].slice(0, slash)) / Number(m[4].slice(slash + 1));
			(solved[m[2]] ??= {})[m[3] as "x"] = n;
		}
		for (const placed of placedNodes(scene.nodes, solved)) {
			if (!visible.has(placed.node.id)) continue;
			const read = model.byId[placed.node.id];
			assert.ok(read, `${placed.node.id} missing from the model`);
			assert.deepEqual(
				read.frame,
				solved[placed.node.id]
					? { ...placed.node.frame, ...solved[placed.node.id] }
					: placed.node.frame,
				`${placed.node.id} sits somewhere else`,
			);
		}
		// And nothing in the document is missing from the picture.
		assert.deepEqual(
			walkModel(model.roots).map((n) => n.id).sort(),
			flatten(scene.nodes)
				.filter((n) => visible.has(n.id))
				.map((n) => n.id)
				.sort(),
		);
	});
}

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
