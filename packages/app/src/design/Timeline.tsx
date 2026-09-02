import { useEffect, useRef, useState } from "react";

import {
	DEFAULT_EASING,
	DEFAULT_UNIT,
	DIMENSIONS_3D,
	type Keyframe,
	type LoopMode,
	type Machine,
	type ModelTimeline,
	PROPS,
	type Picks,
	type PropName,
	type Scene,
	TURNS,
	TURN_NAMES,
	TIMELINE_CLOCKS,
	type Term,
	type Timeline as TimelineDoc,
	type Track,
	type TrackField,
	type Turn,
	type ValueType,
	VALUE_TYPES,
	addKeyframe,
	addTrack,
	clockOf,
	componentDef,
	deleteKeyframe,
	deleteTimeline,
	deleteTrack,
	dimensionSpec,
	findInTree,
	keyEaseVar,
	keyEasing,
	keyTimeVar,
	keyValueVar,
	lit,
	nodeNames,
	propValues,
	renameTimeline,
	resolveValue,
	setTimelineLength,
	setTimelineLoop,
	sharedPropsOfKinds,
	solvedKeys,
	statePlays,
	timelineLength,
	timelineLenVar,
	tokensFor,
	tokensOfType,
	trackTerm,
	updateKeyframe,
	writeDuration,
} from "@clingo-design/design-core";

import { CurveField } from "./CurveField";
import { ValueEditor } from "./ValueEditor";
import { cx } from "./cx";
import { fontMenu } from "./fontFiles";
import styles from "./Timeline.module.css";

/**
 * One timeline: its tracks, its keyframes, and where the scrubber is.
 *
 * **The solver decides keyframes and it never decides frames.** There is no
 * frame rate anywhere in this editor, because there is none in the document, the
 * program, the model or the export: grounding scales with the number of
 * keyframes and with nothing else, so a nine-key timeline costs the same whether
 * it runs for 100ms or ten seconds and whether the browser draws it at 60Hz or
 * 120. What that buys is visible in every row here — a keyframe's time *and* its
 * value are ordinary {@link ValueEditor}s, so both may name a token, follow a
 * motion scale and hold alternatives, and two alternatives inside a keyframe
 * really are two designs. What it costs is that everything *between* two
 * keyframes is interpolated rather than solved, by the compositor in the export
 * and by lerping two copies the answer set already holds on the canvas.
 *
 * **The scrubber is editor state and costs nothing.** Dragging it does not
 * re-solve, does not re-ground and does not land in undo: the two keyframes
 * either side of the moment are already in the one answer set, and the canvas
 * lerps between them. That is the same claim playing a state makes, one rung
 * along, and it is why the scrub position lives in the studio beside the pins
 * rather than in the document beside the keys.
 *
 * **A track names exactly one of a property, a dimension and a rotation.** A
 * track that named two would be two tracks sharing a keyframe list, and the
 * instant somebody moved a key on one of them it would be two tracks anyway. So
 * the "+ Track" control asks for a part and then for one field, and the track's
 * identity in every edit here is its **term** — `trkd(panel,y)` — rather than an
 * index, because that is the name `mtrack/3`, `mkey/4`, `kfr(...)` and a rule
 * that names a keyframe copy already agree on.
 *
 * **Keyframes are addressed by a 1-based index**, which is what the compiler
 * emits and therefore what a violation prints. The index is the *document's*
 * order, not this universe's: `solvedKeys` sorts on the resolved time, so a
 * token that sent key 3 in front of key 2 changes which row is drawn first and
 * changes neither row's number. That case has a name — `mkbackwards/4` — and it
 * arrives here as {@link TimelineProps.suspect}.
 */
