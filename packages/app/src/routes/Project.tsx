import { Link, useParams } from "react-router";
import { findProject } from "@clingo-design/design-core";

import { Studio } from "../design/Studio";
import { useProjectHistory } from "../design/useProjectHistory";
import { useProjects, useProjectsError, useProjectsReady } from "../projects/store";
import styles from "./Project.module.css";

/**
 * An opened project.
 *
 * The document is the single source of truth: there is no copy of the scene
 * here to keep in step with the store. Undo walks the document's own history
 * rather than a parallel stack of past scenes — see {@link useProjectHistory}.
 */
export function Project() {
	const { id } = useParams();
	const projects = useProjects();
	const ready = useProjectsReady();
	const error = useProjectsError();
	const project = findProject(projects, id);
	const history = useProjectHistory(id);

	// Until the store has opened, an unknown id only means "not read back yet".
	if (!ready) return null;

	if (error) {
		return (
			<section className={styles.missing}>
				<h1>Projects could not be opened</h1>
				<p className={styles.reason}>{error}</p>
				<p>
					Nothing has been lost — the documents are still in this browser's
					storage. <Link to="/">Back to projects</Link>.
				</p>
			</section>
		);
	}

	if (!project) {
		return (
			<section className={styles.missing}>
				<h1>Project not found</h1>
				<p>
					It may have been deleted. <Link to="/">Back to projects</Link>.
				</p>
			</section>
		);
	}

	return (
		<Studio
			scene={project.scene}
			onSceneChange={(next, coalesce) =>
				history.change(
					typeof next === "function" ? next : () => next,
					coalesce,
				)
			}
			projectName={project.name}
			undo={history.undo}
			redo={history.redo}
			canUndo={history.canUndo}
			canRedo={history.canRedo}
		/>
	);
}
