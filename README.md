# PRD Standalone

AI 辅助 PRD 写作工具，支持一键同步到飞书文档。

本项目有两种使用方式：
- **作为子目录**：放入已有业务项目中（如 `my-project/prd-standalone/`），AI 可直接读取父目录的业务代码来辅助写 PRD
- **独立项目**：单独 clone 使用，通过告诉 AI 业务项目的路径来辅助写 PRD

推荐作为子目录使用，这样 AI 能自动发现并阅读业务代码。

---

## 给 AI Agent 的操作指引

> 当用户让你帮忙把这个项目跑起来时，严格按以下步骤操作。每一步都必须执行，不可跳过。

### 步骤 1：确认 Node.js 环境

运行以下命令检查是否已安装 Node.js：

```bash
node --version
```

- **如果命令不存在**（`command not found`）：需要先安装 Node.js。推荐使用 nvm（Node Version Manager）安装，按以下步骤操作：

```bash
# 1. 安装 nvm（如果没装过）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

# 2. 让 nvm 立即可用（或重开终端）
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# 3. 安装 Node.js v22（本项目开发使用的版本）
nvm install 22

# 4. 验证
node --version   # 应输出 v22.x.x
npm --version    # 应输出 10.x.x
```

- **如果版本低于 v18**：运行 `nvm install 22 && nvm use 22` 升级
- **如果版本 >= v18**：满足要求，继续下一步（推荐 v22）

> Vite 不需要单独安装，`npm install` 会自动安装到项目本地的 `node_modules/` 中。

### 步骤 2：定位项目目录

本项目（`prd-standalone`）可能是：
- 某个业务项目的子目录（如 `~/some-project/prd-standalone/`）
- 独立 clone 的仓库

无论哪种情况，以下所有命令都在 `prd-standalone/` 目录下执行。

### 步骤 3：安装依赖

**必须先 `cd` 进入 `prd-standalone/` 目录再执行 `npm install`**，否则依赖会装到父目录导致项目无法运行：

```bash
cd <prd-standalone 所在的绝对路径>
npm install
```

安装完成后，确认 `prd-standalone/node_modules/` 目录已存在。如果 `node_modules` 出现在父目录而不是 `prd-standalone/` 里，说明 `cd` 没生效，需要删掉父目录的 `node_modules` 然后重新在正确目录执行。

> **给 AI Agent 的提醒**：执行 `npm install` 时必须使用 `working_directory` 参数指向 `prd-standalone/` 的绝对路径，或先用 `cd` 切换到该目录。绝不可在父目录执行。

### 步骤 4：配置环境变量

检查 `prd-standalone/` 根目录是否存在 `.env.local` 文件：

- **如果不存在**：执行 `cp .env.example .env.local`，然后告诉用户：需要填入 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`（向项目负责人索取）。等用户填写完成后继续。
- **如果已存在**：读取内容，检查 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 是否有值。若为空，提示用户填写。

`.env.local` 格式参考 `.env.example`：

```
FEISHU_APP_ID=<向项目负责人索取>
FEISHU_APP_SECRET=<向项目负责人索取>
FEISHU_BASE_URL=http://127.0.0.1:6001
FEISHU_REDIRECT_URI=http://127.0.0.1:6001/__prd__/feishu/auth/callback
```

`FEISHU_BASE_URL` 和 `FEISHU_REDIRECT_URI` 保持默认值即可。

### 步骤 5：启动项目

```bash
bash start.sh
```

脚本会自动完成：检查依赖 → 校验凭据 → 杀掉占用端口的旧进程 → 启动开发服务。

启动成功后终端会打印访问地址：`http://127.0.0.1:6001`

### 步骤 6：确认 Cursor 配置已生效

`.cursor/` 目录包含 AI 写作配置和 MCP 工具，Cursor 打开 `prd-standalone/` 目录后自动加载：

- `.cursor/rules/prd-writing-guard.mdc` — PRD 格式守护（自动应用）
- `.cursor/skills/prd-agent/SKILL.md` — PRD 写作协议
- `.cursor/mcp.json` — Chrome DevTools MCP（用于截图和页面校验）

**重要**：
- 必须用 Cursor 打开 `prd-standalone/` 这个目录（而不是父目录），skills、rules 和 MCP 才会自动生效。
- 首次加载 MCP 后，需要**完全退出并重启 Cursor** 才能识别到 Chrome DevTools MCP。重启后可在 Cursor Settings → MCP 中确认 `chrome-devtools` 状态为绿色。

### 步骤 7：验证

浏览器打开 `http://127.0.0.1:6001`，应该能看到 PRD 编辑页面。

---

## 日常使用

### 启动/重启

每次都用同一个命令（无论从哪个目录执行，脚本都会自动定位到项目根目录）：

```bash
bash <prd-standalone 路径>/start.sh
```

### 写 PRD

在 Cursor 中 `@prd-agent`，用自然语言描述需求。AI 会自动遵守 PRD 的 block 结构约定。

当 `prd-standalone` 作为业务项目的子目录时，可以告诉 AI 去阅读父目录（`../`）的业务代码来辅助撰写 PRD。例如：

> @prd-agent 请阅读 ../src/ 下的会员弹窗相关代码，帮我补充弹窗展示规则的逻辑列

### 同步到飞书

1. 页面右上角点击「同步飞书」
2. 首次需点击「连接飞书」完成 OAuth 授权
3. 粘贴目标飞书 wiki/docx 文档链接
4. 点击「开始同步」

同步策略：首次全量写入，后续仅增量同步变更部分，始终以本地 PRD 为准。

> 建议在飞书文档右上角「…」→「页宽设置」中选择「较宽」。

---

## 项目结构

```
some-project/                 # 业务项目（可选的父目录）
├── src/                      # 业务源码（AI 可读取来辅助写 PRD）
└── prd-standalone/           # ← 本项目
    ├── .cursor/              #   Cursor AI 配置（skills + rules）
    ├── pages/                #   PRD 文档目录
    │   ├── .active-doc.json  #     当前激活文档
    │   └── doc-NNN/          #     每个文档一个目录
    ├── public/prd/           #   截图资产
    ├── src/                  #   前端源码
    ├── start.sh              #   一体化启动脚本
    ├── .env.example          #   环境变量模板
    ├── .env.local            #   实际凭据（不提交 git）
    └── .local/               #   运行时缓存（不提交 git）
```

## 注意事项

- `.env.local` 含飞书密钥，**绝不提交 git**
- `.local/` 是运行时缓存（auth token、同步快照），不提交 git
- 端口 `6001` 必须与飞书应用后台配置的回调地址一致
- 飞书应用需开通权限：`docx:document`、`wiki:wiki:readonly`、`board:whiteboard:node:create`、`board:whiteboard:node:read`、`docs:document.media:upload`、`contact:user.base:readonly`
