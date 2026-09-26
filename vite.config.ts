import path from "path"
import type { ClientRequest } from "http"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// GitHub Pages 部署在 /SynapseBrain/ 子路径：GH_PAGES=1 npm run build 时切换 base，
// 使资源引用与路由 basename 都带上子路径；本地开发保持 './' 不变
const ghPages = process.env.GH_PAGES === '1'

// https://vite.dev/config/
export default defineConfig({
  base: ghPages ? '/SynapseBrain/' : './',
  plugins: [inspectAttr(), react()],
  server: {
    port: 7100,
    proxy: {
      // 浏览器直连 agent-gw.kimi.com 会被 CORS 拦截，走 dev server 代理转发。
      // 网关校验 Origin 白名单（只允许已注册来源），代理需剥除浏览器 Origin/Referer，
      // 否则一律 403 origin_not_allowed。
      // vite 7 代理基于 httpxy，用 configure 钩子挂 proxyReq 事件（onProxyReq 属性已无效）
      '/ai-gw': {
        target: 'https://agent-gw.kimi.com',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/ai-gw/, '/coding'),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq: ClientRequest) => {
            proxyReq.removeHeader('origin')
            proxyReq.removeHeader('referer')
          })
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
