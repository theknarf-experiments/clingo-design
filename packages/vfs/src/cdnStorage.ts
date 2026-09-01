// Reading Automerge documents from a CDN, with no server to talk to.
//
// The templates a new project starts from do not need syncing: nobody edits them
// from the app, and the app only ever reads them. That makes them static files,
// and static files are the cheapest thing to deploy — which is the point. A build
// pointed at a CDN can offer templates with no sync server running at all.
//
// It is still Automerge documents, not a different export format, so a template
// keeps its identity: a project cloned from the CDN is the same repo as one cloned
// from the server, and gains nothing to reconcile later.
//
// The layout needs no index. A document's whole history can be a single snapshot
// chunk, so the file is named after the document and the adapter derives the url
// from the id it was asked for. Listing a directory over HTTP is not possible; not
// having to is better than shipping a manifest that can fall out of step with the
// files beside it.
//
//   <base>/<documentId>.automerge
//
// The writes are ignored rather than refused. That was the other way round first,
// on the reasoning that nothing in the app writes to a template — which is true and
// beside the point: a Repo saves a document back to its own storage after loading
// it, so throwing took the read down with it and the template list failed to load
// at all. There is nothing to write to over HTTP, and dropping the write is exactly
// right for a source that is a copy.

import type { Chunk, StorageAdapterInterface, StorageKey } from '@automerge/automerge-repo'

/** How a document's bytes are addressed once loaded. `snapshot` is what
 *  automerge-repo calls a full save, which is what a CDN file holds. */
const SNAPSHOT = 'snapshot'

/** A Repo keeps its own bookkeeping in the same key space as documents —
 *  `storage-adapter-id`, `subduction/…`, and whatever it adds later. None of it is
 *  published, so asking for it is a guaranteed 404 in the console on every load.
 *  A document id is base58 and long; nothing internal looks like one. */
const DOCUMENT_ID = /^[1-9A-HJ-NP-Za-km-z]{16,}$/

export interface CdnStorageOptions {
  /** Where the documents are served from. A trailing slash is optional. */
  base: string
  /** Injectable for tests, and so this module never assumes a browser. */
  fetch?: typeof globalThis.fetch
}

/**
 * A storage adapter backed by static files over HTTP.
 *
 * Only `load` and `loadRange` do anything. A Repo built on this can open any
 * document the CDN publishes and nothing else — an unpublished id reads as absent
 * rather than as an error, which is what lets a caller try another source.
 */
export class CdnStorageAdapter implements StorageAdapterInterface {
  readonly #base: string
  readonly #fetch: typeof globalThis.fetch
  /** One in-flight request per document, and its result kept. A Repo asks for the
   *  same document more than once, and a CDN miss is as worth remembering as a
   *  hit — otherwise every retry pays for another round trip to learn the same
   *  404. */
  readonly #cache = new Map<string, Promise<Uint8Array | undefined>>()

  constructor({ base, fetch }: CdnStorageOptions) {
    this.#base = base.replace(/\/+$/, '')
    // Bound, because `window.fetch` called as a method of anything else throws
    // "Illegal invocation" — it wants `this` to be the window. Storing the bare
    // reference and calling it as `this.#fetch(...)` is exactly that mistake, and
    // an injected test double does not reproduce it: a plain function has no
    // opinion about its receiver, so only a real browser shows it.
    this.#fetch = fetch ?? globalThis.fetch.bind(globalThis)
  }

  #url(documentId: string): string {
    return `${this.#base}/${encodeURIComponent(documentId)}.automerge`
  }

  #document(documentId: string): Promise<Uint8Array | undefined> {
    if (!DOCUMENT_ID.test(documentId)) return Promise.resolve(undefined)
    const cached = this.#cache.get(documentId)
    if (cached) return cached
    const pending = (async () => {
      try {
        const res = await this.#fetch(this.#url(documentId))
        // A 404 is an ordinary answer here: it means this CDN does not carry that
        // document, and the caller should look elsewhere.
        if (!res.ok) return undefined
        return new Uint8Array(await res.arrayBuffer())
      } catch {
        // Offline, blocked, CORS. Indistinguishable from absent as far as the
        // caller can act on it, and treating it as absent keeps one unreachable
        // source from taking the app down with it.
        return undefined
      }
    })()
    this.#cache.set(documentId, pending)
    return pending
  }

  async load(key: StorageKey): Promise<Uint8Array | undefined> {
    const [documentId, kind] = key
    if (!documentId || (kind !== undefined && kind !== SNAPSHOT)) return undefined
    return this.#document(documentId)
  }

  async loadRange(keyPrefix: StorageKey): Promise<Chunk[]> {
    const [documentId] = keyPrefix
    // The empty prefix asks for the whole store, which a CDN cannot answer: there
    // is no way to list what is published. Callers that enumerate storage get
    // nothing rather than a lie.
    if (!documentId) return []
    if (keyPrefix.length > 1 && keyPrefix[1] !== SNAPSHOT) return []
    const data = await this.#document(documentId)
    if (!data) return []
    return [{ key: [documentId, SNAPSHOT], data }]
  }

  // Ignored, not refused — see the note at the top. A Repo writes back what it
  // loads, and there is nothing behind this to write to.
  async save(): Promise<void> {}
  async saveBatch(): Promise<void> {}
  async remove(): Promise<void> {}
  async removeRange(): Promise<void> {}
}
