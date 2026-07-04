/**
 * `PlayerMover` — 玩家移动的"速度积分 + 墙碰撞"组件(plan/modules/player.md §5)。
 *
 * 职责:
 *  1. 持有 `vel`(`Vec2`,像素/秒)。
 *  2. 每帧被 `PlayerActor.onPreUpdate` 调一次 `step(dt)`,把 `vel` 积分到
 *     `pos` 上,并查 `MapObstaclePort.isBlocked` 阻止穿墙。
 *  3. 提供 `setVel(v)` 给 `InputModule` 的 `input:move` 事件回调。
 *
 * 关键不变量(plan §7 验收点 + 内部设计):
 *  - **轴分离碰撞**:水平 / 垂直分别积分,各自做一次 isBlocked 检查。
 *    撞墙时只回退被阻挡的那一轴,另一轴继续推进。这样能"贴墙滑行"
 *    而不是被墙角卡死——是土豆兄弟 / 吸血鬼幸存者类的标准做法。
 *  - `vel` 是玩家权威意图(来自 Input),不是 Excalibur 物理体的速度。
 *    `PlayerActor` 不让 Excalibur Body 自由漂移(`collisionType: Fixed`
 *    + 关闭运动),我们**手动**积分位置。这样撞墙语义完全在本模块里。
 *  - **不**持有 `pos` / `facing` / 任何渲染状态,这些归 `PlayerActor` 持有。
 *    Mover 调一个 `applyDisplacement(dx, dy)` 回调把结果写回去,保证
 *    "权威字段归 PlayerActor"这条铁律。
 *
 * 测试边界:
 *  - Mover **不**监听 EventBus,也不发事件。`input:move` 的订阅 + 事件
 *    `player:moved` 的阈值过滤由 `PlayerActor` / `PlayerModule` 处理。
 *  - `step` 同步返回,不依赖 Excalibur clock,纯靠 `dt` 参数。
 */
import type { Vec2 } from "../../../runtime/types";
import type { MapObstaclePort } from "../../../runtime/ports/MapObstaclePort";

/** `PlayerMover` 的最小外部接口(给 `PlayerActor` 装配用)。 */
export interface PlayerMoverDeps {
  /**
   * 静态障碍查询。**不**能为 null / undefined —— 即使是"全空地图",
   * 也得是 `createMockMapObstacle()` 这种 stub。
   */
  obstacles: MapObstaclePort;
  /**
   * 把积分结果写回 Player 权威位姿。`PlayerActor` 在这里写 `actor.pos`。
   * 参数:新世界坐标(已经被 Mover 撞墙调整过)。
   */
  applyPosition: (p: Vec2) => void;
  /**
   * 当前权威位置。Mover 每帧从这里读起点(避免跟 `applyPosition` 走
   * 引用同步问题);玩家死亡时 `PlayerActor` 把它置零,Mover 无感。
   */
  getPosition: () => Vec2;
}

/** 默认玩家移动速度(像素/秒)。后续可被 `addBuff({ modifiers: { speed: +n } })` 改。 */
export const DEFAULT_PLAYER_SPEED = 200;

export class PlayerMover {
  /** 当前速度向量(像素/秒),由 `setVel` 设。 */
  private vel: Vec2 = { x: 0, y: 0 };

  private readonly deps: PlayerMoverDeps;

  /** 速度上限(像素/秒),防止 buff 叠加时玩家飞出地图。 */
  private maxSpeed: number = DEFAULT_PLAYER_SPEED;

  constructor(deps: PlayerMoverDeps) {
    this.deps = deps;
  }

  /**
   * 帧驱动入口。`PlayerActor.onPreUpdate` 每帧调一次。
   *
   * @param dt 帧 delta,毫秒(Excalibur `preupdate.elapsed`)。
   */
  step(dt: number): void {
    if (dt <= 0) return;
    // 容差:当 vel 接近 0(浮点尾迹)时直接跳过,避免 isBlocked 误检。
    const EPS = 1e-4;
    if (Math.abs(this.vel.x) < EPS && Math.abs(this.vel.y) < EPS) {
      return;
    }

    const dtSec = dt / 1000;
    // X 轴:先尝试横移,撞墙就停这一轴。
    const dx = this.vel.x * dtSec;
    const start = this.deps.getPosition();
    const nx = start.x + dx;
    if (dx !== 0) {
      const probeX: Vec2 = { x: nx, y: start.y };
      if (!this.deps.obstacles.isBlocked(probeX)) {
        // Y 轴:在已经移动到 nx 的基础上,再尝试纵移。
        const dy = this.vel.y * dtSec;
        const ny = start.y + dy;
        if (dy !== 0) {
          const probeY: Vec2 = { x: nx, y: ny };
          if (!this.deps.obstacles.isBlocked(probeY)) {
            this.deps.applyPosition({ x: nx, y: ny });
            return;
          }
          // Y 撞墙:只采用 X 移动,Y 不动。
          this.deps.applyPosition({ x: nx, y: start.y });
          return;
        }
        // dy == 0:仅 X 移动通过,直接落位。
        this.deps.applyPosition({ x: nx, y: start.y });
        return;
      }
      // X 撞墙:放弃 X 移动,再单独尝试 Y。
      const dy = this.vel.y * dtSec;
      if (dy !== 0) {
        const ny = start.y + dy;
        const probeY: Vec2 = { x: start.x, y: ny };
        if (!this.deps.obstacles.isBlocked(probeY)) {
          this.deps.applyPosition({ x: start.x, y: ny });
          return;
        }
      }
      // 两轴都撞,不动。
      return;
    }

    // dx == 0 但 dy != 0:只走 Y 轴。
    const dy = this.vel.y * dtSec;
    const ny = start.y + dy;
    const probeY: Vec2 = { x: start.x, y: ny };
    if (!this.deps.obstacles.isBlocked(probeY)) {
      this.deps.applyPosition({ x: start.x, y: ny });
    }
  }

  /**
   * 设置当前速度。`InputModule` 在收到 `input:move` 时调。
   *
   * @param v 像素/秒;允许任一轴超出 ±`maxSpeed`,本方法会自动 clamp
   *          模长到 `maxSpeed`(避免斜角移动比单轴快的情况)。
   */
  setVel(v: Vec2): void {
    const len = Math.hypot(v.x, v.y);
    if (len === 0) {
      this.vel = { x: 0, y: 0 };
      return;
    }
    if (len > this.maxSpeed) {
      this.vel = { x: (v.x / len) * this.maxSpeed, y: (v.y / len) * this.maxSpeed };
      return;
    }
    this.vel = { x: v.x, y: v.y };
  }

  /**
   * 强制把速度清零。死亡 / 暂停切换时调。
   * 死后再 `step` 因为 vel = 0 会早退,不会再移动。
   */
  stop(): void {
    this.vel = { x: 0, y: 0 };
  }

  /** 当前速度(只读)。 */
  currentVel(): Vec2 {
    return { x: this.vel.x, y: this.vel.y };
  }

  /**
   * 重置状态:速度清零,速度上限恢复默认。`PlayerPort.reset()` 时调。
   */
  reset(): void {
    this.vel = { x: 0, y: 0 };
    this.maxSpeed = DEFAULT_PLAYER_SPEED;
  }

  /**
   * 调整速度上限(供 `BuffSpec.modifiers.speed` 之类的回调用)。
   * **不**保证非负——调用方传 0 等价于"玩家钉死",传负值是 bug。
   */
  setMaxSpeed(v: number): void {
    this.maxSpeed = v;
  }

  /** 速度上限(像素/秒)。 */
  maxSpeedValue(): number {
    return this.maxSpeed;
  }
}
