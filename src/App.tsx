import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { Home } from "./pages/Home";
import { Game } from "./pages/Game";

/**
 * 路由壳:
 *  - `/`     → 文档流里的 Home 页面(被 nav + 居中 main 包住)。
 *  - `/game` → RootContainer + canvas,**独立**于文档流;
 *    不被 `main.app-main` 的居中 padding 影响,canvas 占满视口。
 *    HUD 是 `position: fixed` 浮层,不需要 main 容器。
 */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/game" element={<Game />} />
        <Route
          path="*"
          element={
            <>
              <nav className="app-nav">
                <Link to="/">Home</Link>
                <Link to="/game">Game</Link>
              </nav>
              <main className="app-main">
                <Routes>
                  <Route path="/" element={<Home />} />
                </Routes>
              </main>
            </>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
