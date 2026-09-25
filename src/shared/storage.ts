// 本地优先存储：项目列表与各讨论房间的状态（localStorage）
import type { AIRole, ChatMessage, KeySphereT } from './types'

export interface ProjectMeta {
  id: string
  name: string
  topic: string
  createdAt: number
  lastActive: number
}

export interface RoomState {
  messages: Record<string, ChatMessage[]>
  spheres: KeySphereT[]
  roles: AIRole[]
  savedAt: number
}

const PROJECTS_KEY = 'keysphere:projects'
const roomKey = (id: string) => `keysphere:room:${id}`

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function listProjects(): ProjectMeta[] {
  return read<ProjectMeta[]>(PROJECTS_KEY, []).sort((a, b) => b.lastActive - a.lastActive)
}

export function saveProject(meta: ProjectMeta): void {
  const list = listProjects()
  const i = list.findIndex((p) => p.id === meta.id)
  if (i >= 0) list[i] = meta
  else list.unshift(meta)
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(list))
}

export function getProject(id: string): ProjectMeta | null {
  return listProjects().find((p) => p.id === id) ?? null
}

export function removeProject(id: string): void {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(listProjects().filter((p) => p.id !== id)))
  localStorage.removeItem(roomKey(id))
}

export function touchProject(id: string): void {
  const p = getProject(id)
  if (p) saveProject({ ...p, lastActive: Date.now() })
}

export function loadRoomState(id: string): RoomState | null {
  return read<RoomState | null>(roomKey(id), null)
}

export function saveRoomState(id: string, state: Omit<RoomState, 'savedAt'>): void {
  localStorage.setItem(roomKey(id), JSON.stringify({ ...state, savedAt: Date.now() }))
}
