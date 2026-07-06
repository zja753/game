/**
 * 路由壳 + 全局游戏状态壳(plan/ui-react-split.md §3-§4)。
 *
 * 整体结构:
 * ```
 * App
 * └── BrowserRouter
 *     └── GameStateProvider           ← 创建 EventBus + RootContainer + 暴露 Ports
 *         ├── (persistent) canvas + hud-mount  ← Excalibur / HUD 的挂载点,跨路由常驻
 *         ├── RouteSceneBridge        ← level:phase → React Router 跳转
 *         └── <Routes>...</Routes>
 * ```
 *
 * 路由表(plan/ui-react-split.md §2):
 *  - `/`         → Home(React 入口页)
 *  - `/select`   → CharacterSelectPage(角色选择)
 *  - `/play`     → PlayPage(canvas 主界面;UI 由 HudUiModule 通过 .hud-mount 浮层)
 *  - `/shop`     → ShopPage(商店)
 *  - `/game-over`→ GameOverPage(死亡结算)
 *  - `/victory`  → VictoryPage(通关结算)
 *
 * 设计要点:
 *  - **不**再有 nav + main 居中布局 —— Home 自己有"开始游戏"按钮,其他路由
 *    全屏;旧的 `.app-nav` / `.app-main` 简化掉。
 *  - canvas 不再在 `/play` 路由组件里创建,而是 GameStateProvider 在 App 层级
 *    持久化持有;CSS 控制仅 `/play` 路由下显示。
 */
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { GameStateProvider } from "./runtime/GameStateContext";
import { RouteSceneBridge } from "./runtime/RouteSceneBridge";

import { Home } from "./pages/Home";
import { CharacterSelectPage } from "./pages/CharacterSelectPage";
import { PlayPage } from "./pages/PlayPage";
import { ShopPage } from "./pages/ShopPage";
import { GameOverPage } from "./pages/GameOverPage";
import { VictoryPage } from "./pages/VictoryPage";

export function App() {
  return (
    <BrowserRouter>
      <GameStateProvider>
        <RouteSceneBridge />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/select" element={<CharacterSelectPage />} />
          <Route path="/play" element={<PlayPage />} />
          <Route path="/shop" element={<ShopPage />} />
          <Route path="/game-over" element={<GameOverPage />} />
          <Route path="/victory" element={<VictoryPage />} />
        </Routes>
      </GameStateProvider>
    </BrowserRouter>
  );
}
