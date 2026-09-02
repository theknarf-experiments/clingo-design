import { useEffect, useState, useSyncExternalStore } from "react";
import {
	type AutomergeUrl,
	DEFAULT_SYNC_SERVER,
	type DocHandle,
	type SyncTarget,
	type UrlHeads,
	type VfsProject,
	createProject as createVfsProject,
	openProject,
	serverConnected,
} from "@clingo-design/vfs";
import {
	COMPONENT_TYPE,
	type Scene,
	type SceneNode,
	componentName,
	componentPath,
	asDefinition,
	composeLibrary,
	decomposeLibrary,
	documentLinks,
	emptyScene,
	normalizeScene,
	pageName,
	pagePath,
	reconcile,
	repointLinks,
} from "@clingo-design/design-core";

import {
	type ProjectEntry,
	findEntry,
	forgetProject,
	listProjects,
	upsertProject,
} from "./registry";

/**
 * The project store, over the virtual filesystem.
 *
 * A project is a **directory document** whose keys are paths, and everything it
 * is made of is a document at one of those paths. That is Patchwork's shape and
 * it is why the app moved onto it: the previous store held one document per
 * project with the whole scene inside it, which has exactly one slot, and
 * images, glTF payloads, several pages and components shared between them are
 * all separate things that need somewhere to be.
 *
 * ## What lives where
 *
 * ```
 *   /pages/<name>.scene   a `clingo-design:scene` document — the Scene, structurally
 *   /assets/<name>.<ext>  a `file` document — the pictures and models somebody imported
 * ```
 *
 * The scene is a **document, not a serialised file**, and that is the decision
 * the whole arrangement turns on. Written into a file's `content` it would be
 * one string, so two people editing two different nodes would be two edits to
 * one blob and Automerge would merge them as text — which is the one thing this
 * document model exists not to do. As a document, a fill and a frame written at
 * the same time by two people both land, because they are different keys.
 *
 * Assets are the opposite case and take the opposite answer: bytes have no
 * structure to merge, so one of them wins. That used to be softened by content
 * addressing — two writers of one path were writing the same bytes by
 * construction — and it no longer is, because a file is named by the person who
 * imported it. Replacing `/assets/chair.glb` with a different chair is now a
 * thing somebody can do, and it is the *feature*: every node that references it
 * draws the new one. Two people importing two different chairs under one name
 * on one day is the case where last-writer-wins is felt, and the answer is the
 * suffix {@link putNamedAsset} gives a collision it can see.
 *
 * ## What this file does not hold
 *
 * The list of projects. A repo answers for a url you ask about and cannot
 * enumerate what you have, so the list is local — see `registry.ts`, which
 * explains why that is right rather than a workaround.
 *
 * And Automerge itself. `@clingo-design/vfs` is the only door: the app has no
 * direct dependency on the library, because two copies of it in one page is two
 * wasm instances, and the failure that produces is a document that will not
 * open rather than a version warning.
 */

/** The datatype a page's scene document declares. */
export const SCENE_TYPE = "clingo-design:scene";

/**
 * Where a project's first page lives.
 *
 * A path rather than a reserved key, because pages are a *list* and the tree is
 * how this document model spells a list of documents. Multi-page is then more
 * files at more paths rather than a second mechanism — `pathsOfType` is already
 * the page list, and nothing here has to change to gain it.
 */
export const MAIN_PAGE = "/pages/main.scene";

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

/**
 * A page's name is its filename, and its path is where it lives.
 *
 * **Defined in `design-core/src/pages.ts` and re-exported here**, which is a move
 * rather than a duplication: the compiler now has to turn a page path into an ASP
 * constant — a link names a page and `link(N,P)` needs one — and `design-core`
 * may not import from the app. The four call sites in this file and the one in
 * `Project.tsx` keep importing them from here, so nothing churned.
 *
 * `MAIN_PAGE` and `SCENE_TYPE` stay: the first is a policy about where a new
 * project's first page goes and the second is a vfs datatype tag. Neither is a
 * pure string function about paths.
 */
export { PAGE_DIR, pageName, pagePath } from "@clingo-design/design-core";

/**
 * Every page of a project, by name, in the order the tree gives them.
 *
 * Sorted by `pathsOfType`, so alphabetical rather than by creation — which is a
 * real limitation and is left rather than papered over: an ordered list of pages
 * is a field somebody has to store, and storing it in the directory document
 * means an edit to the project every time a tab is dragged. Worth doing when
 * somebody wants to drag a tab; not worth inventing first.
 *
 * Empty while the project is opening. A caller that needs to tell "no pages yet"
 * from "not read yet" has {@link useProject}'s tri-state for the page it is
 * actually showing.
 */
