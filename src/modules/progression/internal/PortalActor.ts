/**
 * `PortalActor` — 传送门 Excalibur Actor(plan/modules/progression.md §6 子模块 4)。
 *
 * 职责:
 *  - 表现上传送门的视觉(本模块**不**负责画图,只占位)。
 *  - 给玩家"靠近后触发 `scene: shop` 转移"的检测位。
 *
 * 设计原则:
 *  - 简单静态 Actor(`collisionType = Fixed`,不动)。
 *  - 本 Actor **不**主动检测玩家 —— `ProgressionModule` 在 `scene === "portal"`
 *    时每帧检查"玩家 pos 距 portal pos 是否 < 阈值",距离 < 阈值时调
 *    `GameSceneController.advance()`。
 *  - 不订阅 EventBus / 不调 Port —— 保持纯 Excalibur Actor 形态。
 *  - 销毁由 `ProgressionModule` 在 `portal → shop` 转移时调
 *    `RuntimePort.despawnActor(this.id)` 完成。
 *
 * 复用性:
 *  - 测试里 `runtime.spawnedInstances` 拿到本 actor 的实例,
 *    断言 `actor.getPos()` 等于 `MapObstaclePortal.portalSpawn()`。
 *  - 真实 Excalibur 路径下 actor 由引擎驱动,本模块不参与。
 */
import { Actor, CollisionType, vec } from "excalibur";
import type { Vec2 } from "../../../runtime/types";

/** `PortalActor` 构造配置。 */
export interface PortalActorConfig {
  /** 传送门世界坐标(像素);通常来自 `MapObstaclePortal.portalSpawn()`。 */
  pos: Vec2;
}

/** 默认传送门碰撞盒半宽(像素);16 像素圆盘,玩家踩到就算进入。 */
const DEFAULT_HALF_WIDTH = 16;

/**
 * 传送门 Actor。
 *
 * 关键不变量:
 *  - `collisionType = Fixed`:Excalibur 不自动推它,只做碰撞检测。
 *  - `pos` 一旦构造就**不**变(传送门是固定点);后续玩家传送走的是
 *    `Progression` 内部状态,不是本 actor 的位置。
 *  - **不**重写 `onCollisionStart`:不主动"吃"玩家;Progression 自己
 *    在 `level:phase { scene: "portal" }` 期间用距离判定。
 */
export class PortalActor extends Actor {
  /** 创建时定的世界坐标(便于测试断言 / 复用)。 */
  private readonly _spawnPos: Vec2;

  constructor(config: PortalActorConfig) {
    super({
      pos: vec(config.pos.x, config.pos.y),
      width: DEFAULT_HALF_WIDTH * 2,
      height: DEFAULT_HALF_WIDTH * 2,
      collisionType: CollisionType.Fixed,
    });
    this._spawnPos = { x: config.pos.x, y: config.pos.y };
  }

  /**
   * 给 mock 测试 / 调用方读的"出生点"快照。
   * 与 `pos` 字段等价,但返回**新对象**防止外部写穿。
   */
  getSpawnPos(): Vec2 {
    return { x: this._spawnPos.x, y: this._spawnPos.y };
  }
}
