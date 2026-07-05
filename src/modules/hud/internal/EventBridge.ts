/**
 * `EventBridge` — EventBus → HudUiStore 的订阅适配层(plan/modules/hud.md §6)。
 *
 * 职责:
 *  - 持有 `GameEventBus` 上的**全部** HUD 用得上事件的订阅;
 *  - 把事件顺序喂给 `HudUiStore.dispatch`;
 *  - 暴露 `dispose` 给 `HudUiModule.__dispose` 测试 / HMR 摘订阅。
 *
 * 设计原则:
 *  - 本文件**只**是订阅适配,不做事件解释(reducer 在 `HudUiStore.ts`);保持
 *    "适配层薄,业务逻辑集中"的可测试性。
 *  - 一次性把 store 用得到的事件全订阅一遍(roadmap §3 + hud.md §3)。`input:*`
 *    HUD 不订阅(无显示需求);`portal:appeared` HUD 订阅了但不消费(交给
 *    reducer 忽略),保持事件订阅集合"明确完整"。
 *  - 不持有 Excalibur 引用、不调 `bus.clear()` —— `bus.clear()` 由 `RootContainer`
 *    在 dispose 阶段手动调(roadmap §2 EventBus API)。
 */
import type { GameEventBus, GameEventType } from "../../../runtime/EventBus";

import type { HudUiStore } from "./HudUiStore";

/** HUD 订阅的事件类型清单(与 `HudUiStore.reduceHudUi` 的 switch 严格对齐)。 */
const HUD_SUBSCRIBED_EVENTS: readonly GameEventType[] = [
  "player:damaged",
  "player:died",
  "player:moved",
  "enemy:killed",
  "level:up",
  "level:phase",
  "timer:tick",
  "map:loaded",
  "reward:available",
  "reward:applied",
  "projectile:hit",
  "camera:moved",
];

/** `EventBridge` 工厂返回的接口。 */
export interface HudEventBridge {
  /**
   * 摘掉所有订阅。**不**调 = 订阅持续到进程结束(HUD 生命周期 = 进程生命,
   * 见 `HudUiModule` 注释)。HMR / 测试时调。
   */
  dispose(): void;
}

/**
 * 创建 `EventBridge`,把 `bus` 上的指定事件桥接到 `store.dispatch`。
 *
 * `dispose` 一次性取消所有订阅,后续不再 dispatch;store 自身**不**被销毁
 * (`hide()` 用例需要保留 state 见 `HudUiPort` 注释)。
 */
export function createHudEventBridge(bus: GameEventBus, store: HudUiStore): HudEventBridge {
  // 一次性挂全部订阅;返回的 unsubscribe 累计,dispose 时批量调。
  const unsubs: Array<() => void> = [];
  for (const t of HUD_SUBSCRIBED_EVENTS) {
    unsubs.push(
      bus.on(t, (event) => {
        // bridge 只负责"把事件往下传",不解释事件 —— reducer 才是 event 解释器。
        store.dispatch(event);
      }),
    );
  }
  return {
    dispose() {
      while (unsubs.length > 0) {
        const u = unsubs.pop();
        if (u) u();
      }
    },
  };
}