export function usePages(url: string | undefined): string[] {
	const [names, setNames] = useState<string[]>([]);

	useEffect(() => {
		if (!url) {
			setNames([]);
			return;
		}
		let alive = true;
		let stop: (() => void) | undefined;
		void project(url).then((p) => {
			if (!alive) return;
			// Re-read on every structural change: adding, renaming and deleting a
			// page are all writes to the directory document, and `subscribe` is what
			// the vfs already fires for those.
			const read = () => setNames(p.pathsOfType(SCENE_TYPE).map(pageName));
			read();
			stop = p.subscribe(read);
		});
		return () => {
			alive = false;
			stop?.();
		};
	}, [url]);

	return names;
}

/**
 * Which pages link to which, read from the documents.
 *
 * From the tree and **not from any answer set**, and the split is deliberate.
 * There are two reachability questions and they have two homes. "Which pages does
 * this *design* lead to" is `goes/1`, per universe, in the program of the page you
 * have open — because whether a link is live depends on whether its node is, and
 * only the solver knows that. "Which pages does this *project* link between" is a
 * question about the documents, and answering it in ASP would mean grounding every
 * page's program to find out, which is a solve per page to draw a marker in a list.
 *
 * So this reads the scenes and never solves. The cost is that it reports a link on
 * a node a rule hides as a link, which is right for this question: the document
 * does link there, and whether some design uses it is the other question, asked
 * elsewhere.
 *
 * The answer is keyed by the **target** page's name and holds the names of the
 * pages that lead to it, which is the direction the Pages panel asks in: "does
 * anything link here". A page nothing links to is absent rather than empty, so a
 * caller reads `?.length` and gets the same answer either way.
 *
 * Re-read on every structural change, exactly as {@link usePages} is — and a
 * link is an edit *inside* a page document, which `subscribe` also fires for.
 */
export function usePageLinks(
	url: string | undefined,
): Record<string, string[]> {
	const [links, setLinks] = useState<Record<string, string[]>>({});

	useEffect(() => {
		if (!url) {
			setLinks({});
			return;
		}
		let alive = true;
		let stop: (() => void) | undefined;
		void project(url).then((p) => {
			if (!alive) return;
			const read = () => {
				const out: Record<string, string[]> = {};
				for (const path of p.pathsOfType(SCENE_TYPE)) {
					const scene = p.docAt<SceneDoc>(path)?.doc()?.scene;
					if (!scene) continue;
					const from = pageName(path);
					// Uncomposed, because a link inside a *component* document belongs to
					// that component and follows to wherever it is placed — which is a
					// question about instances and therefore about a solve. What this
					// counts is what the page's own document says.
					for (const to of new Set(documentLinks(scene).values())) {
						const name = pageName(to);
						(out[name] ??= []).push(from);
					}
				}
				for (const list of Object.values(out)) list.sort();
				setLinks(out);
			};
			read();
			stop = p.subscribe(read);
		});
		return () => {
			alive = false;
			stop?.();
		};
	}, [url]);

	return links;
}

/**
 * Every file in the project's `/assets` directory, by path, sorted, with what
 * each one weighs.
 *
 * **The studio's first listing of the tree**, and it is deliberately a listing
 * of *paths* rather than a file browser. `Inspector.tsx` says at length why
 * there is no relink button yet, and this does not become one: what asks for
 * this is the Fonts panel, which needs to offer the font files a project already
 * holds so that adding a family to a second page is a click rather than a second
 * upload that `putNamedAsset` would suffix into `InterVariable-2.woff2`. The
 * roster being per page is a real limitation and this is its whole mitigation.
 *
 * It is also what answers "is this file here at all", which is the question
 * `fontNotes` is asked and which no amount of reading the document can settle.
 *
 * The size comes from the snapshot, which is already in memory: these are the
 * bytes the project is holding, so `.length` on them is a property read and not
 * a load. Sorted for the reason `assetPaths` is sorted — a caller keys an effect
 * on the joined list, and an order that followed the tree's own iteration would
 * churn it.
 *
 * Re-read on every structural change, exactly as {@link usePages} is: writing a
 * file is a write to the project, and `subscribe` is what the vfs already fires
 * for one.
 */
export function useAssetFiles(
	url: string | undefined,
): Array<{ path: string; bytes: number }> {
	const [files, setFiles] = useState<Array<{ path: string; bytes: number }>>([]);

	useEffect(() => {
		if (!url) {
			setFiles([]);
			return;
		}
		let alive = true;
		let stop: (() => void) | undefined;
		void project(url).then((p) => {
			if (!alive) return;
			const read = () =>
				setFiles(
					Object.entries(p.snapshot())
						.filter(
							(entry): entry is [string, Uint8Array] =>
								entry[0].startsWith("/assets/") && entry[1] instanceof Uint8Array,
						)
						.map(([path, content]) => ({ path, bytes: content.length }))
						.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
				);
			read();
			stop = p.subscribe(read);
		});
		return () => {
			alive = false;
			stop?.();
		};
	}, [url]);

	return files;
}

