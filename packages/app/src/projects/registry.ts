/**
 * Which projects this device knows about.
 *
 * A project's identity is the url of its directory document, and a document
 * store has no notion of "mine" — a repo answers for a url you ask it about and
 * cannot enumerate what you have. So the list lives here, in localStorage,
 * beside the documents rather than in them.
 *
 * That split is not a limitation to work around; it is the right shape twice
 * over. A project shared with you is a url someone sent, and opening it adds it
 * to *your* list without touching the document — so two people's lists differ
 * while the project is one thing. And where a project syncs has to be local by
 * necessity: the setting says which server holds the document, so reading it
 * out of the document would need the server you were trying to look up.
 *
 * Everything here is a cache except the url. The document's own title is
 * authoritative — {@link name} is kept in step on open and on rename so the
 * landing page can render a list without opening every document in it, which on
 * a synced project means without waiting for a network.
 */

export interface ProjectEntry {
	/** The directory document's url. The project's identity, and what a
	 *  collaborator is given. */
	url: string;
	/** Cached from the document's title — see the note above. */
	name: string;
	/** ms epoch. Newest first in the list. */
	createdAt: number;
	/**
	 * ms epoch of the last edit this device made or saw.
	 *
	 * A cache with no authority at all, and the one field here that can be
	 * *wrong* rather than merely stale: another device's edit does not touch it
	 * until this one opens the project. It exists because the landing page says
	 * "edited 20 minutes ago", and the honest alternative — opening every
	 * document to ask — is the thing this file exists to avoid.
	 */
	updatedAt: number;
	/**
	 * Whether this project syncs to a server at all.
	 *
	 * Absent means no. A project stays on the machine it was made on until
	 * somebody says otherwise: creating it in a syncing repo would publish it
	 * before anyone had the chance to decide, and there is no unpublishing.
	 */
	sync?: boolean;
	/** Which server, when not the one this build was configured with. */
	server?: string;
}

const KEY = "clingo-design:projects";

function read(): ProjectEntry[] {
	try {
		const raw = localStorage.getItem(KEY);
		const list = raw ? (JSON.parse(raw) as unknown) : [];
		// A stored list from a future version, or a hand-edited one, must not take
		// the landing page down with it — an entry without a url is not a project.
		return Array.isArray(list)
			? list.filter((e): e is ProjectEntry =>
					typeof (e as ProjectEntry)?.url === "string",
				)
			: [];
	} catch {
		// Storage disabled, or quota exhausted on read. The session works; the
		// list is simply empty until something writes to it successfully.
		return [];
	}
}

function write(list: readonly ProjectEntry[]): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(list));
	} catch {
		// Out of quota, or storage disabled. Losing the list loses the way *back*
		// to a project, never the project — the documents are in IndexedDB and, if
		// it syncs, on a server. Failing loudly here would stop an edit that has
		// already succeeded.
	}
}

/** Known projects, newest first. */
export function listProjects(): ProjectEntry[] {
	return read().sort((a, b) => b.createdAt - a.createdAt);
}

export function findEntry(url: string): ProjectEntry | undefined {
	return read().find((p) => p.url === url);
}

/**
 * Record a project, or refresh what is cached about one.
 *
 * Runs on create and on every open, which is what makes a url someone sent you
 * add itself to your list the first time you follow it.
 *
 * Only the cached fields are touched on an existing entry. The sync settings are
 * the project's own decision and re-asserting a default here would quietly undo
 * a checkbox every time the project was opened.
 */
export function upsertProject(
	url: string,
	patch: { name?: string; updatedAt?: number; sync?: boolean; server?: string },
	now = Date.now(),
): void {
	const list = read();
	const at = list.findIndex((p) => p.url === url);
	if (at === -1) {
		list.push({
			url,
			name: patch.name ?? "Untitled",
			createdAt: now,
			updatedAt: patch.updatedAt ?? now,
			...(patch.sync === undefined ? {} : { sync: patch.sync }),
			...(patch.server === undefined ? {} : { server: patch.server }),
		});
	} else {
		const entry = list[at];
		list[at] = {
			...entry,
			...(patch.name === undefined ? {} : { name: patch.name }),
			...(patch.updatedAt === undefined ? {} : { updatedAt: patch.updatedAt }),
			...(patch.sync === undefined ? {} : { sync: patch.sync }),
			...(patch.server === undefined ? {} : { server: patch.server }),
		};
	}
	write(list);
}

/**
 * Forget a project.
 *
 * Forgetting, not deleting — and the difference is worth keeping in the name.
 * The documents are content-addressed and may be on a server and in somebody
 * else's list; what this removes is this device's way back to them. A project
 * that syncs is still there for everyone it was shared with, and the url still
 * opens it.
 */
export function forgetProject(url: string): void {
	write(read().filter((p) => p.url !== url));
}
