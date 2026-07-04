/**
 * `InputModule` — Input 模块对外的"装配层"。
 *
 * 把三个内部子模块(`KeyboardMap` / `MouseMap` / `IntentNormalizer`)
 * 组合起来,实现 `InputPort` 接口的全部方法,然后把这个 Port 实例暴露给
 * 根容器 / 其他模块使用。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 这个文件**只**能被根容器 `import`。
 *  - 其他模块**不**能 import 它,只能 import 根容器传给它们的 `InputPort`。
 *
 * 权威字段(plan/modules/input.md §4):
 *  - 当前按键状态 / 鼠标位置 → 全在本模块持有,只通过 `isDown / mousePos`
 *    暴露读,从不写到 `GameContext`。
 */
import type { InputKey, Vec2 } from "../../runtime/types";
import type { InputPort } from "../../runtime/ports/InputPort";
import type { GameEventBus } from "../../runtime/EventBus";
import type { RuntimePort } from "../runtime";

import { KeyboardMap } from "./internal/KeyboardMap";
import { MouseMap } from "./internal/MouseMap";
import { IntentNormalizer } from "./internal/IntentNormalizer";

/**
 * 监听 DOM 事件的目标类型(任何 `addEventListener` / `removeEventListener` 实现)。
 *
 * 用 `EventTarget` 而不是 `Window | HTMLElement` 是因为:
 *  - 测试里用 stub 注入,不需要 `Window` 的全部字段。
 *  - jsdom / happy-dom 等环境的 target 形态不一致(可能 `EventTarget` 实例)。
 *  - 运行时只调 `addEventListener / removeEventListener` / `dispatchEvent`,
 *    `EventTarget` 的子集就够用。
 *
 * `window` / `HTMLElement` 仍然是合法 target(它们继承 `EventTarget`)。
 */
export type InputEventTarget = EventTarget;

/** 内部用于探测全局 `window` 是否存在(Node 测试环境里可能没有)。 */
function defaultTarget(): InputEventTarget {
  // 单测 / SSR 环境下 `window` 不存在 → 抛错,提示调用方显式传 `target`。
  if (typeof window === "undefined") {
    throw new Error(
      "createInputModule: `window` is not available; pass `deps.target` in non-browser environments",
    );
  }
  return window;
}

/** `createInputModule` 接受的依赖(根容器注入)。 */
export interface InputModuleDeps {
  /** 事件总线(emit `input:*` 事件用)。 */
  bus: GameEventBus;
  /** Runtime Port(拿 `viewportSize` + 订阅 `onTick`)。 */
  runtime: RuntimePort;
  /**
   * DOM 事件目标(挂 keydown / keyup / mousemove 等)。
   * 默认 `window`,但允许 RootContainer 在测试环境里塞个 stub。
   */
  target?: InputEventTarget;
}

/** `createInputModule` 工厂签名(根容器在装配阶段调用一次)。 */
export type InputPortFactory = (deps: InputModuleDeps) => InputPort;

/**
 * 创建 Input 模块实例。
 *
 * 生命周期:
 *  1. 根容器 `createInputModule({ bus, runtime })` → 拿 `InputPort`。
 *  2. 业务模块 `new XxxModule({ input: port })` 拿到这个 Port。
 *  3. 根容器在场景进入"running"等需要输入的阶段时调 `port.enable()`;
 *     暂停 / 切场景时调 `port.disable()`(plan §6)。
 *
 * 销毁:根容器生命 = 进程生命,本模块**不**主动 dispose;若测试 / HMR
 * 路径需要,可以调返回对象上的 `__dispose` 摘监听 + 反订阅 onTick。
 */
export const createInputModule: InputPortFactory = (deps) => {
  const target: InputEventTarget = deps.target ?? defaultTarget();

  // ---- 子模块 ----
  const keyboard = new KeyboardMap(target);
  const mouse = new MouseMap(target);
  const normalizer = new IntentNormalizer({
    bus: deps.bus,
    isDown: keyboard.isDown.bind(keyboard),
    consumeEdges: keyboard.consumeEdges.bind(keyboard),
    viewportSize: () => deps.runtime.viewportSize(),
  });

  // ---- 帧驱动订阅 ----
  // Runtime 的 onTick 是一帧一次,IntentNormalizer 在这一拍里
  // 1) 比对 axisMove 变化,emit input:move; 2) 消费边沿队列,emit input:fire/pause。
  const offTick = deps.runtime.onTick(() => {
    normalizer.flush();
  });

  // ---- blur 防御:窗口失焦时清空按键 / 鼠标按钮,防止幽灵输入 ----
  // 只在目标是 `window` 时挂(避免测试 / stub 触发不存在的 'blur' 事件)。
  // 类型上 `target` 可能是 `HTMLElement` / EventTarget stub,需要窄化。
  const onBlur = (): void => {
    keyboard.clear();
    mouse.clear();
  };
  const isWindow = typeof window !== "undefined" && target === window;
  if (isWindow) {
    window.addEventListener("blur", onBlur);
  }

  // ---- 公开的 Port ----
  const port: InputPort = {
    isDown: (key: InputKey) => keyboard.isDown(key),
    axisMove: () => normalizer.axisMove(),
    axisAim: (screenPos: Vec2) => normalizer.axisAim(screenPos),
    mousePos: () => mouse.position(),
    enable: () => {
      keyboard.enable();
      mouse.enable();
    },
    disable: () => {
      keyboard.disable();
      mouse.disable();
    },
  };

  // ---- 内部 dispose(测试 / HMR 路径) ----
  // 业务模块**不**该用 — 用完就破坏 Input 模块的封装。
  const portWithDispose = port as InputPort & { __dispose: () => void };
  portWithDispose.__dispose = (): void => {
    port.disable();
    offTick();
    if (isWindow) {
      window.removeEventListener("blur", onBlur);
    }
  };

  return port;
};
