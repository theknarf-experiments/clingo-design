/**
 * The picture is behind a switch, and the switch has to be free.
 *
 * Two claims, both only checkable against the real solver. First that the gate
 * works at all: the same grounding answers with the whole scene or with the
 * decisions alone, depending on one assumption, and the *number* of answers is
 * the same either way — a gate that multiplied the space would turn every
 * design into two. Second that nothing an exploration shows is drawn from a
 * solve that was not asked for a picture, which is the failure the gate makes
 * possible: an empty scene renders as a blank canvas rather than as an error.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseAtom } from "./atoms.ts";
import { PULL_ATOM, SCENERY_ATOM, compile } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { explore } from "./explore.ts";
import { readModel } from "./model.ts";
import type { Scene } from "./scene.ts";
import { buttons } from "./templates/buttons.ts";
import { card } from "./templates/card.ts";
import { sudoku } from "./templates/sudoku.ts";
import { propValues } from "./tree.ts";
import { parseVariable, resolveValue } from "./values.ts";

/** The predicates that only appear when a picture was asked for. */
const SCENE = new Set([
	"node/1",
	"kind/2",
	"order/2",
	"child/2",
	"frame/3",
	"rendered/3",
	"literal/2",
	"dvar/1",
	"dalt/3",
	"group/1",
	"member/2",
]);

function signatures(atoms: readonly string[]): Set<string> {
	const out = new Set<string>();
	for (const text of atoms) {
		const atom = parseAtom(text);
		if (atom) out.add(`${atom.name}/${atom.args.length}`);
	}
	return out;
}

async function withSession<T>(
	scene: Scene,
	body: (
		solve: (
			scenery: boolean,
			extra?: { models?: number; countOnly?: boolean },
		) => Promise<{ models: string[][]; count: number; exhausted: boolean }>,
	) => Promise<T>,
): Promise<T> {
	const { program, guards } = compile(scene);
	const session = await directSolver.open(program, "--project");
	try {
		return await body((scenery, extra = {}) =>
			session.solve({
				models: extra.models ?? 1,
				countOnly: extra.countOnly,
				assumptions: [
					...[...guards, PULL_ATOM].map((atom) => ({ atom })),
					{ atom: SCENERY_ATOM, sign: scenery },
				],
			}),
		);
	} finally {
		await session.close();
	}
}

test("the picture is in the answer set only when it is asked for", async () => {
	await withSession(card(), async (solve) => {
		const [on] = (await solve(true)).models;
		const [off] = (await solve(false)).models;
		assert.ok(on && off);

		// Everything the renderer reads is behind the gate...
		for (const signature of SCENE) {
			assert.ok(
				!signatures(off).has(signature),
				`${signature} came back without scenery`,
			);
		}
		assert.ok(
			[...SCENE].some((s) => signatures(on).has(s)),
			"nothing came back with scenery",
		);
		// ...and everything a candidate is judged on is not.
		for (const signature of ["pick/2", "visible/1"]) {
			assert.ok(signatures(off).has(signature), `${signature} was gated`);
		}
		assert.ok(off.length * 3 < on.length, `off ${off.length}, on ${on.length}`);
	});
});

test("the gate does not multiply the designs", async () => {
	// `#project` names `rendered/3` and friends, so the gate atom is projected
	// out. Were it not, every design would come back twice and the multiverse
	// would show each of `buttons`' 27 arrangements as two.
	for (const [name, scene, expected] of [
		["card", card(), 15],
		["buttons", buttons(), 27],
	] as const) {
		await withSession(scene, async (solve) => {
			const on = await solve(true, { models: 0, countOnly: true });
			const off = await solve(false, { models: 0, countOnly: true });
			assert.equal(on.count, expected, `${name} with a picture`);
			assert.equal(off.count, expected, `${name} without one`);
		});
	}
});

test("a bare answer set describes no scene at all", async () => {
	// The reason the gate needs a type rather than a convention: this is what
	// reaches the canvas if a candidate is ever drawn, and it is not an error,
	// it is an empty document.
	await withSession(sudoku(), async (solve) => {
		const [off] = (await solve(false)).models;
		assert.ok(off);
		const model = readModel(off);
		assert.deepEqual(model.roots, []);
		assert.deepEqual(model.byId, {});
	});
});

/** Every universe an exploration shows can be drawn, and draws its own picks. */
async function assertDrawsItsPicks(scene: Scene, limit: number): Promise<void> {
	const exploration = await explore(scene, directSolver, { limit });
	assert.ok(exploration.sampling.sampled, "expected this to sample");
	assert.equal(exploration.universes.length, limit);

	const props = propValues(scene.nodes);
	for (const universe of exploration.universes) {
		const model = universe.model;
		assert.ok(model.roots.length > 0, "a universe came back with no picture");
		const context = { tokens: scene.tokens, picks: universe.pick, props };
		let checked = 0;
		for (const key of Object.keys(universe.pick)) {
			const variable = parseVariable(key);
			if (variable?.kind !== "prop") continue;
			const node = model.byId[variable.node];
			if (!node) continue;
			const want = resolveValue(context, props[key], key);
			if (want === undefined) continue;
			// The picture is *this* candidate's, not one nearby: the text the
			// answer set paints with is what the candidate's own pick resolves to.
			assert.equal(
				node.rendered[variable.prop as keyof typeof node.rendered],
				want,
				`${key} drawn as something else`,
			);
			checked++;
		}
		assert.ok(checked > 0, "no property was actually compared");
	}
}

test("a sampled universe is drawn from the design that was chosen", async () => {
	// `buttons` is the document the gate was built for: 27 designs, a hundred
	// and more sampling solves, and two dozen pictures wanted at the end. The
	// ones that earn a slot are re-solved with their own picks assumed, and
	// `1 { pick(V,I) : alt(V,I) } 1` is what makes that reproduce the design
	// rather than merely something legal.
	await assertDrawsItsPicks(buttons(), 12);
	// And the same on a document whose space is small enough that most of the
	// pool comes from the enumeration, where hydration is mostly a no-op.
	await assertDrawsItsPicks(card(), 4);
});
