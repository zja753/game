/**
 * `PlayerActor` — Excalibur Actor 包装(plan/modules/player.md §5)。
 *
 * 职责:
 *  1. 继承 Excalibur `Actor`,把"玩家"挂进场景(由 `RuntimePort.spawnActor` 完成)。
 *  2. 把 `PlayerMover` / `HealthController` / `FacingTracker` 挂为**本 actor
 *    内部的"逻辑子模块"**(注:这里不强制走 Excalibur `Component` 抽象 —
 *    Excalibur Component 是给"多 actor 共享能力"用的,玩家只有一个,
 *    用裸字段更省事且更好测)。`PlayerActor` 自己持三件套。
 *  3. 持有 `pos` / `vel` / `visible` 权威位姿;`PlayerMover.step` 写回的位移
 *    通过 `applyPosition` 钩子落到这里;`PlayerActor` 决定是否同步到 `actor.pos`。
 *  4. 死亡时:`visible = false` + `vel = 0`(Mover 也 `stop`)。
 *  5. 帧驱动:`onPreUpdate(engine, dt)` 里依次 tick Mover / Health / Facing,
 *    然后判断是否触发 `player:moved` 事件(阈值过滤交给 `PlayerModule` 编排)。
 *
 * 关键不变量(plan §6 / §7 验收点):
 *  - 死亡时 `vel = 0`(防止死后继续移动);事件 `player:died` 由装配层发。
 *  - 死亡时 `actor.visible = false` —— 玩家整条隐藏。
 *  - `pos` / `hp` 写入由本 actor **独占**(权威原则),其他模块读
 *    `PlayerPort.pos() / hp()` 拿快照,**不**直接读 actor 字段。
 *
 * 设计原则:
 *  - **不**依赖 `RuntimePort`(不调 spawn / despawn);actor 的"挂到场景"
 *    由根容器走 `RuntimePort.spawnActor` 完成(用 `spec.kind = PlayerActor`)。
 *  - `pos` 是双重权威:`actor.pos`(Excalibur 渲染用) + 我们内部的 `pos`
 *    字段(给 Mover 用,避免每帧从 `actor.pos.x` 读出来的克隆成本)。
 *    写时只写内部字段,渲染读 `actor.pos` —— 走"内部字段 → 同步到
 *    `actor.pos`"单方向流。
 */
import { Actor, CollisionType, vec, Vector, Color, Rectangle } from "excalibur";

import type { Vec2 } from "../../../runtime/types";
import { PlayerMover, DEFAULT_PLAYER_SPEED } from "./PlayerMover";
import type { PlayerMoverDeps } from "./PlayerMover";
import { HealthController, DEFAULT_PLAYER_MAX_HP } from "./HealthController";
import type { HealthControllerDeps } from "./HealthController";
import { FacingTracker } from "./FacingTracker";
import type { FacingTrackerDeps } from "./FacingTracker";

/** `PlayerActor` 构造配置(由 `PlayerModule` 装配时传入)。 */
export interface PlayerActorConfig {
  /** 障碍查询(`MapObstaclePort`)。 */
  obstacles: PlayerMoverDeps["obstacles"];
  /** 输入查询(`InputPort`)— 给 FacingTracker。 */
  input: FacingTrackerDeps["input"];
  /** 当前逻辑时间(毫秒) — 给 HealthController 的 `onDeath` 用。 */
  now: () => number;
  /**
   * 受伤回调 — `PlayerModule` 在此发 `player:damaged` 事件。
   * `from` 已经过 HealthController 包成 `{ kind: "contact", enemyId }` 形式
   * (接触伤害路径)或原始 caller 传入。
   */
  onDamage: HealthControllerDeps["onDamage"];
  /** 死亡回调 — `PlayerModule` 在此发 `player:died` 事件。 */
  onDeath: HealthControllerDeps["onDeath"];
  /**
   * 移动判定回调 — 每帧 `onPreUpdate` 末尾调一次,
   * `PlayerModule` 在此做阈值过滤 + emit `player:moved`。
   * 参数:当前权威 `pos` 与当前 `facing`。
   */
  onMovedCheck: (pos: Vec2, facing: Vec2) => void;
  /** buff 注册回调 — 透传给 HealthController。 */
  onBuffAdded?: HealthControllerDeps["onBuffAdded"];
  /**
   * 接触敌人进入回调 — `PlayerModule` / 测试可以在此驱动 `beginContact` 路径。
   * 默认不挂;真正接入 Enemy 模块时由 `PlayerModule.onAttach` 把 actor 的
   * `collisionstart` 事件绑到这里。
   */
  onContactStart?: (otherId: number, damage: number) => void;
  /** 接触敌人离开回调(对称)。 */
  onContactEnd?: (otherId: number) => void;
}

