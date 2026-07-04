/**
 * Combat 模块对外入口。
 *
 * 其他模块**只能**从这里 import 类型(`CombatPort` 等)与工厂。
 * 内部子模块(`./internal/*`)是私有的,禁止跨模块 import。
 */
export type { CombatPort, FireResult } from "../../runtime/ports/CombatPort";
export type { CombatModuleDeps, CombatPortFactory } from "./CombatModule";
export { createCombatModule, PROJECTILE_COLLISION_LAYER } from "./CombatModule";
export { createMockEnemy } from "./__mocks__/mockEnemy";
export type { MockEnemyHandle, MockEnemyOptions } from "./__mocks__/mockEnemy";
