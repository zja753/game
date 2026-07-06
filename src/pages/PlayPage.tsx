/**
 * `/play` 游戏主界面(plan/ui-react-split.md §2)。
 *
 * 第 3+4 步:canvas + hud-mount 改由 `GameStateProvider` 在 App 层级统一创建,
 * 本路由组件**不**再创建 RootContainer / canvas。
 *
 * 路由层职责:
 *  - 提供一个空白 `<section>`,让 CSS 能覆盖"游戏进行中"的样式;
 *    真正的 canvas 是 Provider 渲染的 `<div class="game-stage-persistent">`,
 *    通过 CSS z-index 控制在 `/play` 路由下显示、其他路由下隐藏。
 *  - 自身不订阅 EventBus、不调 Progression;路由切换由 `<RouteSceneBridge>`
 *    统一驱动,本页面只是被 mount / unmount 的对象。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 本文件不直接 import 任何 modules 下的 internal;一切通过 Context。
 *  - 当前页面**不**需要调 Context(只渲染占位),因此连 useGameState 都不调。
 */
export function PlayPage(): React.ReactElement {
  return <section className="page page-game" aria-hidden="true" />;
}
