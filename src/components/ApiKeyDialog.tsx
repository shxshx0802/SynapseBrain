// 「接入 API」配置弹窗：运行时把 Kimi API Key 存入 localStorage，保存后刷新页面
// 让讨论引擎以真实模型模式重启（Vite 环境变量是构建期烘焙的，线上用户改不了 .env，
// 所以必须走 localStorage 运行时覆盖，见 shared/config.ts）
import { useState } from 'react'
import { CheckCircle2, Eye, EyeOff, Loader2, Plug, Trash2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { clearApiConfig, config, getRuntimeApiConfig, isLiveMode, saveApiConfig } from '@/shared/config'

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; model: string }
  | { kind: 'fail'; reason: string; cors: boolean }

export function ApiKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const runtime = getRuntimeApiConfig()
  const live = isLiveMode()
  const [key, setKey] = useState(runtime.key ?? '')
  const [baseUrl, setBaseUrl] = useState(runtime.baseUrl ?? config.moonshotBaseUrl)
  const [model, setModel] = useState(runtime.model ?? config.moonshotModel)
  const [showKey, setShowKey] = useState(false)
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  const [saving, setSaving] = useState(false)

  const testConnection = async () => {
    const k = key.trim()
    if (!k) {
      setTest({ kind: 'fail', reason: '请先填写 API Key', cors: false })
      return
    }
    setTest({ kind: 'testing' })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
      const res = await fetch(`${baseUrl.trim().replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` },
        body: JSON.stringify({
          model: model.trim(),
          messages: [{ role: 'user', content: 'ping，只回复 pong' }],
          max_tokens: 8,
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        setTest({ kind: 'fail', reason: `HTTP ${res.status}：${body.slice(0, 160)}`, cors: false })
        return
      }
      const data = await res.json()
      const reply: string = data.choices?.[0]?.message?.content ?? ''
      setTest({ kind: 'ok', model: (data.model as string | undefined) ?? model.trim() })
      void reply
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // fetch 被浏览器拦截（跨域 CORS / 网络不可达）时表现为 TypeError，给针对性提示
      const cors = e instanceof TypeError || /failed to fetch|networkerror|abort/i.test(msg)
      setTest({
        kind: 'fail',
        reason: cors ? `无法连通（可能被浏览器跨域拦截）：${msg}` : msg,
        cors,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  const saveAndReload = () => {
    setSaving(true)
    saveApiConfig({ key: key.trim(), baseUrl: baseUrl.trim(), model: model.trim() })
    window.location.reload()
  }

  const clearAndReload = () => {
    setSaving(true)
    clearApiConfig()
    window.location.reload()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/15 bg-black/95 text-slate-100 shadow-2xl backdrop-blur sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Plug className="h-4 w-4" />
            接入 Kimi API
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            填入 Moonshot API Key 后，讨论引擎将从演示模式切换为真实模型（Kimi 实时模式）。
            Key 只保存在本浏览器 localStorage，不会上传到任何地方。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <Label htmlFor="api-key" className="text-xs text-slate-400">
              API Key（platform.moonshot.cn 创建）
            </Label>
            <div className="relative">
              <Input
                id="api-key"
                type={showKey ? 'text' : 'password'}
                value={key}
                onChange={(e) => { setKey(e.target.value); setTest({ kind: 'idle' }) }}
                placeholder="sk-..."
                autoComplete="off"
                className="h-10 border-white/10 bg-black/60 pr-10 text-slate-100 focus-visible:border-white/30"
              />
              <button
                type="button"
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-500 transition-colors hover:text-slate-300"
                onClick={() => setShowKey((v) => !v)}
                title={showKey ? '隐藏 Key' : '显示 Key'}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="api-base" className="text-xs text-slate-400">
                Base URL
              </Label>
              <Input
                id="api-base"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="h-10 border-white/10 bg-black/60 text-slate-100 focus-visible:border-white/30"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="api-model" className="text-xs text-slate-400">
                模型
              </Label>
              <Input
                id="api-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="h-10 border-white/10 bg-black/60 text-slate-100 focus-visible:border-white/30"
              />
            </div>
          </div>

          {/* 连接测试结果 */}
          {test.kind === 'testing' && (
            <p className="flex items-center gap-1.5 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在测试连接…
            </p>
          )}
          {test.kind === 'ok' && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> 连接成功，{test.model} 响应正常。保存后生效。
            </p>
          )}
          {test.kind === 'fail' && (
            <div className="space-y-1">
              <p className="flex items-start gap-1.5 text-xs text-red-400">
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="break-all">{test.reason}</span>
              </p>
              {test.cors && (
                <p className="pl-5 text-[11px] leading-relaxed text-slate-500">
                  浏览器直连该接口被跨域拦截。默认的 api.moonshot.cn 支持浏览器访问；
                  若使用第三方网关，建议本地部署（npm run dev 自带代理转发）后再接入。
                </p>
              )}
            </div>
          )}

          {live && (
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] leading-relaxed text-emerald-300/90">
              当前已是实时模式。修改后点「保存并重启」生效；点「清除配置」可退回演示模式。
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            {live && (
              <Button
                size="sm"
                variant="outline"
                className="h-9 border-red-500/30 bg-black/50 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
                onClick={clearAndReload}
                disabled={saving}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                清除配置
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-9 border-white/15 bg-black/50 text-xs hover:bg-white/10"
              onClick={testConnection}
              disabled={test.kind === 'testing' || saving}
            >
              {test.kind === 'testing' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              测试连接
            </Button>
            <Button
              size="sm"
              className="h-9 bg-white text-xs text-black hover:bg-slate-200"
              onClick={saveAndReload}
              disabled={saving || !key.trim()}
            >
              {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              保存并重启
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