export interface TimelineProps {
	scene: Scene;
	machine: Machine;
	timeline: TimelineDoc;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	picks: Picks;
	varying: ReadonlySet<string>;
	pins: Readonly<Record<string, number>>;
	onPin: (variable: string, index: number | null) => void;
	/** What this universe made of it: lengths, keyframe times, per-track values. */
	solved?: ModelTimeline;
	/**
	 * Keyframes that resolved out of order or past the end, keyed
	 * `` `${track}#${index}` `` with the index 1-based — the same pair
	 * `mkbackwards/4` reports.
	 */
	suspect?: ReadonlySet<string>;
	/**
	 * Where the scrubber is, in milliseconds. Editor state. The canvas lerps
	 * between the two keyframes either side of it, out of the answer set it
	 * already has, so scrubbing costs no solve.
	 */
	at: number;
	onScrub: (ms: number) => void;
}

/** The key a {@link TimelineProps.suspect} entry is spelled under. */
export const suspectKey = (track: string, index: number): string =>
	`${track}#${index}`;

/**
 * What a track's keyframes are values *of*.
 *
 * One reading for three cases, because the row underneath is one row: a
 * property track's keys are that property's own type — a `fill` track holds
 * colours and offers the document's colour tokens — a dimension track's are
 * lengths, and a rotation track's are angles. Getting this from the field rather
 * than from a table of track types is what lets a `solid` or a `lamp` track work
 * the day somebody makes one, with no edit here.
 *
 * The fallback matters as much as the type: it is the placeholder, and it is
 * what a freshly added alternative starts at, so a rotation track that started
 * at `0px` would be a row whose first suggestion is not an angle.
 */
function trackType(track: Track): { type: ValueType; fallback: string } {
	if (track.prop !== undefined) {
		return { type: PROPS[track.prop].type, fallback: PROPS[track.prop].fallback };
	}
	if (track.dim !== undefined) {
		const spec = dimensionSpec(track.dim);
		return { type: spec.type, fallback: spec.fallback };
	}
	// A rotation, or a track that names nothing — which `trackTerm` reads as no
	// track at all and this component never renders. Angles, either way, because
	// the only field left is a turn.
	return { type: "angle", fallback: VALUE_TYPES.angle.fallback };
}

/** What the track is called in the panel: the part, then the field. */
function trackLabel(track: Track, names: Readonly<Record<string, string>>): string {
	const part = names[track.part] ?? track.part;
	if (track.prop !== undefined) return `${part} · ${PROPS[track.prop].label}`;
	if (track.dim !== undefined) return `${part} · ${dimensionSpec(track.dim).label}`;
	if (track.turn !== undefined) return `${part} · ${TURNS[track.turn].label}`;
	return part;
}

