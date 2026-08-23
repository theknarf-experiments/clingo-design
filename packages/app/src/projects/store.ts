import { useSyncExternalStore } from "react";
import {
	type Doc,
	change,
	from,
	getHeads,
	initializeWasm,
	load,
	save,
	view,
} from "@automerge/automerge/slim";
import wasmUrl from "@automerge/automerge/automerge.wasm?url";
import {
	type Project,
	type Scene,
	normalizeScene,
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
let failure: string | null = null;
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
const getFailure = () => failure;

export function useProjects(): Project[] {
	return useSyncExternalStore(subscribe, getProjects, getProjects);
}

export function useProjectsReady(): boolean {
	return useSyncExternalStore(subscribe, getReady, getReady);
}

/** Why the store is empty, when it is empty because something broke. */
export function useProjectsError(): string | null {
	return useSyncExternalStore(subscribe, getFailure, getFailure);
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
/* History                                                             */
/* ------------------------------------------------------------------ */

/**
 * A point in the document's history.
 *
 * Automerge records every change, so the past does not have to be kept
 * alongside the document — it *is* the document. What a stack of these
 * replaces is a stack of whole scenes.
 */
export type Heads = string[];

/** The scene as the document currently holds it. */
export function sceneOf(id: string): Scene | null {
	return docs.get(id)?.scene ?? null;
}

export function sameHeads(a: Heads | null, b: Heads | null): boolean {
	if (!a || !b || a.length !== b.length) return false;
	return a.every((h, i) => h === b[i]);
}

export function headsOf(id: string): Heads | null {
	const doc = docs.get(id);
	return doc ? getHeads(doc) : null;
}

/** The scene as it stood at `heads`, without moving the document there. */
export function sceneAt(id: string, heads: Heads): Scene | null {
	const doc = docs.get(id);
	if (!doc) return null;
	try {
		return normalizeScene(view(doc, heads).scene);
	} catch {
		// Heads from a document that has since been replaced.
		return null;
	}
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

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

async function boot(): Promise<void> {
	await initializeWasm(wasmUrl);
	try {
		for (const [id, bytes] of await loadAll()) adopt(id, bytes);
	} catch {
		// No database: the session works, it just will not survive a reload.
	}
	ready = true;
	publish();
}

/**
 * A failed boot must say so.
 *
 * Every reader gates on {@link useProjectsReady}, so a rejected wasm load used
 * to leave `ready` false forever: no projects, no error, a blank page. The
 * store now becomes ready either way and carries the reason it is empty.
 */
void boot().catch((err: unknown) => {
	failure = err instanceof Error ? err.message : String(err);
	ready = true;
	publish();
});
