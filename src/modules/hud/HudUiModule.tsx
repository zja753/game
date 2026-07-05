/**
 * `HudUiModule` — HudUi 模块对外的"装配层"(plan/modules/hud.md §2-§7)。
 *
 * 把内部子模块(`HudUiStore` / `EventBridge`)组合起来,实现 `HudUiPort` 接口
 * 的全部方法(主要是 `show` / `hide` / `pickReward`),并通过 `createRoot`
 * 把 React 树挂到调用方指定的容器上。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 这个文件**只**能被根容器 `import`。
 *  - 其他模块**不能** import 它,只能 import 根容器传给它们的 `HudUiPort`。
 *  - 本模块**不持有**任何其他模块的 Port 引用(hud.md §7:唯一无 Port 依赖的模块);
 *    全部交互走 EventBus。
 *
 * 权威字段(hud.md §4):
 *  - 无。本模块持有的 `HudUiStore` 是"事件驱动的视图态镜像",真实字段在
 *    Player / Progression / MapObstacle 等模块,通过 EventBus 同步过来。
 *
 * 模块间事件契约(plan §3 + EventBus 当前字典):
 *  - **订阅**:`player:damaged` / `player:died` / `player:moved` (占位) /
 *    `enemy:killed` / `level:up` / `level:phase` / `timer:tick` /
 *    `map:loaded` / `reward:available` / `reward:applied` / `projectile:hit` /
 *    `camera:moved`(完整列表见 `EventBridge.ts`)。
 *  - **发出** `reward:picked { id, kind }` —— 唯一写动作,响应 `LevelUpCards` /
 *    `ShopOverlay` 的玩家点击(hud.md §2 + HudUiPort 注释)。
 *
 * 启动顺序(roadmap §5 + 顶层 §6):
 *  - 工厂在装配阶段**不**主动 mount;由 RootContainer 在装配完后调 `port.show(container)`。
 *  - `show(container)` 是幂等的(内部 guard);多次 `show` 不会重 mount,但允许替换 container。
 *  - 卸载:`port.hide()` 调 `ReactDOM.root.unmount()` 但**不**销毁 store —— 下次
 *    `show` 时 state 还在(HudUiPort.hide 注释)。
 */
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";

import type { GameEventBus } from "../../runtime/EventBus";
import type { HudUiPort } from "../../runtime/ports/HudUiPort";
import type { RewardId, RewardKind } from "../../runtime/types";

import { createHudUiStore, type HudUiStore } from "./internal/HudUiStore";
import { createHudEventBridge } from "./internal/EventBridge";
import { HudRoot } from "./internal/components/HudRoot";

import "./hud.css";

/**
 * HUD 挂载容器解析策略(roadmap §2.3 + HudUiPort.show 注释)。
 *
 * Port 契约里 `show()` 不带参数 —— 容器来源由工厂在装配阶段**一次性**注入,
 * 调用方通过 deps 决定"挂载到 `/game` 路由的 div 上,还是 document.body,
 * 还是测试用的 mock element"。
 */
export type HudContainerResolver = () => Element | null;

const DEFAULT_RESOLVER: HudContainerResolver = () =>
  typeof document === "undefined" ? null : document.querySelector<HTMLElement>(".hud-mount");

/** `createHudUiModule` 工厂签名。 */
export interface HudUiModuleDeps {
  /** 事件总线。本模块**只**用 EventBus 与外界通信(hud.md §7),所以这是唯一依赖。 */
  bus: GameEventBus;
  /**
   * 可选:容器解析器;默认查 `document.querySelector(".hud-mount")`。
   * Node 测试环境没有 `document`,默认解析器返回 null,`show()` no-op;
   * 测试可以传 `() => mock element` 强行 mount。
   */
  resolveContainer?: HudContainerResolver;
}

/**
 * `createHudUiModule` 工厂返回的扩展 Port(测试 / HMR 用)。
 *
 * 业务代码拿到的就是 `HudUiPort`;`__dispose` 是测试 / HMR 用,清掉所有订阅
 * + ReactRoot + store(若已 mount)。
 */
export type HudUiPortFactory = (deps: HudUiModuleDeps) => HudUiPort & {
  /** 测试 / HMR 用:取消 EventBridge 订阅 + unmount ReactRoot。store 也丢。 */
  __dispose: () => void;
  /** 测试 / HMR 用:读 store;用来在 unmount 后仍能断言 state。 */
  __store: () => HudUiStore;
};

/**
 * 创建 HudUi 模块实例。
 *
 * 生命周期(由根容器保证):
 *  1. 根容器 `createHudUiModule({ bus })` → 拿 `HudUiPort`。
 *  2. 根容器在装配阶段调 `port.show(container)` mount React 树。
 *  3. RootContainer 不需要再做别的;事件总线**自动**驱动 HUD 渲染。
 *  4. 销毁:进程结束 / HMR 时调 `__dispose`(测试用,业务代码不调)。
 */
export const createHudUiModule: HudUiPortFactory = (deps) => {
  // ---- 0. 内部子模块装配 ----
  // store 在工厂阶段就创建(即使还没 mount),这样 `show()` 之前的早期事件也能保留。
  const store: HudUiStore = createHudUiStore();
  const bridge = createHudEventBridge(deps.bus, store);

  /** 把 `<HudRoot>` 渲染成 React 元素,纯构造无副作用 —— capture factory 闭包里的 `pickReward` / `store`。 */
  const renderTree = (): ReactElement => (
    <HudRoot
      store={store}
      // Arrow wrapper 绕开 unbound-method 警告(同 HudRoot 内注释)。
      getState={() => store.getState()}
      onPickReward={(id, kind) => pickReward(id, kind)}
    />
  );

  // ---- 1. 公开 Port ----
  let mountedRoot: Root | null = null;

  /**
   * 把 `<HudRoot>` render 到 `deps.resolveContainer()` 返回的容器。
   * 幂等:已挂载 → no-op;容器不可解析(Node 测试或装配期)→ no-op。
   * Port 的 `show()` **不**带参数 —— 容器由 deps 一次性注入
   * (HudContainerResolver 注释)。
   */
  function show(): void {
    if (mountedRoot !== null) return;
    const container = (deps.resolveContainer ?? DEFAULT_RESOLVER)();
    if (container === null) return; // 防御性:Node 测试或装配期没有 DOM 容器时 no-op。
    mountedRoot = createRoot(container);
    mountedRoot.render(renderTree());
  }

  /** 摘掉 React 树但保留 store。幂等。 */
  function hide(): void {
    if (mountedRoot !== null) {
      mountedRoot.unmount();
      mountedRoot = null;
    }
    // store 不动;React 卸载,后续 show 时 state 还在(HudUiPort.hide 注释)。
  }

  /** 玩家点卡后的回调 → emit `reward:picked`。 */
  function pickReward(id: RewardId, kind: RewardKind): void {
    deps.bus.emit({ type: "reward:picked", id, kind });
  }

  const port: HudUiPort = {
    show,
    hide,
    pickReward,
  };

  // ---- 2. dispose(测试 / HMR 用)----
  const portWithDispose = port as HudUiPort & {
    __dispose: () => void;
    __store: () => HudUiStore;
  };
  portWithDispose.__dispose = (): void => {
    hide();
    bridge.dispose();
  };
  portWithDispose.__store = (): HudUiStore => store;

  return portWithDispose;
};
