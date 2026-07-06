/**
 * `HudRoot` — React 树根(plan/modules/hud.md §6 + §5)。
 *
 * 职责:
 *  - 用 React 19 `useSyncExternalStore` 订阅 `HudUiStore`,拿到 `HudUiState`;
 *  - 把 store 数据**只读**地传给 widgets / overlays;
 *  - 按 `state.scene` 切根布局 + 浮层(roadmap §3.8 + hud.md §5 表格);
 *  - 处理玩家点击 → 调 `pickReward(id, kind)`(由 props 注入)。
 *
 * 设计原则:
 *  - 这是**唯一**解释 `scene` 字段的地方(其他组件都不读 scene);
 *  - 自身**不**调 EventBus;只调上层注入的 `onPickReward` 回调。
 *  - 切换 scene 时用 React 条件渲染,避免在 DOM 残留旧 overlay。
 *
 * 范围(ui-react-split.md §2):
 *  - 只负责**游戏中**浮层 —— `running` / `levelup_modal` / `portal` / pause(在
 *    running 内)。
 *  - 全屏场景(`character_select` / `shop` / `gameover` / `victory`)由
 *    `src/pages/*` 路由组件渲染,**不**在本文件出现。
 */
import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";

import type { RewardId, RewardKind } from "../../../../runtime/types";

import type { HudUiStore, HudUiState } from "../HudUiStore";

import { HealthBar, XpBar, Timer, WeaponIcon, KillCounter, LevelBadge } from "./widgets";
import { LevelUpCards, PauseOverlay, PortalHint } from "./overlays";

/** `HudRoot` props —— 数据注入(由上层 `HudUiModule` 装配,这样组件零全局依赖)。 */
export interface HudRootProps {
  /** 通过 `useSyncExternalStore` 订阅的 store。 */
  store: HudUiStore;
  /** `scene` 数据读取器 —— 解耦 React 与 store 内部类型(让 store 可以被替换成 mock)。 */
  getState: () => HudUiState;
  /** 玩家点卡后的回调;HudRoot 内部不直接 emit 事件(由 HudUiModule 转发)。 */
  onPickReward: (id: RewardId, kind: RewardKind) => void;
}

/**
 * `HudRoot` 主组件。
 *
 * 内部按 scene dispatch:`running` → 顶条(HP/XP/Timer/Level/Weapon/Kills);
 * `levelup_modal` → 半透明遮罩 + 三选一卡;以此类推。
 */
export function HudRoot(props: HudRootProps): ReactElement {
  // 性能:`subscribe` 不可变(React 要求),`getSnapshot` 每次返回同一引用(直到 store 通知)。
  // 用 arrow wrapper 绕开 typescript(unbound-method) 警告:
  // store 的方法**不**依赖 `this` 上下文,但 linter 看的是"裸方法引用"。
  const state = useSyncExternalStore(
    (l) => props.store.subscribe(l),
    () => props.getState(),
    () => props.getState(),
  );
  return renderByScene(state, props.onPickReward);
}

/**
 * 按 scene 渲染对应的根布局 + 浮层。
 *
 * 拆出独立函数便于**单测**(纯函数:state + 回调 → ReactElement)。
 */
export function renderByScene(
  state: HudUiState,
  onPickReward: HudRootProps["onPickReward"],
): ReactElement {
  switch (state.scene) {
    case "running": {
      return (
        <div className="hud-root hud-root--running">
          <HudTopBar state={state} />
        </div>
      );
    }
    case "levelup_modal": {
      return (
        <div className="hud-root hud-root--levelup">
          {/* 世界仍可见(半透明遮罩由 CSS 控制),顶条仍可见 */}
          <HudTopBar state={state} />
          {state.sceneContext.scene === "levelup_modal" ? (
            <LevelUpCards
              choices={state.sceneContext.choices}
              kind="levelup"
              onPickReward={onPickReward}
            />
          ) : null}
        </div>
      );
    }
    case "portal": {
      const ctx = state.sceneContext;
      const portalPos = ctx.scene === "portal" ? ctx.portalPos : { x: 0, y: 0 };
      const remaining = ctx.scene === "portal" ? ctx.remainingEnemies : 0;
      return (
        <div className="hud-root hud-root--portal">
          <HudTopBar state={state} />
          <PortalHint portalPos={portalPos} remaining={remaining} />
        </div>
      );
    }
    // 全屏场景(`character_select` / `shop` / `gameover` / `victory`)由
    // 路由层负责 —— ui-react-split.md §2。本组件**不**渲染它们;
    // `RouteSceneBridge` 会在 `level:phase` 事件里把这些 scene 切成对应路由,
    // 切回本组件前会先经过 `running` 等中间态,所以这里走空根兜底。
    case "character_select":
    case "shop":
    case "gameover":
    case "victory":
      return <div className="hud-root" />;
    default: {
      // 兜底:未来 GameScene 加新字面量而本组件未更新,走空根。
      const _exhaustive: never = state.scene;
      void _exhaustive;
      return <div className="hud-root" />;
    }
  }
}

/**
 * 顶条 —— 在 `running` / `levelup_modal` / `portal` / `shop` scene 下显示。
 *
 * 注:不放在 `gameover` / `victory` / `character_select` —— 那些 scene 下需要
 * 全屏遮罩(roadmap §3.8)。`pause` 状态由 `Progression.pauseToggle` 控制,
 * `scene` 不变,顶条上加 `PauseOverlay` 即可(本模块**不**实现 pause 暂停后
 * 单独顶条变化,直接渲染顶条 + overlay 是普适形态)。
 */
function HudTopBar({ state }: { state: HudUiState }): ReactElement {
  return (
    <>
      <div className="hud-topbar">
        <HealthBar hp={state.player.hp} maxHp={state.player.maxHp} />
        <XpBar xp={state.player.level} />
        <Timer remaining={state.level.timerRemaining} total={state.level.timerTotal} />
        <LevelBadge level={state.level.level} />
        <WeaponIcon weaponId={"pistol"} />
        <KillCounter kills={state.player.kills} />
      </div>
      <PauseOverlay />
    </>
  );
}
