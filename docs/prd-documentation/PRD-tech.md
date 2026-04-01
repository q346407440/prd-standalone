# PRD 页面技术方案文档

> **存放位置**：`docs/prd-documentation/PRD-tech.md`（说明文档，**非**业务 PRD 正文）。  
> 实际 PRD 正文见项目根目录 `pages/prd/prd.md`。

> 本文档记录 **PRD 独立项目**（`prd-standalone`）中编辑器页的技术架构、依赖库、数据流与关键实现细节。  
> **维护方式**：凡涉及技术方案变动（新增依赖、架构调整、API 变更、构建配置变更），须在合入代码后同步更新本文档。

---

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0 | 2026-03-26 | 初版：记录 PRD 页面从零搭建至 Markdown 真相架构（方案 C）的完整技术方案 |
| 1.1 | 2026-03-26 | Block 编辑器架构 |
| 1.3 | 2026-03-26 | 排序交互：上移/下移按钮 |
| 1.2 | 2026-03-26 | 目录约定 |
| 2.0 | 2026-03-27 | **Tiptap 富文本编辑器**：引入 Tiptap 替代 textarea，实现 WYSIWYG 编辑（粗体/斜体/链接即时渲染）；**自定义列表系统**（markdown 前缀管理，支持无限层级缩进、有序/无序列表、数字/字母交替序号、连续 block 自动编号）；**图片系统**（粘贴上传、空 block 替换、表格 cell 内粘贴、拖曳调整大小、点击放大 lightbox）；**表格交互**（列/行选中条、hover 插入 handle、增删行列）；**全局选中态管理**；**性能优化**（TiptapPreview 改为 markdown-it 轻量渲染） |
| 2.2 | 2026-03-31 | **Mermaid 图表 block**（`mermaid` 库，顶层 + 表格 cell 内嵌，视图模式切换、四角 resize、Lightbox 放大）；**Mindmap 思维导图 block**（`markmap-lib` + `markmap-view`，Markdown 缩进列表格式，禁用内置 pan/zoom/动画，静态缩略图）；**通用 PrdLightbox 组件**（图片/Mermaid/Mindmap 共用，fit-to-viewport 初始比例、5% 步长缩放、百分比输入框手动输入、拖拽平移、`visibility:hidden` + loading spinner 防闪烁）；`prd.meta.json` 新增 `mermaidViewModes`、`mermaidWidths`、`mindmapViewModes`、`mindmapWidths` 字段；meta key 使用 djb2 内容哈希 |

---

## 一、技术栈概览

| 层次 | 技术选型 | 说明 |
|------|---------|------|
| 前端框架 | React 19 | 函数组件 + Hooks |
| 构建工具 | Vite 8 | 开发服务器 + 构建；自定义插件处理 PRD 专属 API |
| 富文本编辑 | Tiptap 3 + ProseMirror | WYSIWYG 编辑器，支持粗体、斜体、链接的即时渲染 |
| Markdown 序列化 | tiptap-markdown 0.9 | Tiptap ↔ Markdown 双向转换 |
| 预览态渲染 | markdown-it | 轻量 HTML 渲染（不创建 Tiptap editor 实例） |
| 内容真相 | `prd.md`（纯文本） | 唯一数据源；解析/序列化由项目内自研模块完成 |
| 样式 | 原生 CSS（BEM 命名） | 无 CSS-in-JS；无 Tailwind |
| 图片存储 | 本地文件系统（`public/prd/`） | 开发/预览态通过 Vite 插件写入 |

---

## 二、三方库详情

### 2.1 运行时依赖（`dependencies`）

