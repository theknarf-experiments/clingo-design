import { useEffect, useMemo, useState } from "react";
import {
	type Scene,
	type Universe,
	fontPaths,
	viewports,
} from "@clingo-design/design-core";
import {
	type ExportPlugin,
	type ExportResult,
	collapseSpace,
	exportSpace,
	exportUniverse,
	targetFor,
} from "@clingo-design/export-core";
import { gltfTarget } from "@clingo-design/export-gltf";
import { htmlTarget } from "@clingo-design/export-html";
import { svgTarget } from "@clingo-design/export-svg";

import { assetPaths, usePathBytes } from "./useAssetBytes";
import styles from "./ExportPanel.module.css";

export interface ExportPanelProps {
	scene: Scene;
	universes: readonly Universe[];
	/** Names the file and the document, where the page has no name of its own. */
	projectName: string;
	/**
	 * The page being exported, which is what actually names the file.
	 *
	 * **A visible change to what this button produces**, and it is load-bearing
	 * rather than tidy: a five-page project used to export five files all called
	 * `card.html`. A link's href is `${slug(pageName)}.html`, computed by the same
	 * `slug` that computes {@link ExportResult.filename}, so the page has to export
	 * under its own name or a folder of pages does not hold together at all.
	 *
	 * Absent falls back to the project's name, which is what a component's document
	 * gets — a component is not a page and has no page to be.
	 */
	pageName?: string;
	/**
	 * The project's pages, as page id -> that page's name.
	 *
	 * What turns a link in the answer set into an `<a href>`: `link/2` carries
	 * `pg_about_us_1k3z9`, because an atom's argument has to be a legal constant,
	 * and a hash does not run backwards. A link whose target is not in here comes
	 * out as an ordinary box and is named in `lost` — an `<a href>` that 404s is
	 * worse than a box, because the box is honest about leading nowhere.
	 */
	pages?: Readonly<Record<string, string>>;
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
 * This studio's targets.
 *
 * **The composition root, and that is the whole of what this panel now knows
 * about any particular target.** It used to know a great deal: `type PanelTarget
 * = ExportTarget | "gltf"` because `design-core` had a union with two members
 * and this file could write three; a dynamic import and a `writer` state; a
 * branch that built its own result object; a rule of its own that glTF may only
 * ever be one universe; and a label lookup with a fallback for the target the
 * record did not have. Every one of those has gone, and what replaced them is
 * this array.
 *
 * The order is the order of the menu. Adding a target is a package and a line.
 */
const TARGETS: readonly ExportPlugin[] = [htmlTarget, svgTarget];

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
	pageName,
	pages,
	posters,
}: ExportPanelProps) {
	// One name for the file and for the `<title>`, so the href a *link* writes and
	// the filename a page exports under are the same string by construction.
	const title = pageName ?? projectName;
	const [target, setTarget] = useState<string>("html");
	const [which, setWhich] = useState<string>(WHOLE);
	const [view, setView] = useState<string>("");
	const [tokens, setTokens] = useState(true);
	const [copied, setCopied] = useState(false);

	/**
	 * The views a glTF could be of, and therefore whether glTF is on the menu.
	 *
	 * Read off the *document* rather than off a universe, because the target list
	 * must not change when somebody picks a different design: a viewport is a
	 * node, and which universe is on screen decides where it sits and not whether
	 * it is there.
	 */
	const views = useMemo(() => viewports(scene), [scene]);
	/**
	 * The menu, and the one target that is conditional on the document.
	 *
	 * `gltfTarget` is a factory because a glTF is a scene and a document may hold
	 * two: which viewport to write is the one question this target asks that the
	 * others do not, and binding it here is what keeps it off `ExportOptions`,
	 * where exactly one target would ever have read it.
	 */
	const targets = useMemo(
		() => (views.length > 0 ? [...TARGETS, gltfTarget({ viewport: view || undefined })] : TARGETS),
		[views.length, view],
	);
	/**
	 * The chosen target, as the plugin itself.
	 *
	 * Everything below asks *this* rather than comparing the name against a
	 * string: which payloads to fetch, whether the space may collapse, whether a
	 * token switch means anything, what the file is called. The fallback is the
	 * first target rather than a throw, because a document that loses its last
	 * viewport while glTF is selected should land on HTML rather than on an error.
	 */
	const plugin = targetFor(targets, target) ?? targets[0];
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
			() => (plugin.needs.includes("image") ? assetPaths(scene, "image") : []),
			[scene, plugin],
		),
	);
	const files = usePathBytes(
		useMemo(
			() => (plugin.needs.includes("mesh") ? assetPaths(scene, "mesh") : []),
			[scene, plugin],
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
		useMemo(
			() => (plugin.needs.includes("font") ? fontPaths(scene) : []),
			[scene, plugin],
		),
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
	 * The artefact, written whenever anything it depends on moves.
	 *
	 * An effect rather than a `useMemo`, because emitting is asynchronous now:
	 * `ExportPlugin.load()` is a promise for every target, so that the heavy one
	 * costs nothing until it is picked. The `alive` flag is the ordinary guard —
	 * a fast target resolving after a slow one was abandoned must not overwrite it.
	 *
	 * `exportSpace` is called for the whole space *whatever the target*, and it is
	 * the plugin that decides whether the space collapses or one design comes out
	 * with the reason. That deleted this panel's rule about which universe a glTF
	 * may be.
	 */
	const [result, setResult] = useState<ExportResult | null>(null);
	useEffect(() => {
		if (universes.length === 0) {
			setResult(null);
			return;
		}
		let alive = true;
		// One record of payloads, because a payload is a file in the project's tree
		// whichever exporter is writing it: `images` and `files` are two hooks only
		// so that each kind can be fetched or skipped on its own, and `plugin.needs`
		// has already decided which of them is empty.
		const options = {
			tokens,
			title,
			posters,
			images: { ...images, ...files },
			fonts,
			pages,
		};
		const writing =
			one === null
				? exportSpace(scene, universes, plugin, options)
				: exportUniverse(scene, universes[one], plugin, options);
		void writing.then((out) => {
			if (alive) setResult(out);
		});
		return () => {
			alive = false;
		};
	}, [scene, universes, one, plugin, tokens, title, posters, images, files, fonts, pages]);

	function copy() {
		if (!result) return;
		void navigator.clipboard?.writeText(result.text);
		setCopied(true);
		setTimeout(() => setCopied(false), 1200);
	}


	return (
		<div className={styles.export} data-role="export">
			<div className={styles.controls}>
				<label className={styles.field}>
					Format
					<select
						className={styles.select}
						data-role="export-target"
						value={target}
						onChange={(e) => setTarget(e.target.value)}
					>
						{targets.map((t) => (
							<option key={t.id} value={t.id}>
								{t.spec.label}
							</option>
						))}
					</select>
				</label>

				{/* Which view, where there is more than one. A glTF is *a* scene, so
				    a document holding two views has two files to write and the panel
				    has to ask which — silently taking the first would be a file that
				    looks right and is of the wrong thing. */}
				{plugin.id === "gltf" && views.length > 1 ? (
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
						value={plugin.collapses ? which : String(one ?? 0)}
						onChange={(e) => setWhich(e.target.value)}
					>
						{collapsible && plugin.collapses ? (
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

				{/* Token names are a CSS idea, and the target says whether it has any:
				    a glTF has no custom properties and no cascade, so the switch is
				    hidden rather than shown doing nothing. */}
				{!plugin.usesTokens ? null : (
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
						(universes.length > 0 ? "Writing…" : "Nothing to export yet.")}
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