/** One keyframe: when, what, and how the segment leaving it is paced. */
function KeyRow({
	scene,
	machine,
	timeline,
	track,
	term,
	index,
	keyframe,
	resolved,
	suspect,
	picks,
	varying,
	pins,
	onPin,
	onSceneChange,
	onScrub,
}: {
	scene: Scene;
	machine: Machine;
	timeline: TimelineDoc;
	track: Track;
	term: string;
	/** 1-based, the document's own order. */
	index: number;
	keyframe: Keyframe;
	/** The millisecond this universe put it at, where there is an answer. */
	resolved: number | undefined;
	suspect: boolean;
	picks: Picks;
	varying: ReadonlySet<string>;
	pins: Readonly<Record<string, number>>;
	onPin: TimelineProps["onPin"];
	onSceneChange: TimelineProps["onSceneChange"];
	onScrub: TimelineProps["onScrub"];
}) {
	const unit = scene.unit ?? DEFAULT_UNIT;
	const names = nodeNames(scene.nodes);
	const context = { tokens: scene.tokens, picks, props: propValues(scene.nodes) };
	const { type, fallback } = trackType(track);

	const timeVar = keyTimeVar(machine.id, timeline.id, term, index);
	const valueVar = keyValueVar(machine.id, timeline.id, term, index);
	// The third variable a keyframe can mint, and the only one it is allowed to
	// say nothing about: `machineValues` guards on `easing.length > 0`, so a
	// timeline whose keys say nothing about their curves mints nothing at all and
	// takes `mdefease` in the program.
	const easeVar = keyEaseVar(machine.id, timeline.id, term, index);
	// The universe's own reading, because `context` carries this universe's picks:
	// a curve that names a token the solver chose between is a different curve in
	// a different universe, and the picture beside the row has to be the one on
	// screen.
	const curve = keyEasing(machine, timeline, term, index, keyframe, context);

	const patch = (next: Partial<Keyframe>, coalesce?: string) =>
		onSceneChange(
			(prev) =>
				updateKeyframe(prev, machine.id, timeline.id, term, index, next),
			coalesce,
		);

	return (
		<div
			className={cx(styles.key, suspect && styles.suspect)}
			data-role="keyframe"
			data-track={term}
			data-key={index}
		>
			<button
				type="button"
				className={styles.at}
				data-role="scrub-to-key"
				disabled={resolved === undefined}
				title={
					resolved === undefined
						? "No answer set in hand, so there is no millisecond to move the scrubber to."
						: "Put the scrubber on this keyframe. It costs no solve: the pose is already in the answer set."
				}
				onClick={() => resolved !== undefined && onScrub(resolved)}
			>
				<span className={styles.index}>{index}</span>
				<span className={styles.ms}>
					{resolved === undefined ? "—" : writeDuration(resolved)}
				</span>
			</button>

			<div className={styles.fields}>
				<ValueEditor
					testId="keyframe-at"
					label="At"
					type="duration"
					value={keyframe.at}
					tokens={tokensOfType(scene, "duration")}
					fallback="0ms"
					names={names}
					active={picks[timeVar]}
					varying={varying.has(timeVar)}
					pinned={pins[timeVar]}
					onPin={(alternative) => onPin(timeVar, alternative)}
					preview={(t: Term) => resolveValue(context, [t], timeVar)}
					onChange={(next) =>
						patch({ at: next }, `key-at-${machine.id}-${timeline.id}-${term}-${index}`)
					}
				/>
				<ValueEditor
					testId="keyframe-value"
					label="Value"
					type={type}
					value={keyframe.value}
					tokens={
						track.prop !== undefined
							? tokensFor(scene, track.prop)
							: tokensOfType(scene, type)
					}
					unit={unit}
					fallback={fallback}
					names={names}
					// A keyframe on a `fontFamily` track holds a stack, so it gets the
					// project's menu for the reason every other font row does: the value
					// a designer wants to tween to is one of the families this page has.
					options={fontMenu(scene, type)}
					active={picks[valueVar]}
					varying={varying.has(valueVar)}
					pinned={pins[valueVar]}
					onPin={(alternative) => onPin(valueVar, alternative)}
					preview={(t: Term) => resolveValue(context, [t], valueVar)}
					onChange={(next) =>
						patch(
							{ value: next },
							`key-value-${machine.id}-${timeline.id}-${term}-${index}`,
						)
					}
				/>
			</div>

			{/*
			 * The curve out of this keyframe, widened into a row with the two above
			 * it and for their reason: a keyframe's easing is an `easing` Value now,
			 * so it may name a `curve` token and hold two alternatives, and the
			 * overshoot that eases in one universe and springs in the other is two
			 * animations rather than one with an arbitrary pick.
			 *
			 * Made a Value at the same time as a transition's rather than left
			 * behind, because half a change is a new asymmetry replacing an old one:
			 * a document where the hover curve could name a token and the overshoot
			 * curve could not would be a feel scale with a hole in it.
			 *
			 * The **last** keyframe's is read by nothing — there is no segment
			 * leaving it — and the row is shown anyway, because a keyframe that stops
			 * being last should not have had nowhere to say what it now needs to say.
			 */}
			<div className={styles.easing} data-role="keyframe-easing" data-key={index}>
				<ValueEditor
					testId="keyframe-easing"
					label="Easing"
					type="easing"
					value={keyframe.easing ?? []}
					tokens={tokensOfType(scene, "easing")}
					fallback={DEFAULT_EASING}
					names={names}
					active={picks[easeVar]}
					varying={varying.has(easeVar)}
					pinned={pins[easeVar]}
					onPin={(alternative) => onPin(easeVar, alternative)}
					preview={(t: Term) => resolveValue(context, [t], easeVar)}
					onChange={(next) =>
						patch(
							{ easing: next.length > 0 ? next : undefined },
							`key-ease-${machine.id}-${timeline.id}-${term}-${index}`,
						)
					}
				/>
				{/* Into one alternative of the same value, for `Transitions.tsx`'s
				    reason: a keyframe whose curve holds two feels must not lose one of
				    them to a nudged handle either. */}
				<CurveField
					testId="keyframe-curve"
					curve={curve}
					value={keyframe.easing ?? []}
					active={picks[easeVar]}
					onChange={(next) =>
						patch(
							{ easing: next.length > 0 ? next : undefined },
							`key-curve-${machine.id}-${timeline.id}-${term}-${index}`,
						)
					}
				/>
			</div>

			<button
				type="button"
				className={styles.action}
				data-role="delete-keyframe"
				title="Delete this key. Every later key on this track renumbers, which is what a rule naming a `kfr(...)` copy of one of them is about — so any rule that named a copy past this point is pruned with it rather than left pointing somewhere else."
				onClick={() =>
					onSceneChange((prev) =>
						deleteKeyframe(prev, machine.id, timeline.id, term, index),
					)
				}
			>
				×
			</button>

			{suspect ? (
				<p className={styles.finding} data-role="key-suspect">
					This universe put it before the key in front of it. A keyframe's time is
					a value, so this is a property of an answer rather than of the document
					— the same keys in another universe may be in order.
				</p>
			) : null}
		</div>
	);
}

