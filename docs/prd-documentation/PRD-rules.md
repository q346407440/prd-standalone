# PRD 页面规范（可继承约定）

> 本文档存放于 `docs/prd-documentation/PRD-rules.md`，描述 **PRD 独立项目**中编辑器页的前端构成、交互行为与样式约定；**业务 PRD 正文**见 `pages/prd/prd.md`，请勿混放。  
> **维护方式**：凡涉及可复用的页面结构、样式、组件行为变更，请在合入代码后同步更新本文档。

---

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1 ~ 1.1 | 2026-03-26 | 初版至 Block 编辑器架构（详见历史记录） |
| 2.0 | 2026-03-27 | **全面重写**：Tiptap 富文本编辑器、自定义列表系统（markdown 前缀管理）、图片系统（粘贴/替换/放大/拖曳调整大小）、表格交互（列/行选中条、hover 插入 handle）、全局选中态管理、性能优化 |
| 2.1 | 2026-03-31 | 表格 `交互/逻辑` 单元格新增手动 **待确认** tag 与备注浮窗；标记后常亮，备注保存在 `prd.annotations.json` 的 `cellStates`，不进入 agent 标注流程 |
| 2.2 | 2026-03-31 | 新增 **Mermaid 图表 block**（顶层 + 表格 cell 内嵌）与 **Mindmap 思维导图 block**（基于 markmap）；统一 **PrdLightbox** 组件（图片/Mermaid/Mindmap 共用，支持 fit-to-viewport 初始缩放、5% 步长缩放、百分比输入框、拖拽平移）；Mindmap 禁用 markmap 内置 pan/zoom 以降低资源占用 |

---

## 一、前端页面构成规范

### 1.1 路由与入口

- **路径**：根路径 `/` 即 PRD 编辑器
- **页面组件**：`src/features/prd/editor/PrdPage.jsx` 导出 `PrdPage`
- **入口**：`src/App.jsx` 直接渲染 `<PrdPage />`

### 1.2 目录与文件职责

| 路径 | 说明 |
|------|------|
| `pages/prd/prd.md` | **PRD 正文唯一真相**：Block 格式 v2 |
| `pages/prd/prd.meta.json` | 展示元数据 sidecar：图片宽度、Mermaid 视图模式与宽度、Mindmap 视图模式与宽度 |
| `docs/prd-documentation/PRD-rules.md` | **本规范文档** |
| `docs/prd-documentation/PRD-tech.md` | **技术方案文档** |
| `src/features/prd/editor/PrdPage.jsx` | PRD Block 编辑器根组件（含所有子组件） |
| `src/features/prd/editor/TiptapMarkdownEditor.jsx` | Tiptap 富文本编辑器组件 |
| `src/features/prd/editor/tiptap-md-utils.js` | Tiptap → Markdown 工具函数 |
| `src/features/prd/editor/useViewportFit.js` | 浮窗视窗适配 Hook |
| `src/features/prd/editor/prd-parser.js` | `parsePrd(mdText)` → `Block[]` |
| `src/features/prd/editor/prd-writer.js` | `serializePrd(Block[])` → Markdown |
| `src/features/prd/editor/styles/` | 编辑器样式 |
| `src/shared/styles/prd-table.css` | 表格共用基样式 |
| `public/prd/` | 静态图片落盘目录 |

### 1.3 页面 DOM 结构约定

- 根节点：`div.prd-page`（整页白底、内部纵向滚动）
- `main.prd-page__main`：扁平的 Block 列表（`div.prd-block-item` × N）
- 每个 `prd-block-item` 包含：内容区（`prd-block-content`）+ 悬停操作条（`prd-block-actionbar`）
- `main` 上绑定 `onMouseDown`：点击非 `[data-prd-no-block-select]` 区域时，清除全局选中 + blur 当前 focus

### 1.4 prd.md 格式约定（v2）

`prd.md` 是 PRD 内容的**唯一真相**，采用扁平 Block 格式。每个 Block 前加 `<!-- block:type -->` 标记：

