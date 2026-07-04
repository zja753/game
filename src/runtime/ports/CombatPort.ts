/**
 * `CombatPort` — Combat 模块对外暴露的能力(见 plan/modules/combat.md §2)。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 其他模块**只**通过这个 interface 调用 Combat 的能力。
 *  - 任何 `import { ... } from "@/modules/combat/internal/..."` 都是破坏约束。
 *  - Combat 模块**目前未落地**,本文件先提供"接口最小集"(Player
 *    落地时所需的 `tryFire`),后续 Combat 落地时再往里加方法即可。
 *
 * 设计原则:
 *  - 接口**不**出现其他模块的类型名;武器 / 投射物 ID 用 `string` 描述。
 *  - `tryFire` 是"尝试开火"语义,内部会读 PlayerPort 的 pos / facing 算弹道,
 *    扣弹药 / 检查冷却 / 调 Runtime 造投射物都是 Combat 自己的事;
 *    Player 只负责表达"玩家想开火"的意图。
 *
 * M4 Module-Combat 落地时(plan §2),接口扩到完整形态:
 *  - `tryFire(now, ownerId, origin)` 三参版本:由 Player 主动传"开火时间
 *    + 玩家 ActorId + 弹道起点"(规避 Combat 反向 import PlayerPort)。
 *  - `swapWeapon / currentWeapon / listWeapons` 武器管理三件套。
 *  - `damageDealt() / kills()` 累计统计,HUD 读取。
 *  - `FireResult` 用 `unknown` 包纯数据,避免类型在模块间泄露。
 */
import type { ActorId, Vec2, WeaponId } from "../types";

/**
 * `tryFire` 的返回 payload(纯数据,详见 plan §2 注释)。
 *
 * 设计:`unknown` 让 Combat 在不破坏解耦的前提下向调用方回报本次开火结果;
 * 实际形状由 Combat 模块**自己**导出类型 + 用 `satisfies` 标注实现,
 * 其他模块若需要 narrow 自己声明 `import type { FireResult } from "@/modules/combat"`,
 * 或者直接 `as` cast(`tryFire` 的字段集第一版固定,后续扩展走接口)。
 */
export type FireResult = unknown;

export interface CombatPort {
  /**
   * 玩家按 fire 的瞬间调一次。
   *
   * @param now 逻辑时间(毫秒),走 `RuntimePort.now()`;由调用方传入,避免 Combat
   *            反向 import RuntimePort 拿时间。
   * @param ownerId 开火方的 ActorId(玩家);Combat 把它绑在投射物上供 `onCollisionStart`
   *                后续判断"这是谁的弹"(首版只给玩家用,留字段给未来 AI 开火复用)。
   * @param origin 弹道起点(世界坐标);由 Player 算好传入(已经在 `player:moved`
   *               事件里持续广播),Combat **不**反向 import PlayerPort。
   * @returns 本次开火结果。`true` / 详细 FireResult 由实现方决定 —— 调用方
   *          拿到的总是非空 pure data。
   */
  tryFire(now: number, ownerId: ActorId, origin: Vec2): FireResult;

  /**
   * 把当前武器切到 `id`(RewardShop 颁发新武器时调用)。
   * 未知 `id` 走 no-op + 打 console.warn。
   */
  swapWeapon(id: WeaponId): void;

  /** 当前持有的武器 ID。初始是 `WeaponRegistry` 的第一把。 */
  currentWeapon(): WeaponId;

  /** 本局累计造成的伤害值(HUD 读;Combat 自己记账)。 */
  damageDealt(): number;

  /** 本局累计击杀数(HUD 读;Combat 自己记账)。 */
  kills(): number;

  /** 已注册的全部武器 ID(只读,供 HUD 渲染武器栏)。 */
  listWeapons(): readonly WeaponId[];
}
