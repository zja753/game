/**
 * MapObstacle 模块对外入口。
 *
 * 其他模块**只能**从这里 import 类型(`MapObstaclePort` / `MapData` 等)与工厂。
 * 内部子模块(`./internal/*`)是私有的,禁止跨模块 import。
 */
export type { MapObstaclePort, MapData } from "../../runtime/ports/MapObstaclePort";
export type { ObstacleModuleDeps, ObstaclePortFactory } from "./ObstacleModule";
export { createObstacleModule } from "./ObstacleModule";

// Mocks:供 MapObstacle 自己的单测 / 其它模块的早期接入使用。
// Player 模块有自己的 `createMockMapObstacle`(早期接入的过渡 mock),
// 本工厂是 MapObstacle 模块的**正式** mock,服务于:
//  - ObstacleModule 自身的单测(验证 catalog → grid → raycast 链路);
//  - 其它模块(Camera / Progression)上线后,迁移到用本工厂替换 Player
//    自带的过渡 mock,统一 mock 来源。
//
// 注意:本 mock 依然放在本模块目录下,而不是 `runtime/` —— mock 是"我方的
// 内部测试工具",不是协议层的一部分(对照 enemy/__mocks__/mockEnemy.ts
// 放在 enemy 模块下的同源约定)。
export { createMockObstacle } from "./__mocks__/mockObstacle";
export type { MockObstacleHandle, MockObstacleOptions } from "./__mocks__/mockObstacle";
