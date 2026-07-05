/**
 * `RewardModule` — RewardShop 模块对外的"装配层"(plan/modules/rewards.md)。
 *
 * 把内部子模块(`RewardCatalog` / `LevelUpRoller` / `ShopRoller`)组合起来,
 * 实现 `RewardShopPort` 接口的全部方法,然后把这个 Port 实例暴露给根容器
 * / 其他模块使用。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1 + rewards.md §6):
 *  - 这个文件**只**能被根容器 `import`。
 *  - 其他模块**不能** import 它,只能 import 根容器传给它们的 `RewardShopPort`。
 *  - 本模块**不持有** Player / Combat 等其他模块的 Port 引用 —— 改它们
 *    权威字段的入口**只**通过 `RewardCatalog` 里的注册回调,谁注册谁执行。
 *    这是全游戏唯一"主动改别人权威字段"的合法路径(rewards.md §6 关键设计点)。
 *
 * 权威字段:无(只调度奖励,真正改 HP / 武器 / Buff 是 Player / Combat / 其他
 * 模块自己的回调)。
 *
 * 模块间事件契约(plan §3 + EventBus 当前字典):
 *  - **发出** `reward:available` / `reward:applied`。
 *  - **不**订阅 `reward:picked`(rewards.md §3 注释:HUD 发出,Progression 收到后
 *    自己调 `applyReward`)。
 *
 * 关于 `reward:available` 的派发时机(对 rewards.md §3 的实现说明):
 *  - rewards.md §3 原文说"订阅 `level:up` / `level:phase = shop` 后调 roll + 发 `reward:available`"。
 *  - 但 Progression(`GameSceneController`)**已经**在场景转移时**同步**调
 *    `rewardShop.rollLevelUpChoices(level)` / `rollShopItems(stage)` 把结果塞进
 *    `SceneContext`(见 progression.md §3 + `GameSceneController.toLevelUpModal /
 *    .toShop`)。如果 RewardShop **再**订阅 `level:up` / `level:phase` 二次调用
 *    roll,会拿到**不同**的随机结果,与 `SceneContext` 不一致 —— bug。
 *  - 解法:把 `reward:available` 的 emit 从"bus 订阅"挪到 roll 方法**自身**,这样
 *    Progression 的同步调用 = 唯一一次 roll = 唯一一次 `reward:available`,两者
 *    内容天然一致(均基于同一份 roll 结果)。
 *  - HUD 订阅 `reward:available` 拿 id 后**自己**从 catalog 查 name/description/price
 *    渲染(用 `listRewards()` / Port 上的 `register` 入参),不需要再调 roll。
 *  - 这是 rewards.md §3 的"实现口径调整";协议层契约(`reward:available` 的
 *    payload 形状 / 触发源不变)不变。
 */
import type { ApplyFailureReason, RewardId } from "../../runtime/types";
import type { GameEventBus } from "../../runtime/EventBus";
import type { RewardRegistrationSpec, RewardShopPort } from "../../runtime/ports/RewardShopPort";

import { createRewardCatalog } from "./internal/RewardCatalog";
import { createLevelUpRoller } from "./internal/LevelUpRoller";
import { createShopRoller } from "./internal/ShopRoller";

/** `createRewardModule` 工厂签名。 */
export interface RewardModuleDeps {
  /** 事件总线(发 Reward 相关事件)。 */
  bus: GameEventBus;
}

/**
 * `createRewardModule` 工厂返回的扩展 Port(测试 / HMR 用)。
 *
 * 注意:正式业务代码拿到的就是 `RewardShopPort`,不带 `__dispose` / `__catalog`
 * —— 装配完就当普通 Port 用;测试可访问内部逃逸口。
 */
export type RewardPortFactory = (deps: RewardModuleDeps) => RewardShopPort & {
  /** 测试 / HMR 用:目前模块不订阅任何事件,dispose 是 no-op 保留供未来扩展。 */
  __dispose: () => void;
};

/**
 * 创建 RewardShop 模块实例。
 *
 * 生命周期(由根容器保证):
 *  1. 根容器 `createRewardModule({ bus })` → 拿 `RewardShopPort`。
 *  2. 根容器在装配阶段调 `port.register(...)` 把各模块的 `apply` 回调挂上
 *     (典型:Player 注册 `heal_small`、Combat 注册 `weapon_pistol_dmg_up`)。
 *  3. 业务模块(Progression 调 `rollLevelUpChoices` / `rollShopItems` /
 *     Progression 调 `applyReward` / HUD 收 `reward:available`)拿这个 Port。
 *  4. 销毁:根容器生命 = 进程生命,本模块**不**主动 dispose;测试 / HMR
 *     可调 `__dispose`(当前为 no-op)。
 */
export const createRewardModule: RewardPortFactory = (deps) => {
  // ---- 0. 内部子模块装配 ----
  const catalog = createRewardCatalog();
  const levelUp = createLevelUpRoller(catalog);
  const shop = createShopRoller(catalog);

  // ---- 1. 公开 Port ----
  const port: RewardShopPort = {
    rollLevelUpChoices(level) {
      const ids = levelUp.roll(level);
      // 唯一一次 emit:与 Progression 同步调用的 roll 结果保持一致。
      deps.bus.emit({ type: "reward:available", ids, isShop: false });
      return ids;
    },
    rollShopItems(level) {
      const items = shop.roll(level);
      // 唯一一次 emit:HUD 拿到 ids 后自己查 catalog。
      deps.bus.emit({
        type: "reward:available",
        ids: items.map((item) => item.id),
        isShop: true,
      });
      return items;
    },
    applyReward(id) {
      const spec = catalog.get(id);
      if (!spec) {
        return { ok: false, reason: "unregistered" as ApplyFailureReason };
      }
      try {
        // apply 闭包由注册方持有,RewardShop 不构造 deps —— 这里透传 `undefined` 让
        // 注册方走自己的闭包变量。rewards.md §6 + RewardShopPort 注释明确:
        // "apply 接受一个任意 payload 是 unknown,由注册方 cast"。
        const result = spec.apply(undefined);
        // 容错:即使闭包返回异常形状,统一收敛成 ApplyResult。
        const ok = result && typeof result === "object" && "ok" in result && result.ok === true;
        if (ok) {
          deps.bus.emit({ type: "reward:applied", id: spec.id, kind: spec.kind });
          return { ok: true };
        }
        // 闭包返回 `{ ok: false, reason }` 或非法形状:尊重闭包结果,缺 reason 兜底 internal_error。
        const reason: ApplyFailureReason =
          result && typeof result === "object" && "reason" in result
            ? ((result as { reason: ApplyFailureReason }).reason ?? "internal_error")
            : "internal_error";
        return { ok: false, reason };
      } catch {
        // rewards.md §7 验收点:applyReward **不**抛错,失败统一走 ApplyResult。
        return { ok: false, reason: "internal_error" };
      }
    },
    listRewards() {
      // 快照,外部拿到的是注册顺序列表(不暴露 catalog.get 的细节)。
      return catalog.list();
    },
    register(spec: RewardRegistrationSpec) {
      catalog.register(spec);
    },
    unregister(id: RewardId) {
      catalog.unregister(id);
    },
  };

  // ---- 2. dispose(测试 / HMR 用)----
  const portWithDispose = port as RewardShopPort & {
    __dispose: () => void;
  };
  portWithDispose.__dispose = (): void => {
    // 当前实现不订阅任何 bus.on / runtime.onTick,dispose 是 no-op。
    // 保留 escape hatch 以兼容未来若要订阅(例如 reset 时清空缓存)的扩展。
  };

  return portWithDispose;
};
