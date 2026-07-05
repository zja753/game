/**
 * `RewardCatalog` — RewardShop 内部的奖励注册表(rewards.md §5)。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1 + rewards.md §6):
 *  - 本目录**只**持 `Map<RewardId, RewardRegistrationSpec>` 纯数据,
 *    **不** import 其他模块的 Port 类型(否则就成了反向 import)。
 *  - `apply` 闭包由注册方自己闭包捕获所需 Port;RewardShop 调 `applyReward(id)`
 *    时按 id 查表执行闭包,谁注册谁执行 —— RewardShop 不感知 Player / Combat 存在。
 *
 * 设计原则:
 *  - `register` **不**做查重:后注册的同 id 覆盖前注册的(rewards.md §7 验收点:
 *    "重复 ID 后注册的覆盖前注册的");Map.set 天然支持。
 *  - `unregister` 找不到 id 走 no-op,不抛错。
 *  - `list` 返回"注册顺序"的快照:Map 保留插入顺序(ECMAScript 规范),
 *    `Array.from(map.values())` 直接拿。
 */
import type { RewardId } from "../../../runtime/types";
import type { RewardRegistrationSpec } from "../../../runtime/ports/RewardShopPort";

/** `RewardCatalog` 句柄。 */
export interface RewardCatalogHandle {
  /** 注册 / 覆盖一条奖励。 */
  register(spec: RewardRegistrationSpec): void;
  /** 反注册;找不到 id 走 no-op。 */
  unregister(id: RewardId): void;
  /** 按 id 查注册项;找不到返回 `undefined`(不抛错)。 */
  get(id: RewardId): RewardRegistrationSpec | undefined;
  /** 全表(只读,注册顺序)。 */
  list(): readonly RewardRegistrationSpec[];
  /** 当前条目数。 */
  size(): number;
}

export function createRewardCatalog(): RewardCatalogHandle {
  // Map 保留插入顺序 → `list()` 直接 `Array.from(map.values())` 拿快照。
  const entries = new Map<RewardId, RewardRegistrationSpec>();

  return {
    register(spec) {
      entries.set(spec.id, spec);
    },
    unregister(id) {
      entries.delete(id);
    },
    get(id) {
      return entries.get(id);
    },
    list() {
      // 浅拷贝:外部拿到的是快照,内部后续 register/unregister 不影响已返回的数组。
      return Array.from(entries.values());
    },
    size() {
      return entries.size;
    },
  };
}
