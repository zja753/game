/**
 * `createMockRewardShop` — RewardShop 模块的 Mock 工厂(plan §5.1 共享 Mock)。
 *
 * 供 Progression 模块的端到端测试使用 —— Progression 唯一依赖的 RewardShop
 * 能力是 `rollLevelUpChoices` / `rollShopItems` / `applyReward`,本 mock 覆盖
 * 这三个。
 *
 * 实现:
 *  - `rollLevelUpChoices(level)` 默认返回 `["heal_small", "speed_up", "dmg_up"]`(长度 3);
 *    测试可通过 `setLevelUpChoices([...])` 覆盖。
 *  - `rollShopItems(level)` 默认返回 4 件商品(固定 id);`setShopItems([...])` 覆盖。
 *  - `applyReward(id)` 默认返回 `{ ok: true }`,记录被调过的 id 列表;
 *    测试可通过 `setApplyResult(result)` 注入失败/成功结果。
 *
 * 关键不变量:
 *  - `applyReward` **不**抛错(rewards.md §7 验收点);失败通过 `setApplyResult({ ok: false, reason })` 注入。
 */
import type { ApplyResult, RewardId, ShopItem } from "../../../runtime/types";
import type { RewardRegistrationSpec, RewardShopPort } from "../../../runtime/ports/RewardShopPort";

/** Mock 工厂的可调参数。 */
export interface MockRewardShopOptions {
  /** 升级三选一候选 ID;不传走默认 `["heal_small", "speed_up", "dmg_up"]`。 */
  initialLevelUpChoices?: readonly RewardId[];
  /** 商店商品列表;不传走 4 件默认。 */
  initialShopItems?: readonly ShopItem[];
  /**
   * `applyReward` 的默认返回值;不传走 `{ ok: true }`。
   * 测试可调 `setApplyResult` 覆盖。
   */
  initialApplyResult?: ApplyResult;
}

/** `createMockRewardShop` 返回的扩展 Port,带 spy / 驱动函数。 */
export interface MockRewardShopHandle extends RewardShopPort {
  /** spy:`rollLevelUpChoices` 被调过的入参列表(测试断言"调了哪个 level")。 */
  readonly rollLevelUpCalls: ReadonlyArray<number>;
  /** spy:`rollShopItems` 被调过的入参列表。 */
  readonly rollShopCalls: ReadonlyArray<number>;
  /** spy:`applyReward` 被调过的 id 列表(顺序保留)。 */
  readonly appliedIds: ReadonlyArray<RewardId>;
  /** spy:已注册的奖励(只读;`register` 调用后追加)。 */
  readonly registeredSpecs: ReadonlyArray<RewardRegistrationSpec>;

  /** 测试驱动:覆盖 `rollLevelUpChoices` 的返回值。 */
  setLevelUpChoices(ids: readonly RewardId[]): void;
  /** 测试驱动:覆盖 `rollShopItems` 的返回值。 */
  setShopItems(items: readonly ShopItem[]): void;
  /** 测试驱动:覆盖下一次 `applyReward` 的返回结果(一次性)。 */
  setApplyResult(result: ApplyResult): void;
  /** 清空所有 spy 状态。 */
  reset(): void;
}

/** 默认升级三选一候选。 */
const DEFAULT_LEVEL_UP_CHOICES: readonly RewardId[] = ["heal_small", "speed_up", "dmg_up"];

/** 默认商店商品。 */
const DEFAULT_SHOP_ITEMS: readonly ShopItem[] = [
  { id: "shop_heal", name: "Heal", description: "+20 HP", price: 10 },
  { id: "shop_dmg", name: "Damage Up", description: "+10% damage", price: 20 },
  { id: "shop_speed", name: "Speed Up", description: "+10% speed", price: 15 },
  { id: "shop_range", name: "Range Up", description: "+15% range", price: 25 },
];

export function createMockRewardShop(opts: MockRewardShopOptions = {}): MockRewardShopHandle {
  let levelUpChoices: readonly RewardId[] = opts.initialLevelUpChoices ?? DEFAULT_LEVEL_UP_CHOICES;
  let shopItems: readonly ShopItem[] = opts.initialShopItems ?? DEFAULT_SHOP_ITEMS;
  let applyResult: ApplyResult = opts.initialApplyResult ?? { ok: true };

  const rollLevelUpCalls: number[] = [];
  const rollShopCalls: number[] = [];
  const appliedIds: RewardId[] = [];
  const registered: RewardRegistrationSpec[] = [];

  const port: MockRewardShopHandle = {
    rollLevelUpChoices(level) {
      rollLevelUpCalls.push(level);
      return levelUpChoices;
    },
    rollShopItems(level) {
      rollShopCalls.push(level);
      return shopItems;
    },
    applyReward(id) {
      appliedIds.push(id);
      return applyResult;
    },
    listRewards() {
      // 返回注册表的浅拷贝(rewards.md §2 注释:"顺序是注册顺序")。
      return registered.slice();
    },
    // 装配阶段由其他模块调;测试里也走 no-op 占位。
    register(spec) {
      registered.push(spec);
    },
    unregister() {
      // no-op(测试里通常不调;首版不实现"按 id 删")。
    },

    // ---- spy 视图 ----
    get rollLevelUpCalls() {
      return rollLevelUpCalls.slice();
    },
    get rollShopCalls() {
      return rollShopCalls.slice();
    },
    get appliedIds() {
      return appliedIds.slice();
    },
    get registeredSpecs() {
      return registered.slice();
    },

    // ---- 驱动方法 ----
    setLevelUpChoices(ids) {
      levelUpChoices = ids;
    },
    setShopItems(items) {
      shopItems = items;
    },
    setApplyResult(result) {
      applyResult = result;
    },
    reset() {
      levelUpChoices = opts.initialLevelUpChoices ?? DEFAULT_LEVEL_UP_CHOICES;
      shopItems = opts.initialShopItems ?? DEFAULT_SHOP_ITEMS;
      applyResult = opts.initialApplyResult ?? { ok: true };
      rollLevelUpCalls.length = 0;
      rollShopCalls.length = 0;
      appliedIds.length = 0;
      registered.length = 0;
    },
  };

  return port;
}
