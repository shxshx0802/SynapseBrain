import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, FileDown, Gauge, History, LayoutGrid, Orbit, Pause, Play, Sparkles, X } from 'lucide-react'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
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
  const {
    mode, roles, messages, spheres, bubbles, merged, enginePaused, toggleEngine, sendHuman, attachDocument,
    approveRole, moveSphere, resizeSphere, layoutSpheres,
    quotaHistory, timeline, conclusions, digest, converge, reportMarkdown, governorOn, toggleGovernor,
  } = useDiscussion(id)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [inspectId, setInspectId] = useState<string | null>(null)
  const [fitRequest, setFitRequest] = useState<{ halfW: number; halfH: number; nonce: number } | null>(null)
  const [zoomRequest, setZoomRequest] = useState<{ dir: 'in' | 'out'; nonce: number } | null>(null)
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 })
  const [showQuota, setShowQuota] = useState(false)
  const [showConclusions, setShowConclusions] = useState(false)
  const [replayIdx, setReplayIdx] = useState<number | null>(null)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const project = getProject(id)

  const handleLayout = () => {
    const bounds = layoutSpheres()
    if (bounds) setFitRequest({ ...bounds, nonce: Date.now() })
  }

  const handleGestureZoom = (dir: 'in' | 'out') => setZoomRequest({ dir, nonce: Date.now() })

  const pulseZoom = (dir: 'in' | 'out') => {
    for (let i = 0; i < 3; i++) window.setTimeout(() => setZoomRequest({ dir, nonce: Date.now() + i }), i * 230)
  }

  const doConverge = () => {
    converge()
    setShowConclusions(true)
  }

  const exportReport = () => {
    const md = reportMarkdown()
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project?.name ?? '讨论报告'}-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const toggleReplay = () => {
    if (replayIdx == null) {
      if (!timeline.length) return
      setReplayIdx(0)
      setReplayPlaying(true)
    } else {
      setReplayIdx(null)
      setReplayPlaying(false)
    }
  }

  // 回放自动推进
  useEffect(() => {
    if (!replayPlaying || replayIdx == null || !timeline.length) return
    if (replayIdx >= timeline.length - 1) {
      setReplayPlaying(false)
      return
    }
    const iv = window.setInterval(() => {
      setReplayIdx((i) => Math.min((i ?? 0) + 1, timeline.length - 1))
    }, 900)
    return () => window.clearInterval(iv)
  }, [replayPlaying, replayIdx, timeline.length])

  const handleVoiceControl = (action: string) => {
    switch (action) {
      case 'pause':
        if (!enginePaused) toggleEngine()
        break
      case 'resume':
        if (enginePaused) toggleEngine()
        break
      case 'layout':
        handleLayout()
        break
      case 'converge':
        doConverge()
        break
      case 'zoom-in':
        pulseZoom('in')
        break
      case 'zoom-out':
        pulseZoom('out')
        break
      case 'export':
        exportReport()
        break
      case 'replay':
        toggleReplay()
        break
    }
  }

  const inspectSphere = inspectId ? spheres.find((s) => s.id === inspectId) ?? null : null
  const inspectRole = inspectSphere ? roles.find((r) => r.id === inspectSphere.authorId) ?? null : null
  const inspectThread = inspectSphere
    ? (messages[inspectSphere.authorId] ?? []).filter((m) => m.text !== '…').slice(-8)
    : []

  const replayEntry = replayIdx != null ? timeline[replayIdx] ?? null : null
  const quotaChartData = quotaHistory.map((p) => ({ t: new Date(p.t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), ...p.used }))

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
            onClick={doConverge}
            title="把相近的关键球聚合成结论卡片"
          >
            <Sparkles className="h-3.5 w-3.5" />
            收敛
          </Button>
          <Button
            size="sm"
            variant={replayIdx != null ? 'default' : 'outline'}
            className="h-8 gap-1.5 rounded-lg border-white/15 bg-black/50 text-xs hover:bg-white/10"
            onClick={toggleReplay}
            title="时间轴回放讨论过程"
          >
            <History className="h-3.5 w-3.5" />
            回放
          </Button>
          <Button
            size="sm"
            variant={showQuota ? 'default' : 'outline'}
            className="h-8 gap-1.5 rounded-lg border-white/15 bg-black/50 text-xs hover:bg-white/10"
            onClick={() => setShowQuota((v) => !v)}
            title="各方向额度消耗曲线"
          >
            <Gauge className="h-3.5 w-3.5" />
            额度
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 rounded-lg border-white/15 bg-black/50 text-xs hover:bg-white/10"
            onClick={exportReport}
            title="导出 Markdown 讨论报告"
          >
            <FileDown className="h-3.5 w-3.5" />
            导出
          </Button>
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
        <DiscussionPanel roles={roles} messages={messages} onApprove={approveRole} onSend={sendHuman} digest={digest} />
        <div className="relative flex min-w-0 flex-1">
          <CanvasBoard
            spheres={replayEntry ? replayEntry.spheres : spheres}
            bubbles={replayEntry ? [] : bubbles}
            merged={replayEntry ? replayEntry.merged : merged}
            roles={roles}
            reduceMotion={reduceMotion}
            enginePaused={enginePaused}
            fitRequest={fitRequest}
            zoomRequest={zoomRequest}
            tilt={tilt}
            onMoveSphere={moveSphere}
            onResizeSphere={resizeSphere}
            onAttachFile={attachDocument}
            onInspect={setInspectId}
          />

          {/* 回放：遮罩吞掉指针事件，画布显示历史快照 */}
          {replayEntry && (
            <div
              className="absolute inset-0 z-20 flex items-end justify-center pb-6"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="flex w-[min(640px,90%)] items-center gap-3 rounded-xl border border-white/15 bg-black/85 px-4 py-3 backdrop-blur">
                <Button size="icon" className="h-8 w-8 shrink-0" onClick={() => setReplayPlaying((v) => !v)}>
                  {replayPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, timeline.length - 1)}
                  value={replayIdx ?? 0}
                  onChange={(e) => {
                    setReplayIdx(Number(e.target.value))
                    setReplayPlaying(false)
                  }}
                  className="min-w-0 flex-1 accent-white"
                />
                <span className="shrink-0 text-[11px] text-slate-400">
                  {replayIdx != null ? replayIdx + 1 : 0}/{timeline.length}
                </span>
                <button className="shrink-0 text-slate-500 hover:text-slate-300" onClick={toggleReplay}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
          {replayEntry && (
            <div className="pointer-events-none absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/15 bg-black/70 px-4 py-1.5 text-xs text-slate-300 backdrop-blur">
              {new Date(replayEntry.t).toLocaleTimeString('zh-CN')} · {replayEntry.text}
            </div>
          )}

          {/* 额度仪表盘 */}
          {showQuota && (
            <div className="absolute top-3 right-3 z-30 w-80 rounded-xl border border-white/15 bg-black/85 p-3 backdrop-blur">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">额度消耗曲线</span>
                <div className="flex items-center gap-2">
                  <Label htmlFor="governor" className="text-[10px] text-slate-400">
                    AI 调度
                  </Label>
                  <Switch id="governor" checked={governorOn} onCheckedChange={toggleGovernor} />
                  <button className="text-slate-500 hover:text-slate-300" onClick={() => setShowQuota(false)}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={quotaChartData} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                    <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.15)', fontSize: 11 }}
                      labelStyle={{ color: '#94a3b8' }}
                    />
                    {roles.map((r) => (
                      <Line key={r.id} type="monotone" dataKey={r.id} name={r.name} stroke={r.color} dot={false} strokeWidth={1.5} isAnimationActive={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* 结论卡片 */}
          {showConclusions && conclusions.length > 0 && (
            <div className="absolute top-1/2 left-1/2 z-30 w-[min(420px,90%)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/15 bg-black/90 p-4 shadow-2xl backdrop-blur">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-bold text-white">讨论结论（{conclusions.length} 条）</span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportReport}>
                    <FileDown className="mr-1 h-3 w-3" /> 导出报告
                  </Button>
                  <button className="text-slate-500 hover:text-slate-300" onClick={() => setShowConclusions(false)}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="space-y-2.5">
                {conclusions.map((c, i) => (
                  <div key={c.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                    <p className="text-[13px] font-semibold text-white">
                      {i + 1}. {c.title}
                    </p>
                    {c.points.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {c.points.map((p, j) => (
                          <li key={j} className="text-xs leading-relaxed text-slate-400">
                            · {p}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
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
            onVoiceControl={handleVoiceControl}
            onTilt={(rx, ry) => setTilt({ rx, ry })}
            detailOpen={!!inspectSphere}
            onCloseDetail={() => setInspectId(null)}
          />
        </div>
      </div>
    </div>
  )
}
