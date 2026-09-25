import type { RelationBubble } from '@/shared/types'
import { RELATION_LABEL } from '@/ai/mockData'

const TONE: Record<RelationBubble['type'], { bg: string; fg: string }> = {
  supports: { bg: 'rgba(74,222,128,0.18)', fg: '#4ade80' },
  contradicts: { bg: 'rgba(248,113,113,0.18)', fg: '#f87171' },
  causes: { bg: 'rgba(56,189,248,0.18)', fg: '#38bdf8' },
  analogy: { bg: 'rgba(192,132,252,0.18)', fg: '#c084fc' },
}

interface Props {
  bubble: RelationBubble
  sx: number
  sy: number
  authorName: string
  authorColor: string
}

/** 两个关键球拼接时，AI 对关系进行口播解读的气泡 */
export function BubbleCard({ bubble, sx, sy, authorName, authorColor }: Props) {
  const tone = TONE[bubble.type]
  return (
    <div className="pointer-events-none absolute z-20" style={{ left: sx, top: sy, transform: 'translate(-50%, -100%)' }}>
      <div className="w-72 rounded-xl border border-white/15 bg-slate-900/92 p-3 shadow-2xl backdrop-blur-md">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: tone.bg, color: tone.fg }}>
            {RELATION_LABEL[bubble.type]}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="h-2 w-2 rounded-full" style={{ background: authorColor }} />
            {authorName} 解读了两球关系
          </span>
        </div>
        <p className="text-[13px] leading-relaxed text-slate-100">{bubble.text}</p>
      </div>
      <div className="mx-auto mt-[-1px] h-2.5 w-2.5 rotate-45 border-r border-b border-white/15 bg-slate-900/92" />
    </div>
  )
}
