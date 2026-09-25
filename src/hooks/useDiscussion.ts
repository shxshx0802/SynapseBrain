import { useCallback, useEffect, useRef, useState } from 'react'
import type { AIRole, ChatMessage, KeySphereT, MergedPair, RelationBubble, RelationType } from '@/shared/types'
import { isLiveMode } from '@/shared/config'
import { getProject, loadRoomState, saveRoomState, touchProject } from '@/shared/storage'
import { createDefaultProvider, type ChatProvider, type ContentPart, type ProviderMessage } from '@/ai/provider'
import { extractDocument } from '@/ai/document'
import {
  HUMAN_ID,
  INITIAL_ROLES,
  MESSAGE_POOLS,
  RELATION_TEMPLATES,
  SPHERE_CONTENT_POOLS,
  SPHERE_LABEL_POOLS,
  WELCOME,
  makeId,
  relationTypeOf,
} from '@/ai/mockData'

const TICK_MS = 3000
const MERGE_CHECK_MS = 250
const MERGE_RANGE = 1.12 // 距离 < (r1+r2) * 1.12 视为进入拼接
const MAX_SPHERES = 14
const MAX_INFLIGHT = 2 // 同时在飞的 API 请求上限，保护额度

const SYSTEM_PROMPTS: Record<string, string> = {
  arch: '你是「小构」，一位资深软件架构师，在一场多人多 AI 的圆桌讨论中负责技术方向。要求：发言简洁有判断、每次只推进一个观点，50~120 字；关注架构取舍、性能与工程质量。其他参与者（商业、风险方向）也在发言，你可以回应或反驳他们。',
  biz: '你是「小商」，一位商业化顾问，在同一场圆桌讨论中负责商业方向。要求：发言简洁、每次只推进一个观点，50~120 字；关注定价、市场、增长、竞品与商业风险。你会与其他方向（技术、风险）的参与者互动。',
  risk: '你是「小稳」，一位风险审查官，在同一场圆桌讨论中负责风险方向。要求：习惯唱反调、指出方案的裂缝与成本，每次一个观点，50~120 字；关注额度消耗、隐私合规与可靠性。你会与其他方向（技术、商业）的参与者互动。',
}

/** 上下文里的发言者标记只供模型理解对话结构，绝不允许被模仿进输出 */
const OUTPUT_GUARD =
  '\n\n输出要求：只输出你的观点正文。不要复述「某某说：」这类发言者前缀，不要编号列表，不要客套话，不要重复别人的话。'

/** 清洗模型输出：去掉它模仿上下文格式产生的发言者标记；清洗后过短视为失败 */
function sanitizeModelOutput(raw: string): string {
  let s = raw.trim()
  s = s.replace(/^(【[^】]{1,12}】[：:]?\s*)+/, '')
  s = s.replace(/^(【[^】]{1,12}】?\s*)+/, '')
  s = s.replace(/^（[^）]{1,12}）说[：:]\s*/, '')
  s = s.replace(/^([一-龥A-Za-z]{1,12}说[：:]\s*)+/, '')
  if ((s.match(/【/g) || []).length >= 3) s = s.replace(/【[^】]{1,12}】/g, '')
  if ((s.match(/说：/g) || []).length >= 2) s = s.replace(/[一-龥A-Za-z]{1,12}说：/g, '')
  return s.trim()
}

function welcomeMessages(): Record<string, ChatMessage[]> {
  const out: Record<string, ChatMessage[]> = {}
  INITIAL_ROLES.forEach((r, i) => {
    out[r.id] = [{ id: makeId(), roleId: r.id, threadId: r.id, text: WELCOME[r.id], at: Date.now() - (INITIAL_ROLES.length - i) * 600 }]
  })
  return out
}

