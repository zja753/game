/**
 * `LevelUpRoller` — 升级三选一抽卡(rewards.md §5)。
 *
 * 职责:
 *  - 从 `RewardCatalog` 抽 N 个(`N = rollLevelUpChoices` 默认 3)**不重复** ID,
 *    且 `kind === "levelup"`。
 *
 * 设计原则:
 *  - 纯函数(无副作用),只读 Catalog。
 *  - **不**做权重 / 等级联动 —— 协议层只规定机制,数值调优留给 M8+。
 *    rewards.md §8 不做清单明列:"不做奖励的'性价比平衡'(留给 M8 数值调优)"。
 *  - 不足 N 个时返回全部(rewards.md §2 注释:"如果 Catalog 里 `kind==='levelup'`
 *    的不足 3 个,返回全部可用项")。
 *  - **不**抛错;空 catalog / 全是 shop 项 → 返回空数组。
 */
import type { RewardId } from "../../../runtime/types";
import type { RewardCatalogHandle } from "./RewardCatalog";

/** 升级三选一默认数量(协议层 rewards.md §2 `rollLevelUpChoices` 注释)。 */
export const LEVELUP_CHOICES_COUNT = 3;

/** `LevelUpRoller` 句柄。 */
export interface LevelUpRollerHandle {
  /**
   * 抽 N 个**不重复**的升级奖励 ID。
   *
   * @param level 玩家当前等级(1-based;首版不参与计算,签名保留供未来数值扩展)。
   * @returns 候选 ID 列表(长度 ≤ `LEVELUP_CHOICES_COUNT`)。
   *
   * 抽卡算法:Fisher-Yates 洗牌 + 切片前 N 个;`Math.random()` 走 V8 引擎自带 PRNG,
   * 首版够用(M8+ 若要可复现种子,改成接受可选 `rng` 参数)。
   */
  roll(level: number): readonly RewardId[];
}

export function createLevelUpRoller(catalog: RewardCatalogHandle): LevelUpRollerHandle {
  return {
    roll(_level) {
      const pool = catalog.list().filter((spec) => spec.kind === "levelup");
      if (pool.length === 0) return [];

      // 标准 Fisher-Yates:对 pool 做原地洗牌,再切片前 N 个。
      const shuffled = pool.slice();
      const take = Math.min(LEVELUP_CHOICES_COUNT, shuffled.length);
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = shuffled[i]!;
        shuffled[i] = shuffled[j]!;
        shuffled[j] = tmp;
      }
      return shuffled.slice(0, take).map((spec) => spec.id);
    },
  };
}
