import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Orbit } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { CanvasBoard } from '@/components/CanvasBoard'
import { DiscussionPanel } from '@/components/DiscussionPanel'
import { useDiscussion } from '@/hooks/useDiscussion'
import { getProject } from '@/shared/storage'

export default function Room() {
  const { id = '' } = useParams()
  const { mode, roles, messages, spheres, bubbles, merged, sendHuman, approveRole, moveSphere } = useDiscussion(id)
  const [reduceMotion, setReduceMotion] = useState(false)
  const project = getProject(id)

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-black text-slate-100">
      <header className="flex h-13 shrink-0 items-center justify-between border-b border-white/10 bg-black/80 px-4 py-2 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link to="/" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-slate-400 transition-colors hover:border-white/25 hover:text-slate-200" title="返回主页">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Orbit className="h-5 w-5 shrink-0 text-slate-300" />
          <div className="min-w-0">
            <h1 className="truncate text-sm leading-tight font-bold tracking-wide">
              {project?.name ?? '讨论房间'}
              <span className="ml-2 font-normal text-slate-500">{project?.topic}</span>
            </h1>
            <p className="text-[11px] leading-tight text-slate-500">
              {mode === 'live' ? 'Kimi 实时模式' : '演示模式（配置 VITE_MOONSHOT_API_KEY 接入真模型）'}
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
