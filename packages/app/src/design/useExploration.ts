import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type Explanation,
	type Exploration,
	Explorer,
	type Frame,
	type Freedom,
	type Measurements,
	type Question,
	type Relaxation,
	type Scene,
	type SketchReport,
	UnsatisfiableError,
} from "@clingo-design/design-core";

import { sketcher } from "../sketch/sketcher";
import { workerSolver } from "../solver/workerSolver";

export interface ExplorationState {
	exploration: Exploration | null;
	generated: string;
	error: string | null;
	/**
	 * Constraint ids the solver blamed when the document admits no design.
	 * Empty for every other kind of failure, including a bad hand-written rule,
	 * which the solver cannot attribute to anything the UI owns.
	 */
	conflict: string[];
	/** Pinned variables the solver blamed, when the pins are what conflict. */
	pinConflict: string[];
	/**
	 * The ways out of that conflict, cheapest first, each with the design it
	 * leads to. Empty for a failure nothing the user owns can fix.
	 */
	relaxations: Relaxation[];
	/**
	 * True when the relaxation search proved it had found every way out of this
	 * size, so the panel may say "these are the ways out" rather than "here are
	 * some".
	 */
	exhaustive: boolean;
	solving: boolean;
	/** How far the probed nodes' solver-owned coordinates can still travel. */
	freedom: Freedom;
	/** True while the probe is out, so the UI can wait rather than guess. */
	probing: boolean;
	/**
	 * The last why-question and its answer, or the question alone while the
	 * solver is still working on it.
	 *
	 * One at a time, and that is the point rather than a limitation: the answer
	 * costs about one solve per switch the document has, so it is a thing
	 * somebody asks, not a column the panel fills in. Cleared by every
	 * exploration — an answer about the previous document would be a lie in the
	 * shape of a sentence.
	 */
	why: { question: Question; answer: Explanation | null } | null;
	/**
	 * What the second solver made of the design on screen, or nothing where the
	 * document holds no sketch rule at all.
	 *
	 * The universe on screen and not the whole space, because a sketch conflict
	 * is *per universe*: a `distance` that cannot hold in universe 7 holds
	 * perfectly in universe 1, and the panel is read beside a canvas that is
	 * showing one of them. `universes[0]` is the one the design view draws and
	 * the one the freedom probe is asked about, so it is the one this reports.
	 */
	sketch: SketchReport | null;
	/**
	 * Constraint ids the sketch blames, and the `<node>:<axis>` pins it could not
	 * have — the two halves of {@link SketchReport}, lifted out so the Rules panel
	 * takes them as props.
	 *
	 * Deliberately **not** merged into {@link conflict}. That field means "the
	 * solver blamed these when the document admits no design", it is set only
	 * beside `exploration: null`, and the impossible-document headline is drawn
	 * off it. A sketch conflict is the opposite situation — the document is
	 * satisfiable and there are designs on the screen — so merging the two would
	 * put the impossible-document sentence over a canvas full of designs.
	 */
	sketchConflict: string[];
	sketchPinned: string[];
	/** Constraint ids the sketch found say nothing new — see `dof < 0`. */
	redundant: string[];
	/**
	 * True when the sketch did not settle and blames nothing for it.
	 *
	 * `adrift` rather than `unsettled`, which in this studio already means "this
	 * variable has more than one value across the multiverse" — see the
	 * `varyingCount` the status line takes two lines from this hook's own output.
	 * The design is real; it is simply not moored to the sketch rules.
	 */
	adrift: boolean;
}

/**
 * The five sketch fields as they read when nothing has been sketched.
 *
 * One constant rather than five spellings, because they are cleared in three
 * places — the initial state, the success branch and the failure branch — and
 * three copies of "the sketch says nothing" would be three chances to leave one
 * of them holding the previous document's answer. The same reason `freedom` is
 * spelled `{}` in all three.
 */
const NO_SKETCH = {
	sketch: null,
	sketchConflict: [] as string[],
	sketchPinned: [] as string[],
	redundant: [] as string[],
	adrift: false,
} satisfies Pick<
	ExplorationState,
	"sketch" | "sketchConflict" | "sketchPinned" | "redundant" | "adrift"
