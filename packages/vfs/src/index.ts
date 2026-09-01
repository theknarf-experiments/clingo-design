// The virtual filesystem the bundler reads from — Automerge documents, not a
// disk. A project is stored in pushwork's `vfs` shape: a *directory* doc whose
// keys are file paths mapping to that file's own *file* doc, and one file doc
// per file holding its text. That's exactly what `pushwork clone <url>` expects,
// so a project made here IS a live pushwork repo you can materialise on disk.
//
// The rest of the app doesn't care about the two-level shape: `VfsProject`
// presents a flat path → text map (snapshot) and per-path writes, and keeps
// every file's DocHandle loaded so the compiler and panels see a plain object.

import {
  Repo,
  isImmutableString,
  parseAutomergeUrl,
  type DocHandle,
  type AutomergeUrl,
  isValidAutomergeUrl,
} from '@automerge/automerge-repo'
import {
  WebSocketTransport,
  type ManagedTransport,
  type WebSocketEndpointInterface,
} from '@automerge/automerge-repo'
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb'
import { initializeWasm } from '@automerge/automerge/slim'
import wasmUrl from '@automerge/automerge/automerge.wasm?url'
// The subduction wasm, initialised by hand through the /slim (web) glue — the
// exact same glue the Repo imports internally, so there is one instance. Going
// through automerge-repo's initSubduction() instead would auto-import the full
// entry, dragging in a second (bundler) glue whose Topic class differs.
// The /slim types (dist/index.d.ts) don't declare the default init export the
// web glue actually provides (wasm-bindgen's __wbg_init), so reach it through a
// namespace import and a cast rather than a default import TS rejects.
import * as subductionSlim from '@automerge/automerge-subduction/slim'
import subWasmUrl from '@automerge/automerge-subduction/wasm?url'
const initSubductionWasm = (subductionSlim as unknown as {
  default: (opts: { module_or_path: string }) => Promise<unknown>
}).default

// This package is the app's only door to Automerge — re-export the handful of
// automerge-repo names the UI needs so nothing else has to depend on it.
export { isValidAutomergeUrl } from '@automerge/automerge-repo'
export type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo'
/** A point in a document's history — what `handle.heads()` answers with.
 *
 *  Re-exported for the same reason as the two above: this package is the app's
 *  only door to Automerge, and a caller that imported this type from the repo
 *  directly would be one `pnpm install` away from having two copies of the
 *  library and two wasm instances in one page. */
export type { UrlHeads } from '@automerge/automerge-repo'

/** A project as the compiler and panels see it: absolute path → contents.
 *
 *  Text for source, bytes for everything the parsers do not read — images,
 *  fonts. One map rather than two, because renaming, moving and deleting are
 *  path operations that do not care which a file is, and splitting them would
 *  mean two of each forever to save narrowing a handful of readers. */
export type Files = Record<string, string | Uint8Array>

// --- The pushwork vfs doc shapes ---
type DirDoc = Record<string, unknown> // { '@patchwork': {type:'directory', title?}, '<relpath>': '<file-url>' }

/** Any document in the tree. Patchwork's rule, and the whole of it: a doc's
 *  datatype is `doc['@patchwork'].type`, and `file` is simply one of them —
 *  `folder` is another, and an app declares its own the same way. */
interface LeafDoc {
  '@patchwork': { type: string }
}

/** The `file` datatype: bytes or text, with the metadata a filesystem needs. */
interface FileDoc extends LeafDoc {
  '@patchwork': { type: 'file' }
  content: string | Uint8Array
  extension: string
  mimeType: string
  name: string
}

/** The datatype of a doc, or `''` for one that declares none.
 *
 *  Absent is not an error and not assumed to be `file`: a leaf written by
 *  something that did not set it is a leaf we do not know how to read, and
 *  guessing would put `String(undefined)` into a snapshot as though it were a
 *  file's contents. */
const typeOf = (h: DocHandle<LeafDoc>): string =>
  (h.doc() as LeafDoc | undefined)?.['@patchwork']?.type ?? ''

/** The datatype every path in the tree used to be, before this repo put its own
 *  documents in there beside the files. */
export const FILE_TYPE = 'file' 

import { MIME } from './files.ts'
export { extOf, isBinaryPath, mimeOf, dataUrl } from './files.ts'

/** Build a file doc from a relative path + contents, mirroring pushwork's
 *  makeFileEntry (name/extension/mimeType metadata). Bytes are stored as bytes;
 *  Automerge carries a Uint8Array natively, which is how the template manifest's
 *  preview PNGs have always come back. */
function makeFileEntry(rel: string, content: string | Uint8Array): FileDoc {
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot + 1) : ''
  return { '@patchwork': { type: 'file' }, content, extension, mimeType: MIME[extension] ?? 'text/plain', name }
}

