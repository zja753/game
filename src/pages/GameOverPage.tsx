/**
 * `/game-over` 死亡结算页(plan/ui-react-split.md §2)。
 *
 * 实质是 `ResultPage` 的"gameover"变体包装 —— 把页面类型和变体绑死,
 * 这样 `App.tsx` 的路由表只需要 `<Route element={<GameOverPage />} />`,
 * 不必每个调用方都传 variant。
 */
import { ResultPage } from "./ResultPage";

export function GameOverPage(): React.ReactElement {
  return <ResultPage variant="gameover" />;
}
