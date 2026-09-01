// Where a stored chunk goes in automerge-repo's NodeFS storage layout.
//
// Split out from index.ts so it can be tested against the real adapter: index.ts
// pulls in Automerge and two lots of wasm, which the unit lane cannot load.
//
// This one function decides whether an exported history is readable. Get it wrong
// and the zip still opens, the files are all present, and pushwork reads the repo
// as empty — so it is checked against `NodeFSStorageAdapter` itself rather than
// against my reading of it.

/**
 * `<first two characters of the document id>/<the rest>/<remaining key parts>`.
 *
 * Mirrors `NodeFSStorageAdapter.getFilePath`. The two-character shard keeps a
 * flat store from becoming a single directory with a hundred thousand entries in
 * it, which is slow on every filesystem and hostile on some.
 */
export function storageChunkPath(key: string[]): string {
  const [first, ...rest] = key
  if (first === undefined) return ''
  return [first.slice(0, 2), first.slice(2), ...rest].join('/')
}
