import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { Home } from "./pages/Home";
import { Game } from "./pages/Game";

export function App() {
  return (
    <BrowserRouter>
      {/*
        `/game` 不带任何外壳,自己撑满视口;其他路由共享带 nav + 居中容器的布局。
      */}
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
