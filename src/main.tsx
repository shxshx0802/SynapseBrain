import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'

// GitHub Pages 部署在 /SynapseBrain/ 子路径；本地开发仍是根路径。
// BASE_URL 为 './'（本地）时按 '/' 处理，为 '/SynapseBrain/'（线上）时作为 router basename。
const baseUrl = import.meta.env.BASE_URL
const basename = baseUrl.startsWith('/') ? baseUrl : '/'

// SPA 回退恢复：GitHub Pages 对未知路径返回 404.html，
// 其中脚本把原始路径编码进 ?p= 参数跳转回首页，这里还原为真实路由（刷新/直链不丢页面）
const restored = new URLSearchParams(window.location.search).get('p')
if (restored) {
  const prefix = basename.endsWith('/') ? basename.slice(0, -1) : basename
  window.history.replaceState(null, '', prefix + restored + window.location.hash)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
