import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeft, FileDown, Gauge, History, LayoutGrid, Orbit, Pause, Play, Plug, Share2, Sparkles, Users, X, Zap } from 'lucide-react'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CanvasBoard } from '@/components/CanvasBoard'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { DiscussionPanel } from '@/components/DiscussionPanel'
import { GestureVoiceDock } from '@/components/GestureVoiceDock'
import { SphereDetail } from '@/components/SphereDetail'
import { ApiKeyDialog } from '@/components/ApiKeyDialog'
import { useDiscussion } from '@/hooks/useDiscussion'
import { getProject } from '@/shared/storage'
import { connectCollab, type CollabHandle } from '@/shared/collab'
import GuestRoom from './GuestRoom'

/** 房间入口：有 ?join=1 参数且本机不是项目创建者 → 协作者只读房间；否则房主房间 */
export default function RoomGate() {
  const { id = '' } = useParams()
  const [searchParams] = useSearchParams()
  const isGuest = searchParams.has('join') && !getProject(id)
  return isGuest ? <GuestRoom /> : <HostRoom />
}

function HostRoom() {
  const { id = '' } = useParams()
  const {
    mode, roles, messages, spheres, bubbles, merged, enginePaused, toggleEngine, sendHuman, attachDocument, ingestDocument,
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
  const [fatal, setFatal] = useState<string | null>(null)
  const [lastCrash, setLastCrash] = useState<string | null>(null)
  const [apiDialogOpen, setApiDialogOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [guestCount, setGuestCount] = useState(0)
  const [collabMsg, setCollabMsg] = useState('')
  const [copied, setCopied] = useState(false)
  const collabRef = useRef<CollabHandle | null>(null)
  const project = getProject(id)

  /** 协作通道（房主侧）：广播房间快照给协作者，接收协作者拖入的文件交给引擎 */
  useEffect(() => {
    if (!id) return
    const handle = connectCollab({
      roomId: id,
      asHost: true,
      onFile: (doc) => ingestDocument(doc, true),
      onGuestCount: (n) => {
        setGuestCount(n)
        // 有协作者（刚）上线/掉线 → 立刻推一份最新快照，让新加入者马上看到内容
        publishRef.current?.()
      },
      onStatus: (m) => setCollabMsg(m),
    })
    collabRef.current = handle
    return () => {
      handle.close()
      collabRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  /** 快照发布函数（被状态变更与新协作者上线共同触发；collab 内部限流 700ms） */
  const publishRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    publishRef.current = () => {
      const p = getProject(id)
      collabRef.current?.publishState({
        name: p?.name ?? '议题房间',
        topic: p?.topic ?? '',
        enginePaused,
        roles,
        messages,
        spheres,
        bubbles,
        merged,
        digest,
        conclusions,
        guestCount: collabRef.current?.guestCount() ?? 0,
      })
    }
  })
  useEffect(() => {
    publishRef.current?.()
  }, [roles, messages, spheres, bubbles, merged, digest, conclusions, enginePaused])

  const shareUrl = `${window.location.origin}${import.meta.env.BASE_URL}room/${id}?join=1`
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = shareUrl
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  /** 崩溃自检：心跳标记 + 全局异常捕获 + 上次会话异常退出检测。
      目的：把「点击按钮后整页黑屏」从不可见故障变成可见错误卡/可上报记录 */
  useEffect(() => {
    const ERR_KEY = 'ks-errors'
    const ALIVE_KEY = 'ks-alive'
    const CLEAN_KEY = 'ks-clean-exit'
    try {
      const aliveRaw = localStorage.getItem(ALIVE_KEY)
      const clean = localStorage.getItem(CLEAN_KEY)
      const errsRaw = localStorage.getItem(ERR_KEY)
      if (aliveRaw && !clean) {
        const age = Date.now() - Number(aliveRaw)
        const errs = errsRaw ? (JSON.parse(errsRaw) as { t: number; msg: string }[]) : []
        if (age > 15000 && errs.length > 0) {
          const last = errs[errs.length - 1]
          setLastCrash(`${new Date(last.t).toLocaleTimeString()} — ${last.msg}`)
        }
      }
    } catch { /* 存储不可用时静默 */ }
    localStorage.removeItem(ERR_KEY)
    localStorage.removeItem(CLEAN_KEY)

    const pushError = (msg: string) => {
      try {
        const list = JSON.parse(localStorage.getItem(ERR_KEY) ?? '[]') as { t: number; msg: string }[]
        list.push({ t: Date.now(), msg })
        localStorage.setItem(ERR_KEY, JSON.stringify(list.slice(-10)))
      } catch { /* ignore */ }
      setFatal(msg)
    }
    const onError = (e: ErrorEvent) => pushError(e.message || String(e.error))
    const onRejection = (e: PromiseRejectionEvent) => pushError(`Promise 拒绝：${String(e.reason).slice(0, 200)}`)
    const onCleanExit = () => {
      try { localStorage.setItem(CLEAN_KEY, '1') } catch { /* ignore */ }
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('beforeunload', onCleanExit)
    const hb = window.setInterval(() => {
      try { localStorage.setItem(ALIVE_KEY, String(Date.now())) } catch { /* ignore */ }
    }, 3000)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('beforeunload', onCleanExit)
      window.clearInterval(hb)
    }
  }, [])

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
              {mode === 'live' ? 'Kimi 实时模式' : (
                <>
                  演示模式（
                  <button className="underline decoration-dotted transition-colors hover:text-slate-300" onClick={() => setApiDialogOpen(true)}>
                    点「接入 API」使用真实模型
                  </button>
                  ）
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 rounded-lg border-white/15 bg-black/50 text-xs hover:bg-white/10"
            onClick={() => setInviteOpen(true)}
            title="邀请协作者加入：对方只能观看讨论和拖文件，操控权在你"
          >
            <Share2 className="h-3.5 w-3.5" />
            邀请
            {guestCount > 0 && (
              <span className="ml-0.5 flex items-center gap-0.5 rounded-full bg-emerald-500/20 px-1.5 py-px text-[10px] text-emerald-300">
                <Users className="h-2.5 w-2.5" />
                {guestCount}
              </span>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={`h-8 gap-1.5 rounded-lg border-white/15 bg-black/50 text-xs hover:bg-white/10 ${
              mode === 'live' ? 'border-emerald-500/40 text-emerald-300 hover:text-emerald-200' : ''
            }`}
            onClick={() => setApiDialogOpen(true)}
            title={mode === 'live' ? '已接入 Kimi 实时模式，点击管理或清除' : '填入 Kimi API Key，从演示模式切换为真实模型'}
          >
            {mode === 'live' ? <Zap className="h-3.5 w-3.5" /> : <Plug className="h-3.5 w-3.5" />}
            {mode === 'live' ? '已接入' : '接入 API'}
          </Button>
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
          {/* 局部错误边界：手势/语音面板崩了只换掉面板本身，画布与讨论绝不受影响（不再整页黑屏） */}
          <ErrorBoundary
            fallback={(_err, retry) => (
              <div className="fixed bottom-4 right-4 z-40 w-64 rounded-xl border border-red-500/50 bg-black/95 p-3 shadow-2xl backdrop-blur">
                <p className="text-xs font-bold text-red-400">手势语音面板出错（页面未黑屏）</p>
                <p className="mt-1 max-h-16 overflow-y-auto font-mono text-[10px] break-all text-slate-500">{String(_err.message || _err)}</p>
                <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={retry}>重载面板</Button>
              </div>
            )}
          >
            <GestureVoiceDock
              onZoom={handleGestureZoom}
              onVoiceCommand={sendHuman}
              onVoiceControl={handleVoiceControl}
              onTilt={(rx, ry) => setTilt({ rx, ry })}
              detailOpen={!!inspectSphere}
              onCloseDetail={() => setInspectId(null)}
            />
          </ErrorBoundary>

          {/* 崩溃自检：捕获到未处理异常时显示错误卡，代替整页黑屏 */}
          {fatal && (
            <div className="fixed top-4 left-1/2 z-[100] w-[min(560px,92%)] -translate-x-1/2 rounded-2xl border border-red-500/50 bg-black/95 p-4 shadow-2xl backdrop-blur">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm font-bold text-red-400">捕获到页面异常（已阻止黑屏）</span>
                <button className="text-slate-500 hover:text-slate-300" onClick={() => setFatal(null)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="max-h-28 overflow-y-auto font-mono text-[11px] leading-relaxed break-all text-red-300/90">{fatal}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2.5 h-7 text-xs"
                onClick={() => { setFatal(null); window.location.reload() }}
              >
                刷新页面恢复
              </Button>
            </div>
          )}

          {/* 上次会话异常退出提示（刷新后可见） */}
          {lastCrash && (
            <div className="fixed bottom-4 left-1/2 z-[100] w-[min(560px,92%)] -translate-x-1/2 rounded-2xl border border-amber-500/50 bg-black/95 p-4 shadow-2xl backdrop-blur">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm font-bold text-amber-400">检测到上次会话异常退出（黑屏崩溃）</span>
                <button className="text-slate-500 hover:text-slate-300" onClick={() => setLastCrash(null)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="max-h-28 overflow-y-auto font-mono text-[11px] leading-relaxed break-all text-amber-200/90">{lastCrash}</p>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                请把这段内容发给开发者，即可定位黑屏根源。
              </p>
            </div>
          )}

          <ApiKeyDialog open={apiDialogOpen} onOpenChange={setApiDialogOpen} />

          {/* 邀请协作者 */}
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogContent className="border-white/15 bg-black/95 text-slate-100 shadow-2xl backdrop-blur sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-white">
                  <Share2 className="h-4 w-4" />
                  邀请协作者
                </DialogTitle>
                <DialogDescription className="text-slate-500">
                  把链接发给他人即可加入这个议题房间。协作者可以实时观看讨论、随时拖入文件让 AI 阅读；
                  暂停、收敛、整理布局等操控权只在你这里。
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={shareUrl}
                    onFocus={(e) => e.target.select()}
                    className="h-10 border-white/10 bg-black/60 font-mono text-xs text-slate-300 focus-visible:border-white/30"
                  />
                  <Button size="sm" className="h-10 shrink-0 bg-white text-xs text-black hover:bg-slate-200" onClick={copyLink}>
                    {copied ? '已复制' : '复制'}
                  </Button>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-500">
                  {guestCount > 0 ? `当前 ${guestCount} 位协作者在线。` : '暂无协作者在线。'}
                  {collabMsg && ` ${collabMsg}`}
                </p>
                <p className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                  提示：房间数据通过公共消息中转同步，请勿在讨论中发送敏感机密内容。
                </p>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  )
}
