/**
 * `createMockCamera` — Camera 模块的 Mock 工厂。
 *
 * 关键不变量:
 *  - 暴露完整 `CameraPort`(下游模块 Combat / Enemy / HudUi 可以拿这个 mock
 *    当作真 Camera 用,做"接口形状"的单测)。
 *  - **不**起 Excalibur Engine,**不**真订阅 onTick(纯 TS);
 *    业务模块测试可显式调 `setPos` / `setViewportSize` / `setIsOnScreenOverride`
 *    驱动下游断言。
 *  - 内部用 `createCameraController()`(真实子模块)算 `isOnScreen` 默认值,
 *    保证 mock 与真实模块在"摄像机几何"上行为一致(camera.md §5 关键不变量:
 *    `isOnScreen` 必须复用 `computeCameraPos` 的 clamp 几何)。
 *  - `setIsOnScreenOverride(fn)` 允许测试短路掉默认几何,只用于"这个 mock
 *    想模拟某种坏掉的几何"的极端场景(roadmap §0.2:不预设覆盖,但留逃生口)。
 *
 * 关于 `start` / `__dispose`:
 *  - `CameraPort` 本身**不**含这两个方法(它们在 `CameraModule` 装配层里加),
 *    所以 mock 也不暴露。Camera 模块自己的单测用 `createCameraModule` + 真
 *    依赖(mockRuntime / mockObstacle / mockPlayer)驱动,不走本 mock。
 */
import type { Vec2 } from "../../../runtime/types";
import type { CameraPort } from "../../../runtime/ports/CameraPort";

import { createCameraController } from "../internal/CameraController";

/** Mock 工厂的可调参数。 */
export interface MockCameraOptions {
  /** 初始 `pos`;默认 `{x: 0, y: 0}`。 */
  pos?: Vec2;
  /** 初始 viewport 尺寸;默认 `{width: 800, height: 600}`。 */
  viewportWidth?: number;
  viewportHeight?: number;
}

/** Mock 工厂返回的扩展 Port,带 spy / 驱动函数。 */
export interface MockCameraHandle extends CameraPort {
  /** spy:被调过的 `pos` / `viewportSize` / `isOnScreen` 次数(分别记)。 */
  readonly posCallCount: number;
  readonly viewportSizeCallCount: number;
  readonly isOnScreenCallCount: number;

  /** 测试驱动:覆盖当前 `pos`(下次 `pos()` 读出来就是这个值)。 */
  setPos(p: Vec2): void;
  /** 测试驱动:覆盖 viewport 尺寸。 */
  setViewportSize(width: number, height: number): void;
  /** 测试驱动:覆盖 `isOnScreen` 的实现(短路掉默认几何)。 */
  setIsOnScreenOverride(fn: (worldPos: Vec2) => boolean): void;
  /** 测试驱动:重置所有 spy 计数 + 回到默认几何。 */
  reset(): void;
}

/** 默认 viewport(与 `MockRuntime.viewportSize` 默认对齐,见 `__mocks__/mockRuntime.ts`)。 */
const DEFAULT_VIEWPORT_WIDTH = 800;
const DEFAULT_VIEWPORT_HEIGHT = 600;

/** 默认 mapBounds(与 `MapCatalog.LEVEL_1.bounds` 对齐,见 obstacle/internal/MapCatalog.ts)。 */
const DEFAULT_MAP_BOUNDS = { min: { x: 0, y: 0 }, max: { x: 2000, y: 1500 } };

/**
 * 创建 Mock Camera Port。
 */
export function createMockCamera(opts: MockCameraOptions = {}): MockCameraHandle {
  // 用真实 CameraController 算 isOnScreen 默认值,保证与真模块几何一致。
  const controller = createCameraController();
  let pos: Vec2 = opts.pos ?? { x: 0, y: 0 };
  let viewport: Vec2 = {
    x: opts.viewportWidth ?? DEFAULT_VIEWPORT_WIDTH,
    y: opts.viewportHeight ?? DEFAULT_VIEWPORT_HEIGHT,
  };
  let isOnScreenOverride: ((worldPos: Vec2) => boolean) | null = null;
  let posCallCount = 0;
  let viewportSizeCallCount = 0;
  let isOnScreenCallCount = 0;

  const port: CameraPort = {
    pos() {
      posCallCount++;
      return { ...pos };
    },
    viewportSize() {
      viewportSizeCallCount++;
      return { ...viewport };
    },
    isOnScreen(worldPos: Vec2) {
      isOnScreenCallCount++;
      if (isOnScreenOverride) return isOnScreenOverride(worldPos);
      // 走真实 controller 几何,默认 mapBounds = 2000x1500(与 MapCatalog.LEVEL_1 对齐)。
      return controller.isOnScreen(worldPos, DEFAULT_MAP_BOUNDS, viewport);
    },
  };

  const handle: MockCameraHandle = {
    ...port,
    get posCallCount() {
      return posCallCount;
    },
    get viewportSizeCallCount() {
      return viewportSizeCallCount;
    },
    get isOnScreenCallCount() {
      return isOnScreenCallCount;
    },
    setPos(p: Vec2) {
      pos = { ...p };
    },
    setViewportSize(width: number, height: number) {
      viewport = { x: width, y: height };
    },
    setIsOnScreenOverride(fn: (worldPos: Vec2) => boolean) {
      isOnScreenOverride = fn;
    },
    reset() {
      pos = opts.pos ?? { x: 0, y: 0 };
      viewport = {
        x: opts.viewportWidth ?? DEFAULT_VIEWPORT_WIDTH,
        y: opts.viewportHeight ?? DEFAULT_VIEWPORT_HEIGHT,
      };
      isOnScreenOverride = null;
      posCallCount = 0;
      viewportSizeCallCount = 0;
      isOnScreenCallCount = 0;
    },
  };

  return handle;
}
