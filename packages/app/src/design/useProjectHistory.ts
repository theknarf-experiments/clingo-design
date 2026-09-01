import { useCallback, useEffect, useState } from "react";
import type { Scene } from "@clingo-design/design-core";

import {
	type Heads,
	headsOf,
	sameHeads,
	saveScene,
	sceneAt,
	sceneOf,
} from "../projects/store";

/** Deep enough that nobody reaches the end of it by hand. */
const LIMIT = 200;

export interface ProjectHistory {
	canUndo: boolean;
	canRedo: boolean;
	/** Apply an edit. `coalesce` groups a gesture into one undo entry. */
	change: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	undo: () => void;
	redo: () => void;
}

interface Stack {
	past: Heads[];
	future: Heads[];
	/** Key of the run of edits currently being collapsed, if any. */
	coalesce: string | null;
}

const EMPTY: Stack = { past: [], future: [], coalesce: null };

/**
 * Undo over an Automerge document.
 *
 * The past is not kept alongside the document — it *is* the document. Automerge
 * records every change, so a step back is a pair of hashes (`Heads`) rather
 * than a whole copied scene, and the stack costs nothing to keep deep.
 *
 * **One past per page, since a project became a tree of documents.** It used to
 * be one past per project, because a project was one document that was the
 * scene. Now each page is its own document with its own history, which is what
 * anybody would want the moment there are two of them: undoing on one page must
 * not reach into another, and now it cannot, because they share no document to
 * step. Nothing in the stepping below changed — it reads and writes one page,
 * and which page is an argument.
 *
 * Undo writes the old scene forward as a new change rather than rewinding the
 * document to it. That is the difference that matters once two people share a
 * document: rewinding would discard whatever the other one had done since,
 * while a change that happens to restore an old value merges like any other.
 *
 * Automerge has the history but no undo command, so the stepping is here.
 */
export function useProjectHistory(
	id: string | undefined,
	path?: string,
): ProjectHistory {
	const [stack, setStack] = useState<Stack>(EMPTY);

	// Each document has its own past; carrying one across would step a page back
	// to a state that was never its own. Keyed on the page as well as the
	// project, so switching pages switches pasts rather than inheriting one.
	useEffect(() => setStack(EMPTY), [id, path]);

	const change = useCallback(
		(next: (prev: Scene) => Scene, coalesce?: string) => {
			if (!id) return;
			const current = sceneOf(id, path);
			if (!current) return;
			const before = headsOf(id, path);
			saveScene(id, next(current), path);
			// A change that wrote nothing is not a step. Comparing heads is
			// exact where comparing scenes would only be a guess.
			if (sameHeads(before, headsOf(id, path))) return;

			setStack((s) => {
				const continuing = coalesce !== undefined && coalesce === s.coalesce;
				return {
					past: continuing ? s.past : [...s.past, before as Heads].slice(-LIMIT),
					future: [],
					coalesce: coalesce ?? null,
				};
			});
		},
		[id, path],
	);

	const step = useCallback(
		(from: "past" | "future") => {
			if (!id) return;
			const source = from === "past" ? stack.past : stack.future;
			const target = source[source.length - 1];
			if (!target) return;
			const here = headsOf(id, path);
			const scene = sceneAt(id, target, path);
			if (!scene || !here) return;
			saveScene(id, scene, path);
			setStack((s) =>
				from === "past"
					? { past: s.past.slice(0, -1), future: [...s.future, here], coalesce: null }
					: { past: [...s.past, here], future: s.future.slice(0, -1), coalesce: null },
			);
		},
		[id, path, stack],
	);

	return {
		canUndo: stack.past.length > 0,
		canRedo: stack.future.length > 0,
		change,
		undo: useCallback(() => step("past"), [step]),
		redo: useCallback(() => step("future"), [step]),
	};
}
