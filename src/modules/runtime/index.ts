/**
 * Runtime 模块对外入口。
 *
 * 其他模块**只能**从这里 import 类型(`RuntimePort` 等)与工厂。
 * 内部子模块(`./internal/*`)是私有的,禁止跨模块 import。
 */
export type { RuntimePort } from "../../runtime/ports/RuntimePort";
export type { RuntimeModuleDeps, RuntimePortFactory } from "./RuntimeModule";
export { createRuntimeModule } from "./RuntimeModule";
export { createMockRuntime } from "./__mocks__/mockRuntime";
