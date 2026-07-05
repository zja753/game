/**
 * `LevelUpOrchestrator` — 升级三选一编排(plan/modules/progression.md §6 子模块 7)。
 *
 * 职责:
 *  - 在 `running → levelup_modal` 转移时,调 `RewardShopPort.rollLevelUpChoices(level)`,
 *    把结果包成 `SceneContext` 里的 `choices: readonly RewardId[]` 字段。
 *  - 是 `GameSceneController` 调 `RewardShop` 的**唯一**位置 —— 不让 controller
 *    直接持有 `RewardShopPort`,保持 controller "只懂状态机、不懂业务细节" 的纯度。
 *
 * 设计原则:
 *  - 一次性函数 / 命令式;不订阅 bus。
 *  - 不做"去重 / 缓存" —— `RewardShop` 自己管 `RewardCatalog`。
 *  - 失败(空数组)不抛错,直接返回空数组;controller 据此走兜底。
 *
 * 复用性:
 *  - 单测里 `rewardShop.rollLevelUpChoices(level)` 是 spy,断言"调过几次 / 传了啥"。
 */
import type { RewardId } from "../../../runtime/types";
import type { RewardShopPort } from "../../../runtime/ports/RewardShopPort";

/** `LevelUpOrchestrator` 句柄。 */
export interface LevelUpOrchestratorHandle {
  /**
   * 拉升级三选一候选列表。
   *
   * @param level 玩家当前等级(1-based;roadmap §0.1 区分"关卡"和"玩家等级",
   *              `RewardShop.rollLevelUpChoices` 接的是后者)。
   * @returns 候选 ID 列表(长度 ≤ 3,空数组表示 catalog 里没东西可发)。
   *
   * 触发源:Progression 在 `xp >= xpToNext` 时调一次,把结果塞进
   * `SceneContext.choices`。
   */
  rollChoices(level: number): readonly RewardId[];
}

export function createLevelUpOrchestrator(rewardShop: RewardShopPort): LevelUpOrchestratorHandle {
  return {
    rollChoices(level) {
      return rewardShop.rollLevelUpChoices(level);
    },
  };
}
