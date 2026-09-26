import { useState } from 'react'
import { useNavigate } from 'react-router'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { MessageSquarePlus, Orbit, Plug, Trash2, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { listProjects, removeProject, saveProject, type ProjectMeta } from '@/shared/storage'
import { isLiveMode } from '@/shared/config'
import { makeId } from '@/ai/mockData'
import { ApiKeyDialog } from '@/components/ApiKeyDialog'

export default function Home() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectMeta[]>(listProjects)
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [apiDialogOpen, setApiDialogOpen] = useState(false)
  const live = isLiveMode()

  const refresh = () => setProjects(listProjects())

  const createProject = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const id = makeId()
    saveProject({ id, name: trimmed, topic: topic.trim(), createdAt: Date.now(), lastActive: Date.now() })
    setName('')
    setTopic('')
    refresh()
    navigate(`/room/${id}`)
  }

  const deleteProject = (id: string) => {
    removeProject(id)
    refresh()
  }

  return (
    <div className="relative min-h-screen w-screen overflow-y-auto bg-black text-slate-100">
      {/* 氛围光斑 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/4 h-80 w-80 rounded-full bg-white/[0.04] blur-3xl" />
        <div className="absolute right-1/5 -bottom-40 h-96 w-96 rounded-full bg-white/[0.03] blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-3xl px-6 py-14">
        <header className="mb-10">
          <div className="mb-3 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-white/15 to-white/5 shadow-[0_0_24px_rgba(255,255,255,0.12)]">
              <Orbit className="h-5.5 w-5.5 text-white" />
            </span>
            <h1 className="bg-gradient-to-br from-white via-white to-slate-500 bg-clip-text text-2xl font-bold tracking-wide text-transparent">
              SynapseBrain
            </h1>
          </div>
          <p className="pl-1 text-sm text-slate-500">每个项目一块独立画布，多 AI 分方向讨论，互不混淆</p>
          <div className="mt-2 flex items-center gap-3 pl-1">
            <a href="/lab" className="text-xs text-slate-600 underline decoration-dotted transition-colors hover:text-slate-300">
              🧪 手势 & 语音实验室（测试页）
            </a>
            <button
              onClick={() => setApiDialogOpen(true)}
              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                live
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                  : 'border-white/15 bg-white/5 text-slate-400 hover:border-white/30 hover:text-slate-200'
              }`}
              title={live ? '已接入 Kimi 实时模式，点击管理或清除' : '填入 Kimi API Key，从演示模式切换为真实模型'}
            >
              {live ? <Zap className="h-3 w-3" /> : <Plug className="h-3 w-3" />}
              {live ? 'Kimi 实时模式' : '接入 API'}
            </button>
          </div>
        </header>

        {/* 创建新项目 */}
        <section className="mb-10 rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <p className="mb-3.5 text-[10px] font-semibold tracking-[0.15em] text-slate-600 uppercase">发起新讨论</p>
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createProject()}
              placeholder="项目名称，如：SynapseBrain MVP 方案"
              className="h-11 border-white/10 bg-black/60 transition-colors focus-visible:border-white/30 sm:w-64"
            />
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createProject()}
              placeholder="议题（AI 会围绕它展开讨论），如：MVP 范围与风险"
              className="h-11 flex-1 border-white/10 bg-black/60 transition-colors focus-visible:border-white/30"
            />
            <Button className="h-11 shrink-0 px-5" onClick={createProject} disabled={!name.trim()}>
              <MessageSquarePlus className="mr-1.5 h-4 w-4" />
              创建并进入
            </Button>
          </div>
          <p className="mt-3 text-[11px] text-slate-600">创建后三个 AI 方向会立即围绕议题开始讨论</p>
        </section>

        {/* 项目列表 */}
        <p className="mb-3 text-[10px] font-semibold tracking-[0.15em] text-slate-600 uppercase">进行中的项目 · {projects.length}</p>
        {projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 py-16 text-center">
            <p className="text-sm text-slate-500">还没有项目。创建第一个，把想法丢给多个 AI 一起讨论。</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {projects.map((p) => (
              <div
                key={p.id}
                className="group flex cursor-pointer items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-all hover:border-white/25 hover:bg-white/[0.06] hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]"
                onClick={() => navigate(`/room/${p.id}`)}
              >
                <span className="h-11 w-1 shrink-0 rounded-full bg-gradient-to-b from-white/70 to-white/10" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{p.name}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{p.topic || '（未填写议题）'}</p>
                </div>
                <span className="shrink-0 text-[11px] whitespace-nowrap text-slate-600">
                  {formatDistanceToNow(p.lastActive, { addSuffix: true, locale: zhCN })}
                </span>
                <button
                  className="shrink-0 rounded-lg p-2 text-slate-600 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400"
                  title="删除项目"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteProject(p.id)
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <ApiKeyDialog open={apiDialogOpen} onOpenChange={setApiDialogOpen} />
    </div>
  )
}
