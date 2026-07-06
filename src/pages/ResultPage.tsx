/**
 * 通用结算页 —— 同时服务 `/game-over` 和 `/victory`(plan/ui-react-split.md §2)。
 *
 * 第 3+4 步:接通 `useGameState()` —— 监听 `level:phase` 事件,缓存最近一次
 * `gameover` / `victory` 的 `RunStats` 快照;点"再来一局"调
 * `progression.startRun()` 重置。
 *
 * stats 数据流(plan/modular-roadmap.md §1 + runtime/types.ts):
 *  - Progression 在切到 `gameover` / `victory` scene 时,把 RunStats 塞进
 *    `SceneContext`(见 SceneContext gameover / victory 分支)。
 *  - 本页通过订阅 `level:phase` 事件捕获 SceneContext,缓存成 React state。
 *  - Progression 没有暴露直接读 RunStats 的 Port 方法(避免 Page 直接读
 *    模块内部状态),所以走事件订阅。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 本文件不直接 import 任何 modules 下的 internal;Port 通过 Context 注入。
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useGameState } from "../runtime/GameStateContext";
import type { RunStats } from "../runtime/types";

/** 占位数据 —— 在 stats 还没从事件到达前(首帧)使用。 */
const PLACEHOLDER_STATS: RunStats = {
  elapsed: 0,
  kills: 0,
  damageDealt: 0,
  level: 1,
  playerLevel: 1,
};

interface ResultPageProps {
  /** 区分两种结算;影响标题、文案、以及监听哪种 scene 的 stats。 */
  variant: "gameover" | "victory";
}

/**
 * 订阅 `level:phase`,缓存最近一次匹配 `variant` 的 RunStats。
 *
 * - 事件 SceneContext 的 `gameover` / `victory` 分支带 `stats: RunStats`。
 * - `useEffect` 在 state 就绪后建立订阅,清理时反订阅。
 */
function useLatestStats(variant: "gameover" | "victory"): RunStats {
  const state = useGameState();
  const [stats, setStats] = useState<RunStats>(PLACEHOLDER_STATS);
  useEffect(() => {
    if (state === null) return;
    return state.bus.on("level:phase", (event) => {
      if (event.scene !== variant) return;
      if (event.context.scene !== variant) return;
      setStats(event.context.stats);
    });
  }, [state, variant]);
  return stats;
}

/**
 * @param variant "gameover" → 标题 "Game Over";"victory" → "Victory"。
 */
export function ResultPage({ variant }: ResultPageProps): React.ReactElement {
  const navigate = useNavigate();
  const state = useGameState();
  const stats = useLatestStats(variant);
  const title = variant === "gameover" ? "Game Over" : "Victory";
  return (
    <section className="page">
      <h1 className="page__title">{title}</h1>
      <dl className="result-stats">
        <dt>时长</dt>
        <dd>{stats.elapsed.toFixed(1)} s</dd>
        <dt>击杀</dt>
        <dd>{stats.kills}</dd>
        <dt>伤害</dt>
        <dd>{stats.damageDealt}</dd>
        <dt>关卡</dt>
        <dd>{stats.level}</dd>
        <dt>玩家等级</dt>
        <dd>{stats.playerLevel}</dd>
      </dl>
      <button
        type="button"
        className="page__cta"
        onClick={() => {
          if (state === null) {
            void navigate("/select");
            return;
          }
          // gameover/victory → character_select;roadmap §1 表 startRun() 列。
          // Progression 切回 character_select scene 后 emit level:phase,
          // RouteSceneBridge navigate 到 /select。
          state.progression.startRun();
        }}
      >
        再来一局
      </button>
      <button type="button" className="page__cta" onClick={() => void navigate("/")}>
        回首页
      </button>
    </section>
  );
}