| 包名 | 版本约束 | 用途 | 引入时机 |
|------|---------|------|---------|
| `react` | `^19.2.4` | 核心框架 | 项目初始 |
| `react-dom` | `^19.2.4` | DOM 渲染 | 项目初始 |
| `@tiptap/react` | `^3.20.5` | Tiptap React 绑定（`useEditor`、`EditorContent`） | 富文本编辑器引入 |
| `@tiptap/starter-kit` | `^3.20.5` | Tiptap 基础 extension 集合（段落、粗体、斜体等） | 富文本编辑器引入 |
| `@tiptap/extension-link` | `^3.20.5` | 链接 extension（插入/编辑超链接） | 富文本编辑器引入 |
| `@tiptap/extension-placeholder` | `^3.20.5` | 空编辑器占位文字 | 富文本编辑器引入 |
| `@tiptap/pm` | `^3.20.5` | ProseMirror 核心（Tiptap 对等依赖） | 富文本编辑器引入 |
| `tiptap-markdown` | `^0.9.0` | Tiptap ↔ Markdown 双向转换（`setContent` 接受 Markdown，`getMarkdown` 输出 Markdown） | 富文本编辑器引入 |
| `react-markdown` | `^10.1.0` | Markdown 渲染（部分旧组件仍使用） | PRD 页引入 |
| `remark-gfm` | `^4.0.1` | react-markdown 插件，支持 GFM 表格 | PRD 页引入 |
| `mermaid` | `^11.x` | Mermaid 图表渲染（流程图、时序图等） | Mermaid block 引入 |
| `markmap-lib` | `^0.x` | Markmap Transformer：Markdown 列表 → 树形数据 | Mindmap block 引入 |
| `markmap-view` | `^0.x` | Markmap SVG 渲染器 | Mindmap block 引入 |

> **注意**：`markdown-it` 不需要单独安装，它是 `tiptap-markdown` 的依赖，直接 import 即可使用。

### 2.2 开发依赖（`devDependencies`）

| 包名 | 版本约束 | 用途 |
|------|---------|------|
| `vite` | `^8.0.1` | 构建工具与开发服务器 |
| `@vitejs/plugin-react` | `^6.0.1` | Vite React 插件（JSX 转换、Fast Refresh） |
| `eslint` | `^9.39.4` | 代码检查 |

---

## 三、架构设计

### 3.1 内容真相架构（Block 格式 v2）

PRD 内容以 **`prd.md`** 为唯一真相，采用扁平 Block 格式。数据流：

```
prd.md（Block 格式 v2）
    ↓ GET /pages/prd/prd.md（Vite 插件）
prd-parser.js → Block[]
    ↓
React 渲染（PrdPage.jsx）：BlockItem × N
    ↓ 用户编辑（Tiptap 富文本 / 上移下移 / 增删）
prd-writer.js → serializePrd(Block[]) → Markdown
    ↓ POST /__prd__/save-md（Vite 插件，防抖 480ms）
prd.md（更新）
```

### 3.2 富文本编辑器架构（Tiptap + 自定义列表）

#### 3.2.1 核心组件：`TiptapMarkdownEditor`

每个可编辑的文本区域（顶层 block 或表格 cell）对应一个 `TiptapMarkdownEditor` 实例。

**双态切换**：
- **预览态**（`editing=false`）：用 `markdown-it` 的 `renderInline` 渲染 HTML，不创建 Tiptap editor 实例（性能优化）
- **编辑态**（`editing=true`）：激活 Tiptap editor，支持粗体、斜体、链接的 WYSIWYG 编辑

**Tiptap 配置**：
```
StarterKit（禁用：heading, codeBlock, horizontalRule, bulletList, orderedList, listItem, link）
+ Link（自定义配置）
+ Placeholder
+ Markdown（tiptap-markdown）
```

> **关键设计**：Tiptap 的 `bulletList`、`orderedList`、`listItem` 节点被完全禁用。列表功能由外层 markdown 前缀系统管理。

#### 3.2.2 自定义列表系统

列表不使用 Tiptap/ProseMirror 的原生列表节点，而是通过 **markdown 前缀**管理。每个列表项是一个独立的 block/element，其 markdown 内容包含完整的前缀（如 `- text`、`  a. text`）。

**前缀格式**：
```
无序列表：  - text        （第一层）
            - text        （第二层，2 空格缩进）
有序列表：  1. text       （第一层，数字序号）
            a. text       （第二层，字母序号）
              1. text     （第三层，数字序号）
              a. text     （第四层，字母序号）
```

**前缀拆分机制**：
- 进入编辑态时，markdown 被拆分为 `prefix`（如 `  a. `）和 `body`（纯文本/行内格式）
- `prefix` 存在 `prefixRef` 中，`body` 交给 Tiptap 渲染
- commit 时合并回完整 markdown：`prefix + body`
- 视觉上，前缀在 Tiptap 编辑框左侧渲染为 bullet 符号或序号

