'use strict'

// 宿主 ui-conversation 组装 DetailsPanel props 时只给了非响应式的
// activeTab(): 渲染期一次性读取，点 tab 改 store 但无人订阅 → 面板不重渲染，
// 直到其他状态变化才「突然切换」。DetailsPanel 本就优先消费 useDetailsState
// 钩子（slots.ts 声明、?? 链第一分支），宿主只是没接。本补丁在 inject 组合里
// 补上它：useSyncExternalStore 订阅 detailsController.state。
// 锚点形状改变时 fail closed（与 turn-fold-compat.patch.cjs 同纪律）。

const TARGET = {
  package: '@deepseek-ai/dsh-client-ui-conversation',
  version: '>=0.1.0-rc.8 <0.2.0-0',
  file: 'lib/client.js',
}

const ANCHOR = /^activeTab: \(\) => (\w+)\.active$/
const REACT_BINDING = /(?:var|let|const) (react\w*) = require\("react"\)/

module.exports = [
  {
    id: 'details-tab-reactivity',
    description: 'Subscribes the details panel to the tab store so tab clicks re-render instead of switching on the next unrelated update.',
    target: TARGET,
    select: 'PropertyAssignment[name.name="activeTab"]',
    expect: 1,
    apply({ node, sourceFile, source, edit }) {
      const text = sourceFile.text.slice(node.getStart(sourceFile), node.getEnd(sourceFile))
      const controller = text.match(ANCHOR)?.[1]
      if (controller === undefined) throw new Error('mat-ui: details activeTab assignment shape changed')
      const react = source.match(REACT_BINDING)?.[1]
      if (react === undefined) throw new Error('mat-ui: react import binding not found in details composition module')
      const lineStart = source.lastIndexOf('\n', node.getStart(sourceFile)) + 1
      const indent = source.slice(lineStart, node.getStart(sourceFile)).match(/^\t*/)[0]
      edit.insertRight(node.getEnd(), `,\n${indent}useDetailsState: (selector) => ${react}.useSyncExternalStore((onStoreChange) => ${controller}.state.subscribe(onStoreChange), () => selector(${controller}.state.getSnapshot()))`)
    },
  },
]
