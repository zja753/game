/**
 * `GameEventBus` — 跨模块事件总线(见 plan/modular-roadmap.md §2.1)。
 *
 * 设计约束(plan §0.1):
 *  - 事件 payload **只**是纯数据(`{ x, y, hp, kind, ... }`),**绝不**放 Actor 引用。
 *  - 模块之间**只**通过 `on / emit / clear` 三件套通讯。
 *
 * 实现要点:
 *  - 类型化的事件字典(每个 `type` 对应一个 payload 形状),靠 TS 联合保证
 *    `on("input:fire", ...)` 时 handler 收到的 payload 一定是 `InputFireEvent`。
 *  - `on` 返回反订阅函数(plan 明确要求),`clear()` 整体重置(关卡重开时调用)。
 *  - **不**做异步(无 micro-task / setTimeout),emit 同步遍历订阅者。订阅者
 *    内部可以自由 `off` 自己(用 for 拷贝迭代避免 Set 突变)。
 *  - **不**依赖任何模块(纯 TS),所以可以在任何上下文中创建,运行时 / 单测
 *    都直接用同一个实现,不提供 mock。
 *
 * 当前事件字典(逐步扩展):
 *  - `input:move`     — Input 模块每帧最多发一次(松开归零时也发)。
 *  - `input:fire`     — Input 模块边沿触发,按下瞬间发一次。
 *  - `input:pause`    — Input 模块边沿触发,按下瞬间发一次。
 *  - `player:moved`   — Player 模块阈值触发(vel 变化或位移超阈值),不每帧发。
 *  - `player:damaged` — Player 模块在 `applyDamage` 实际扣血时发。
 *  - `player:died`    — Player 模块 HP 降到 0 时发一次。
 *  - `projectile:hit` — Combat 模块投射物命中目标时发(HUD 命中反馈)。
 *  - `enemy:killed`   — Combat 模块判定致死时发(Progression 累加 XP)。
 *  - `enemy:spawned`  — Enemy 模块生成敌人时发(Combat 同步列表用)。
 *  - `enemy:dying`    — Enemy 模块敌人血归零时发(广播用,Combat 不订阅)。
 *  - `xp:gained` / `level:up` / `level:phase` / `timer:tick` / `portal:appeared` — Progression 模块场景 / 经验 / 倒计时。
 *  - `reward:available` / `reward:applied` / `reward:picked` — RewardShop + HudUi 协作;`picked` 由 HUD 发出。
 *  - `map:loaded`     — MapObstacle 切关时发(Camera 订阅重算 clamp)。
 *  - `camera:moved`   — Camera 写完 `Scene.camera.pos` 时发(HUD 小地图)。
 *
 * 后续模块(Progression / RewardShop / HudUi / MapObstacle / Camera …)落位时,
 * **只往 `GameEventMap` 里加新条目**,不改这里的事件派发机制。
 */

import type { GameScene, LevelId, RewardId, RewardKind, SceneContext } from "./types";

// ---- 事件字典(每个 `type` 对应一个 payload 形状) ----

/** `input:move` — 每帧最多发一次,WASD 复合按压的归一化结果。 */
export interface InputMoveEvent {
  type: "input:move";
  /** 水平分量,[-1, 1],负 = 左。 */
  dx: number;
  /** 垂直分量,[-1, 1],负 = 上(屏幕坐标 y 向下,但 Input 层归一化为"上为负")。 */
  dy: number;
}

/** `input:fire` — 边沿触发,玩家按下 fire 的瞬间。 */
export interface InputFireEvent {
  type: "input:fire";
  /** 触发瞬间为 `true`,保留字段便于以后扩展 hold / 双击。 */
  pressed: true;
}

/** `input:pause` — 边沿触发,玩家按下 pause 的瞬间。 */
export interface InputPauseEvent {
  type: "input:pause";
  pressed: true;
}

/** `player:moved` — 玩家位置 / 朝向"显著"变化时发(不每帧发,见 plan/modules/player.md §3)。 */
export interface PlayerMovedEvent {
  type: "player:moved";
  /** 玩家当前世界坐标。 */
  x: number;
  y: number;
  /**
   * 当前面向角(弧度)。`{x:1,y:0}` 对应 0,`{x:0,y:1}` 对应 +π/2。
   * 当 `facing` 是零向量时(玩家没移动且鼠标正中心)这里用 `0` 兜底。
   */
  facing: number;
}

/** `player:damaged` — `applyDamage` 实际扣血时发,死亡也算最后一次扣血(在 `player:died` 之前发)。 */
export interface PlayerDamagedEvent {
  type: "player:damaged";
  /** 扣血后剩余 HP(已 clamp 到 `[0, maxHp]`)。 */
  hp: number;
  /** HP 上限,订阅者(典型:HUD)用 `hp/maxHp` 算百分比。 */
  maxHp: number;
  /** 伤害来源原始 payload,本模块**不**解释。 */
  from?: unknown;
}