```
<!-- block:h1 -->
# 页面大标题

<!-- block:h2 -->
## 需求概述

<!-- block:h3 -->
### 子标题

<!-- block:h4 -->
#### 四级标题

<!-- block:paragraph -->
1. 需求背景...

<!-- block:paragraph -->
- 无序列表项
  a. 有序子列表项

<!-- block:table -->
| 列1 | 列2 | 列3 |
|-----|-----|-----|
| 内容 | 内容 | 内容 |

<!-- block:divider -->
---
```

- **`<!-- block:type -->` 标记不可省略**，解析器依赖其定位各 Block
- 支持的 type：`h1` / `h2` / `h3` / `h4` / `paragraph` / `table` / `divider` / `prd-section` / `mermaid` / `mindmap`
- 图片路径使用 `/prd/文件名.png` 格式
- 旧格式（v1，无 block 标记）首次保存时自动迁移为 v2

---

## 二、富文本编辑交互规范

### 2.1 编辑态与预览态

**预览态**（默认）：
- 渲染为格式化后的 HTML（粗体、斜体、链接均可见）
- 鼠标悬停：浅灰背景 + 虚线边框
- 被选中：蓝色背景 + 蓝色实线边框
- 点击进入编辑态

**编辑态**：
- 蓝色实线边框 + 浅蓝背景
- Tiptap WYSIWYG 编辑器激活
- 失焦自动保存并退出编辑态

**关键约束**：预览态和编辑态的 `padding`、`border`、`min-height` 必须完全一致（均为 `padding: 4px 6px; border: 1.5px; min-height: 2em`），以避免切换时的视觉抖动。

### 2.2 支持的行内格式

| 格式 | 快捷键 | Markdown 语法 | 说明 |
|------|--------|---------------|------|
| 粗体 | `Cmd+B` | `**text**` | 选中文字后 toggle |
| 斜体 | `Cmd+I` | `*text*` | 选中文字后 toggle |
| 链接 | 选取浮窗按钮 | `[text](url)` | 弹出 prompt 输入 URL |

### 2.3 选取浮窗（SelectionToolbar）

当用户在编辑态框选文字时，出现浮窗：

- **位置**：优先显示在选区上方，空间不足时翻转到下方（`useViewportFit` hook）
- **渲染方式**：`createPortal` + `position: fixed`，避免被父容器 `overflow` 裁剪
- **按钮**：
  - **B**（粗体）：仅在非标题行显示
  - **I**（斜体）
  - **🔗**（链接）
  - **标题层级**（正文/H1/H2/H3/H4）：仅在顶层 block 显示，表格 cell 内不显示

### 2.4 标题行特殊规则

- 标题行（H1/H2/H3/H4）**不支持粗体**交互
- 标题行仅支持在「正文」和各标题层级之间切换
- 切换为「正文」后恢复完整的行内格式支持

---

## 三、列表交互规范

### 3.1 列表类型

| 类型 | 标记 | 说明 |
|------|------|------|
| 无序列表 | `- ` | 所有层级统一使用 `- ` |
| 有序列表（数字） | `1. ` `2. ` ... | 偶数层级（第 0, 2, 4... 层） |
| 有序列表（字母） | `a. ` `b. ` ... | 奇数层级（第 1, 3, 5... 层） |

### 3.2 创建列表

| 方式 | 操作 | 说明 |
|------|------|------|
| 快捷键 | `Cmd+Shift+8` | 切换无序列表（toggle） |
| 快捷键 | `Cmd+Shift+7` | 切换有序列表（toggle） |
| 手动输入 | 在行首输入 `-` + 空格 | 自动转为无序列表 |
| 手动输入 | 在行首输入 `数字.` + 空格 | 自动转为有序列表（数字定义起始序号） |
| 手动输入 | 在行首输入 `字母.` + 空格 | 自动转为有序列表（字母层级） |

### 3.3 列表操作

#### Enter（回车）

- 当前 block 有列表前缀时：
  1. 保存当前 block
  2. 创建新 block，**继承完整的列表前缀和缩进层级**
  3. 有序列表：新 block 的序号自动递增（如 `1.` → `2.`，`a.` → `b.`）
