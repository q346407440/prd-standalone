export const prdSections = [
  {
    id: 'notify-module',
    sectionTitle: '1. B端-通知模块',
    // legacy 结构示例：独立项目里改为 markdown + table，不再依赖组件化设计稿单元
    design: null,
    interactionMarkdown: [
      '**顶部通知栏（新增模块）**',
      '',
      '- 当 **【可提醒】** 状态的通知数量为 0 时，不展示通知栏',
      '- 示例：点击 **【关闭提醒】** 后刷新列表',
    ].join('\n'),
    logicMarkdown: [
      '**通知场景触发逻辑**',
      '',
      '1. 定时任务在 0–8 点之间执行（示例）',
      '2. 优先级：',
      '   a. 系统通知',
      '   b. 营销通知',
      '',
      '详见 [关联 PRD](https://example.com)（示例链接）。',
    ].join('\n'),
  },
];
