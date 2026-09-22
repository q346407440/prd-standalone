---
name: prd-release-helper
description: 用于为 prd-standalone 准备发版：分析最近改动、建议下一个版本号、产出 release-info.json 内容，并整理提交说明。适用于用户说“发版”“准备发布”“更新版本号”“写更新说明”“写 release-info”或“整理提交说明”等场景。
---

# PRD 发版辅助

## 目的
这是 `prd-standalone` 仓库内的 skill，用于准备面向同事的发布内容。

## 工作流
1. 先检查当前 git 改动，并理解这些改动对用户或同事可见的影响。
2. 明确区分两类输出：
   - **发布说明**：给同事看的版本号、更新摘要、提示文案。
   - **提交说明**：给 Git 历史看的 commit message。
3. 如果仓库里同时存在 `package.json` 和 `release-info.json`，两者的 `version` 必须保持一致。
4. 当用户明确要求**执行**发版相关动作时（例如：发版、更新版本号后直接提交、按发版流程推送），版本文件更新属于必做项，不能只停留在建议层面。
5. 如果 `package.json` 和 `release-info.json` 同时存在，必须在最终的发版相关 commit / push 前把它们更新好，不能只给建议而不落盘。
6. 发布说明尽量简洁：
   - `summary` 控制在 1-3 条
   - 每条都说明一个用户可感知或团队可感知的变化
   - `message` 保持一句简短的提醒或风险提示
7. 版本号建议按语义化版本判断：
   - patch：小修复、低风险优化
   - minor：新增能力、工作流增强
   - major：有破坏性的流程变化

## 输出格式
除非用户另有要求，否则默认用下面这个结构：

```markdown
建议版本：vX.Y.Z

release-info.json:
- version: X.Y.Z
- date: YYYY-MM-DD
- forceUpdate: false
- summary:
  - ...
  - ...
- message: ...

建议 commit message:
<type(scope): subject>

<optional body>
```

## 约束
- 把 `release-info.json` 当作面向同事的发布内容来写，不要写成工程实现流水账。
- 除非会直接影响同事使用，否则不要堆实现细节。
- 如果用户要求的是“执行”，不要因为用户同时提了 commit / push，就跳过真实的版本号更新和 `release-info.json` 写回。
