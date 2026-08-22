// Ported from flow-page's InfiniteCanvas (itself from x11-web): no Popover
// dependency, fills its container (not the window), a dot-grid background,
// drag-to-pan on empty space, and a small imperative api (fit / zoom).
//
// Adapted here to follow the app's light/dark theme via the --dc-* custom
// properties instead of the hardcoded light palette it shipped with.
import {
  type Camera,
  type CameraStore,
  createCameraStore,
  fitView,
  panBy,
  PinchTracker,
  type Point,
  viewportToCanvas,
  wheelIntent,
  zoomAt,
} from '@clingo-design/canvas-core'
import { type MutableRefObject, type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import s from './InfiniteCanvas.module.css'

export interface CanvasApi {
  /** Fit a canvas-space rect into view. */
  fit(rect: { x: number; y: number; width: number; height: number }, padding?: number): void
  /** Jump to a scale, keeping the viewport centre anchored. */
  zoomTo(scale: number): void
  getViewportSize(): { width: number; height: number }
  getCamera(): Camera
}

export interface InfiniteCanvasProps {
  children: ReactNode
  /** Share the camera with another renderer / the parent. Omitted → private. */
  cameraStore?: CameraStore
  /** Dot-grid background. Default true. */
  grid?: boolean
  className?: string
  /** Imperative handle for fit/zoom. */
  apiRef?: MutableRefObject<CanvasApi | null>
  /** page-space → canvas-space helper, refreshed each render (for drag logic
   *  in children that starts a window-level pointermove). */
  pageToCanvasRef?: MutableRefObject<((clientX: number, clientY: number) => Point) | null>
  /** Fires on empty-canvas pointerdown (children that consume it stopPropagation).
   *  Point is in canvas coords. Used by an annotation layer's draw tools. */
  onCanvasPointerDown?: (point: Point, event: React.PointerEvent) => void
  /** Right-click on empty canvas, in canvas coordinates. Children that handle
   *  their own right-click stop propagation, so this is genuinely the
   *  background. */
  onCanvasContextMenu?: (point: Point, event: React.MouseEvent) => void
  /** When provided, a "Fit" entry appears in the zoom popup menu. */
  onFit?: () => void
}

const GRID = 24 // canvas units between dots
const ZOOM_PRESETS = [0.25, 0.5, 1, 1.5, 2]

export function InfiniteCanvas({
  children,
  cameraStore,
  grid = true,
  className,
  apiRef,
  pageToCanvasRef,
  onCanvasPointerDown,
  onCanvasContextMenu,
  onFit,
}: InfiniteCanvasProps) {
  const internalStore = useMemo(() => createCameraStore(), [])
  const store = cameraStore ?? internalStore
  const storeRef = useRef(store)
  storeRef.current = store
  const camera = useSyncExternalStore(store.subscribe, store.get)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [gestureActive, setGestureActive] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const rectOf = () => viewportRef.current?.getBoundingClientRect()

  // Native wheel/pointer listeners: wheel needs { passive:false } to
  // preventDefault; touch pinch observes pointer events on window.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    let settleTimer: number | null = null
    const markGesture = () => {
      setGestureActive(true)
      if (settleTimer !== null) clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        settleTimer = null
        setGestureActive(false)
      }, 150)
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      markGesture()
      const st = storeRef.current
      const cam = st.get()
      const intent = wheelIntent(e)
      if (intent.type === 'zoom') {
        const rect = el.getBoundingClientRect()
        st.set(zoomAt(cam, e.clientX - rect.left, e.clientY - rect.top, cam.scale * intent.factor))
      } else {
        st.set(panBy(cam, intent.dx, intent.dy))
      }
    }
    const pinch = new PinchTracker()
    const onPointerDownWin = (e: PointerEvent) => pinch.down(e)
    const onPointerMove = (e: PointerEvent) => {
      const update = pinch.move(e)
      if (!update) return
      markGesture()
      const rect = el.getBoundingClientRect()
      const st = storeRef.current
      const cam = st.get()
      st.set(zoomAt(cam, update.midX - rect.left, update.midY - rect.top, cam.scale * update.factor))
    }
    const onPointerEnd = (e: PointerEvent) => pinch.up(e.pointerId)
    const onScroll = () => {
      el.scrollTop = 0
      el.scrollLeft = 0
    }
    el.addEventListener('scroll', onScroll)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', onPointerDownWin)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerEnd)
    window.addEventListener('pointercancel', onPointerEnd)
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onPointerDownWin)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerEnd)
      window.removeEventListener('pointercancel', onPointerEnd)
      if (settleTimer !== null) clearTimeout(settleTimer)
    }
  }, [])

  // Drag-to-pan on empty space: children (frames, annotations) stopPropagation
  // on their pointerdown, so this only fires on the empty canvas.
  const panning = useRef<{ x: number; y: number } | null>(null)
  const onViewportPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const rect = rectOf()
    if (onCanvasPointerDown && rect) {
      onCanvasPointerDown(viewportToCanvas(storeRef.current.get(), e.clientX - rect.left, e.clientY - rect.top), e)
      if (e.defaultPrevented) return // a draw tool claimed it
    }
    panning.current = { x: e.clientX, y: e.clientY }
    setMenuOpen(false)
    const move = (ev: PointerEvent) => {
      const p = panning.current
      if (!p) return
      const st = storeRef.current
      st.set(panBy(st.get(), -(ev.clientX - p.x), -(ev.clientY - p.y)))
      panning.current = { x: ev.clientX, y: ev.clientY }
    }
    const up = () => {
      panning.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Imperative api.
  if (apiRef) {
    apiRef.current = {
      fit: (rect, padding) => {
        const r = rectOf()
        if (!r) return
        storeRef.current.set(fitView(rect, { width: r.width, height: r.height }, undefined, padding))
      },
      zoomTo: (scale) => {
        const r = rectOf()
        if (!r) return
        storeRef.current.set(zoomAt(storeRef.current.get(), r.width / 2, r.height / 2, scale))
      },
      getViewportSize: () => {
        const r = rectOf()
        return { width: r?.width ?? 0, height: r?.height ?? 0 }
      },
      getCamera: () => storeRef.current.get(),
    }
  }
  if (pageToCanvasRef) {
    pageToCanvasRef.current = (clientX, clientY) => {
      const rect = rectOf()
      if (!rect) return { x: clientX, y: clientY }
      return viewportToCanvas(storeRef.current.get(), clientX - rect.left, clientY - rect.top)
    }
  }

  const transform = `scale(${camera.scale}) translate(${-camera.x}px, ${-camera.y}px)`
  const zoomPercent = Math.round(camera.scale * 100)
  const setZoom = (scale: number) => {
    const r = rectOf()
    if (!r) return
    storeRef.current.set(zoomAt(storeRef.current.get(), r.width / 2, r.height / 2, scale))
  }

  return (
    <div
      ref={viewportRef}
      className={`${s.viewport} ${panning.current ? s.grabbing : s.grab} ${className ?? ''}`}
      data-testid="infinite-canvas"
      onPointerDown={onViewportPointerDown}
      onContextMenu={(e) => {
        const rect = rectOf()
        if (!onCanvasContextMenu || !rect) return
        onCanvasContextMenu(
          viewportToCanvas(storeRef.current.get(), e.clientX - rect.left, e.clientY - rect.top),
          e,
        )
      }}
    >
      {grid && (
        <div
          className={s.grid}
          style={{
            backgroundSize: `${GRID * camera.scale}px ${GRID * camera.scale}px`,
            backgroundPosition: `${-camera.x * camera.scale}px ${-camera.y * camera.scale}px`,
          }}
        />
      )}
      <div
        className={s.transform}
        style={{ transform, willChange: gestureActive ? 'transform' : 'auto' }}
        data-canvas-scale={camera.scale}
      >
        {children}
      </div>
      <div className={s.controls}>
        <div className={s.zoomWrap}>
          <button type="button" className={s.ctrlBtn} onClick={() => setMenuOpen((o) => !o)} title="Zoom" aria-label="Zoom">
            {zoomPercent}%
          </button>
          {menuOpen && (
            <div className={s.zoomMenu} role="menu">
              {onFit && (
                <button
                  type="button"
                  className={s.zoomItem}
                  onClick={() => {
                    onFit()
                    setMenuOpen(false)
                  }}
                >
                  Fit
                </button>
              )}
              <button type="button" className={s.zoomItem} onClick={() => setZoom(camera.scale * 1.3)}>
                Zoom in
              </button>
              <button type="button" className={s.zoomItem} onClick={() => setZoom(camera.scale / 1.3)}>
                Zoom out
              </button>
              <div className={s.zoomDivider} />
              {ZOOM_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={camera.scale === p ? s.zoomItemActive : s.zoomItem}
                  onClick={() => {
                    setZoom(p)
                    setMenuOpen(false)
                  }}
                >
                  {Math.round(p * 100)}%
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