/**
 * Add a page, and answer the name it actually got.
 *
 * Uniquified rather than refused, the way a new project's name is: two pages
 * called "Page 2" would be one path, and the second `createDoc` would hand back
 * the first one's handle — so the page would silently not be created. Answering
 * the real name is what lets the caller navigate to it.
 */
export async function addPage(url: string, name = "Page"): Promise<string> {
	const p = await project(url);
	const taken = new Set(p.pathsOfType(SCENE_TYPE).map(pageName));
	let chosen = name;
	for (let n = 2; taken.has(chosen); n++) chosen = `${name} ${n}`;
	p.createDoc<SceneDoc>(pagePath(chosen), SCENE_TYPE, { scene: emptyScene() });
	upsertProject(url, { updatedAt: Date.now() });
	publish();
	return chosen;
}

/**
 * Rename a page, and answer whether it happened.
 *
 * The document moves and keeps its identity — `renamePath` re-keys the directory
 * and leaves the scene document alone — so a page's history survives being
 * renamed, which is the thing that would be most annoying to lose.
 *
 * Refused where the name is taken or empty, rather than uniquified: a rename is
 * a person typing a specific word, and silently making it "About 2" is not what
 * they asked for. Adding a page is the opposite case, which is why it does the
 * opposite thing.
 */
export async function renamePage(
	url: string,
	from: string,
	to: string,
): Promise<boolean> {
	const trimmed = to.trim();
	if (trimmed === "" || trimmed === from) return false;
	const p = await project(url);
	const taken = new Set(p.pathsOfType(SCENE_TYPE).map(pageName));
	if (taken.has(trimmed) || !taken.has(from)) return false;
	p.renamePath(pagePath(from), pagePath(trimmed));
	// And every link into it follows, because a rename keeps the document: the
	// page a link points at still exists and is still the same document, and only
	// its address changed. A reference that keeps pointing at it is *correct*, so
	// leaving it on the old address would break every link into a page because
	// somebody fixed a typo in its name — an edit nobody asked for.
	//
	// This writes other pages' documents and is therefore an entry in their undo
	// histories, which is the honest cost and is the right one: the alternative is
	// a repair on read, and a repair on read makes *looking* at a project an edit
	// that syncs. `repointLinks` assigns only where it differs, so a page holding
	// no such link produces no change at all and no `updatedAt` bump.
	//
	// Deleting a page does **nothing of the sort**, and the asymmetry is a fact
	// about the two verbs rather than a preference: there is no document left to
	// point at, so a link into it leads nowhere and saying so is the honest state.
	// That is `deleteComponent`'s stance verbatim; here the larger edit would be
	// silently un-linking nodes across the project because one page went away.
	for (const path of p.pathsOfType(SCENE_TYPE)) {
		const handle = p.docAt<SceneDoc>(path);
		handle?.change((draft) => {
			repointLinks(draft.scene, pagePath(from), pagePath(trimmed));
		});
	}
	// The handle is cached under the old path; drop it so the next read finds it
	// where it now lives.
	pages.delete(pageKey(url, pagePath(from)));
	upsertProject(url, { updatedAt: Date.now() });
	publish();
	return true;
}

/**
 * Delete a page — and refuse to delete the last one.
 *
 * A project with no pages is a project that cannot be opened: `useProject` finds
 * no document at any path and reports the project as gone, which is a much
 * worse thing than the deletion the person asked for. So the last page stays,
 * and the UI does not offer to remove it.
 *
 * Unlike a project, this really does delete: the scene document is dropped from
 * the tree and its history goes with it. That is what deleting a page means, and
 * it is why the caller confirms first.
 */
export async function deletePage(url: string, name: string): Promise<boolean> {
	const p = await project(url);
	const all = p.pathsOfType(SCENE_TYPE).map(pageName);
	if (all.length <= 1 || !all.includes(name)) return false;
	p.deletePath(pagePath(name));
	pages.delete(pageKey(url, pagePath(name)));
	upsertProject(url, { updatedAt: Date.now() });
	publish();
	return true;
}

/** What a page document holds, beside the datatype tag the vfs writes. */
interface SceneDoc {
	scene: Scene;
}

/* ------------------------------------------------------------------ */
/* The list                                                            */
/* ------------------------------------------------------------------ */

let entries: ProjectEntry[] = [];
let ready = false;
let failure: string | null = null;
const listeners = new Set<() => void>();

