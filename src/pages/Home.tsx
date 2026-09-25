import { useState } from 'react'
import { useNavigate } from 'react-router'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { MessageSquarePlus, Orbit, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { listProjects, removeProject, saveProject, type ProjectMeta } from '@/shared/storage'
import { makeId } from '@/ai/mockData'

export default function Home() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectMeta[]>(listProjects)
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')

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
    <div className="min-h-screen w-screen overflow-y-auto bg-black text-slate-100">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-8 flex items-center gap-3">
          <Orbit className="h-7 w-7 text-slate-200" />
          <div>
            <h1 className="text-xl font-bold tracking-wide">KeySphere</h1>
            <p className="text-xs text-slate-500">每个项目一块独立画布，多 AI 分方向讨论，互不混淆</p>
          </div>
        </header>

        {/* 创建新项目 */}
        <section className="mb-8 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="mb-3 text-xs font-semibold tracking-wider text-slate-500 uppercase">发起新讨论</p>
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createProject()}
              placeholder="项目名称，如：KeySphere MVP 方案"
              className="h-10 border-white/10 bg-black/60 sm:w-64"
            />
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createProject()}
              placeholder="议题（可选），如：讨论 MVP 范围与风险"
              className="h-10 flex-1 border-white/10 bg-black/60"
            />
            <Button className="h-10 shrink-0" onClick={createProject} disabled={!name.trim()}>
              <MessageSquarePlus className="mr-1.5 h-4 w-4" />
              创建并进入
            </Button>
          </div>
        </section>

        {/* 项目列表 */}
        <p className="mb-3 text-xs font-semibold tracking-wider text-slate-500 uppercase">
          进行中的项目 · {projects.length}
        </p>
        {projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/15 py-14 text-center">
            <p className="text-sm text-slate-500">还没有项目。创建第一个，把文件和想法丢给多个 AI 一起讨论。</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {projects.map((p) => (
              <div
                key={p.id}
                className="group flex cursor-pointer items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-white/25 hover:bg-white/[0.06]"
                onClick={() => navigate(`/room/${p.id}`)}
              >
                <span className="h-10 w-1 shrink-0 rounded-full bg-gradient-to-b from-slate-300 to-slate-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{p.name}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{p.topic || '（未填写议题）'}</p>
                </div>
                <span className="shrink-0 text-[11px] text-slate-600">
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
    </div>
  )
}
