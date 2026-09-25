// KeySphere 共享类型定义（所有层都可引用本文件，本文件不得引用其他层）

export type RelationType = 'supports' | 'contradicts' | 'causes' | 'analogy'

export interface AIRole {
  id: string
  name: string
  persona: string
  color: string
  budget: number
  used: number
  downshifted: boolean
  paused: boolean
}

export interface ChatMessage {
  id: string
  roleId: string // 'human' 表示人类参与者
  threadId: string
  text: string
  at: number
}

export interface KeySphereT {
  id: string
  x: number
  y: number
  r: number
  label: string
  color: string
  authorId: string
  bornAt: number
  /** 这颗球凝结自哪段讨论内容（双击查看） */
  content?: string
  /** 最近一次被拼接触发的时间戳，用于脉冲动画 */
  pulseAt?: number
}

export interface RelationBubble {
  id: string
  pairKey: string
  type: RelationType
  text: string
  authorId: string
  x: number
  y: number
  createdAt: number
}

export interface MergedPair {
  aId: string
  bId: string
  /** 0~1，越近越接近 1 */
  intensity: number
}