function seedSpheres(): KeySphereT[] {
  const seeds: Array<[number, number, number]> = [[-280, -60, 74], [260, -110, 70], [-20, 210, 66]]
  return INITIAL_ROLES.map((r, i) => ({
    id: makeId(),
    x: seeds[i][0],
    y: seeds[i][1],
    r: seeds[i][2],
    label: SPHERE_LABEL_POOLS[r.id][0],
    content: SPHERE_CONTENT_POOLS[r.id][0],
    color: r.color,
    authorId: r.id,
    bornAt: Date.now(),
  }))
}

export function useDiscussion(roomId: string) {
  const [mode] = useState<'live' | 'demo'>(() => (isLiveMode() ? 'live' : 'demo'))
  const initialRef = useRef(loadRoomState(roomId))
  const [roles, setRoles] = useState<AIRole[]>(() => initialRef.current?.roles ?? INITIAL_ROLES)
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>(() => {
    const loaded = initialRef.current?.messages ?? welcomeMessages()
    // 清理历史遗留的「…」占位符（早期版本替换失败可能残留）
    return Object.fromEntries(Object.entries(loaded).map(([k, v]) => [k, v.filter((m) => m.text !== '…')]))
  })
  const [spheres, setSpheres] = useState<KeySphereT[]>(() => initialRef.current?.spheres ?? seedSpheres())
  const [bubbles, setBubbles] = useState<RelationBubble[]>([])
  const [merged, setMerged] = useState<Record<string, MergedPair>>({})
  const [enginePaused, setEnginePaused] = useState<boolean>(() => initialRef.current?.enginePaused ?? false)

  const providerRef = useRef<ChatProvider | null>(null)
  if (providerRef.current === null && mode === 'live') providerRef.current = createDefaultProvider()
  const topicRef = useRef(getProject(roomId)?.topic ?? '')

  const rolesRef = useRef(roles)
  rolesRef.current = roles
  const spheresRef = useRef(spheres)
  spheresRef.current = spheres
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const mergedKeysRef = useRef<Set<string>>(new Set())
  const poolIndexRef = useRef<Record<string, number>>({})
  const inflightRef = useRef(0)
  const lastVibrateRef = useRef(0)
  const enginePausedRef = useRef(enginePaused)
  enginePausedRef.current = enginePaused

  const pushMessage = useCallback((roleId: string, text: string, id?: string) => {
    setMessages((prev) => {
      const list = prev[roleId] ?? []
      return { ...prev, [roleId]: [...list, { id: id ?? makeId(), roleId, threadId: roleId, text, at: Date.now() }] }
    })
  }, [])

  const replaceMessage = useCallback((roleId: string, id: string, text: string) => {
    setMessages((prev) => ({
      ...prev,
      [roleId]: (prev[roleId] ?? []).map((m) => (m.id === id ? { ...m, text, at: Date.now() } : m)),
    }))
  }, [])

  /** 从角色预算中扣费，处理降档与暂停 */
  const chargeRole = useCallback(
    (roleId: string, cost: number) => {
      const before = rolesRef.current.find((x) => x.id === roleId)
      if (!before || before.paused) return
      if (before.used + cost >= before.budget) {
        pushMessage(roleId, '（我的额度已用完，进入「待批准」状态，请人类参与者放行。）')
      }
      setRoles((prev) =>
        prev.map((r) => {
          if (r.id !== roleId || r.paused) return r
          const used = r.used + cost
          const paused = used >= r.budget
          const downshifted = r.downshifted || (r.budget - used) / r.budget < 0.2
          return { ...r, used, paused, downshifted }
        }),
      )
    },
    [pushMessage],
  )

  const addSphere = useCallback((role: AIRole, label: string, content?: string) => {
    setSpheres((prev) => {
      if (prev.length >= MAX_SPHERES) return prev
      const r = 56 + Math.random() * 22
      // 出生点：同作者球簇中心（首球为专属泳道），黄金角螺旋向外搜索
      // ——完全确定性，且保证不与任何现有球重叠
      const mine = prev.filter((s) => s.authorId === role.id)
      const laneIdx = Math.max(0, INITIAL_ROLES.findIndex((x) => x.id === role.id))
      const base = mine.length
        ? {
            x: mine.reduce((a, s) => a + s.x, 0) / mine.length,
            y: mine.reduce((a, s) => a + s.y, 0) / mine.length,
          }
        : { x: -380 + laneIdx * 380, y: -240 }
      const clear = (x: number, y: number) => prev.every((s) => Math.hypot(s.x - x, s.y - y) > (s.r + r) * 1.12)
      let pos: { x: number; y: number } | null = null
      for (let n = 0; n < 360; n++) {
        const angle = n * 2.399963 // 黄金角
        const dist = 10 * Math.sqrt(n) + r
        const x = base.x + Math.cos(angle) * dist
        const y = base.y + Math.sin(angle) * dist * 0.78
        if (clear(x, y)) {
          pos = { x, y }
          break
        }
      }
      if (!pos) pos = { x: base.x, y: base.y - 400 } // 画布已极满时的兜底，理论上到不了
      return [
        ...prev,
        { id: makeId(), x: pos.x, y: pos.y, r, label, content, color: role.color, authorId: role.id, bornAt: Date.now() },
      ]
    })
  }, [])

  /** 演示模式：从预设标签池凝结关键球（附来源内容） */
  const spawnSphereMock = useCallback(
    (role: AIRole) => {
      const idx = (poolIndexRef.current[role.id] = (poolIndexRef.current[role.id] ?? 0) + 1)
      const pool = SPHERE_LABEL_POOLS[role.id]
      const contentPool = SPHERE_CONTENT_POOLS[role.id]
      addSphere(role, pool[idx % pool.length], contentPool[idx % contentPool.length])
    },
    [addSphere],
  )

  /** 实时模式：让模型把自己的观点浓缩成关键球标签，原文随球保存 */
  const spawnSphereLive = useCallback(
    async (role: AIRole, text: string, provider: ChatProvider) => {
      try {
        const res = await provider.chat(
          [
            { role: 'system', content: '把给定观点浓缩成一个关键概念短语：不超过 10 个汉字、名词性、无标点。只输出短语本身。' },
            { role: 'user', content: text },
          ],
          { maxTokens: 512 },
        )
        const label = res.text.replace(/[「」"'“”'、，。,.：:；;\n\s]/g, '').slice(0, 12)
        if (label.length >= 2) addSphere(role, label, text)
        chargeRole(role.id, res.tokens)
      } catch {
        /* 标签生成失败不影响讨论，静默忽略 */
      }
    },
    [addSphere, chargeRole],
  )

  /** 构建给模型的近期上下文：人类消息带标记，AI 消息不署名（避免被模仿进输出） */
  const recentContext = useCallback((): ProviderMessage[] => {
    return Object.values(messagesRef.current)
      .flat()
      .sort((a, b) => a.at - b.at)
      .filter((m) => !m.text.startsWith('…') && !m.text.startsWith('（'))
      .slice(-12)
      .map((m) => ({
        role: m.roleId === HUMAN_ID ? ('user' as const) : ('assistant' as const),
        content: m.roleId === HUMAN_ID ? `你（人类参与者）说：${m.text}` : m.text,
      }))
  }, [])

  /** 让一个 AI 角色发一轮言（实时优先，失败回退演示话术） */
  const postAI = useCallback(
    (replyTo?: string) => {
      const active = rolesRef.current.filter((r) => !r.paused)
      if (!active.length) return
      const role = active[Math.floor(Math.random() * active.length)]
      const idx = (poolIndexRef.current[role.id] = (poolIndexRef.current[role.id] ?? 0) + 1)
      const pool = MESSAGE_POOLS[role.id]
      const mockText = replyTo
        ? `关于你说的「${replyTo.slice(0, 14)}${replyTo.length > 14 ? '…' : ''}」，我的视角是：${pool[idx % pool.length]}`
        : pool[idx % pool.length]
      const provider = providerRef.current
      if (!provider) {
        // 演示模式：直接走本地话术
        pushMessage(role.id, mockText)
        chargeRole(role.id, (role.downshifted ? 60 : 140) + mockText.length * 2)
        if (Math.random() < 0.3) spawnSphereMock(role)
        return
      }
      // 实时模式：并发打满时本轮直接跳过，等飞行中的请求落地（不能用 mock 凑数，否则刷屏）
      if (inflightRef.current >= MAX_INFLIGHT) return
      inflightRef.current += 1
      const tmpId = makeId()
      pushMessage(role.id, '…', tmpId)
      void (async () => {
        try {
          const topicLine = topicRef.current
            ? `\n\n本次讨论议题：「${topicRef.current}」。请始终围绕该议题发言，引用具体细节，不要跑题。`
            : ''
          const msgs: ProviderMessage[] = [
            { role: 'system', content: SYSTEM_PROMPTS[role.id] + topicLine + OUTPUT_GUARD },
            ...recentContext(),
          ]
          if (replyTo) msgs.push({ role: 'user', content: `人类参与者刚说：「${replyTo}」。请直接回应他/她，承接上下文。` })
          const res = await provider.chat(msgs, { maxTokens: role.downshifted ? 400 : 800 })
          const cleaned = sanitizeModelOutput(res.text)
          if (cleaned.length < 4) throw new Error('模型输出被清洗后过短')
          replaceMessage(role.id, tmpId, cleaned)
          chargeRole(role.id, res.tokens)
          if (Math.random() < 0.35) void spawnSphereLive(role, cleaned, provider)
        } catch (err) {
          console.warn('[KeySphere] 实时调用失败，回退演示话术：', err)
          replaceMessage(role.id, tmpId, mockText)
          chargeRole(role.id, mockText.length * 2)
          if (Math.random() < 0.3) spawnSphereMock(role)
        } finally {
          inflightRef.current -= 1
        }
      })()
    },
    [chargeRole, pushMessage, recentContext, replaceMessage, spawnSphereLive, spawnSphereMock],
  )

  // 引擎主循环：驱动多 AI 并行讨论（暂停时保持静默，插话仍可手动触发回应）
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (!enginePausedRef.current) postAI()
    }, TICK_MS)
    return () => window.clearInterval(iv)
  }, [postAI])

  // 新房间启动：把创建时填写的议题抛给所有 AI 方向，保证「讨论你提出的问题」
  // 判定条件用「还没有人类消息」而非「无存档」，老房间升级后也能补启动
  const bootedRef = useRef(false)
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    const topic = topicRef.current
    const hasHumanMsg = Object.values(messagesRef.current)
      .flat()
      .some((m) => m.roleId === HUMAN_ID)
    if (hasHumanMsg || !topic) return
    const t = `议题：「${topic}」。请大家围绕这个议题，从各自方向展开讨论。`
    pushMessage(HUMAN_ID, t)
    const t1 = window.setTimeout(() => postAI(t), 1000)
    const t2 = window.setTimeout(() => postAI(), 3400)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [postAI, pushMessage])

  const sendHuman = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      pushMessage(HUMAN_ID, trimmed)
      if (Math.random() < 0.85) window.setTimeout(() => postAI(trimmed), 600)
    },
    [postAI, pushMessage],
  )

  /** 拖入文件：提取内容 → 展示摘要 → 让 AI 立刻阅读并结合议题讨论 */
  const attachDocument = useCallback(
    (file: File) => {
      const pendingId = makeId()
      setMessages((prev) => ({
        ...prev,
        [HUMAN_ID]: [...(prev[HUMAN_ID] ?? []), { id: pendingId, roleId: HUMAN_ID, threadId: HUMAN_ID, text: `📎 已拖入文件《${file.name}》，正在提取内容…`, at: Date.now() }],
      }))
      void (async () => {
        try {
          const doc = await extractDocument(file)
          const head = doc.kind === 'text' ? doc.content.slice(0, 500) : `[图片 ${(doc.size / 1024).toFixed(1)} KB]`
          const visible =
            `📎 我拖入了文件《${doc.name}》` +
            (doc.kind === 'text' ? `（全文 ${doc.size.toLocaleString()} 字${doc.truncated ? '，已截断' : ''}）` : '') +
            `：\n「${head}${doc.kind === 'text' && doc.content.length > 500 ? '…' : ''}」\n请大家阅读这份材料，结合议题从各自方向展开讨论。`
          replaceMessage(HUMAN_ID, pendingId, visible)

          const provider = providerRef.current
          const active = rolesRef.current.filter((r) => !r.paused)
          if (!provider || !active.length || inflightRef.current >= MAX_INFLIGHT) {
            window.setTimeout(() => postAI(visible), 500)
            return
          }
          const role = active[Math.floor(Math.random() * active.length)]
          inflightRef.current += 1
          const tmpId = makeId()
          pushMessage(role.id, '…')
          try {
            const topicLine = topicRef.current ? `当前议题：「${topicRef.current}」。` : ''
            const userContent: string | ContentPart[] =
              doc.kind === 'image'
                ? [
                    { type: 'image_url', image_url: { url: doc.content } },
                    { type: 'text', text: `${topicLine}人类参与者拖入了图片《${doc.name}》。请描述图中内容，并分析它与当前讨论的关系，80 字以内。` },
                  ]
                : `${topicLine}人类参与者拖入了文件《${doc.name}》${doc.truncated ? '（内容较长已截断）' : ''}，全文如下：\n\n${doc.content}\n\n请阅读后给出你这个方向的核心判断（100 字以内），并点出最值得做成关键球的一个概念。`
            const res = await provider.chat(
              [
                { role: 'system', content: SYSTEM_PROMPTS[role.id] + OUTPUT_GUARD },
                ...recentContext(),
                { role: 'user', content: userContent },
              ],
              { maxTokens: role.downshifted ? 400 : 800 },
            )
            const cleaned = sanitizeModelOutput(res.text)
            if (cleaned.length < 4) throw new Error('模型输出被清洗后过短')
            replaceMessage(role.id, tmpId, cleaned)
            chargeRole(role.id, res.tokens)
            if (Math.random() < 0.6) void spawnSphereLive(role, cleaned, provider)
          } catch (err) {
            console.warn('[KeySphere] 文档阅读失败：', err)
            replaceMessage(role.id, tmpId, `（我没能读完这份文件，可能是网络或额度问题。）`)
          } finally {
            inflightRef.current -= 1
          }
        } catch (err) {
          replaceMessage(HUMAN_ID, pendingId, `⚠️ 文件《${file.name}》处理失败：${(err as Error).message}`)
        }
      })()
    },
    [chargeRole, postAI, pushMessage, recentContext, replaceMessage, spawnSphereLive],
  )

  const approveRole = useCallback((roleId: string) => {
    setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, used: Math.floor(r.used * 0.5), paused: false } : r)))
  }, [])

  const moveSphere = useCallback((id: string, x: number, y: number) => {
    setSpheres((prev) => prev.map((s) => (s.id === id ? { ...s, x, y } : s)))
  }, [])

  /** 生成关系气泡（实时模式由模型解读，失败或演示模式用确定性模板） */
  const upsertBubble = useCallback(
    (key: string, a: KeySphereT, b: KeySphereT, type: RelationType, text: string, authorId: string, now: number) => {
      setBubbles((prev) => [
        ...prev.filter((p) => p.pairKey !== key),
        { id: makeId(), pairKey: key, type, text, authorId, x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - Math.min(a.r, b.r) * 0.5, createdAt: now },
      ])
    },
    [],
  )

  const interpretRelationLive = useCallback(
    (key: string, a: KeySphereT, b: KeySphereT, author: AIRole, provider: ChatProvider) => {
      void (async () => {
        try {
          const res = await provider.chat(
            [
              {
                role: 'system',
                content: '你在一张多人讨论画布上解读两个关键概念球的关系。只输出 JSON，格式：{"type":"supports|contradicts|causes|analogy","text":"一句话解读，30~60 字"}。type 只能是这四个值之一。',
              },
              { role: 'user', content: `球A：「${a.label}」；球B：「${b.label}」。它们之间是什么关系？` },
            ],
            { maxTokens: 800 },
          )
          const cleaned = res.text.replace(/```json|```/g, '').trim()
          const parsed = JSON.parse(cleaned) as { type?: string; text?: string }
          const valid = ['supports', 'contradicts', 'causes', 'analogy'].includes(parsed.type ?? '') && typeof parsed.text === 'string'
          if (!valid) throw new Error('模型未返回合法 JSON')
          const cleanedText = sanitizeModelOutput(parsed.text as string)
          if (cleanedText.length < 4) throw new Error('关系解读被清洗后过短')
          upsertBubble(key, a, b, parsed.type as RelationType, cleanedText, author.id, Date.now())
          chargeRole(author.id, res.tokens)
        } catch {
          /* 保留已展示的模板气泡 */
        }
      })()
    },
    [chargeRole, upsertBubble],
  )

  // 拼接检测：靠近 → 融球 + 震动 + AI 关系解读；分开 → 撤掉气泡
  useEffect(() => {
    const check = () => {
      const sp = spheresRef.current
      const found: Record<string, MergedPair> = {}
      const now = Date.now()
      for (let i = 0; i < sp.length; i++) {
        for (let j = i + 1; j < sp.length; j++) {
          const a = sp[i]
          const b = sp[j]
          const d = Math.hypot(a.x - b.x, a.y - b.y)
          const threshold = (a.r + b.r) * MERGE_RANGE
          if (d < threshold) {
            const key = [a.id, b.id].sort().join('|')
            found[key] = { aId: a.id, bId: b.id, intensity: 1 - d / threshold }
            if (!mergedKeysRef.current.has(key)) {
              mergedKeysRef.current.add(key)
              // 先立即用确定性模板给反馈，实时模式下模型解读随后升级替换
              const type: RelationType = relationTypeOf(a.label, b.label)
              const templates = RELATION_TEMPLATES[type]
              const text = templates[(Math.random() * templates.length) | 0]
                .replaceAll('{A}', `「${a.label}」`)
                .replaceAll('{B}', `「${b.label}」`)
              const speakers = rolesRef.current.filter((r) => !r.paused)
              const author = speakers.length ? speakers[(Math.random() * speakers.length) | 0] : INITIAL_ROLES[0]
              upsertBubble(key, a, b, type, text, author.id, now)
              const provider = providerRef.current
              if (provider) interpretRelationLive(key, a, b, author, provider)
              setSpheres((prev) => prev.map((s) => (s.id === a.id || s.id === b.id ? { ...s, pulseAt: now } : s)))
              if (now - lastVibrateRef.current > 900 && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                navigator.vibrate(50)
                lastVibrateRef.current = now
              }
            }
          }
        }
      }
      for (const key of Array.from(mergedKeysRef.current)) {
        if (!found[key]) {
          mergedKeysRef.current.delete(key)
          setBubbles((prev) => prev.filter((p) => p.pairKey !== key))
        }
      }
      setMerged((prev) => {
        const same = Object.keys(prev).length === Object.keys(found).length && Object.keys(found).every((k) => prev[k])
        return same ? prev : found
      })
    }
    const iv = window.setInterval(check, MERGE_CHECK_MS)
    return () => window.clearInterval(iv)
  }, [interpretRelationLive, upsertBubble])

  // 房间状态持久化：变更后 800ms 落盘，回到主页再进来讨论不丢
  useEffect(() => {
    const t = window.setTimeout(() => {
      saveRoomState(roomId, { messages, spheres, roles, enginePaused })
      touchProject(roomId)
    }, 800)
    return () => window.clearTimeout(t)
  }, [messages, spheres, roles, enginePaused, roomId])

  const toggleEngine = useCallback(() => setEnginePaused((p) => !p), [])

  return { mode, roles, messages, spheres, bubbles, merged, enginePaused, toggleEngine, sendHuman, attachDocument, approveRole, moveSphere }
}
