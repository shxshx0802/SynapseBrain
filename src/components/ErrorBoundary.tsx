import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

interface Props {
  children: ReactNode
  /** 自定义兜底视图；不传则使用全屏兜底 */
  fallback?: (error: Error, retry: () => void) => ReactNode
}

/** 渲染错误边界：任何 React 渲染异常都显示为可见的错误界面，而不是黑屏。
    支持局部边界（自定义 fallback 只替换出错的子树）与全局边界（默认全屏兜底） */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: unknown) {
    try {
      const ring = JSON.parse(localStorage.getItem('ks-errors') || '[]') as Array<{ t: number; msg: string }>
      ring.push({ t: Date.now(), msg: `${String(error?.message || error)} | ${JSON.stringify(info).slice(0, 300)}` })
      localStorage.setItem('ks-errors', JSON.stringify(ring.slice(-10)))
    } catch {
      /* 存储不可用时忽略 */
    }
  }

  retry = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.retry)
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-black p-8 text-center">
          <p className="text-lg font-bold text-white">页面渲染出错（已被错误边界拦截，没有黑屏）</p>
          <p className="max-w-xl text-sm break-all text-red-400">{String(this.state.error.message || this.state.error)}</p>
          <button
            className="rounded-lg border border-white/20 px-4 py-2 text-sm text-slate-200 transition-colors hover:bg-white/10"
            onClick={() => window.location.reload()}
          >
            刷新页面恢复
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
