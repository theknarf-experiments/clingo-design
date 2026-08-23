import { useCallback, useEffect, useRef } from "react";
import { Link, useParams } from "react-router";
import { type Scene, findProject } from "@clingo-design/design-core";

import { Studio } from "../design/Studio";
import { useHistory } from "../design/useHistory";
import { saveScene, useProjects, useProjectsReady } from "../projects/store";
import styles from "./Project.module.css";

/**
 * An opened project.
 *
 * Undo history lives here rather than in the store: it is per-editing-session,
 * and the persisted document should only ever hold the current state.
 */
export function Project() {
	const { id } = useParams();
	const projects = useProjects();
	const ready = useProjectsReady();
	const project = findProject(projects, id);

	const history = useHistory<Scene | null>(project?.scene ?? null);
	const loaded = useRef<string | undefined>(undefined);

	// Load the document once per project; later store updates are our own.
	useEffect(() => {
		if (!project || loaded.current === project.id) return;
		loaded.current = project.id;
		history.reset(project.scene);
	}, [project, history]);

	const scene = history.present ?? project?.scene ?? null;

	const onSceneChange = useCallback(
		(next: Scene | ((prev: Scene) => Scene), coalesce?: string) => {
			history.set(
				(prev) => (prev ? (typeof next === "function" ? next(prev) : next) : prev),
				coalesce,
			);
		},
		[history],
	);

	// The single persistence path: whatever is present is what gets stored.
	// Undo and redo change the document too, so anything narrower would miss
	// them, and the store must mirror the present rather than a stack entry.
	useEffect(() => {
		if (!id || !history.present) return;
		saveScene(id, history.present);
	}, [history.present, id]);

	// Until the store has opened, an unknown id only means "not read back yet".
	if (!ready) return null;

	if (!project || !scene) {
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
			scene={scene}
			onSceneChange={onSceneChange}
			projectName={project.name}
			undo={history.undo}
			redo={history.redo}
			canUndo={history.canUndo}
			canRedo={history.canRedo}
		/>
	);
}
