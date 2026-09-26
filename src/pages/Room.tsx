import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, LayoutGrid, Orbit, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { CanvasBoard } from '@/components/CanvasBoard'
import { DiscussionPanel } from '@/components/DiscussionPanel'
import { GestureVoiceDock } from '@/components/GestureVoiceDock'
import { SphereDetail } from '@/components/SphereDetail'
import { useDiscussion } from '@/hooks/useDiscussion'
import { getProject } from '@/shared/storage'

export default function Room() {
  const { id = '' } = useParams()
  const { mode, roles, messages, spheres, bubbles, merged, enginePaused, toggleEngine, sendHuman, attachDocument, approveRole, moveSphere, resizeSphere, layoutSpheres } = useDiscussion(id)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [inspectId, setInspectId] = useState<string | null>(null)
  const [fitRequest, setFitRequest] = useState<{ halfW: number; halfH: number; nonce: number } | null>(null)
  const [zoomRequest, setZoomRequest] = useState<{ dir: 'in' | 'out'; nonce: number } | null>(null)
  const project = getProject(id)

  const handleLayout = () => {
    const bounds = layoutSpheres()
    if (bounds) setFitRequest({ ...bounds, nonce: Date.now() })
  }

  const handleGestureZoom = (dir: 'in' | 'out') => setZoomRequest({ dir, nonce: Date.now() })

  const inspectSphere = inspectId ? spheres.find((s) => s.id === inspectId) ?? null : null
  const inspectRole = inspectSphere ? roles.find((r) => r.id === inspectSphere.authorId) ?? null : null
  const inspectThread = inspectSphere
    ? (messages[inspectSphere.authorId] ?? []).filter((m) => m.text !== '…').slice(-8)
    : []

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-black text-slate-100">
      <header className="flex h-13 shrink-0 items-center justify-between border-b border-white/10 bg-black/80 px-4 py-2 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link to="/" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-slate-400 transition-colors hover:border-white/25 hover:text-slate-200" title="返回主页">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Orbit className="h-5 w-5 shrink-0 text-slate-300" />
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-sm leading-tight font-bold tracking-wide">
              <span className="truncate">{project?.name ?? '讨论房间'}</span>
              {project?.topic && (
                <span className="shrink-0 rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[11px] font-normal text-slate-300">
                  议题 · {project.topic}
                </span>
              )}
            </h1>
            <p className="mt-0.5 text-[11px] leading-tight text-slate-500">
              {mode === 'live' ? 'Kimi 实时模式' : '演示模式（配置 VITE_MOONSHOT_API_KEY 接入真模型）'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="mr-1 text-[11px] text-slate-500">{roles.filter((r) => !r.paused).length + 1} 位参与者在线</span>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 rounded-lg border-white/15 bg-black/50 text-xs hover:bg-white/10"
            onClick={handleLayout}
            title="按拼接关系自动整理球簇布局"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            整理布局
          </Button>
          <Button
            size="sm"
            variant={enginePaused ? 'default' : 'outline'}
            className="h-8 gap-1.5 rounded-lg border-white/15 bg-black/50 text-xs hover:bg-white/10"
            onClick={toggleEngine}
            title={enginePaused ? '继续讨论' : '暂停讨论'}
          >
            {enginePaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {enginePaused ? '继续讨论' : '暂停'}
          </Button>
          <Label htmlFor="reduce-motion" className="text-xs text-slate-400">
            减少动态效果
          </Label>
          <Switch id="reduce-motion" checked={reduceMotion} onCheckedChange={setReduceMotion} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <DiscussionPanel roles={roles} messages={messages} onApprove={approveRole} onSend={sendHuman} />
        <div className="relative flex min-w-0 flex-1">
          <CanvasBoard
            spheres={spheres}
            bubbles={bubbles}
            merged={merged}
            roles={roles}
            reduceMotion={reduceMotion}
            enginePaused={enginePaused}
            fitRequest={fitRequest}
            zoomRequest={zoomRequest}
            onMoveSphere={moveSphere}
            onResizeSphere={resizeSphere}
            onAttachFile={attachDocument}
            onInspect={setInspectId}
          />
          {inspectSphere && (
            <SphereDetail
              sphere={inspectSphere}
              authorName={inspectRole?.name ?? 'AI'}
              authorColor={inspectRole?.color ?? '#e2e8f0'}
              thread={inspectThread}
              onClose={() => setInspectId(null)}
            />
          )}
          <GestureVoiceDock
            onZoom={handleGestureZoom}
            onVoiceCommand={sendHuman}
            detailOpen={!!inspectSphere}
            onCloseDetail={() => setInspectId(null)}
          />
        </div>
      </div>
    </div>
  )
}