**列表操作**：

| 操作 | 快捷键 | 行为 |
|------|--------|------|
| 切换无序列表 | `Cmd+Shift+8` | toggle `- ` 前缀 |
| 切换有序列表 | `Cmd+Shift+7` | toggle `1. ` 前缀 |
| 缩进 | `Tab` | 增加 2 空格缩进；有序列表自动切换数字↔字母（重置为起始值） |
| 取消缩进 | `Shift+Tab` | 减少 2 空格缩进；有序列表自动切换字母↔数字 |
| 手动触发列表 | 输入 `数字.空格` 或 `字母.空格` 或 `-空格` | 在行首输入后自动转为列表前缀 |
| Enter | `Enter` | commit 当前 block + 创建新 block（继承完整前缀和层级，序号递增） |
| 取消列表 | `Backspace`（内容为空时） | 移除列表前缀 |

**连续 block 自动编号**：

有序列表的序号不是孤立计算的，而是根据上下文连续 block 来决定：
- `renumberOrderedBlocksFrom`：从群组起始 block 开始，向下重新编号所有同层级的有序列表 block
- `findOrderedGroupStart`：向上扫描找到同层级有序列表群组的起始位置（跳过缩进更深的子列表 block）
- 用户手动修改起始序号后，下方连续同层级 block 自动更新

**有序列表序号规则**：
- 偶数层（0, 2, 4...）使用数字：`1. 2. 3.`
- 奇数层（1, 3, 5...）使用字母：`a. b. c.`
- Tab 进入新层级时序号重置为起始值（`1.` 或 `a.`）
- Enter 在同层级时序号递增
- Shift+Tab 回到上层时，根据上方已有的同层级 block 接续序号

#### 3.2.3 选取浮窗（SelectionToolbar）

当用户在 Tiptap 编辑器中框选文字时，出现 Portal + `position: fixed` 的浮窗：
- **粗体**（B）：toggle `**text**`
- **斜体**（I）：toggle `*text*`
- **链接**（🔗）：弹出 prompt 输入 URL
- **标题层级**（正文/H1/H2/H3/H4）：仅在顶层 block（非表格 cell）显示；标题行不显示粗体按钮

浮窗定位：自动检测视窗空间，优先显示在选区上方，空间不足时翻转到下方。

### 3.3 图片系统

#### 3.3.1 图片粘贴

- **顶层 block**：粘贴图片时，若当前 block 有文字内容 → 在下方创建新的图片 block；若当前 block 为空 → 图片直接替换当前 block
- **表格 cell**：同上逻辑，但操作的是 cell 内的 element 列表

#### 3.3.2 图片渲染（ImageRenderer）

- **选中态**：蓝色边框 + 删除按钮 + 四角 resize handle
- **拖曳调整大小**：四角 handle 支持鼠标拖曳改变图片宽度，宽度存储在 `prd.meta.json` 中
- **放大查看**：选中图片后再次点击 → 打开通用 `PrdLightbox`（见 3.7 节）
- **加载失败重试**：`onError` 时自动带时间戳重试一次

#### 3.3.3 图片上传

- 通过 `POST /__prd__/save-image` 上传到 `public/prd/`
- 文件名格式：`paste-{timestamp}.{ext}`
- 支持 PNG、JPG、GIF、WebP

### 3.4 表格交互系统

#### 3.4.1 列/行选中

- **列选中条**（`prd-table-col-bar`）：表格上方每列一个横条，点击选中整列（高亮），再次点击取消
- **行选中条**（`prd-table-row-bar`）：表格左侧每行一个竖条，点击选中整行
- 选中后显示「删除列/行」浮层按钮
- `pointer-events: none`（opacity: 0 时）防止误触

#### 3.4.2 插入 handle

- 鼠标悬停在列/行边界时，出现 `＋` 按钮
- 点击在该位置插入新列/行

#### 3.4.3 CellRenderer

表格每个单元格由 `CellRenderer` 管理，内部维护 `elements[]` 列表：
- 每个 element 可以是 `{ type: 'text', markdown }` 或 `{ type: 'image', src }`
- Enter 在 cell 内创建新 element（继承列表格式）
- Backspace 在空 element 上删除该 element
- 支持图片粘贴（同顶层 block 逻辑）
- 有序列表自动编号（`renumberCellElements`）

