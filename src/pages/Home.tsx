import { useState } from 'react'
import { Orbit } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { CanvasBoard } from '@/components/CanvasBoard'
import { DiscussionPanel } from '@/components/DiscussionPanel'
import { useDiscussion } from '@/hooks/useDiscussion'

export default function Home() {
  const { mode, roles, messages, spheres, bubbles, merged, sendHuman, approveRole, moveSphere } = useDiscussion()
  const [reduceMotion, setReduceMotion] = useState(false)

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex h-13 shrink-0 items-center justify-between border-b border-white/10 bg-slate-900/70 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <Orbit className="h-5 w-5 text-sky-400" />
          <div>
            <h1 className="text-sm leading-tight font-bold tracking-wide">KeySphere</h1>
            <p className="text-[11px] leading-tight text-slate-500">
              多人 × 多 AI 协同讨论工作台 · {mode === 'live' ? 'Kimi 实时模式' : '演示模式（配置 VITE_MOONSHOT_API_KEY 接入真模型）'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="mr-1 text-[11px] text-slate-500">{roles.filter((r) => !r.paused).length + 1} 位参与者在线</span>
          <Label htmlFor="reduce-motion" className="text-xs text-slate-400">
            减少动态效果
          </Label>
          <Switch id="reduce-motion" checked={reduceMotion} onCheckedChange={setReduceMotion} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <DiscussionPanel roles={roles} messages={messages} onApprove={approveRole} onSend={sendHuman} />
        <CanvasBoard
          spheres={spheres}
          bubbles={bubbles}
          merged={merged}
          roles={roles}
          reduceMotion={reduceMotion}
          onMoveSphere={moveSphere}
        />
      </div>
    </div>
  )
}
