import { useSyncExternalStore } from "react";
import {
	type Project,
	parseProjects,
	serializeProjects,
} from "@clingo-design/design-core";

const KEY = "clingo-design.projects";

/**
 * The project list, held in one module-level store so both routes see the same
 * data without a context provider. Writes are debounced because the studio
 * updates the scene on every keystroke.
 */

function read(): Project[] {
	try {
		return parseProjects(globalThis.localStorage?.getItem(KEY));
	} catch {
		// Private mode and blocked-storage settings throw on access.
		return [];
	}
}

let pending: ReturnType<typeof setTimeout> | null = null;

function write(list: readonly Project[]): void {
	if (pending) clearTimeout(pending);
	pending = setTimeout(() => {
		pending = null;
		try {
			globalThis.localStorage?.setItem(KEY, serializeProjects(list));
		} catch {
			// Out of quota or storage disabled: the session still works, the
			// list just will not survive a reload.
		}
	}, 250);
}

let state: Project[] = read();
const listeners = new Set<() => void>();

export function getProjects(): Project[] {
	return state;
}

export function setProjects(
	next: Project[] | ((prev: Project[]) => Project[]),
): void {
	state = typeof next === "function" ? next(state) : next;
	write(state);
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useProjects(): Project[] {
	return useSyncExternalStore(subscribe, getProjects, getProjects);
}
