/**
 * HudUi 模块对外入口。
 *
 * 其他模块**只能**从这里 import 类型(`HudUiPort`)与工厂。
 * 内部子模块(`./internal/*`)是私有的,禁止跨模块 import。
 */
export type { HudUiPort } from "../../runtime/ports/HudUiPort";
export type { HudUiModuleDeps, HudUiPortFactory } from "./HudUiModule";
export { createHudUiModule } from "./HudUiModule";

// Mock:供 HudUi 自己的单测 / 其它模块的早期接入使用。
//
// `HudUi` 的 mock 比其他模块更"无脑" —— 因为它**只**消费 EventBus + render React,
// 所以 mock 直接复用真实工厂 + 自带 fake bus / fake container 就够用,无需单独的
// stub Port。仍提供本工厂是为了:
//  - HudUi 自己需要 fake bus 配合(避免 setup EventBus hand-roll);
//  - 后续如需"在 React tree 替换为 mock 组件"占位测试,可在本文件继续扩。
export { createMockHud } from "./__mocks__/mockHud";
export type { MockHudHandle, MockHudOptions } from "./__mocks__/mockHud";
