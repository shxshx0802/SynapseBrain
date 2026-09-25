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
  enginePaused: boolean
  onMoveSphere: (id: string, x: number, y: number) => void
  onAttachFile: (file: File) => void
  onInspect: (id: string) => void
}

export function CanvasBoard({ spheres, bubbles, merged, roles, reduceMotion, enginePaused, onMoveSphere, onAttachFile, onInspect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fxCanvasRef = useRef<HTMLCanvasElement>(null)
  const [view, setView] = useState<View>({ x: 480, y: 320, k: 1 })
  const [dragOver, setDragOver] = useState(false)

  const viewRef = useRef(view)
  viewRef.current = view
  const drawStateRef = useRef({ spheres, merged })
  drawStateRef.current = { spheres, merged }
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const panRef = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null)
  const pinchRef = useRef<{ d0: number; k0: number; mid0: { x: number; y: number }; v0: View } | null>(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  /** 双击检测：pointer capture 会把真实 dblclick 重定向到容器，球上的 onDoubleClick 收不到，
      改为手动判定——同一颗球两次轻点（间隔 <450ms、位移 <6px）即视为双击 */
  const tapRef = useRef<{ id: string; t: number; x: number; y: number; moved: boolean } | null>(null)
  const lastTapRef = useRef<{ id: string; t: number } | null>(null)

  /** 融球渲染层：rAF 持续绘制。分两层——gooCanvas 带 SVG 滤镜画球体/桥接（流体融合），
      fxCanvas 不带滤镜画光波/脉冲（goo 滤镜会把细线的 alpha 二值化滤掉，光波必须画在滤镜外） */
  useEffect(() => {
    let raf = 0
    const draw = () => {
      const canvas = canvasRef.current
      const fxCanvas = fxCanvasRef.current
      const container = containerRef.current
      if (canvas && fxCanvas && container) {
        const dpr = window.devicePixelRatio || 1
        const W = container.clientWidth
        const H = container.clientHeight
        if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
          canvas.width = Math.round(W * dpr)
          canvas.height = Math.round(H * dpr)
        }
        if (fxCanvas.width !== canvas.width || fxCanvas.height !== canvas.height) {
          fxCanvas.width = canvas.width
          fxCanvas.height = canvas.height
        }
        const ctx = canvas.getContext('2d')
        const fx = fxCanvas.getContext('2d')
        if (ctx && fx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.clearRect(0, 0, W, H)
          fx.setTransform(dpr, 0, 0, dpr, 0, 0)
          fx.clearRect(0, 0, W, H)
          const v = viewRef.current
          const { spheres: sp, merged: mg } = drawStateRef.current
          const now = performance.now()
          // 拼接中的球：光波更密更亮（双重涟漪）
          const mergingIds = new Set<string>()
          for (const key of Object.keys(mg)) {
            mergingIds.add(mg[key].aId)
            mergingIds.add(mg[key].bId)
          }

          for (const s of sp) {
            const sx = s.x * v.k + v.x
            const sy = s.y * v.k + v.y
            const r = s.r * v.k
            const inMerge = mergingIds.has(s.id)
            // pulseAt 用的是 Date.now() 时钟，这里必须同钟比较；clamp 防脏数据
            const pulse = s.pulseAt && !reduceMotion ? Math.min(1, Math.max(0, 1 - (Date.now() - s.pulseAt) / 700)) : 0
            // 灰色球体：画小一圈（0.88r），让 HTML 球面盖住 goo 滤镜的模糊边缘，避免缩放时的重影
            ctx.beginPath()
            ctx.arc(sx, sy, r * 0.88 * (1 + pulse * 0.12), 0, Math.PI * 2)
            ctx.fillStyle = '#9aa3af'
            ctx.fill()
            // 阵阵白色光波：待机时常在的双重错峰涟漪（不受减少动态效果影响）；
            // 拼接中的球更亮更快——这部分强烈反馈仍遵守开关
            {
              const boost = inMerge && !reduceMotion
              const period = boost ? 1300 : 2400 + (s.bornAt % 800)
              const ripple = (offset: number, alpha: number, width: number) => {
                const phase = ((now + s.bornAt + offset) % period) / period
                const rr = r * (1.08 + phase * 1.9)
                fx.beginPath()
                fx.arc(sx, sy, rr, 0, Math.PI * 2)
                fx.strokeStyle = '#ffffff'
                fx.lineWidth = width
                fx.globalAlpha = (1 - phase) * alpha
                fx.stroke()
                fx.globalAlpha = 1
              }
              ripple(0, boost ? 0.65 : 0.5, boost ? 2.5 : 2)
              ripple(period / 2, boost ? 0.45 : 0.32, boost ? 2 : 1.5)
            }
            // 拼接触发时的强脉冲光环
            if (pulse > 0) {
              fx.beginPath()
              fx.arc(sx, sy, r * (1.4 + (1 - pulse) * 1.8), 0, Math.PI * 2)
              fx.strokeStyle = '#ffffff'
              fx.lineWidth = 2.5
              fx.globalAlpha = pulse * 0.9
              fx.stroke()
              fx.globalAlpha = 1
            }
          }

          // 拼接中的球对：中点生成桥接球，形成融球效果
          for (const key of Object.keys(mg)) {
            const m = mg[key]
            const a = sp.find((s) => s.id === m.aId)
            const b = sp.find((s) => s.id === m.bId)
            if (!a || !b) continue
            const ax = a.x * v.k + v.x
            const ay = a.y * v.k + v.y
            const bx = b.x * v.k + v.x
            const by = b.y * v.k + v.y
            const mx = (ax + bx) / 2
            const my = (ay + by) / 2
            const d = Math.hypot(ax - bx, ay - by)
            // 桥接球大到盖住两球接缝并溢出球面边缘，融球轮廓才能透出 HTML 球面被看见
            const minR = Math.min(a.r, b.r) * v.k
            const br = Math.max(d / 2, minR) + minR * (0.3 + m.intensity * 0.5)
            ctx.beginPath()
            ctx.arc(mx, my, br, 0, Math.PI * 2)
            ctx.fillStyle = '#c9d1dd'
            ctx.globalAlpha = 0.95
            ctx.fill()
            ctx.globalAlpha = 1
            // 减少动态效果时：用静态光环标示拼接关系，替代震动与脉冲
            if (reduceMotion) {
              fx.beginPath()
              fx.arc(mx, my, br + 14, 0, Math.PI * 2)
              fx.strokeStyle = '#ffffff'
              fx.lineWidth = 2
              fx.globalAlpha = 0.5
              fx.stroke()
              fx.globalAlpha = 1
            }
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
    try {
      containerRef.current?.setPointerCapture(e.pointerId)
    } catch {
      /* 合成事件无活动指针，忽略 */
    }
    const s = spheres.find((x) => x.id === id)
    if (!s) return
    const p = localPoint(e)
    const w = toWorld(p.x, p.y, viewRef.current)
    dragRef.current = { id, dx: w.x - s.x, dy: w.y - s.y }
    tapRef.current = { id: s.id, t: Date.now(), x: e.clientX, y: e.clientY, moved: false }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-sphere]')) return
    const p = localPoint(e)
    pointersRef.current.set(e.pointerId, p)
    try {
      containerRef.current?.setPointerCapture(e.pointerId)
    } catch {
      /* 合成事件无活动指针，忽略 */
    }
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
      const tap = tapRef.current
      if (tap && tap.id === dragRef.current.id && !tap.moved && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 6) {
        tap.moved = true
      }
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
    // 双击判定（真实 dblclick 被 pointer capture 截走，这里手动识别）
    const tap = tapRef.current
    if (tap && !tap.moved) {
      const now = Date.now()
      const last = lastTapRef.current
      if (last && last.id === tap.id && now - last.t < 450) {
        onInspect(tap.id)
        lastTapRef.current = null
      } else {
        lastTapRef.current = { id: tap.id, t: now }
      }
    }
    tapRef.current = null
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

  /** 每颗球的震动强度 = 它参与的拼接对中的最大 intensity */
  const shakeById = new Map<string, number>()
  for (const key of Object.keys(merged)) {
    const m = merged[key]
    shakeById.set(m.aId, Math.max(shakeById.get(m.aId) ?? 0, m.intensity))
    shakeById.set(m.bId, Math.max(shakeById.get(m.bId) ?? 0, m.intensity))
  }

  return (
    <div
      ref={containerRef}
      className="relative min-w-0 flex-1 touch-none overflow-hidden bg-black"
      style={{
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(148,163,184,0.14) 1px, transparent 0)',
        backgroundSize: '28px 28px',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const files = Array.from(e.dataTransfer.files).slice(0, 3)
        files.forEach((f, i) => window.setTimeout(() => onAttachFile(f), i * 1600))
      }}
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
      <canvas ref={fxCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {spheres.map((s) => (
        <SphereNode
          key={s.id}
          sphere={s}
          view={view}
          shake={shakeById.get(s.id) ?? 0}
          reduceMotion={reduceMotion}
          onPointerDown={onSpherePointerDown}
          onInspect={onInspect}
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

      {/* 文件拖放遮罩 */}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-white/40 px-10 py-8 text-center">
            <p className="text-lg font-bold text-white">松开，把文件丢给 AI</p>
            <p className="mt-1.5 text-xs text-slate-400">支持 PDF · DOCX · 图片 · 文本 / 代码文件</p>
          </div>
        </div>
      )}

      {enginePaused && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/15 bg-black/70 px-4 py-1.5 text-xs text-slate-300 backdrop-blur">
          讨论已暂停 · 插话仍可触发回应
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/10 bg-black/70 px-4 py-1.5 text-xs text-slate-500 backdrop-blur">
        拖文件进画布，AI 立刻阅读讨论 · 拖动空白平移 · 滚轮 / 双指缩放 · 双击球看内含 · 两球相碰有惊喜
      </div>
    </div>
  )
}
