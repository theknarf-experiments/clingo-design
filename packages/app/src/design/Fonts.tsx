/**
 * The typefaces this project holds, and the ones this page has said it may set
 * text in.
 *
 * A fifth panel rather than a section inside Variables, and the difference is
 * what the two things *are*: a `font` token is a variable that may hold two
 * families and branch the design space, and a font file is a face the project
 * holds and the compiler never hears about. Putting them in one panel would make
 * "add a font" and "add a font variable" adjacent buttons that do unrelated
 * things.
 *
 * Three groups, and the middle one is the only mitigation there is for the
 * roster being per page. `Scene.fonts` sits on the scene beside `tokens` and
 * `styles`, so a font added on `main` is not in the menu on `about` — the same
 * limitation tokens already have, left for the same reason, and answered here by
 * listing the *project's* font files rather than only this page's. The bytes are
 * shared already; adding a family to a second page is a click against a file
 * that is there, not a second upload that `putNamedAsset` would suffix into
 * `InterVariable-2.woff2`.
 *
 * This is the studio's first listing of `/assets` at all. `Inspector.tsx` says
 * at length why there is no relink button yet, and this is deliberately not the
 * file browser that comment asks for: it is scoped to the four extensions CSS
 * can load, because the question it answers is "which of my fonts is this page
 * allowed to use" and not "what is in my project".
 */
import { useState } from "react";
import {
	type FontFile,
	type Scene,
	addFont,
	fontFamilies,
	fontStack,
	fontTotalBytes,
	missingFonts,
	removeFont,
	SYSTEM_FONTS,
} from "@clingo-design/design-core";

import { putNamedAsset, resolveAsset } from "../projects/store";
import {
	FONT_ACCEPT,
	type FontDescription,
	describeFont,
	isFontPath,
	stemOf,
} from "./fontFiles";
import {
	type GoogleFamily,
	fetchGoogleFamily,
	fetchedFileNames,
	searchGoogle,
} from "./googleFonts";
import { register } from "./useDocumentFonts";
import styles from "./Fonts.module.css";

export interface FontsProps {
	scene: Scene;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	/**
	 * Every file in the project's `/assets`, by path and size — see
	 * `useAssetFiles`.
	 *
	 * Two questions come out of one list, which is why it is one prop: which font
	 * files this page has *not* declared, for the middle group, and whether the
	 * file behind a declaration is in the tree at all, for the row that says so.
	 * The second is what `fontNotes` reports in the status band; here it is a
	 * sentence on the row that carries it, because this is the panel where a
	 * person can do something about it.
	 */
	held: readonly { path: string; bytes: number }[];
	/**
	 * The families the browser has actually loaded — see `useDocumentFonts`.
	 *
	 * Only the preview strip reads it, and that is the honest scope: a face that
	 * is declared and not loaded paints in the fallback everywhere in the studio,
	 * so a preview that claimed otherwise would be the one place in the tool
	 * showing a design that is not the design.
	 */
	ready: ReadonlySet<string>;
	/**
	 * The families the design on screen actually came out wearing — off the
	 * answer set, not off a walk of the document.
	 *
	 * It buys one sentence and the sentence is worth naming, because it is the
	 * 90% of a predicate that was priced and refused. `wearsfont(N,F)` would let a
	 * rule say `viol(too_many_faces) :- #count{ F : wearsfont(_,F) } > 3`, which
	 * is a real design constraint and exactly the kind this tool exists for; it is
	 * out because the bridge it needs would be the first one that consults the
	 * document, and because a `#show` without a reader is dead weight in the one
	 * part of the system where dead weight is invisible. Counting them here
	 * answers "am I using four typefaces" for a human, today, with no atoms.
	 */
	used?: ReadonlySet<string>;
	/**
	 * Where a file that could not be brought in is reported.
	 *
	 * The existing "what the last import could not bring across" channel, because
	 * from where the designer is standing "this did not come in" is the same
	 * question whether it was a chair or a typeface.
	 */
	onImported: (report: { name: string; lost: string[] }) => void;
}

/** A byte count as a person reads it. */
const size = (bytes: number): string =>
	bytes >= 1024 * 1024
		? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
		: `${Math.max(1, Math.round(bytes / 1024))} kB`;

