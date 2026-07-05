/**
 * `CameraPort` — Camera 模块对外暴露的能力(见 plan/modules/camera.md §2)。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 其他模块**只**通过这个 interface 调用 Camera 的能力。
 *  - 任何 `import { ... } from "@/modules/camera/internal/..."` 都是破坏约束。
 *  - Camera 模块**目前未落地**(M10);本文件先按 plan §2 锁定接口形态。
 *
 * 设计原则(roadmap §3.10 + camera.md §5):
 *  - **不**暴露 `setPos` / `setFollow` —— 跟随规则是模块内部不变量,任何模块
 *    "想移动摄像机"的诉求都通过改 `PlayerPort.pos()` 实现。
 *  - **`isOnScreen(pos)` 是本模块唯一"业务相关"的方法** —— 复用与
 *    `CameraController.computeCameraPos` 相同的 clamp 几何(由 `viewportSize` +
 *    `mapBounds` 派生),Combat / Enemy 拿这一份 `boolean` 即可做屏幕外裁剪,
 *    **不**必自己再算"摄像机视口矩形"再和 Camera 内部几何不一致。
 *  - 视口尺寸**不**走 `RuntimePort.viewportSize()`(Combat / Enemy 也
 *    不走),统一在 `CameraPort.viewportSize()` 这条路上 —— 因为"屏幕外
 *    裁剪"是摄像机语义,runtime.md §2.1 明确把 `viewportSize` 的
 *    "屏幕外裁剪入口"指向 CameraPort。
 */
import type { Vec2 } from "../types";

/**
 * `CameraPort` — 摄像机模块对外的能力。
 *
 * 实现要点(camera.md §5):
 *  - `pos()` 每帧从 `engine.currentScene.camera.pos` 读取(由
 *    `CameraFollower` 写入);调用方拿到的总是世界坐标(左上角像素)。
 *  - `viewportSize()` 走 `RuntimePort.viewportSize()` 拿 Excalibur 画布尺寸;
 *    resize 时自动跟随。
 *  - `isOnScreen(worldPos)` 等价于"worldPos 落在 `clampRange` 内",其中
 *    `clampRange = [mapBounds.min + halfViewport, mapBounds.max - halfViewport]`
 *    (取 max(min, ...) 兜底 `viewportSize > mapBounds` 退化情况)。
 */
export interface CameraPort {
  /**
   * 当前摄像机世界坐标(左上角像素)。
   *
   * 读 Excalibur `engine.currentScene.camera.pos` 的快照;**不**做坐标转换。
   * HUD 拿到后做小地图 / 屏幕边缘提示时用。
   */
  pos(): Vec2;

  /**
   * 视口尺寸(像素)。resize 时自动跟随 Excalibur 画布。
   *
   * 不暴露 `width/height` 形式,统一 `Vec2` —— 内部等价于
   * `RuntimePort.viewportSize()`(camera.md §6 列出 `RuntimePort.viewportSize`
   * 作为依赖,但对外只通过本方法暴露)。
   */
  viewportSize(): Vec2;

  /**
   * 屏幕外裁剪判定 —— Combat / Enemy 在做"超视口跳过 AI / 跳过命中"时调。
   *
   * 复用与 `computeCameraPos` 同一份 clamp 几何,避免调用方再算
   * "摄像机可见矩形"和 Camera 内部几何不一致(camera.md §5 核心
   * 不变量 + §2 设计要点)。
   *
   * 退化情况:`viewportSize > mapBounds` 时 `clampRange` 退化为地图中心点,
   * 函数仍返回 `boolean`(此时绝大多数 worldPos 都不在中心点上,返回 `false`)。
   */
  isOnScreen(worldPos: Vec2): boolean;
}
