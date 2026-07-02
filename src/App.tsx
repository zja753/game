import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { Home } from "./pages/Home";
import { Game } from "./pages/Game";

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
