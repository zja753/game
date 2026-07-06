/**
 * 浮层组件(plan/modules/hud.md §6)。
 *
 * 设计原则:
 *  - 全部**纯展示** —— 入参是数据 + 回调,不订阅 store;
 *    store 订阅由 `HudRoot` 统一负责,经 props 流入。
 *  - 所有 overlay **只**在特定 scene 下被父级 mount,自身不解释 scene 字段。
 *  - 玩家点击 → 调父级传下来的回调 —— 不直接 emit 事件。
 *
 * 范围(ui-react-split.md §2):
 *  - 本文件**只**保留"游戏中"浮层:`LevelUpCards` / `PauseOverlay` / `PortalHint`。
 *  - 全屏浮层(`CharacterSelect` / `ShopOverlay` / `GameOverOverlay` /
 *    `VictoryOverlay`)已迁出到 `src/pages/*` 路由,这里**不**再导出。
 */
import type { ReactElement } from "react";

import type { RewardId, RewardKind } from "../../../../runtime/types";

/**
 * `LevelUpCards` —— 升级三选一卡片。
 *
 * @param choices 由 `level:phase.context.choices` 注入的 `RewardId` 列表。
 *                首版 SceneContext 不带 name/description,只显示 ID 占位;
 *                等 RewardShop 暴露 `listRewards()` 后再按 id 查 name。
 * @param onPickReward 玩家点卡后的回调 → emit `reward:picked`。
 */
export function LevelUpCards({
  choices,
  kind,
  onPickReward,
}: {
  choices: readonly RewardId[];
  kind: RewardKind;
  onPickReward: (id: RewardId, kind: RewardKind) => void;
}): ReactElement {
  if (choices.length === 0) {
    return <div className="hud-overlay hud-overlay--levelup">loading...</div>;
  }
  return (
    <div className="hud-overlay hud-overlay--levelup" role="dialog" aria-label="level up">
      <h2 className="hud-overlay__title">升级</h2>
      <div className="hud-overlay__cards">
        {choices.map((id) => (
          <button
            key={id}
            type="button"
            className="hud-card"
            onClick={() => onPickReward(id, kind)}
          >
            <span className="hud-card__id">{id}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * `PauseOverlay` —— 暂停遮罩(roadmap §1 + hud.md §5)。
 *
 * `pause` 不是独立 `GameScene`,是 `running` 内部的子态(roadmap §1 注释),
 * Progression 自己维护;本组件在 `running` 场景下始终挂载,通过 CSS 控制
 * 显隐(roadmap §1 "pause 状态由 Progression.pauseToggle 控制,scene 不变,
 * 顶条上加 PauseOverlay 即可")。
 */
export function PauseOverlay(): ReactElement {
  return (
    <div className="hud-overlay hud-overlay--pause" role="dialog" aria-label="paused">
      <h2 className="hud-overlay__title">已暂停</h2>
      <p className="hud-overlay__hint">按 Esc 继续</p>
    </div>
  );
}

/**
 * `PortalHint` —— `portal` scene 下的中央提示(roadmap §1 + hud.md §5)。
 */
export function PortalHint({
  portalPos,
  remaining,
}: {
  portalPos: { x: number; y: number };
  remaining: number;
}): ReactElement {
  return (
    <div className="hud-overlay hud-overlay--portal" role="dialog" aria-label="portal">
      <h2 className="hud-overlay__title">找传送门</h2>
      <p className="hud-overlay__hint">
        传送门位于 ({Math.round(portalPos.x)}, {Math.round(portalPos.y)});剩余敌人 {remaining}
      </p>
    </div>
  );
}
