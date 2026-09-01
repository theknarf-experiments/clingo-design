import { useEffect, useMemo, useState } from "react";
import {
	EXPORT_TARGETS,
	EXPORT_TARGET_NAMES,
	type ExportTarget,
	type Scene,
	type TargetSpec,
	type Universe,
	collapseSpace,
	exportSpace,
	exportUniverse,
	fontPaths,
	viewports,
} from "@clingo-design/design-core";
import type { GltfExport } from "@clingo-design/canvas-3d";

import { assetPaths, usePathBytes } from "./useAssetBytes";
import styles from "./ExportPanel.module.css";

export interface ExportPanelProps {
	scene: Scene;
	universes: readonly Universe[];
	/** Names the file and the document. */
	projectName: string;
	/**
	 * The last frame each 3D view drew, as a PNG data URL by viewport node id.
	 *
	 * **The half of a viewport's export that makes the box look like the design.**
	 * HTML and CSS cannot draw a scene, so a viewport exports as a coloured
	 * rectangle; hand this over and the rectangle wears a photograph of what was
	 * inside it. Absent is not a failure and the loss list says which of the two
	 * happened — a poster is a *photograph*, and a file with none of them is
	 * exactly as honest, just less pretty.
	 *
	 * It reaches the HTML target and nothing else, which is `exportUniverse`'s own
	 * decision: an SVG says once, about the format, that it is flat.
	 */
	posters?: Record<string, string>;
}

/** The value the universe picker uses for "all of them, as one artefact". */
const WHOLE = "space";

/**
 * What this panel can write, which is one more than `design-core` can.
 *
 * **The asymmetry is the package boundary and not an oversight.** `ExportTarget`
 * is `"html" | "svg"` because those are the two `exportUniverse` emits, and
 * `exportUniverse` lives in a package with no rendering dependency of any kind
 * — that is invariant 3. A glTF writer needs three.js's own geometry
 * constructors to tessellate a sphere, so it lives in `canvas-3d`, and the panel
 * is the place the two meet: it already knows the document, the universe and the
 * title, and it is already the only thing in the studio allowed to ask for a
 * file. `canvas-3d`'s `gltfTarget()` anticipates exactly this — it returns
 * `EXPORT_TARGETS.gltf` where one exists and its own spec otherwise — so the day
 * a pure writer lands in `design-core` this union collapses back to
 * `ExportTarget` and nothing else here changes.
 */
type PanelTarget = ExportTarget | "gltf";

/**
 * The way out, as one panel.
 *
 * Deliberately modest: exporting is not where the interest is. A target, which
 * design, whether to keep the token names, the text, and what the text does not
 * carry. The last of those is the part worth the space — an export always loses
 * something, and a panel that does not say what would be selling a lie.
 *
 * The universe picker's first entry is the whole space, and it is only offered
 * where the space actually collapses into one artefact; see `collapseSpace`.
 * Everywhere else the reason is shown beside the text, which is the honest
 * answer to "why did I get one design when the document holds fifteen".
 */
