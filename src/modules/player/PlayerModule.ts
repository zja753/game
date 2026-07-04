/**
 * `PlayerModule` — Player 模块对外的"装配层"。
 *
 * 把三个内部子模块(`PlayerMover` / `HealthController` / `FacingTracker` —
 * 通过 `PlayerActor` 包装)组合起来,实现 `PlayerPort` 接口的全部方法,
 * 然后把这个 Port 实例暴露给根容器 / 其他模块使用。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 这个文件**只**能被根容器 `import`。
 *  - 其他模块**不**能 import 它,只能 import 根容器传给它们的 `PlayerPort`。
 *
 * 权威字段(plan/modules/player.md §4):
 *  - `pos / hp / maxHp / facing / buffs / invulnerableTimer / inContactEnemies`
 *    → 全在 `PlayerActor` / 其三个子模块里持有,只通过 Port 暴露读 / 写能力。
 *
 * 模块间事件契约(plan §3 + EventBus 当前字典):
 *  - 订阅 `input:move` / `input:fire` 翻译成 Mover.setVel / CombatPort.tryFire。
 *  - 发出 `player:moved` / `player:damaged` / `player:died`。
 *  - **不**发 `level:phase`(那是 Progression 的职责)。
 */
import type { ActorId, Vec2 } from "../../runtime/types";
import type { GameEventBus } from "../../runtime/EventBus";
import type { RuntimePort } from "../runtime";
import type { InputPort } from "../input";
import type { CombatPort } from "../../runtime/ports/CombatPort";
import type { MapObstaclePort } from "../../runtime/ports/MapObstaclePort";
import type { PlayerPort, BuffSpec } from "../../runtime/ports/PlayerPort";

import { PlayerActor } from "./internal/PlayerActor";

/** 玩家与"墙"碰撞层的名字(供调用方在 `runtime.collision.addLayer` 时引用)。 */
export const PLAYER_COLLISION_LAYER = "player";
/** 玩家与"敌人"接触伤害层的名字。 */
export const PLAYER_CONTACT_LAYER = "player-contact";

export interface PlayerModuleDeps {
  /** 事件总线(emit `player:*` 事件 + 订阅 `input:*`)。 */
  bus: GameEventBus;
  /** Runtime Port(spawn 玩家 + 订阅 tick + 读 now)。 */
  runtime: RuntimePort;
  /** 输入查询(`InputPort`)。 */
  input: InputPort;
  /** 障碍查询(`MapObstaclePort`)。 */
  obstacles: MapObstaclePort;
  /** 开火入口(`CombatPort`)。 */
  combat: CombatPort;
  /**
   * 玩家初始位置;不传走 `{x:0, y:0}`。
   * 默认值常用于测试;正式游戏通常由 MapObstacle / Progression 决定
   * "出生点"再传进来。
   */
  initialPos?: Vec2;
  /**
   * 关卡内玩家碰撞层名(传给 Excalibur `CollisionGroupManager.create`)。
   * 不传走 `PLAYER_COLLISION_LAYER`。
   * 多模块装配时,Combat / Enemy 用同一字符串才能"撞到一起"。
   */
  playerLayer?: string;
  /**
   * 接触层名(玩家与敌人的"接触伤害"通道)。
   * 不传走 `PLAYER_CONTACT_LAYER`。
   */
  contactLayer?: string;
  /**
   * 接触伤害 hook(可选)。
   *
   * Player 模块**不**直接 import Enemy 模块 —— 接触伤害事件由根容器或未来
   * Enemy 模块接到 Excalibur `collisionstart` / `collisionend` 后,通过这里
   * 提供的两个回调转过来。`onStart` 接受 `(otherId, dmg)`:`otherId` 是
   * 接触方的 ActorId(`Enemy` 给的),`dmg` 是这一拍的接触伤害值;
   * `onEnd` 接受 `(otherId)`,做"离开接触"清理。
   *
   * 不传时,玩家依然能正常移动 / 受伤,只是没人驱动接触伤害 —— 单测 / Demo
   * 场景都合理。
   *
   * 内部走 `PlayerActor.handleContactStart/End`,经 `HealthController`
   * 的"同 enemy 重叠只扣一次"节流(plan §7 验收点)。
   */
  contacts?: {
    onStart(otherId: number, dmg: number): void;
    onEnd(otherId: number): void;
  };
}

/** `createPlayerModule` 工厂签名(根容器在装配阶段调用一次)。 */
export type PlayerPortFactory = (deps: PlayerModuleDeps) => PlayerPort;

/**
 * 移动事件的"位移阈值"(像素)——`player:moved` 在玩家移动超过这个
 * 距离时发,避免每帧发(plan §3 触发策略 + §7 验收点)。
 *
 * 数值选择:玩家默认速度 200 px/s,一帧 ~16ms → 3.2 px/帧;
 * 阈值 `2 px` 相当于"按了一下方向键"足够触发,贴墙磨蹭时不会发洪水。
 */
