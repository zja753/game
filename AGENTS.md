# AGENTS.md

本仓库 AI 编码代理的极简关键决策日志。

## 语言约定

- **仓库内代码注释**：全部使用中文。
- **代理与用户沟通**：全部使用中文。
- 本文档是上述约定的唯一权威说明，代理在生成或修改代码、提交信息、文档时必须遵守。

## 工具链

- **包管理器 / 任务运行器**：`vp`（Vite+）。使用 `vp <cmd>`，不要使用
  `pnpm`、`npm` 或原生的 `vite`。示例：`vp dev`、`vp build`、`vp check`、
  `vp add <pkg>`、`vp run <task>`。
- **模板**：`vite:application`（单 React 应用）。
- **Lint / 格式化 / 类型检查**：单一命令 `vp check`（覆盖三者）；pre-commit
  hook 会在暂存文件上执行 `vp check --fix`。

## 技术栈

- React 19 + React Router 7（目前不需要 data router，使用
  `BrowserRouter` + `Routes`）。
- TypeScript（模板默认开启 `strict`；遵守 `verbatimModuleSyntax` 和
  `erasableSyntaxOnly`）。
- 不使用全局 CSS 框架。应用外壳样式放在 `src/styles/` 下。

## 游戏引擎集成（待办）

- Excalibur.js 将放在 `/game` 路由下，占位页面是 `src/pages/Game.tsx`。
- 挂载生命周期：引擎必须在进入路由时启动，在离开时销毁（RAF 循环 + 音频
  上下文）。使用 `useEffect` 的清理函数，不要在模块顶层启动。
- Canvas 元素应放在 `Game.tsx` 内部，不要把 Excalibur 挂载到 document body。

## 代码规范

- 新的顶层 UI 分组放在 `src/pages/<name>/` 下，并以 `index.tsx` 作为
  barrel 文件；共享组件放在 `src/components/` 下。
- 领域 / 游戏逻辑保持在 React 之外。纯模块放在 `src/game/` 下，由组件
  引入；这样引擎可以在没有 DOM 的情况下进行测试。
