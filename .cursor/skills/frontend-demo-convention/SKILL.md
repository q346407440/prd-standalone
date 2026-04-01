---
name: frontend-demo-convention
description: 配套前端 Demo 开发规范：页面结构、布局、间距、图标、弹窗组件、配置页设计。Use when writing or editing frontend React demo code.
---

# 前端 Demo 开发规范

> 适用于配套 Demo 项目目录下的所有 React 页面与组件开发。

---

## 一、基本约定

- 技术栈：纯前端 React，无后端。
- 每个页面固定由 **2 个文件**构成：`index.jsx`（或 `index.tsx`）+ 对应 CSS 文件，两者必须放在**同一目录**下。
- 图标一律使用 `react-icons`（如 `react-icons/fi`），**禁止使用 emoji 作为图标**。
- 所有可见文案**必须使用简体中文**，禁止出现繁体中文。

---

## 二、整体布局（AppLayout）

页面整体采用三区块布局，使用公共组件 `components/AppLayout`：

1. **顶部全宽 Header** — 左侧 logo、右侧店铺信息与图标区
2. **左侧导航（Sider）** — 固定宽度 240px
3. **右侧 Main** — 主内容区，通过 `children` 传入

新增页面时用 `<AppLayout>` 包裹，主内容放入 `children`，可选 `activeNavKey`、`headerLeft` / `headerRight`、`navItems`。

### 滚动关系

整体采用**视口固定、区块内滚动**，禁止整页随内容滚动：

- Header：固定吸顶，`flex: 0 0 auto`，高度固定（如 56px）。
- Sider：固定左侧，导航项过多时仅在左侧容器内部滚动（`overflow-y: auto`）。
- Main：仅在自身区域内滚动（`overflow-y: auto` 或 `scroll`）。
- 根链路：`html`、`body`、`#root` 及 AppLayout 包裹节点需设 `height: 100%`、`overflow: hidden`。

实现要点：AppLayout 根节点 `height: 100%`、`overflow: hidden`；Body 区块 `flex: 1`、`min-height: 0`、`overflow: hidden`；Sider `min-height: 0`、`overflow-y: auto`；Main `flex: auto`、`min-height: 0`、`overflow-y: scroll`。

---

## 三、间距规范

- **禁止使用 `margin`** 做元素间距或区块留白。
- 间距一律用 **`padding`**（区块内留白）或布局间距：
  - Flex / Grid 的 **`gap`**（子元素之间间距）
  - 父容器的 **`padding`**（内容与边缘的距离）
- 优先级：`gap` > 父级 `padding`，避免在子元素上写 `margin`。

---

## 四、容器对齐规范

- 除非有特别需求，同一容器内的组件默认**水平居中**。
- 容器范围包含 `padding`，判断是否居中时需把外层 `padding` 算进有效范围。
- 优先使用 `justify-content: center`、`justify-items: center` 等容器层级能力，不要依赖子元素偏移手动凑齐。

---

## 五、弹窗组件（Modal）规范

### 结构

弹窗必须由三个子容器组成，顺序固定：

```jsx
<div class="sc-modal sc-modal-xxx">   {/* root，无任何 padding/margin */}
  <div class="sc-modal-header">...</div>
  <div class="sc-modal-body">...</div>
  <div class="sc-modal-footer">...</div>
</div>
```

### Root 容器

- `padding: 0`，`gap: 0`，不得有任何 padding 或 margin。
- 圆角、阴影、背景色等视觉属性放在 root。

### Header / Body / Footer：左右 padding 一致

三个子容器的左右 padding 必须相同（默认 `24px`），上下 padding 各自定义：

```css
/* ✅ GOOD */
.sc-modal-xxx .sc-modal-header { padding: 16px 24px; }
.sc-modal-xxx .sc-modal-body   { padding: 16px 24px; }
.sc-modal-xxx .sc-modal-footer { padding: 12px 24px 20px; }
```

### Header 布局

左右分布：左侧标题，右侧关闭按钮（×）。

```css
.sc-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--sc-border-secondary);
}
```

### Body 布局

内容纵向排列，子元素间距用 `gap`，不得用 `margin`：

```css
.sc-modal-xxx .sc-modal-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
```

### Footer 布局

按钮**右对齐**，主按钮（蓝色）在右，次按钮（outline）在左：

```css
.sc-modal-xxx .sc-modal-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  border-top: 1px solid var(--sc-border-secondary);
}
```

```jsx
{/* ✅ GOOD：次按钮在左，主按钮在右 */}
<div className="sc-modal-footer">
  <button className="sc-btn sc-btn-outline">取消</button>
  <button className="sc-btn sc-btn-primary">确定</button>
</div>
```

### 弹窗禁止事项

- ❌ Root 容器不得有 `padding` 或 `margin`
- ❌ 子容器间距不得用 `margin`，一律用 `gap` 或 `padding`
- ❌ Header / Body / Footer 的左右 padding 不得不一致
- ❌ Footer 按钮不得左对齐或居中

---

## 六、配置页设计规范

适用于 `pages/**/*config*/**/*` 下的配置型页面，右侧 main 区为重点约束范围。

### 页首

- 结构：「返回按钮 + 标题 + 可选右侧操作」。
- 返回按钮：尺寸 `36px`、`1px` 边框、`4px` 圆角、图标约 `16px`。
- 返回按钮与标题间距 `16px`，页首上下节奏 `20px`。
- 主标题：`20px / 28px / 600`；描述文案：`14px / 20px / 400`。
- 内容宽度默认参考 `960px`，窄版可用 `760px`。

### 版面结构

- 左右两栏时默认比例 `left:right = 2:1`。
- 右栏用于预览、摘要、说明或状态，宽度参考 `380px`。
- 两栏主 gap 以 `20px` 为基准。

### 间距与容器

- 主要 spacing 节奏：`4 / 8 / 12 / 16 / 20 / 24 / 28`。
- 卡片与卡片之间 gap 默认 `20px`。
- 单个卡片内边距默认 `24px`，密集内容可降到 `20px`，不低于 `16px`。
- 卡片圆角 `6px`，白色背景，轻阴影风格。

### 字级与信息层级

- 基础字级 `14px`，行高 `20px`。
- 主标题：`20px / 28px / 600`
- 区块标题：`14px / 20px / 600`
- 配置标签与正文：`14px / 20px / 400`
- 辅助说明：`12-14px`，颜色弱于正文

### 表单与公共组件

- 输入框、下拉、时间选择器等高度默认 `36px`，圆角 `3px`，边框 `1px`。
- radio / checkbox 控制尺寸默认 `18px`，选中文字与控件间距 `8px`。
- 建议抽出以下公共组件，共享一致的字级、内边距、边框、圆角、焦点态与错误态：
  - `ConfigPageHeader`
  - `ConfigSectionCard`
  - `TextField`
  - `SelectField`
  - `TimePickerField`
  - `RadioGroupField`
  - `CheckboxGroupField`

### 配置页落地要求

- 新增配置页时先套用本规范定版首、双栏比例、卡片节奏与表单组件，再填入业务内容。
- 细节未标明时优先沿用本规范，不要自行发明新的 spacing 或表单尺寸。