/** One track, with its keys under it. */
function TrackRows({
	scene,
	machine,
	timeline,
	track,
	solved,
	suspect,
	picks,
	varying,
	pins,
	onPin,
	onSceneChange,
	onScrub,
}: {
	scene: Scene;
	machine: Machine;
	timeline: TimelineDoc;
	track: Track;
	solved?: ModelTimeline;
	suspect?: ReadonlySet<string>;
	picks: Picks;
	varying: ReadonlySet<string>;
	pins: Readonly<Record<string, number>>;
	onPin: TimelineProps["onPin"];
	onSceneChange: TimelineProps["onSceneChange"];
	onScrub: TimelineProps["onScrub"];
}) {
	const term = trackTerm(track);
	const names = nodeNames(scene.nodes);
	if (term === undefined) {
		// A track naming neither a property, a dimension nor a rotation is read as
		// no track at all — by `trackTerm`, by the compiler and by the document
		// reader. Saying so is better than drawing an editable row for a thing the
		// program cannot see.
		return (
			<p className={styles.empty} data-role="track-unreadable">
				A track here names no property, dimension or rotation, so nothing reads it.
			</p>
		);
	}

	const context = { tokens: scene.tokens, picks, props: propValues(scene.nodes) };
	/**
	 * When each key lands, this universe's answer first.
	 *
	 * `ModelTimeline.tracks` where there is an answer set, and `solvedKeys`'
	 * reading of the document where there is not — the same two-readers
	 * arrangement the transition rows already use for a duration, and for the same
	 * reason: a keyframe's time is a `Value`, so only the solver knows which
	 * millisecond is on screen, and a panel with no answer in hand should show the
	 * number the export would write rather than a blank.
	 */
	const answered = new Map<number, number>();
	for (const entry of solved?.tracks[term] ?? []) answered.set(entry.index, entry.at);
	const read = new Map<number, number>();
	for (const key of solvedKeys(machine, timeline, track, context)) {
		read.set(key.index, key.at);
	}

	const { type, fallback } = trackType(track);
	/**
	 * A new key lands at the end and holds what the track's type falls back to.
	 *
	 * At the end rather than at the scrubber, which was the other candidate:
	 * `placeKeys` refuses a time another key already holds, so "wherever the
	 * scrubber is" would be a button that silently does nothing every time the
	 * scrubber happened to be sitting on a key — which is exactly where somebody
	 * leaves it after clicking one.
	 */
	const last = Math.max(0, ...[...read.values()], 0);

	return (
		<div className={styles.track} data-role="track" data-track={term}>
			<div className={styles.trackHead}>
				<span className={styles.trackName} title={`The term \`${term}\`, which is what a rule naming one of its keyframe copies writes.`}>
					{trackLabel(track, names)}
				</span>
				<span className={styles.count}>
					{track.keys.length === 1 ? "1 key" : `${track.keys.length} keys`}
				</span>
				<button
					type="button"
					className={styles.add}
					data-role="add-keyframe"
					title="Another key on this track, after the last one. Grounding scales with the number of keys and with nothing else — there is no frame rate to pay for."
					onClick={() =>
						onSceneChange((prev) =>
							addKeyframe(
								prev,
								machine.id,
								timeline.id,
								term,
								[lit(writeDuration(last + 200))],
								[lit(fallback)],
							),
						)
					}
				>
					+ Key
				</button>
				<button
					type="button"
					className={styles.action}
					data-role="delete-track"
					title="Delete this track and its keys, and any rule that named one of their copies."
					onClick={() =>
						onSceneChange((prev) =>
							deleteTrack(prev, machine.id, timeline.id, term),
						)
					}
				>
					×
				</button>
			</div>

			{track.keys.length === 0 ? (
				<p className={styles.empty} data-role="no-keys">
					No keys, so this track says nothing and the part keeps whatever the state
					gives it.
				</p>
			) : (
				track.keys.map((keyframe, i) => (
					<KeyRow
						key={i}
						scene={scene}
						machine={machine}
						timeline={timeline}
						track={track}
						term={term}
						index={i + 1}
						keyframe={keyframe}
						resolved={answered.get(i + 1) ?? read.get(i + 1)}
						suspect={suspect?.has(suspectKey(term, i + 1)) ?? false}
						picks={picks}
						varying={varying}
						pins={pins}
						onPin={onPin}
						onSceneChange={onSceneChange}
						onScrub={onScrub}
					/>
				))
			)}

			{/* The type is stated once per track rather than once per row, because it
			    is a fact about the track: every key on it holds the same kind of
			    thing, and that is what makes a track one track. */}
			<span className={styles.type}>{VALUE_TYPES[type].label.toLowerCase()}</span>
		</div>
	);
}

