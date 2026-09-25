// AI Provider 抽象：业务代码只允许通过本文件访问模型厂商，禁止直接 import 任何厂商 SDK
import { config } from '@/shared/config'

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatResult {
  text: string
  /** 本次调用消耗的 token 总数（用于额度管家记账） */
  tokens: number
}

export interface ChatProvider {
  id: string
  label: string
  chat(messages: ProviderMessage[], opts?: { temperature?: number; maxTokens?: number }): Promise<ChatResult>
}

/** Moonshot Kimi（OpenAI 兼容接口）。文档：https://platform.moonshot.cn/docs */
function createMoonshotProvider(): ChatProvider {
  return {
    id: 'moonshot',
    label: `Kimi ${config.moonshotModel}`,
    async chat(messages, opts) {
      const res = await fetch(`${config.moonshotBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.moonshotKey}`,
        },
        body: JSON.stringify({
          model: config.moonshotModel,
          messages,
          // 部分网关模型（如 agent-gw 的 k2d8-preview）只允许 temperature=1：
          // 不传则交给服务端默认值，避免 400
          ...(opts?.temperature != null ? { temperature: opts.temperature } : {}),
          max_tokens: opts?.maxTokens ?? 400,
        }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Kimi API ${res.status}: ${body.slice(0, 200)}`)
      }
      const data = await res.json()
      const text: string = data.choices?.[0]?.message?.content ?? ''
      if (!text) throw new Error('Kimi API 返回了空内容')
      const tokens: number = data.usage?.total_tokens ?? Math.ceil(text.length / 2)
      return { text: text.trim(), tokens }
    },
  }
}

/** 有 key 返回真实 provider，没有返回 null（调用方回退演示模式） */
export function createDefaultProvider(): ChatProvider | null {
  return config.moonshotKey ? createMoonshotProvider() : null
}
