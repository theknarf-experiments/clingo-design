import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { TEMPLATES, type Template, uniqueName } from "@clingo-design/design-core";

import {
	createProject,
	deleteProject,
	renameProject,
	useProjects,
	useProjectsError,
	useProjectsReady,
} from "../projects/store";
import styles from "./Projects.module.css";

function relativeTime(ts: number): string {
	const seconds = Math.round((ts - Date.now()) / 1000);
	const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
		["second", 60],
		["minute", 60],
		["hour", 24],
		["day", 7],
		["week", 4.35],
		["month", 12],
		["year", Number.POSITIVE_INFINITY],
	];
	const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
	let value = seconds;
	for (const [unit, span] of units) {
		if (Math.abs(value) < span) return format.format(Math.round(value), unit);
		value /= span;
	}
	return format.format(Math.round(value), "year");
}

export function Projects() {
	const projects = useProjects();
	const ready = useProjectsReady();
	const error = useProjectsError();
	const navigate = useNavigate();
	const [renaming, setRenaming] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
	const renameInput = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (renaming) renameInput.current?.select();
	}, [renaming]);

	function newFrom(template: Template) {
		// Asynchronous now: creating a project creates documents, and a document
		// is ready when the repo says so. The navigation waits for the url
		// because the url *is* the project — there is no id to route to before
		// the directory document exists.
		void createProject(
			uniqueName(projects.map((p) => p.name), template.name),
			template.create(),
		).then((url) => navigate(`/p/${encodeURIComponent(url)}`));
	}

	function commitRename(id: string) {
		renameProject(id, draft);
		setRenaming(null);
	}

	const ordered = projects;

	return (
		<div className={styles.page}>
			<div className={styles.inner}>
				<header className={styles.head}>
					<h1>Clingo Design</h1>
					<p className={styles.tagline}>
						Designs that exist in every state their constraints allow.
					</p>
				</header>

				<section className={styles.section}>
					<h2>Start something</h2>
					<div className={styles.templates}>
						{TEMPLATES.map((template) => (
							<button
								key={template.id}
								type="button"
								className={styles.template}
								data-template={template.id}
								onClick={() => newFrom(template)}
							>
								<span className={styles.templateName}>{template.name}</span>
								<span className={styles.templateDesc}>
									{template.description}
								</span>
							</button>
						))}
					</div>
				</section>

				<section className={styles.section}>
					<h2>
						Your projects
						{ordered.length > 0 ? (
							<span className={styles.count}> {ordered.length}</span>
						) : null}
					</h2>

					{/* Nothing until the store has opened: an empty list and a list
					    not yet read back look the same, and only one of them is
					    worth saying out loud. */}
					{error ? (
						<p className={styles.failed} data-role="store-error">
							Saved projects could not be opened: {error}
						</p>
					) : null}

					{ordered.length === 0 ? (
						ready && !error ? (
							<p className={styles.empty} data-role="empty">
								No projects yet. Pick a template above to make one.
							</p>
						) : null
					) : (
						<ul className={styles.list}>
							{ordered.map((project) => (
								<li
									key={project.url}
									className={styles.row}
									data-project={project.url}
								>
									{renaming === project.url ? (
										<input
											ref={renameInput}
											className={styles.renameInput}
											data-role="rename-input"
											value={draft}
											onChange={(e) => setDraft(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter") commitRename(project.url);
												if (e.key === "Escape") setRenaming(null);
											}}
											onBlur={() => commitRename(project.url)}
										/>
									) : (
										<button
											type="button"
											className={styles.open}
											data-role="open"
											onClick={() => navigate(`/p/${encodeURIComponent(project.url)}`)}
										>
											<span className={styles.name}>{project.name}</span>
											<span className={styles.when}>
												edited {relativeTime(project.updatedAt)}
											</span>
										</button>
									)}

									<div className={styles.actions}>
										{renaming === project.url ? null : (
											<button
												type="button"
												className={styles.action}
												data-role="rename"
												onClick={() => {
													setDraft(project.name);
													setConfirmDelete(null);
													setRenaming(project.url);
												}}
											>
												Rename
											</button>
										)}
										{confirmDelete === project.url ? (
											<>
												<button
													type="button"
													className={`${styles.action} ${styles.danger}`}
													data-role="confirm-delete"
													onClick={() => {
														deleteProject(project.url);
														setConfirmDelete(null);
													}}
												>
													Delete
												</button>
												<button
													type="button"
													className={styles.action}
													data-role="cancel-delete"
													onClick={() => setConfirmDelete(null)}
												>
													Cancel
												</button>
											</>
										) : (
											<button
												type="button"
												className={styles.action}
												data-role="delete"
												onClick={() => {
													setRenaming(null);
													setConfirmDelete(project.url);
												}}
											>
												Delete
											</button>
										)}
									</div>
								</li>
							))}
						</ul>
					)}
				</section>
			</div>
		</div>
	);
}