export function Timeline({
	scene,
	machine,
	timeline,
	onSceneChange,
	picks,
	varying,
	pins,
	onPin,
	solved,
	suspect,
	at,
	onScrub,
}: TimelineProps) {
	const [name, setName] = useState<string | null>(null);
	const committed = useRef(timeline.name);
	useEffect(() => {
		if (committed.current !== timeline.name) {
			committed.current = timeline.name;
			setName(null);
		}
	}, [timeline.name]);

	const names = nodeNames(scene.nodes);
	const context = { tokens: scene.tokens, picks, props: propValues(scene.nodes) };
	const def = componentDef(scene, machine.root);
	const parts = def?.parts ?? [];

	/**
	 * How long it runs: the answer set's number where there is one, the document's
	 * own reading where there is not.
	 *
	 * `Timeline.length` is a `Value` and may be absent entirely, in which case the
	 * length *is* the last keyframe's time — derived rather than stored, so a
	 * timeline cannot disagree with its own contents. Both readings go through
	 * `timelineLength`, which is the same walk `mtlen/3` makes.
	 */
	const length = solved?.length ?? timelineLength(machine, timeline, context);
	const lengthVar = timelineLenVar(machine.id, timeline.id);

	/**
	 * The first state that plays this timeline off a scroll, or nothing.
	 *
	 * Through `statePlays` rather than `state.timeline`, so that a blend stop
	 * naming this timeline counts too — a blend state with a scroll clock is a
	 * legal document, and the panel that showed nothing for it would be the panel
	 * that is wrong about the one case somebody had to think about.
	 */
	const scrolled = machine.states.find(
		(state) =>
			clockOf(state) !== "time" &&
			statePlays(machine, state).some((w) => w.id === timeline.id),
	);

	/** The part a new track would animate, and the field it would animate. */
	const [part, setPart] = useState("");
	const chosen = part || parts[0]?.id || "";
	const node = chosen ? findInTree(scene.nodes, chosen) : undefined;
	const offered = node ? sharedPropsOfKinds([node.kind]) : [];

	return (
		<div className={styles.timeline} data-role="timeline" data-timeline={timeline.id}>
			<div className={styles.head}>
				<input
					className={styles.name}
					data-role="timeline-name"
					aria-label="Timeline name"
					value={name ?? timeline.name}
					title={`The id \`${timeline.id}\`, which is what a state plays, what a blend stop names, and what a rule naming one of its keyframe copies writes inside \`kfr(...)\`.`}
					onChange={(e) => {
						setName(e.target.value);
						onSceneChange(
							(prev) => renameTimeline(prev, machine.id, timeline.id, e.target.value),
							`timeline-name-${machine.id}-${timeline.id}`,
						);
					}}
					onBlur={() => setName(null)}
				/>

				<select
					className={styles.select}
					data-role="timeline-loop"
					aria-label="Looping"
					title="How it repeats. This is one attribute in the exported `animation:` shorthand — the compositor plays it, nothing here schedules anything."
					value={timeline.loop ?? "none"}
					onChange={(e) =>
						onSceneChange((prev) =>
							setTimelineLoop(prev, machine.id, timeline.id, e.target.value as LoopMode),
						)
					}
				>
					<option value="none">Once</option>
					<option value="loop">Loop</option>
					<option value="pingPong">Ping-pong</option>
				</select>

				<button
					type="button"
					className={styles.action}
					data-role="delete-timeline"
					title="Delete this timeline. Any state that played it simply stops playing anything — a state naming a timeline that is gone derives nothing at all, so nothing accuses anybody — and any rule that named one of its keyframe copies goes with it."
					onClick={() =>
						onSceneChange((prev) => deleteTimeline(prev, machine.id, timeline.id))
					}
				>
					×
				</button>
			</div>

			<div className={styles.lengthRow}>
				<ValueEditor
					testId="timeline-length"
					label="Length"
					type="duration"
					value={timeline.length ?? []}
					tokens={tokensOfType(scene, "duration")}
					fallback={writeDuration(length)}
					names={names}
					active={picks[lengthVar]}
					varying={varying.has(lengthVar)}
					pinned={pins[lengthVar]}
					onPin={(index) => onPin(lengthVar, index)}
					preview={(t: Term) => resolveValue(context, [t], lengthVar)}
					onChange={(next) =>
						onSceneChange(
							(prev) =>
								setTimelineLength(
									prev,
									machine.id,
									timeline.id,
									next.length > 0 ? next : null,
								),
							`timeline-length-${machine.id}-${timeline.id}`,
						)
					}
				/>
				<span className={styles.resolved} data-role="timeline-resolved">
					{/* Empty means "the last keyframe", which is a real answer and not a
					    missing one — so the number is shown either way and the sentence
					    says where it came from. */}
					{timeline.length === undefined || timeline.length.length === 0
						? `${writeDuration(length)} — the last key`
						: writeDuration(length)}
				</span>
			</div>

			{/*
			 * The scrubber. A slider over milliseconds, and nothing else: no play
			 * button, no clock, no `requestAnimationFrame`. What paces a timeline on
			 * the canvas is the same thing that paces it in the exported file — CSS,
			 * played by the compositor — and a script here that also advanced time
			 * would be a second animator arguing with it. What this does is ask the
			 * canvas to draw one moment, which is two keyframe copies out of the
			 * answer set and a lerp.
			 */}
			{/*
			 * ...and where a state that plays it is driven by the scroll instead, the
			 * scrubber is that scroll position rather than a moment in time.
			 *
			 * **Nothing about the slider changes**, which is the strongest available
			 * evidence that the clock was put on the right record: `Playback.scrub` is
			 * already "a *position*, set by a hand on a slider", and a scroll clock is
			 * the exported file's hand on that same slider. Not one line of
			 * `useMachinePlayback.ts` moved for this feature, and if a later step
			 * finds itself editing that hook for a clock, something is wrong.
			 *
			 * Read off the machine's states rather than taken as a prop, because the
			 * question is "does any state that plays *this* timeline scroll-drive it"
			 * and this component already holds the machine. Where two states play one
			 * timeline and disagree, the sentence says so by naming the first
			 * scroll-clocked one — which is the honest answer to a question that has
			 * two.
			 */}
			<label className={styles.scrub}>
				<input
					className={styles.slider}
					type="range"
					data-role="scrub"
					aria-label={
						scrolled === undefined
							? "Where in the timeline the canvas is drawing"
							: "How far through the scroll the canvas is drawing"
					}
					min={0}
					max={Math.max(1, length)}
					step={1}
					value={Math.min(Math.max(0, at), Math.max(1, length))}
					onChange={(e) => onScrub(Number(e.target.value))}
				/>
				<span className={styles.ms} data-role="scrub-at">
					{writeDuration(Math.min(Math.max(0, at), Math.max(0, length)))}
				</span>
			</label>

			{scrolled === undefined ? null : (
				<p className={styles.empty} data-role="scroll-clocked">
					{TIMELINE_CLOCKS[clockOf(scrolled)].label} drives this timeline in{" "}
					{scrolled.name} in the exported file — `animation-timeline`, played by
					the browser, with no script in it. The scrubber above is that scroll
					position, by hand. A browser without scroll timelines shows the
					state's own pose and animates nothing, which is what the canvas shows
					when you let go of the slider.
				</p>
			)}

			{timeline.tracks.length === 0 ? (
				<p className={styles.empty} data-role="no-tracks">
					No tracks yet. A track is one property of one part over time — which is
					the grain a conflict happens at, so "two layers fighting over the panel's
					opacity" is a sentence about one track rather than about six.
				</p>
			) : (
				timeline.tracks.map((track) => (
					<TrackRows
						key={trackTerm(track) ?? track.part}
						scene={scene}
						machine={machine}
						timeline={timeline}
						track={track}
						solved={solved}
						suspect={suspect}
						picks={picks}
						varying={varying}
						pins={pins}
						onPin={onPin}
						onSceneChange={onSceneChange}
						onScrub={onScrub}
					/>
				))
			)}

			<div className={styles.addTrack}>
				<select
					className={styles.select}
					data-role="track-part"
					aria-label="Part to animate"
					value={chosen}
					onChange={(e) => setPart(e.target.value)}
				>
					{parts.length === 0 ? <option value="">no parts</option> : null}
					{parts.map((p) => (
						<option key={p.id} value={p.id}>
							{names[p.id] ?? p.id}
						</option>
					))}
				</select>

				<select
					className={styles.select}
					data-role="add-track"
					aria-label="Add a track"
					value=""
					disabled={!chosen}
					title="One property, one dimension or one rotation of that part, over time. A track that named two would be two tracks sharing a keyframe list."
					onChange={(e) => {
						const field = e.target.value;
						if (!field || !chosen) return;
						const [sort, which] = field.split(":");
						const spec: TrackField =
							sort === "prop"
								? { prop: which as PropName }
								: sort === "dim"
									? { dim: which as (typeof DIMENSIONS_3D)[number] }
									: { turn: which as Turn };
						onSceneChange(
							(prev) => addTrack(prev, machine.id, timeline.id, chosen, spec).scene,
						);
					}}
				>
					<option value="">+ Track</option>
					{offered.length > 0 ? (
						<optgroup label="Appearance">
							{offered.map((prop) => (
								<option key={prop} value={`prop:${prop}`}>
									{PROPS[prop].label}
								</option>
							))}
						</optgroup>
					) : null}
					<optgroup label="Geometry">
						{DIMENSIONS_3D.map((dim) => (
							<option key={dim} value={`dim:${dim}`}>
								{dimensionSpec(dim).label}
							</option>
						))}
					</optgroup>
					<optgroup label="Rotation">
						{TURN_NAMES.map((turn) => (
							<option key={turn} value={`turn:${turn}`}>
								{TURNS[turn].label}
							</option>
						))}
					</optgroup>
				</select>
			</div>
		</div>
	);
}
