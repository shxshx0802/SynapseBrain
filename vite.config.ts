import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react()],
  server: {
    port: 7100,
    proxy: {
      // 浏览器直连 agent-gw.kimi.com 会被 CORS 拦截，走 dev server 代理转发
      '/ai-gw': {
        target: 'https://agent-gw.kimi.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ai-gw/, '/coding'),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
