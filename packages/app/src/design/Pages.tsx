import { useEffect, useRef, useState } from "react";

import { addPage, deletePage, renamePage, usePages } from "../projects/store";
import styles from "./Pages.module.css";

export interface PagesProps {
	/** The project's url. */
	url: string;
	/** The page being shown. */
	active: string | undefined;
	/** Go to a page — the caller navigates, because a page is part of the url. */
	onOpen: (name: string) => void;
}

/**
 * The project's pages, above its layers.
 *
 * A list rather than a row of tabs, and above the layer list rather than across
 * the top of the canvas: a page is a *container of layers*, so the two belong in
 * one column with the containing thing above the contained one. Tabs across the
 * canvas would put them beside the toolbar, which is about the thing being
 * drawn rather than about which drawing it is.
 *
 * Each page is its own Automerge document — see `store.ts` — and everything that
 * follows from that is visible here. Renaming is a re-key of the directory and
 * keeps the document, so a page's whole undo history survives it. Deleting is a
 * real deletion, which is why it asks. And the last page cannot be deleted at
 * all: a project with no pages cannot be opened, which is a worse outcome than
 * the deletion somebody asked for.
 */
export function Pages({ url, active, onOpen }: PagesProps) {
	const names = usePages(url);
	const [renaming, setRenaming] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const input = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (renaming) input.current?.select();
	}, [renaming]);

	const commit = async () => {
		const from = renaming;
		setRenaming(null);
		if (!from) return;
		const to = draft.trim();
		// A rename to a name already taken, or to nothing, leaves the page alone —
		// `renamePage` refuses rather than uniquifying, because a rename is somebody
		// typing a specific word and "About 2" is not the word they typed.
		if (!(await renamePage(url, from, to))) return;
		// The url names the page, so a rename is a navigation: leaving the old name
		// in the address bar would be an address that no longer resolves.
		if (active === from) onOpen(to);
	};

	return (
		<section className={styles.host} data-role="pages">
			<header className={styles.head}>
				<span className={styles.title}>Pages</span>
				<button
					type="button"
					className={styles.add}
					data-role="add-page"
					aria-label="Add a page"
					title="A new page, empty, in this project"
					onClick={() => void addPage(url).then(onOpen)}
				>
					+
				</button>
			</header>

			<ul className={styles.list}>
				{names.map((name) => (
					<li key={name}>
						{renaming === name ? (
							<input
								ref={input}
								className={styles.rename}
								data-role="rename-page"
								value={draft}
								onChange={(e) => setDraft(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") void commit();
									if (e.key === "Escape") setRenaming(null);
								}}
								onBlur={() => void commit()}
							/>
						) : (
							<div
								className={styles.row}
								data-page={name}
								data-active={name === active ? "" : undefined}
							>
								<button
									type="button"
									className={styles.name}
									onClick={() => onOpen(name)}
									onDoubleClick={() => {
										setDraft(name);
										setRenaming(name);
									}}
								>
									{name}
								</button>
								{/* Offered only where it can be obeyed. The last page cannot
								    go, and a delete button that refuses on click teaches
								    nothing — its absence is the explanation. */}
								{names.length > 1 ? (
									<button
										type="button"
										className={styles.remove}
										data-role="delete-page"
										aria-label={`Delete ${name}`}
										title="Delete this page and its history"
										onClick={() => {
											if (!confirm(`Delete “${name}”? Its history goes with it.`)) {
												return;
											}
											void deletePage(url, name).then((gone) => {
												// Only move if the page being shown is the one that
												// went; deleting another page must not navigate.
												if (gone && name === active) {
													onOpen(names.find((n) => n !== name) ?? name);
												}
											});
										}}
									>
										×
									</button>
								) : null}
							</div>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}