- 当前 block 无列表前缀时：正常创建空白新 block

#### Backspace（退格）

- 编辑器内容为空 + 有列表前缀 → **移除列表前缀**（变为普通段落），不删除 block
- 编辑器内容为空 + 无列表前缀 → **删除当前 block**（焦点移到上一个 block）

#### Tab（缩进）

- 增加 2 空格缩进
- 有序列表：自动切换序号类型（数字 ↔ 字母），序号**重置为起始值**（`1.` 或 `a.`）
- 无序列表：保持 `- ` 不变

#### Shift+Tab（取消缩进）

- 减少 2 空格缩进
- 有序列表：自动切换序号类型（字母 ↔ 数字）
- **不重新从 1 开始**，而是根据上方同层级的连续 block 接续序号

### 3.4 连续 block 自动编号规则

有序列表的序号在连续 block 之间自动维护：

1. **同层级连续 block**：自动递增（`1. → 2. → 3.` 或 `a. → b. → c.`）
2. **中间有缩进更深的子列表**：子列表不影响父层级的编号（跳过子列表继续编号）
3. **手动修改起始序号**：用户可以手动输入 `3.空格` 来设定起始序号，下方连续同层级 block 自动从 4 开始
4. **Shift+Tab 回到上层**：根据上方已有的同层级 block 接续序号，而非重新从 1 开始
5. **表格 cell 内**：同样的编号规则适用于 cell 内的 element 列表

**示例**：
```
1. 第一项
  a. 子项 a
  b. 子项 b
    1. 孙项 1
  c. 子项 c
2. 第二项（自动编号，跳过了中间的子列表）
```

### 3.5 列表视觉呈现

- 列表前缀（bullet 或序号）渲染在 Tiptap 编辑框左侧
- 使用 `display: flex; align-items: baseline` 对齐前缀和内容
- 前缀区域 `user-select: none; pointer-events: none`，不可选中/点击
- 缩进通过 `padding-left` 表达层级深度

---

## 四、图片交互规范

### 4.1 图片粘贴

| 场景 | 行为 |
|------|------|
| 粘贴到**有内容**的 block/element | 在下方创建新的图片 block/element |
| 粘贴到**空**的 block/element | 图片直接替换当前 block/element |
| 粘贴到表格 cell | 同上逻辑，操作 cell 内的 element 列表 |

### 4.2 图片选中与操作

- **首次点击**：选中图片（蓝色边框 + 删除按钮 + resize handle）
- **再次点击已选中的图片**：打开 Lightbox 全屏放大
- **Lightbox**：点击背景关闭；支持缩放（触控板滚轮、`−`/`+` 按钮、预设百分比按钮、百分比输入框手动输入整数）、拖拽平移；打开时自动 fit-to-viewport（以完整显示内容为初始比例），缩放步长 5%；「重置」回到初始 fit 比例
- **删除**：选中后点击删除按钮

### 4.3 图片调整大小

- 选中图片后，四角出现 resize handle
- 鼠标拖曳 handle 可调整宽度
- 宽度存储在 `prd.meta.json` 中（不写入 `prd.md`）

### 4.4 图片加载失败处理

- `onError` 时自动带时间戳参数重试一次
- 避免因上传延迟导致的短暂裂图

---

## 五、表格交互规范

### 5.1 表格结构

- 表格使用 GFM Markdown 格式存储
- 表格 cell 内支持多个 element（文本 + 图片混合），用 `<br>` 分隔
- 每个 cell 由 `CellRenderer` 管理

### 5.2 列/行操作

| 操作 | 触发方式 | 说明 |
|------|---------|------|
| 选中列 | 点击列上方的选中条 | 高亮整列 |
| 选中行 | 点击行左侧的选中条 | 高亮整行 |
| 插入列 | 悬停列边界出现 `＋` | 在该位置插入新列 |
| 插入行 | 悬停行边界出现 `＋` | 在该位置插入新行 |
| 删除列 | 选中列后点击删除按钮 | 删除整列 |
| 删除行 | 选中行后点击删除按钮 | 删除整行 |