/** Read a file doc's contents: bytes as bytes, anything else as text. */
function contentOf(h: DocHandle<LeafDoc>): string | Uint8Array {
  const raw = (h.doc() as { content?: unknown })?.content
  if (raw instanceof Uint8Array) return raw
  return isImmutableString(raw) ? String(raw) : typeof raw === 'string' ? raw : String(raw ?? '')
}

const rel = (p: string) => p.replace(/^\/+/, '') // app path '/App.tsx' → dir key 'App.tsx'
const abs = (r: string) => '/' + r
const isLeaf = (v: unknown): v is AutomergeUrl => typeof v === 'string' && isValidAutomergeUrl(v)

/** One IndexedDB namespace for every repo below. Sharing it is what makes
 *  changing where a project syncs cheap — see `repoFor`. */
const STORAGE = 'clingo-design'

/** Where a project syncs: a subduction endpoint, or null for "nowhere". */
export type SyncTarget = string | null

// One repo per destination, and a project belongs to exactly one of them.
//
// Two things force this shape. The first is that a project which has not opted
// into syncing must not reach a server at all, and in this version of
// automerge-repo that cannot be expressed as a policy: `sharePolicy` becomes
// `shareConfig.announce` and `denylist` is read by the CollectionSynchronizer,
// both of which are the legacy sync path, while the subduction source attaches
// to every DocumentQuery the repo opens (Repo.js: `for (const source of
// this.#sources.values()) source.attach(query)`) and syncs it regardless.
//
// The second is that `subductionWebsocketEndpoints` is a *constructor* option.
// One Repo therefore means one destination, so per-project servers cannot be a
// field consulted at sync time either — they have to be separate repos.
//
// Both fall out of the same rule: a destination is not a predicate applied to a
// doc, it is which repo holds it. The local repo is built without endpoints,
// which is the only form of "this never leaves the machine" that does not depend
// on getting a condition right.
//
// Every repo shares `STORAGE`, so a doc is persisted under its own id no matter
// which one created it. Moving a project — local to syncing, or between servers
// — is then a flush and a reopen rather than a copy: it keeps its url, so the
// clone command in settings does not become a different command.
let localRepo: Repo
/** Syncing repos, keyed by endpoint. Built on demand: a session usually touches
 *  one server, and constructing one per url in the registry would open sockets
 *  to servers no open project uses. */
const syncedRepos = new Map<string, Repo>()

let repoReadyOnce: Promise<Repo> | undefined
// On first use, not at import: the wasm urls are Vite-served assets, which only
// exist in a browser. Importing this module for its pure parts (as the tests do)
// must not start a fetch that, under Node, rejects with nobody listening.
const repoReady = () =>
  (repoReadyOnce ??= (async () => {
    await initializeWasm(wasmUrl)
    await initSubductionWasm({ module_or_path: subWasmUrl })
    // No endpoints, and none can be added later: the Repo takes them at
    // construction. Nothing here has a route off the machine.
    localRepo = new Repo({
      network: [],
      storage: new IndexedDBStorageAdapter(STORAGE),
      sharePolicy: async () => false,
    })
    return localRepo
  })())

/** The repo that syncs to `server`, building it the first time it is asked for.
 *
 *  Subduction is not a network adapter (that's the legacy backend). The Repo
 *  takes the endpoint directly and speaks subduction's handshake to it. */
function syncedRepoFor(server: string): Repo {
  const existing = syncedRepos.get(server)
  if (existing) return existing
  const repo = new Repo({
    network: [],
    subductionWebsocketEndpoints: [endpointFor(server)],
    storage: new IndexedDBStorageAdapter(STORAGE),
    // Share every doc with the server peer — without this a second client (or
    // `pushwork clone`) asking for a doc can be told 'unavailable'.
    sharePolicy: async () => true,
  } as ConstructorParameters<typeof Repo>[0] & { subductionWebsocketEndpoints: string[] })
  syncedRepos.set(server, repo)
  return repo
}

/** The repo a project lives in, given where it syncs. */
function repoFor(target: SyncTarget): Repo {
  return target === null ? localRepo : syncedRepoFor(target)
}

/** The read-only repo over the template CDN, built on first use.
 *
 *  Its own repo rather than another storage layer on an existing one: a Repo has
 *  one storage, and this one must never be written to. Kept apart also means a
 *  build with no sync server still has somewhere to read templates from. */
let cdnRepoInstance: Repo | null = null
function cdnRepo(): Repo | null {
  if (!TEMPLATE_CDN) return null
  if (!cdnRepoInstance) {
    cdnRepoInstance = new Repo({
      network: [],
      storage: new CdnStorageAdapter({ base: TEMPLATE_CDN }),
      sharePolicy: async () => false,
    })
  }
  return cdnRepoInstance
}

