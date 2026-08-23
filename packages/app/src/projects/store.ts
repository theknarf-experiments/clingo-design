import { useSyncExternalStore } from "react";
import {
	type Doc,
	change,
	from,
	initializeWasm,
	load,
	save,
} from "@automerge/automerge/slim";
import wasmUrl from "@automerge/automerge/automerge.wasm?url";
import {
	type Project,
	type Scene,
	normalizeScene,
	parseLegacyProjects,
	reconcile,
} from "@clingo-design/design-core";

import { loadAll, put, remove } from "./idb";

/**
 * The project store: one Automerge document per project, kept in IndexedDB.
 *
 * Automerge rather than a JSON blob because a document that records what
 * changed is what two people editing at once will need; this phase only uses
 * the storage half of that. The plain library and a hand-written object store
 * were chosen over automerge-repo: the repo's value is its network seam,
 * which nothing here uses yet, and its current release is mid-redesign.
 *
 * Documents live in a module-level map so both routes see the same data
 * without a context provider. Loading is asynchronous — the wasm module and
 * the database both have to open — so nothing may conclude that a project id
 * is unknown until {@link useProjectsReady} says so.
 */

const docs = new Map<string, Doc<Project>>();
let snapshot: Project[] = [];
let ready = false;
const listeners = new Set<() => void>();

function publish(): void {
	snapshot = [...docs.values()];
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

const getProjects = () => snapshot;
const getReady = () => ready;

export function useProjects(): Project[] {
	return useSyncExternalStore(subscribe, getProjects, getProjects);
}

export function useProjectsReady(): boolean {
	return useSyncExternalStore(subscribe, getReady, getReady);
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

/** Writes are debounced because the studio edits the scene on every keystroke. */
const DEBOUNCE_MS = 250;
const pending = new Map<string, ReturnType<typeof setTimeout>>();

function schedule(id: string): void {
	clearTimeout(pending.get(id));
	pending.set(id, setTimeout(() => flush(id), DEBOUNCE_MS));
}

function flush(id: string): void {
	clearTimeout(pending.get(id));
	pending.delete(id);
	const doc = docs.get(id);
	if (!doc) return;
	// Out of quota, or storage disabled: the session still works, the edit
	// just will not survive a reload.
	void put(id, save(doc)).catch(() => {});
}

// The debounce is a write budget, not a grace period — a reload right after
// an edit must still find it.
document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "hidden") {
		for (const id of [...pending.keys()]) flush(id);
	}
});

/**
 * Applies a change and keeps the result only if there was one. Automerge
 * hands back the very same document when the callback wrote nothing, which is
 * how a save that changed nothing is told apart from a real edit.
 */
function edit(id: string, mutate: (draft: Project) => void): void {
	const doc = docs.get(id);
	if (!doc) return;
	const next = change(doc, mutate);
	if (next === doc) return;
	docs.set(id, next);
	schedule(id);
	publish();
}

export function addProject(project: Project): void {
	docs.set(project.id, from(project));
	schedule(project.id);
	publish();
}

export function renameProject(id: string, name: string): void {
	const trimmed = name.trim();
	// An empty name would leave an unclickable row, so keep the old one.
	if (!trimmed) return;
	edit(id, (draft) => {
		if (draft.name === trimmed) return;
		draft.name = trimmed;
		draft.updatedAt = Date.now();
	});
}

export function deleteProject(id: string): void {
	clearTimeout(pending.get(id));
	pending.delete(id);
	docs.delete(id);
	void remove(id).catch(() => {});
	publish();
}

export function saveScene(id: string, scene: Scene): void {
	edit(id, (draft) => {
		if (reconcile(draft.scene, scene)) draft.updatedAt = Date.now();
	});
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

const LEGACY_KEY = "clingo-design.projects";
const IMPORTED_KEY = "clingo-design.projects.imported";

function adopt(id: string, bytes: Uint8Array): void {
	let doc: Doc<Project>;
	try {
		doc = load<Project>(bytes);
	} catch {
		// One unreadable record is a lost project; throwing here is a lost studio.
		return;
	}
	// A document outlives the code that wrote it, so its scene is brought up
	// to the current shape on the way in, and only rewritten if that moved.
	const scene = normalizeScene(doc.scene);
	const fixed = change(doc, (draft) => {
		if (draft.scene) reconcile(draft.scene, scene);
		else draft.scene = scene;
	});
	docs.set(id, fixed);
	if (fixed !== doc) schedule(id);
}

/**
 * The one-time import out of localStorage.
 *
 * The old value is left where it is and a marker written beside it: a marker
 * costs a few bytes, and nobody's work should hinge on this being right the
 * first time.
 */
function importLegacy(): void {
	let text: string | null;
	try {
		if (localStorage.getItem(IMPORTED_KEY)) return;
		text = localStorage.getItem(LEGACY_KEY);
	} catch {
		// Private mode and blocked-storage settings throw on access.
		return;
	}
	for (const project of parseLegacyProjects(text)) {
		// Anything already in the database has been edited since; it wins.
		if (docs.has(project.id)) continue;
		docs.set(project.id, from(project));
		schedule(project.id);
	}
	try {
		localStorage.setItem(IMPORTED_KEY, "1");
	} catch {
		// Unwritable storage means the import runs again next time, which is
		// harmless: the ids are the same, so it lands on the same documents.
	}
}

async function boot(): Promise<void> {
	await initializeWasm(wasmUrl);
	try {
		for (const [id, bytes] of await loadAll()) adopt(id, bytes);
	} catch {
		// No database: the session works, it just will not survive a reload.
	}
	importLegacy();
	ready = true;
	publish();
}

void boot();
