#!/usr/bin/env bash
set -euo pipefail

PORT=6001
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
UPDATE_INFO_FILE=""

cd "$PROJECT_DIR"

cleanup_temp_files() {
  if [ -n "${UPDATE_INFO_FILE:-}" ] && [ -f "$UPDATE_INFO_FILE" ]; then
    rm -f "$UPDATE_INFO_FILE"
  fi
}

trap cleanup_temp_files EXIT

json_get() {
  local field="$1"
  node --input-type=module -e '
    import fs from "fs";

    const [filePath, fieldName] = process.argv.slice(1);
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const value = fieldName.split(".").reduce((acc, key) => (
      acc == null ? undefined : acc[key]
    ), data);

    if (value == null) process.exit(0);
    if (typeof value === "object") {
      process.stdout.write(JSON.stringify(value));
      process.exit(0);
    }
    process.stdout.write(String(value));
  ' "$UPDATE_INFO_FILE" "$field"
}

json_lines() {
  local field="$1"
  local prefix="$2"
  node --input-type=module -e '
    import fs from "fs";

    const [filePath, fieldName, prefix] = process.argv.slice(1);
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const value = fieldName.split(".").reduce((acc, key) => (
      acc == null ? undefined : acc[key]
    ), data);

    if (!Array.isArray(value)) process.exit(0);
    value
      .map((item) => String(item).trim())
      .filter(Boolean)
      .forEach((item) => console.log(`${prefix}${item}`));
  ' "$UPDATE_INFO_FILE" "$field" "$prefix"
}

refresh_update_info() {
  if [ -z "${UPDATE_INFO_FILE:-}" ]; then
    UPDATE_INFO_FILE="$(mktemp -t prd-release-check.XXXXXX)"
  fi
  node "$PROJECT_DIR/scripts/check-release-update.js" > "$UPDATE_INFO_FILE"
}

print_release_block() {
  local root="$1"
  local label="$2"
  local detail_mode="${3:-full}"
  local version=""
  local date=""
  local message=""
  local summary_lines=""

  version="$(json_get "${root}.version")"
  date="$(json_get "${root}.date")"
  message="$(json_get "${root}.message")"
  summary_lines="$(json_lines "${root}.summary" "  - ")"

  if [ -n "$version" ]; then
    echo "  ${label}: v${version}"
  fi
  if [ -n "$date" ]; then
    echo "  发布时间: ${date}"
  fi
  if [ "$detail_mode" = "full" ] && [ -n "$summary_lines" ]; then
    echo "  本次更新："
    printf '%s\n' "$summary_lines"
  fi
  if [ "$detail_mode" = "full" ] && [ -n "$message" ]; then
    echo "  提示：${message}"
  fi
}

# ── 0. Node.js 环境检查 ──────────────────────────────────────────────────────
# 非交互 shell 里可能还没加载 nvm，先补一次再检测 node。
if ! command -v node &>/dev/null; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
    if ! command -v node &>/dev/null && command -v nvm &>/dev/null; then
      nvm use --silent 22 >/dev/null 2>&1 || nvm use --silent default >/dev/null 2>&1 || true
    fi
  fi
fi

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

# ── 0b. GitHub 更新检查（可跳过）──────────────────────────────────────────────
refresh_update_info
UPDATE_STATUS="$(json_get status)"

case "$UPDATE_STATUS" in
  up-to-date)
    echo "[check] GitHub 版本已是最新 ✓"
    ;;
  not-git)
    echo "[update] 当前目录不是 Git 仓库，跳过版本检查"
    ;;
  no-upstream)
    echo "[update] 当前分支未配置上游分支，跳过版本检查"
    ;;
  fetch-failed)
    echo "[update] 获取远端更新失败，继续使用本地版本启动"
    FETCH_ERROR="$(json_get git.fetchError)"
    if [ -n "$FETCH_ERROR" ]; then
      echo "        ${FETCH_ERROR}"
    fi
    ;;
  compare-failed)
    echo "[update] 比较本地与远端版本失败，继续使用本地版本启动"
    COMPARE_ERROR="$(json_get git.compareError)"
    if [ -n "$COMPARE_ERROR" ]; then
      echo "        ${COMPARE_ERROR}"
    fi
    ;;
  local-ahead)
    echo "[update] 当前分支存在本地提交领先于远端，跳过自动更新"
    ;;
  diverged)
    echo "[update] 当前分支与远端已分叉，请手动处理后再更新"
    ;;
  remote-ahead)
    echo ""
    echo "============================================================"
    echo "  [update] 检测到 GitHub 上有新版本"
    print_release_block "local" "当前版本" "compact"
    print_release_block "remote" "最新版本" "full"

    DIRTY_TRACKED="$(json_get git.dirtyTracked)"
    if [ "$DIRTY_TRACKED" = "true" ]; then
      echo ""
      echo "  [!] 检测到本地有未提交的已跟踪改动，暂不自动更新"
      echo "  [!] 请先提交或处理这些改动，再重新运行 start.sh"
      echo "============================================================"
      echo ""
    else
      while true; do
        echo ""
        echo "  输入 1 更新后继续启动"
        echo "  输入 0 跳过更新直接启动"
        read -r -p "  请选择 [1/0]: " UPDATE_CHOICE
        case "$UPDATE_CHOICE" in
          1)
            if git pull --ff-only; then
              refresh_update_info
              echo ""
              echo "  [ok] 已更新到最新版本"
              print_release_block "local" "当前版本" "full"
            else
              echo ""
              echo "  [!] 自动更新失败，请手动执行 git pull --ff-only 后重试"
            fi
            break
            ;;
          0)
            echo ""
            echo "  [skip] 已跳过更新，将继续使用当前本地版本启动"
            break
            ;;
          *)
            echo "  [!] 请输入 1 或 0"
            ;;
        esac
      done
      echo "============================================================"
      echo ""
    fi
    ;;
esac

# ── 0c. Cursor MCP：按 args 检测 chrome-devtools-mcp@latest，缺失则写入 ~/.cursor/mcp.json ──
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