/** `player:died` — 玩家 HP 归 0 时发一次,GameScene 切到 `gameover` 由此触发。 */
export interface PlayerDiedEvent {
  type: "player:died";
  /** 死亡时刻(逻辑时间,毫秒;走 `RuntimePort.now()`)。 */
  at: number;
}

/** `projectile:hit` — 投射物命中目标时发(HUD 渲染命中反馈 / 数字飘字)。 */
export interface ProjectileHitEvent {
  type: "projectile:hit";
  /** 命中世界坐标(像素)。 */
  x: number;
  y: number;
  /** 目标种类(`EnemyKind` 字符串,本模块不解释)。 */
  targetKind: string;
  /** 本次伤害值。 */
  damage: number;
  /** 本次是否击杀。 */
  isKill: boolean;
}

/** `enemy:killed` — 投射物命中致死时发,由 Combat 广播(plan §7 双发语义)。 */
export interface EnemyKilledEvent {
  type: "enemy:killed";
  /** 敌人种类(由 Enemy 模块发出 `enemy:dying` 时携带,Combat 透传)。 */
  kind: string;
  /** 死亡时世界坐标(像素)。 */
  x: number;
  y: number;
  /** 本次击杀奖励的经验值(plan §3.4);Progression 订阅累加。 */
  xp: number;
}

/** `enemy:spawned` — Enemy 模块生成敌人时发,Combat 订阅用来同步列表(可选优化)。 */
export interface EnemySpawnedEvent {
  type: "enemy:spawned";
  id: number;
  kind: string;
  x: number;
  y: number;
}

/** `enemy:dying` — Enemy 模块敌人血归零时发,Combat **不**订阅(由 `DamageResult.isKill` 同步拿结果)。 */
export interface EnemyDyingEvent {
  type: "enemy:dying";
  id: number;
  kind: string;
  x: number;
  y: number;
}

/** 已知事件字典;新事件往这里加,`GameEvent = keyof GameEventMap`。 */
export interface GameEventMap {
  "input:move": InputMoveEvent;
  "input:fire": InputFireEvent;
  "input:pause": InputPauseEvent;
  "player:moved": PlayerMovedEvent;
  "player:damaged": PlayerDamagedEvent;
  "player:died": PlayerDiedEvent;
  "projectile:hit": ProjectileHitEvent;
  "enemy:killed": EnemyKilledEvent;
  "enemy:spawned": EnemySpawnedEvent;
  "enemy:dying": EnemyDyingEvent;
  "xp:gained": XpGainedEvent;
  "level:up": LevelUpEvent;
  "level:phase": LevelPhaseEvent;
  "timer:tick": TimerTickEvent;
  "portal:appeared": PortalAppearedEvent;
  "reward:available": RewardAvailableEvent;
  "reward:applied": RewardAppliedEvent;
  "reward:picked": RewardPickedEvent;
  "map:loaded": MapLoadedEvent;
  "camera:moved": CameraMovedEvent;
}
/** `xp:gained` — 经验获得时发(plan/modules/progression.md §3,Progression 在 `enemy:killed` 后广播)。 */
export interface XpGainedEvent {
  type: "xp:gained";
  /** 本次获得的经验值(可能为 0,如击杀 0 经验敌人)。 */
  amount: number;
  /** 累加后的总经验(玩家升级用)。 */
  total: number;
}

/** `level:up` — 玩家升级(经验达阈值)时发,与 `level:phase` 到 `levelup_modal` 是同一时刻的两件事(progression.md §3)。 */
export interface LevelUpEvent {
  type: "level:up";
  /** 升级后的玩家等级(1-based)。 */
  level: number;
  /** 升级三选一候选 ID 列表(Progression 已从 RewardShop 拉好;HUD 直接渲染)。 */
  choices: readonly RewardId[];
}

/** `level:phase` — 场景切换的**唯一信源**(progression.md §3,roadmap §1)。 */
export interface LevelPhaseEvent {
  type: "level:phase";
  scene: GameScene;
  /** 该 scene 携带的上下文(详见 `SceneContext`,见 runtime/types.ts)。 */
  context: SceneContext;
}

/** `timer:tick` — 关卡倒计时每帧发(仅在 `running` scene 下;progression.md §3)。 */
export interface TimerTickEvent {
  type: "timer:tick";
  /** 剩余秒数(浮点;<= 0 时 Progression 切到 `portal` scene)。 */
  remaining: number;
  /** 关卡总时长秒数(HUD 显示"剩余 / 总时长"用)。 */
  total: number;
}

/** `portal:appeared` — 传送门生成瞬间发 1 次(仅在 `running → portal` 转移;progression.md §3)。 */
export interface PortalAppearedEvent {
  type: "portal:appeared";
  /** 传送门世界坐标(像素)。 */
  x: number;
  y: number;
}

