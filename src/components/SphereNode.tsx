import type { CSSProperties } from 'react'
import type { KeySphereT } from '@/shared/types'

interface Props {
  sphere: KeySphereT
  view: { x: number; y: number; k: number }
  /** 拼接震动强度 0~1（0 = 未拼接），幅度随深度缩放 */
  shake: number
  reduceMotion: boolean
  onPointerDown: (e: React.PointerEvent, id: string) => void
  onInspect: (id: string) => void
}

export function SphereNode({ sphere: s, view: v, shake, reduceMotion, onPointerDown, onInspect }: Props) {
  // 按实际像素尺寸渲染，不用 CSS scale 硬缩放——任意缩放级别下球体和文字都保持锐利
  const r = s.r * v.k
  const sx = s.x * v.k + v.x
  const sy = s.y * v.k + v.y
  // 轻微震动：幅度随拼接深度缩放，最大约 2px，刚接触时几乎无感
  const shakeAmp = shake > 0 && !reduceMotion ? 0.5 + shake * 1.5 : 0
  return (
    <div
      data-sphere="true"
      data-sid={s.id}
      onPointerDown={(e) => onPointerDown(e, s.id)}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onInspect(s.id)
      }}
      className="absolute left-0 top-0 flex cursor-grab items-center justify-center rounded-full select-none will-change-transform active:cursor-grabbing"
      style={{
        width: r * 2,
        height: r * 2,
        transform: `translate(${sx - r}px, ${sy - r}px)`,
        fontSize: Math.max(9, 13 * v.k * (s.r / 72)),
        background: 'radial-gradient(circle at 32% 28%, #ffffff, #b9c0ca 46%, #6d7581 100%)',
        boxShadow: `0 0 ${Math.max(10, 26 * v.k)}px rgba(255,255,255,0.35), inset 0 0 ${Math.max(8, 20 * v.k)}px rgba(255,255,255,0.45)`,
        ...(shakeAmp > 0 ? ({ '--shake-amp': `${shakeAmp.toFixed(2)}px`, animation: 'ks-shake 0.42s linear infinite' } as CSSProperties) : {}),
        touchAction: 'none',
      }}
    >
      <span className="px-[0.8em] text-center leading-tight font-bold text-slate-900 drop-shadow-sm">{s.label}</span>
    </div>
  )
}
