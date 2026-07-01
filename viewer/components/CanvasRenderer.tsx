'use client'
import { useRef, useEffect, useCallback, useMemo } from 'react'
import type { Canvas, Card } from '@/lib/types'
import NoteCardView from './NoteCardView'

const MIN_SCALE = 0.15
const MAX_SCALE = 3

const LABEL_LEVEL_SIZES: Record<number, { fontSize: number; fontWeight: number }> = {
  0: { fontSize: 14, fontWeight: 400 },
  1: { fontSize: 28, fontWeight: 700 },
  2: { fontSize: 22, fontWeight: 650 },
  3: { fontSize: 18, fontWeight: 600 },
  4: { fontSize: 15, fontWeight: 600 },
}

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

  // 初始视图：优先使用 canvas.viewport，否则按内容包围盒居中适配（同桌面端 findDensestCenter 逻辑的简化版：全部卡片取包围盒）
  useEffect(() => {
    const vp = canvas.viewport
    const vpEl = viewportRef.current
    if (vp) {
      pan.current = { x: vp.panX, y: vp.panY }
      scaleVal.current = vp.scale
    } else if (cards.length > 0 && vpEl) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const c of cards) {
        minX = Math.min(minX, c.x)
        minY = Math.min(minY, c.y)
        maxX = Math.max(maxX, c.x + c.width)
        maxY = Math.max(maxY, c.y + (c.height ?? 200))
      }
      const contentW = maxX - minX
      const contentH = maxY - minY
      const centerX = minX + contentW / 2
      const centerY = minY + contentH / 2
      const vpW = vpEl.clientWidth
      const vpH = vpEl.clientHeight
      const scaleX = (vpW * 0.85) / Math.max(contentW, 1)
      const scaleY = (vpH * 0.85) / Math.max(contentH, 1)
      const targetScale = Math.min(Math.max(Math.min(scaleX, scaleY), MIN_SCALE), MAX_SCALE, 1.2)
      pan.current = { x: vpW / 2 - centerX * targetScale, y: vpH / 2 - centerY * targetScale }
      scaleVal.current = targetScale
    } else {
      pan.current = { x: 0, y: 0 }
      scaleVal.current = 1
    }
    applyTransform()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas.id])

  // 滚轮平移；Ctrl/⌘+滚轮以光标为锚缩放（同桌面端 CanvasView.tsx 的 onWheel 逻辑）
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()

      if (e.ctrlKey || e.metaKey) {
        const s = scaleVal.current
        const p = pan.current
        const factor = 1 + (-e.deltaY) * 0.008
        const ns = Math.min(Math.max(s * factor, MIN_SCALE), MAX_SCALE)
        const ratio = ns / s
        const rect = vp.getBoundingClientRect()
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        pan.current = { x: Math.round(cx - (cx - p.x) * ratio), y: Math.round(cy - (cy - p.y) * ratio) }
        scaleVal.current = ns
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
    </main>
  )
}
