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
