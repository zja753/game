/**
 * `ShopRoller` — 商店抽卡(rewards.md §5)。
 *
 * 职责:
 *  - 从 `RewardCatalog` 抽 4~6 件(`kind === "shop"`)商品,价格随关卡递增。
 *
 * 设计原则:
 *  - 纯函数(无副作用),只读 Catalog。
 *  - 价格随关卡递增:`basePrice * (1 + (level - 1) * PRICE_SCALE_PER_LEVEL)`,
 *    `PRICE_SCALE_PER_LEVEL = 0.2`(每关 +20%)。rewards.md §2 注释:
 *    "价格随关卡递增";首版走线性,后续按需扩指数曲线。
 *  - 商品数:在 `[SHOP_MIN_ITEMS, SHOP_MAX_ITEMS]` 闭区间内按 catalog 容量截断。
 *  - **不**抛错;空 catalog / 全是 levelup 项 → 返回空数组。
 *  - **不**做货币校验 / 折扣 —— rewards.md §8 明列"不做 UI 卡片渲染"等同源
 *    思想:本模块只跑机制。
 */
import type { ShopItem } from "../../../runtime/types";
import type { RewardCatalogHandle } from "./RewardCatalog";

/** 商店最少商品数(协议层 rewards.md §2 `rollShopItems` 注释)。 */
export const SHOP_MIN_ITEMS = 4;
/** 商店最多商品数。 */
export const SHOP_MAX_ITEMS = 6;
/** 每关价格递增系数(0.2 = +20%/关)。 */
export const PRICE_SCALE_PER_LEVEL = 0.2;

/** `ShopRoller` 句柄。 */
export interface ShopRollerHandle {
  /**
   * 抽 N 件商品,价格按关卡递增。
   *
   * @param level 当前关卡(1-based;首版用作价格乘子)。
   * @returns 商品列表(长度 ∈ `[SHOP_MIN_ITEMS, SHOP_MAX_ITEMS]`,
   *          当 catalog 里 shop 项不足时返回全部可用项)。
   *
   * 抽卡算法:同 `LevelUpRoller` 走 Fisher-Yates 洗牌,再按当前关卡 + 池大小
   * 在 `[min, max]` 内选一个数量。
   */
  roll(level: number): readonly ShopItem[];
}

export function createShopRoller(catalog: RewardCatalogHandle): ShopRollerHandle {
  return {
    roll(level) {
      const pool = catalog.list().filter((spec) => spec.kind === "shop");
      if (pool.length === 0) return [];

      // Fisher-Yates 洗牌。
      const shuffled = pool.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = shuffled[i]!;
        shuffled[i] = shuffled[j]!;
        shuffled[j] = tmp;
      }

      // 数量:在 [min, max] 内随机,且不超过 pool 大小。
      const max = Math.min(SHOP_MAX_ITEMS, shuffled.length);
      const min = Math.min(SHOP_MIN_ITEMS, max);
      // 注意:`min > max` 仅在 pool 容量为 0 时发生,前面已过滤;这里 `min <= max` 恒成立。
      const count = min + Math.floor(Math.random() * (max - min + 1));

      // 价格乘子:`1 + (level - 1) * SCALE`,向上取整让 HUD 显示整数金币。
      const priceMul = 1 + Math.max(0, level - 1) * PRICE_SCALE_PER_LEVEL;
      const picked = shuffled.slice(0, count);

      return picked.map<ShopItem>((spec) => ({
        id: spec.id,
        name: spec.name ?? spec.id,
        description: spec.description ?? "",
        price: Math.round((spec.price ?? 0) * priceMul),
      }));
    },
  };
}
