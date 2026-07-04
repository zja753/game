/**
 * Player 模块对外入口。
 *
 * 其他模块**只能**从这里 import 类型(`PlayerPort` 等)与工厂。
 * 内部子模块(`./internal/*`)是私有的,禁止跨模块 import。
 */
export type { PlayerPort, BuffSpec, DamageSource } from "../../runtime/ports/PlayerPort";
export type { PlayerModuleDeps, PlayerPortFactory } from "./PlayerModule";
export { createPlayerModule, PLAYER_COLLISION_LAYER, PLAYER_CONTACT_LAYER } from "./PlayerModule";

// Mocks:供 Player 自己的单测 + 后续模块(Combat / Enemy / Camera)单测使用,
// stub MapObstaclePort / CombatPort 即可。模块上线后,MapObstacle / Combat
// 的 `__mocks__/` 会成为正式版本;当前这两个 stub 留作早期接入。
export { createMockMapObstacle } from "./__mocks__/mockMapObstacle";
export type { MockMapObstacleHandle, MockMapObstacleOptions } from "./__mocks__/mockMapObstacle";
export { createMockCombat } from "./__mocks__/mockCombat";
export type { MockCombatHandle } from "./__mocks__/mockCombat";
