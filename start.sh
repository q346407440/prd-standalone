#!/usr/bin/env bash
set -euo pipefail

PORT=6001
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$PROJECT_DIR"

# ── 0. Node.js 环境检查 ──────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo ""
  echo "============================================================"
  echo "  [!] 未检测到 Node.js，请先安装"
  echo ""
  echo "  推荐使用 nvm 安装："
  echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
  echo "    然后重开终端，运行: nvm install 22"
  echo ""
  echo "  安装完成后重新运行本脚本即可"
  echo "============================================================"
  echo ""
  exit 1
fi

NODE_VER="$(node -e 'console.log(process.versions.node)')"
NODE_OK="$(node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  const ok = (major === 20 && minor >= 19) || (major >= 22 && (major > 22 || minor >= 12));
  console.log(ok ? "1" : "0");
')"
if [ "$NODE_OK" != "1" ]; then
  echo ""
  echo "============================================================"
  echo "  [!] Node.js 版本不满足 Vite 8 要求"
  echo "      当前: v${NODE_VER}，要求: ^20.19.0 || >=22.12.0"
  echo "  推荐运行: nvm install 22 && nvm use 22"
  echo "============================================================"
  echo ""
  exit 1
fi

echo "[check] Node.js $(node --version) ✓"

# ── 0b. Cursor MCP：按 args 检测 chrome-devtools-mcp@latest，缺失则写入 ~/.cursor/mcp.json ──
node "$PROJECT_DIR/scripts/ensure-chrome-devtools-mcp.js" || true

# ── 1. 依赖安装 ──────────────────────────────────────────────────────────────
if [ ! -d "node_modules" ]; then
  echo "[setup] node_modules 不存在，正在安装依赖..."
  npm install --prefix "$PROJECT_DIR"
  echo "[setup] 依赖安装完成"
fi

if [ ! -d "node_modules/vite" ]; then
  echo "[error] node_modules 安装异常（缺少 vite），尝试重新安装..."
  rm -rf node_modules package-lock.json
  npm install --prefix "$PROJECT_DIR"
fi

echo "[check] node_modules 已就绪"

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

# ── 4. 检查端口占用，复用已有服务或清理后重启 ────────────────────────────────
OLD_PIDS="$(lsof -ti:"$PORT" 2>/dev/null || true)"
if [ -n "$OLD_PIDS" ]; then
  ALREADY_RUNNING=false
  for pid in $OLD_PIDS; do
    PROC_CWD="$(lsof -p "$pid" -Fn 2>/dev/null | grep '^n.*'"$PROJECT_DIR" | head -1 || true)"
    PROC_CMD="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    if [[ "$PROC_CMD" == *vite* && -n "$PROC_CWD" ]]; then
      ALREADY_RUNNING=true
      break
    fi
  done

  if [ "$ALREADY_RUNNING" = true ]; then
    echo ""
    echo "============================================================"
    echo "  [ok] 端口 $PORT 上已运行本项目的 Vite 服务 (PID: $OLD_PIDS)"
    echo "  访问地址: http://127.0.0.1:$PORT"
    echo "  无需重启，直接使用即可"
    echo "============================================================"
    echo ""
    exit 0
  fi

  echo "[restart] 终止占用端口 $PORT 的非本项目进程: $OLD_PIDS"
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
