import { useCallback, useEffect, useRef, useState } from 'react'
import type { AIRole, ChatMessage, KeySphereT, MergedPair, RelationBubble, RelationType } from '@/shared/types'
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

const TICK_MS = 1800
const MERGE_CHECK_MS = 250
const MERGE_RANGE = 1.12 // 距离 < (r1+r2) * 1.12 视为进入拼接
const MAX_SPHERES = 14

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
  const [roles, setRoles] = useState<AIRole[]>(INITIAL_ROLES)
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>(welcomeMessages)
  const [spheres, setSpheres] = useState<KeySphereT[]>(seedSpheres)
  const [bubbles, setBubbles] = useState<RelationBubble[]>([])
  const [merged, setMerged] = useState<Record<string, MergedPair>>({})

  const rolesRef = useRef(roles)
  rolesRef.current = roles
  const spheresRef = useRef(spheres)
  spheresRef.current = spheres
  const mergedKeysRef = useRef<Set<string>>(new Set())
  const poolIndexRef = useRef<Record<string, number>>({})
  const lastVibrateRef = useRef(0)

  const pushMessage = useCallback((roleId: string, text: string) => {
    setMessages((prev) => {
      const list = prev[roleId] ?? []
      return { ...prev, [roleId]: [...list, { id: makeId(), roleId, threadId: roleId, text, at: Date.now() }] }
    })
  }, [])

  /** 从角色预算中扣费，处理降档与暂停 */
  const chargeRole = useCallback(
    (roleId: string, cost: number) => {
      setRoles((prev) =>
        prev.map((r) => {
          if (r.id !== roleId || r.paused) return r
          const used = r.used + cost
          const paused = used >= r.budget
          const downshifted = r.downshifted || (r.budget - used) / r.budget < 0.2
          return { ...r, used, paused, downshifted }
        }),
      )
      const r = rolesRef.current.find((x) => x.id === roleId)
      if (r && r.used + cost >= r.budget) {
        pushMessage(roleId, '（我的额度已用完，进入「待批准」状态，请人类参与者放行。）')
      }
    },
    [pushMessage],
  )

  const spawnSphere = useCallback(
    (role: AIRole) => {
      const idx = (poolIndexRef.current[role.id] = (poolIndexRef.current[role.id] ?? 0) + 1)
      const pool = SPHERE_LABEL_POOLS[role.id]
      setSpheres((prev) => {
        if (prev.length >= MAX_SPHERES) return prev
        return [
          ...prev,
          {
            id: makeId(),
            x: (Math.random() - 0.5) * 720,
            y: (Math.random() - 0.5) * 480,
            r: 56 + Math.random() * 22,
            label: pool[idx % pool.length],
            color: role.color,
            authorId: role.id,
            bornAt: Date.now(),
          },
        ]
      })
    },
    [],
  )

  /** 让一个 AI 角色发一轮言 */
  const postAI = useCallback(
    (replyTo?: string) => {
      const active = rolesRef.current.filter((r) => !r.paused)
      if (!active.length) return
      const role = active[Math.floor(Math.random() * active.length)]
      const idx = (poolIndexRef.current[role.id] = (poolIndexRef.current[role.id] ?? 0) + 1)
      const pool = MESSAGE_POOLS[role.id]
      const base = pool[idx % pool.length]
      const text = replyTo
        ? `关于你说的「${replyTo.slice(0, 14)}${replyTo.length > 14 ? '…' : ''}」，我的视角是：${base}`
        : base
      pushMessage(role.id, text)
      chargeRole(role.id, (role.downshifted ? 60 : 140) + text.length * 2)
      if (Math.random() < 0.3) spawnSphere(role)
    },
    [chargeRole, pushMessage, spawnSphere],
  )

  // 引擎主循环：模拟多 AI 并行讨论
  useEffect(() => {
    const iv = window.setInterval(postAI, TICK_MS)
    return () => window.clearInterval(iv)
  }, [postAI])

  const sendHuman = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      pushMessage(HUMAN_ID, trimmed)
      if (Math.random() < 0.75) {
        window.setTimeout(() => postAI(trimmed), 800)
      }
    },
    [postAI, pushMessage],
  )

  const approveRole = useCallback((roleId: string) => {
    setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, used: Math.floor(r.used * 0.5), paused: false } : r)))
  }, [])

  const moveSphere = useCallback((id: string, x: number, y: number) => {
    setSpheres((prev) => prev.map((s) => (s.id === id ? { ...s, x, y } : s)))
  }, [])

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
              const type: RelationType = relationTypeOf(a.label, b.label)
              const templates = RELATION_TEMPLATES[type]
              const text = templates[(Math.random() * templates.length) | 0]
                .replaceAll('{A}', `「${a.label}」`)
                .replaceAll('{B}', `「${b.label}」`)
              const speakers = rolesRef.current.filter((r) => !r.paused)
              const author = speakers.length ? speakers[(Math.random() * speakers.length) | 0] : INITIAL_ROLES[0]
              setBubbles((prev) => [
                ...prev.filter((p) => p.pairKey !== key),
                {
                  id: makeId(),
                  pairKey: key,
                  type,
                  text,
                  authorId: author.id,
                  x: (a.x + b.x) / 2,
                  y: Math.min(a.y, b.y) - Math.min(a.r, b.r) * 0.5,
                  createdAt: now,
                },
              ])
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
  }, [])

  return { roles, messages, spheres, bubbles, merged, sendHuman, approveRole, moveSphere }
}
