/**
 * `RouteSceneBridge` — 把 Progression 的 `level:phase` 场景事件映射到 React Router
 * 的路由切换(plan/ui-react-split.md §3)。
 *
 * 职责:
 *  - 订阅 `bus.on("level:phase", ...)`,把 GameScene → URL path 的映射做出来;
 *  - 全屏场景 (`character_select` / `shop` / `gameover` / `victory`) → 对应路由;
 *  - 游戏中场景 (`running` / `levelup_modal` / `portal`) → `/play`。
 *  - 不渲染任何 UI —— 只是个"桥梁"组件,放在 `<Routes>` 旁边即可。
 *
 * 触发源(由 Progression / GameSceneController 发出):
 *  - `player:died` → `level:phase { scene: "gameover" }` → `/game-over`
 *  - `running` 倒计时归零 → `level:phase { scene: "portal" }` → `/play`(显示传送门提示)
 *  - 玩家走进传送门 → `level:phase { scene: "shop" }` → `/shop`
 *  - `pickCharacter("default")` → `level:phase { scene: "running" }` → `/play`
 *  - `startRun()` → `level:phase { scene: "character_select" }` → `/select`
 *
 * 设计要点:
 *  - 订阅**只**在 GameState 就绪后建立;`state` 为 null 时返回 null,跳过订阅。
 *  - 卸载时反订阅(避免 React StrictMode dev 下重复订阅)。
 *  - `navigate(path, { replace: true })` —— 避免浏览器历史被填满无意义的中间态
 *    (例如 `running → portal → shop` 在浏览器历史上应只是一次跳转)。
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import type { GameScene } from "./types";
import { useGameState } from "./GameStateContext";

/**
 * 把 GameScene 映射到 React Router 路径(plan/ui-react-split.md §2 表)。
 *
 * 拆分目的:独立纯函数,便于单测 / 调试映射是否齐全。
 */
export function sceneToPath(scene: GameScene): string {
  switch (scene) {
    case "character_select":
      return "/select";
    case "running":
    case "levelup_modal":
    case "portal":
      // 这三个 scene 都属于"游戏进行中",canvas 可见。pause 是 running
      // 的子态,不改变 scene,不需要单独路径。
      return "/play";
    case "shop":
      return "/shop";
    case "gameover":
      return "/game-over";
    case "victory":
      return "/victory";
  }
}

/**
 * `<RouteSceneBridge />` —— 无 UI 组件,挂载一次即可。
 *
 * 必须放在 `<GameStateProvider>` 内部(因为依赖 `useGameState`)、
 * `<BrowserRouter>` 内部(因为依赖 `useNavigate`)。
 */
export function RouteSceneBridge(): null {
  const state = useGameState();
  const navigate = useNavigate();

  useEffect(() => {
    // Provider 还没就绪时不订阅(state 为 null 通常只持续首帧)。
    if (state === null) return;

    return state.bus.on("level:phase", (event) => {
      const path = sceneToPath(event.scene);
      // `replace: true` —— 不污染浏览器历史(连续 scene 切换不该让用户按
      // 多次"后退"才能离开结算页)。
      void navigate(path, { replace: true });
    });
  }, [state, navigate]);

  return null;
}