/**
 * The weights the preview strip shows.
 *
 * Four rather than one, and they are the whole reason the strip exists: a
 * variable face declared as a single number is clamped to its default instance
 * and every other weight comes out as a synthesised faux bold, while a static
 * face declared as a range claims weights it does not have and 700 renders as
 * Regular with no synthesis at all. Both failures are silent, they are in
 * opposite directions, and both are obvious in five seconds on a strip that
 * shows all four.
 */
const PREVIEW_WEIGHTS = [100, 400, 700, 900] as const;

/**
 * Everything a file has to survive before the document mentions it, in the order
 * that makes each step safe.
 *
 * Four steps, and the order is the whole of the correctness argument — the same
 * shape `importModel` and `importImage` already have:
 *
 * 1. **Validate.** A `FontFace` over an `ArrayBuffer` parses on `load()` with no
 *    network and rejects on a file that is not a font. That is this flow's
 *    `parseGltfFile` and its `createImageBitmap`: the check that has to happen
 *    anyway, done before anything is written, so somebody who drops a PDF on the
 *    panel gets a sentence and a tree that never heard of it.
 * 2. **Write the bytes**, before the document, so a refused write cannot leave a
 *    `FontFile` pointing at a path nothing holds. The reverse — a file with no
 *    declaration — is inert.
 * 3. **Register**, through `useDocumentFonts`' own map so there is one face per
 *    family rather than one per code path — and with the descriptors this file
 *    was just read as having, because a `FontFace` built without them claims
 *    `normal` on all three and a variable face registered that way is pinned to
 *    its default instance while the export writes the real range.
 * 4. **Declare**, last, so the first render in which any value can name the
 *    family is a render in which the face is already usable. For the uploader,
 *    in the tab they uploaded in, there is then no gap at all.
 *
 * The face built in step 1 is thrown away rather than added: adding it here
 * would be step 3 done twice under two different owners, and the point of
 * routing through `register` is that a family in `document.fonts` got there once.
 */
async function adopt(
	name: string,
	bytes: Uint8Array,
	write: () => Promise<string>,
	/**
	 * What the face is, where the caller already knows rather than has to guess.
	 *
	 * Only the Google fetch passes it, and it is the one thing a fetch does
	 * better than an upload: `describeFont` reads a filename stem and a weight
	 * heuristic because a `.woff2`'s tables are Brotli and unreadable without a
	 * decompressor, while a css2 stylesheet *states* the family, the weight
	 * descriptor and the style. So the fetched face arrives with `100 900` on it
	 * rather than with `400` guessed off `Inter-Variable.woff2`, which is the
	 * single field on {@link FontFile} where being wrong has a consequence.
	 */
	known?: FontDescription,
): Promise<{ file: FontFile } | { lost: string }> {
	try {
		const probe = new FontFace("dc-probe", bytes.slice().buffer as ArrayBuffer);
		await probe.load();
	} catch {
		return {
			lost: "This file could not be read as a font. CSS loads .woff2, .woff, .ttf and .otf; a collection (.ttc) and a bare .dfont are not among them.",
		};
	}
	const src = await write();
	const file: FontFile = {
		...(known ?? describeFont(name, bytes)),
		src,
		bytes: bytes.length,
		name,
	};
	await register(file);
	return { file };
}

/**
 * The fonts panel.
 *
 * Every field here writes through `addFont`, which is idempotent on the path —
 * so correcting a weight descriptor replaces the declaration rather than
 * doubling it, and the panel needs no separate "edit" door.
 */
