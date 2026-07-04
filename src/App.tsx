import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { Home } from "./pages/Home";
import { Game } from "./pages/Game";

/**
 * 占位阶段两个路由都走同一个 nav + 居中容器布局。
 * 后续 RootContainer 上线、Excalibur canvas 需要全屏时,
 * 再把 `/game` 拆出来独立路由、脱离文档流。
 */
export function App() {
  return (
    <BrowserRouter>
      <nav className="app-nav">
        <Link to="/">Home</Link>
        <Link to="/game">Game</Link>
      </nav>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/game" element={<Game />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
