/**
 * `InputPort` — Input 模块对外暴露的能力(见 plan/modules/input.md §2)。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 其他模块**只**通过这个 interface 调用 Input 的能力。
 *  - 任何 `import { ... } from "@/modules/input/internal/..."` 都是破坏约束。
 *  - Input 模块自身也**不**直接被 import,根容器在装配时把它作为
 *    `InputPort` 注入到 Player / Progression 等模块。
 */
import type { InputKey, Vec2 } from "../types";

/**
 * 输入意图的实时查询接口。
 *
 * 形态说明:
 *  - `isDown`  — 边沿不敏感,只反映"此刻物理键是否按下"(per-frame 调用即可)。
 *  - `axisMove` — 移动轴,每帧调用一次,返回当前 WASD 归一化后的单位向量
 *                 (复合按压归一化保证模长 1;无任何按压时为 `{x:0, y:0}`)。
 *  - `axisAim` — 瞄准轴,返回从"玩家屏幕位置"指向 `screenPos` 的归一化方向
 *                 (世界坐标语义;Camera 后续接管后会保持兼容)。
 *  - `enable`  — 挂上 DOM 监听(默认就是 enable 状态;`disable` 后重新 `enable`
 *                 不会重置内部按键表——见 plan §6 验收点)。
 *  - `disable` — 摘掉 DOM 监听(暂停时);按键表保持,以便恢复时状态正确。
 */
export interface InputPort {
  /**
   * 某语义键当前是否按下。
   * @returns `true` 当该键的物理键位**当前正被按下**;`false` 否则。
   */
  isDown(key: InputKey): boolean;

  /**
   * 移动轴(WASD 归一化)。
   * @returns 水平/垂直分量,复合按压时模长 = 1,无按压时为 `{x:0, y:0}`。
   *          上 / 左为负,下 / 右为正。
   */
  axisMove(): Vec2;

  /**
   * 瞄准方向(屏幕坐标 → 世界方向)。
   *
   * 当前实现:从"视口中心"(即玩家被摄像机钉住的位置)指向 `screenPos` 的
   * 归一化方向。`screenPos` 与玩家重合时返回 `{x:0, y:0}`。
   *
   * 后续 Camera 接管后:签名不变,内部会读取 `playerScreenPos` 替换视口中心。
   *
   * @param screenPos 鼠标在画布(屏幕)坐标系下的像素位置。
   * @returns 指向 `screenPos` 的单位向量(玩家指向鼠标);重合时为 `{x:0, y:0}`。
   */
  axisAim(screenPos: Vec2): Vec2;

  /**
   * 当前鼠标位置(画布坐标系,像素)。
   *
   * 提供这个 getter 是为了配合 `axisAim(screenPos)` 的调用形式——
   * 调用方写 `input.axisAim(input.mousePos())` 即可用上最近一次
   * `mousemove` 的位置(避免 Player 模块再单独拿 MouseMap 引用)。
   */
  mousePos(): Vec2;

  /**
   * 开启 DOM 监听,开始从键盘 / 鼠标接收事件。
   * 默认就是 enable 状态;`disable` 之后再 `enable` **不会**重置按键表。
   */
  enable(): void;

  /**
   * 暂停 / 隐藏场景时调:摘掉 DOM 监听,不再响应输入。
   *
   * 按键表**不**清空(plan §6 验收点),这样恢复时如果玩家"按着 W 暂停"——
   * 恢复后玩家仍被认为在按 W,行为正确。
   */
  disable(): void;
}
