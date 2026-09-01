// Which subduction server a project syncs to.
//
// Split out from index.ts so it can be tested: index.ts pulls in Automerge and
// two lots of wasm, which the unit lane cannot load.

/** The server a build ships with, injected at build time from
 *  `VITE_SUBDUCTION`; the localhost fallback is the dev sync server. A project
 *  uses this unless its settings name another.
 *
 *  `||` rather than `??` on purpose: an unset variable and one set to the empty
 *  string are the same mistake, and `??` would inline `''` as an endpoint.
 *
 *  `import.meta.env?` rather than `import.meta.env`, and that optional chain is
 *  this repo's one change to the file. `env` is Vite's, defined in the app build
 *  and in nothing else; the tests here run under `node --test` like every other
 *  test in this repo rather than under vitest, and a bare read would throw at
 *  module load — before a single assertion about url parsing, which is what this
 *  module is actually tested for. Absent then means what an unset variable
 *  means. */
export const DEFAULT_SYNC_SERVER: string | null =
  import.meta.env?.VITE_SUBDUCTION ||
  // Only in development, where a sync server on the usual port is what
  // `docker compose up -d` gives you and typing it into every project would be
  // busywork. A production build that names no server *has* no server, which is a
  // supported way to deploy: templates can come from a CDN instead, and a project
  // syncs only if someone supplies a url for it.
  (import.meta.env?.DEV ? 'ws://localhost:8080' : null)

/** Where templates are read from as static files, if anywhere.
 *
 *  A deployment can have a CDN, a sync server, both, or — in development — just
 *  the server. Both is not a fallback arrangement so much as two places to look:
 *  the CDN is cheap and always up, the server is live and may be newer.
 *
 *  See cdnStorage.ts for the layout. Documents, not some other export format, so
 *  a project cloned from the CDN is the same repo as one cloned from the server. */
export const TEMPLATE_CDN: string | null = import.meta.env?.VITE_TEMPLATE_CDN || null

/**
 * The name the sync server answers to, when that is not the address we dial.
 *
 * Subduction identifies a server peer by a hash of its "service name" — a stand-in
 * for its peer id, so a client can connect without knowing the id itself. The
 * server takes that name from `--service-name`, and the JS client derives it from
 * `new URL(url).host`. When those two agree, nothing here matters.
 *
 * They stop agreeing the moment anything sits in front of the server. Reaching it
 * through a reverse proxy — a Tailscale Funnel, an ingress, an ssh tunnel — changes
 * the host you dial without changing the server, so the derived name no longer
 * matches and the handshake is *refused*. From the browser that is silence.
 *
 * Setting this decouples the two: dial `VITE_SUBDUCTION`, but ask for the peer named
 * here. It is not a security control and not an SNI-style check — it names which
 * peer we mean to talk to, and the proxy is not that peer. Which is why the honest
 * fix is to keep naming the server what it calls itself, rather than reconfiguring
 * a server because a proxy was put in front of it.
 *
 * Unset (the common case) means "derive it from the url", which is the behaviour
 * everywhere that has no proxy.
 */
export const SYNC_AUDIENCE: string | null =
  import.meta.env?.VITE_SUBDUCTION_AUDIENCE || null

/**
 * Whether a string is usable as a subduction endpoint.
 *
 * Only the shape is checkable here. Whether anything answers, and whether it
 * accepts the handshake, is not: subduction hashes the audience from the
 * server's own `SUBDUCTION_SERVICE_NAME`, so a url with the right shape and the
 * wrong host:port is rejected at connect time rather than here. That is why the
 * settings panel reports the live connection state instead of only validating.
 */
export function isValidServerUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  // Not http(s): the endpoint is a websocket, and accepting an http url here
  // would produce a connection that silently never establishes.
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return false
  return parsed.hostname.length > 0
}

/** Canonicalise a url the user typed, or null if it is not one we can use.
 *
 *  Through the URL parser rather than by trimming, because this string keys the
 *  map of repos: two spellings of one server would mean two repos, two sockets
 *  and two sync paths for the same place. The parser settles the spellings that
 *  differ only in form — `ws:/host` is `ws://host`, the host case is folded —
 *  and the trailing slash it adds comes back off so `ws://x:8080` and
 *  `ws://x:8080/` agree too. */
export function normalizeServerUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!isValidServerUrl(trimmed)) return null
  return new URL(trimmed).href.replace(/\/+$/, '')
}
