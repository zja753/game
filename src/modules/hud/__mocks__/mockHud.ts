/**
 * `createMockHud` — HudUi 模块的 Mock 工厂。
 *
 * 关键不变量:
 *  - 暴露完整 `HudUiPort`(下游用本 mock 当真 HudUi 用,做"接口形状"的早期接入)。
 *  - **不** mount React:不走 `createRoot`,只持有 store + EventBridge,
 *    测试可读 store 断言事件流而不依赖 DOM。
 *  - `show()` 是 stub(只计数 + 标记已挂载,不挂 React);`__getStore()` 把
 *    内部 store 暴露给单测做断言。
 *  - 内部用真实 `EventBridge`(也即真实 reducer 链路) —— 本模块的核心
 *    不变量是"事件流 → store 状态",而不是"组件渲染",所以测试 Mock 应该
 *    保留"事件 → state"这段,只短路掉 React 渲染。
 *
 * 关于 bus:
 *  - 默认传 `undefined` 时使用 stub bus(`on` 返回 no-op,`emit` no-op),保证
 *    类型形状一致,但 Mock 默认**不**真正订阅事件,store 保持初始态。
 *  - 测试需要事件流时,传入真实的 `createGameEventBus()` 实例并 emit;store
 *    会通过内部 EventBridge 收到事件。
 */
import type { RewardId, RewardKind } from "../../../runtime/types";
import type { HudUiPort } from "../../../runtime/ports/HudUiPort";
import type { GameEventBus } from "../../../runtime/EventBus";

import { createHudUiStore, type HudUiStore } from "../internal/HudUiStore";
import { createHudEventBridge } from "../internal/EventBridge";

/** Mock 工厂的可调参数。 */
export interface MockHudOptions {
  /** 可选:外部传入的 bus(主要是想 reuse 测试已经准备好的 mock bus)。 */
  bus?: GameEventBus;
}

/** Mock 工厂返回的扩展 Port,带 spy / driver。 */
export interface MockHudHandle extends HudUiPort {
  /** spy:`show` 被调过的次数(mock 不真挂 DOM,只计数)。 */
  readonly showCallCount: number;
  /** 测试 driver:读内部 store(用于断言 `player:damaged` 后 hp 字段)。 */
  __getStore(): HudUiStore;
  /** 测试 driver:是否已"show"过(即使没真正挂 DOM)。 */
  __isShown(): boolean;
}

/** 一个"什么都不做"的 bus 桩 —— 用于 `MockHudOptions.bus` 未传时。 */
const STUB_BUS: GameEventBus = {
  on() {
    return () => {};
  },
  emit() {
    // no-op:stub 不真正分发事件,store 会停在初始态。
  },
  clear() {},
  subscriberCount() {
    return 0;
  },
};

/**
 * 创建 Mock HudUi Port。
 *
 * 工厂内部**不**调用真实 react-dom 的 `createRoot` —— 见 Mock 文件头注释。
 */
export function createMockHud(opts: MockHudOptions = {}): MockHudHandle {
  const bus: GameEventBus = opts.bus ?? STUB_BUS;
  const store: HudUiStore = createHudUiStore();
  // bridge 在工厂阶段就订阅:真实 bus 真订阅,stub bus 上面 `on` 返回 no-op,等价于没挂。
  createHudEventBridge(bus, store);
  let showCalls = 0;
  let shown = false;

  const port: HudUiPort = {
    show() {
      // Port 的 `show()` 不带参数 —— 容器由 `createHudUiModule` 的 deps.resolveContainer 解析;
      // 本 mock 直接 stub 掉(计数 + 标记已挂载)。
      showCalls += 1;
      shown = true;
    },
    hide() {
      shown = false;
      // 不销毁 store;真实 Port 同样不销毁(注释见 `HudUiPort.hide`)。
    },
    pickReward(id: RewardId, kind: RewardKind) {
      // mock 行为与真实 Port 完全一致 —— 走 bus.emit。
      // 即使是 stub bus,也不抛错。
      bus.emit({ type: "reward:picked", id, kind });
    },
  };

  const handle: MockHudHandle = {
    ...port,
    get showCallCount() {
      return showCalls;
    },
    __getStore() {
      return store;
    },
    __isShown() {
      return shown;
    },
  };
  return handle;
}
