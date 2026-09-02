import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import {
	EMU_PER_PX,
	type LinkHit,
	type ModelScene,
	type Point,
	type Scene,
	type SceneNode,
	type Trigger,
	documentBounds,
	emptyScene,
	instanceAt,
	linkAt,
	pageIdOf,
	varyingVars,
} from "@clingo-design/design-core";

import { Artboard } from "../design/Artboard";
import { gestures } from "../design/gesture";
import { measureScene } from "../design/measureText";
import { edgeAt, motionOf } from "../design/playbackMotion";
import { useDocumentFonts } from "../design/useDocumentFonts";
import { useExploration } from "../design/useExploration";
import { useMachinePlayback } from "../design/useMachinePlayback";
import { pagePath, useAssetFiles, useProject, usePages } from "../projects/store";
import { carried, decodeDesign, encodeDesign, holdable } from "./design-param";
import styles from "./Present.module.css";

/**
 * The prototype, walked.
 *
 * **A route and not a third view of the canvas**, and the pressure to make it one
 * arrives from the same place it always does. `ViewSwitcher` turned that pressure
 * away once already, on the grounds that a view is what the *whole canvas* shows
 * and there are two of those; this is a stronger case than the one it turned
 * away, for two reasons of its own. A presentation **changes which document is on
 * screen** — it walks from `/pages/Home.scene` to `/pages/About.scene` — and a
 * control whose third position navigates between documents is not a view control.
 * And a presentation **has to be a link you can send**: the whole point of a
 * prototype is being handed to somebody who is not editing, and editor state
 * cannot be handed to anybody. There is also nothing left of the canvas here — no
 * camera, no rulers, no layer list, no panels, no toolbar, no selection — and a
 * view that removes the thing it is a view of is a screen.
 *
 * **What renders it is the artboard, live — not the HTML export in a frame.** The
 * export-in-an-iframe gets one real thing right, which is that what you show is
 * the artefact you ship, and everything else about it is wrong here. It is one
 * universe, flattened, so flipping designs mid-presentation would mean re-solving
 * and re-emitting on every arrow key. Every navigation would be an export: solve
 * the page, measure its text, resolve its images to data URIs, emit a file,
 * *then* draw. The app cannot see inside a frame, so the chrome, the universe
 * control and the history integration would all become a `postMessage` protocol
 * into generated script — a second runtime, for a feature whose entire value is
 * that it is the same picture. And it would make the export grow a feature only
 * the presenter uses, which is the inversion of why links reach the export at
 * all.
 *
 * The artboard gets the important things right by already being right: it draws
 * `universe.model`, so a rule that moves a node shows up here without this file
 * knowing such a rule exists, and `useMachinePlayback` reads the same
 * `MachineTable` the exported `<script>` ships. What it gets wrong, said out
 * loud: fonts, text wrapping and the pacing of a transition come from the
 * studio's stylesheet rather than the export's, so a presentation is *the design*
 * and not a preview of the file. That is the right trade — the artefact has its
 * own way of being looked at, which is opening it.
 *
 * It renders **no `Editor`**. That component is seventeen hundred lines about
 * selection, marquees, snapping and drop targets, every one of which is off under
 * `previewing`; instantiating it to get three pointer handlers would be taking
 * the whole editor along to not use it. The three it needs are the pure functions
 * lifted out of it for exactly this — `instanceAt`, `linkAt` and the drag
 * recogniser — so there is still one implementation of "what is the pointer
 * over".
 */

/** How many designs a presentation will enumerate before it stops counting. */
const LIMIT = 24;

/**
 * The seed, fixed.
 *
 * An index into a list of universes is only meaningful against one document and
 * one seed, which is exactly what a presentation is: nothing here edits, so the
 * list cannot move under the address. A presenter who reloads gets design 3 of 12
 * back. Nobody should try to make `u` survive an *edit* — that is a different
 * promise and this is not the place to make it.
 */
const SEED = 1;

