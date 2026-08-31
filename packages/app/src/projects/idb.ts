/**
 * The browser's two object stores.
 *
 * `projects` holds one record per project — that project's document as the
 * bytes the document library encodes it to, which this file only moves.
 * `assets` holds model payloads keyed by their own hash, shared across every
 * project, which is design-core's `AssetStore` with IndexedDB underneath.
 *
 * They share a database deliberately; see the note on {@link ASSETS}. The
 * database opens lazily so a browser that refuses storage rejects at the call
 * site rather than at import time.
 */

import type { AssetStore } from "@clingo-design/design-core";

const DB_NAME = "clingo-design";
const DB_VERSION = 2;
const STORE = "projects";
/**
 * Model payloads, keyed by their own SHA-256 — see design-core's `assets.ts`.
 *
 * A second object store in the same database rather than a database of its own,
 * because the two are opened together, cleared together and quota'd together: a
 * browser that evicts site data takes both, and a store that could be evicted
 * separately from the documents referencing it would turn "your chair is
 * missing" from a thing that cannot normally happen into a thing that happens
 * on a schedule nobody controls.
 *
 * Shared by every project rather than partitioned per project, which is the
 * whole of what content addressing buys here: two documents importing the same
 * chair store it once, and duplicating it per project would be storing the same
 * bytes under the same name twice.
 */
const ASSETS = "assets";

let handle: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
	if (handle) return handle;
	handle = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		// Create only what is missing. The v1 database already holds `projects`,
		// and `createObjectStore` on an existing name throws — so an unguarded
		// upgrade would make every existing user's database fail to open, with
		// their documents inside it, which is as bad as this file gets.
		request.onupgradeneeded = () => {
			const db = request.result;
			for (const name of [STORE, ASSETS]) {
				if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
		request.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
	});
	return handle;
}

/** Every stored document, by project id. */
export async function loadAll(): Promise<Map<string, Uint8Array>> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, "readonly");
		const store = tx.objectStore(STORE);
		// Both requests are issued before the transaction can settle, and both
		// come back in key order, so they line up by index.
		const keys = store.getAllKeys();
		const values = store.getAll();
		tx.oncomplete = () => {
			const out = new Map<string, Uint8Array>();
			keys.result.forEach((key, i) => {
				out.set(String(key), values.result[i] as Uint8Array);
			});
			resolve(out);
		};
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

export async function put(id: string, bytes: Uint8Array): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, "readwrite");
		tx.objectStore(STORE).put(bytes, id);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

export async function remove(id: string): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, "readwrite");
		tx.objectStore(STORE).delete(id);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

/* ------------------------------------------------------------------ */
/* Model payloads                                                      */
/* ------------------------------------------------------------------ */

/** One transaction over the asset store, as a promise. */
function assetTx<T>(
	mode: IDBTransactionMode,
	work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
	return open().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const tx = db.transaction(ASSETS, mode);
				const request = work(tx.objectStore(ASSETS));
				tx.oncomplete = () => resolve(request.result);
				tx.onerror = () => reject(tx.error);
				tx.onabort = () => reject(tx.error);
			}),
	);
}

/**
 * The browser's implementation of design-core's `AssetStore`.
 *
 * An object rather than five loose exports, because it is handed to things that
 * take the interface — the import flow, and eventually anything that wants to
 * audit or garbage-collect — and a caller holding the interface should not have
 * to know it came from this module.
 *
 * `put` is content-addressed and therefore idempotent by construction: storing
 * bytes whose hash is already present writes the same bytes back under the same
 * key. So an import of a file the store already holds is a no-op that costs one
 * transaction, and nothing anywhere has to check first.
 */
export const assetStore: AssetStore = {
	get: (id) => assetTx("readonly", (s) => s.get(id) as IDBRequest<Uint8Array | undefined>),
	put: (id, bytes) => assetTx("readwrite", (s) => s.put(bytes, id)).then(() => undefined),
	// `count` rather than `get`, so asking whether a two-megabyte chair is present
	// does not read two megabytes to answer yes.
	has: (id) => assetTx("readonly", (s) => s.count(id)).then((n) => n > 0),
	keys: () =>
		assetTx("readonly", (s) => s.getAllKeys()).then((keys) =>
			keys.map(String).sort(),
		),
	remove: (id) => assetTx("readwrite", (s) => s.delete(id)).then(() => undefined),
};
