/**
 * The seam between the document layer and PlaneGCS.
 *
 * clingo-lpx decides linear arithmetic. A Euclidean distance, a bearing and a
 * collinearity are not linear in the unknowns, so a second solver — FreeCAD's
 * PlaneGCS, compiled to wasm — decides those, as a refinement pass over an
 * answer set the first solver has already produced. See docs/planegcs-spec.md.
 *
 * This package is shaped like `design-core/src/solver.ts` and for its reason:
 * nothing downstream imports the wasm module, it talks to a {@link Sketcher}.
 * What is different is that the library underneath is a numerical solver rather
 * than a logical one, and three of its behaviours are the opposite of what this
 * codebase assumes everywhere else. The interface exists to make all three
 * unrepresentable rather than merely documented:
 *
 * 1. **A number you push in is a starting guess, not a fact.** Declare a circle
 *    of radius 50, ask for a tangency, and the library returns `Success` having
 *    quietly made the radius 39.26. So every coordinate in a
 *    {@link SketchRequest} is either pinned — nailed down by a
 *    `coordinate_x`/`coordinate_y` constraint carrying a tag that can be blamed
 *    — or free, and a free coordinate's starting value is a required field of
 *    `points`. There is no third category and no implicit starting point.
 * 2. **Failure still writes geometry.** An over-constrained system returns
 *    `Failed` and leaves plausible, wrong coordinates behind. `apply_solution()`
 *    is called at exactly one place in this file, behind a status check, on a
 *    `GcsWrapper` that never escapes {@link solveOnce}; and the primitives it
 *    mutates are minted here, so a refused solve cannot reach back into the
 *    caller's arrays.
 * 3. **The answer depends on where you started**, and at `dof > 0` there is a
 *    continuum of answers. So `dof` is a required field of a settled outcome
 *    rather than something a caller may forget to read: a studio that cannot say
 *    "one of infinitely many" says "settled" instead, which is a lie.
 *
 * **CSS pixels in, CSS pixels out.** This package knows nothing of EMU. That
 * conversion is `design-core`'s, through the two functions `units.ts` blesses,
 * and it lives there rather than here because `cssPxFromEmu`, `emuFromCssPx`
 * and `ASP_EMU_CEILING` are in that package — testing them from this one would
 * force `planegcs → design-core` while `design-core → planegcs` already holds,
 * which is a cycle in the turbo graph.
 */

import {
	Algorithm,
	GcsWrapper,
	SolveStatus,
	init_planegcs_module,
} from "@salusoft89/planegcs";
import type { SketchPoint, SketchPrimitive } from "@salusoft89/planegcs";
import type {
	InitPlanegcsModule,
	PlanegcsModule,
} from "../types/planegcs.d.mts";

/**
 * The glue's own declaration is a silent `any`, so it is given the hand-written
 * one here — at the single import — rather than by augmenting the package,
 * which cannot replace an export that already exists.
 */
const init: InitPlanegcsModule = init_planegcs_module;

/**
 * Pinned, so that a solve is a pure function of its request.
 *
 * A design tool whose canvas differs between two people looking at one document
 * has failed at the only thing it does, and the library offers three dials that
 * would otherwise vary with a caller's mood. `DogLeg` is also the wrapper's own
 * default, and it is named here so that the default changing upstream is not a
 * silent change to every design in the tool.
 */
const ALGORITHM = Algorithm.DogLeg;
const MAX_ITERATIONS = 100;
const CONVERGENCE_THRESHOLD = 1e-10;

/** Radians per degree — the one unit conversion this package performs. */
const RADIANS_PER_DEGREE = Math.PI / 180;

export interface SketchOptions {
	/**
	 * Where the wasm lives.
	 *
	 * Injected rather than resolved, and that is the whole reason this package
	 * stays testable. `@salusoft89/planegcs` is an ordinary registry dependency,
	 * so Vite pre-bundles it and rewrites the `new URL("planegcs.wasm",
	 * import.meta.url)` inside its glue to a path in `node_modules/.vite/deps`,
	 * where no wasm was copied — which is why `clingo-wasm` gets away with no
	 * `locateFile` and this cannot: `clingo-wasm` is a symlinked workspace
	 * package and is excluded from pre-bundling. Under Node the glue's own
	 * fallback finds the file with `fs`, so the parameter is optional and the
	 * unit lane needs nothing.
	 *
	 * The app passes it from a `?url` import, exactly as `packages/vfs` does for
	 * Automerge — and the `?url` import stays in the app, so no module in this
	 * package is unloadable under `node --test`.
	 */
	wasmUrl?: string;
}

