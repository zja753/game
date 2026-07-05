/**
 * `EnemyActor` — 敌人 Excalibur Actor 包装(plan/modules/enemy.md §5)。
 *
 * 职责:
 *  - 每帧从行为策略拿 vel,做轴分离撞墙积分(对齐 `PlayerMover` 思路)。
 *  - 撞墙时只回退被阻挡的那一轴,另一轴继续推进(贴墙滑行)。
 *  - 死亡(HP <= 0)时:vel = 0,visible = false,广播 `enemy:dying`
 *    由 `EnemyModule` 端做"dying"语义广播。
 *  - 与玩家接触时:走 `ContactDamage.onContactStart/onStay/onEnd`,
 *    由本 actor 在 `onCollisionStart/End` 触发的回调里转发。
 *
 * 关键不变量(plan §6 / §7 验收点):
 *  - `pos` / `vel` / `hp` / `kind` 由本 actor 持有;
 *    装配层(`EnemyModule`)的 EnemyPort 读 / 写通过本 actor 暴露的方法。
 *  - 死亡时 `vel = 0` + `graphics.isVisible = false`(对齐 PlayerActor)。
 *  - **不**直接 `runtime.spawnActor` / `runtime.despawnActor` —— 自己
 *    spawn / despawn 走 `EnemyModule` 在装配时注入的回调(避免 actor 反向
 *    持有 RuntimePort)。
 *
 * 设计原则:
 *  - `pos` / `_vel` 走"内部字段 → 同步到 `actor.pos`"单方向流(对齐 PlayerActor)。
 *  - `vel` 故意**不**命名(Excalibur `Actor` 已有 public `vel: Vector` getter/setter,
 *    会与本 actor 的内部字段冲突)。本类内部一律走 `_vel`。
 *  - 不依赖 Excalibur `addComponent`;行为策略以"注入闭包"形式调,
 *    跟 `PlayerMover` 一样的"裸字段 + 注入回调"风格。
 */
import { Actor, CollisionType, vec, Vector } from "excalibur";
import type { ActorId, EnemyKind, Vec2 } from "../../../runtime/types";
import type { BehaviorContext, BehaviorStrategy } from "./EnemyRegistry";
import type { ContactDamageHandle, ContactHitContext } from "./ContactDamage";
import type { MapObstaclePort } from "../../../runtime/ports/MapObstaclePort";

/** `EnemyActor` 构造配置(由 `EnemyModule` 装配时传入)。 */
export interface EnemyActorConfig {
  /** 敌人种类。 */
  kind: EnemyKind;
  /** 敌人规格(由 `EnemyRegistry` 拉来,本 actor **不**自己查 spec)。 */
  speed: number;
  /** 初始 / 最大 HP。 */
  maxHp: number;
  /** 接触伤害值(单次扣多少血)。 */
  contactDamageAmount: number;
  /** 行为策略(由 `EnemyModule` 在装配时按 `EnemySpec.behavior` 解析)。 */
  behavior: BehaviorStrategy;
  /** 障碍查询(走 `MapObstaclePort`)。 */
  obstacles: MapObstaclePort;
  /**
   * 玩家位姿查询回调(走 `PlayerPort`);返回 `null` 表示"无玩家"。
   * 由 `EnemyModule` 注入。
   */
  getPlayer: () => { id: ActorId; pos: Vec2 } | null;
  /**
   * 当前逻辑时间(毫秒)。由 `EnemyModule` 注入 `runtime.now()`。
   */
  now: () => number;
  /**
   * 扣血回调 —— 本 actor 在 `applyDamage` 时调,由 `EnemyModule` 收口
   * 走"扣血 → 判死 → 广播 `enemy:dying` → 触发 despawn"路径。
   * 回调参数:`(selfId, newHp, prevHp, isKill)`。
   */
  onDamageApplied: (selfId: ActorId, newHp: number, prevHp: number, isKill: boolean) => void;
  /**
   * "敌人该被回收"的回调 —— 本 actor 死亡时调,由 `EnemyModule` 走
   * `runtime.despawnActor` + 内部表清理。
   */
  onDeath: (selfId: ActorId) => void;
  /**
   * 接触伤害入口 —— `EnemyModule` 注入 `ContactDamage` 句柄。
   * 默认为 `null` 表示"该敌人不会主动接触伤害"(比如 spec.contactDamage=0);
   * 装配时由 `EnemyModule` 决定是否注入。
   */
  contactDamage: ContactDamageHandle | null;
  /**
   * 初始世界坐标。
   */
  initialPos: Vec2;
}

