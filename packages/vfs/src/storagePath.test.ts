import { mkdtempSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { NodeFSStorageAdapter } from '@automerge/automerge-repo-storage-nodefs'
import { describe, expect, it } from './shim.ts'
import { storageChunkPath } from './storagePath.ts'

// Checked against the adapter, not against a reading of it.
//
// An exported history is a directory of chunk files, and pushwork's 4 → 5
// migration reads it with exactly this adapter. If our paths disagree with its
// paths, the export is a zip that opens, contains every file, and reads as an
// empty repo. Nothing about that failure is loud, so the agreement is asserted
// directly: write chunks with the real adapter, then compare where they landed.

/** Realistic keys: a base58 document id, then the chunk kinds automerge-repo
 *  files under it. */
const KEYS: string[][] = [
  ['3bZrteC6t4erVw12g99xaGztmWHK', 'snapshot', 'abc123'],
  ['3bZrteC6t4erVw12g99xaGztmWHK', 'incremental', 'def456'],
  ['4cAyMq3s3Rg42kGA2jZlSN0GXQGe', 'sync-state', 'peer', 'xyz'],
]

function filesUnder(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(relative(root, full).split(sep).join('/'))
    }
  }
  walk(root)
  return out.sort()
}

describe('the chunk path', () => {
  it('is where NodeFSStorageAdapter actually puts things', async () => {
    const root = mkdtempSync(join(tmpdir(), 'flow-page-storage-'))
    const adapter = new NodeFSStorageAdapter(root)
    for (const [i, key] of KEYS.entries()) {
      await adapter.save(key, new Uint8Array([i, i, i]))
    }
    // `.tmp` is the adapter's staging directory, not stored data.
    const written = filesUnder(root).filter((p) => !p.startsWith('.tmp/'))
    expect(written).toEqual(KEYS.map(storageChunkPath).sort())
  })

  it('shards on the first two characters of the document id', () => {
    expect(storageChunkPath(['3bZrteC6t4er', 'snapshot', 'abc'])).toBe(
      '3b/ZrteC6t4er/snapshot/abc',
    )
  })

  it('keeps every remaining key part as its own directory', () => {
    expect(storageChunkPath(['abcdef', 'sync-state', 'peer-1'])).toBe('ab/cdef/sync-state/peer-1')
  })

  it('and an empty key addresses nothing rather than throwing', () => {
    expect(storageChunkPath([])).toBe('')
  })
})
