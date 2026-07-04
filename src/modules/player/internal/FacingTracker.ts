/**
 * `FacingTracker` — 玩家面向角维护(plan/modules/player.md §5)。
 *
 * 职责:
 *  1. 维护 `facing`(单位向量,玩家当前面朝方向)。
 *  2. 默认策略:鼠标方向(`InputPort.axisAim`)—— 玩家面朝鼠标。
 *  3. 提供 `facingAngle()`(弧度)给 `PlayerActor` 用于发 `player:moved`。
 *  4. **不**持有速度 / 位置,只读外部的当前位姿 + 鼠标。
 *
 * 关键不变量(plan §5):
 *  - 默认走鼠标;后续可加 `fromVel()` 策略(玩家在无鼠标设备上按 WASD
 *    时,自动面朝移动方向)。本版只实现"鼠标策略"以减少状态机。
 *  - "鼠标在玩家正中心"(`axisAim` 返回零向量)时,`facing` 保持上一帧,
 *    不强制归零。
 *
 * 设计原则:
 *  - 纯数据,无 EventBus 依赖,单测完全脱离引擎。
 */
import type { Vec2 } from "../../../runtime/types";
import type { InputPort } from "../../../runtime/ports/InputPort";

/** `FacingTracker` 的最小外部接口(给 `PlayerActor` 装配用)。 */
export interface FacingTrackerDeps {
  /** 读鼠标方向(归一化的"玩家→鼠标"方向)。 */
  input: InputPort;
}

/** "零向量"判定容差。 */
const VEC_EPS = 1e-6;

export class FacingTracker {
  /** 当前面向(单位向量,或零向量表示"尚未初始化")。 */
  private facing: Vec2 = { x: 0, y: 0 };

  private readonly deps: FacingTrackerDeps;

  constructor(deps: FacingTrackerDeps) {
    this.deps = deps;
  }

  /**
   * 每帧调一次(`PlayerActor.onPreUpdate`)。
   * 读 `InputPort.axisAim(mousePos)` 得方向;零向量时保持上一帧。
   */
  update(): void {
    const aim = this.deps.input.axisAim(this.deps.input.mousePos());
    if (Math.abs(aim.x) < VEC_EPS && Math.abs(aim.y) < VEC_EPS) {
      return;
    }
    this.facing = { x: aim.x, y: aim.y };
  }

  /**
   * 当前面向角(弧度)。`{x:1,y:0}` → 0;`{x:0,y:1}` → +π/2。
   * 用 `Math.atan2(y, x)`;`facing` 尚未初始化时返回 0。
   */
  facingAngle(): number {
    if (Math.abs(this.facing.x) < VEC_EPS && Math.abs(this.facing.y) < VEC_EPS) {
      return 0;
    }
    return Math.atan2(this.facing.y, this.facing.x);
  }

  /** 当前面向单位向量(只读)。零向量 = 未初始化。 */
  current(): Vec2 {
    return { x: this.facing.x, y: this.facing.y };
  }

  /**
   * 重置(`PlayerPort.reset`):facing 归零,下一帧 `update` 会重新算。
   * 不强制保留"刚 reset 完时玩家面朝何方"——切关通常会切到 spawn 点,
   * 那时鼠标位置尚未刷新,面朝哪无所谓。
   */
  reset(): void {
    this.facing = { x: 0, y: 0 };
  }
}