export interface SketchRequest {
	/** Every point the system holds, in CSS pixels, in canonical order. */
	points: ReadonlyArray<{ node: string; x: number; y: number }>;
	/** Which of those coordinates are nailed down, and by what. */
	pinned: ReadonlyArray<{ node: string; axis: "x" | "y"; tag: string }>;
	/** The rules, in canonical order. Tag is the bare `Constraint.id`. */
	rules: ReadonlyArray<SketchRule>;
	/**
	 * Points held a constant vector apart: `to = from + (dx, dy)`, in CSS pixels.
	 *
	 * Not a rule and never the document's — a link asserts an offset the caller
	 * already knows the value of, so that one rigid thing may hold more than one
	 * point. The caller that needs it is `design-core`'s anchors: a `distance`
	 * about two boxes' corners and a `bearing` about their centres are both
	 * meaningful and must coexist, and a box's corner is its centre plus half its
	 * own size — a *constant*, because a node's width is decided by the linear
	 * layer and is not an unknown of this system. So each such corner becomes its
	 * own point, tied to the node's other points by two of these.
	 *
	 * A link costs no freedom: it adds two coordinates and two equations, so
	 * `dof` still counts what the design left open rather than what the encoding
	 * added. Optional because a request that names one anchor per node needs
	 * none, which is every document until one asks for two.
	 */
	links?: ReadonlyArray<{
		tag: string;
		from: string;
		to: string;
		dx: number;
		dy: number;
	}>;
}

export type SketchRule =
	| { tag: string; kind: "distance"; a: string; b: string; px: number }
	| { tag: string; kind: "bearing"; a: string; b: string; deg: number }
	| { tag: string; kind: "collinear"; members: readonly string[] };

export type SketchOutcome =
	/**
	 * Free coordinates only — a pinned coordinate is not in `points`, and a node
	 * pinned on both axes is not a key of it at all.
	 *
	 * That absence is the type-level half of the round-trip guarantee.
	 * `coordinate_x` is a *constraint* whose residual is driven toward zero, not
	 * a substitution, and a `Converged` solve is one where the iteration stopped
	 * improving rather than one where the residual reached zero — so a pinned
	 * coordinate read back out of the system can come back displaced by an amount
	 * nothing bounds. Not returning it at all is what stops a caller quantizing
	 * that displacement into a number simplex had already decided exactly.
	 */
	| {
			status: "settled";
			points: Record<string, { x?: number; y?: number }>;
			dof: number;
			approximate: boolean;
			redundant: readonly string[];
	  }
	/** The conflicting set verbatim: rule tags and the caller's pin tags. */
	| { status: "conflicted"; tags: readonly string[] }
	| { status: "adrift" };

export interface Sketcher {
	solve(request: SketchRequest): SketchOutcome;
	close(): void;
}

/**
 * Instantiates the wasm module. A module holds no solver state — a system is
 * built and destroyed per {@link Sketcher.solve} — so one of these is opened
 * once at startup, beside the clingo session, and kept.
 */
export async function openSketcher(options?: SketchOptions): Promise<Sketcher> {
	const wasmUrl = options?.wasmUrl;
	const module = await init(
		wasmUrl === undefined ? undefined : { locateFile: () => wasmUrl },
	);
	let open = true;
	return {
		solve(request) {
			if (!open) throw new Error("sketcher is closed");
			return solveOnce(module, request);
		},
		close() {
			open = false;
		},
	};
}

/**
 * What the builder produced, kept together because reading the answer back out
 * needs all four parts: the primitives to push, the points to read, which of
 * their axes were pinned and therefore must not be read, and the map from the
 * ids this file minted back to the tags the caller supplied.
 */
interface Built {
	primitives: SketchPrimitive[];
	points: { node: string; point: SketchPoint }[];
	pinned: Map<string, Set<"x" | "y">>;
	tags: Map<string, string>;
}

/**
 * One solve, on a system built for it and destroyed after it.
 *
 * A fresh `GcsSystem` rather than a `clear_data()`d one, because a reused system
 * is a place for state to hide and reproducibility is the thing this package is
 * on trial for.
 */
