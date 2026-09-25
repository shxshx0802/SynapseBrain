import type { KeySphereT } from '@/shared/types'

interface Props {
  sphere: KeySphereT
  view: { x: number; y: number; k: number }
  shaking: boolean
  reduceMotion: boolean
  onPointerDown: (e: React.PointerEvent, id: string) => void
}

export function SphereNode({ sphere: s, view: v, shaking, reduceMotion, onPointerDown }: Props) {
  const sx = s.x * v.k + v.x
  const sy = s.y * v.k + v.y
  return (
    <div
      data-sphere="true"
      onPointerDown={(e) => onPointerDown(e, s.id)}
      className="absolute left-0 top-0 flex cursor-grab items-center justify-center rounded-full select-none active:cursor-grabbing"
      style={{
        width: s.r * 2,
        height: s.r * 2,
        transform: `translate(${sx}px, ${sy}px) scale(${v.k}) translate(${-s.r}px, ${-s.r}px)`,
        background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.9), ${s.color} 46%, ${s.color} 100%)`,
        boxShadow: `0 0 32px ${s.color}59, inset 0 0 26px rgba(255,255,255,0.22)`,
        animation: shaking && !reduceMotion ? 'ks-shake 0.12s linear infinite' : undefined,
        touchAction: 'none',
      }}
    >
      <span className="px-3 text-center text-sm leading-tight font-bold text-slate-950/90 drop-shadow-sm">
        {s.label}
      </span>
    </div>
  )
}