### 3.5 全局选中态管理

`globalSelection` 状态由 `PrdPage` 持有，全页唯一：

| type | 含义 | 数据 |
|------|------|------|
| `text-block` | 文本区域选中 | `{ blockId, role, cellPath? }` |
| `image` | 图片选中 | `{ blockId, cellPath? }` |
| `table-col` | 表格列选中 | `{ blockId, ci }` |
| `table-row` | 表格行选中 | `{ blockId, ri }` |

- 点击 main 空白区域（非 `[data-prd-no-block-select]` 区域）→ 清除选中 + blur 当前 focus
- 选中文本区域时自动清除其他选中（包括其他 cell 的图片选中）

### 3.6 通用 Lightbox（PrdLightbox）

图片、Mermaid 图表、Mindmap 思维导图共用同一个 `PrdLightbox` 组件：

| 特性 | 说明 |
|------|------|
| 初始比例 | fit-to-viewport：测量内容自然尺寸，计算 `min(viewW/contentW, viewH/contentH, 1)` 作为初始 scale；使用 `visibility:hidden` + loading spinner 防止 100%→fit 的闪烁 |
| 缩放 | 触控板滚轮、`−`/`+` 按钮、预设百分比按钮（50%/75%/100%/150%/200%/300%）；步长 5%；范围 20%–500% |
| 手动输入 | 控制条中的百分比输入框，支持输入整数后 Enter / 失焦生效 |
| 平移 | 鼠标拖曳内容区 |
| 重置 | 回到初始 fit-to-viewport 比例，平移清零 |
| 关闭 | 点击背景、`Esc` 键 |
| 内容类型 | `imageSrc`（`<img>`）或 `htmlContent`（SVG 字符串，`.prd-lightbox-content__html` 容器，`width: 80vw`） |

**Mindmap SVG 快照生成**：由于 markmap SVG 无 viewBox 且布局靠 `<g transform>` 表达，在渲染完成后（`requestAnimationFrame`，因 `duration:0` 无需等待动画）用 `g.getBBox()` 计算内容边界，克隆 SVG 并设置正确的 `viewBox`（内容 bbox + 30px padding），移除 `<g>` 的 transform，得到可独立缩放的静态 SVG 字符串。

### 3.7 Mermaid 图表系统（MermaidBlock / MermaidRenderer）

#### 数据格式

- **顶层 block**：`<!-- block:mermaid -->`  + ` ```mermaid ``` ` fenced code block
- **表格 cell 内**：`:::mermaid:::代码:::end-mermaid:::`（GFM 表格内不支持 fenced block）

#### 渲染

- `mermaid.render(key, code)` 返回 SVG 字符串 → `dangerouslySetInnerHTML` 展示
- 代码视图 / 图表视图通过「视图」按钮切换

#### 元数据持久化

- 视图模式：`prd.meta.json` → `mermaidViewModes[key]`，值为 `'code'` 或 `'chart'`
- 显示宽度：`prd.meta.json` → `mermaidWidths[key]`
- key 格式：`mermaid_{djb2hash}`，基于代码内容，稳定不随位置变化

#### 尺寸

- 顶层：默认 628px，四角 resize；表格 cell：100% 填满，不可 resize

### 3.8 Mindmap 思维导图系统（MindmapBlock / MindmapRenderer）

#### 数据格式

- **顶层 block**：`<!-- block:mindmap -->` + Markdown 缩进列表（`- 根节点\n  - 子节点`）
- **表格 cell 内**：`:::mindmap:::代码:::end-mindmap:::`

#### 渲染

- `Transformer.transform(code)` → 树形数据 → `Markmap.create(svgEl, options, root)`
- options：`{ autoFit: true, pan: false, zoom: false, duration: 0 }`（禁用交互和动画）
- 渲染后通过 `requestAnimationFrame` 克隆 SVG 并计算正确 viewBox，存入 `svgHtml` 供 Lightbox 使用

#### 自动语法转换

