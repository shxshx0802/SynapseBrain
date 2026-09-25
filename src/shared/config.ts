// 运行配置：唯一允许读取环境变量的地方（浏览器侧只识别 VITE_ 前缀变量）

function env(key: string, fallback: string): string {
  const v = import.meta.env[key]
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

export const config = {
  moonshotKey: env('VITE_MOONSHOT_API_KEY', ''),
  moonshotBaseUrl: env('VITE_MOONSHOT_BASE_URL', 'https://api.moonshot.cn/v1'),
  moonshotModel: env('VITE_MOONSHOT_MODEL', 'kimi-k2.6'),
} as const

export function isLiveMode(): boolean {
  return config.moonshotKey.length > 0
}
