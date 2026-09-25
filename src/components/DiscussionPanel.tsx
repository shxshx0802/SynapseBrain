import { useMemo, useState } from 'react'
import { SendHorizontal, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { AIRole, ChatMessage } from '@/shared/types'
import { HUMAN_ID } from '@/ai/mockData'

interface Props {
  roles: AIRole[]
  messages: Record<string, ChatMessage[]>
  onApprove: (roleId: string) => void
  onSend: (text: string) => void
}

function RoleAvatar({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <span
      className="shrink-0 rounded-full"
      style={{ width: size, height: size, background: `radial-gradient(circle at 32% 30%, rgba(255,255,255,0.9), ${color} 60%)`, boxShadow: `0 0 8px ${color}66` }}
    />
  )
}

export function DiscussionPanel({ roles, messages, onApprove, onSend }: Props) {
  const [draft, setDraft] = useState('')

  const stream = useMemo(
    () =>
      Object.values(messages)
        .flat()
        .sort((a, b) => a.at - b.at),
    [messages],
  )

  const submit = () => {
    onSend(draft)
    setDraft('')
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-white/10 bg-slate-900/60">
      {/* AI 角色与额度 */}
      <div className="space-y-2.5 border-b border-white/10 p-3">
        <p className="px-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">参与者 · 额度管家</p>
        {roles.map((r) => {
          const remaining = Math.max(0, 1 - r.used / r.budget)
          const status = r.paused ? 'paused' : r.downshifted ? 'downshifted' : 'ok'
          return (
            <div key={r.id} className="rounded-lg border border-white/8 bg-slate-950/60 p-2.5">
              <div className="flex items-center gap-2">
                <RoleAvatar color={r.color} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-slate-100">
                    {r.name}
                    <span className="ml-1.5 text-[11px] font-normal text-slate-500">{r.persona}</span>
                  </p>
                </div>
                {status === 'ok' && <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />}
                {status === 'downshifted' && <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" />}
                {status === 'paused' && <ShieldOff className="h-4 w-4 shrink-0 text-red-400" />}
              </div>
              <Progress
                value={remaining * 100}
                className="quota-bar mt-2 h-1.5"
                style={{ ['--quota-color' as string]: status === 'paused' ? '#f87171' : status === 'downshifted' ? '#fbbf24' : r.color }}
              />
              <div className="mt-1.5 flex items-center justify-between text-[11px]">
                <span className="text-slate-500">
                  剩余 {Math.round(remaining * 100)}% · {(r.budget - r.used).toLocaleString()} tokens
                </span>
                {status === 'downshifted' && <span className="text-amber-400">已降档运行</span>}
                {status === 'paused' && (
                  <button className="cursor-pointer font-semibold text-red-400 hover:text-red-300" onClick={() => onApprove(r.id)}>
                    待批准 · 点击放行 50%
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 全员讨论流 */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {stream.map((m) => {
            const role = m.roleId === HUMAN_ID ? null : roles.find((r) => r.id === m.roleId)
            const name = role?.name ?? '你'
            const color = role?.color ?? '#a78bfa'
            return (
              <div key={m.id} className="flex items-start gap-2">
                <RoleAvatar color={color} size={18} />
                <div className="min-w-0">
                  <p className="text-[11px] text-slate-500">
                    <span className="font-semibold" style={{ color }}>{name}</span>
                    <span className="ml-1.5">{m.roleId === HUMAN_ID ? '人类参与者' : role?.persona}</span>
                  </p>
                  <p className="mt-0.5 rounded-md rounded-tl-none border border-white/8 bg-slate-950/60 px-2 py-1.5 text-[13px] leading-relaxed text-slate-200">
                    {m.text}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </ScrollArea>

      {/* 人类发言输入 */}
      <div className="flex items-center gap-2 border-t border-white/10 p-3">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="插话，让所有方向听到…"
          className="h-9 border-white/10 bg-slate-950/60 text-[13px]"
        />
        <Button size="icon" className="h-9 w-9 shrink-0" onClick={submit} disabled={!draft.trim()}>
          <SendHorizontal className="h-4 w-4" />
        </Button>
      </div>
    </aside>
  )
}
