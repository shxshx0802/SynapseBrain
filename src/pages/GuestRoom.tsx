// 协作者房间：通过 MQTT 订阅房主的房间快照做只读渲染。
// 权限模型：唯一能主动发起的操作是「拖文件进画布」——文件在本地提取内容后发给房主，
// 由房主的讨论引擎阅读并推进讨论；暂停/收敛/整理/回放/插话等操控只存在于房主页面。
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Orbit, UploadCloud } from 'lucide-react'
import { CanvasBoard } from '@/components/CanvasBoard'
import { DiscussionPanel } from '@/components/DiscussionPanel'
import { SphereDetail } from '@/components/SphereDetail'
import { connectCollab, compressImageDataUrl, type CollabHandle, type RoomSnapshot } from '@/shared/collab'
import { extractDocument } from '@/ai/document'
import type { AIRole, ChatMessage, KeySphereT, MergedPair, RelationBubble } from '@/shared/types'

export default function GuestRoom() {
  const { id = '' } = useParams()
  const [snap, setSnap] = useState<RoomSnapshot | null>(null)
  const [connMsg, setConnMsg] = useState('正在连接协作通道…')
  const [uploadMsg, setUploadMsg] = useState('')
  const [inspectId, setInspectId] = useState<string | null>(null)
  const [reduceMotion] = useState(false)
  const handleRef = useRef<CollabHandle | null>(null)
  const lastSnapAtRef = useRef(0)

  useEffect(() => {
    const handle = connectCollab({
      roomId: id,
      asHost: false,
      onState: (s) => {
        lastSnapAtRef.current = Date.now()
        setSnap(s)
      },
      onStatus: (m) => setConnMsg(m),
    })
    handleRef.current = handle
    return () => handle.close()
  }, [id])

  // 房主长时间没有同步（房主不在线或链接错误）→ 提示
  const [waitingHost, setWaitingHost] = useState(false)
  useEffect(() => {
    const iv = window.setInterval(() => {
      setWaitingHost(lastSnapAtRef.current > 0 ? Date.now() - lastSnapAtRef.current > 25_000 : Date.now() - bootAtRef.current > 12_000)
    }, 3000)
    return () => window.clearInterval(iv)
  }, [])
  const bootAtRef = useRef(Date.now())

  /** 协作者拖入文件：本地提取 → 图片压缩 → 发给房主 */
  const onAttachFile = useCallback(
    (file: File) => {
      setUploadMsg(`正在处理《${file.name}》…`)
      void (async () => {
        try {
          const doc = await extractDocument(file)
          const payload = doc.kind === 'image' ? { ...doc, content: await compressImageDataUrl(doc.content) } : doc
          const ok = handleRef.current?.sendFile(payload) ?? false
          setUploadMsg(ok ? `《${file.name}》已发送给房主，AI 正在阅读…` : `《${file.name}》发送失败：文件过大或通道未连接`)
          if (ok) window.setTimeout(() => setUploadMsg(''), 6000)
        } catch (err) {
          setUploadMsg(`《${file.name}》处理失败：${(err as Error).message}`)
        }
      })()
    },
    [],
  )

  const roles = (snap?.roles ?? []) as AIRole[]
  const messages = (snap?.messages ?? {}) as Record<string, ChatMessage[]>
  const spheres = (snap?.spheres ?? []) as KeySphereT[]
  const bubbles = (snap?.bubbles ?? []) as RelationBubble[]
  const merged = (snap?.merged ?? {}) as Record<string, MergedPair>
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
              <span className="truncate">{snap?.name || '议题房间'}</span>
              {snap?.topic && (
                <span className="shrink-0 rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[11px] font-normal text-slate-300">
                  议题 · {snap.topic}
                </span>
              )}
              <span className="shrink-0 rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-normal text-sky-300">
                协作者模式
              </span>
            </h1>
            <p className="mt-0.5 text-[11px] leading-tight text-slate-500">
              {snap ? `已同步 · 演示视图` : connMsg}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500">{roles.filter((r) => !r.paused).length + 1} 位参与者在线</span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <DiscussionPanel
          roles={roles}
          messages={messages}
          digest={snap?.digest ?? null}
          guest
          onApprove={() => {}}
          onSend={() => {}}
        />
        <div className="relative flex min-w-0 flex-1">
          <CanvasBoard
            spheres={spheres}
            bubbles={bubbles}
            merged={merged}
            roles={roles}
            reduceMotion={reduceMotion}
            enginePaused={snap?.enginePaused ?? false}
            onMoveSphere={() => {}}
            onResizeSphere={() => {}}
            onAttachFile={onAttachFile}
            onInspect={setInspectId}
            readOnly
          />
          {uploadMsg && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/15 bg-black/85 px-4 py-2 text-xs text-slate-200 backdrop-blur">
              <UploadCloud className="h-3.5 w-3.5 text-sky-300" />
              {uploadMsg}
            </div>
          )}
          {waitingHost && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm">
              <div className="w-[min(420px,90%)] rounded-2xl border border-white/15 bg-black/90 p-5 text-center shadow-2xl">
                <p className="text-sm font-bold text-white">正在等待房主上线…</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  请确认房主已打开这个房间页面（房主在线后讨论内容会自动同步过来）。
                  你可以随时把文件拖进画布，房主会看到并让 AI 阅读讨论。
                </p>
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
        </div>
      </div>
    </div>
  )
}
