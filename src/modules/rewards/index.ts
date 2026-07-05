/**
 * RewardShop 模块对外入口。
 *
 * 其他模块**只能**从这里 import 类型(`RewardShopPort` 等)与工厂。
 * 内部子模块(`./internal/*`)是私有的,禁止跨模块 import。
 */
export type {
  RewardShopPort,
  RewardRegistrationSpec,
  RewardApplyDeps,
} from "../../runtime/ports/RewardShopPort";
export type { RewardModuleDeps, RewardPortFactory } from "./RewardModule";
export { createRewardModule } from "./RewardModule";
