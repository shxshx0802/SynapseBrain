import { useCallback, useEffect, useRef, useState } from 'react'
import type { AIRole, ChatMessage, KeySphereT, MergedPair, RelationBubble, RelationType } from '@/shared/types'
import { isLiveMode } from '@/shared/config'
import { createDefaultProvider, type ChatProvider, type ProviderMessage } from '@/ai/provider'
import {
  HUMAN_ID,
  INITIAL_ROLES,
  MESSAGE_POOLS,
  RELATION_TEMPLATES,
  SPHERE_LABEL_POOLS,
  WELCOME,
  makeId,
  relationTypeOf,
} from '@/ai/mockData'

const TICK_MS = 2200
const MERGE_CHECK_MS = 250
const MERGE_RANGE = 1.12 // 距离 < (r1+r2) * 1.12 视为进入拼接
const MAX_SPHERES = 14
const MAX_INFLIGHT = 2 // 同时在飞的 API 请求上限，保护额度

const SYSTEM_PROMPTS: Record<string, string> = {
  arch: '你是「小构」，一位资深软件架构师，在一场多人多 AI 的圆桌讨论中负责技术方向。要求：发言简洁有判断、每次只推进一个观点，50~120 字；关注架构取舍、性能与工程质量。其他参与者（商业、风险方向）也在发言，你可以回应或反驳他们。',
  biz: '你是「小商」，一位商业化顾问，在同一场圆桌讨论中负责商业方向。要求：发言简洁、每次只推进一个观点，50~120 字；关注定价、市场、增长、竞品与商业风险。你会与其他方向（技术、风险）的参与者互动。',
  risk: '你是「小稳」，一位风险审查官，在同一场圆桌讨论中负责风险方向。要求：习惯唱反调、指出方案的裂缝与成本，每次一个观点，50~120 字；关注额度消耗、隐私合规与可靠性。你会与其他方向（技术、商业）的参与者互动。',
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
    color: r.color,
    authorId: r.id,
    bornAt: Date.now(),
  }))
}

export function useDiscussion() {
  const [mode] = useState<'live' | 'demo'>(() => (isLiveMode() ? 'live' : 'demo'))
  const [roles, setRoles] = useState<AIRole[]>(INITIAL_ROLES)
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>(welcomeMessages)
  const [spheres, setSpheres] = useState<KeySphereT[]>(seedSpheres)
  const [bubbles, setBubbles] = useState<RelationBubble[]>([])
  const [merged, setMerged] = useState<Record<string, MergedPair>>({})

  const providerRef = useRef<ChatProvider | null>(null)
  if (providerRef.current === null && mode === 'live') providerRef.current = createDefaultProvider()

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

  const pushMessage = useCallback((roleId: string, text: string) => {
    setMessages((prev) => {
      const list = prev[roleId] ?? []
      return { ...prev, [roleId]: [...list, { id: makeId(), roleId, threadId: roleId, text, at: Date.now() }] }
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

  const addSphere = useCallback((role: AIRole, label: string) => {
    setSpheres((prev) => {
      if (prev.length >= MAX_SPHERES) return prev
      return [
        ...prev,
        {
          id: makeId(),
          x: (Math.random() - 0.5) * 720,
          y: (Math.random() - 0.5) * 480,
          r: 56 + Math.random() * 22,
          label,
          color: role.color,
          authorId: role.id,
          bornAt: Date.now(),
        },
      ]
    })
  }, [])

  /** 演示模式：从预设标签池凝结关键球 */
  const spawnSphereMock = useCallback(
    (role: AIRole) => {
      const idx = (poolIndexRef.current[role.id] = (poolIndexRef.current[role.id] ?? 0) + 1)
      const pool = SPHERE_LABEL_POOLS[role.id]
      addSphere(role, pool[idx % pool.length])
    },
    [addSphere],
  )

  /** 实时模式：让模型把自己的观点浓缩成关键球标签 */
  const spawnSphereLive = useCallback(
    async (role: AIRole, text: string, provider: ChatProvider) => {
      try {
        const res = await provider.chat(
          [
            { role: 'system', content: '把给定观点浓缩成一个关键概念短语：不超过 10 个汉字、名词性、无标点。只输出短语本身。' },
            { role: 'user', content: text },
          ],
          { temperature: 0.3, maxTokens: 24 },
        )
        const label = res.text.replace(/[「」"'“”'、，。,.：:；;\n\s]/g, '').slice(0, 12)
        if (label.length >= 2) addSphere(role, label)
        chargeRole(role.id, res.tokens)
      } catch {
        /* 标签生成失败不影响讨论，静默忽略 */
      }
    },
    [addSphere, chargeRole],
  )

  /** 构建给模型的近期上下文（全员讨论流，带说话人前缀） */
  const recentContext = useCallback((): ProviderMessage[] => {
    const roleName = (id: string) => INITIAL_ROLES.find((r) => r.id === id)?.name ?? id
    return Object.values(messagesRef.current)
      .flat()
      .sort((a, b) => a.at - b.at)
      .filter((m) => !m.text.startsWith('…') && !m.text.startsWith('（'))
      .slice(-12)
      .map((m) => ({
        role: m.roleId === HUMAN_ID ? ('user' as const) : ('assistant' as const),
        content: `【${m.roleId === HUMAN_ID ? '你（人类参与者）' : roleName(m.roleId)}】${m.text}`,
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
      if (!provider || inflightRef.current >= MAX_INFLIGHT) {
        pushMessage(role.id, mockText)
        chargeRole(role.id, (role.downshifted ? 60 : 140) + mockText.length * 2)
        if (Math.random() < 0.3) spawnSphereMock(role)
        return
      }
      inflightRef.current += 1
      const tmpId = makeId()
      pushMessage(role.id, '…')
      void (async () => {
        try {
          const msgs: ProviderMessage[] = [
            { role: 'system', content: SYSTEM_PROMPTS[role.id] },
            ...recentContext(),
          ]
          if (replyTo) msgs.push({ role: 'user', content: `人类参与者刚说：「${replyTo}」。请直接回应他/她，承接上下文。` })
          const res = await provider.chat(msgs, { temperature: 0.8, maxTokens: role.downshifted ? 160 : 360 })
          replaceMessage(role.id, tmpId, res.text)
          chargeRole(role.id, res.tokens)
          if (Math.random() < 0.35) void spawnSphereLive(role, res.text, provider)
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

  // 引擎主循环：驱动多 AI 并行讨论
  useEffect(() => {
    const iv = window.setInterval(() => postAI(), TICK_MS)
    return () => window.clearInterval(iv)
  }, [postAI])

  const sendHuman = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      pushMessage(HUMAN_ID, trimmed)
      if (Math.random() < 0.85) window.setTimeout(() => postAI(trimmed), 600)
    },
    [postAI, pushMessage],
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
            { temperature: 0.5, maxTokens: 140 },
          )
          const cleaned = res.text.replace(/```json|```/g, '').trim()
          const parsed = JSON.parse(cleaned) as { type?: string; text?: string }
          const valid = ['supports', 'contradicts', 'causes', 'analogy'].includes(parsed.type ?? '') && typeof parsed.text === 'string'
          if (!valid) throw new Error('模型未返回合法 JSON')
          upsertBubble(key, a, b, parsed.type as RelationType, parsed.text as string, author.id, Date.now())
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

  return { mode, roles, messages, spheres, bubbles, merged, sendHuman, approveRole, moveSphere }
}