export function ExportPanel({
	scene,
	universes,
	projectName,
	posters,
}: ExportPanelProps) {
	const [target, setTarget] = useState<PanelTarget>("html");
	const [which, setWhich] = useState<string>(WHOLE);
	const [view, setView] = useState<string>("");
	const [tokens, setTokens] = useState(true);
	const [copied, setCopied] = useState(false);

	/**
	 * The payloads, per kind, and only for the kind the chosen target can use.
	 *
	 * **This is where a real bug was.** The panel used to fetch images and hand
	 * the glTF writer *nothing at all* — no geometry resolver, no files — so every
	 * glTF this studio has ever written contained twelve-triangle bounding boxes
	 * where its models should have been, and the code path that reads a payload
	 * had never run outside `gltfexport.test.ts`. It was invisible to every
	 * headless check in the repo: the export succeeded, the file parsed, and the
	 * loss list said the geometry lived outside the document, which reads as a
	 * statement of policy rather than as a missing argument.
	 *
	 * The gating on `target` is not premature: a chair is megabytes and an HTML
	 * export has no use for one, so reading them to open the panel would make
	 * every export of every 3D document wait on geometry it will not write. The
	 * empty list is how a hook gets skipped without being called conditionally.
	 */
	const images = usePathBytes(
		useMemo(
			() => (target === "gltf" ? [] : assetPaths(scene, "image")),
			[scene, target],
		),
	);
	const files = usePathBytes(
		useMemo(
			() => (target === "gltf" ? assetPaths(scene, "mesh") : []),
			[scene, target],
		),
	);
	/**
	 * The faces, for the one target that carries them.
	 *
	 * Gated exactly as the pictures and the chairs are, and for a sharper version
	 * of their reason: an SVG names the family and leaves the face to whatever
	 * opens it, and a glTF has no text at all, so fetching a megabyte of type to
	 * open the panel on either would be reading bytes nothing could ever write.
	 * The empty list is how a hook is skipped without being called conditionally.
	 *
	 * A face the roster declares and the design does not wear is fetched and not
	 * written: `fontPaths` is the *declaration*, and `fontFaces` intersects it with
	 * what the answer set actually came out wearing. That asymmetry is deliberate —
	 * which families a universe uses is a question about a solve, and the panel
	 * would have to walk every universe's model to ask it before it could decide
	 * what to read.
	 */
	const fonts = usePathBytes(
		useMemo(() => (target === "html" ? fontPaths(scene) : []), [scene, target]),
	);

	const collapse = useMemo(
		() => collapseSpace(scene, universes),
		[scene, universes],
	);
	const collapsible = !("reason" in collapse);
	// A pick that no longer exists — the document changed under it — falls back
	// to the whole space rather than to nothing.
	const at = Number(which);
	const one = Number.isInteger(at) && at >= 0 && at < universes.length ? at : null;

	/**
	 * The views a glTF could be of, and therefore whether glTF is on the menu at
	 * all.
	 *
	 * Read off the *document* rather than off a universe, because the target list
	 * must not change when somebody picks a different design: a viewport is a
	 * node, and which universe is on screen decides where it sits and not whether
	 * it is there.
	 */
	const views = useMemo(() => viewports(scene), [scene]);
	const targets: PanelTarget[] = views.length > 0
		? [...EXPORT_TARGET_NAMES, "gltf"]
		: [...EXPORT_TARGET_NAMES];
	// A document that loses its last viewport while glTF is selected falls back,
	// rather than sitting on a target that can no longer be written.
	useEffect(() => {
		if (target === "gltf" && views.length === 0) setTarget("html");
	}, [target, views.length]);

	/**
	 * The glTF writer, fetched when somebody asks for one and not before.
	 *
	 * `@clingo-design/canvas-3d`'s barrel pulls three.js, and the studio's promise
	 * is that a document with no 3D in it pays for none of it — so this is the
	 * same dynamic import `Artboard.tsx` makes for the renderer, into the same
	 * chunk, and a person who never opens this menu never downloads it. The type
	 * import at the top of the file is erased and costs nothing.
	 */
	const [writer, setWriter] = useState<{
		export: (
			model: Universe["model"],
			options: {
				viewport?: string;
				title?: string;
				/** Keyed by tree path, exactly as `ExportOptions.images` is. */
				files?: Record<string, Uint8Array>;
			},
		) => GltfExport;
		spec: TargetSpec;
	} | null>(null);
	useEffect(() => {
		if (target !== "gltf" || writer !== null) return;
		let alive = true;
		void import("@clingo-design/canvas-3d").then((mod) => {
			if (alive) {
				setWriter({ export: mod.exportViewportGltf, spec: mod.gltfTarget() });
			}
		});
		return () => {
			alive = false;
		};
	}, [target, writer]);

	/**
	 * A glTF is one scene, so it is one universe — never the collapsed space.
	 *
	 * `collapseSpace` writes several designs into one artefact using media
	 * queries and CSS custom properties, which a glTF has no equivalent of: a
	 * scene file holds one arrangement of one set of objects. So the design picker
	 * is forced to a single universe here rather than being obeyed and quietly
	 * exporting the first one.
	 */
	const gltfUniverse = one ?? 0;

	const result = useMemo(() => {
		if (universes.length === 0) return null;
		if (target === "gltf") {
			if (!writer) return null;
			const universe = universes[gltfUniverse];
			if (!universe) return null;
			const out = writer.export(universe.model, {
				viewport: view || undefined,
				title: projectName,
				files,
			});
			const name = out.viewport ?? "scene";
			return {
				text: out.text,
				lost: out.lost,
				filename: `${projectName}-${name}.${writer.spec.extension}`,
				note:
					universes.length === 1
						? "The scene in this design."
						: `Design ${gltfUniverse + 1} of ${universes.length}. A glTF holds one arrangement of one set of objects, so the whole space cannot collapse into it the way a stylesheet can.`,
			};
		}
		const options = { target, tokens, title: projectName, posters, images, fonts };
		return one === null
			? exportSpace(scene, universes, options)
			: exportUniverse(scene, universes[one], options);
	}, [
		scene,
		universes,
		one,
		target,
		tokens,
		projectName,
		images,
		files,
		fonts,
		writer,
		view,
		gltfUniverse,
		posters,
	]);

	function copy() {
		if (!result) return;
		void navigator.clipboard?.writeText(result.text);
		setCopied(true);
		setTimeout(() => setCopied(false), 1200);
	}

	const label = (name: PanelTarget): string =>
		name === "gltf"
			? (writer?.spec.label ?? "glTF (3D)")
			: EXPORT_TARGETS[name].label;

	return (
		<div className={styles.export} data-role="export">
			<div className={styles.controls}>
				<label className={styles.field}>
					Format
					<select
						className={styles.select}
						data-role="export-target"
						value={target}
						onChange={(e) => setTarget(e.target.value as PanelTarget)}
					>
						{targets.map((name) => (
							<option key={name} value={name}>
								{label(name)}
							</option>
						))}
					</select>
				</label>

				{/* Which view, where there is more than one. A glTF is *a* scene, so
				    a document holding two views has two files to write and the panel
				    has to ask which — silently taking the first would be a file that
				    looks right and is of the wrong thing. */}
				{target === "gltf" && views.length > 1 ? (
					<label className={styles.field}>
						View
						<select
							className={styles.select}
							data-role="export-viewport"
							value={view}
							onChange={(e) => setView(e.target.value)}
						>
							<option value="">{views[0].name}</option>
							{views.slice(1).map((node) => (
								<option key={node.id} value={node.id}>
									{node.name}
								</option>
							))}
						</select>
					</label>
				) : null}

				<label className={styles.field}>
					Design
					<select
						className={styles.select}
						data-role="export-universe"
						value={target === "gltf" ? String(gltfUniverse) : which}
						onChange={(e) => setWhich(e.target.value)}
					>
						{collapsible && target !== "gltf" ? (
							<option value={WHOLE}>
								All {universes.length} — one {collapse.kind} on {collapse.label}
							</option>
						) : null}
						{universes.map((_, i) => (
							// eslint-disable-next-line react/no-array-index-key
							<option key={i} value={String(i)}>
								Design {i + 1} of {universes.length}
							</option>
						))}
					</select>
				</label>

				{/* Token names are a CSS idea: a glTF has no custom properties and no
				    cascade, so the switch is hidden rather than shown doing nothing. */}
				{target === "gltf" ? null : (
					<label className={styles.check}>
						<input
							type="checkbox"
							data-role="export-tokens"
							checked={tokens}
							onChange={(e) => setTokens(e.target.checked)}
						/>
						Keep token names
					</label>
				)}

				<button
					type="button"
					className={styles.copy}
					data-role="export-copy"
					disabled={!result}
					onClick={copy}
				>
					{copied ? "Copied" : `Copy ${result?.filename ?? ""}`}
				</button>
			</div>

			<div className={styles.split}>
				<pre className={styles.text} data-role="export-text">
					{result?.text ??
						(target === "gltf" && universes.length > 0
							? "Writing the scene…"
							: "Nothing to export yet.")}
				</pre>
				<div className={styles.aside}>
					<p className={styles.note} data-role="export-note">
						{result?.note}
					</p>
					<p className={styles.lostHead}>What this leaves behind</p>
					<ul className={styles.lost} data-role="export-lost">
						{(result?.lost ?? []).map((line) => (
							<li key={line}>{line}</li>
						))}
					</ul>
				</div>
			</div>
		</div>
	);
}