/** Where a template (or the manifest) may be read from, in the order tried.
 *
 *  The sync server first when there is one: it is live, and may carry a template
 *  newer than the last CDN publish. The CDN answers when there is no server, or
 *  when the server has not got it — which is also what makes a CDN-only
 *  deployment work, with no server configured at all.
 *
 *  Empty is a real possibility (neither configured) and the callers report it as
 *  "unavailable" rather than crashing, which is the honest answer. */
function templateRepos(): Repo[] {
  const out: Repo[] = []
  if (DEFAULT_SYNC_SERVER) out.push(syncedRepoFor(DEFAULT_SYNC_SERVER))
  const cdn = cdnRepo()
  if (cdn) out.push(cdn)
  return out
}

/** Try each source in turn, taking the first that answers.
 *
 *  A source that does not have the document is not a failure — with two sources
 *  configured, exactly one of them missing a template is the ordinary case. Only
 *  every source failing is. */
async function fromAnySource<T>(
  read: (repo: Repo) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const repos = templateRepos()
  if (repos.length === 0) {
    return { ok: false, error: 'no template source is configured (VITE_SUBDUCTION or VITE_TEMPLATE_CDN)' }
  }
  let last = 'unavailable'
  for (const repo of repos) {
    try {
      return { ok: true, value: await read(repo) }
    } catch (e) {
      last = String((e as Error)?.message || e)
    }
  }
  return { ok: false, error: last }
}

/** Flush every repo except the one a project is moving into, so it loads current
 *  state rather than what was last debounced to disk. Saves are debounced, and
 *  without this the destination can read a doc older than the one the source
 *  repo still holds in memory — with both live over the same store. */
async function flushOthers(target: SyncTarget): Promise<void> {
  const keep = repoFor(target)
  const others = [localRepo, ...syncedRepos.values()].filter((r) => r !== keep)
  await Promise.all(others.map((r) => r.flush()))
}

/** The default destination for a project that syncs but names no server. */
export { DEFAULT_SYNC_SERVER, SYNC_AUDIENCE, TEMPLATE_CDN, isValidServerUrl, normalizeServerUrl } from './server.ts'
export { storageChunkPath } from './storagePath.ts'
import { DEFAULT_SYNC_SERVER, SYNC_AUDIENCE, TEMPLATE_CDN } from './server.ts'
import { CdnStorageAdapter } from './cdnStorage.ts'

/** An endpoint that dials one address and asks for a peer by another name.
 *
 *  `SubductionConnections` reads the audience from `endpoint.url` and opens the
 *  socket with `endpoint.connect()`, and the interface it documents exists so that
 *  `connect` can route anywhere. Splitting the two is the whole trick behind
 *  reaching a server through a proxy without reconfiguring the server — see
 *  SYNC_AUDIENCE. */
class ProxiedEndpoint implements WebSocketEndpointInterface {
  /** Read for the audience only. Its host is the name the server answers to. */
  readonly url: string
  /** The address actually dialled, which is not the name asked for. */
  private readonly dial: string
  constructor(audience: string, dial: string) {
    this.dial = dial
    // A bare host:port is not a url and `new URL` would reject it; the scheme here
    // is never dialled, only parsed for its host.
    this.url = /^[a-z]+:\/\//.test(audience) ? audience : `wss://${audience}`
  }
  connect(): Promise<ManagedTransport> {
    return WebSocketTransport.connect(this.dial)
  }
}

/** What to hand the Repo for a server: the url itself, or an endpoint that dials
 *  it while asking for a differently-named peer. */
function endpointFor(server: string): string | WebSocketEndpointInterface {
  return SYNC_AUDIENCE ? new ProxiedEndpoint(SYNC_AUDIENCE, server) : server
}
import { storageChunkPath } from './storagePath.ts'

/** Whether we are talking to a given subduction server yet.
 *
 *  Only meaningful for a server some open project actually uses: an endpoint
 *  nobody has asked for has no repo, and so reports false rather than
 *  connecting to find out. */
export function serverConnected(server: string | null = DEFAULT_SYNC_SERVER): boolean {
  if (!server) return false
  const repo = syncedRepos.get(server) as unknown as
    | { isSubductionConnected?: () => boolean }
    | undefined
  return typeof repo?.isSubductionConnected === 'function' ? repo.isSubductionConnected() : false
}

/** A live project over the vfs shape. Wraps the directory doc + one loaded
 *  DocHandle per file, and presents the flat path→text interface the editor
 *  uses. Structural edits change the directory doc's keys and the file docs. */
export class VfsProject {
  readonly url: AutomergeUrl
  private listeners = new Set<() => void>()
  private emit = () => { for (const l of this.listeners) l() }

  // In-memory build output (dist/, node_modules/, .vite/). Kept so tooling and
  // the preview can read it, but NEVER written to a file doc or the directory
  // doc — so `pushwork clone` and the synced tree only ever carry source.
  private ephemeral = new Map<string, string | Uint8Array>()
  /** Path prefixes whose writes are build output: in-memory only, never synced. */
  ephemeralRoots = ['/dist/', '/node_modules/', '/.vite/']