function publish(): void {
	entries = listProjects();
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

const getEntries = () => entries;
const getReady = () => ready;
const getFailure = () => failure;

export function useProjects(): ProjectEntry[] {
	return useSyncExternalStore(subscribe, getEntries, getEntries);
}

export function useProjectsReady(): boolean {
	return useSyncExternalStore(subscribe, getReady, getReady);
}

/** Why the store is empty, when it is empty because something broke. */
export function useProjectsError(): string | null {
	return useSyncExternalStore(subscribe, getFailure, getFailure);
}

/**
 * The list is readable before any document is.
 *
 * Reading localStorage is synchronous and opening a repo is not — the wasm has
 * to load — so the landing page renders its list immediately and a project's
 * contents arrive when they arrive. That is the whole reason the registry caches
 * a name: the alternative is a blank page until Automerge is ready.
 */
entries = listProjects();
ready = true;

/* ------------------------------------------------------------------ */
/* The component library                                               */
/* ------------------------------------------------------------------ */

/**
 * What a component document holds.
 *
 * A **scene**, exactly like a page — not a bare node, which is what it held when
 * only the compiler read it. The moment a component has to be *edited*, holding
 * a scene is what makes that free: `useProject` opens it, `useProjectHistory`
 * steps it, `saveScene` writes it, and the studio draws it, all unchanged. A
 * bare node would have needed a second reader, a second writer and a second
 * undo stack, for a document that is edited in precisely the same way.
 *
 * Its single root is the definition. One root because a component is one thing;
 * the scene is what it is drawn on.
 */
type ComponentDoc = SceneDoc;

/** The definition inside a component document, or nothing where it has none. */
const definitionIn = (doc: ComponentDoc | undefined): SceneNode | undefined =>
	doc?.scene?.nodes?.[0];

/**
 * Every component document a project holds, by path.
 *
 * Read fresh from the handles rather than cached, because it is read on the way
 * to *and* from every edit — see the compose/decompose pair — and a cache with
 * two readers on a hot path is a cache that has to be invalidated correctly on
 * a structural change. The handles are already loaded and `doc()` is a property
 * read; the walk is over the number of components a project has.
 */
/**
 * Projects open this session, synchronously.
 *
 * `open` holds promises because opening is asynchronous; this holds the results,
 * because {@link saveScene} runs on every keystroke and cannot await. Filled in
 * as each one resolves — the same split `pages` makes and for the same reason.
 */
const opened = new Map<string, VfsProject>();

function libraryOf(p: VfsProject): Record<string, SceneNode> {
	const out: Record<string, SceneNode> = {};
	for (const path of p.pathsOfType(COMPONENT_TYPE)) {
		const node = definitionIn(p.docAt<ComponentDoc>(path)?.doc());
		// A document with no definition in it is one being created, or one written
		// by something else. It is skipped rather than defaulted: a component with
		// no root would splice an undefined node into the scene.
		if (node) out[path] = node;
	}
	return out;
}

/* ------------------------------------------------------------------ */
/* Opening                                                             */
/* ------------------------------------------------------------------ */

/**
 * Projects opened this session, by url.
 *
 * Held rather than reopened because opening loads every document in the tree,
 * and because two components asking for one project must get one project — two
 * `VfsProject`s over one directory doc would each hold their own handles and
 * each emit their own changes.
 */
const open = new Map<string, Promise<VfsProject>>();

/**
 * Where a project syncs, as *this device's registry* says — and `null`, which
 * means nowhere, for anything the registry has never heard of.
 *
 * **The default is local and that is the whole of this function.** `openProject`
 * defaults its target to `DEFAULT_SYNC_SERVER`, which is the build's configured
 * server and, in development, `ws://localhost:8080`. Calling it with no target
 * therefore opened *every* project into a syncing repo — while `createProject`
 * made them in the local one. It appeared to work because both repos share an
 * IndexedDB namespace, so the document was found either way, and the only
 * visible symptom was a websocket dialled at every open.
 *
 * What it would have cost is not a symptom. The moment a build is configured
 * with a server, opening a project would have published it — every project,
 * including ones nobody chose to share — and the vfs states the rule this
 * breaks in as many words: a project stays on the machine it was made on until
 * its settings say otherwise, because creating it in a syncing repo publishes it
 * before anyone had the chance to decide, and there is no unpublishing.
 *
 * So the setting is read, never defaulted to a server. A project with `sync` off
 * or absent is local; one with `sync` on and no server of its own follows the
 * build's default, which is what lets a deployment move without every project
 * pinning itself to an address.
 */
function targetFor(url: string): SyncTarget {
	const entry = findEntry(url);
	if (!entry?.sync) return null;
	return entry.server ?? DEFAULT_SYNC_SERVER;
}

function project(url: string): Promise<VfsProject> {
	const existing = open.get(url);
	if (existing) return existing;
	const opening = openProject(url, targetFor(url)).then((p) => {
		opened.set(url, p);
		// The document's title is authoritative; the registry caches it. Opening a
		// url someone shared is also what adds it to this device's list.
		upsertProject(url, { name: p.name() });
		publish();
		return p;
	});
	open.set(url, opening);
	return opening;
}

/**
 * Move a project between "nowhere" and a server, and answer where it ended up.
 *
 * Two writes, in this order and not the other: the registry first, then the
 * project is dropped from the open map so the next read reopens it through
 * {@link targetFor}. Reopening is how a project *moves* — the vfs flushes every
 * other repo first and the document keeps its url, so a project that starts
 * syncing is the same project at the same address rather than a copy.
 *
 * Turning sync **on** is the irreversible half and the UI says so. Turning it
 * off stops this device sending, and does not unsend: a document already on a
 * server is on it, and anyone holding the url still has it. "Stop syncing" and
 * "unpublish" are two different sentences and only the first one is true.
 */
export async function setProjectSync(
	url: string,
	sync: boolean,
	server?: string,
): Promise<void> {
	upsertProject(url, { sync, ...(server === undefined ? {} : { server }) });
	open.delete(url);
	for (const key of [...pages.keys()]) {
		if (key.startsWith(`${url}\u0000`)) pages.delete(key);
	}
	publish();
	// Reopened eagerly rather than left to the next render, so the socket is
	// dialled while the person is still looking at the switch they flipped —
	// which is what makes `useSyncState` below able to report a failure.
	await project(url);
}

/** Whether this project is set to sync, and to where. */
export function syncOf(url: string): { sync: boolean; server: string | null } {
	const entry = findEntry(url);
	return {
		sync: entry?.sync === true,
		server: entry?.server ?? DEFAULT_SYNC_SERVER,
	};
}

/**
 * Whether the socket for a project's server is actually up, polled.
 *
 * Polled rather than subscribed because the repo exposes a predicate and no
 * event, and a second-long poll is a truthful answer to a question nobody asks
 * more often than that. It costs a function call: `serverConnected` reads a flag
 * on a repo that already exists and never dials anything to find out.
 *
 * **Three states, not two, and the third is the one worth having.** A project
 * that does not sync is `"off"`; one that syncs and is talking is `"live"`; one
 * that is set to sync and is *not* talking is `"waiting"` — a server that is
 * down, a laptop on a train, a url with the right shape and the wrong host. The
 * settings panel can only validate the shape, because subduction refuses a
 * handshake whose audience does not match and from the browser that refusal is
 * silence. So the honest report is the live state, and this is it.
 */
export function useSyncState(url: string | undefined): "off" | "waiting" | "live" {
	const [live, setLive] = useState(false);
	const { sync, server } = url ? syncOf(url) : { sync: false, server: null };

	useEffect(() => {
		if (!sync || !server) return;
		const read = () => setLive(serverConnected(server));
		read();
		const timer = setInterval(read, 1000);
		return () => clearInterval(timer);
	}, [sync, server]);

	if (!sync || !server) return "off";
	return live ? "live" : "waiting";
}

/**
 * Handles for pages of projects open this session, so the synchronous readers
 * below can answer without awaiting.
 *
 * The studio edits on every keystroke and reads the scene on every render;
 * neither can be a promise. So opening is asynchronous and *having opened* is
 * not — {@link useProject} is what does the waiting, and everything after it
 * reads out of here.
 */
const pages = new Map<string, DocHandle<SceneDoc>>();

/**
 * One key for a project's page, across the two maps below.
 *
 * Joined on NUL because a project url and a tree path are both arbitrary text
 * and any printable separator could make two different pairs key alike.
 *
 * **Written as the escape and never as the byte.** A raw NUL makes `grep` treat
 * the whole file as binary and report *no matches* rather than skipping it
 * loudly — so the file vanishes from every search run over the source, and the
 * next person to look for `MAIN_PAGE` concludes it does not exist. That is not
 * hypothetical here: it is what commit 219bcd1 is about, and this line had
 * acquired a literal NUL again.
 */
const pageKey = (url: string, path: string) => `${url}\u0000${path}`;

/**
 * A project's page, live.
 *
 * Returns `undefined` while it opens and `null` when it cannot be opened, and
 * the caller has to tell those apart: the first is a spinner and the second is
 * "this project is gone", and showing the second during the first is how a
 * slow network becomes a deleted project.
 */
export function useProject(
	url: string | undefined,
	path = MAIN_PAGE,
): { scene: Scene; name: string } | null | undefined {
	const [state, setState] = useState<
		{ scene: Scene; name: string } | null | undefined
	>(undefined);

	useEffect(() => {
		if (!url) {
			setState(null);
			return;
		}
		let alive = true;
		setState(undefined);
		let stop: (() => void) | undefined;
		void (async () => {
			try {
				const p = await project(url);
				const handle = p.docAt<SceneDoc>(path);
				if (!handle) {
					if (alive) setState(null);
					return;
				}
				if (!alive) return;
				pages.set(pageKey(url, path), handle);
				showing = url;
				const read = () => {
					// Normalised on the way out rather than on the way in. A document
					// outlives the code that wrote it, and rewriting it on open would
					// make merely *looking* at a project an edit that syncs — which,
					// with two people, is an edit that conflicts with theirs.
					const doc = handle.doc();
					setState({
						// Composed on the way out: the definitions live in their own
						// documents and everything downstream — the compiler, the
						// canvas, the layer list — expects them to be nodes in the
						// scene. `saveScene` takes them back out again, and the pair is
						// the whole of how a component is shared between pages.
						scene: composeLibrary(normalizeScene(doc?.scene), libraryOf(p)),
						name: p.name(),
					});
				};
				read();
				stop = p.subscribe(read);
			} catch (error) {
				if (alive) {
					failure = error instanceof Error ? error.message : String(error);
					setState(null);
					publish();
				}
			}
		})();
		return () => {
			alive = false;
			stop?.();
		};
	}, [url, path]);

	return state;
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Create a project: a directory document, with one page in it.
 *
 * Local — no sync target — for the reason the vfs gives: a project made in a
 * syncing repo is published before anybody decided to publish it, and there is
 * no unpublishing.
 */
export async function createProject(name: string, scene = emptyScene()): Promise<string> {
	// No files: a new project's tree is empty, and the page below is a document
	// rather than a file so it cannot be passed in here.
	const { url } = await createVfsProject({}, name);
	const p = await project(url);
	p.createDoc<SceneDoc>(MAIN_PAGE, SCENE_TYPE, { scene });
	upsertProject(url, { name });
	publish();
	return url;
}

export function renameProject(url: string, name: string): void {
	const trimmed = name.trim();
	// An empty name leaves an unclickable row, so keep the old one.
	if (!trimmed) return;
	upsertProject(url, { name: trimmed });
	publish();
	void project(url).then((p) => p.rename(trimmed));
}

/**
 * Remove a project from this device's list.
 *
 * The documents are not deleted, and the name says so. They are
 * content-addressed, they may be on a server, and they may be in somebody
 * else's list — so this is the one operation whose scope is *this browser*.
 */
export function deleteProject(url: string): void {
	forgetProject(url);
	open.delete(url);
	for (const key of [...pages.keys()]) {
		if (key.startsWith(`${url}\u0000`)) pages.delete(key);
	}
	publish();
}

/**
 * Write a scene into its page document.
 *
 * Through {@link reconcile}, which is what makes this a document store rather
 * than a file: the studio hands out a whole new `Scene` on every keystroke, and
 * assigning it wholesale would rewrite every field of every node — one enormous
 * change per keypress, and every one of them a conflict with anybody editing
 * anything else. Reconciling writes only what differs, so two people working on
 * two nodes never touch the same key.
 */
export function saveScene(url: string, scene: Scene, path = MAIN_PAGE): void {
	const handle = pages.get(pageKey(url, path));
	if (!handle) return;
	const p = opened.get(url);
	const library = p ? libraryOf(p) : {};
	let changed = false;

	// **No write-back for spliced definitions, and that is not an omission.** A
	// definition composed into a page is hidden and left out of the layer list,
	// so nothing on a page can select one, and no edit can reach it. A component
	// is edited by opening its own document — which is a page-shaped edit through
	// this same function, at the component's path. Code here to reconcile an edit
	// that cannot happen would be a feature nobody could reach and a second writer
	// for the same document.
	//
	// `decomposeLibrary` below is still needed and is a different thing: it stops
	// the *composition* being written into the page, which happens on every save.
	handle.change((draft) => {
		if (reconcile(draft.scene, decomposeLibrary(scene, library))) changed = true;
	});
	// The registry's timestamp, not the document's: "edited 20 minutes ago" is a
	// fact about this device's list and the document has no field for it.
	if (changed) {
		upsertProject(url, { updatedAt: Date.now() });
		publish();
	}
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

/**
 * A point in a page's history.
 *
 * The repo's own `UrlHeads` rather than a type of ours, because it is what
 * `handle.heads()` answers with and `handle.view()` takes — inventing a
 * synonym would mean casting at both ends of every call.
 *
 * **History is per page now, and that follows from the split rather than being
 * a decision beside it.** Undo used to step the project document, which was the
 * scene, so there was one past. A project is now a tree of documents and each
 * has its own — which is what anybody would want the moment there are two
 * pages: undoing on one page must not reach into another, and it cannot,
 * because they do not share a document to step.
 */
export type Heads = UrlHeads;

export function sameHeads(a: Heads | null, b: Heads | null): boolean {
	if (!a || !b || a.length !== b.length) return false;
	return a.every((h, i) => h === b[i]);
}

/** The scene as its document currently holds it. */
export function sceneOf(url: string, path = MAIN_PAGE): Scene | null {
	const doc = pages.get(pageKey(url, path))?.doc();
	if (!doc?.scene) return null;
	// Composed, like `useProject` — and this is the one that is easy to forget,
	// because it is not what anybody *looks* at. It is the base every edit is
	// applied to: `useProjectHistory` reads it, hands it to the caller's function
	// and saves the result. Left uncomposed, an edit would be computed against a
	// scene with no component definitions in it while the canvas showed one with
	// them, so anything referring to a definition would silently do nothing —
	// which is exactly how placing an instance failed.
	const p = opened.get(url);
	return composeLibrary(normalizeScene(doc.scene), p ? libraryOf(p) : {});
}

export function headsOf(url: string, path = MAIN_PAGE): Heads | null {
	return pages.get(pageKey(url, path))?.heads() ?? null;
}

/** The scene as it stood at `heads`, without moving the document there. */
export function sceneAt(url: string, heads: Heads, path = MAIN_PAGE): Scene | null {
	const handle = pages.get(pageKey(url, path));
	if (!handle) return null;
	try {
		const p = opened.get(url);
		// Composed for the reason `sceneOf` is: undo writes an old scene forward as
		// a new change, so what comes back here is saved, and a scene that lost its
		// definitions on the way through undo would lose the instances' meaning
		// with it.
		return composeLibrary(
			normalizeScene(handle.view(heads).doc()?.scene),
			p ? libraryOf(p) : {},
		);
	} catch {
		// Heads from a document this page no longer is — a project reopened, or a
		// view asked for after the handle was dropped.
		return null;
	}
}

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

/**
 * Every component in the project, by name.
 *
 * Read off the tree like the pages are, and for the same reason: the documents
 * are the list, so an index beside them would be a second answer that could
 * disagree.
 */
export function useComponents(url: string | undefined): string[] {
	const [names, setNames] = useState<string[]>([]);

	useEffect(() => {
		if (!url) {
			setNames([]);
			return;
		}
		let alive = true;
		let stop: (() => void) | undefined;
		void project(url).then((p) => {
			if (!alive) return;
			const read = () =>
				setNames(p.pathsOfType(COMPONENT_TYPE).map(componentName).sort());
			read();
			stop = p.subscribe(read);
		});
		return () => {
			alive = false;
			stop?.();
		};
	}, [url]);

	return names;
}

/**
 * One component's definition, as its document holds it.
 *
 * Synchronous, and read straight from the library rather than from a composed
 * scene — because the caller that needs it is *placing the first instance*, and
 * `composeLibrary` splices only what a scene already references. A component
 * nobody has used yet is in no scene, which is exactly when this is asked.
 *
 * That laziness is deliberate and worth keeping: a design system with fifty
 * components would otherwise put fifty hidden definitions into every page's
 * program, and grounding would pay for all of them on every solve.
 */
export function componentDefinition(
	url: string,
	path: string,
): SceneNode | undefined {
	const p = opened.get(url);
	return p ? libraryOf(p)[path] : undefined;
}

/**
 * Turn a node into a component of its own, and answer where it went.
 *
 * The subtree is **moved**, not copied: it leaves the page and becomes the
 * document, and what stays behind is an instance of it in the same place. That
 * is what "make this a component" means everywhere else, and the alternative —
 * leaving the original behind beside a new instance — is two of the thing on the
 * canvas and a designer wondering which one is real.
 *
 * Uniquified like a page, because two components at one path are one document
 * and `createDoc` refuses to overwrite, so the second would silently not be
 * created.
 */
export async function extractComponent(
	url: string,
	node: SceneNode,
	name = node.name,
): Promise<string> {
	const p = await project(url);
	const taken = new Set(p.pathsOfType(COMPONENT_TYPE).map(componentName));
	let chosen = name.trim() || "Component";
	for (let n = 2; taken.has(chosen); n++) chosen = `${name} ${n}`;
	const path = componentPath(chosen);
	// The definition keeps the node's own id inside its document: it is the root
	// of its own tree there, and the id the composition gives it on the way into a
	// scene is derived from the path rather than from this.
	p.createDoc<ComponentDoc>(path, COMPONENT_TYPE, {
		// A scene of its own, with the definition as its only root — so the
		// component opens in the studio like a page and needs nothing else.
		// Through `asDefinition`, so the root can hold children: a component is a
		// thing you go on to edit, and a leaf root has nowhere for an edit to go.
		scene: { ...emptyScene(), nodes: [asDefinition(node)] },
	});
	upsertProject(url, { updatedAt: Date.now() });
	publish();
	return path;
}

/**
 * Delete a component document.
 *
 * The uses are left alone, dangling, and that is deliberate: a dangling
 * `instanceOf` derives nothing, so the pages that used it still open and the
 * instances are still there to be repointed or removed. Silently deleting
 * somebody's instances because they deleted a definition would be a much larger
 * edit than the one they asked for.
 */
export async function deleteComponent(url: string, name: string): Promise<void> {
	const p = await project(url);
	p.deletePath(componentPath(name));
	upsertProject(url, { updatedAt: Date.now() });
	publish();
}

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

/**
 * A project's payloads are files in its tree, addressed by path.
 *
 * This is the half the feature list actually wanted. They used to be an
 * IndexedDB object store beside the document, which meant a project could be
 * shared and arrive without its images — the bytes had no way to travel. As
 * `file` documents in the tree they sync with everything else, they clone onto
 * disk under their own names, and they show up in the tree as what they are.
 *
 * **By path, for both kinds, and that is one rule with no exception to
 * explain.** `asset/2` in the answer set carries where the payload lives, so a
 * node's picture is looked up the same way whether it is a photograph or a
 * chair, and in both cases what it names is *the file somebody imported*, under
 * the name they chose.
 *
 * This paragraph used to be longer, and the deletion is the argument. The glTF
 * importer used to split a file into one standalone payload per primitive and
 * write each under its content hash, so the rule read "by path, for both kinds,
 * except that a mesh has no name to keep" — a file in the tree in shape only.
 * Nobody could open it, a clone wrote a directory of hex, and replacing a chair
 * meant re-importing every node that drew one, because the reference was to
 * bytes rather than to a file. The importer now stores what was imported and a
 * `model` node references it and one part of it, so there is one writer here
 * ({@link putNamedAsset}) and one sentence about what it does.
 */

/**
 * The project the studio is currently showing.
 *
 * Assets used to be global — one store for the whole browser — and a key was
 * enough to find any of them. They belong to a project now, which is the point
 * of the move, so anything reading one has to know *which* project.
 *
 * A module-level answer rather than a prop threaded through Studio, Editor and
 * Artboard, and it is not a shortcut: the app renders one project at a time —
 * a route per project, no split view — so "which project" has one answer at any
 * moment, and three components passing it down would be three signatures wider
 * for a value none of them chooses. Set by {@link useProject}, which knows.
 *
 * The cost is stated rather than hidden: the day two projects are on screen at
 * once, this becomes a prop.
 */
let showing: string | null = null;

/**
 * The bytes at a path in the project on screen — what `canvas-3d` takes, and
 * what the image renderer reads.
 *
 * A stable function identity, deliberately: `useAsset` has it in an effect's
 * dependencies, and a fresh closure per render would re-fetch and re-parse every
 * payload in the view on every frame.
 */
export const resolveAsset = async (path: string): Promise<Uint8Array | undefined> => {
	if (!showing) return undefined;
	const p = await project(showing);
	const content = p.snapshot()[path];
	return content instanceof Uint8Array ? content : undefined;
};

/**
 * Put an imported file in the tree under its own name, and answer where it
 * landed.
 *
 * The name is kept because a person chose it: `/assets/hero.png` is what the
 * tree shows, what a clone writes to disk, and what the node references. A
 * collision takes a suffix rather than overwriting — two different pictures
 * called `photo.png` are two pictures, and silently replacing one with the
 * other is the kind of loss nobody notices until it is in a published design.
 *
 * **The single writer, for both kinds.** There was a second one beside it —
 * `putAsset(hash, bytes)`, which wrote the glTF importer's per-primitive
 * payloads to `/assets/<hash>` — and it is gone with the payloads themselves. A
 * chair is now written here, once, under `chair.glb`, and the ten nodes the
 * import mints all reference that one file. Files still at `/assets/<hash>` are
 * read exactly as before, because a document written by the old importer has
 * its refs migrated to those paths rather than to nothing.
 *
 * The returned path is not knowable in advance and that is why this answers with
 * it: the suffix is chosen here and the caller must stamp what actually happened
 * onto the node, not what it hoped would.
 */
export async function putNamedAsset(name: string, bytes: Uint8Array): Promise<string> {
	if (!showing) throw new Error("No project is open.");
	const p = await project(showing);
	const taken = new Set(Object.keys(p.snapshot()));
	const dot = name.lastIndexOf(".");
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : "";
	let path = `/assets/${stem}${ext}`;
	for (let n = 2; taken.has(path); n++) path = `/assets/${stem}-${n}${ext}`;
	p.writeFile(path, bytes);
	upsertProject(showing, { updatedAt: Date.now() });
	publish();
	return path;
}

/** Every project url this session has opened, for anything auditing them. */
export const openedProjects = (): string[] => [...open.keys()];

export type { AutomergeUrl };
