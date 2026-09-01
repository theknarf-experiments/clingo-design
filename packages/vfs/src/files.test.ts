// What a path says about its contents.

import { describe, expect, it } from './shim.ts'
import { dataUrl, extOf, isBinaryPath, mimeOf } from './files.ts'

describe('which files are bytes', () => {
  it('the image formats a browser renders', () => {
    for (const p of ['/a.png', '/a.JPG', '/deep/b.webp', '/c.avif', '/d.ico']) {
      expect([p, isBinaryPath(p)]).toEqual([p, true])
    }
  })

  it('and fonts, which are equally not text', () => {
    expect(isBinaryPath('/f.woff2')).toBe(true)
    expect(isBinaryPath('/f.ttf')).toBe(true)
  })

  it('but not SVG, which is markup and should open in the editor', () => {
    // The one image format with source worth editing. Treating it as bytes
    // would hide that.
    expect(isBinaryPath('/logo.svg')).toBe(false)
    expect(mimeOf('/logo.svg')).toBe('image/svg+xml')
  })

  it('nor source, nor a file with no extension at all', () => {
    expect(isBinaryPath('/src/App.tsx')).toBe(false)
    expect(isBinaryPath('/README')).toBe(false)
    expect(extOf('/README')).toBe('')
  })

  it('a dotfile is not an extension', () => {
    // `.keep` is the whole name, not a `keep` extension.
    expect(extOf('/src/.keep')).toBe('')
  })
})

describe('showing one', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  it('a data url carries the type and the bytes', () => {
    const url = dataUrl('/a.png', PNG)
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
    const back = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0))
    expect([...back]).toEqual([...PNG])
  })

  it('and survives a file too big to spread into a call', () => {
    // `String.fromCharCode(...bytes)` throws somewhere past a hundred thousand
    // arguments, which is an ordinary photograph. The chunking is why this
    // works, so it is worth a test with more bytes than that.
    const big = new Uint8Array(200_000)
    for (let i = 0; i < big.length; i++) big[i] = i % 256
    const url = dataUrl('/big.jpg', big)
    const back = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0))
    expect(back.length).toBe(big.length)
    expect(back[199_999]).toBe(big[199_999])
  })

  it('an unknown extension is not claimed to be anything', () => {
    expect(mimeOf('/thing.xyz')).toBe('application/octet-stream')
  })
})
