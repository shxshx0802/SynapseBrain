// 运行配置：唯一允许读取环境变量的地方（浏览器侧只识别 VITE_ 前缀变量）

function env(key: string, fallback: string): string {
  const v = import.meta.env[key]
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

// ---------- 运行时 API 配置（「接入 API」按钮） ----------
// Vite 环境变量在构建期烘焙进产物，线上用户无法修改 .env；
// 因此界面里保存的 Key 写入 localStorage，运行时优先于构建期 .env。
const RUNTIME_API_KEY = 'ks-api-config'

export interface RuntimeApiConfig {
  key?: string
  baseUrl?: string
  model?: string
}

function loadRuntimeApiConfig(): RuntimeApiConfig {
  try {
    const raw = localStorage.getItem(RUNTIME_API_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as RuntimeApiConfig
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

const runtimeApi = loadRuntimeApiConfig()

export const config = {
  moonshotKey: runtimeApi.key?.trim() || env('VITE_MOONSHOT_API_KEY', ''),
  moonshotBaseUrl: runtimeApi.baseUrl?.trim() || env('VITE_MOONSHOT_BASE_URL', 'https://api.moonshot.cn/v1'),
  moonshotModel: runtimeApi.model?.trim() || env('VITE_MOONSHOT_MODEL', 'kimi-k2.6'),
} as const

export function isLiveMode(): boolean {
  return config.moonshotKey.length > 0
}

/** 界面「接入 API」保存的运行时配置（未配置时为空对象） */
export function getRuntimeApiConfig(): RuntimeApiConfig {
  return runtimeApi
}

/** 保存运行时 API 配置（仅本浏览器 localStorage，不会上传）；保存后需刷新页面生效 */
export function saveApiConfig(patch: RuntimeApiConfig): void {
  try {
    localStorage.setItem(RUNTIME_API_KEY, JSON.stringify({ ...runtimeApi, ...patch }))
  } catch {
    /* 存储不可用时静默 */
  }
}

/** 清除运行时 API 配置（回到 .env / 演示模式）；清除后需刷新页面生效 */
export function clearApiConfig(): void {
  try {
    localStorage.removeItem(RUNTIME_API_KEY)
  } catch {
    /* ignore */
  }
}
