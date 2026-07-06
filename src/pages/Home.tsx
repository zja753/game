/**
 * `/` 首页(plan/ui-react-split.md §2)。
 *
 * 纯 React 路由,完全不依赖 canvas / 任何模块。**唯一**职责:展示入口,
 * 引导玩家到 `/select`。
 *
 * 后续打磨(step 5):
 *  - 加背景图 / 音效 / 设置入口
 *  - "继续"按钮(读取上次未完成的 run,本期不做)
 */
import { useNavigate } from "react-router-dom";

export function Home(): React.ReactElement {
  const navigate = useNavigate();
  return (
    <section className="page">
      <h1 className="page__title">土豆兄弟风格 demo</h1>
      <p className="page__hint">Canvas 只画游戏世界,所有 UI 走 React 路由。</p>
      <button type="button" className="page__cta" onClick={() => navigate("/select")}>
        开始游戏
      </button>
    </section>
  );
}
