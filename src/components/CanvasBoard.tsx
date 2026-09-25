import { useEffect, useRef, useState } from 'react'
import type { AIRole, KeySphereT, MergedPair, RelationBubble } from '@/shared/types'
import { SphereNode } from './SphereNode'
import { BubbleCard } from './BubbleCard'

interface View {
  x: number
  y: number
  k: number
}

interface Props {
  spheres: KeySphereT[]
  bubbles: RelationBubble[]
  merged: Record<string, MergedPair>
  roles: AIRole[]
  reduceMotion: boolean
  onMoveSphere: (id: string, x: number, y: number) => void
}

export function CanvasBoard({ spheres, bubbles, merged, roles, reduceMotion, onMoveSphere }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [view, setView] = useState<View>({ x: 480, y: 320, k: 1 })

  const viewRef = useRef(view)
  viewRef.current = view
  const drawStateRef = useRef({ spheres, merged })
  drawStateRef.current = { spheres, merged }
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const panRef = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null)
  const pinchRef = useRef<{ d0: number; k0: number; mid0: { x: number; y: number }; v0: View } | null>(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())

  /** 融球渲染层：rAF 持续绘制，SVG goo 滤镜让靠近的球产生流体融合 */
  useEffect(() => {
    let raf = 0
    const draw = () => {
      const canvas = canvasRef.current
      const container = containerRef.current
      if (canvas && container) {
        const dpr = window.devicePixelRatio || 1
        const W = container.clientWidth
        const H = container.clientHeight
        if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
          canvas.width = Math.round(W * dpr)
          canvas.height = Math.round(H * dpr)
        }
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.clearRect(0, 0, W, H)
          const v = viewRef.current
          const { spheres: sp, merged: mg } = drawStateRef.current
          const now = performance.now()

          for (const s of sp) {
            const sx = s.x * v.k + v.x
            const sy = s.y * v.k + v.y
            const r = s.r * v.k
            const pulse = s.pulseAt && !reduceMotion ? Math.max(0, 1 - (now - s.pulseAt) / 700) : 0
            ctx.beginPath()
            ctx.arc(sx, sy, r * (1 + pulse * 0.12), 0, Math.PI * 2)
            ctx.fillStyle = s.color
            ctx.fill()
            if (pulse > 0) {
              ctx.beginPath()
              ctx.arc(sx, sy, r * (1.4 + (1 - pulse) * 1.8), 0, Math.PI * 2)
              ctx.strokeStyle = s.color
              ctx.lineWidth = 2.5
              ctx.globalAlpha = pulse * 0.8
              ctx.stroke()
              ctx.globalAlpha = 1
            }
          }

          // 拼接中的球对：中点生成桥接球，形成融球效果
          for (const key of Object.keys(mg)) {
            const m = mg[key]
            const a = sp.find((s) => s.id === m.aId)
            const b = sp.find((s) => s.id === m.bId)
            if (!a || !b) continue
            const mx = ((a.x + b.x) / 2) * v.k + v.x
            const my = ((a.y + b.y) / 2) * v.k + v.y
            const br = Math.min(a.r, b.r) * v.k * (0.45 + m.intensity * 0.65)
            ctx.beginPath()
            ctx.arc(mx, my, br, 0, Math.PI * 2)
            ctx.fillStyle = a.color
            ctx.globalAlpha = 0.95
            ctx.fill()
            ctx.globalAlpha = 1
          }
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [reduceMotion])

  /** 滚轮缩放（需 passive: false 才能 preventDefault） */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      setView((v) => {
        const factor = Math.exp(-e.deltaY * 0.0012)
        const k2 = Math.min(2.5, Math.max(0.35, v.k * factor))
        const wx = (mx - v.x) / v.k
        const wy = (my - v.y) / v.k
        return { k: k2, x: mx - wx * k2, y: my - wy * k2 }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const localPoint = (e: React.PointerEvent) => {
    const rect = containerRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const toWorld = (px: number, py: number, v: View) => ({ x: (px - v.x) / v.k, y: (py - v.y) / v.k })

  const onSpherePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    containerRef.current?.setPointerCapture(e.pointerId)
    const s = spheres.find((x) => x.id === id)
    if (!s) return
    const p = localPoint(e)
    const w = toWorld(p.x, p.y, viewRef.current)
    dragRef.current = { id, dx: w.x - s.x, dy: w.y - s.y }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-sphere]')) return
    const p = localPoint(e)
    pointersRef.current.set(e.pointerId, p)
    containerRef.current?.setPointerCapture(e.pointerId)
    if (pointersRef.current.size === 2) {
      const [p1, p2] = Array.from(pointersRef.current.values())
      panRef.current = null
      pinchRef.current = {
        d0: Math.hypot(p1.x - p2.x, p1.y - p2.y),
        k0: viewRef.current.k,
        mid0: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
        v0: { ...viewRef.current },
      }
    } else {
      panRef.current = { sx: p.x, sy: p.y, vx: viewRef.current.x, vy: viewRef.current.y }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, localPoint(e))
    }
    if (pinchRef.current && pointersRef.current.size >= 2) {
      const [p1, p2] = Array.from(pointersRef.current.values())
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y)
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
      const { d0, k0, mid0, v0 } = pinchRef.current
      const k2 = Math.min(2.5, Math.max(0.35, (k0 * d) / Math.max(d0, 1)))
      const anchor = toWorld(mid0.x, mid0.y, v0)
      setView({ k: k2, x: mid.x - anchor.x * k2, y: mid.y - anchor.y * k2 })
      return
    }
    if (dragRef.current) {
      const p = localPoint(e)
      const w = toWorld(p.x, p.y, viewRef.current)
      onMoveSphere(dragRef.current.id, w.x - dragRef.current.dx, w.y - dragRef.current.dy)
      return
    }
    if (panRef.current) {
      const p = localPoint(e)
      setView((v) => ({ ...v, x: panRef.current!.vx + (p.x - panRef.current!.sx), y: panRef.current!.vy + (p.y - panRef.current!.sy) }))
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
    if (pointersRef.current.size === 0) panRef.current = null
    dragRef.current = null
    try {
      containerRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* 指针可能已释放 */
    }
  }

  const shakingIds = new Set<string>()
  for (const key of Object.keys(merged)) {
    shakingIds.add(merged[key].aId)
    shakingIds.add(merged[key].bId)
  }

  return (
    <div
      ref={containerRef}
      className="relative min-w-0 flex-1 touch-none overflow-hidden bg-slate-950"
      style={{
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(148,163,184,0.18) 1px, transparent 0)',
        backgroundSize: '28px 28px',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* SVG goo 滤镜定义：高斯模糊 + alpha 色阶截断 → 流体融球 */}
      <svg width="0" height="0" className="absolute">
        <defs>
          <filter id="goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -12" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" style={{ filter: 'url(#goo)' }} />

      {spheres.map((s) => (
        <SphereNode
          key={s.id}
          sphere={s}
          view={view}
          shaking={shakingIds.has(s.id)}
          reduceMotion={reduceMotion}
          onPointerDown={onSpherePointerDown}
        />
      ))}

      {bubbles.map((b) => {
        const author = roles.find((r) => r.id === b.authorId)
        return (
          <BubbleCard
            key={b.id}
            bubble={b}
            sx={b.x * view.k + view.x}
            sy={b.y * view.k + view.y}
            authorName={author?.name ?? 'AI'}
            authorColor={author?.color ?? '#e2e8f0'}
          />
        )
      })}

      <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/10 bg-slate-900/70 px-4 py-1.5 text-xs text-slate-400 backdrop-blur">
        拖动空白处平移 · 滚轮 / 双指捏合缩放 · 把两个关键球拖到一起试试
      </div>
    </div>
  )
}