  private readonly dir: DocHandle<DirDoc>
  private readonly files: Map<string, DocHandle<LeafDoc>>
  /** The repo this project's docs live in — the syncing one or the local one.
   *  Held rather than looked up, because every doc a project creates later has
   *  to land in the same one. */
  private readonly repo: Repo
  /** Where this project syncs, or null for nowhere. Mirrors which repo it is
   *  in; kept so callers can ask a project rather than the registry. */
  readonly target: SyncTarget

  // Fields rather than parameter properties, which is the one shape of this
  // class that had to change coming across. Parameter properties are not
  // erasable — they *emit* assignments — so they fail this repo's
  // `erasableSyntaxOnly`, and Node's own type stripping cannot run them either.
  // Upstream is bundler-compiled and never meets either rule.
  constructor(
    dir: DocHandle<DirDoc>,
    files: Map<string, DocHandle<LeafDoc>>,
    repo: Repo,
    target: SyncTarget,
  ) {
    this.dir = dir
    this.files = files
    this.repo = repo
    this.target = target
    this.url = dir.url
    dir.on('change', this.onDirChange)
    for (const fh of files.values()) fh.on('change', this.emit)
  }

  private isEphemeral(path: string): boolean {
    const p = path.startsWith('/') ? path : '/' + path
    return this.ephemeralRoots.some((r) => p === r.replace(/\/$/, '') || p.startsWith(r))
  }

  // Ephemeral (build-output) writes deliberately do NOT emit: they'd wake the
  // source subscribers, and the editor's build effect writes here after every
  // build — emitting would reload `files` and trigger an endless rebuild loop.
  /** Write build output — held in memory, never synced to Automerge. */
  writeEphemeral(path: string, content: string | Uint8Array): void {
    this.ephemeral.set(abs(rel(path)), content)
  }
  /** Read a build-output file (undefined if absent). */
  readEphemeral(path: string): string | Uint8Array | undefined {
    return this.ephemeral.get(abs(rel(path)))
  }
  /** All build output as absolute path → content. */
  ephemeralSnapshot(): Record<string, string | Uint8Array> {
    return Object.fromEntries(this.ephemeral)
  }
  /** Drop build output (all, or everything under a prefix like '/dist/'). Does
   *  not emit — see writeEphemeral. */
  clearEphemeral(prefix?: string): void {
    if (prefix === undefined) {
      this.ephemeral.clear()
      return
    }
    const pre = abs(rel(prefix))
    for (const k of [...this.ephemeral.keys()]) {
      if (k === pre || k.startsWith(pre.endsWith('/') ? pre : pre + '/')) this.ephemeral.delete(k)
    }
  }

  /** Register a change listener (structure or any file content). Returns an
   *  unsubscribe. */
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  // Reconcile file handles when the directory doc changes remotely: drop deleted
  // leaves, load newly-added ones, then notify.
  private onDirChange = async () => {
    const doc = this.dir.doc() as DirDoc
    const leaves = new Map(Object.entries(doc).filter(([k, v]) => !k.startsWith('@') && isLeaf(v)) as [string, AutomergeUrl][])
    for (const r of [...this.files.keys()]) {
      if (!leaves.has(r)) { this.files.get(r)!.off('change', this.emit); this.files.delete(r) }
    }
    const added = [...leaves].filter(([r]) => !this.files.has(r))
    if (added.length) {
      await Promise.all(
        added.map(async ([r, u]) => {
          const fh = await this.repo.find<LeafDoc>(u)
          await fh.whenReady()
          fh.on('change', this.emit)
          this.files.set(r, fh)
        }),
      )
    }
    this.emit()
  }

  name(): string {
    const meta = (this.dir.doc() as DirDoc)?.['@patchwork'] as { title?: string } | undefined
    return meta?.title ?? 'Untitled'
  }

  // The preview canvas (frame layout + OCIF annotations) lives in its OWN
  // Automerge doc — like file docs, a dedicated doc syncs and persists reliably
  // (a plain value on the directory doc did not survive reopen). The directory
  // doc just holds a reference to its url under a reserved key, so the canvas
  // clones with the project (via pushwork) but stays out of the file tree/build.
  private canvasHandle: DocHandle<Record<string, unknown>> | null = null

