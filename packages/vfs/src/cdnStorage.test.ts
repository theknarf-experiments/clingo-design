import { describe, expect, it, vi } from './shim.ts'
import { CdnStorageAdapter } from './cdnStorage.ts'

// Reading documents from static files. The behaviour that matters is what happens
// when a document is *not* there: a CDN carrying some templates and not others is
// the normal case once a deployment has both a CDN and a sync server, so "absent"
// has to be an answer rather than a failure — otherwise one missing file takes the
// template list down with it.

const bytes = new Uint8Array([1, 2, 3, 4])

/** A fetch that serves exactly the documents given to it. */
function cdn(docs: Record<string, Uint8Array>) {
  const calls: string[] = []
  const fetch = vi.fn(async (url: string | URL | Request) => {
    const href = String(url)
    calls.push(href)
    const id = decodeURIComponent(href.slice(href.lastIndexOf('/') + 1).replace(/\.automerge$/, ''))
    const doc = docs[id]
    if (!doc) return new Response(null, { status: 404 })
    return new Response(doc.slice().buffer as ArrayBuffer, { status: 200 })
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls }
}

describe('loading a published document', () => {
  it('derives the url from the document id', async () => {
    // No index file: the id is the file name, so nothing can fall out of step
    // with what is actually on the CDN.
    const { fetch, calls } = cdn({ '3dDUirk6VY6EXDvZiZQEkkPAQNa2': bytes })
    const a = new CdnStorageAdapter({ base: 'https://cdn.example.com/t', fetch })
    expect(await a.load(['3dDUirk6VY6EXDvZiZQEkkPAQNa2'])).toEqual(bytes)
    expect(calls[0]).toBe('https://cdn.example.com/t/3dDUirk6VY6EXDvZiZQEkkPAQNa2.automerge')
  })

  it('tolerates a trailing slash on the base', async () => {
    const { fetch, calls } = cdn({ '3dDUirk6VY6EXDvZiZQEkkPAQNa2': bytes })
    const a = new CdnStorageAdapter({ base: 'https://cdn.example.com/t/', fetch })
    await a.load(['3dDUirk6VY6EXDvZiZQEkkPAQNa2'])
    expect(calls[0]).toBe('https://cdn.example.com/t/3dDUirk6VY6EXDvZiZQEkkPAQNa2.automerge')
  })

  it('returns it as a single snapshot chunk', async () => {
    // How automerge-repo asks for a document's data. One full save is a legal
    // chunk, which is what removes the need for a chunk tree on the CDN.
    const { fetch } = cdn({ '3dDUirk6VY6EXDvZiZQEkkPAQNa2': bytes })
    const a = new CdnStorageAdapter({ base: 'https://cdn.example.com', fetch })
    expect(await a.loadRange(['3dDUirk6VY6EXDvZiZQEkkPAQNa2'])).toEqual([{ key: ['3dDUirk6VY6EXDvZiZQEkkPAQNa2', 'snapshot'], data: bytes }])
  })
})

describe('a document the CDN does not carry', () => {
  it('reads as absent, not as an error', async () => {
    const { fetch } = cdn({})
    const a = new CdnStorageAdapter({ base: 'https://cdn.example.com', fetch })
    expect(await a.load(['9uWQ4kkkAAAAAAAAAAAAAAAAAAAA'])).toBeUndefined()
    expect(await a.loadRange(['9uWQ4kkkAAAAAAAAAAAAAAAAAAAA'])).toEqual([])
  })

  it('and so does one the network could not be asked about', async () => {
    // Offline, CORS, DNS. The caller can only do the same thing either way — look
    // somewhere else — and throwing here would take out a list that another
    // source could have filled.
    const fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof globalThis.fetch
    const a = new CdnStorageAdapter({ base: 'https://cdn.example.com', fetch })
    expect(await a.loadRange(['3dDUirk6VY6EXDvZiZQEkkPAQNa2'])).toEqual([])
  })
})

describe('asking for things a CDN cannot answer', () => {
  it('the whole store, which cannot be listed over http', async () => {
    // `loadRange([])` enumerates everything. There is no directory listing, so
    // this says nothing rather than pretending the store is empty of documents it
    // simply cannot see.
    const { fetch, calls } = cdn({ '3dDUirk6VY6EXDvZiZQEkkPAQNa2': bytes })
    const a = new CdnStorageAdapter({ base: 'https://cdn.example.com', fetch })
    expect(await a.loadRange([])).toEqual([])
    expect(calls).toEqual([])
  })

  it('and per-document keys that are not the snapshot', async () => {
    const { fetch } = cdn({ '3dDUirk6VY6EXDvZiZQEkkPAQNa2': bytes })
    const a = new CdnStorageAdapter({ base: 'https://cdn.example.com', fetch })
    expect(await a.loadRange(['3dDUirk6VY6EXDvZiZQEkkPAQNa2', 'sync-state'])).toEqual([])
    expect(await a.load(['3dDUirk6VY6EXDvZiZQEkkPAQNa2', 'incremental', 'x'])).toBeUndefined()
  })
})

describe("a Repo's own bookkeeping keys", () => {
  it('are not requested at all', async () => {
    // `storage-adapter-id` and the subduction namespaces share the key space with
    // documents but are never published, so asking produces a 404 in the console
    // on every single load. Nothing internal looks like a base58 document id.
    const { fetch, calls } = cdn({ '3dDUirk6VY6EXDvZiZQEkkPAQNa2': bytes })
    const a = new CdnStorageAdapter({ base: 'https://cdn.example.com', fetch })
    expect(await a.load(['storage-adapter-id'])).toBeUndefined()
    expect(await a.loadRange(['subduction', 'commits', 'deadbeef'])).toEqual([])
    expect(calls).toEqual([])
  })
})

describe('repeat requests', () => {
  it('are asked once, hit or miss', async () => {
    // A Repo asks for the same document more than once. A remembered 404 matters
    // as much as a remembered hit: without it every retry pays a round trip to
    // learn the same nothing.
    const { fetch, calls } = cdn({ '3dDUirk6VY6EXDvZiZQEkkPAQNa2': bytes })
    const a = new CdnStorageAdapter({ base: 'https://cdn.example.com', fetch })
    await Promise.all([a.load(['3dDUirk6VY6EXDvZiZQEkkPAQNa2']), a.load(['3dDUirk6VY6EXDvZiZQEkkPAQNa2']), a.loadRange(['3dDUirk6VY6EXDvZiZQEkkPAQNa2'])])
    await a.load(['8xYZ3mmmBBBBBBBBBBBBBBBBBBBB'])
    await a.load(['8xYZ3mmmBBBBBBBBBBBBBBBBBBBB'])
    expect(calls.filter((c) => c.includes('3dDUirk6'))).toHaveLength(1)
    expect(calls.filter((c) => c.includes('8xYZ3mmm'))).toHaveLength(1)
  })
})

describe('the default fetch', () => {
  it('is bound to the global, not called as a method of the adapter', async () => {
    // `window.fetch` invoked with any other receiver throws "Illegal invocation",
    // which is what happened in the browser while every test here passed: the
    // injected doubles are plain functions and have no opinion about `this`.
    const original = globalThis.fetch
    let receiver: unknown = 'never called'
    globalThis.fetch = function (this: unknown) {
      receiver = this
      return Promise.resolve(new Response(null, { status: 404 }))
    } as unknown as typeof globalThis.fetch
    try {
      const a = new CdnStorageAdapter({ base: 'https://cdn.example.com' })
      await a.load(['3dDUirk6VY6EXDvZiZQEkkPAQNa2'])
    } finally {
      globalThis.fetch = original
    }
    expect(receiver === globalThis || receiver === undefined).toBe(true)
    expect(receiver).not.toBeInstanceOf(CdnStorageAdapter)
  })
})

describe('writing', () => {
  it('is ignored rather than refused', async () => {
    // Refusing was the first instinct and it was wrong: a Repo saves a document
    // back to storage after loading it, so a throwing adapter took the read down
    // with it and no templates loaded at all. There is nothing behind a CDN to
    // write to, and dropping the write is what a read-only copy should do.
    const { fetch } = cdn({})
    const a = new CdnStorageAdapter({ base: 'https://cdn.example.com', fetch })
    await expect(a.save()).resolves.toBeUndefined()
    await expect(a.saveBatch()).resolves.toBeUndefined()
    await expect(a.remove()).resolves.toBeUndefined()
    await expect(a.removeRange()).resolves.toBeUndefined()
  })
})
