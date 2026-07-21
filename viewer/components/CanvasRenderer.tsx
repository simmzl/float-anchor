'use client'
import { useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import type { Canvas, Card } from '@/lib/types'
import { computeFitView, zoomAroundPoint, LABEL_LEVEL_SIZES } from '@/lib/fit-view'
import NoteCardView from './NoteCardView'

const ZOOM_STEP = 1.25

// 同桌面端 CanvasView.tsx 的 getConnectionPath：从卡片右侧中点到目标卡片左侧中点的三次贝塞尔曲线
function getConnectionPath(from: Card, to: Card): string {
  const fx = from.x + from.width
  const fy = from.y + (from.height ?? 200) / 2
  const tx = to.x
  const ty = to.y + (to.height ?? 200) / 2
  const cpx = Math.abs(tx - fx) * 0.4
  return `M ${fx} ${fy} C ${fx + cpx} ${fy}, ${tx - cpx} ${ty}, ${tx} ${ty}`
}

export default function CanvasRenderer({ canvas, shareId }: { canvas: Canvas; shareId: string }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<HTMLSpanElement>(null)

  const pan = useRef({ x: 0, y: 0 })
  const scaleVal = useRef(1)
  const rafId = useRef(0)
  // 用户是否已手动调整过视图。未调整前跟随视口尺寸自动归正（首屏 CSS/布局稳定、窗口缩放、
  // 移动端地址栏收起都会改变可用高度）；一旦用户平移或缩放，就不再擅自挪动他的视图。
  const userAdjusted = useRef(false)

  const cards = canvas.cards ?? []
  const sections = canvas.sections ?? []
  const labels = canvas.labels ?? []
  const texts = canvas.texts ?? []
  const connections = canvas.connections ?? []

  const applyTransform = useCallback(() => {
    const el = innerRef.current
    if (el) {
      el.style.transform = `translate(${pan.current.x}px, ${pan.current.y}px) scale(${scaleVal.current})`
    }
    if (zoomRef.current) {
      zoomRef.current.textContent = `${Math.round(scaleVal.current * 100)}%`
    }
  }, [])

  // 归正：按全部元素的包围盒居中并缩放到完整可见。打开页面与点「归正」共用同一套计算。
  const fitToContent = useCallback(() => {
    const vpEl = viewportRef.current
    if (!vpEl) return
    const view = computeFitView(canvas, vpEl.clientWidth, vpEl.clientHeight)
    pan.current = { x: view.panX, y: view.panY }
    scaleVal.current = view.scale
    userAdjusted.current = false
    applyTransform()
  }, [canvas, applyTransform])

  useLayoutEffect(() => {
    userAdjusted.current = false
    fitToContent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas.id])

  // 视口尺寸变化时重新归正——首屏挂载瞬间工具栏可能尚未参与布局，此时算出的高度偏大。
  // 用户已手动调整过则跳过，避免抢走他的视角。
  useEffect(() => {
    const vpEl = viewportRef.current
    if (!vpEl || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (!userAdjusted.current) fitToContent()
    })
    ro.observe(vpEl)
    return () => ro.disconnect()
  }, [fitToContent])

  // 按钮缩放：以视口中心为锚，保持中心处内容不动
  const zoomByStep = useCallback((factor: number) => {
    const vpEl = viewportRef.current
    if (!vpEl) return
    userAdjusted.current = true
    const next = zoomAroundPoint(
      { panX: pan.current.x, panY: pan.current.y, scale: scaleVal.current },
      scaleVal.current * factor,
      vpEl.clientWidth / 2,
      vpEl.clientHeight / 2,
    )
    pan.current = { x: next.panX, y: next.panY }
    scaleVal.current = next.scale
    applyTransform()
  }, [applyTransform])

  // 滚轮平移；Ctrl/⌘+滚轮以光标为锚缩放（同桌面端 CanvasView.tsx 的 onWheel 逻辑）
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      userAdjusted.current = true

      if (e.ctrlKey || e.metaKey) {
        const rect = vp.getBoundingClientRect()
        const next = zoomAroundPoint(
          { panX: pan.current.x, panY: pan.current.y, scale: scaleVal.current },
          scaleVal.current * (1 + (-e.deltaY) * 0.008),
          e.clientX - rect.left,
          e.clientY - rect.top,
        )
        pan.current = { x: next.panX, y: next.panY }
        scaleVal.current = next.scale
      } else {
        const dx = Math.abs(e.deltaX) < 0.5 ? 0 : e.deltaX
        const dy = Math.abs(e.deltaY) < 0.5 ? 0 : e.deltaY
        if (dx === 0 && dy === 0) return
        pan.current = { x: Math.round(pan.current.x - dx), y: Math.round(pan.current.y - dy) }
      }

      cancelAnimationFrame(rafId.current)
      rafId.current = requestAnimationFrame(applyTransform)
    }

    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      vp.removeEventListener('wheel', onWheel)
      cancelAnimationFrame(rafId.current)
    }
  }, [applyTransform])

  // 拖拽平移（鼠标 + 触摸）。不 preventDefault，卡片内链接的点击不受影响。
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return

    let activePointer: number | null = null
    let lastX = 0
    let lastY = 0

    const onPointerDown = (e: PointerEvent) => {
      if (activePointer !== null || (e.pointerType === 'mouse' && e.button !== 0)) return
      activePointer = e.pointerId
      lastX = e.clientX
      lastY = e.clientY
      // 捕获失败（指针已释放等）不影响拖拽本身，只是移出元素后会断
      try { vp.setPointerCapture(e.pointerId) } catch { /* noop */ }
      vp.classList.add('panning')
    }

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== activePointer) return
      userAdjusted.current = true
      pan.current = {
        x: pan.current.x + (e.clientX - lastX),
        y: pan.current.y + (e.clientY - lastY),
      }
      lastX = e.clientX
      lastY = e.clientY
      cancelAnimationFrame(rafId.current)
      rafId.current = requestAnimationFrame(applyTransform)
    }

    const endDrag = (e: PointerEvent) => {
      if (e.pointerId !== activePointer) return
      activePointer = null
      try {
        if (vp.hasPointerCapture(e.pointerId)) vp.releasePointerCapture(e.pointerId)
      } catch { /* noop */ }
      vp.classList.remove('panning')
    }

    vp.addEventListener('pointerdown', onPointerDown)
    vp.addEventListener('pointermove', onPointerMove)
    vp.addEventListener('pointerup', endDrag)
    vp.addEventListener('pointercancel', endDrag)
    return () => {
      vp.removeEventListener('pointerdown', onPointerDown)
      vp.removeEventListener('pointermove', onPointerMove)
      vp.removeEventListener('pointerup', endDrag)
      vp.removeEventListener('pointercancel', endDrag)
    }
  }, [applyTransform])

  const connectionPaths = useMemo(() => {
    const cardMap = new Map(cards.map((c) => [c.id, c]))
    return connections
      .map((conn) => {
        const from = cardMap.get(conn.fromCardId)
        const to = cardMap.get(conn.toCardId)
        if (!from || !to) return null
        return { id: conn.id, path: getConnectionPath(from, to) }
      })
      .filter((c): c is { id: string; path: string } => c !== null)
  }, [cards, connections])

  return (
    <main className="canvas-main">
      <div className="canvas-toolbar">
        <h2 className="canvas-toolbar-title">{canvas.name}</h2>
        <span ref={zoomRef} className="zoom-indicator">100%</span>
      </div>

      <div ref={viewportRef} className="canvas-viewport">
        <div
          ref={innerRef}
          className="canvas-inner"
          style={{ transform: 'translate(0px, 0px) scale(1)', transformOrigin: '0 0' }}
        >
          {sections.map((sec) => (
            <div
              key={sec.id}
              className="section-box"
              style={{
                left: sec.x,
                top: sec.y,
                width: sec.width,
                height: sec.height,
                borderColor: sec.color + '80',
                backgroundColor: sec.color + '18',
              }}
            >
              <div className="section-header">
                <div className="section-color-dot" style={{ background: sec.color }} />
                <span className="section-name">{sec.name}</span>
              </div>
            </div>
          ))}

          <svg className="connections-layer">
            {connectionPaths.map((conn) => (
              <path key={conn.id} d={conn.path} className="conn-line" />
            ))}
          </svg>

          {labels.map((label) => {
            const size = LABEL_LEVEL_SIZES[label.level] ?? LABEL_LEVEL_SIZES[1]
            return (
              <div key={label.id} className="canvas-label" style={{ left: label.x, top: label.y, width: label.width }}>
                <div className="label-text" style={{ fontSize: size.fontSize, fontWeight: size.fontWeight }}>
                  {label.text}
                </div>
              </div>
            )
          })}

          {texts.map((t) => (
            <div key={t.id} className="canvas-text" style={{ left: t.x, top: t.y, width: t.width }}>
              <div className="text-content">{t.text}</div>
            </div>
          ))}

          {cards.map((card) => (
            <NoteCardView key={card.id} card={card} shareId={shareId} />
          ))}
        </div>
      </div>

      <div className="viewer-controls">
        <button
          type="button"
          className="viewer-control-btn"
          onClick={() => zoomByStep(ZOOM_STEP)}
          title="放大"
          aria-label="放大"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          className="viewer-control-btn"
          onClick={() => zoomByStep(1 / ZOOM_STEP)}
          title="缩小"
          aria-label="缩小"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          className="viewer-control-btn viewer-control-fit"
          onClick={fitToContent}
          title="归正（全部内容居中）"
          aria-label="归正"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
          </svg>
        </button>
      </div>
    </main>
  )
}
