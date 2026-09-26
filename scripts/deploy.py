# -*- coding: utf-8 -*-
"""一键部署：把 dist/ 通过 GitHub REST API 推送到 gh-pages 分支（不依赖 git 协议）。

用法（在项目根目录）：
    npm run deploy        # = vite build（自动带 /SynapseBrain/ base）+ 本脚本

说明：
- 走 api.github.com REST 接口逐文件建 blob/tree/commit 并强推 gh-pages 引用，
  绕过本机 github.com:443 常被掐断导致 git push 失败的问题。
- Token 从本机 git 凭据管理器读取（git credential fill），不落盘、不进仓库。
- 首次运行会自动在仓库上启用 GitHub Pages（source = gh-pages 分支根目录）。
"""
import base64
import json
import os
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
OWNER, REPO = "shxshx0802", "SynapseBrain"

if not os.path.isdir(DIST):
    raise SystemExit(f"未找到构建产物 {DIST}，请先运行 npm run deploy（脚本会先构建）")

# GitHub Pages 默认用 Jekyll 构建，会忽略下划线开头的路径；空 .nojekyll 关闭它以放行 wasm 等文件
NOJEKYLL = os.path.join(DIST, ".nojekyll")
if not os.path.exists(NOJEKYLL):
    open(NOJEKYLL, "wb").close()

def get_token():
    p = subprocess.run(["git", "credential", "fill"], input="url=https://github.com\n\n",
                       capture_output=True, text=True, cwd=ROOT)
    for line in p.stdout.splitlines():
        if line.startswith("password="):
            return line.split("=", 1)[1]
    raise SystemExit("无法从 git 凭据管理器获取 GitHub Token（需要本机登录过 github.com）")

TOKEN = get_token()

def api(method, path, payload=None):
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "synapsebrain-deploy",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode() or "{}"), r.status
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:300]
        return {"error": body}, e.code

# 1) 收集 dist 文件
files = []
for dirpath, _, names in os.walk(DIST):
    for name in names:
        full = os.path.join(dirpath, name)
        rel = os.path.relpath(full, DIST).replace("\\", "/")
        files.append((rel, full))
files.sort()
print(f"{len(files)} files to upload")

# 2) 逐个建 blob
entries = []
for rel, full in files:
    with open(full, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    data, code = api("POST", f"/repos/{OWNER}/{REPO}/git/blobs", {"content": b64, "encoding": "base64"})
    if code not in (200, 201):
        print(f"blob fail {rel}: {code} {data}")
        sys.exit(1)
    entries.append({"path": rel, "mode": "100644", "type": "blob", "sha": data["sha"]})
    print(f"  blob ok: {rel} ({len(b64) // 1024} KB)")

# 3) tree + commit
data, code = api("POST", f"/repos/{OWNER}/{REPO}/git/trees", {"tree": entries})
if code not in (200, 201):
    print(f"tree fail: {code} {data}")
    sys.exit(1)
tree_sha = data["sha"]
data, code = api("POST", f"/repos/{OWNER}/{REPO}/git/commits", {
    "message": "deploy: GitHub Pages 线上版本", "tree": tree_sha})
if code not in (200, 201):
    print(f"commit fail: {code} {data}")
    sys.exit(1)
commit_sha = data["sha"]

# 4) 更新/创建 gh-pages 引用
data, code = api("POST", f"/repos/{OWNER}/{REPO}/git/refs", {
    "ref": "refs/heads/gh-pages", "sha": commit_sha})
if code in (200, 201):
    print("ref created")
elif code == 422:
    data, code = api("PATCH", f"/repos/{OWNER}/{REPO}/git/refs/heads/gh-pages", {
        "sha": commit_sha, "force": True})
    if code not in (200, 201):
        print(f"ref update fail: {code} {data}")
        sys.exit(1)
    print("ref force-updated")
else:
    print(f"ref fail: {code} {data}")
    sys.exit(1)

# 5) 启用 Pages（已启用时 409 属正常）
data, code = api("POST", f"/repos/{OWNER}/{REPO}/pages", {
    "source": {"branch": "gh-pages", "path": "/"}})
if code in (200, 201):
    print("Pages enabled:", data.get("html_url"))
elif code == 409:
    print("Pages already enabled")
else:
    print(f"pages enable fail: {code} {data}")

print("commit:", commit_sha)
print("线上地址: https://shxshx0802.github.io/SynapseBrain/ （Pages 重建约需 1-2 分钟）")
