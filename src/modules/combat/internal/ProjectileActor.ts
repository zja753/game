/**
 * `ProjectileActor` — 投射物 Excalibur Actor(plan/modules/combat.md §5 内部子模块 2)。
 *
 * 职责:每帧沿 `dir` 方向匀速前进,超 `lifetimeMs` 自动销毁(让
 *      "穿墙后飞远"的弹不会留在场上)。`onCollisionStart` 触发时
 *      调外部注入的 `onHit` 回调,由 `ProjectileFactory` 走 `HitResolver`。
 *
 * 设计原则:
 *  - **不**持"目标敌人"的引用 —— 拿 `onCollisionStart` 回调里的
 *    `other.id` 现场问 `EnemyPort`(`HitResolver` 里),避免悬挂引用。
 *  - **不**持 `RuntimePort` —— 自己的销毁由 `ProjectileFactory` 在
 *    `acquire/release` 时通过 `RuntimePort.despawnActor` 完成。
 *  - 死亡路径有两条:
 *      1. `onCollisionStart` 触发 → 命中,`onHit` 由 `ProjectileFactory` 处理。
 *      2. `_elapsed >= lifetimeMs` → 寿命到,自毁 + 走 `onSelfDestruct`。
 *    两条路径都标记 `_destroyed` 防止重复触发。
 */
import {
  Actor,
  CollisionType,
  vec,
  type Engine,
  type Collider,
  type CollisionContact,
  type Side,
} from "excalibur";
import type { ActorId, Vec2 } from "../../../runtime/types";

/** `ProjectileActor` 构造配置。 */
export interface ProjectileActorConfig {
  /** 投射物世界坐标起点(像素)。 */
  origin: Vec2;
  /** 飞行方向(单位向量;由 `tryFire` 在调用前归一化)。 */
  dir: Vec2;
  /** 飞行速度(像素/秒)。 */
  speed: number;
  /** 存活时间(毫秒);超过就自杀。 */
  lifetimeMs: number;
  /**
   * 碰撞回调 —— 由 `ProjectileFactory` 注入,内部调 `HitResolver` +
   * 通知工厂把 Actor 池化。`otherId` 是被撞到的 Actor 的 id。
   */
  onHit: (otherId: ActorId) => void;
  /**
   * 寿命到 / 撞墙等"自我销毁"回调 —— 工厂在池回收前调用一次。
   * 工厂通过它把 Actor `release` 回池 + 调 `RuntimePort.despawnActor`。
   */
  onSelfDestruct: () => void;
}

/** 默认投射物碰撞盒半宽(像素);4 像素小弹头,土豆兄弟原版手感。 */
const DEFAULT_HALF_WIDTH = 4;

/**
 * 投射物 Actor。
 *
 * 关键不变量:
 *  - 每帧位移:`pos += dir * speed * dt / 1000`,dt 来自 Excalibur `delta`(ms)。
 *  - `collisionType = Fixed`:Excalibur 不自动推它,纯匀速直线。
 *  - 寿命到 → `onSelfDestruct()` + 标记 `_destroyed` 避免重复触发。
 *  - `onHit` 命中后立即标记 `_destroyed`,防止一颗弹打两个目标。
 */
export class ProjectileActor extends Actor {
  /** 飞行方向(单位向量)。 */
  private readonly _dir: Vec2;
  /** 飞行速度(像素/秒)。 */
  private readonly _speed: number;
  /** 存活时间(毫秒)。 */
  private readonly _lifetimeMs: number;
  /** 累计经过时间(毫秒),每帧 += dt;到 lifetimeMs 就自毁。 */
  private _elapsed = 0;
  /** 注入的命中回调。 */
  private readonly _onHit: (otherId: ActorId) => void;
  /** 注入的自毁回调。 */
  private readonly _onSelfDestruct: () => void;
  /** 防止重复自毁(寿命到 + 撞墙同时发生)。 */
  private _destroyed = false;

  constructor(config: ProjectileActorConfig) {
    super({
      pos: vec(config.origin.x, config.origin.y),
      width: DEFAULT_HALF_WIDTH * 2,
      height: DEFAULT_HALF_WIDTH * 2,
      collisionType: CollisionType.Fixed,
    });
    this._dir = { x: config.dir.x, y: config.dir.y };
    this._speed = config.speed;
    this._lifetimeMs = config.lifetimeMs;
    this._onHit = config.onHit;
    this._onSelfDestruct = config.onSelfDestruct;
  }

  /**
   * Excalibur 帧驱动钩子:匀速推进 + 寿命检查。
   *
   * 不依赖 `runtime.now()` —— 用累计 `_elapsed` 算"经过时间",
   * 真实 Engine 路径(每帧调一次 `_dt` > 0)和 mock 测试路径都跑得通。
   */
  override onPreUpdate(_engine: Engine, _dt: number): void {
    if (this._destroyed) return;
    this._elapsed += _dt;
    if (this._elapsed >= this._lifetimeMs) {
      this._markDestroyed();
      this._onSelfDestruct();
      return;
    }
    const step = (this._speed * _dt) / 1000;
    this.pos.x += this._dir.x * step;
    this.pos.y += this._dir.y * step;
  }

  /**
   * Excalibur 碰撞回调(对方进入我方碰撞盒时触发)。
   *
   * `onHit` 内部会调 `HitResolver` 算伤害,然后工厂走池回收;
   * 这里**只**负责触发 + 自毁标记,不直接写事件。
   */
  override onCollisionStart(
    _self: Collider,
    other: Collider,
    _side: Side,
    _contact: CollisionContact,
  ): void {
    if (this._destroyed) return;
    this._markDestroyed();
    // Excalibur 0.32:Collider 上**没有**id 字段;id 在 owner(Entity)上。
    const otherId = (other.owner as unknown as { id: ActorId }).id;
    this._onHit(otherId);
  }

  /**
   * 标记"已销毁" + 通知工厂走池化(由外部在合适时机调,比如撞墙)。
   *
   * 与 `onCollisionStart` / 寿命到 共用,保证 `onSelfDestruct` 只调一次。
   */
  markSelfDestruct(): void {
    if (this._destroyed) return;
    this._markDestroyed();
    this._onSelfDestruct();
  }

  private _markDestroyed(): void {
    this._destroyed = true;
  }

  /** 给 mock 测试用:检查是否已自毁。 */
  isDestroyed(): boolean {
    return this._destroyed;
  }
}