function solveOnce(
	module: PlanegcsModule,
	request: SketchRequest,
): SketchOutcome {
	const built = build(request);
	const system = new module.GcsSystem();
	const wrapper = new GcsWrapper(system, module);
	try {
		wrapper.push_primitives_and_params(built.primitives);
		wrapper.set_max_iterations(MAX_ITERATIONS);
		wrapper.set_convergence_threshold(CONVERGENCE_THRESHOLD);
		const status = wrapper.solve(ALGORITHM);

		// The gate, and it is the only thing standing between a numerical failure
		// and a CSS `left`. `Failed` with a non-empty conflicting set is a genuine
		// over-determination and names the tags that cannot all hold; `Failed` with
		// an empty one is the iteration running out of steps, which is a statement
		// about the arithmetic and not about the rules, so it comes back as
		// `adrift` with nothing blamed. `SuccessfulSolutionInvalid` joins it: the
		// library is reporting that it reached a solution it cannot vouch for,
		// which is precisely the shape of a claim that must not become a fact.
		if (status !== SolveStatus.Success && status !== SolveStatus.Converged) {
			const tags = named(wrapper.get_gcs_conflicting_constraints(), built.tags);
			return tags.length > 0
				? { status: "conflicted", tags }
				: { status: "adrift" };
		}

		const dof = system.dof();
		const redundant = named(wrapper.get_gcs_redundant_constraints(), built.tags);
		wrapper.apply_solution();
		return {
			status: "settled",
			points: free(built, wrapper),
			dof,
			// `Converged` rather than `Success` means the iteration stopped
			// improving rather than that the residual reached zero. The answer is
			// applied either way, and the caller is told which it was.
			approximate: status === SolveStatus.Converged,
			redundant,
		};
	} finally {
		wrapper.destroy_gcs_module();
	}
}

/**
 * The canonical-order builder.
 *
 * Points sorted by node id, pins by node then axis, rules by tag — so that the
 * parameter vector the library sees is a function of the request and not of the
 * insertion history of whatever `Map` assembled it. Two requests that are equal
 * as sets build the same system, which is what makes a difference in the answer
 * attributable to the library rather than to a caller.
 */
function build(request: SketchRequest): Built {
	const primitives: SketchPrimitive[] = [];
	const points: { node: string; point: SketchPoint }[] = [];
	const pinned = new Map<string, Set<"x" | "y">>();
	const tags = new Map<string, string>();
	const at = new Map<string, SketchPoint>();

	// The point ids are minted here and are not the caller's node ids, so that a
	// node called `c1` and a rule tagged `c1` cannot collide inside the sketch
	// index — which throws on a duplicate id and would take an exploration with
	// it. Same reason a repeated node and a coordinate that is not a number are
	// dropped rather than pushed: this runs inside `interpret`, where a throw is
	// a design that does not draw.
	for (const p of [...request.points].sort(byNode)) {
		if (at.has(p.node)) continue;
		if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
		const point: SketchPoint = {
			id: `n${at.size}`,
			type: "point",
			x: p.x,
			y: p.y,
			fixed: false,
		};
		at.set(p.node, point);
		points.push({ node: p.node, point });
		primitives.push(point);
	}

	// Mints a primitive id and remembers which tag it answers to.
	let minted = 0;
	const tag = (name: string): string => {
		const id = `c${minted++}`;
		tags.set(id, name);
		return id;
	};

	// A pin is one constraint per axis, and it carries the caller's tag rather
	// than being `fixed: true` on the point: a fixed point is not a variable at
	// all, so it could never appear in a conflicting set, and "this sketch rule
	// contradicts the placement the linear layer already decided" is exactly the
	// sentence that has to survive as far as the panel.
	for (const pin of [...request.pinned].sort(byPin)) {
		const point = at.get(pin.node);
		if (point === undefined) continue;
		let axes = pinned.get(pin.node);
		if (axes === undefined) {
			axes = new Set();
			pinned.set(pin.node, axes);
		}
		if (axes.has(pin.axis)) continue;
		axes.add(pin.axis);
		primitives.push(
			pin.axis === "x"
				? { id: tag(pin.tag), type: "coordinate_x", p_id: point.id, x: point.x }
				: { id: tag(pin.tag), type: "coordinate_y", p_id: point.id, y: point.y },
		);
	}

	// `difference` is `param2 - param1 = difference`, one per axis, and it is the
	// whole of a rigid link: the offset is a driving number, so the library pushes
	// it as a fixed parameter and the pair can only move together. Two constraints
	// rather than one `p2p_distance` and one `p2p_angle`, which would say the same
	// thing about every pair except the ones that coincide — a zero-height box's
	// top and bottom edges are one point, and the angle between a point and itself
	// is not a number.
	for (const link of [...(request.links ?? [])].sort(byTag)) {
		const from = at.get(link.from);
		const to = at.get(link.to);
		if (from === undefined || to === undefined) continue;
		if (!Number.isFinite(link.dx) || !Number.isFinite(link.dy)) continue;
		primitives.push(
			{
				id: tag(link.tag),
				type: "difference",
				param1: { o_id: from.id, prop: "x" },
				param2: { o_id: to.id, prop: "x" },
				difference: link.dx,
			},
			{
				id: tag(link.tag),
				type: "difference",
				param1: { o_id: from.id, prop: "y" },
				param2: { o_id: to.id, prop: "y" },
				difference: link.dy,
			},
		);
	}

	for (const rule of [...request.rules].sort(byTag)) {
		switch (rule.kind) {
			case "distance": {
				const a = at.get(rule.a);
				const b = at.get(rule.b);
				if (a === undefined || b === undefined) break;
				if (!Number.isFinite(rule.px)) break;
				primitives.push({
					id: tag(rule.tag),
					type: "p2p_distance",
					p1_id: a.id,
					p2_id: b.id,
					distance: rule.px,
				});
				break;
			}
			case "bearing": {
				const a = at.get(rule.a);
				const b = at.get(rule.b);
				if (a === undefined || b === undefined) break;
				if (!Number.isFinite(rule.deg)) break;
				// Measured clockwise from straight right, which is what the library's
				// counter-clockwise `p2p_angle` already means in a plane whose y grows
				// downwards. So the degrees are converted and not negated: the
				// document's plane is the sketch plane, sign and all.
				primitives.push({
					id: tag(rule.tag),
					type: "p2p_angle",
					p1_id: a.id,
					p2_id: b.id,
					angle: rule.deg * RADIANS_PER_DEGREE,
				});
				break;
			}
			case "collinear": {
				if (rule.members.length < 3) break;
				const on: SketchPoint[] = [];
				for (const member of rule.members) {
					const point = at.get(member);
					if (point === undefined) break;
					on.push(point);
				}
				if (on.length !== rule.members.length) break;
				// One `point_on_line_ppp` per member past the second, every one of them
				// against the line through the first two, so an N-member rule is N-2
				// constraints that all answer to one tag. `tags` is what collapses them
				// back: a conflict names the rule once, however many of its constraints
				// the library reported.
				const [first, second] = on;
				for (const point of on.slice(2)) {
					primitives.push({
						id: tag(rule.tag),
						type: "point_on_line_ppp",
						p_id: point.id,
						lp1_id: first.id,
						lp2_id: second.id,
					});
				}
				break;
			}
		}
	}

	return { primitives, points, pinned, tags };
}

