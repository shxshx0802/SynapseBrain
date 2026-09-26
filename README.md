# SynapseBrain

多 AI 协作讨论画布。多个 AI 分方向就一个议题并行讨论，讨论过程中自动生成「关键球」——每个关键球是一个方向的精确表达；人与 AI 在同一块黑底画布上协作：拖入文件让 AI 研读、随时插话、用手势和语音直接控场。

**在线体验（演示模式，零安装零消耗）**：https://shxshx0802.github.io/SynapseBrain/

## 快速开始

```bash
npm install
npm run dev        # http://localhost:7100
```

线上部署（GitHub Pages）：`GH_PAGES=1 npm run build` 后把 `dist/` 发布到 `gh-pages` 分支即可。

复制 `.env.example` 为 `.env` 并填入 `VITE_MOONSHOT_API_KEY` 即可接入真实模型（Kimi）；不配置则运行**演示模式**（本地话术池，零消耗，全部功能可用）。
