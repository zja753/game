/**
 * Vitest 全局 setup。
 *
 * 背景:Excalibur 0.32 的 dev ESM bundle 在模块加载阶段就会引用 `window`,
 * 用 `window = {...}` 隐式全局赋值。Node 环境既没有 `window`,
 * 默认也禁用隐式全局,所以导入阶段直接抛 `ReferenceError`。
 *
 * 兜底:在测试启动前主动声明 `window / document / navigator / AudioContext`
 * 等浏览器全局占位,让 Excalibur 的 polyfill 正常执行。
 *
 * 该 setup 不模拟任何 DOM 行为 —— 纯占位,避免模块加载崩。
 */
// 写入 `globalThis` 时统一 `unknown` 一次,避免每行都重复类型断言。
const g = globalThis as Record<string, unknown>;

if (typeof g.window === "undefined") {
  g.window = {};
}
if (typeof g.document === "undefined") {
  g.document = {
    createElement: () => ({}),
    documentElement: { style: {} },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}
if (typeof g.navigator === "undefined") {
  g.navigator = { userAgent: "node" };
}
if (typeof g.HTMLElement === "undefined") {
  g.HTMLElement = class {};
}
