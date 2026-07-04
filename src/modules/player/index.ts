/**
 * Player 模块对外入口。
 *
 * 其他模块**只能**从这里 import 类型(`PlayerPort` 等)与工厂。
 * 内部子模块(`./internal/*`)是私有的,禁止跨模块 import。
 */
export type { PlayerPort, BuffSpec, DamageSource } from "../../runtime/ports/PlayerPort";
export type { PlayerModuleDeps, PlayerPortFactory } from "./PlayerModule";
export { createPlayerModule, PLAYER_COLLISION_LAYER, PLAYER_CONTACT_LAYER } from "./PlayerModule";

// Mocks:供 Player 自己的单测使用,stub MapObstaclePort / CombatPort 即可。
// MapObstacle / Combat 模块上线后,这边的 `mockMapObstacle` / `mockCombat`
// 留作"早期接入的轻量 stub"(只覆盖 Player 测试需要的最小子集,避免
// 引入 Enemy / Runtime / 等模块的依赖);Combat 模块的正式 mock 在
// `src/modules/combat/__mocks__/`。
export { createMockMapObstacle } from "./__mocks__/mockMapObstacle";
export type { MockMapObstacleHandle, MockMapObstacleOptions } from "./__mocks__/mockMapObstacle";
export { createMockCombat } from "./__mocks__/mockCombat";
export type { MockCombatHandle } from "./__mocks__/mockCombat";