  /** Get-or-create the project's dedicated OCIF canvas doc.
   *
   *  `created` says the project had no canvas at all until now, which is not the
   *  same as having one that is empty. The caller seeds a first frame on a new
   *  canvas; doing that whenever the canvas *looks* empty would put a frame back
   *  every time someone deliberately deleted the last one. */
  async getCanvasDoc(): Promise<{
    handle: DocHandle<Record<string, unknown>>
    created: boolean
  }> {
    if (this.canvasHandle) return { handle: this.canvasHandle, created: false }
    const ref = (this.dir.doc() as DirDoc)?.['@flow-page:canvas']
    let handle: DocHandle<Record<string, unknown>>
    let created = false
    if (typeof ref === 'string' && isValidAutomergeUrl(ref)) {
      handle = await this.repo.find<Record<string, unknown>>(ref as AutomergeUrl)
      await handle.whenReady()
    } else {
      handle = this.repo.create<Record<string, unknown>>({})
      await handle.whenReady()
      this.dir.change((d) => {
        d['@flow-page:canvas'] = handle.url
      })
      created = true
    }
    this.canvasHandle = handle
    return { handle, created }
  }
  rename(name: string): void {
    this.dir.change((d) => {
      const meta = (d['@patchwork'] as { type?: string; title?: string } | undefined) ?? (d['@patchwork'] = { type: 'directory' })
      ;(meta as { title?: string }).title = name
    })
  }

  /** The whole project as absolute path → contents. Synchronous: every handle
   *  is kept loaded.
   *
   *  **`file` leaves only.** The tree also carries this app's own datatypes — a
   *  scene is a document, not a serialised blob — and those have no `content`
   *  to report. Including them would put `String(undefined)` in here under a
   *  path, which every reader would treat as a file whose text is the word
   *  "undefined". Ask {@link docAt} for those instead. */
  snapshot(): Files {
    const out: Files = {}
    for (const [r, fh] of this.files) {
      if (typeOf(fh) === FILE_TYPE) out[abs(r)] = contentOf(fh)
    }
    return out
  }

  /* ---------------------------------------------------------------- */
  /* Documents in the tree that are not files                          */
  /* ---------------------------------------------------------------- */

  /** The handle at a path, whatever datatype it holds.
   *
   *  The one thing `snapshot()` cannot give you, and the reason this exists: a
   *  scene is edited *as a document* — structurally, so two people changing two
   *  different nodes both land, and so its history is the document's own.
   *  Handing out contents would mean serialising it, which is the single
   *  decision this arrangement exists to avoid. */
  docAt<T>(path: string): DocHandle<T> | undefined {
    return this.files.get(rel(path)) as DocHandle<T> | undefined
  }

  /** Every path holding a document of this datatype, sorted.
   *
   *  Sorted because the tree is a map and has no order of its own, and a list of
   *  pages that renders in a different order each time is a list nobody can
   *  point at. */
  pathsOfType(type: string): string[] {
    const out: string[] = []
    for (const [r, fh] of this.files) if (typeOf(fh) === type) out.push(abs(r))
    return out.sort()
  }

  /** What datatype lives at a path, or `undefined` where nothing does. */
  typeAt(path: string): string | undefined {
    const fh = this.files.get(rel(path))
    return fh ? typeOf(fh) : undefined
  }

  /** Put a document of some datatype in the tree.
   *
   *  The twin of {@link writeFile} for everything that is not a file. The
   *  datatype goes *in the doc* rather than being inferred from the extension,
   *  because that is where Patchwork keeps it and because a path is a name
   *  rather than a claim about contents.
   *
   *  Returns the existing handle rather than overwriting: replacing a document
   *  with a fresh one throws away its history, which for a scene is the undo
   *  stack. Editing one is `docAt(path)!.change(...)`. */
  createDoc<T extends object>(path: string, type: string, initial: T): DocHandle<T> {
    const r = rel(path)
    const existing = this.files.get(r)
    if (existing) return existing as unknown as DocHandle<T>
    const handle = this.repo.create<T>({
      ...initial,
      '@patchwork': { type },
    } as T)
    this.files.set(r, handle as unknown as DocHandle<LeafDoc>)
    handle.on('change', this.emit)
    this.dir.change((d) => { d[r] = handle.url })
    return handle
  }

  writeFile(path: string, text: string | Uint8Array): void {
    // Build-output paths never touch Automerge — route them to the overlay.
    if (this.isEphemeral(path)) { this.writeEphemeral(path, text); return }
    const r = rel(path)
    const existing = this.files.get(r)
    if (existing) {
      // Writing contents to a path that holds one of this app's own datatypes
      // would put a string where a document is — silently, and only noticed
      // when the scene failed to load. A path holds one kind of thing.
      if (typeOf(existing) !== FILE_TYPE) {
        throw new Error(`${abs(r)} holds a ${typeOf(existing)} document, not a file.`)
      }
      ;(existing as unknown as DocHandle<FileDoc>).change((d) => { d.content = text as string })
      return
    }
    const fh = this.repo.create<FileDoc>(makeFileEntry(r, text))
    this.files.set(r, fh as unknown as DocHandle<LeafDoc>)
    fh.on('change', this.emit)
    this.dir.change((d) => { d[r] = fh.url })
  }