/** 默认敌人碰撞盒半宽(像素)。土豆兄弟原版小怪大约 8~10 像素半径。 */
const DEFAULT_HALF_WIDTH = 8;

/**
 * 敌人 Actor —— Excalibur `Actor` 的具体子类。
 *
 * `onPreUpdate` 走"先 tick 行为策略 → 撞墙积分 → 同步到 actor.pos"三步;
 * `onCollisionStart/End` 转发到 `ContactDamage`。
 */
export class EnemyActor extends Actor {
  /** 内部权威位姿。 */
  private _pos: Vec2;
  /** 内部权威速度(像素/秒)。 */
  private _vel: Vec2 = { x: 0, y: 0 };
  /** 当前 HP。 */
  private _hp: number;
  /** 死亡标志 —— 死亡后 `tick` 早退,actor 立刻 despawn。 */
  private _dead = false;
  /** 当前 ActorId(由 `EnemyModule` 在 spawn 之后注入;注入前 = 0)。 */
  private _id: ActorId = 0;
  /** 装配配置。 */
  private readonly cfg: EnemyActorConfig;

  constructor(config: EnemyActorConfig) {
    super({
      pos: vec(config.initialPos.x, config.initialPos.y),
      width: DEFAULT_HALF_WIDTH * 2,
      height: DEFAULT_HALF_WIDTH * 2,
      // 走 Fixed:Excalibur 不自动推我们,撞墙语义在我们内部。
      collisionType: CollisionType.Fixed,
    });
    this.cfg = config;
    this._pos = { x: config.initialPos.x, y: config.initialPos.y };
    this._hp = config.maxHp;
  }

  // ---- 装配层 API(由 EnemyModule 调用) ----

  /**
   * 由 `EnemyModule` 在 `RuntimePort.spawnActor` 拿到 id 后注入一次。
   * 真实 Excalibur 路径下 actor 自己的 `id` 在 spawn 时被引擎赋值,但我们
   * mock 路径走 `new spec.kind(spec.config)`,id 由 mockRuntime 自己管理,
   * 不一定写到 actor 上 —— 所以这里**显式**让 `EnemyModule` 注入。
   */
  setId(id: ActorId): void {
    this._id = id;
  }

  /** 当前 HP(只读)。 */
  hpValue(): number {
    return this._hp;
  }

  /** HP 上限(从 spec 读)。 */
  maxHpValue(): number {
    return this.cfg.maxHp;
  }

  /** 是否死亡。 */
  isDead(): boolean {
    return this._dead;
  }

  /** 当前世界坐标(只读快照)。 */
  getPos(): Vec2 {
    return { x: this._pos.x, y: this._pos.y };
  }

  /** 当前速度(只读快照)。 */
  getVel(): Vec2 {
    return { x: this._vel.x, y: this._vel.y };
  }

  /** 敌人种类。 */
  kind(): EnemyKind {
    return this.cfg.kind;
  }

  /**
   * 扣血 —— 由 `EnemyModule` 在 Combat `applyDamage` 路径转发过来。
   *
   * 行为:
   *  - 死亡后**不**再扣血(no-op,保持已死亡的快照)。
   *  - `amount <= 0` → no-op。
   *  - 正常扣血:newHp = max(0, hp - amount),isKill = (newHp <= 0)。
   *  - 触发 `onDamageApplied` 回调(由 `EnemyModule` 走 `applyDamage` 的
   *    返回值计算 + 广播 `enemy:dying`)。
   *  - 致死时:vel=0, visible=false, 触发 `onDeath` 回调。
   *
   * @returns `{ isKill, hp }`(对齐 `EnemyPort.applyDamage` 的 `DamageResult`)。
   */
  applyDamage(amount: number): { isKill: boolean; hp: number } {
    if (this._dead) return { isKill: false, hp: this._hp };
    if (amount <= 0) return { isKill: false, hp: this._hp };
    const prev = this._hp;
    const next = Math.max(0, this._hp - amount);
    const isKill = next <= 0;
    this._hp = next;
    this.cfg.onDamageApplied(this._id, next, prev, isKill);
    if (isKill) {
      this._markDead();
      this.cfg.onDeath(this._id);
    }
    return { isKill, hp: next };
  }