### 5.3 列/行选中条防误触

- 选中条在非悬停时 `opacity: 0` + `pointer-events: none`
- 仅在悬停时 `pointer-events: auto`
- 操作条 `z-index: 50` 高于表格选中条，避免点击操作条时误触表格

### 5.4 Cell 内编辑

- 每个 cell 内可有多个 element（文本或图片）
- Enter 在 cell 内创建新 element（继承列表格式）
- Backspace 在空 element 上删除该 element（最后一个 element 不可删除）
- 支持图片粘贴
- 有序列表在 cell 内独立编号

### 5.5 Cell 手动标记

- `交互` / `逻辑` 单元格右上角保留手动辅助标记，不写入 `prd.md`，统一写入 `prd.annotations.json > cellStates`
- **仅参考**：表示该格内容仅作参考，不参与本轮修改；激活后按钮常亮
- **待确认**：用户手动标记的备注 tag，不进入 agent 的图片标注 / 区域生成流程
- **待确认** 激活后 tag 常亮显示，便于后续通过浏览器页面文本搜索 `待确认` 快速定位
- 点击 **待确认** tag 打开小浮窗，可输入备注；关闭浮窗或点击完成时保存备注
- 取消 **待确认** 标记时，同时清空该 tag 的备注

---

## 六、Mermaid 图表交互规范

### 6.1 Mermaid Block 外观与视图切换

- 支持两种视图：**代码视图**（文本编辑区）与**图表视图**（渲染后的 SVG）
- 右上角「视图」按钮切换，选项：仅展示代码 / 仅展示图表
- 视图模式持久化到 `prd.meta.json`（`mermaidViewModes`），刷新后保留

### 6.2 Mermaid Block 尺寸

- 顶层 block：四角 resize handle 可调整宽度，默认宽度 628px；宽度持久化到 `prd.meta.json`（`mermaidWidths`）
- 表格 cell 内：宽度填满 cell，不支持 resize
- meta key 使用内容 djb2 哈希，格式 `mermaid_{hash}`

### 6.3 Mermaid 图表 Lightbox

- 图表视图下点击 SVG 区域打开 Lightbox（通用 `PrdLightbox` 组件）
- Lightbox 行为与图片相同：fit-to-viewport 初始比例、5% 步长缩放、拖拽平移、百分比输入框

### 6.4 渲染失败处理

- 代码有语法错误时在图表区显示错误文本（不崩溃）

---

## 七、Mindmap 思维导图交互规范

### 7.1 Mindmap Block 外观与视图切换

- 与 Mermaid block 行为一致：支持代码视图 / 图表视图切换，持久化到 `prd.meta.json`（`mindmapViewModes`）
- 使用 markmap-lib + markmap-view 渲染

### 7.2 Mindmap Block 尺寸

- 顶层 block：四角 resize，默认宽度 628px，持久化到 `prd.meta.json`（`mindmapWidths`）
- 表格 cell 内：宽度填满 cell，不支持 resize
- meta key 格式 `mindmap_{hash}`

### 7.3 Mindmap 图表 Lightbox

- 与 Mermaid 一致，共用 `PrdLightbox`
- SVG 在 lightbox 中以静态快照形式展示，不支持 markmap 原生的 pan/zoom

### 7.4 Mindmap 静态渲染约定

- markmap 实例创建时禁用内置 pan/zoom（`pan: false, zoom: false`）、禁用动画（`duration: 0`），以降低资源占用
- 页面内展示为纯静态缩略图，用户通过 Lightbox 放大后查看细节

### 7.5 语法格式

- 必须使用 Markdown 缩进列表（`- 根节点\n  - 子节点`），**不要**使用 Mermaid mindmap 语法
- 前端会自动检测并转换误用的 Mermaid mindmap 语法，但写作时请直接使用正确格式

---

## 九、Block 操作规范

### 6.1 Block 类型

