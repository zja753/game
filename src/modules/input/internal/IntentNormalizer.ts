/**
 * `IntentNormalizer` — 从原始按键表算出"意图事件 + 实时查询"(plan §5)。
 *
 * 职责:
 *  1. 读 `KeyboardMap` 当前 `isDown` 状态合成 `axisMove()` 单位向量。
 *  2. 读 `KeyboardMap.consumeEdges()` 的"本帧新按下"队列,翻译成
 *     `input:fire` / `input:pause` 事件。
 *  3. 比对当前 `axisMove` 与上一帧,**变化时**发出 `input:move` 事件
 *     (含"松开归零"这一变化;不是每帧都发,避免无效广播)。
 *  4. 不持有任何状态机的"按压 / 释放"历史,边沿信息完全由 `KeyboardMap` 提供。
 *
 * 关键不变量(plan §6 验收点):
 *  - 复合按压(W+D 等)`axisMove()` 返回的单位向量**模长 = 1**。
 *  - `input:fire` 仅在按下瞬间发 1 次,松开再按才发下一次。
 *  - "玩家松开归零"也发 `input:move` —— `lastAxis` 状态会从 `(0.7, -0.7)` → `(0, 0)`。
 *
 * 帧驱动:`InputModule` 在 `RuntimePort.onTick` 回调里调一次 `flush()`。
 * 单测里直接 `flush()` 然后断言总线收到的事件序列。
 */
import type { InputKey, Vec2 } from "../../../runtime/types";
import type { GameEventBus } from "../../../runtime/EventBus";

/** `KeyboardMap` / `MouseMap` 的最小接口(IntentNormalizer 只需要这两个查询)。 */
export interface IntentNormalizerDeps {
  bus: GameEventBus;
  /** `isDown(key)`:语义键当前是否按下。 */
  isDown: (key: InputKey) => boolean;
  /** 弹出本帧新按下的键(每帧 `flush` 调一次,消费完即清空)。 */
  consumeEdges: () => ReadonlyArray<InputKey>;
  /** 视口大小(像素),`axisAim` 用。 */
  viewportSize: () => { width: number; height: number };
}

export class IntentNormalizer {
  /**
   * 上一帧 emit 出去的 `axisMove`(初始 = 零向量)。
   * 用于判定"是否变化"——变化才发 `input:move`。
   */
  private lastAxis: Vec2 = { x: 0, y: 0 };

  private readonly deps: IntentNormalizerDeps;

  constructor(deps: IntentNormalizerDeps) {
    this.deps = deps;
  }

  /**
   * 每帧推进一次(`InputModule` 在 `RuntimePort.onTick` 里调)。
   *
   * 顺序:
   *  1. 算 `axisMove()`,比对 `lastAxis`,变化时 emit `input:move`。
   *  2. 消费 `consumeEdges()`,对每个 fire / pause 边沿 emit 对应事件。
   */
  flush(): void {
    this.flushMove();
    this.flushEdges();
  }

  /**
   * 公开的查询接口(`InputPort.axisMove` 直接转发)。
   * 复合按压走单位向量归一化:水平 = 1 / 0 / -1,垂直 = 1 / 0 / -1,
   * 平方和开方。
   */
  axisMove(): Vec2 {
    const up = this.deps.isDown("up") ? 1 : 0;
    const down = this.deps.isDown("down") ? 1 : 0;
    const left = this.deps.isDown("left") ? 1 : 0;
    const right = this.deps.isDown("right") ? 1 : 0;
    const dx = right - left;
    // 屏幕 y 轴向下,但语义"上"对应玩家朝屏幕上方走 → y 负。
    const dy = down - up;
    return normalizeOrZero(dx, dy);
  }

  /**
   * 公开的查询接口(`InputPort.axisAim` 直接转发)。
   *
   * 当前实现:从视口中心指向 `screenPos`,归一化。
   * `screenPos` 与视口中心重合时返回零向量。
   */
  axisAim(screenPos: Vec2): Vec2 {
    const { width, height } = this.deps.viewportSize();
    const cx = width / 2;
    const cy = height / 2;
    return normalizeOrZero(screenPos.x - cx, screenPos.y - cy);
  }

  // ---- 内部 ----

  private flushMove(): void {
    const axis = this.axisMove();
    if (axis.x === this.lastAxis.x && axis.y === this.lastAxis.y) {
      return;
    }
    this.lastAxis = axis;
    this.deps.bus.emit({ type: "input:move", dx: axis.x, dy: axis.y });
  }

  private flushEdges(): void {
    const edges = this.deps.consumeEdges();
    if (edges.length === 0) return;
    for (const key of edges) {
      if (key === "fire") {
        this.deps.bus.emit({ type: "input:fire", pressed: true });
      } else if (key === "pause") {
        this.deps.bus.emit({ type: "input:pause", pressed: true });
      }
      // 移动键的边沿("刚按 W")不 emit 事件——`input:move` 已经覆盖了状态变化。
    }
  }
}

/**
 * 把 (dx, dy) 归一化;若全是 0,返回零向量。
 *
 * 复合按压(W+D 等)时 dx=1, dy=-1 → 模长 √2 → 归一化后 (0.707, -0.707)。
 * 用 1e-9 当容差(浮点累加误差),避免模长在 1 附近时出现 `0/0` → NaN。
 */
function normalizeOrZero(dx: number, dy: number): Vec2 {
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { x: 0, y: 0 };
  return { x: dx / len, y: dy / len };
}
