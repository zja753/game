/**
 * Input 模块对外入口。
 *
 * 其他模块**只能**从这里 import 类型(`InputPort` 等)与工厂。
 * 内部子模块(`./internal/*`)是私有的,禁止跨模块 import。
 */
export type { InputPort } from "../../runtime/ports/InputPort";
export type { InputModuleDeps, InputPortFactory } from "./InputModule";
export { createInputModule } from "./InputModule";
export { createMockInput } from "./__mocks__/mockInput";
