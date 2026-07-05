/**
 * 浮层组件(plan/modules/hud.md §6)。
 *
 * 设计原则:
 *  - 全部**纯展示** —— 入参是数据 + 回调(pickReward / onRestart),不订阅 store;
 *    store 订阅由 `HudRoot` 统一负责,经 props 流入。
 *  - 所有 overlay **只**在特定 scene 下被父级 mount,自身不解释 scene 字段。
 *  - 玩家点击 → 调父级传下来的 `onPickReward(id, kind)` —— 不直接 emit 事件。
 */
import type { ReactElement } from "react";

import type { RewardId, RewardKind, RunStats, ShopItem } from "../../../../runtime/types";

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
 * `ShopOverlay` —— 商店面板(显示 items + 价格)。
 */
export function ShopOverlay({
  items,
  onPickReward,
}: {
  items: readonly ShopItem[];
  onPickReward: (id: RewardId, kind: RewardKind) => void;
}): ReactElement {
  return (
    <div className="hud-overlay hud-overlay--shop" role="dialog" aria-label="shop">
      <h2 className="hud-overlay__title">商店</h2>
      <div className="hud-overlay__cards">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="hud-card"
            onClick={() => onPickReward(item.id, "shop")}
          >
            <span className="hud-card__name">{item.name}</span>
            <span className="hud-card__desc">{item.description}</span>
            <span className="hud-card__price">{item.price}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * `CharacterSelect` —— 起始页(roadmap §1 + hud.md §5 `character_select`)。
 *
 * 首版无角色数据(`SceneContext.characters = []`),显示"开始"按钮 → emit
 * `characterSelect` 的"开始"事件。本模块**不**发"开始"事件 —— Progression
 * 那边(roadmap §1 表格)由玩家点开始按钮驱动,首版可走输入系统调
 * `input:pause` 假触发,本模块不依赖该端。
 *
 * 留空:由调用方传 children(代表"开始按钮")。
 */
export function CharacterSelect({
  characters,
  children,
}: {
  characters: readonly string[];
  children?: ReactElement;
}): ReactElement {
  return (
    <div className="hud-overlay hud-overlay--character" role="dialog" aria-label="character select">
      <h2 className="hud-overlay__title">选择角色</h2>
      <ul className="hud-overlay__characters">
        {characters.map((id) => (
          <li key={id} className="hud-overlay__character">
            {id}
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}

/**
 * `PauseOverlay` —— 暂停遮罩(roadmap §1 + hud.md §5)。
 *
 * 首版**只**显示"已暂停"占位文字,实际"继续"按钮由 RootContainer / 全局
 * 输入系统(`input:pause` 边沿)接管 —— HUD 不解释输入意图。
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
 * `GameOverOverlay` —— 死亡结算(渲染 `RunStats`)。
 */
export function GameOverOverlay({ stats }: { stats: RunStats }): ReactElement {
  return (
    <div className="hud-overlay hud-overlay--gameover" role="dialog" aria-label="game over">
      <h2 className="hud-overlay__title">Game Over</h2>
      <dl className="hud-overlay__stats">
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
    </div>
  );
}

/**
 * `VictoryOverlay` —— 胜利结算。
 */
export function VictoryOverlay({ stats }: { stats: RunStats }): ReactElement {
  return (
    <div className="hud-overlay hud-overlay--victory" role="dialog" aria-label="victory">
      <h2 className="hud-overlay__title">Victory</h2>
      <dl className="hud-overlay__stats">
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
