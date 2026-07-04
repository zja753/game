/**
 * `MouseMap` — 鼠标位置 / 按钮状态跟踪(plan/modules/input.md §5)。
 *
 * 职责:
 *  1. 监听 DOM `mousemove` / `mousedown` / `mouseup`,维护"当前鼠标位置"快照。
 *  2. 暴露 `position()` 给 `InputModule.axisAim` 算瞄准方向。
 *  3. **不**做归一化 / 不发事件;跟 `KeyboardMap` 一样是底层快照。
 *
 * 第一版范围(plan §2 `InputPort`):
 *  - `axisAim(screenPos: Vec2)` 需要 `screenPos` 参数 → `MouseMap` 暴露 `position()`。
 *  - 鼠标按钮(左 / 右 / 中)目前**不**进入 `InputKey` 联合,玩家开火仍走键盘
 *    `fire`。但 `MouseMap` 仍记录按钮状态(预留接口),后续若加入"鼠标点击开火"
 *    只需在 `InputKey` 加键 + `KeyboardMap` 加映射,不需要改 `MouseMap`。
 *
 * 关键不变量(plan §6 验收点):
 *  - `enable` / `disable` 切换**不**清空鼠标位置(暂停时鼠标停哪,恢复后
 *    `axisAim` 仍然用那个位置,符合"保持语义一致")。
 *  - 鼠标事件**不**走 modifier 抑制(键盘 modifier 与鼠标无关;Cmd+Click 是
 *    浏览器自己的组合键,不应该被忽略)。
 */
import type { Vec2 } from "../../../runtime/types";

/** 监听目标(可注入,单测里塞个 `EventTarget` mock 即可)。 */
export type MouseEventTarget = EventTarget;

/**
 * 鼠标按钮位掩码(用 bit 简化"哪些按钮当前按住"的查询)。
 * 第一版没人调,但保留以便后续扩展(`InputKey` 加 "fire-mouse" 时复用)。
 *
 * 用普通 `const` 对象而不是 `enum`:`tsconfig` 启用了
 * `erasableSyntaxOnly`,禁用了 enum 语法。
 */
export const MouseButton = {
  None: 0,
  Left: 1 << 0,
  Right: 1 << 1,
  Middle: 1 << 2,
} as const;
/** `MouseButton` 的位掩码类型(`0 | 1 | 2 | 4 | ...`)。 */
export type MouseButtonMask = number;

/**
 * DOM `MouseEvent.button` → `MouseButton` 位。
 *
 * `MouseEvent.button` 的值(规范):
 *  - `0` = 主键(通常左键)
 *  - `1` = 中键
 *  - `2` = 次键(通常右键)
 *  - `3` / `4` = X1 / X2 侧键(常见于游戏鼠标)
 */
function eventButtonToBit(button: number): MouseButtonMask {
  switch (button) {
    case 0:
      return MouseButton.Left;
    case 1:
      return MouseButton.Middle;
    case 2:
      return MouseButton.Right;
    case 3:
      return MouseButton.Left | MouseButton.Middle; // X1 暂归"扩展键"
    case 4:
      return MouseButton.Right | MouseButton.Middle; // X2 同上
    default:
      return MouseButton.None;
  }
}

/** 供 `InputModule` 调用的查询钩子(给 `axisAim` 用)。 */
export interface MouseMapPort {
  /** 当前鼠标位置(画布坐标系,像素)。`{x:0, y:0}` 是默认值(从未移动)。 */
  position(): Vec2;
  /** 当前按下的按钮位掩码(0 = 都没按)。 */
  buttonsDown(): number;
}

export class MouseMap implements MouseMapPort {
  private pos: Vec2 = { x: 0, y: 0 };
  private buttons = MouseButton.None;

  private readonly onMouseMove: (e: MouseEvent) => void;
  private readonly onMouseDown: (e: MouseEvent) => void;
  private readonly onMouseUp: (e: MouseEvent) => void;

  private enabled = false;

  private readonly target: MouseEventTarget;

  constructor(target: MouseEventTarget) {
    this.target = target;
    this.onMouseMove = (e: MouseEvent): void => this.handleMouseMove(e);
    this.onMouseDown = (e: MouseEvent): void => this.handleMouseDown(e);
    this.onMouseUp = (e: MouseEvent): void => this.handleMouseUp(e);
  }

  // ---- public API ----

  position(): Vec2 {
    // 返回新对象避免外部持有内部状态后被意外改写(防御性拷贝)。
    return { x: this.pos.x, y: this.pos.y };
  }

  buttonsDown(): number {
    return this.buttons;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.target.addEventListener("mousemove", this.onMouseMove as EventListener);
    this.target.addEventListener("mousedown", this.onMouseDown as EventListener);
    this.target.addEventListener("mouseup", this.onMouseUp as EventListener);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.target.removeEventListener("mousemove", this.onMouseMove as EventListener);
    this.target.removeEventListener("mousedown", this.onMouseDown as EventListener);
    this.target.removeEventListener("mouseup", this.onMouseUp as EventListener);
    // 按 plan §6 验收点:**不**清 `pos`、**不**清 `buttons`,语义保持。
  }

  /**
   * 强制清空鼠标状态(`InputModule` 在 `window.blur` 时调一次,避免
   * 焦点丢失时按钮状态卡住)。
   */
  clear(): void {
    this.pos = { x: 0, y: 0 };
    this.buttons = MouseButton.None;
  }

  // ---- 测试用旁路 ----

  handleMouseMove(ev: { clientX: number; clientY: number }): void {
    this.pos = { x: ev.clientX, y: ev.clientY };
  }

  handleMouseDown(ev: { button: number }): void {
    this.buttons |= eventButtonToBit(ev.button);
  }

  handleMouseUp(ev: { button: number }): void {
    this.buttons &= ~eventButtonToBit(ev.button);
  }
}
