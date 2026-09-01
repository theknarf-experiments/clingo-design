import { Link, useParams } from "react-router";

import { Studio } from "../design/Studio";
import { useProjectHistory } from "../design/useProjectHistory";
import { useProject, useProjectsError } from "../projects/store";
import styles from "./Project.module.css";

/**
 * An opened project.
 *
 * The document is the single source of truth: there is no copy of the scene
 * here to keep in step with the store. Undo walks the document's own history
 * rather than a parallel stack of past scenes — see {@link useProjectHistory}.
 *
 * The id in the route is the directory document's url, which is also what a
 * collaborator is given: following a link to a project you have never opened
 * opens it and adds it to your list, with no import step in between. That is
 * the whole of sharing, and it is why the url is the identity rather than an id
 * of ours that would have needed mapping to one.
 */
export function Project() {
	const { id } = useParams();
	const error = useProjectsError();
	const page = useProject(id);
	const history = useProjectHistory(id);

	// Undefined is "still opening" and null is "cannot be opened", and the two
	// must not render alike: a synced project waits on a network, and showing
	// "deleted" while it does would be a lie that a reload appears to fix.
	if (page === undefined) return null;

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

	if (!page) {
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
			scene={page.scene}
			onSceneChange={(next, coalesce) =>
				history.change(
					typeof next === "function" ? next : () => next,
					coalesce,
				)
			}
			projectName={page.name}
			projectUrl={id}
			undo={history.undo}
			redo={history.redo}
			canUndo={history.canUndo}
			canRedo={history.canRedo}
		/>
	);
}