  renamePath(from: string, to: string): void {
    if (from === to) return
    const rf = rel(from)
    const rt = rel(to)
    const move = (oldR: string, newR: string) => {
      const fh = this.files.get(oldR)
      if (!fh) return
      // The file datatype carries its own name, extension and mime type, so a
      // rename has to update them or the doc disagrees with the path it hangs
      // from. Every other datatype carries none of that — a scene is named by
      // where it sits — so for those the move is the key and nothing else.
      if (typeOf(fh) === FILE_TYPE) {
        const meta = makeFileEntry(newR, '')
        ;(fh as unknown as DocHandle<FileDoc>).change((d) => {
          d.name = meta.name
          d.extension = meta.extension
          d.mimeType = meta.mimeType
        })
      }
      this.files.delete(oldR)
      this.files.set(newR, fh)
      this.dir.change((d) => { d[newR] = fh.url; delete d[oldR] })
    }
    if (this.files.has(rf)) { move(rf, rt); return }
    const pre = rf.endsWith('/') ? rf : rf + '/'
    const toPre = rt.endsWith('/') ? rt : rt + '/'
    for (const oldR of [...this.files.keys()]) if (oldR.startsWith(pre)) move(oldR, toPre + oldR.slice(pre.length))
  }

  deletePath(path: string): void {
    const r = rel(path)
    const drop = (rr: string) => {
      const fh = this.files.get(rr)
      if (!fh) return
      fh.off('change', this.emit)
      this.files.delete(rr)
      this.dir.change((d) => { delete d[rr] })
      try { this.repo.delete(fh.url) } catch { /* best effort */ }
    }
    if (this.files.has(r)) { drop(r); return }
    const pre = r.endsWith('/') ? r : r + '/'
    for (const rr of [...this.files.keys()]) if (rr.startsWith(pre)) drop(rr)
  }

  /** The Automerge documents this project is made of: the directory doc, one
   *  per file, and the canvas doc if it has one.
   *
   *  The canvas is read off the directory doc rather than from the handle,
   *  because that handle is created lazily — a project whose canvas has not been
   *  opened this session still has one, and an export that skipped it would lose
   *  the frame layout. */
  docUrls(): AutomergeUrl[] {
    const urls: AutomergeUrl[] = [this.dir.url]
    for (const fh of this.files.values()) urls.push(fh.url)
    const canvas = (this.dir.doc() as DirDoc)?.['@flow-page:canvas']
    if (typeof canvas === 'string' && isValidAutomergeUrl(canvas)) urls.push(canvas)
    return urls
  }

  createFolder(path: string): void {
    const keep = rel(path).replace(/\/+$/, '') + '/.keep'
    if (this.files.has(keep)) return
    this.writeFile(abs(keep), '') // an empty folder needs a leaf to exist
  }
}

export type Project = VfsProject

/** A read-only view of the same IndexedDB store the repos use, for export.
 *
 *  Its own adapter instance rather than one borrowed from a Repo: this only ever
 *  reads, and a separate handle cannot disturb the ones doing the syncing. */
let exportAdapter: IndexedDBStorageAdapter | null = null

/**
 * Every stored chunk of every document a project is made of, keyed by its path
 * under a `.pushwork/storage` directory.
 *
 * This is the project's history — the Automerge documents themselves, not the
 * files they currently decode to. Chunks are whatever the store holds: a
 * snapshot per doc plus any incremental changes since.
 */
export async function exportProjectStorage(
  project: VfsProject,
): Promise<Record<string, Uint8Array>> {
  await repoReady()
  exportAdapter ??= new IndexedDBStorageAdapter(STORAGE)
  const out: Record<string, Uint8Array> = {}
  for (const url of project.docUrls()) {
    const { documentId } = parseAutomergeUrl(url)
    // Everything filed under this document, whatever the chunk types are — the
    // set is not ours to enumerate, and a missed kind is a corrupt export.
    for (const chunk of await exportAdapter.loadRange([documentId])) {
      if (chunk.data) out[storageChunkPath([...chunk.key])] = chunk.data
    }
  }
  return out
}

/** Open a project by url. Clean break: only the vfs (directory) shape opens;
 *  the old single-doc projects surface a clear error. */
export async function openProject(
  url: string,
  target: SyncTarget = DEFAULT_SYNC_SERVER,
): Promise<VfsProject> {
  await repoReady()
  // Opening is also how a project moves — between local and syncing, or from one
  // server to another — so flush everywhere else first. See flushOthers.
  await flushOthers(target)
  const repo = repoFor(target)
  if (!isValidAutomergeUrl(url)) throw new Error('Not a valid project URL.')
  const dir = await repo.find<DirDoc>(url as AutomergeUrl)
  await dir.whenReady()
  const doc = dir.doc() as DirDoc
  const meta = doc?.['@patchwork'] as { type?: string } | undefined
  if (meta?.type !== 'directory') {
    throw new Error('This project is in an old format and can no longer be opened.')
  }
  const files = new Map<string, DocHandle<LeafDoc>>()
  const leaves = Object.entries(doc).filter(([k, v]) => !k.startsWith('@') && isLeaf(v)) as [string, AutomergeUrl][]
  await Promise.all(
    leaves.map(async ([r, u]) => {
      const fh = await repo.find<LeafDoc>(u)
      await fh.whenReady()
      files.set(r, fh)
    }),
  )
  return new VfsProject(dir, files, repo, target)
}