const MOVED_DISTANCE_THRESHOLD = 2;

/** 角度变化阈值(弧度)——`facing` 变化超过这个值也发(转向也算"动")。 */
const MOVED_ANGLE_THRESHOLD = 0.05;

/**
 * 创建 Player 模块实例。
 *
 * 生命周期(由根容器保证):
 *  1. 根容器 `createPlayerModule({ bus, runtime, input, obstacles, combat })` → 拿 `PlayerPort`。
 *  2. 根容器 `runtime.spawnActor({ kind: PlayerActor, config, layer: "player" })` 把自己挂进场景;
 *     `config` 由本工厂**外部** build(`buildActorConfig`),根容器需要先调它。
 *  3. 根容器 `runtime.collision.addLayer("player", "wall")` 之类的注册要在 spawn **之前**完成。
 *  4. 业务模块 `new XxxModule({ player: port })` 拿到这个 Port。
 *  5. 根容器拿到 spawn 的 id 后,调 `port.__setId(id)` 注入 Combat 用的 ownerId。
 */
export const createPlayerModule: PlayerPortFactory = (deps) => {
  const initial: Vec2 = deps.initialPos ?? { x: 0, y: 0 };

  // ---- 0. 玩家 ActorId
  // M4 Module-Combat 起,Combat 走 `tryFire(now, ownerId, origin)` 三参
  // 版本(`plan/modules/combat.md §2`),`ownerId` 由 Player 传。
  // 注入前 = 0(占位);真实装配时必须在 `runtime.spawnActor` 拿到玩家
  // id 后立刻调一次 `__setId(id)`。
  let playerId: ActorId = 0;

  // ---- 0. Collision group 注册 ----
  // 真实 `addLayer("player", "wall")` / `addLayer("player", "enemy")` 由
  // MapObstacle / Progression 模块在装配阶段调 `runtime.collision.addLayer`
  // 完成,本模块不碰。Layer 名字常量(`PLAYER_COLLISION_LAYER` /
  // `PLAYER_CONTACT_LAYER`)供调用方在 `addLayer` 时引用。
  // ---- 1. 内部状态 ----
  /** "上一次发 player:moved 时的位姿"——用来判阈值。 */
  let lastEmittedPos: Vec2 = { x: initial.x, y: initial.y };
  let lastEmittedFacingAngle = 0;
  /**
   * 显式的"是否已发过首帧 player:moved"标志 —— 之前的"lastEmitted == initial
   * && lastEmittedFacing == 0"启发式在 `initialPos != (0,0)` 的关卡里失效
   * (出生在 (50, 50),lastEmittedFacing 仍是 0,首帧不再触发,摄像机拿不到位置)。
   * 用显式 flag 保证"第一帧必发",同时 `reset()` 可以无歧义地清掉。
   */
  let hasEmittedMoved = false;

  // ---- 2. 事件回调:HealthController 的 onDamage / onDeath 钩子 ----
  const emit = (e: Parameters<GameEventBus["emit"]>[0]): void => {
    deps.bus.emit(e);
  };
  // 死亡算"最后一次扣血" —— onDamage 在 onDeath 前发。
  // 字段类型上用 plain `unknown` 而不是 `DamageSource | undefined`,后者因
  // DamageSource 本身就是 `unknown`,会被 eslint 标 redundant。
  const onDamage = (hp: number, maxHp: number, from: unknown): void => {
    emit({ type: "player:damaged", hp, maxHp, from });
  };

  // 死亡钩子先 emit damaged(让 HUD 看到 hp=0),再 emit died(让 Progression 切 scene)。
  const onDeath = (at: number): void => {
    emit({ type: "player:died", at });
  };

  // ---- 3. onMovedCheck:阈值过滤 + emit player:moved ----
  const onMovedCheck = (pos: Vec2, facing: Vec2): void => {
    const dx = pos.x - lastEmittedPos.x;
    const dy = pos.y - lastEmittedPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const angle = facing.x === 0 && facing.y === 0 ? 0 : Math.atan2(facing.y, facing.x);
    const dAngle = Math.abs(angle - lastEmittedFacingAngle);

    // 触发条件(plan §3):
    //   - 首次 emit(上一帧没发过)→ 一律发,让摄像机 / HUD 拿到初始位姿
    //     而不必等玩家走出阈值;`initialPos` 可能不为 (0,0),所以单独 flag。
    //   - 位移超阈值,或转向超阈值 → 算"显著移动",立刻发。
    if (!hasEmittedMoved || dist > MOVED_DISTANCE_THRESHOLD || dAngle > MOVED_ANGLE_THRESHOLD) {
      lastEmittedPos = { x: pos.x, y: pos.y };
      lastEmittedFacingAngle = angle;
      hasEmittedMoved = true;
      emit({ type: "player:moved", x: pos.x, y: pos.y, facing: angle });
    }
  };

  // ---- 4. 装配 PlayerActor ----
  // 先 build 一个"配置 + actor"组合,根容器拿这个 actor 去 spawnActor。
  // 这样 PlayerModule 与 Runtime.spawn 解耦 —— 测试里可以直接 `new PlayerActor(cfg)`
  // 然后手动 tick,不必过 Excalibur Engine。
  const actor = new PlayerActor({
    obstacles: deps.obstacles,
    input: deps.input,
    now: () => deps.runtime.now(),
    onDamage,
    onDeath,
    onMovedCheck,
    onContactStart: (otherId, dmg) => deps.contacts?.onStart(otherId, dmg),
    onContactEnd: (otherId) => deps.contacts?.onEnd(otherId),
  });
  actor.setPos(initial);

  // ---- 5. 帧驱动 + EventBus 订阅 ----
  /** 标记"是否在 GameScene.running"——暂停时不再 tick(由 Progression 控 clock 也能
   *  自动停,但这里防御性再挂一道)。首版用 `false` 默认,根容器在 `level:phase`
   *  切到 running 时调 `setEnabled(true)`(见返回的 `_setEnabled`,不暴露在 Port
   *  里 — 装配内部用)。 */
  let enabled = true;

  const offTick = deps.runtime.onTick((dt) => {
    if (!enabled) return;
    // 转发一帧到 actor 的 onPreUpdate(Excalibur Actor 的 onPreUpdate 由引擎调,
    // 但本模块要兼容"没有 Engine 直接 mock runtime"的测试场景,所以手动驱)。
    (actor as unknown as { onPreUpdate: (e: unknown, d: number) => void }).onPreUpdate(null, dt);
    // 死亡钩子触发后,把 actor 切到"死亡视觉":visible = false + vel = 0。
    // Excalibur 的可见性走 `actor.graphics.isVisible`,不是顶层 setter。
    if (actor.isDead() && actor.graphics.isVisible) {
      actor.enterDeathState();
    }
  });

  // ---- 6. input:move → Mover.setVel;input:fire → CombatPort.tryFire ----
  // 用 InputPort.axisMove 读"当前移动轴"即可,**不**用 input:move 事件(那事件
  // 是"变化时发",会漏掉"按住但不变"的情况;axisMove 每帧都查,稳定)。
  // input:fire 仍是边沿事件 —— CombatPort.tryFire 需要"按下瞬间"语义。
  const offInputMove = deps.bus.on("input:move", (e) => {
    if (actor.isDead()) return;
    // axisMove 的 dx/dy 是归一化单位向量,乘以默认速度 = 实际 vel。
    const speed = actor.mover.maxSpeedValue();
    actor.mover.setVel({ x: e.dx * speed, y: e.dy * speed });
  });

  const offInputFire = deps.bus.on("input:fire", () => {
    if (actor.isDead()) return;
    // M4 Module-Combat:tryFire 改三参(now, ownerId, origin) — 由 Player
    deps.combat.tryFire(deps.runtime.now(), playerId, actor.getPos());
  });

  // ---- 7. 公开的 Port ----

  const port: PlayerPort = {
    id: () => playerId,
    pos: () => actor.getPos(),
    setPos: (v) => actor.setPos(v),

    hp: () => actor.hpValue(),
    maxHp: () => actor.maxHpValue(),

    applyDamage: (amount, from) => actor.health.applyDamage(amount, from),
    applyHeal: (amount) => actor.health.applyHeal(amount),
    addBuff: (buff: BuffSpec) => actor.health.addBuff(buff),

    isDead: () => actor.isDead(),

    reset: () => {
      actor.resetState();
      // 把"上次 emit 位姿"对齐到当前位置,并清掉已发出标志 —— reset 后
      // 第一帧再次必发 `player:moved`,让 HUD / 摄像机立刻知道玩家位置。
      lastEmittedPos = { x: actor.getPos().x, y: actor.getPos().y };
      lastEmittedFacingAngle = 0;
      hasEmittedMoved = false;
    },
  };

  // 业务模块**不**该用 — 用完就破坏 Player 模块的封装。
  const portWithDispose = port as PlayerPort & {
    __dispose: () => void;
    __actor: PlayerActor;
    __setEnabled: (v: boolean) => void;
    __setId: (id: ActorId) => void;
  };
  portWithDispose.__actor = actor;
  portWithDispose.__dispose = (): void => {
    offTick();
    offInputMove();
    offInputFire();
  };
  portWithDispose.__setEnabled = (v: boolean): void => {
    enabled = v;
  };
  portWithDispose.__setId = (id: ActorId): void => {
    playerId = id;
  };

  return port;
};
