/**
 * `HudUiPort` — HudUi 模块对外暴露的能力(见 plan/modules/hud.md §2)。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 其他模块**只**通过这个 interface 调用 HudUi 的能力。
 *  - 任何 `import { ... } from "@/modules/hud/internal/..."` 都是破坏约束。
 *  - HudUi 模块**目前未落地**(M8);本文件先按 plan §2 锁定接口形态。
 *
 * 关键设计点(hud.md §7 + roadmap §3.8):
 *  - HudUi 是**唯一**完全无 Port 依赖的模块,只订阅事件。
 *  - HudUi 不知道 Progression 的存在;它只根据 `level:phase.scene` 决定渲染
 *    哪个根布局(roadmap §3.8 明确 + hud.md §5 关键设计点)。
 *  - `pickReward` 是本 Port **唯一**写动作:玩家在 UI 上点升级卡 / 商店物品
 *    → 内部 `bus.emit({ type: "reward:picked", id, kind })`。RewardShop 不订阅
 *    此事件(rewards.md §3 注释);Progression 收到后切回 `running` scene。
 *  - `show` / `hide` 由 RootContainer 调(hide 用于"暂停 / 重开过渡",如
 *    GameOver 期间整张 HUD 闪黑过渡)。
 *
 * 测试形态(hud.md §8):
 *  - 集成层(`src/test/integration/`)模拟 `GameEventBus.emit({...})` 序列,
 *    用 `@testing-library/react` 断言 DOM。
 *  - 模块单测(`EventBridge` 的 reducer 纯函数 + 组件级 snapshot)。
 *  - `pickReward` 是个 wrapper,本身不需要单测(覆盖事件流即可)。
 */
import type { RewardId, RewardKind } from "../types";

/**
 * `HudUiPort` — HUD 浮层对外的能力。
 *
 * 调用方:**只有 RootContainer 在装配阶段调** `show` / `hide`,业务代码不调。
 * 业务代码通过订阅事件("订阅推送")影响 HUD 渲染,而不是主动调 HUD 的方法。
 * 例外:`pickReward` 是 HUD 内部触发"玩家在 UI 上点了某个卡"的出口。
 */
export interface HudUiPort {
  /**
   * 启动 React 树挂载到 `/game` 路由的 div 上(由 RootContainer 装配阶段调一次)。
   *
   * 之后 HUD **全自动工作**:订阅 `player:*` / `level:*` / `reward:*` / `enemy:killed`
   * 等事件,根据 `level:phase.scene` 切换根布局(hud.md §5)。
   *
   * 重复 `show()` 幂等(避免 HMR 重复挂载);实现方内部维护一个"已挂载"标记。
   */
  show(): void;

  /**
   * 暂停 / 重开过渡时调(RootContainer 装配阶段外可被 Progression 在 `gameover` /
   * `victory` 时调,用于整张 HUD 淡出)。
   *
   * 摘掉 React 树但**不**销毁内部 store —— 重新 `show()` 时 state 还在。
   * 测试 / Demo 用:可在 `show` / `hide` 切换间断言 store 不丢字段。
   */
  hide(): void;

  /**
   * 玩家在 UI 上点了某个奖励卡片(升级 / 商店物品)。
   *
   * 内部: `bus.emit({ type: "reward:picked", id, kind })`(hud.md §2 注释)。
   * Progression 收到事件后切回 `running` scene,然后调 `RewardShopPort.applyReward`。
   *
   * HudUi **不**直接调 `applyReward` —— HudUi 没有 RewardShop Port(hud.md §7:
   * "唯一完全无 Port 依赖的模块")。本方法唯一副作用是 emit 事件。
   *
   * 集成测试 / RTL 组件测试通过模拟点击 → 调本方法 → 断言 bus 收到事件来验证。
   */
  pickReward(id: RewardId, kind: RewardKind): void;
}
