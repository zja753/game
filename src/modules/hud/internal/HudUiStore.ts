/**
 * `HudUiStore` — HudUi 模块的"事件 → 视图态"纯函数 reducer(plan/modules/hud.md §6 + §5)。
 *
 * 职责:
 *  - 把 `GameEvent` 序列归约成一份 `HudUiState`(渲染所需的全部字段);
 *  - 纯函数:`reduce(state, event) → newState` —— 没有副作用,不入参 Excalibur,
 *    单测可独立跑(EventBridge 拿到事件后逐条喂给本 reducer)。
 *  - 内部**不**直接订阅 EventBus —— EventBus 适配层(`EventBridge`)负责订阅,
 *    本 reducer 只关注"收到一条事件,状态怎么改"。
 *
 * 设计原则:
 *  - store 是**读模型**,不是**业务权威**:
 *     - HP/经验 / 计时 / 击杀数等字段**权威**在 Player / Progression 模块;
 *     - 本 store 只是把权威值缓存成 React 可读的形态,实际更新靠事件流驱动。
 *     - 这是 hud.md §4"无权威字段"的具体实现。
 *  - `scene` 字段直接由 `level:phase.scene` 决定;HUD 不解释 scene,只渲染。
 *  - `rewardChoiceIds` 跟着 `level:up` 走(升级三选一),`shopItemIds` 跟着
 *    `reward:available { isShop: true }` 走;玩家点哪张卡,就 emit `reward:picked`。
 *  - 没有事件对应的"未知 / 初始"字段用零值,reducer 不做 null 检查。
 *
 * 关于"组件订阅 store"的形态:
 *  - 避免引入 Zustand / Jotai 等新依赖 —— 用 React `useSyncExternalStore` +
 *    本 store 的简单 `subscribe` 能力即可(react 19 自带)。
 *  - 因此本 store **必须**暴露 `getState()` + `subscribe(listener)` 这对原语,
 *    与 `useSyncExternalStore` 的契约对齐。
 */
import type {
  CameraMovedEvent,
  EnemyKilledEvent,
  LevelPhaseEvent,
  LevelUpEvent,
  MapLoadedEvent,
  PlayerDamagedEvent,
  PlayerDiedEvent,
  ProjectileHitEvent,
  RewardAppliedEvent,
  RewardAvailableEvent,
  TimerTickEvent,
} from "../../../runtime/EventBus";
import type { LevelId, RewardId, SceneContext } from "../../../runtime/types";
import type { GameEvent } from "../../../runtime/EventBus";
import type { GameScene } from "../../../runtime/types";

// ---- 视图态形状 ----

/**
 * 玩家 HUD 概要:HP / XP / 玩家等级 / 击杀数。
 *
 * 不存玩家位置 / 朝向 —— `player:moved` 频率太高,放大带入 React 树会导致
 * 不必要的 re-render;首版 HUD 不画小地图,所以不缓存位置。
 */
export interface HudPlayerSummary {
  hp: number;
  maxHp: number;
  /** 玩家升级等级(由 `level:up` 推动;初始 = 1)。 */
  level: number;
  /** 累加的击杀数(由 `enemy:killed` 推动,`any-kind`) —— 玩家累计击杀。 */
  kills: number;
}

/**
 * 关卡 / 倒计时信息。
 *  - `level`:当前关卡 ID(由 `map:loaded` 推动;初始 `null`)。
 *  - `timerRemaining` / `timerTotal`:每帧 `timer:tick` 推动;首版只渲染文本。
 *  - `portalActive`:是否进入 `portal` scene(HUD 在此 scene 下显示"找传送门"提示)。
 */
export interface HudLevelInfo {
  level: LevelId | null;
  timerRemaining: number;
  timerTotal: number;
  /** 最后一帧 `camera:moved` 携带的 viewport 尺寸(像素);首版 HUD 不画小地图,留作 §5 扩展点。 */
  viewportWidth: number;
  viewportHeight: number;
}

/**
 * 升级三选一 / 商店物品的"候选 ID" + 当前 scene 上下文。
 *
 * 注意:`scene === "levelup_modal"` 时 HUD 应展示 `levelUpChoices`;
 *      `scene === "shop"` 时 HUD 应展示 `shopItems`;
 * 两者**互斥**(不在同一 scene 同时出现),但 reducer 各自独立存,组件层按 scene 取用。
 *
 * `lastRewardContext` 是 `level:phase` 携带的 `SceneContext`(scene === "levelup_modal" / "shop" 时
 * 是非空对象;其他 scene 为 `null`),便于组件侧直接读 `choices` / `items` 而
 * 不用回放 `reward:available` 序列。
 */
export interface HudRewardState {
  levelUpChoices: readonly RewardId[];
  shopItems: readonly RewardId[];
  /** `scene` 切到 `levelup_modal` / `shop` 时携带的 ctx,其他 scene 清空。 */
  lastRewardContext:
    | Extract<SceneContext, { scene: "levelup_modal" }>
    | Extract<SceneContext, { scene: "shop" }>
    | null;
}

