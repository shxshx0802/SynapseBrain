import { X } from 'lucide-react'
import type { ChatMessage, KeySphereT } from '@/shared/types'
import { HUMAN_ID } from '@/ai/mockData'

interface Props {
  sphere: KeySphereT
  authorName: string
  authorColor: string
  /** 该作者方向最近的谈话内容 */
  thread: ChatMessage[]
  onClose: () => void
}

/** 双击球：查看这颗关键球凝结自哪段讨论 + 该方向的谈话内容 */
export function SphereDetail({ sphere, authorName, authorColor, thread, onClose }: Props) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="ks-fade-up mx-4 w-full max-w-md rounded-2xl border border-white/12 bg-black/90 shadow-[0_0_60px_rgba(255,255,255,0.08)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-white/8 p-4">
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold text-slate-950"
            style={{ background: 'radial-gradient(circle at 32% 28%, #ffffff, #b9c0ca 46%, #6d7581 100%)', boxShadow: '0 0 20px rgba(255,255,255,0.35)' }}
          >
            {sphere.label.slice(0, 2)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-white">{sphere.label}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className="h-2 w-2 rounded-full" style={{ background: authorColor }} />
              由 {authorName} 凝结于 {new Date(sphere.bornAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <button className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-200" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[50vh] space-y-4 overflow-y-auto p-4">
          <section>
            <p className="mb-1.5 text-[10px] font-semibold tracking-[0.15em] text-slate-600 uppercase">球的内含 · 凝结来源</p>
            <p className="rounded-xl border border-white/8 bg-white/[0.03] p-3 text-[13px] leading-relaxed text-slate-200">
              {sphere.content ?? '（这颗球创建于早期版本，没有记录来源内容。）'}
            </p>
          </section>

          <section>
            <p className="mb-1.5 text-[10px] font-semibold tracking-[0.15em] text-slate-600 uppercase">{authorName} 方向的谈话</p>
            {thread.length === 0 ? (
              <p className="text-xs text-slate-600">该方向还没有更多发言。</p>
            ) : (
              <div className="space-y-2">
                {thread.map((m) => (
                  <div key={m.id} className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2">
                    <p className="mb-0.5 text-[10px] text-slate-600">
                      {m.roleId === HUMAN_ID ? '人类参与者' : authorName} · {new Date(m.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p className="text-[12px] leading-relaxed text-slate-300">{m.text}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