- 检测到 Mermaid mindmap 语法（`/^mindmap\b/`）时，自动转换为 Markdown 缩进列表，并通过 `onCodeChange` 回写存储

#### 元数据持久化

- 与 Mermaid 相同机制，字段为 `mindmapViewModes` / `mindmapWidths`，key 格式 `mindmap_{djb2hash}`

### 3.9 性能优化

| 优化项 | 说明 |
|--------|------|
| TiptapPreview 轻量化 | 预览态不创建 Tiptap editor 实例，改用 `markdown-it.renderInline` 渲染 HTML |
| `memo` 包裹 | `TiptapPreview`、`BlockItem` 使用 `React.memo` 减少不必要的 re-render |
| `useMemo` 缓存 | HTML 渲染结果用 `useMemo` 缓存 |
| 防抖写盘 | `schedulePersist` 使用 480ms 防抖，避免连续编辑时频繁序列化和网络请求 |
| 写盘排队 | `runPersistAsync` 避免并发写盘覆盖 |
| 前缀同步设置 | 进入编辑态前同步设置 `prefixRef`，避免首帧闪烁 |
| Ref 稳定引用 | `callbacksRef`、`onSaveRef`、`commitAndExitRef` 等避免闭包过期 |

---

## 四、Vite 插件（`vite-plugin-prd-save-image.js`）

### 4.1 提供的 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/pages/prd/prd.md` | 读取并返回 `pages/prd/prd.md` 原始文本；`Cache-Control: no-store` |
| `POST` | `/__prd__/save-image` | 接收 `{ fileName, base64 }`，写入 `public/prd/`；返回 `{ ok, path }` |
| `POST` | `/__prd__/save-md` | 接收 `{ content }`，覆盖写入 `pages/prd/prd.md`；返回 `{ ok }` |
| `POST` | `/__prd__/delete-image` | 接收 `{ path }`，删除 `public/` 下对应图片；返回 `{ ok }` |
| `GET` | `/__prd__/meta` | 读取 `pages/prd/prd.meta.json`（展示元数据：图片宽度、Mermaid/Mindmap 视图模式与宽度） |
| `POST` | `/__prd__/save-meta` | 写入 `pages/prd/prd.meta.json`（防抖合并，不覆盖其他字段） |

### 4.2 安全约束

- `save-image`：文件名经校验（仅允许 `[\w.-]+.(png|jpg|gif|webp)`，禁止 `..`）；单文件上限 **25 MB**
- `save-md`：仅接受字符串类型 `content`，写入路径硬编码
- 两个 POST 接口**仅在 dev/preview 模式下存在**

### 4.3 孤儿图片清理

每次保存 `prd.md` 时，自动对比新旧内容中的 `/prd/` 图片路径，已移除的图片通过 `delete-image` API 自动删除。

---

## 五、关键文件索引

| 文件 | 类型 | 说明 |
|------|------|------|
| `pages/prd/prd.md` | 数据 | **PRD 正文**唯一真相（Block 格式 v2） |
| `pages/prd/prd.meta.json` | 数据 | 图片宽度等元数据（sidecar） |
| `docs/prd-documentation/PRD-rules.md` | 文档 | 规范说明 |
| `docs/prd-documentation/PRD-tech.md` | 文档 | 技术说明（本文件） |
| `src/features/prd/editor/PrdPage.jsx` | React | Block 编辑器根组件（含所有子组件） |
| `src/features/prd/editor/TiptapMarkdownEditor.jsx` | React | Tiptap 富文本编辑器组件（含 SelectionToolbar、TiptapPreview） |
| `src/features/prd/editor/tiptap-md-utils.js` | 纯 JS | `editorToMarkdown(editor)` 工具函数 |
| `src/features/prd/editor/useViewportFit.js` | React Hook | 浮窗视窗适配定位 |
| `src/features/prd/editor/prd-parser.js` | 纯 JS | `parsePrd(mdText)` → `Block[]` |
| `src/features/prd/editor/prd-writer.js` | 纯 JS | `serializePrd(Block[])` → Markdown |
| `src/features/prd/editor/styles/prd-page-edit.css` | CSS | 编辑器核心样式 |
| `src/features/prd/editor/styles/prd.css` | CSS | 页面基础样式 |
| `src/features/prd/editor/styles/prd-overview.css` | CSS | 概览区样式 |
| `src/shared/styles/prd-table.css` | CSS | 表格共用基样式 |
| `src/shared/styles/prd-section.css` | CSS | 章节补充样式 |
| `vite-plugin-prd-save-image.js` | Node.js | Vite 插件：开发态 API |
| `vite.config.js` | 配置 | 注册插件 |
| `public/prd/` | 静态资源 | 粘贴图片落盘目录 |