| type | 说明 | 编辑方式 |
|------|------|---------|
| `h1` | 页面大标题 | `EditableField`（单行） |
| `h2` | 二级标题 | `EditableField` |
| `h3` | 三级标题 | `EditableField` |
| `h4` | 四级标题 | `EditableField` |
| `paragraph` | 段落（含列表） | `TiptapMarkdownEditor` |
| `table` | 表格 | `CellRenderer` × N |
| `divider` | 分隔线 | `<hr>` |
| `prd-section` | PRD 三列表格 | 设计/交互/逻辑 |
| `mermaid` | Mermaid 图表 | `MermaidBlock` / `MermaidRenderer` |
| `mindmap` | Mindmap 思维导图 | `MindmapBlock` / `MindmapRenderer` |

### 6.2 Block 操作

| 操作 | 触发方式 | 说明 |
|------|---------|------|
| 插入 | 悬停 Block → 操作条「上方插入」或「下方插入」 | 弹出类型选单 |
| 删除 | 操作条「删除」 | 弹出确认弹窗 |
| 上移/下移 | 操作条按钮 | 与相邻 Block 交换位置 |
| 页面末尾追加 | 「+ 新增块」按钮 | 在末尾追加 |

### 6.3 Enter 创建新 Block

- 在任何文本编辑区域按 Enter，**始终创建新的 block**（不在当前 block 内换行）
- 新 block 继承上一个 block 的列表状态（类型 + 层级 + 递增序号）
- 表格 cell 内 Enter 创建新 element（不创建新 block）

### 6.4 Backspace 删除 Block

- 编辑器内容为空 + 无列表前缀 → 删除当前 block，焦点移到上一个 block
- 编辑器内容为空 + 有列表前缀 → 仅移除列表前缀，不删除 block
- 表格 cell 内：删除当前 element（最后一个 element 不可删除）

---

## 十、全局选中态规范

### 7.1 选中态类型

| 选中态 | 视觉表现 | 触发方式 |
|--------|---------|---------|
| 文本区域选中 | 蓝色背景 + 蓝色实线边框 | 点击文本区域 |
| 图片选中 | 蓝色边框 + 删除按钮 + resize handle | 点击图片 |
| 表格列选中 | 列高亮 | 点击列选中条 |
| 表格行选中 | 行高亮 | 点击行选中条 |

### 7.2 选中态互斥

- 全页同一时刻只能有一个选中态
- 选中新区域时自动清除旧选中
- 点击 main 空白区域（非任何 block 内容区域）→ 清除所有选中 + blur 当前 focus

### 7.3 表格 cell 选中互斥

- 选中一个 cell 内的文本时，自动清除其他 cell 的图片选中
- 通过 `globalSelection.cellPath` 精确匹配 cell 位置

---

## 十一、前端样式规范

### 8.1 间距

- **禁止在 PRD 相关样式中使用 `margin` 做间距**；区块间距使用 `gap`，内边距使用 `padding`

### 8.2 页面级

- **整页背景色**：`#fff`
- **`prd-page__main`**：不限制 `max-width`，横向铺满；`padding: 20px 16px 32px`；`display: flex; flex-direction: column; gap: 20px`

### 8.3 编辑器样式一致性（重要）

预览态和编辑态必须保持以下属性一致，以避免切换时的视觉抖动：

```css
/* 预览态 */
.prd-editable-md--preview {
  padding: 4px 6px;
  border: 1.5px solid transparent;
  border-radius: 4px;
  min-height: 2em;
  font-size: 13px;
  line-height: 1.7;
}

/* 编辑态 */
.prd-tiptap-editor {
  padding: 4px 6px;
  border: 1.5px solid #4a90e2;
  border-radius: 4px;
  min-height: 2em;
}
```

### 8.4 列表样式

```css
/* 列表前缀容器 */
.prd-list-prefix {
  display: inline-flex;
  align-items: baseline;
  flex-shrink: 0;
  user-select: none;
  pointer-events: none;
}

/* 编辑态：前缀 + 编辑器水平排列 */
.prd-tiptap-editor:has(.prd-list-prefix) {
  display: flex;
  align-items: baseline;
}

/* 预览态：前缀 + HTML 水平排列 */
.prd-tiptap-preview-row {
  display: flex;
  align-items: baseline;
}
```