/** Code-unit order on one field, which is an order and not a preference. */
function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function byNode(a: { node: string }, b: { node: string }): number {
	return compare(a.node, b.node);
}

function byPin(
	a: { node: string; axis: string },
	b: { node: string; axis: string },
): number {
	return compare(a.node, b.node) || compare(a.axis, b.axis);
}

function byTag(a: { tag: string }, b: { tag: string }): number {
	return compare(a.tag, b.tag);
}

/**
 * The library's ids turned back into the caller's tags, in the order it
 * reported them and without repeats.
 *
 * The order is the library's rather than sorted because a conflicting set is
 * evidence and its order is part of what it says. The deduplication is because
 * one rule can be several constraints, and naming a collinearity three times
 * would be reporting this file's implementation rather than the rule.
 */
function named(
	ids: readonly string[],
	tags: ReadonlyMap<string, string>,
): string[] {
	const out: string[] = [];
	for (const id of ids) {
		const tag = tags.get(id);
		if (tag !== undefined && !out.includes(tag)) out.push(tag);
	}
	return out;
}

/**
 * The free coordinates, read out of the index `apply_solution()` wrote into.
 *
 * The index and not the primitives that were pushed: `pull_point` builds a fresh
 * object and replaces the index entry with it, leaving the pushed one untouched.
 * That is a second reason a refused solve cannot reach the caller's arrays, and
 * it is the reason this reads what it reads.
 *
 * A pinned axis is skipped rather than compared, and a node with both axes
 * pinned never becomes a key — see {@link SketchOutcome}.
 */
function free(
	built: Built,
	wrapper: GcsWrapper,
): Record<string, { x?: number; y?: number }> {
	const out: Record<string, { x?: number; y?: number }> = {};
	for (const { node, point } of built.points) {
		const solved = wrapper.sketch_index.get_sketch_point(point.id);
		const held = built.pinned.get(node);
		const box: { x?: number; y?: number } = {};
		if (held?.has("x") !== true) box.x = solved.x;
		if (held?.has("y") !== true) box.y = solved.y;
		if (box.x !== undefined || box.y !== undefined) out[node] = box;
	}
	return out;
}
