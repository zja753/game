/**
 * Camera 模块对外入口。
 *
 * 其他模块**只能**从这里 import 类型(`CameraPort` 等)与工厂。
 * 内部子模块(`./internal/*`)是私有的,禁止跨模块 import。
 */
export type { CameraPort } from "../../runtime/ports/CameraPort";
export type { CameraModuleDeps, CameraPortFactory } from "./CameraModule";
export { createCameraModule } from "./CameraModule";

// Mocks:供 Camera 自己的单测 / 其它模块的早期接入使用。
// Camera 自己的单测需要 stub `RuntimePort` / `MapObstaclePort` / `PlayerPort`,
// 走 `createMockRuntime` / `createMockObstacle` / 其它模块的 mockPlayer(敌人模块
// 自带 `createMockPlayer`)即可 —— 本工厂是 Camera 模块视角的"我方 mock",
// 集中绑一份合法 deps 便于 Camera 自身的端到端单测。
export { createMockCamera } from "./__mocks__/mockCamera";
export type { MockCameraHandle, MockCameraOptions } from "./__mocks__/mockCamera";