  /**
   * 接触伤害入口 —— `PlayerActor` / Excalibur 真实路径下由 `onCollisionStart`
   * 回调自动调;测试里可直接调。
   *
   * 注:本方法名故意和 `PlayerActor.handleContactStart` 对齐,让
   * 根容器装配逻辑对称。
   */
  handleContactStart(): void {
    if (this._dead) return;
    if (this.cfg.contactDamage === null) return;
    const ctx: ContactHitContext = { enemyId: this._id, damage: this.cfg.contactDamageAmount };
    this.cfg.contactDamage.onContactStart(ctx);
  }

  /** 对称:`handleContactEnd`。 */
  handleContactEnd(): void {
    if (this.cfg.contactDamage === null) return;
    this.cfg.contactDamage.onContactEnd(this._id);
  }

  // ---- Excalibur 帧驱动 ----

  override onPreUpdate(_engine: unknown, dt: number): void {
    void _engine;
    if (this._dead) return;
    if (dt <= 0) return;
    this._step(dt);
  }

  /**
   * 帧驱动核心:
   *  1. 调行为策略拿方向(单位向量)。
   *  2. 乘以 spec.speed,作为这一帧的目标速度。
   *  3. 轴分离撞墙积分。
   *  4. 同步内部 `_pos` → `actor.pos`。
   */
  private _step(dt: number): void {
    const player = this.cfg.getPlayer();
    const ctx: BehaviorContext = {
      now: this.cfg.now(),
      dt,
      self: { id: this._id, kind: this.cfg.kind, pos: this._pos, hp: this._hp },
      player,
    };
    const dir = this.cfg.behavior.tick(ctx);
    const len = Math.hypot(dir.x, dir.y);
    if (len > 0) {
      this._vel = {
        x: (dir.x / len) * this.cfg.speed,
        y: (dir.y / len) * this.cfg.speed,
      };
    } else {
      this._vel = { x: 0, y: 0 };
    }

    // 轴分离撞墙积分(对齐 PlayerMover 思路)。
    const dtSec = dt / 1000;
    const dxRaw = this._vel.x * dtSec;
    const dyRaw = this._vel.y * dtSec;

    if (dxRaw !== 0) {
      const nx = this._pos.x + dxRaw;
      const probeX: Vec2 = { x: nx, y: this._pos.y };
      if (!this.cfg.obstacles.isBlocked(probeX)) {
        this._pos = probeX;
        // X 通过,继续 Y。
        if (dyRaw !== 0) {
          const ny = this._pos.y + dyRaw;
          const probeY: Vec2 = { x: this._pos.x, y: ny };
          if (!this.cfg.obstacles.isBlocked(probeY)) {
            this._pos = probeY;
          }
        }
        this._syncToActor();
        return;
      }
      // X 撞墙:放弃 X,再试 Y。
      if (dyRaw !== 0) {
        const ny = this._pos.y + dyRaw;
        const probeY: Vec2 = { x: this._pos.x, y: ny };
        if (!this.cfg.obstacles.isBlocked(probeY)) {
          this._pos = probeY;
        }
      }
      this._syncToActor();
      return;
    }

    if (dyRaw !== 0) {
      const ny = this._pos.y + dyRaw;
      const probeY: Vec2 = { x: this._pos.x, y: ny };
      if (!this.cfg.obstacles.isBlocked(probeY)) {
        this._pos = probeY;
      }
      this._syncToActor();
    }
  }

  private _syncToActor(): void {
    this.pos = new Vector(this._pos.x, this._pos.y);
  }

  // ---- 死亡视觉 ----

  private _markDead(): void {
    this._dead = true;
    this._vel = { x: 0, y: 0 };
    // Excalibur 没有顶层 visible setter —— 走 graphics.isVisible。
    this.graphics.isVisible = false;
  }
}