### 8.5 表格样式

- 外层 `div.prd-table-wrap` + `table.prd-table`
- 表头背景 `#f5f5f5`；单元格背景 `#fff`；边框 `#e8e8e8`
- `table-layout: fixed`、`border-collapse: collapse`
- `vertical-align: top`（单元格内容顶部对齐）

### 8.6 操作条 z-index 层级

| 元素 | z-index | 说明 |
|------|---------|------|
| `prd-block-actionbar` | 50 | Block 操作条（最高，避免被表格遮挡） |
| `prd-table-col-bar` | 30 | 表格列选中条 |
| `prd-table-row-bar` | 30 | 表格行选中条 |
| SelectionToolbar | Portal（fixed） | 选取浮窗 |
| Lightbox | Portal（fixed） | 图片放大 |

### 8.7 文案语言

- PRD 页面所有面向用户的中文一律使用**简体中文**

---

## 十二、数据流与编辑约定

### 9.1 内容修改的唯一入口

- **在线编辑**（推荐）：打开 `/` 页面，点击任意文字区域编辑，失焦后自动保存
- **直接编辑文件**（Agent / 离线）：直接修改 `prd.md`，刷新浏览器即可
- **禁止同时进行**：在线编辑与文件编辑不可并发

### 9.2 保存机制

- 每次编辑后 480ms 防抖保存
- 序列化 `Block[]` → Markdown → `POST /__prd__/save-md`
- 保存时自动清理孤儿图片
- 图片宽度元数据单独保存到 `prd.meta.json`

---

## 十三、内容写作规范

### 10.0 语言（强制）

- **PRD 写作语言必须为简体中文**
- 英文缩写、产品英文名、接口字段名可与中文混排，但中文部分仍为简体

### 10.1 文档结构

- 页面大标题固定为「产品详细功能说明」（对应 `prd.md` H1）
- 概览区固定包含四个 H2：需求概述、需求功能清单、原型图汇总、设计图汇总
- 详细功能章节每个 H2 为一个功能模块

### 10.2 交互列写作要求

- 以**加粗标题**开头，概括核心交互场景
- 交互条目使用**无序列表**（`-`）
- 涉及状态名、按钮名、字段名时，使用 `**【名称】**` 格式加粗标注

### 10.3 逻辑列写作要求

- 以**加粗标题**开头，概括触发场景或数据流向
- 有优先级/顺序的逻辑使用**有序列表**（`1.`）
- 涉及外部文档、接口时，使用 Markdown 链接 `[描述](url)`

### 10.4 设计/原型稿列

- 图片通过粘贴或选择上传，自动落盘至 `public/prd/`
- 不得手动修改 `prd.md` 中的图片路径
- 若该列使用“真实 Demo 引用”工作流，推荐写成：`图片 + 场景预览 + 状态说明 + 打开真实页面链接`
- 链接至少要能打开到目标页面；若业务 Demo 本身支持定位到具体模块、标题、tab 或场景，可直接使用更精确的真实地址
- 若业务 Demo 不支持更深一级定位，不要求额外实现深链接；保留页面级真实地址即可，不要在 `prd.md` 中伪造参数
- 同一单元格内的图片与说明建议使用 `<br>` 换行，示例：

```md
![](/prd/xxx.png)<br>
**场景预览：** xxx<br>
**状态说明：** xxx<br>
[打开真实页面](http://127.0.0.1:5173/xxx)
```

---

## 十四、后续迭代说明

当发生以下任一情况时，请更新本文档对应章节，**并同步更新 `PRD-tech.md`**：

- 新增/调整路由、目录、组件职责
- 变更间距策略
- 变更颜色、表格结构、图片行为
- 变更 `prd.md` 格式约定
- 引入新三方库或调整 Vite 插件逻辑
- 变更列表交互规则（缩进、编号、快捷键等）
- 变更选中态管理逻辑