/** 默认玩家碰撞盒半宽(像素);Excalibur `BodyComponent` 的半径。 */
const DEFAULT_HALF_WIDTH = 8;
/** 默认玩家初始位置。装配层可通过 `setPos` 在 spawn 后覆盖。 */
const DEFAULT_INITIAL_POS: Vec2 = { x: 0, y: 0 };

/**
 * 玩家 Actor —— Excalibur `Actor` 的具体子类。
 *
 * **不**调 Excalibur `addComponent`;三个子模块直接挂在 `this` 上,
 * 这样 `onPreUpdate` 可以顺序 tick 它们,不需要走 Excalibur Component
 * 的依赖注入。Excalibur Actor 的 `Body` / `Collider` 走默认 + 我们的
 * `CollisionType.Fixed` 关掉自动物理(我们手算位移)。
 */
export class PlayerActor extends Actor {
  /** 内部权威位姿(每帧与 `actor.pos` 同步)。 */
  private _pos: Vec2 = { ...DEFAULT_INITIAL_POS };

  /** Mover(速度积分 + 撞墙)。 */
  readonly mover: PlayerMover;
  /** Health(HP + 无敌帧 + 接触节流)。 */
  readonly health: HealthController;
  /** Facing(面向角)。 */
  readonly facing: FacingTracker;

  /** 装配层下发的回调(死亡 / 受伤 / buff 等)。 */
  private readonly cfg: PlayerActorConfig;

  constructor(config: PlayerActorConfig) {
    // 居中锚点 + 小碰撞盒;Excalibur 用 anchor 决定 pos 指向的是角还是中心。
    super({
      pos: vec(DEFAULT_INITIAL_POS.x, DEFAULT_INITIAL_POS.y),
      width: DEFAULT_HALF_WIDTH * 2,
      height: DEFAULT_HALF_WIDTH * 2,
      // 走 Fixed:Excalibur 不动我们,我们手算 pos;但仍会发 collisionstart/end。
      collisionType: CollisionType.Fixed,
    });
    this.cfg = config;

    this.mover = new PlayerMover({
      obstacles: config.obstacles,
      applyPosition: (p) => this.setPos(p),
      getPosition: () => this.getPos(),
    });
    this.health = new HealthController({
      now: config.now,
      onDamage: config.onDamage,
      onDeath: config.onDeath,
      onBuffAdded: config.onBuffAdded,
    });
    this.facing = new FacingTracker({ input: config.input });

    // 临时占位视觉(M0:基础矩形)。第一版没 sprite / 动画,画一个绿底小方块;
    // 后续接入 sprite 时换成 SpriteGraphic。
    const visual = new Rectangle({
      width: DEFAULT_HALF_WIDTH * 2,
      height: DEFAULT_HALF_WIDTH * 2,
      color: Color.fromHex("#7bd389"),
    });
    this.graphics.add(visual);
    this.graphics.use(visual);
  }

  // ---- 权威位姿读 / 写 ----

  /** 当前世界坐标(只读快照)。 */
  getPos(): Vec2 {
    return { x: this._pos.x, y: this._pos.y };
  }

  /**
   * 设置位置(初始化 / 传送门后用)。同步到 `actor.pos` 让渲染器认。
   * **不**做撞墙检查 —— 调用方负责合法位置。
   */
  setPos(p: Vec2): void {
    this._pos = { x: p.x, y: p.y };
    this.pos = new Vector(p.x, p.y);
  }

