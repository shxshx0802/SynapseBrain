// 协作通道：基于 MQTT 公共 broker 的房间状态同步（无需自建服务器，静态托管可用）。
//
// 角色模型：
// - 房主（host）：广播房间状态快照（讨论流/关键球/额度/结论），接收协作者拖入的文件并交给讨论引擎
// - 协作者（guest）：订阅快照做只读渲染，本地提取拖入文件内容后发给房主
//
// 权限设计：所有「主动操控」（暂停/收敛/整理/回放/额度/插话）只存在于房主页面，
// 协作者侧不渲染这些控件，快照通道也是单向的（房主 → 协作者），协作者唯一能写入的就是文件通道。
import mqtt from 'mqtt'
import type { ExtractedDoc } from '@/ai/document'

const BROKER_URL = 'wss://broker.emqx.io:8084/mqtt'
const STATE_TOPIC = (roomId: string) => `synapsebrain/room/${roomId}/state`
const FILE_TOPIC = (roomId: string) => `synapsebrain/room/${roomId}/file`
const PRESENCE_TOPIC = (roomId: string) => `synapsebrain/room/${roomId}/presence`

/** 房主广播的房间快照（协作者只读渲染的唯一数据源） */
export interface RoomSnapshot {
  name: string
  topic: string
  enginePaused: boolean
  roles: unknown[]
  messages: Record<string, unknown[]>
  spheres: unknown[]
  bubbles: unknown[]
  merged: Record<string, unknown>
  digest: string | null
  conclusions: unknown[]
  guestCount: number
  sentAt: number
}

export interface CollabHandle {
  /** 房主：发布状态快照（内部限流，调用方可以随意频繁调用） */
  publishState: (snap: Omit<RoomSnapshot, 'sentAt'>) => void
  /** 协作者：把本地提取好的文件发给房主 */
  sendFile: (doc: ExtractedDoc) => boolean
  /** 当前在线协作者数（仅房主侧有意义） */
  guestCount: () => number
  close: () => void
}

const MAX_TEXT_CHARS = 30000
/** 图片走 broker 时限高 800KB：dataURL 超限自动降尺寸重编码 */
const MAX_IMAGE_BYTES = 800 * 1024

/** 把图片 dataURL 压到 MAX_IMAGE_BYTES 以内（最长边逐级降档） */
export async function compressImageDataUrl(dataUrl: string): Promise<string> {
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = dataUrl
  })
  let scale = 1
  let out = dataUrl
  for (let i = 0; i < 5; i++) {
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
    out = canvas.toDataURL('image/jpeg', 0.75)
    if (out.length <= MAX_IMAGE_BYTES * 1.37) break // base64 ≈ ×1.37
    scale *= 0.6
  }
  return out
}

/** 连接协作通道。asHost=true 订阅文件/在线频道；asHost=false 订阅状态频道。 */
export function connectCollab(opts: {
  roomId: string
  asHost: boolean
  onState?: (snap: RoomSnapshot) => void
  onFile?: (doc: ExtractedDoc) => void
  onGuestCount?: (n: number) => void
  onStatus?: (msg: string) => void
}): CollabHandle {
  const clientId = `${opts.asHost ? 'host' : 'guest'}-${Math.random().toString(36).slice(2, 10)}`
  const client = mqtt.connect(BROKER_URL, {
    clientId,
    clean: true,
    connectTimeout: 8000,
    reconnectPeriod: 3000,
    keepalive: 20,
  })

  // 房主侧：协作者在线心跳（presence：clientId + beat），45 秒未刷新视为掉线
  const guests = new Map<string, number>()
  let publishTimer: number | null = null
  let pendingSnap: string | null = null
  let closed = false

  client.on('connect', () => {
    opts.onStatus?.('协作通道已连接')
    if (opts.asHost) {
      client.subscribe(FILE_TOPIC(opts.roomId), (err) => err && opts.onStatus?.('文件频道订阅失败'))
      client.subscribe(PRESENCE_TOPIC(opts.roomId), (err) => err && opts.onStatus?.('在线频道订阅失败'))
    } else {
      client.subscribe(STATE_TOPIC(opts.roomId), (err) => err && opts.onStatus?.('状态频道订阅失败'))
    }
  })
  client.on('reconnect', () => opts.onStatus?.('协作通道重连中…'))
  client.on('close', () => { if (!closed) opts.onStatus?.('协作通道已断开，正在重连…') })
  client.on('error', (err) => opts.onStatus?.(`协作通道错误：${err.message}`))

  client.on('message', (topic, payload) => {
    try {
      if (topic === STATE_TOPIC(opts.roomId)) {
        opts.onState?.(JSON.parse(payload.toString()) as RoomSnapshot)
      } else if (topic === FILE_TOPIC(opts.roomId)) {
        opts.onFile?.(JSON.parse(payload.toString()) as ExtractedDoc)
      } else if (topic === PRESENCE_TOPIC(opts.roomId)) {
        const { id, beat } = JSON.parse(payload.toString()) as { id: string; beat: boolean }
        if (beat) {
          guests.set(id, Date.now())
          opts.onGuestCount?.(guests.size)
        }
      }
    } catch {
      /* 坏包直接丢弃 */
    }
  })

  // 房主定时清理掉线协作者
  let pruneTimer: number | undefined
  if (opts.asHost) {
    pruneTimer = window.setInterval(() => {
      const now = Date.now()
      let changed = false
      guests.forEach((last, id) => {
        if (now - last > 45_000) {
          guests.delete(id)
          changed = true
        }
      })
      if (changed) opts.onGuestCount?.(guests.size)
    }, 10_000)
  }

  // 协作者：定时发心跳
  let beatTimer: number | undefined
  if (!opts.asHost) {
    beatTimer = window.setInterval(() => {
      if (client.connected) client.publish(PRESENCE_TOPIC(opts.roomId), JSON.stringify({ id: clientId, beat: true }))
    }, 12_000)
    client.publish(PRESENCE_TOPIC(opts.roomId), JSON.stringify({ id: clientId, beat: true }))
  }

  return {
    publishState: (snap) => {
      if (!opts.asHost || !client.connected) return
      const body = JSON.stringify({ ...snap, sentAt: Date.now() })
      if (publishTimer != null) {
        pendingSnap = body // 限流窗口内只保留最新一份
        return
      }
      client.publish(STATE_TOPIC(opts.roomId), body)
      publishTimer = window.setTimeout(() => {
        publishTimer = null
        if (pendingSnap && client.connected) client.publish(STATE_TOPIC(opts.roomId), pendingSnap)
        pendingSnap = null
      }, 700)
    },
    sendFile: (doc) => {
      if (opts.asHost || !client.connected) return false
      const body = JSON.stringify({
        name: doc.name.slice(0, 120),
        kind: doc.kind,
        content: doc.kind === 'text' ? doc.content.slice(0, MAX_TEXT_CHARS) : doc.content,
        size: doc.size,
        truncated: doc.truncated || doc.content.length > MAX_TEXT_CHARS,
      } satisfies ExtractedDoc)
      if (body.length > 1_100_000) return false // broker 单包上限保护
      client.publish(FILE_TOPIC(opts.roomId), body)
      return true
    },
    guestCount: () => guests.size,
    close: () => {
      closed = true
      if (publishTimer != null) window.clearTimeout(publishTimer)
      if (pruneTimer != undefined) window.clearInterval(pruneTimer)
      if (beatTimer != undefined) window.clearInterval(beatTimer)
      client.end(true)
    },
  }
}
