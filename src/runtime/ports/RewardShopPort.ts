/**
 * `RewardShopPort` — RewardShop 模块对外暴露的能力(见 plan/modules/rewards.md §2)。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 其他模块**只**通过这个 interface 调用 RewardShop 的能力。
 *  - 任何 `import { ... } from "@/modules/rewards/internal/..."` 都是破坏约束。
 *  - RewardShop 模块**目前未落地**(M7);本文件先按 plan §2 锁定接口形态。
 *
 * 关键设计点(rewards.md §6 + roadmap §0.1):
 *  - RewardShop 是**唯一**"会主动改其他模块权威字段"的地方,改的入口是
 *    **注册回调**(`register`),**不**是 Port 引用。
 *  - RootContainer 装配阶段,各模块(典型:Player / Combat)向 `RewardShop.register()`
 *    提交 `{ id, kind, apply(deps) }` 闭包;RewardShop 内部维护 `RewardCatalog`,
 *    调 `applyReward(id)` 时按 `id` 查表执行闭包,谁注册谁执行。
 *  - 因此本 Port **不**出现其他模块的 Port 类型名;`apply` 闭包的"端口快照"
 *    由各模块在 `register` 时自己闭包捕获,RewardShop 不感知。
 *  - **不**订阅 `reward:picked` 事件(rewards.md §3 注释);该事件由 HUD 发出,
 *    Progression 收到后**自己**调 `applyReward`。
 */
import type { ApplyResult, RewardId, RewardRegistration, ShopItem } from "../types";

/**
 * `apply` 闭包收到的"端口快照"形状。
 *
 * 注册方在 `register` 时**自己决定**塞哪些 Port(典型:`{ player, combat, ... }`),
 * RewardShop **不**知道、不持有、不类型化这个对象 —— 协议层只声明
 * "apply 接受一个任意 payload"是 `unknown`,由注册方 cast 到自己需要的类型。
 *
 * 之所以用 `unknown` 而不是 `never` / 严格对象,是因为:
 *  - 协议层"绝不引用其他模块的类型名"(plan §2.3);
 *  - 各模块注册的 `apply` 闭包形态不一致(Player 注册的 `apply` 想要 `PlayerPort`,
 *    Combat 注册的 `apply` 想要 `CombatPort`);统一用 `unknown` 让 `apply`
 *    在自己内部做 cast,符合"RewardShop 不持有其他 Port"原则。
 */
export type RewardApplyDeps = unknown;

/**
 * `RewardRegistration` 的完整形态(协议层最终版)。
 *
 * `runtime/types.ts` 已经定义了"协议语义级"`RewardRegistration`(id / kind / 名称 / 描述),
 * 这里补上"注册实现"必需的 `apply` 字段 —— 因为 `apply` 的 payload 形状是
 * `unknown` / 各模块自定,**不**属于协议层(plan §2.3 解耦铁律),所以放本文件。
 */
export interface RewardRegistrationSpec extends RewardRegistration {
  /**
   * 注册时挂上的"应用奖励"闭包,RewardShop 在 `applyReward(id)` 时按 id 查表执行。
   * 闭包参数 `deps` 由 RootContainer 装配阶段一次性注入(本模块**不**感知 deps 形状)。
   * 闭包返回值 `ApplyResult`(见 runtime/types.ts):成功 `{ ok: true }` / 失败 `{ ok: false, reason }`。
   */
  apply(deps: RewardApplyDeps): ApplyResult;
}

/**
 * `RewardShopPort` — 升级三选一 / 商店编排对外能力。
 */
export interface RewardShopPort {
  /**
   * 升级三选一:返回 N 个**不重复**的 `RewardId`(`kind === "levelup"`)。
   *
   * @param level 玩家当前等级(1-based,1 关 1→2 升级对应 `level=2`)。
   * @returns 候选 ID 列表(长度 = 3;如果 Catalog 里 `kind==="levelup"` 的不足 3 个,
   *          返回全部可用项;rewards.md §7 验收点)。
   *
   * 触发源:Progression 在 `running → levelup_modal` 转移时调,结果塞进
   * `SceneContext.choices`,HUD 据此渲染三张升级卡。
   */
  rollLevelUpChoices(level: number): readonly RewardId[];

  /**
   * 商店抽卡:返回 N 个 `ShopItem`(`kind === "shop"`,带价格)。
   *
   * @param level 关卡(1-based,价格随关卡递增;rewards.md §5 `ShopRoller`)。
   * @returns 商品列表(长度 4~6,由实现方决定)。
   *
   * 触发源:Progression 在 `running → shop` 转移时调,结果塞进
   * `SceneContext.items`,HUD 据此渲染商店面板。
   */
  rollShopItems(level: number): readonly ShopItem[];

  /**
   * 真正"应用奖励":按 `id` 查 `RewardCatalog`,执行对应的 `apply` 闭包。
   *
   * @param id 奖励 ID(由 HUD 玩家点击 → Progression 转发到本方法)。
   * @returns `{ ok: true }` 成功;`{ ok: false, reason }` 失败(未注册 / 内部错误)。
   *          **不**抛错(rewards.md §7 验收点)。
   *
   * 触发源:Progression 收到 `reward:picked` 事件后,`level:phase` 已切回
   * `running`,然后调本方法应用奖励。
   */
  applyReward(id: RewardId): ApplyResult;

  /**
   * 已注册的奖励全表(只读,供 HUD 渲染设置面板 / 调试)。
   * 返回的顺序是注册顺序;RewardShop 内部存的是 `Map<RewardId, RewardRegistrationSpec>`,
   * 这里返回 `Array.from(map.values())` 快照。
   */
  listRewards(): readonly RewardRegistrationSpec[];

  // ---- RootContainer 装配阶段调,业务代码不调 ----

  /**
   * 注册一条奖励到 `RewardCatalog`。
   *
   * RootContainer 装配阶段由各模块(典型:Player / Combat)调:
   * ```ts
   * rewardShop.register({
   *   id: "weapon_pistol_dmg_up",
   *   kind: "levelup",
   *   apply: (deps) => { /* cast deps + apply *\/ },
   * });
   * ```
   *
   * - **不**做查重(rewards.md §7 验收点:"重复 ID 后注册的覆盖前注册的")。
   * - **不**做白名单校验(`kind` 取值由调用方负责,本接口接受任何字符串)。
   */
  register(spec: RewardRegistrationSpec): void;

  /**
   * 反注册(测试 / 热重载时调;首版业务代码不调)。
   * 找不到 id 走 no-op,不抛错。
   */
  unregister(id: RewardId): void;
}