/** HUD 视图态全集 —— `reduce(state, event) → nextState` 的状态形参。 */
export interface HudUiState {
  scene: GameScene;
  /** `scene` 的上下文载荷,跟随 `level:phase` 走(roadmap §3.8 + hud.md §5)。 */
  sceneContext: SceneContext;
  player: HudPlayerSummary;
  level: HudLevelInfo;
  rewards: HudRewardState;
  /** 最近一次 `projectile:hit` 的命中点(像素);HUD 可用来飘伤害数字。 */
  lastHit: { x: number; y: number; damage: number; isKill: boolean } | null;
}

/** 初始视图态 —— 默认 scene = `character_select`(hud.md §5 起始态)。 */
export const INITIAL_HUD_STATE: HudUiState = {
  scene: "character_select",
  sceneContext: { scene: "character_select", characters: [] },
  player: { hp: 0, maxHp: 1, level: 1, kills: 0 },
  level: {
    level: null,
    timerRemaining: 0,
    timerTotal: 0,
    viewportWidth: 0,
    viewportHeight: 0,
  },
  rewards: { levelUpChoices: [], shopItems: [], lastRewardContext: null },
  lastHit: null,
};

// ---- Reducer ----

/**
 * 把一条 `GameEvent` 应用到当前 state,得到下一帧 view state。
 *
 * 严格纯函数 —— **不**抛错,未识别事件返回 `state` 不变(类型系统已经穷尽
 * 已知事件,但保留 defensive default 防止运行时新事件扩展)。
 */
export function reduceHudUi(state: HudUiState, event: GameEvent): HudUiState {
  switch (event.type) {
    case "player:damaged":
      return reducePlayerDamaged(state, event);
    case "player:died":
      return reducePlayerDied(state, event);
    case "player:moved":
      // HUD 首版不显示玩家位置;reducer 显式忽略以避免误传播(roadmap §0.1)。
      return state;
    case "enemy:killed":
      return reduceEnemyKilled(state, event);
    case "level:up":
      return reduceLevelUp(state, event);
    case "level:phase":
      return reduceLevelPhase(state, event);
    case "timer:tick":
      return reduceTimerTick(state, event);
    case "map:loaded":
      return reduceMapLoaded(state, event);
    case "reward:available":
      return reduceRewardAvailable(state, event);
    case "reward:applied":
      return reduceRewardApplied(state, event);
    case "projectile:hit":
      return reduceProjectileHit(state, event);
    case "camera:moved":
      return reduceCameraMoved(state, event);
    case "input:move":
    case "input:fire":
    case "input:pause":
    case "enemy:spawned":
    case "enemy:dying":
    case "portal:appeared":
    case "xp:gained":
    case "reward:picked":
      // HUD 用不上的事件,显式归类:不抛错、忽略。
      return state;
    default: {
      // 穷尽性兜底:若未来 EventBus 加新事件而本 reducer 未更新,TS 编译期
      // 不会报错(联合类型扩展时如果上层不收紧,这里走 `never`)。
      const _exhaustive: never = event;
      void _exhaustive;
      return state;
    }
  }
}

function reducePlayerDamaged(state: HudUiState, event: PlayerDamagedEvent): HudUiState {
  // `player:damaged` 带 `hp` / `maxHp`;权威字段是事件携带的,这里"叠加"而不是"算差值"
  // —— 因为 Player 模块已经做了 clamp,**不**需要 HUD 再 clamp。
  return {
    ...state,
    player: { ...state.player, hp: event.hp, maxHp: event.maxHp },
  };
}

function reducePlayerDied(state: HudUiState, _event: PlayerDiedEvent): HudUiState {
  // `player:died` 之后 `level:phase = gameover` 很快到来,scene 那边会显示 GameOver。
  // HUD 这里**不**做 scene 切换(权威在 Progression),只是"轻微冲淡"HP 显示:
  // 重置到 0(maxHp 保留),让 GameOver overlay 里再展示最终结算 stats。
  return {
    ...state,
    player: { ...state.player, hp: 0 },
  };
}

function reduceEnemyKilled(state: HudUiState, _event: EnemyKilledEvent): HudUiState {
  // 累加击杀数;`xp` 字段 UI 首版不显示,等 Progression 模块的 HUD 兜底。
  return {
    ...state,
    player: { ...state.player, kills: state.player.kills + 1 },
  };
}

function reduceLevelUp(state: HudUiState, event: LevelUpEvent): HudUiState {
  // `level:up` 自带 `level` 升级后的等级;`choices` 与 `SceneContext.scene === "levelup_modal"` 时
  // 携带的 `choices` 等价(由 Progression 同步调 roll + emit `level:phase`)。这里**也**缓存一份,
  // 以防 Progression 在 `level:phase` 之前先发 `level:up`(防御性双通道)。
  return {
    ...state,
    player: { ...state.player, level: event.level },
    rewards: {
      ...state.rewards,
      levelUpChoices: event.choices,
    },
  };
}

