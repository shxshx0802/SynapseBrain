import { useEffect, useMemo, useRef, useState } from 'react'
import { SendHorizontal, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import type { AIRole, ChatMessage } from '@/shared/types'
import { HUMAN_ID } from '@/ai/mockData'

interface Props {
  roles: AIRole[]
  messages: Record<string, ChatMessage[]>
  onApprove: (roleId: string) => void
  onSend: (text: string) => void
  /** 主持人 / 调度官的最新动态 */
  digest?: string | null
  /** 协作者只读模式：隐藏插话输入与额度放行，只保留观看 */
  guest?: boolean
}

function RoleAvatar({ color, name, size = 22 }: { color: string; name: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-slate-950"
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 32% 30%, rgba(255,255,255,0.95), ${color} 65%)`,
        boxShadow: `0 0 10px ${color}55`,
      }}
    >
      {name.slice(0, 1)}
    </span>
  )
}

function ThinkingDots() {
  return (
    <span className="ks-thinking py-0.5">
      <span />
      <span />
      <span />
    </span>
  )
}

export function DiscussionPanel({ roles, messages, onApprove, onSend, digest, guest = false }: Props) {
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const stream = useMemo(
    () =>
      Object.values(messages)
        .flat()
        .sort((a, b) => a.at - b.at),
    [messages],
  )

  // 新消息自动滚到底部
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [stream.length])

  const submit = () => {
    onSend(draft)
    setDraft('')
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-white/8 bg-white/[0.02]">
      {/* AI 角色与额度 */}
      <div className="space-y-2 border-b border-white/8 p-3">
        <p className="px-1 text-[10px] font-semibold tracking-[0.15em] text-slate-600 uppercase">参与者 · 额度</p>
        {roles.map((r) => {
          const remaining = Math.max(0, 1 - r.used / r.budget)
          const status = r.paused ? 'paused' : r.downshifted ? 'downshifted' : 'ok'
          return (
            <div
              key={r.id}
              className="rounded-xl border border-white/8 bg-black/50 p-2.5 transition-colors hover:border-white/15"
            >
              <div className="flex items-center gap-2">
                <RoleAvatar color={r.color} name={r.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-slate-100">{r.name}</p>
                  <p className="truncate text-[10px] text-slate-500">{r.persona}</p>
                </div>
                {status === 'ok' && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400/80" />}
                {status === 'downshifted' && <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
                {status === 'paused' && <ShieldOff className="h-3.5 w-3.5 shrink-0 text-red-400" />}
              </div>
              <Progress
                value={remaining * 100}
                className="quota-bar mt-2 h-1"
                style={{ ['--quota-color' as string]: status === 'paused' ? '#f87171' : status === 'downshifted' ? '#fbbf24' : r.color }}
              />
              <div className="mt-1.5 flex items-center justify-between text-[10px]">
                <span className="tabular-nums text-slate-600">
                  剩 {Math.round(remaining * 100)}% · {(r.budget - r.used).toLocaleString()} tok
                </span>
                {status === 'downshifted' && <span className="text-amber-400/90">已降档</span>}
                {status === 'paused' && !guest && (
                  <button className="cursor-pointer font-semibold text-red-400 hover:text-red-300" onClick={() => onApprove(r.id)}>
                    待批准 · 放行 50%
                  </button>
                )}
                {status === 'paused' && guest && <span className="text-red-400/80">已暂停</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* 全员讨论流 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3.5 p-3">
          {digest && (
            <div className="rounded-lg border border-amber-200/20 bg-amber-100/[0.06] px-2.5 py-2">
              <p className="text-[11px] leading-relaxed text-amber-100/90">{digest}</p>
            </div>
          )}
          {stream.map((m) => {
            const role = m.roleId === HUMAN_ID ? null : roles.find((r) => r.id === m.roleId)
            const name = role?.name ?? '你'
            const color = role?.color ?? '#a78bfa'
            const isThinking = m.text === '…'
            return (
              <div key={m.id} className="ks-fade-up flex items-start gap-2">
                <RoleAvatar color={color} name={name} size={20} />
                <div className="min-w-0 flex-1">
                  <p className="mb-1 flex items-baseline gap-1.5 text-[11px]">
                    <span className="font-semibold" style={{ color }}>
                      {name}
                    </span>
                    <span className="text-[10px] text-slate-600">{m.roleId === HUMAN_ID ? '人类' : role?.persona.split(' · ')[1] ?? ''}</span>
                  </p>
                  <div className="rounded-lg rounded-tl-sm border border-white/8 bg-black/50 px-2.5 py-1.5 transition-colors hover:border-white/15">
                    {isThinking ? (
                      <ThinkingDots />
                    ) : (
                      <p className="text-[13px] leading-relaxed text-slate-200">{m.text}</p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 人类发言输入（协作者模式隐藏：插话权限归房主） */}
      {guest ? (
        <div className="border-t border-white/8 p-3">
          <p className="rounded-lg border border-white/8 bg-black/50 px-3 py-2 text-center text-[11px] text-slate-500">
            协作者模式 · 可以拖文件到画布参与讨论，操控权在房主
          </p>
        </div>
      ) : (
        <div className="border-t border-white/8 p-3">
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/60 p-1.5 transition-colors focus-within:border-white/25">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="插话，让所有方向听到…"
              className="h-8 border-0 bg-transparent px-2 text-[13px] shadow-none focus-visible:ring-0"
            />
            <Button size="icon" className="h-8 w-8 shrink-0 rounded-lg" onClick={submit} disabled={!draft.trim()}>
              <SendHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </aside>
  )
}
