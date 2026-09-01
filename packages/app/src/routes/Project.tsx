import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { Studio } from "../design/Studio";
import { useProjectHistory } from "../design/useProjectHistory";
import { pagePath, useProject, useProjectsError, usePages } from "../projects/store";
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
	const { id, page: named } = useParams();
	const navigate = useNavigate();
	const error = useProjectsError();
	const names = usePages(id);

	// Which page the url names, or the first one there is. Resolved against the
	// tree rather than trusted: a url naming a page that has been deleted or
	// renamed should open the project at *a* page rather than report it as gone,
	// which is what asking for a document at a path nothing lives at would do.
	const known = named !== undefined && names.includes(named);
	const active = known ? named : names[0];
	const path = active === undefined ? undefined : pagePath(active);

	const page = useProject(id, path);
	const history = useProjectHistory(id, path);

	// A url that named a page which is not there any more is rewritten rather
	// than left in the address bar saying something untrue. Replace, not push, so
	// the back button does not land on the broken address again.
	useEffect(() => {
		if (!id || named === undefined || known || names.length === 0) return;
		navigate(`/p/${encodeURIComponent(id)}/${encodeURIComponent(names[0])}`, {
			replace: true,
		});
	}, [id, named, known, names, navigate]);

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
			activePage={active}
			onOpenPage={(name) =>
				navigate(`/p/${encodeURIComponent(id ?? "")}/${encodeURIComponent(name)}`)
			}
			undo={history.undo}
			redo={history.redo}
			canUndo={history.canUndo}
			canRedo={history.canRedo}
		/>
	);
}
