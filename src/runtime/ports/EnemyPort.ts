/**
 * `EnemyPort` — Enemy 模块对外暴露的能力(见 plan/modules/enemy.md §2)。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 其他模块**只**通过这个 interface 调用 Enemy 的能力。
 *  - 任何 `import { ... } from "@/modules/enemy/internal/..."` 都是破坏约束。
 *  - `EnemyKind` 在 `runtime/types.ts` 集中定义(协议层),Combat / HUD / Progression 共享。
 *
 * 落地历史:
 *  - M4 阶段(plan 进度表)先按 Combat 的最小需求落地 `list` / `applyDamage`;
 *  - M5 Enemy 模块上线时**扩**到 `spawn` / `count` / `clear`,不破坏 Combat 已经定下的形状。
 *  - `DamageResult` 是 Combat 在
 *    `onCollisionStart` 同步拿"是否致死"的口子,避免监听 `enemy:dying` 的异步 race。
 *
 * 设计原则:
 *  - 接口**不**出现其他模块的类型名(plan §2.3);`EnemyKind` 是 `string` 字面量联合。
 *  - 事件 payload 不放 Actor 引用(roadmap §0.1),`EnemySnapshot` 是纯数据。
 */
import type { ActorId, EnemyKind, Vec2 } from "../types";

// 协议层共享 EnemyKind 在 runtime/types.ts,EnemyPort 重新 export 供调用方
// 一行 import:从 `runtime/ports/EnemyPort` 同时拿到 EnemyPort / EnemyKind / EnemySnapshot / DamageResult。
// eslint-disable-next-line @typescript-eslint/no-redeclare
export type { EnemyKind } from "../types";

/**
 * `EnemySnapshot` — 敌人只读快照,Combat 通过 `list()` 拿这种对象做选目标决策。
 *
 * 设计原则:
 *  - **不**含任何 Actor 引用 —— 纯数据,符合"事件 payload 不放 Actor 引用"的同款原则。
 *  - 包含 Combat 选目标 + 写伤害需要的全部字段;若 Combat 后续需要再读
 *    (比如 `armor` 减伤)在这里扩字段。
 */
export interface EnemySnapshot {
  /** 敌人 ActorId(Combat 把它传给 `applyDamage` 的第一个参数)。 */
  id: ActorId;
  /** 敌人种类(Combat 不解释,直接透传到 `projectile:hit.targetKind`)。 */
  kind: EnemyKind;
  /** 敌人世界坐标(像素)。 */
  pos: Vec2;
  /** 敌人剩余 HP(Combat 不读,只透传;留作未来 modifier 链使用)。 */
  hp: number;
  /** 敌人 HP 上限。 */
  maxHp: number;
}

/**
 * `DamageResult` — `applyDamage` 的返回结果。
 *
 * 用途:让 Combat 在一次 `onCollisionStart` 回调内**同步**拿到"这一发有没有
 * 把目标打死"——避免再去监听 `enemy:dying` 异步等结果(那样要管时序、
 * 多投射物打到同一人时的 race)。`isKill=true` 时 Combat 立刻发 `enemy:killed`。
 *
 * 后续 M5 可能扩展字段(`wasCrit / wasDodged` …),Combat 只读 `isKill` 即可。
 */
export interface DamageResult {
  /** 本次是否造成击杀(Hp 归零的那一刻)。 */
  isKill: boolean;
  /** 实际扣血后剩余 HP(可能因为无敌帧 / 已死 = 0 时没扣,值不变)。 */
  hp: number;
}

export interface EnemyPort {
  /**
   * 当前场上所有敌人的只读快照列表(Combat 用来选目标)。
   *
   * 返回 `readonly EnemySnapshot[]` 而不是 `Map` / `Set`:
   *  - Combat 内部会做距离过滤(linear scan),数组成本低。
   *  - 调用方拿到的数组是"窗口"而不是"副本",实现方可以每次调用现算。
   */
  list(): readonly EnemySnapshot[];

  /**
   * 对敌人 `id` 扣 `amount` 伤害(Combat 在投射物碰撞时调用)。
   *
   * @param id 目标 ActorId。
   * @param amount 正数伤害值;`<= 0` 由实现方自行决定 no-op 还是 clamp。
   * @param from 伤害来源(投射物 id 或其他 payload),Enemy 不解释,原样透传到
   *             `enemy:damaged` 事件给 HUD / Progression 看。
   * @returns `DamageResult` 描述本次结果;`isKill=true` 时 Combat 立刻发 `enemy:killed`。
   *
   * 错误 / 找不到 id:实现方走 no-op(返回 `hp: 0, isKill: false` 或类似约定;
   * 第一版固定返回 `{ isKill: false, hp: 0 }`)。
   */
  applyDamage(id: ActorId, amount: number, from?: unknown): DamageResult;

  /**
   * 在 `pos` 生成一个 `kind` 敌人,返回新 ActorId(Progression 调,enemy.md §2)。
   *
   * 实现方负责:通过 `RuntimePort.spawnActor` 造 Actor,登记到内部句柄表,
   * 广播 `enemy:spawned` 事件。**不**做合法性校验(kind 必须在
   * `EnemyRegistry` 注册过;`pos` 必须在地图内且不被墙挡)——这些由
   * Progression 调 `currentLevelConfig().allowedKinds` / `MapObstacle.isBlocked`
   * 自检,Enemy 模块只接受"已经合法"的入参。
   *
   * 未知 `kind` / 不合法 `pos` → 实现方自行决定 no-op + console.warn,
   * 返回 `0`(占位 id;调用方应忽略返回的 id 是否 > 0)。
   */
  spawn(kind: EnemyKind, pos: Vec2): ActorId;

  /**
   * 当前场上敌人数量(HUD 击杀计数 / "剩余敌人数"提示)。
   * 线性扫 `list().length` 成本低;实现方也可以内部缓存。
   */
  count(): number;

  /**
   * 清空所有敌人(切关 / 玩家死亡时 Progression 调,enemy.md §2 / progression.md §7)。
   *
   * 实现方负责:`despawnActor` 每个敌人,清空内部句柄表。
   * 是否广播 `enemy:spawned` 清除事件 / 是否发 `enemy:dying` —— 由实现方决定;
   * 协议层不强制。
   */
  clear(): void;
}