/** Start a new project from a set of files (a cloned template) — fan them out
 *  into one file doc each under a fresh directory doc. Returns the directory
 *  doc's url: the project's identity, and what `pushwork clone` takes. */
export async function createProject(
  files: Files,
  name: string,
  /** Defaults to null — nowhere. A new project stays on this machine until its
   *  settings say otherwise: creating it in a syncing repo would publish it
   *  before anyone had the chance to decide, and there is no unpublishing. */
  target: SyncTarget = null,
): Promise<{ url: AutomergeUrl }> {
  await repoReady()
  const repo = repoFor(target)
  const dir: DirDoc = { '@patchwork': { type: 'directory', title: name } }
  const handles: DocHandle<FileDoc>[] = []
  for (const [path, content] of Object.entries(files)) {
    const fh = repo.create<FileDoc>(makeFileEntry(rel(path), content))
    handles.push(fh)
    dir[rel(path)] = fh.url
  }
  await Promise.all(handles.map((h) => h.whenReady()))
  const dirHandle = repo.create<DirDoc>(dir)
  await dirHandle.whenReady()
  return { url: dirHandle.url }
}

/** The project's display name, from the directory doc's title. */
export function projectName(project: VfsProject): string {
  return project.name()
}

/** Rename a project by url (the directory doc's title is authoritative). Used
 *  from the landing list where the project isn't open. */
export async function renameProjectDoc(
  url: string,
  name: string,
  target: SyncTarget = DEFAULT_SYNC_SERVER,
): Promise<void> {
  await repoReady()
  if (!isValidAutomergeUrl(url)) return
  try {
    const dir = await repoFor(target).find<DirDoc>(url as AutomergeUrl)
    dir.change((d) => {
      const meta = (d['@patchwork'] as { type?: string; title?: string } | undefined) ?? (d['@patchwork'] = { type: 'directory' })
      ;(meta as { title?: string }).title = name
    })
  } catch {
    // Doc not reachable right now; the local registry still has the new name.
  }
}

/** Drop a project's local copy — its file docs and the directory doc. It may
 *  still live on the server and in other clients. */
export async function deleteProjectDoc(
  url: string,
  target: SyncTarget = DEFAULT_SYNC_SERVER,
): Promise<void> {
  await repoReady()
  const repo = repoFor(target)
  if (!isValidAutomergeUrl(url)) return
  try {
    const dir = await repo.find<DirDoc>(url as AutomergeUrl)
    await dir.whenReady()
    for (const v of Object.values(dir.doc() as DirDoc)) if (isLeaf(v)) { try { repo.delete(v) } catch { /* */ } }
    repo.delete(url as AutomergeUrl)
  } catch {
    // Best effort — removing it from the registry is what the user sees.
  }
}

/** Resolve a project url with no local fallback — surfaces whether the doc (and
 *  its shape) actually propagated. */
export async function findTree(url: string): Promise<{ ok: boolean; url?: string; files?: string[]; error?: string }> {
  await repoReady()
  const found = await fromAnySource(async (repo) => {
    const dir = await repo.find<DirDoc>(url as AutomergeUrl)
    await dir.whenReady()
    const files = Object.entries(dir.doc() as DirDoc).filter(([k, v]) => !k.startsWith('@') && isLeaf(v)).map(([k]) => k)
    return { url: dir.url, files }
  })
  return found.ok ? { ok: true, ...found.value } : { ok: false, error: found.error }
}

/** Watch a whole vfs repo (its directory doc + every file doc) and fire
 *  `onChange` on any content or structure change. Returns an unsubscribe. Used
 *  to keep the landing's template list live as the preview service updates the
 *  manifest. */