/** `reward:available` — RewardShop 准备好的可选奖励(升级三选一 / 商店物品);HUD 拿到后渲染卡片(rewards.md §3)。 */
export interface RewardAvailableEvent {
  type: "reward:available";
  /** 候选 ID 列表(长度:升级 = 3,商店 = 4~6)。 */
  ids: readonly RewardId[];
  /** 是否是商店上下文(true = 商店面板,false = 升级三选一)。 */
  isShop: boolean;
}

/** `reward:applied` — 奖励成功应用(注册回调执行完成)时发(rewards.md §3)。 */
export interface RewardAppliedEvent {
  type: "reward:applied";
  id: RewardId;
  kind: RewardKind;
}

/** `reward:picked` — 玩家在 HUD 上点击了某个卡片;Progression 订阅后切回 `running` 并调 `RewardShop.applyReward`。
 *  注意:**本事件由 HudUi 发出**,不是 RewardShop(rewards.md §3 注释:RewardShop **不**订阅此事件)。 */
export interface RewardPickedEvent {
  type: "reward:picked";
  id: RewardId;
  kind: RewardKind;
}

/** `map:loaded` — 当前关卡地图被加载 / 切换时发(obstacle.md §3);Camera 订阅它重算 clamp 范围。 */
export interface MapLoadedEvent {
  type: "map:loaded";
  /** 关卡 ID(与 `MapObstaclePort.loadLevel` 的入参一致)。 */
  level: LevelId;
}

/** `camera:moved` — 摄像机世界坐标发生变化时发(camera.md §3);HudUi 用来更新小地图 / 屏幕边缘提示。
 *  注意:不是每帧都发 —— 内部与上一帧位置相同则不广播。 */
export interface CameraMovedEvent {
  type: "camera:moved";
  /** 摄像机左上角世界坐标(像素)。 */
  x: number;
  y: number;
  /** 视口尺寸(像素);HUD 可用此算"摄像机在屏幕外偏移比例"。 */
  viewportWidth: number;
  viewportHeight: number;
}
/** 任意已知事件(联合类型),emit / on 接受的形态。 */
export type GameEvent = GameEventMap[keyof GameEventMap];

/** 事件 `type` 字符串字面量联合,供动态调度用。 */
export type GameEventType = GameEvent["type"];

/** 订阅者签名:对 `T extends GameEvent` 强类型化。 */
export type GameEventHandler<T extends GameEvent> = (event: T) => void;

// ---- EventBus 实现 ----

/** 内部订阅表:`type -> Set<handler>`,按事件类型分桶避免广播。 */
type SubscriberSet = Set<GameEventHandler<GameEvent>>;

/**
 * 轻量、类型安全的发布订阅总线。
 *
 * 用法:
 * ```ts
 * const bus = createGameEventBus();
 * const off = bus.on("input:move", (e) => console.log(e.dx, e.dy));
 * bus.emit({ type: "input:move", dx: 1, dy: 0 });
 * off();
 * bus.clear(); // 关卡重开时
 * ```
 */
export interface GameEventBus {
  /**
   * 订阅 `type` 事件;返回反订阅函数。
   *
   * `handler` 收到的 payload **类型由 `type` 决定**,TS 会强制匹配。
   */
  on<T extends GameEventType>(type: T, handler: GameEventHandler<GameEventMap[T]>): () => void;

  /** 触发一个事件;同步遍历订阅者(无异步)。 */
  emit(event: GameEvent): void;

  /** 清空所有订阅。关卡重开 / RootContainer 销毁时调一次。 */
  clear(): void;

  /** 调试用:已注册的订阅者总数(所有事件类型合计)。 */
  subscriberCount(): number;
}

export function createGameEventBus(): GameEventBus {
  // 内部桶用 `unknown` 存储,emit / on 边界由强类型签名保证安全。
  const subs = new Map<GameEventType, Set<GameEventHandler<GameEvent>>>();

  function bucket(type: GameEventType): SubscriberSet {
    let b = subs.get(type);
    if (!b) {
      b = new Set();
      subs.set(type, b);
    }
    return b;
  }

  const bus: GameEventBus = {
    on(type, handler) {
      // 转换签名:对调用方强类型化,内部用宽口径 Set 存。
      const h = handler as GameEventHandler<GameEvent>;
      bucket(type).add(h);
      return () => {
        bucket(type).delete(h);
      };
    },

    emit(event) {
      const b = subs.get(event.type);
      if (!b || b.size === 0) return;
      // 拷贝迭代:handler 内部 off 自己不会破坏遍历。
      for (const handler of Array.from(b)) {
        handler(event);
      }
    },

    clear() {
      subs.clear();
    },

    subscriberCount() {
      let n = 0;
      for (const b of subs.values()) n += b.size;
      return n;
    },
  };

  return bus;
}
