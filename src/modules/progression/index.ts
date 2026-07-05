/**
 * Progression 模块对外入口。
 *
 * 其他模块**只能**从这里 import 类型(`ProgressionPort` 等)与工厂。
 * 内部子模块(`./internal/*`)是私有的,禁止跨模块 import。
 */
export type { ProgressionPort } from "../../runtime/ports/ProgressionPort";
export type { ProgressionModuleDeps, ProgressionPortFactory } from "./ProgressionModule";
export type { GameScene, LevelConfig } from "./ProgressionModule";
export { createProgressionModule, PORTAL_COLLISION_LAYER } from "./ProgressionModule";
