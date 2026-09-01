import { describe, expect, it } from './shim.ts'
import { DEFAULT_SYNC_SERVER, isValidServerUrl, normalizeServerUrl } from './server.ts'

// What a user can type into the sync server field.
//
// Accepting a bad url here does not fail loudly: the endpoint is handed to a Repo
// at construction, and a connection that never establishes looks exactly like a
// server that happens to be down. So the shape is checked before it gets that
// far, and the panel reports the live connection state for everything that shape
// cannot catch.

describe('accepting a server url', () => {
  it('takes ws and wss', () => {
    expect(isValidServerUrl('ws://localhost:8080')).toBe(true)
    expect(isValidServerUrl('wss://sync.example.com')).toBe(true)
    expect(isValidServerUrl('wss://sync.example.com:443/path')).toBe(true)
  })

  it('refuses http, which is the likely mistake', () => {
    // The plausible wrong answer: it looks like a url, it is a url, and it
    // produces a socket that never connects.
    expect(isValidServerUrl('http://localhost:8080')).toBe(false)
    expect(isValidServerUrl('https://sync.example.com')).toBe(false)
  })

  it('and anything that is not a url at all', () => {
    for (const bad of ['', '   ', 'localhost:8080', 'ws://', 'nonsense', 'ws']) {
      expect(isValidServerUrl(bad), bad).toBe(false)
    }
  })
})

describe('normalising one', () => {
  it('trims, since a pasted url usually arrives with whitespace', () => {
    expect(normalizeServerUrl('  ws://localhost:8080  ')).toBe('ws://localhost:8080')
  })

  it('drops a trailing slash, so one server is not two repos', () => {
    // The key of the repo map. `ws://x:8080` and `ws://x:8080/` naming separate
    // repos would mean two sockets and two sync paths for one server.
    expect(normalizeServerUrl('ws://localhost:8080/')).toBe('ws://localhost:8080')
    expect(normalizeServerUrl('ws://localhost:8080///')).toBe('ws://localhost:8080')
  })

  it('leaves a real path alone', () => {
    expect(normalizeServerUrl('wss://example.com/sync')).toBe('wss://example.com/sync')
  })

  it('settles spellings that differ only in form', () => {
    // These are the same server, and the URL parser says so. Storing them
    // verbatim would key two repos — two sockets to one place, each syncing a
    // different subset of projects.
    expect(normalizeServerUrl('ws:/localhost:8080')).toBe('ws://localhost:8080')
    expect(normalizeServerUrl('ws://LOCALHOST:8080')).toBe('ws://localhost:8080')
  })

  it('returns null for anything unusable rather than a broken string', () => {
    expect(normalizeServerUrl('http://localhost:8080')).toBe(null)
    expect(normalizeServerUrl('')).toBe(null)
  })
})

describe('the build default', () => {
  it('is a usable endpoint when there is one', () => {
    // If VITE_SUBDUCTION is ever set to something malformed, everything else in
    // the app inherits it — so the fallback itself has to pass the same check.
    //
    // Guarded, which is this repo's one edit to a copied test and is a real
    // difference rather than a weakening. Upstream runs under vitest, where
    // `import.meta.env.DEV` is true and the default is therefore the localhost
    // fallback; these tests run under `node --test`, where there is no Vite env
    // at all and a build default is genuinely absent. "No server configured" is
    // a supported deployment — see the note on DEFAULT_SYNC_SERVER — so the
    // claim being made here is *if there is a default, it is well formed*, and
    // that is what is written.
    if (DEFAULT_SYNC_SERVER === null) return
    expect(isValidServerUrl(DEFAULT_SYNC_SERVER)).toBe(true)
  })
})