---

## 六、组件层次结构

```
PrdPage
├── SaveToast（保存状态提示）
├── DeleteConfirmModal（删除确认弹窗）
└── main.prd-page__main
    ├── BlockItem × N（memo）
    │   ├── ActionPanel（下方浮层操作条：上方插入/下方插入/上移/下移/删除）
    │   │   └── AddBlockMenu（类型选单：H2/H3/H4/段落/表格/PRD章节/分隔线/Mermaid/Mindmap）
    │   └── prd-block-content（按 type 分发）
    │       ├── HeadingBlock（h1/h2/h3/h4）→ EditableField
    │       ├── ParagraphBlock → ElementRenderer → TiptapMarkdownEditor / ImageRenderer
    │       ├── TableBlock
    │       │   ├── CellRenderer × N → ElementRenderer × N
    │       │   ├── 列选中条（prd-table-col-bar）× N
    │       │   ├── 行选中条（prd-table-row-bar）× N
    │       │   └── 插入 handle（列/行边界）
    │       ├── MermaidBlock → MermaidRenderer
    │       ├── MindmapBlock → MindmapRenderer
    │       └── DividerBlock
    └── AddAtEndButton（页面末尾 + 新增块）

TiptapMarkdownEditor
├── 预览态：TiptapPreview（memo，markdown-it 渲染）
└── 编辑态
    ├── prd-list-prefix（列表前缀视觉符号）
    ├── SelectionToolbar（Portal，选取浮窗：粗体/斜体/链接/标题层级）
    └── EditorContent（Tiptap ProseMirror 编辑区）

ImageRenderer
├── 图片 + 四角 resize handle
├── 选中工具栏（删除按钮）
└── PrdLightbox（Portal，全屏放大，共用）

MermaidRenderer
├── 代码视图（textarea）/ 图表视图（SVG dangerouslySetInnerHTML）
├── 视图切换菜单
├── 四角 resize handle（顶层 block）
└── PrdLightbox（Portal，图表视图点击触发）

MindmapRenderer
├── 代码视图（textarea）/ 图表视图（markmap SVG）
├── 视图切换菜单
├── 四角 resize handle（顶层 block）
└── PrdLightbox（Portal，静态 SVG 快照）

PrdLightbox（通用）
├── loading spinner（scale===null 时）
├── 内容区（图片 或 html SVG，visibility:hidden 防闪烁）
└── 控制条（−、预设%按钮、+、百分比输入框、重置、✕）
```

---

## 七、本地开发流程

```bash
# 启动开发服务器
npm run dev

# 访问编辑器（根路径即 PRD 页）
open http://localhost:6001/
```

- 页面加载时自动 `GET /pages/prd/prd.md` 读取内容
- 点击任意文字区域进入 Tiptap 编辑态，失焦后自动保存（防抖 480ms）
- 粘贴图片后自动上传并更新 `prd.md`
- 图片宽度调整后自动保存到 `prd.meta.json`

---

## 八、已知限制与后续优化方向

| 事项 | 当前状态 | 后续方向 |
|------|---------|---------|
| 生产环境编辑 | 不支持（无 Vite 插件） | 可引入轻量 Node 服务 |
| 并发编辑 | 不支持（后保存覆盖先保存） | 可引入乐观锁 |
| Block 撤销/重做 | 未实现 | 可引入历史栈 |
| 表格 cell 内列表编号 | 已支持（renumberCellElements） | — |
| 跨 block 拖曳排序 | 未实现（使用上移/下移按钮） | 可引入 DnD |
| 移动端编辑 | 未优化 | Tiptap 在移动端体验较好，但表格交互需适配 |
| tiptap-markdown 维护状态 | 社区包，不再活跃维护 | Tiptap 官方 markdown extension（v3.7+）可作为替代 |
