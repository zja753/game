/**
 * `CameraController` — 摄像机核心数学(plan/modules/camera.md §5 子模块 1)。
 *
 * 职责:
 *  - 提供**纯函数** `computeCameraPos(playerPos, mapBounds, viewport) → cameraPos`,
 *    不持有任何 Excalibur / Actor / EventBus 引用,**完全可单测**。
 *  - 提供 `isOnScreen(worldPos, mapBounds, viewport)`,复用与 `computeCameraPos`
 *    同一份 clamp 几何(camera.md §2 关键不变量)—— 让"屏幕外裁剪"和"摄像机
 *    跟随"使用同一份几何,避免 Combat / Enemy 自己再算"摄像机可见矩形"导致
 *    内部不一致。
 *
 * 核心不变量(锁死实现,见 plan §5 不可改):
 *
 *   §A:摄像机每帧 = clamp(玩家位置, 半视口, 地图边界 - 半视口)
 *
 * 即 `cameraPos ∈ [viewport/2, mapBounds.max - viewport/2]`,`max >= min` 兜底
 * `viewport > mapBounds` 退化情况。纯几何公式,与 Excalibur / Actor / EventBus
 * 都无关。
 *
 * 退化情况(camera.md §7 验收点 + §5 不变量):
 *  - `viewport > mapBounds`:clamp 退化为地图中心(`max = min = half`);`isOnScreen`
 *    退化为"worldPos 几乎不通过"(摄像机锁在中心,绝大多数 worldPos 不在中心)。
 *  - `playerPos` 在 clamp 区间外:被钳到边界,玩家相对摄像机产生偏移。
 *  - `viewport.width/height <= 0`:返回 `{0, 0}` 兜底(防御性,正常流不会发生)。
 */
import type { Rect, Vec2 } from "../../../runtime/types";

/** `CameraController` 工厂返回的接口。 */
export interface CameraController {
  /**
   * 锁死公式:`clamp(playerPos, halfViewport, mapBounds.max - halfViewport)`,
   * `max >= min` 兜底(见文件头)。
   */
  computeCameraPos(playerPos: Vec2, mapBounds: Rect, viewport: Vec2): Vec2;
  /**
   * "worldPos 落在摄像机可见矩形内" —— 等价于 `worldPos ∈ [clampRange]`,
   * `clampRange = [halfViewport, mapBounds.max - halfViewport]`(取 max(half, ...)
   * 兜底退化)。与 `computeCameraPos` 共用同一份 clamp 几何。
   */
  isOnScreen(worldPos: Vec2, mapBounds: Rect, viewport: Vec2): boolean;
}

/**
 * 把 `viewport` 取半,内部工具。空 viewport 兜底为 `{0, 0}`。
 */
function halfViewport(viewport: Vec2): Vec2 {
  if (viewport.x <= 0 || viewport.y <= 0) return { x: 0, y: 0 };
  return { x: viewport.x / 2, y: viewport.y / 2 };
}

/**
 * 创建 `CameraController` 实例(无状态,工厂签名仅与其它子模块风格一致)。
 */
export function createCameraController(): CameraController {
  return {
    computeCameraPos(playerPos, mapBounds, viewport) {
      const half = halfViewport(viewport);
      const minX = half.x;
      const minY = half.y;
      // `max >= min` 兜底:当 viewport > mapBounds 时,mapBounds.max - half < half,
      // 取 `Math.max(half, ...)` 强制 max = half,clamp 区间退化为单点(地图中心)。
      const maxX = Math.max(half.x, mapBounds.max.x - half.x);
      const maxY = Math.max(half.y, mapBounds.max.y - half.y);
      return {
        x: Math.min(Math.max(playerPos.x, minX), maxX),
        y: Math.min(Math.max(playerPos.y, minY), maxY),
      };
    },
    isOnScreen(worldPos, mapBounds, viewport) {
      const half = halfViewport(viewport);
      const minX = half.x;
      const minY = half.y;
      const maxX = Math.max(half.x, mapBounds.max.x - half.x);
      const maxY = Math.max(half.y, mapBounds.max.y - half.y);
      return worldPos.x >= minX && worldPos.x <= maxX && worldPos.y >= minY && worldPos.y <= maxY;
    },
  };
}