export function Fonts({
	scene,
	onSceneChange,
	held,
	ready,
	used,
	onImported,
}: FontsProps) {
	const [busy, setBusy] = useState(false);
	/** What is typed into the Google search, and which family is being fetched. */
	const [query, setQuery] = useState("");
	const [fetching, setFetching] = useState<string | undefined>(undefined);
	/**
	 * What is being typed into a family field, over what the document holds.
	 *
	 * The house pattern — `Inputs.tsx`, `LayerStrip.tsx`, `StateStrip.tsx` all
	 * keep a draft over a name the document normalises — and here it is not
	 * cosmetic. `normalizeFonts` **drops a declaration with no family**, and
	 * rightly: a family names nothing a value could point at, so a row without one
	 * is a row nothing can use. But select-all-and-retype is how a person renames
	 * anything, and without a draft the empty keystroke in the middle of that
	 * gesture deleted the declaration, took the row off the panel and left the
	 * caret in a field that no longer existed — with any value that named the old
	 * family now pointing at a family the page does not declare. Found by typing
	 * in it.
	 *
	 * So an empty field is a draft and never a write. Blur clears the draft, and
	 * what comes back is the family the document still holds: leaving the field
	 * empty is abandoning a rename, not deleting a face. The file itself is
	 * removed by the × beside it, which says what it does.
	 */
	const [draft, setDraft] = useState<{ src: string; text: string } | undefined>(
		undefined,
	);
	const declared = scene.fonts ?? [];
	const heldPaths = new Set(held.map((f) => f.path));
	const missing = new Set(missingFonts(scene, heldPaths).map((f) => f.src));
	const families = fontFamilies(scene);
	// The project's own font files this page has not declared. Sorted already by
	// `useAssetFiles`, so the middle group is stable between renders and between
	// two people looking at the same project.
	const spare = held.filter((f) => isFontPath(f.path) && !declared.some((d) => d.src === f.path));
	const tail = SYSTEM_FONTS[0].value;

	/** Replace one declaration, in place, by path. */
	const edit = (file: FontFile, patch: Partial<FontFile>) =>
		onSceneChange(
			(prev) => addFont(prev, { ...file, ...patch }),
			`font-${file.src}`,
		);

	async function bring(
		name: string,
		bytes: Uint8Array,
		write: () => Promise<string>,
		known?: FontDescription,
		/** Sentences from further up, where the caller already dropped something. */
		alsoLost: string[] = [],
	): Promise<void> {
		setBusy(true);
		try {
			const result = await adopt(name, bytes, write, known);
			if ("lost" in result) {
				onImported({ name, lost: [result.lost, ...alsoLost] });
				return;
			}
			onSceneChange((prev) => addFont(prev, result.file));
			onImported({ name, lost: alsoLost });
		} catch {
			onImported({ name, lost: ["This file could not be added to the project."] });
		} finally {
			setBusy(false);
		}
	}

	/**
	 * Fetch a family from Google Fonts into this project.
	 *
	 * The fetch ends at `bring`, which is where an upload ends, and everything
	 * after that point is the same code — so a fetched family is a file in
	 * `/assets` and a `FontFile` in the document, indistinguishable from a
	 * dropped one. That is the whole of why this feature is a picker rather than
	 * a new kind of font reference, and why it works on a train the moment after
	 * it has worked once online.
	 *
	 * The losses are reported on the *first* face, not once per file: a static
	 * family fetches regular and bold, and telling somebody twice that italics
	 * were left behind is telling them the second time about a decision they have
	 * already read.
	 */
	async function fetchFamily(family: GoogleFamily): Promise<void> {
		setFetching(family.name);
		try {
			const { faces, lost } = await fetchGoogleFamily(family);
			for (const [i, face] of faces.entries()) {
				await bring(
					face.name,
					face.bytes,
					() => putNamedAsset(face.name, face.bytes),
					face.describe,
					i === 0 ? lost : [],
				);
			}
		} catch (e) {
			onImported({
				name: family.name,
				lost: [
					e instanceof Error && e.message.includes("does not serve")
						? e.message
						: `${family.name} could not be fetched. The picker needs the network; the fonts already in this project do not.`,
				],
			});
		} finally {
			setFetching(undefined);
		}
	}

	return (
		<div className={styles.fonts} data-role="fonts">
			<h3 className={styles.section}>This page</h3>
			{/* Two counts and they are two different questions. The first is a fact
			    about the document; the second is a fact about the design on screen,
			    read off the answer set — so a rule that dresses a node in a family
			    is counted and a family nobody reached for is not. */}
			<p className={styles.tally} data-role="font-tally">
				{declared.length === 0 ? (
					// One clause and not three. "0 in the design on screen" is arithmetic
					// about an empty roster, and a tally that spells out what follows from
					// nothing having been declared is a sentence a reader has to finish
					// before learning it said nothing.
					"no families declared"
				) : (
					<>
						{`${families.size} famil${families.size === 1 ? "y" : "ies"} declared`}
						{used === undefined
							? null
							: ` · ${[...used].filter((f) => families.has(f)).length} in the design on screen`}
						{/* What the roster weighs, without loading a byte — and the number
						    a designer is actually about to send somebody, because an HTML
						    export inlines every used face at four thirds of this. */}
						{` · ${size(fontTotalBytes(scene))}`}
					</>
				)}
			</p>
			{declared.length === 0 ? (
				<p className={styles.empty}>
					This page sets text in the system families. Add a font file and it
					joins every font menu in the studio.
				</p>
			) : null}

			{declared.map((file) => {
				const gone = missing.has(file.src);
				const loaded = ready.has(file.family);
				const siblings = families.get(file.family)?.length ?? 1;
				return (
					<div
						key={file.src}
						className={styles.face}
						data-role="font"
						data-font={file.src}
					>
						<div className={styles.faceHead}>
							<input
								className={styles.family}
								data-role="font-family"
								value={draft?.src === file.src ? draft.text : file.family}
								title="What this document calls the face. It is the name in the @font-face rule and the name a value puts at the front of its stack — ours, not the file's, so a label that reads wrong is a field to correct and never a design that does not paint."
								onChange={(e) => {
									const text = e.target.value;
									setDraft({ src: file.src, text });
									// Written through on every keystroke, like every other name
									// in the studio, except the empty one — see the draft's
									// note. A rename in progress is in the document, so nothing
									// is lost to a navigation in the middle of one.
									if (text !== "") edit(file, { family: text });
								}}
								onBlur={() => setDraft(undefined)}
							/>
							<button
								type="button"
								className={styles.remove}
								data-role="remove-font"
								title="Stop declaring this face on this page. The file stays in the project — another page may declare it — and every value that named the family keeps painting the rest of its stack."
								onClick={() =>
									onSceneChange((prev) => removeFont(prev, file.src))
								}
							>
								×
							</button>
						</div>

						<div className={styles.fileLine}>
							<span className={styles.fileName} title={file.src}>
								{file.name}
							</span>
							<span className={styles.bytes}>{size(file.bytes)}</span>
							{siblings > 1 ? (
								<span className={styles.tag} data-role="font-siblings">
									{siblings} faces
								</span>
							) : null}
							{gone ? (
								<span className={styles.bad} data-role="font-missing">
									file not in this project
								</span>
							) : loaded ? null : (
								<span className={styles.tag} data-role="font-waiting">
									not loaded
								</span>
							)}
						</div>

						{gone ? (
							<p className={styles.note}>
								This page sets text in “{file.family}”, whose file “{file.src}”
								is not in this project — so those boxes hug the fallback in the
								stack rather than the face. A page opened without its assets, or
								still syncing them, reads this way.
							</p>
						) : null}

						<div className={styles.descriptors}>
							<label className={styles.field}>
								<span className={styles.fieldLabel}>weight</span>
								<input
									className={styles.text}
									data-role="font-weight"
									value={file.weight}
									title="The font-weight descriptor, verbatim as CSS writes it: 400 for a static face, 100 900 for a variable one. Declared as a single number a variable face is clamped to its default instance and every other weight is faked; declared as a range a static face claims weights it does not have. The strip below is how you tell which happened."
									onChange={(e) => edit(file, { weight: e.target.value })}
								/>
							</label>
							<label className={styles.field}>
								<span className={styles.fieldLabel}>style</span>
								<select
									className={styles.choice}
									data-role="font-style"
									value={file.style}
									onChange={(e) => edit(file, { style: e.target.value })}
								>
									<option value="normal">normal</option>
									<option value="italic">italic</option>
									<option value="oblique">oblique</option>
								</select>
							</label>
						</div>

						{file.axes && file.axes.length > 0 ? (
							<div className={styles.axes} data-role="font-axes">
								{file.axes
									.map((axis) => `${axis.tag} ${axis.min}–${axis.max}`)
									.join(" · ")}
							</div>
						) : null}

						{/* The one thing that can be wrong is the one thing that is
						    visibly wrong in five seconds. Painted in the stack the menu
						    would write, so what is on screen here is exactly what a node
						    wearing this family gets — including the fallback, when the
						    face has not loaded. */}
						<div className={styles.preview} data-role="font-preview">
							{PREVIEW_WEIGHTS.map((weight) => (
								<span
									key={weight}
									className={styles.sample}
									style={{
										fontFamily: fontStack(file.family, tail),
										fontWeight: weight,
										fontStyle: file.style === "normal" ? undefined : file.style,
									}}
								>
									{file.family}
								</span>
							))}
						</div>
					</div>
				);
			})}

			<h3 className={styles.section}>In this project</h3>
			{spare.length === 0 ? (
				<p className={styles.empty}>
					Every font file in this project is declared on this page.
				</p>
			) : (
				spare.map((file) => (
					<div key={file.path} className={styles.spare} data-role="project-font">
						<span className={styles.fileName} title={file.path}>
							{stemOf(file.path)}
						</span>
						<span className={styles.bytes}>{size(file.bytes)}</span>
						<button
							type="button"
							className={styles.add}
							data-role="adopt-font"
							disabled={busy}
							title="Declare this file on this page. The bytes are already here — nothing is uploaded and nothing is copied."
							onClick={() => {
								void (async () => {
									const bytes = await resolveAsset(file.path);
									if (!bytes) {
										onImported({
											name: file.path,
											lost: ["That file is no longer in this project."],
										});
										return;
									}
									// The path is the one that already exists, so the "write"
									// step is a no-op that answers where the bytes are. Same
									// four steps, one of them already done.
									await bring(
										file.path.slice(file.path.lastIndexOf("/") + 1),
										bytes,
										async () => file.path,
									);
								})();
							}}
						>
							Add to this page
						</button>
					</div>
				))
			)}

			{/*
			  * The picker is online and the font is not.
			  *
			  * What this fetches are *bytes*, into `/assets`, through the same
			  * `bring` an upload goes through — so the family is a file in the
			  * project a second later, syncs with it, and is there on a train. See
			  * `googleFonts.ts` for why that is a different thing from the linked
			  * webfont `docs/framer-parity-plan.md` §9 turned down, and for why the
			  * list below ships in the bundle rather than being fetched (Google's
			  * catalogue endpoint sends no CORS header and no browser can read it).
			  */}
			<h3 className={styles.section}>From Google Fonts</h3>
			<input
				className={styles.search}
				data-role="google-search"
				type="search"
				placeholder="Search 1,900 families"
				value={query}
				title="Pick a family here and its file is downloaded into this project. From then on it works offline and travels with the project, exactly like a font you added yourself."
				onChange={(e) => setQuery(e.target.value)}
			/>
			{query.trim() === "" ? (
				<p className={styles.hint}>
					Type a family name. The one you pick is downloaded into this project
					and works offline from then on.
				</p>
			) : (
				(() => {
					const hits = searchGoogle(query, 8);
					if (hits.length === 0) {
						return (
							<p className={styles.empty}>
								Nothing in the list matches. The list is a snapshot, so a family
								added to Google since can still be fetched — check the spelling
								against fonts.google.com.
							</p>
						);
					}
					return hits.map((family) => {
						// Whether this project already holds the files this fetch would
						// write. Asked of the tree rather than of the document, because
						// the bytes are the thing a second fetch would duplicate — the
						// declaration is per page and being absent here is ordinary.
						const have = fetchedFileNames(family).every((n) =>
							held.some((f) => f.path === `/assets/${n}`),
						);
						return (
							<div
								key={family.name}
								className={styles.hit}
								data-role="google-family"
								data-family={family.name}
							>
								<span className={styles.hitName}>{family.name}</span>
								<span className={styles.hitMeta}>
									{family.category}
									{family.variable
										? ` · variable ${family.variable.min}–${family.variable.max}`
										: ` · ${family.weights.length} weight${family.weights.length === 1 ? "" : "s"}`}
								</span>
								<button
									type="button"
									className={styles.hitAdd}
									data-role="fetch-font"
									disabled={busy || fetching !== undefined || have}
									title={
										have
											? "This project already holds this family's file."
											: "Download this family into the project. It syncs with the project and works offline afterwards."
									}
									onClick={() => void fetchFamily(family)}
								>
									{have ? "In project" : fetching === family.name ? "…" : "Add"}
								</button>
							</div>
						);
					});
				})()
			)}

			<h3 className={styles.section}>Add a font</h3>
			<label className={styles.upload}>
				<input
					type="file"
					className={styles.file}
					data-role="add-font"
					accept={FONT_ACCEPT}
					disabled={busy}
					onChange={(e) => {
						const file = e.target.files?.[0];
						// Cleared so choosing the same file twice is two events, which is
						// what somebody who replaced the file on disk expects.
						e.target.value = "";
						if (!file) return;
						void (async () => {
							const bytes = new Uint8Array(await file.arrayBuffer());
							await bring(file.name, bytes, () =>
								putNamedAsset(file.name, bytes),
							);
						})();
					}}
				/>
			</label>
			<p className={styles.hint}>
				Fonts are files this project holds — they sync with it, they work
				offline, and they travel inside an exported HTML file. That is as true
				of one picked above as of one added here: the picker downloads the file,
				it does not link to it.
			</p>
			<p className={styles.hint}>
				A .woff2 is several times smaller than the .ttf of the same face, and an
				export carries whichever you add.
			</p>
		</div>
	);
}
