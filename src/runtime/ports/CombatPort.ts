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
 */
export interface CombatPort {
  /**
   * 玩家按 fire 的瞬间调一次。
   * 实现方负责:
   *  - 检查冷却(若还在冷却,no-op 返回 `false`)。
   *  - 读取 PlayerPort.pos / facing 算弹道起点(CombatPort 不持 PlayerPort;
   *    由 Combat 模块在装配阶段注入)。
   *  - 调 Runtime.spawnActor 造投射物。
   *
   * @returns `true` 当且仅当本次真的开火了(冷却好了且能 spawn)。
   */
  tryFire(): boolean;
}
