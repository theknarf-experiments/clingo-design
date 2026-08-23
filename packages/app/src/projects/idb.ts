/**
 * The projects object store.
 *
 * One record per project, holding that project's document as the bytes the
 * document library encodes it to — this file only moves them. The database
 * opens lazily so a browser that refuses storage rejects at the call site
 * rather than at import time.
 */

const DB_NAME = "clingo-design";
const DB_VERSION = 1;
const STORE = "projects";

let handle: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
	if (handle) return handle;
	handle = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE);
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