export function Present() {
	const { id, page: named } = useParams();
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();
	const names = usePages(id);

	// Resolved against the tree and rewritten with `replace`, exactly as `Project`
	// does it and for the same reason: a url naming a page that has been renamed
	// or deleted should land somewhere rather than report the project as gone, and
	// `replace` keeps the broken address out of the back stack.
	const known = named !== undefined && names.includes(named);
	const active = known ? named : names[0];
	const page = useProject(id, active === undefined ? undefined : pagePath(active));
	useEffect(() => {
		if (!id || named === undefined || known || names.length === 0) return;
		navigate(
			`/p/${encodeURIComponent(id)}/present/${encodeURIComponent(names[0])}`,
			{ replace: true },
		);
	}, [id, named, known, names, navigate]);

	const scene = page?.scene ?? EMPTY;

	/**
	 * The faces, registered, and the measurements taken *in* them.
	 *
	 * One hook and one dependency, and without them a presentation is the tool's
	 * own artefact rendered wrong — silently. No face registered means the
	 * presentation measures and paints in the fallback: self-consistent, which is
	 * why nobody would notice, and not the design — the line breaks here would
	 * differ from the line breaks in the studio, for the same document, at the same
	 * moment. The `@property` registrations that a gradient needs are the other
	 * half of the same failure and are mounted at the app root rather than the
	 * studio's, precisely so that this route carries them.
	 */
	const held = useAssetFiles(id);
	const heldPaths = useMemo(() => held.map((f) => f.path), [held]);
	const ready = useDocumentFonts(scene, heldPaths);
	const readyKey = useMemo(() => [...ready].sort().join("\n"), [ready]);
	const measurements = useMemo(
		() => measureScene(scene, ready),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[scene, readyKey],
	);

	/**
	 * The design carried in from wherever we came from, narrowed to what this page
	 * can actually hold.
	 *
	 * A pin naming a variable this document does not have is an assumption on an
	 * atom that was never grounded, which is UNSAT for a reason nobody can see —
	 * and in a presentation there is no panel to see it in, so it must not be
	 * possible. That is the studio's own stale-pin rule, moved into a pure function
	 * so both callers can have it.
	 */
	const design = params.get("d");
	const pins = useMemo(
		() => holdable(scene, decodeDesign(design)),
		[scene, design],
	);

	const { exploration } = useExploration(scene, LIMIT, SEED, pins, measurements);
	const universes = exploration?.universes ?? [];
	const at = Math.min(
		Math.max(Number(params.get("u") ?? 0) || 0, 0),
		Math.max(universes.length - 1, 0),
	);
	const universe = universes[at];
	const model = universe?.model;

	const playback = useMachinePlayback(scene);
	const [motion, setMotion] = useState<
		{ duration: number; delay: number; easing: string } | undefined
	>(undefined);
	const context = useMemo(
		() => ({ tokens: scene.tokens, picks: universe?.pick ?? {} }),
		[scene.tokens, universe?.pick],
	);
	const byId = useMemo(() => {
		const out = new Map<string, SceneNode>();
		const walk = (nodes: readonly SceneNode[]): void => {
			for (const node of nodes) {
				out.set(node.id, node);
				if (node.children) walk(node.children);
			}
		};
		walk(scene.nodes);
		return out;
	}, [scene.nodes]);

	/* ---------------------------------------------------------------- */
	/* Scaled to fit                                                     */
	/* ---------------------------------------------------------------- */

	const host = useRef<HTMLDivElement | null>(null);
	const [size, setSize] = useState({ width: 0, height: 0 });
	useEffect(() => {
		const element = host.current;
		if (!element) return;
		const read = () =>
			setSize({ width: element.clientWidth, height: element.clientHeight });
		read();
		const observer = new ResizeObserver(read);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	/**
	 * The whole page, scaled to fit — **whatever is on it, all of it.**
	 *
	 * A page with three artboards presents as three artboards, because the document
	 * does not say which one is "the screen" and picking the first would make a
	 * presentation depend on paint order in a way nobody chose. One screen per page
	 * is what the pages are for.
	 *
	 * No cap on the scale. A presentation is a presentation; a card blown up to
	 * fill a display is what was asked for, and it is vector DOM rather than
	 * pixels.
	 */
	const bounds = useMemo(() => documentBounds(scene, context), [scene, context]);
	const wide = bounds.width / EMU_PER_PX;
	const tall = bounds.height / EMU_PER_PX;
	const scale =
		wide > 0 && tall > 0 && size.width > 0
			? Math.min(size.width / wide, size.height / tall)
			: 1;

	/** Client coordinates to document coordinates, the same inverse the Editor uses. */
	const toDocument = useCallback(
		(event: { clientX: number; clientY: number }): Point => {
			const box = host.current?.getBoundingClientRect();
			if (!box) return { x: 0, y: 0 };
			const left = box.left + (box.width - wide * scale) / 2;
			const top = box.top + (box.height - tall * scale) / 2;
			return {
				x: bounds.x + ((event.clientX - left) / scale) * EMU_PER_PX,
				y: bounds.y + ((event.clientY - top) / scale) * EMU_PER_PX,
			};
		},
		[bounds.x, bounds.y, wide, tall, scale],
	);

	/* ---------------------------------------------------------------- */
	/* Pointing at it                                                    */
	/* ---------------------------------------------------------------- */

	const hovering = useRef<string | null>(null);
	/**
	 * The linked node the pointer is inside, so a hover link fires once.
	 *
	 * Beside {@link hovering} rather than merged into it, because the two answer
	 * different questions of the same pointer: that one is the instance a machine
	 * is being driven through, and this one is the node a link is on — which is
	 * usually not an instance and, on a document with no machine at all, never is.
	 * A ref for the reason its neighbour is one: a crossing is a fact about the
	 * previous event, and nothing here is drawn.
	 */
	const linked = useRef<string | null>(null);
	const pressed = useRef<string | null>(null);
	const drag = useRef(gestures());

	function fire(instance: string, trigger: Trigger) {
		const edge = edgeAt(scene, byId.get(instance), playback.playing, instance, trigger);
		if (edge) setMotion(motionOf(edge, model, context));
		playback.fire(instance, trigger);
	}

	/**
	 * The page list, keyed by the constant a link carries.
	 *
	 * A link in the answer set holds `pg_about_us_1k3z9`, because an atom's
	 * argument has to be a legal constant, and a hash does not run backwards. So
	 * the only way from an edge to a document is to compute the ids of the pages
	 * this project has and look the answer up — which is `pageIndexOf`'s argument,
	 * over names rather than paths because names are what a route segment holds.
	 */
	const pagesById = useMemo(() => {
		const out: Record<string, string> = {};
		for (const name of names) out[pageIdFor(name)] = name;
		return out;
	}, [names]);

	/**
	 * Follow a link, carrying the design forward.
	 *
	 * **A push**, and that is the whole of the back button: following a link writes
	 * a url that already holds the design, so going back retraces the walk page by
	 * page and restores each page's pins with it. Flipping a design is a `replace`,
	 * for the same reason from the other side — if it pushed, back would walk
	 * universes instead of pages, spending the feature the walk is built on.
	 *
	 * A link to the page you are already on replaces rather than pushes: a history
	 * entry identical to the one before it is a back button that appears not to
	 * work, and a presenter pressing it four times is the failure that produces.
	 *
	 * A **dangling** link — a `to` no page resolves — does nothing at all. No
	 * navigation, no message. That is the same silence `composeLibrary` chose, and
	 * present mode is not where a broken document is diagnosed: the Inspector, the
	 * layer list and the Pages panel all say so, and a rule can refuse to ship it.
	 * A presenter is showing the thing, not debugging it.
	 */
	function follow(hit: LinkHit) {
		const target = pagesById[hit.to];
		if (target === undefined || !id) return;
		const forward = carried(
			pins,
			universe?.pick ?? {},
			exploration ? varyingVars(exploration) : [],
		);
		const query = encodeDesign(forward);
		navigate(
			`/p/${encodeURIComponent(id)}/present/${encodeURIComponent(target)}${
				query === "" ? "" : `?d=${encodeURIComponent(query)}`
			}`,
			{ replace: target === active },
		);
	}

	/**
	 * One event, two readers, in this order: the machine trigger first, then the
	 * link.
	 *
	 * A `pointerdown` that both presses a button and follows it should press it,
	 * because the press is what the design says happens and the navigation is what
	 * happens next.
	 */
	function onLink(hit: LinkHit | undefined, trigger: Trigger) {
		if (hit === undefined || hit.on !== trigger) return;
		follow(hit);
	}

	function onPointerDown(event: React.PointerEvent) {
		if (event.button !== 0) return;
		const point = toDocument(event);
		const instance = instanceAt(scene.nodes, point, universe?.solved, context)?.id ?? null;
		pressed.current = instance;
		if (instance !== null) {
			drag.current.down(instance, event);
			fire(instance, "pointerdown");
		}
		onLink(linkAt(model ?? EMPTY_MODEL, point), "pointerdown");
	}

	function onPointerMove(event: React.PointerEvent) {
		const on = pressed.current;
		const began = drag.current.move(event);
		if (began !== undefined && on !== null) fire(on, began);

		const point = toDocument(event);

		// A hover link fires on the **crossing**, which is what `pointerenter` means
		// to a browser — the same word, off the same table, so the presentation and
		// the exported file cannot disagree about what a hover is.
		//
		// Two separate crossings are tracked here and they are not the same
		// question, which is the whole reason this is above the machine's own
		// hover and not folded into it. A machine's hover is a crossing into an
		// *instance*; a link's is a crossing into whatever node carries the link,
		// which is very often not an instance at all — the ordinary linked card is
		// a frame on a page with no components anywhere. Asking the instance
		// hit-test first and returning early when it had nothing to say would make
		// `pointerenter`, the one of the three link triggers worth defending, dead
		// on every document that has no machine in it.
		//
		// And it is a crossing rather than a state, because `follow` navigates:
		// firing per `pointermove` inside a linked box would push one history entry
		// per pixel of travel between the navigate and the unmount, which spends
		// the back button on exactly the walk it exists to retrace.
		const hit = linkAt(model ?? EMPTY_MODEL, point);
		if ((hit?.id ?? null) !== linked.current) {
			linked.current = hit?.id ?? null;
			onLink(hit, "pointerenter");
		}

		const now = instanceAt(scene.nodes, point, universe?.solved, context)?.id ?? null;
		if (now === hovering.current) return;
		if (hovering.current !== null) fire(hovering.current, "pointerleave");
		hovering.current = now;
		if (now !== null) fire(now, "pointerenter");
	}

	function onPointerUp(event: React.PointerEvent) {
		const was = pressed.current;
		pressed.current = null;
		const ended = drag.current.end();
		if (ended) fire(ended.on, ended.trigger);
		if (was !== null) fire(was, "pointerup");
		// A drag that ended is not also a click — and here that sentence has to cover
		// the *link* as well as the machine, because in a presentation the click and
		// the navigation are the same act. The exported file says the same thing with
		// a capture-phase `preventDefault`; this is the studio-side half of it.
		if (drag.current.swallows("click")) return;
		const point = toDocument(event);
		const still = instanceAt(scene.nodes, point, universe?.solved, context)?.id ?? null;
		if (was !== null && still === was) fire(was, "click");
		onLink(linkAt(model ?? EMPTY_MODEL, point), "click");
	}

	function onPointerLeave() {
		if (hovering.current !== null) fire(hovering.current, "pointerleave");
		const ended = drag.current.end();
		if (ended) fire(ended.on, ended.trigger);
		drag.current.swallows("click");
		hovering.current = null;
		// And the link the pointer was inside, so coming back over it is a fresh
		// crossing rather than a hover the presenter has decided already happened.
		linked.current = null;
		pressed.current = null;
	}

	/* ---------------------------------------------------------------- */
	/* The chrome                                                        */
	/* ---------------------------------------------------------------- */

	const step = useCallback(
		(by: number) => {
			if (universes.length < 2) return;
			const next = (at + by + universes.length) % universes.length;
			const query = new URLSearchParams(params);
			query.set("u", String(next));
			// `replace`, because flipping a design is not a navigation — see `follow`.
			setParams(query, { replace: true });
		},
		[at, params, setParams, universes.length],
	);

	const exit = useCallback(() => {
		if (!id) return;
		// A push to the editor for the page currently on screen, and deliberately not
		// `navigate(-1)`: somebody five pages into a walk who presses Exit wants the
		// editor, on the page they were looking at, in one act. `-1` would put them
		// back one page of the presentation. It leaves the presentation in the
		// history, so back re-enters it, which is right.
		navigate(
			`/p/${encodeURIComponent(id)}${active === undefined ? "" : `/${encodeURIComponent(active)}`}`,
		);
	}, [id, active, navigate]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			// `[` and `]` step the design and `Escape` leaves. The arrow keys are left
			// to the browser and the OS: a presentation is a thing people hand to
			// somebody, and stealing ← → is stealing the gesture they will reach for
			// to go back.
			if (event.key === "[") step(-1);
			else if (event.key === "]") step(1);
			else if (event.key === "Escape") exit();
			else return;
			event.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [step, exit]);

	/**
	 * Dimmed after two idle seconds, restored on any pointer move.
	 *
	 * One clock and not two. A repeating timer beside the idle one would dim the
	 * bar on a fixed grid rather than two seconds after the last move, so a
	 * presenter who woke it at 1.9 seconds would watch it go out at 2.0 — which
	 * looks like a control that ignores you. The wake is a `setState` to the value
	 * it already holds on all but the first move of a sweep, and React bails out of
	 * those without rendering, so this costs nothing per pixel.
	 */
	const [awake, setAwake] = useState(true);
	useEffect(() => {
		const wake = () => setAwake(true);
		window.addEventListener("pointermove", wake);
		return () => window.removeEventListener("pointermove", wake);
	}, []);
	useEffect(() => {
		if (!awake) return;
		const timer = setTimeout(() => setAwake(false), 2000);
		return () => clearTimeout(timer);
	}, [awake]);

	if (page === undefined) return null;

	return (
		<main className={styles.present} data-role="present">
			<div
				ref={host}
				className={styles.stage}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerLeave={onPointerLeave}
			>
				{universe ? (
					<div
						className={styles.fit}
						style={
							{
								width: wide,
								height: tall,
								transform: `translate(-50%, -50%) scale(${scale})`,
								// The same custom properties the studio's canvas writes, out
								// of the same two functions: the component that knows *what*
								// moves declares the transition and the component that knows
								// *how fast* sets the numbers.
								...(motion
									? {
											"--dc-play-duration": `${motion.duration}ms`,
											"--dc-play-delay": `${motion.delay}ms`,
											"--dc-play-easing": motion.easing,
										}
									: {}),
							} as React.CSSProperties
						}
					>
						<Artboard
							scene={scene}
							universe={universe}
							playing={playback.playing}
							scrub={playback.scrub}
							style={{
								position: "absolute",
								left: -bounds.x / EMU_PER_PX,
								top: -bounds.y / EMU_PER_PX,
							}}
						/>
					</div>
				) : null}
			</div>

			<div
				className={styles.chrome}
				data-role="present-chrome"
				data-awake={awake ? "" : undefined}
			>
				<span className={styles.page} data-role="present-page">
					{active ?? "…"}
				</span>
				{/* Absent entirely where there is one design, because a control that
				    always reads "1 of 1" teaches people to ignore it. */}
				{universes.length > 1 ? (
					<span className={styles.designs} data-role="present-design">
						<button type="button" onClick={() => step(-1)} aria-label="Previous design">
							◀
						</button>
						Design {at + 1} of {universes.length}
						<button type="button" onClick={() => step(1)} aria-label="Next design">
							▶
						</button>
					</span>
				) : null}
				<button
					type="button"
					className={styles.exit}
					data-role="present-exit"
					onClick={exit}
				>
					Exit
				</button>
			</div>
		</main>
	);
}

/** The scene a route with nothing open shows, so the hooks below it never see undefined. */
const EMPTY: Scene = emptyScene();

/** And the model, for the two hit-tests that run before the first answer arrives. */
const EMPTY_MODEL: ModelScene = {
	roots: [],
	byId: {},
	groups: {},
	variables: {},
	wears: {},
	states: {},
	shown: {},
	shownByLayer: {},
	keyframes: {},
	machines: {},
	fightsAt: {},
	triangles: {},
	assets: {},
	looks: {},
	links: {},
	goes: [],
};

/**
 * A page's constant, from the name this file holds.
 *
 * `pageIdOf` takes a *path* and the page list is names, so the conversion is
 * `pagePath` then `pageIdOf` — spelled once, here, so the two halves cannot
 * drift apart into two answers about which constant a page takes.
 */
const pageIdFor = (name: string): string => pageIdOf(pagePath(name));