  /**
   * 当前速度(Mover 的实时 vel;死亡时由 `onDeath` 回调触发 `mover.stop()`)。
   */
  getVel(): Vec2 {
    return this.mover.currentVel();
  }

  // ---- 帧驱动 ----

  override onPreUpdate(engine: unknown, dt: number): void {
    // 注:Excalibur 0.32 `onPreUpdate` 签名是 `(engine, elapsedMs)`。
    //
    // 装配层(`PlayerModule`)在根容器装配时通过 `runtime.onTick(...)` 主动调一次
    // `onPreUpdate(null, dt)`,用来兼容"没有 Excalibur 引擎"的单测场景。
    // 真引擎路径下 Excalibur 也会自动调一次 `onPreUpdate(this.engine, dt)`。
    // 这里区分两个来源:
    //  - `engine === null` → 装配层手动驱动,**保留**(Mover / Health / Facing tick)。
    //  - `engine !== null` → Excalibur 自动驱动,**跳过**(避免和装配层重复 tick)。
    if (engine !== null && engine !== undefined) {
      return;
    }

    if (this.health.isDead()) {
      // 死亡冻结:不再 tick Mover,不再发 player:moved。
      // vel 已经被 `onDeath` 钩子链 `mover.stop()` 清零。
      return;
    }

    this.mover.step(dt);
    this.health.tick(dt);
    this.facing.update();

    this.cfg.onMovedCheck(this._pos, this.facing.current());
  }

  // ---- 测试 / 装配旁路 ----

  /**
   * 触发"接触伤害进入"路径。`PlayerModule` 把 Excalibur `collisionstart`
   * 事件绑到这里(Enemy 模块落地后,EnemyPort 暴露的 `applyContactDamage`
   * 内部会调 `actor.handleContactStart(enemy.id, dmg)`)。
   *
   * 测试也可以直接调它,避开 Excalibur 物理。
   */
  handleContactStart(otherId: number, damage: number): void {
    this.health.beginContact(otherId, damage);
    this.cfg.onContactStart?.(otherId, damage);
  }

  /**
   * 触发"接触伤害离开"路径。
   */
  handleContactEnd(otherId: number): void {
    this.health.endContact(otherId);
    this.cfg.onContactEnd?.(otherId);
  }

  /**
   * 死亡触发的视觉隐藏 + 速度清零。
   * `PlayerModule` 在 `HealthController.onDeath` 钩子里调一次。
   *
   * Excalibur 没有 `actor.visible` 顶层 setter —— 显隐走 `graphics.isVisible`。
   */
  enterDeathState(): void {
    this.mover.stop();
    this.graphics.isVisible = false;
  }

  /**
   * 复活 / 重开时恢复可见 + 让 Mover 可继续工作。
   * `PlayerModule` 在 `PlayerPort.reset` 末尾调。
   */
  exitDeathState(): void {
    this.graphics.isVisible = true;
  }

  // ---- 公共只读快照(给 `PlayerPort` 用) ----

  /** HP 当前值。 */
  hpValue(): number {
    return this.health.hpValue();
  }

  /** HP 上限。 */
  maxHpValue(): number {
    return this.health.maxHpValue();
  }

  /** 是否死亡(在 `onDeath` 触发后,会一直 `true` 直至 `reset`)。 */
  isDead(): boolean {
    return this.health.isDead();
  }

  /**
   * 暴露给 `PlayerPort` 的"重置"入口 —— 复位 HP / facing / mover。
   * 位置**不**自动归零(传送门场景需要保持当前位置),由 caller 自己 `setPos`。
   */
  resetState(): void {
    this.health.reset();
    this.mover.reset();
    this.facing.reset();
    this.exitDeathState();
  }
}

/** 默认速度(像素/秒)—— re-export 给测试 + 装配层直接读。 */
export { DEFAULT_PLAYER_SPEED, DEFAULT_PLAYER_MAX_HP };
