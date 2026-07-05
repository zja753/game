/**
 * `ShopOrchestrator` — 商店编排(plan/modules/progression.md §6 子模块 6)。
 *
 * 职责:
 *  - 在 `portal → shop` 转移时,调 `RewardShopPort.rollShopItems(level)`,
 *    把结果包成 `SceneContext.items: readonly ShopItem[]`。
 *  - 是 `GameSceneController` 调 `RewardShop.rollShopItems` 的**唯一**位置
 *    (同上 `LevelUpOrchestrator` 的设计原则)。
 *
 * 设计原则:
 *  - 一次性函数 / 命令式。
 *  - 不做价格计算 / 折扣 —— `RewardShop` 内部按 `level` 算。
 *
 * 复用性:
 *  - 单测里 `rewardShop.rollShopItems(level)` 是 spy。
 */
import type { ShopItem } from "../../../runtime/types";
import type { RewardShopPort } from "../../../runtime/ports/RewardShopPort";

/** `ShopOrchestrator` 句柄。 */
export interface ShopOrchestratorHandle {
  /**
   * 拉商店商品列表。
   *
   * @param level 当前关卡(1-based;roadmap §0.1 把"关卡"和"玩家等级"分开,
   *              `RewardShop.rollShopItems` 接的是前者 —— `ShopItem.price`
   *              按关卡递增)。
   * @returns 商品列表(长度 4~6;空数组表示 catalog 里没东西)。
   *
   * 触发源:Progression 在 `portal → shop` 转移时调一次,结果塞进
   * `SceneContext.items`。
   */
  rollItems(level: number): readonly ShopItem[];
}

export function createShopOrchestrator(rewardShop: RewardShopPort): ShopOrchestratorHandle {
  return {
    rollItems(level) {
      return rewardShop.rollShopItems(level);
    },
  };
}
