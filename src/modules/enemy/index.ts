/**
 * Enemy 模块对外入口。
 *
 * 其他模块**只能**从这里 import 类型(`EnemyPort` 等)与工厂。
 * 内部子模块(`./internal/*`)是私有的,禁止跨模块 import。
 */
export type { EnemyPort, EnemySnapshot, DamageResult } from "../../runtime/ports/EnemyPort";
export type { EnemyKind } from "../../runtime/types";
export type { EnemyModuleDeps, EnemyPortFactory } from "./EnemyModule";
export { createEnemyModule, ENEMY_COLLISION_LAYER, ENEMY_CONTACT_LAYER } from "./EnemyModule";

// Mocks:供 Enemy 自己的单测 / 其他模块的早期接入使用。
// 第一版没"独立 mockPlayer / mockProgression"——这两个模块都有自己的 mock,
// 单测里 import 即可。
export { createMockEnemy } from "./__mocks__/mockEnemy";
export type { MockEnemyHandle, MockEnemyOptions } from "./__mocks__/mockEnemy";
export { createMockPlayer } from "./__mocks__/mockPlayer";
export type { MockPlayerHandle, MockPlayerOptions } from "./__mocks__/mockPlayer";
export { createMockProgression } from "./__mocks__/mockProgression";
export type { MockProgressionHandle, MockProgressionOptions } from "./__mocks__/mockProgression";