>;

/** The same five, read off the universe on screen. */
function sketchOf(exploration: Exploration): Pick<
	ExplorationState,
	"sketch" | "sketchConflict" | "sketchPinned" | "redundant" | "adrift"
> {
	const report = exploration.universes[0]?.sketch;
	if (!report) return NO_SKETCH;
	return {
		sketch: report,
		sketchConflict: [...report.conflict],
		sketchPinned: [...report.pinned],
		redundant: [...report.redundant],
		adrift: report.status === "adrift",
	};
}

/** What the hook hands back: the answer, and the way to ask another question. */
export interface ExplorationApi extends ExplorationState {
	/** Ask a why-question, or `null` to put the answer away. */
	onWhy: (question: Question | null) => void;
}

/**
 * Re-explores whenever the document changes.
 *
 * One {@link Explorer} lives for the life of the editor, so an edit that does
 * not change the compiled program — a rename, a text tweak outside a layout —
 * costs a solve rather than a re-grounding. Solves run in a worker, so a slow
 * one does not freeze the canvas.
 *
 * `measurements` must be referentially stable across renders that do not
 * change it: it is an effect dependency, and a fresh object every render would
 * re-solve forever.
 */
export function useExploration(
	scene: Scene,
	limit = 24,
	seed = 1,
	pins: Readonly<Record<string, number>> = {},
	measurements: Measurements = {},
	probeIds: readonly string[] = [],
): ExplorationApi {
	const [state, setState] = useState<ExplorationState>({
		exploration: null,
		generated: "",
		error: null,
		conflict: [],
		pinConflict: [],
		relaxations: [],
		exhaustive: true,
		solving: true,
		freedom: {},
		probing: false,
		why: null,
		...NO_SKETCH,
	});

	const explorer = useRef<Explorer | null>(null);
	if (explorer.current === null)
		explorer.current = new Explorer(workerSolver, sketcher());

	// Release the grounding when the editor goes away; it lives in the wasm heap.
	useEffect(() => {
		const owned = explorer.current;
		return () => {
			void owned?.close();
			explorer.current = null;
		};
	}, []);

	const run = useRef(0);

	useEffect(() => {
		const generation = ++run.current;
		setState((s) => ({ ...s, solving: true }));

		const timer = setTimeout(async () => {
			try {
				const current = explorer.current;
				if (!current) return;
				// `explore` compiles once and hands the generated half back, so
				// the power panel does not pay for a second compile.
				const exploration = await current.explore(scene, {
					limit,
					seed,
					pins,
					measurements,
				});
				if (generation !== run.current) return;
				setState({
					exploration,
					generated: exploration.generated,
					error: null,
					conflict: [],
					pinConflict: [],
					relaxations: [],
					exhaustive: true,
					solving: false,
					// Whatever was probed last was probed against another document.
					freedom: {},
					probing: false,
					// So was whatever was explained last.
					why: null,
					...sketchOf(exploration),
				});
			} catch (err) {
				if (generation !== run.current) return;
				setState((s) => ({
					exploration: null,
					generated: s.generated,
					error: err instanceof Error ? err.message : String(err),
					conflict: err instanceof UnsatisfiableError ? err.conflict : [],
					pinConflict: err instanceof UnsatisfiableError ? err.pinned : [],
					relaxations:
						err instanceof UnsatisfiableError ? err.relaxations : [],
					exhaustive:
						err instanceof UnsatisfiableError ? err.exhaustive : true,
					solving: false,
					freedom: {},
					probing: false,
					why: null,
					...NO_SKETCH,
				}));
			}
		}, 150);

		return () => clearTimeout(timer);
	}, [scene, limit, seed, pins, measurements]);

	/**
	 * Asks how far the probed nodes can still travel, once the design they
	 * would be measured against is on screen.
	 *
	 * A second pass on purpose: two solves per coordinate comes to about what a
	 * whole exploration costs, so this must not sit between an edit and the
	 * design appearing. It runs on the grounding the exploration left open, so
	 * it is solves and nothing else — and it is skipped entirely for a
	 * selection whose geometry is the document's own, which is most of them.
	 */
	const { exploration } = state;
	const answered = exploration?.universes[0]?.solved;
	/**
	 * The same record with the sketch layer's coordinates taken out of it.
	 *
	 * `probeFreedom` decides *which* coordinates to probe from the keys of what
	 * it is handed — a coordinate is in `solved` exactly when the solver decided
	 * it — and a coordinate PlaneGCS decided is one clingo did not. A node named
	 * only by a sketch rule has no `gcoord/2` and therefore no `gprobe/3` atom in
	 * the grounding, so asking about it fires four solves that come back
	 * UNSATISFIABLE immediately, `Travel` is null on both axes, and the
	 * inspector reads that as *not pinned* — offering the Position field as
	 * freely editable for the one node whose position the sketch owns.
	 *
	 * So the filter is here rather than in `freedom.ts`, which nothing in this
	 * track touches, and the sketch's own answer about those coordinates reaches
	 * the inspector through `SketchReport.owned` instead.
	 */
	const owned = state.sketch?.owned;
	const solved = useMemo(() => {
		if (!answered || !owned) return answered;
		const out: Record<string, Partial<Frame>> = {};
		for (const [id, box] of Object.entries(answered)) {
			const taken = owned[id];
			if (!taken || taken.length === 0) {
				out[id] = box;
				continue;
			}
			const rest = { ...box };
			for (const axis of taken) delete rest[axis];
			// A node whose every solved number is the sketch's is a node the probe
			// has nothing to be asked about, and an empty record would still be a
			// key it walks.
			if (Object.keys(rest).length > 0) out[id] = rest;
		}
		return out;
	}, [answered, owned]);
	// The ids as a value, so a fresh array of the same selection is not a
	// reason to spend eight solves again.
	const probeKey = probeIds.join(" ");
	useEffect(() => {
		if (!solved) return;
		const wanted = probeKey
			.split(" ")
			.filter((id) => id.length > 0 && solved[id] !== undefined);
		// Nothing here is the solver's, so there is nothing to say — and saying
		// the last selection's answer about this one would be a lie.
		if (wanted.length === 0) {
			setState((s) =>
				s.probing || Object.keys(s.freedom).length > 0
					? { ...s, freedom: {}, probing: false }
					: s,
			);
			return;
		}
		let live = true;
		setState((s) => ({ ...s, freedom: {}, probing: true }));
		void explorer.current?.probe(solved, wanted).then(
			(freedom) => {
				if (live) setState((s) => ({ ...s, freedom, probing: false }));
			},
			// A probe that raced a re-grounding lost its session; the exploration
			// that overtook it will start another one.
			() => {
				if (live) setState((s) => ({ ...s, probing: false }));
			},
		);
		return () => {
			live = false;
		};
	}, [solved, probeKey]);

	/**
	 * Asks the solver why a value came out as it did, or why the one beside it
	 * cannot.
	 *
	 * A callback rather than an effect, because unlike the freedom probe this is
	 * not a consequence of the selection — it is a question somebody asked, and
	 * it costs about one solve per switch the document has. The question goes
	 * into state immediately so the row can say it is asking, and the answer
	 * lands beside it.
	 *
	 * `asked` guards the race: a second question, a re-exploration, or a click
	 * that puts the answer away all bump it, and a reply for an older question
	 * is dropped rather than shown against the new one.
	 */
	const asked = useRef(0);
	const onWhy = useCallback((question: Question | null) => {
		const generation = ++asked.current;
		if (!question) {
			setState((s) => (s.why === null ? s : { ...s, why: null }));
			return;
		}
		setState((s) => ({ ...s, why: { question, answer: null } }));
		void explorer.current?.why(question).then(
			(answer) => {
				if (generation !== asked.current) return;
				setState((s) => ({ ...s, why: { question, answer } }));
			},
			// The grounding went away under it — an edit overtook the question.
			// The exploration that overtook it has already cleared `why`.
			() => {
				if (generation === asked.current) {
					setState((s) => ({ ...s, why: null }));
				}
			},
		);
	}, []);

	// A new exploration invalidates any question in flight as well as any answer
	// already shown: `explore` clears the state, and this stops the reply.
	useEffect(() => {
		asked.current++;
	}, [exploration]);

	return { ...state, onWhy };
}