export async function watchRepo(url: string, onChange: () => void): Promise<() => void> {
  await repoReady()
  // Only the sync server, and only if there is one: a CDN is static, so there is
  // nothing to watch and a build without a server simply never sees updates —
  // which is what "read templates from files" means.
  if (!DEFAULT_SYNC_SERVER) return () => {}
  const repo = syncedRepoFor(DEFAULT_SYNC_SERVER)
  if (!isValidAutomergeUrl(url)) return () => {}
  const dir = await repo.find<DirDoc>(url as AutomergeUrl)
  await dir.whenReady()
  const files = new Map<string, DocHandle<LeafDoc>>()
  const fileCb = () => onChange()
  const reconcile = async () => {
    const leaves = new Map(Object.entries(dir.doc() as DirDoc).filter(([k, v]) => !k.startsWith('@') && isLeaf(v)) as [string, AutomergeUrl][])
    for (const [k, h] of files) if (!leaves.has(k)) { h.off('change', fileCb); files.delete(k) }
    await Promise.all(
      [...leaves].filter(([k]) => !files.has(k)).map(async ([k, u]) => {
        try {
          const fh = await repo.find<LeafDoc>(u)
          await fh.whenReady()
          fh.on('change', fileCb)
          files.set(k, fh)
        } catch {
          // Not available on this peer yet; a later reload retry picks it up.
        }
      }),
    )
  }
  const dirCb = () => { void reconcile().then(onChange) }
  dir.on('change', dirCb)
  await reconcile()
  return () => {
    dir.off('change', dirCb)
    for (const h of files.values()) h.off('change', fileCb)
  }
}

/** Read any pushwork vfs repo, keeping binary content as bytes. Text file docs
 *  come back as strings, binary ones (e.g. images) as Uint8Array — used to load
 *  the template manifest, whose preview PNGs are binary. */
export async function readRepo(
  url: string,
): Promise<{ ok: boolean; url?: string; files?: Record<string, string | Uint8Array>; error?: string }> {
  await repoReady()
  if (!isValidAutomergeUrl(url)) return { ok: false, error: `not an automerge url: ${url}` }
  const found = await fromAnySource(async (repo) => {
    const root = await repo.find<DirDoc>(url as AutomergeUrl)
    await root.whenReady()
    const dir = root.doc() as DirDoc
    if ((dir['@patchwork'] as { type?: string } | undefined)?.type !== 'directory') {
      throw new Error(`not a pushwork directory doc: ${url}`)
    }
    const leaves = Object.entries(dir).filter(([k, v]) => !k.startsWith('@') && isLeaf(v)) as [string, AutomergeUrl][]
    const entries = (
      await Promise.all(
        leaves.map(async ([path, fileUrl]) => {
          try {
            // A just-created file doc (e.g. a fresh preview) may not have reached
            // this peer yet — skip it this pass rather than failing the whole read.
            const fh = await repo.find<FileDoc>(fileUrl)
            await fh.whenReady()
            const raw = (fh.doc() as { content?: unknown })?.content
            const value: string | Uint8Array =
              raw instanceof Uint8Array ? raw : isImmutableString(raw) ? String(raw) : typeof raw === 'string' ? raw : String(raw ?? '')
            return [path, value] as const
          } catch {
            return null
          }
        }),
      )
    ).filter((e): e is readonly [string, string | Uint8Array] => e !== null)
    return { url: root.url, files: Object.fromEntries(entries) }
  })
  return found.ok ? { ok: true, ...found.value } : { ok: false, error: found.error }
}

/** Clone a template pushed by `pushwork` (its `vfs` shape) into the flat
 *  path → text snapshot `createProject` fans back out. The root is a directory
 *  doc (`@patchwork:{type:"directory"}`) whose keys map a posix path to that
 *  file's own doc; each file doc's `content` is the text. */
export async function cloneTemplate(
  url: string,
): Promise<{ ok: boolean; url?: string; files?: Files; error?: string }> {
  await repoReady()
  if (!isValidAutomergeUrl(url)) return { ok: false, error: `not an automerge url: ${url}` }
  const found = await fromAnySource(async (repo) => {
    const root = await repo.find<DirDoc>(url as AutomergeUrl)
    await root.whenReady()
    const dir = root.doc() as DirDoc
    const meta = dir['@patchwork'] as { type?: string } | undefined
    if (meta?.type !== 'directory') throw new Error(`not a pushwork directory doc: ${url}`)
    const leaves = Object.entries(dir).filter(([k, v]) => !k.startsWith('@') && isLeaf(v)) as [string, AutomergeUrl][]
    const entries = await Promise.all(
      leaves.map(async ([path, fileUrl]) => {
        const fh = await repo.find<LeafDoc>(fileUrl)
        await fh.whenReady()
        // Only `file` leaves have contents to read. A tree holding one of this
        // app's own datatypes reports it as absent here rather than as the text
        // "undefined" — this is the read behind template cloning, and a template
        // is files.
        if (typeOf(fh) !== FILE_TYPE) return null
        // Lead every path with a slash so it matches the compiler's resolver.
        return [path.startsWith('/') ? path : '/' + path, contentOf(fh)] as const
      }),
    )
    return {
      url: root.url,
      files: Object.fromEntries(entries.filter((e): e is readonly [string, string | Uint8Array] => e !== null)),
    }
  })
  return found.ok ? { ok: true, ...found.value } : { ok: false, error: found.error }
}
