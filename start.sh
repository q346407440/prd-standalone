#!/usr/bin/env bash
set -euo pipefail

PORT=6001
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$PROJECT_DIR"

# ── 1. 依赖安装 ──────────────────────────────────────────────────────────────
if [ ! -d "node_modules" ]; then
  echo "[setup] node_modules 不存在，正在安装依赖..."
  npm install
  echo "[setup] 依赖安装完成"
else
  echo "[check] node_modules 已存在，跳过安装"
fi

# ── 2. 环境变量检查 ───────────────────────────────────────────────────────────
if [ ! -f ".env.local" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env.local
    echo ""
    echo "============================================================"
    echo "  [!] 已从 .env.example 创建 .env.local"
    echo "  [!] 请编辑 .env.local 填入 FEISHU_APP_ID 和 FEISHU_APP_SECRET"
    echo "  [!] 填写完成后重新运行本脚本即可"
    echo "============================================================"
    echo ""
    exit 1
  else
    echo "[error] 缺少 .env.example 和 .env.local，请检查项目完整性"
    exit 1
  fi
fi

source_env() {
  while IFS='=' read -r key value; do
    key="$(echo "$key" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"
    [[ -z "$key" || "$key" == \#* ]] && continue
    value="$(echo "$value" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"
    export "$key=$value"
  done < .env.local
}
source_env

if [ -z "${FEISHU_APP_ID:-}" ] || [ -z "${FEISHU_APP_SECRET:-}" ]; then
  echo ""
  echo "============================================================"
  echo "  [!] .env.local 中 FEISHU_APP_ID 或 FEISHU_APP_SECRET 为空"
  echo "  [!] 请向项目负责人索取并填入 .env.local"
  echo "  [!] 填写完成后重新运行本脚本即可"
  echo "============================================================"
  echo ""
  exit 1
fi

echo "[check] 飞书凭据已配置"

# ── 3. 确保 .local 目录存在 ──────────────────────────────────────────────────
mkdir -p .local

# ── 4. 杀掉占用端口的旧进程 ──────────────────────────────────────────────────
OLD_PIDS="$(lsof -ti:"$PORT" 2>/dev/null || true)"
if [ -n "$OLD_PIDS" ]; then
  echo "[restart] 终止占用端口 $PORT 的旧进程: $OLD_PIDS"
  echo "$OLD_PIDS" | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# ── 5. 启动开发服务 ──────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  PRD Standalone 正在启动..."
echo "  访问地址: http://127.0.0.1:$PORT"
echo "============================================================"
echo ""

exec npx vite --host 127.0.0.1 --port "$PORT"