function reduceLevelPhase(state: HudUiState, event: LevelPhaseEvent): HudUiState {
  // scene 切换的**唯一信源**;HUD 持有的是 view 镜像,权威在 Progression。
  // 离开 `levelup_modal` / `shop` 时清掉 rewards 缓存,防止旧 choices 残留在视图里;
  // 进入时把 SceneContext 里携带的 choices/items 同步到 rewards 字段,
  // 保证组件层读到的与 SceneContext 一致。
  const rewards: HudUiState["rewards"] = { ...state.rewards };
  if (event.scene === "levelup_modal" && event.context.scene === "levelup_modal") {
    rewards.lastRewardContext = event.context;
    rewards.levelUpChoices = event.context.choices;
  } else {
    rewards.lastRewardContext = null;
    rewards.levelUpChoices = [];
  }
  if (event.scene === "shop" && event.context.scene === "shop") {
    rewards.lastRewardContext = event.context;
    rewards.shopItems = event.context.items.map((it) => it.id);
  } else {
    rewards.shopItems = [];
  }
  return {
    ...state,
    scene: event.scene,
    sceneContext: event.context,
    rewards,
  };
}

function reduceTimerTick(state: HudUiState, event: TimerTickEvent): HudUiState {
  return {
    ...state,
    level: {
      ...state.level,
      timerRemaining: event.remaining,
      timerTotal: event.total,
    },
  };
}

function reduceMapLoaded(state: HudUiState, event: MapLoadedEvent): HudUiState {
  return {
    ...state,
    level: { ...state.level, level: event.level },
  };
}

function reduceRewardAvailable(state: HudUiState, event: RewardAvailableEvent): HudUiState {
  // `reward:available` 由 RewardShop 在 `rollLevelUpChoices` / `rollShopItems` 内部 emit,
  // 与 `level:phase` 携带的 SceneContext 内容一致(rewards.md §3 注释)。这里**冗余**缓存一份,
  // 让 widget 在等待 SceneContext 到达前也能渲染(防御性);实际显示以 SceneContext 为准。
  if (event.isShop) {
    return {
      ...state,
      rewards: { ...state.rewards, shopItems: event.ids },
    };
  }
  return {
    ...state,
    rewards: { ...state.rewards, levelUpChoices: event.ids },
  };
}

function reduceRewardApplied(state: HudUiState, _event: RewardAppliedEvent): HudUiState {
  // HUD 不需要为 `reward:applied` 做特殊视图变化 —— Progression 在收到后切回 `running`,
  // `level:phase` 事件会驱动遮罩卸载。这里保留 reducer 函数以保持事件穷尽性。
  return state;
}

function reduceProjectileHit(state: HudUiState, event: ProjectileHitEvent): HudUiState {
  return {
    ...state,
    lastHit: {
      x: event.x,
      y: event.y,
      damage: event.damage,
      isKill: event.isKill,
    },
  };
}

function reduceCameraMoved(state: HudUiState, event: CameraMovedEvent): HudUiState {
  // 首版 HUD 不画小地图,只用 viewport 尺寸做"屏幕边缘提示"。
  return {
    ...state,
    level: {
      ...state.level,
      viewportWidth: event.viewportWidth,
      viewportHeight: event.viewportHeight,
    },
  };
}

// ---- Store ----

/** Store 监听器签名 —— 由 React `useSyncExternalStore` 路径使用。 */
export type HudStoreListener = () => void;

/** 取消订阅。 */
export type Unsubscribe = () => void;

/**
 * `HudUiStore` 公共契约 —— 适配 React `useSyncExternalStore`:
 *  - `getState()` —— 同步读最新视图态(组件初次渲染时调一次)。
 *  - `subscribe(listener)` —— 订阅"下一次 state 变更"的通知;
 *    收到通知后 `getState()` 会拿到新值;**不**在通知里传 nextState(同步读取
 *    避免 React 拿到陈旧闭包,这是 useSyncExternalStore 的推荐形态)。
 *  - `dispatch(event)` —— 应用一条 `GameEvent` 到内部 state,通知所有订阅者。
 *
 *  这种"bus → store"适配:EventBridge 拿到事件后调 `dispatch`,
 * React 组件通过 `useSyncExternalStore` 订阅"state 变了"。
 */
export interface HudUiStore {
  getState(): HudUiState;
  subscribe(listener: HudStoreListener): Unsubscribe;
  dispatch(event: GameEvent): void;
}

/**
 * 创建 `HudUiStore` 实例 —— 内部对 `reduceHudUi` 套一个可订阅的 state 容器。
 *
 * 注意:首版**不**做"批处理 / 时间切片" —— 事件源是 `EventBus.emit`(同步),
 * 订阅者在收到通知后一次性读到最新 state。React 19 `useSyncExternalStore`
 * 处理 tearing 问题。
 */
export function createHudUiStore(initial: HudUiState = INITIAL_HUD_STATE): HudUiStore {
  let current: HudUiState = initial;
  const listeners = new Set<HudStoreListener>();

  return {
    getState() {
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch(event) {
      const next = reduceHudUi(current, event);
      // reducer 永远返回新对象(否则通知也无意义);同一引用时跳过通知。
      if (next !== current) {
        current = next;
        // 拷贝迭代:listener 内部 unsubscribe 不会破坏遍历。
        for (const l of Array.from(listeners)) l();
      }
    },
  };
}
