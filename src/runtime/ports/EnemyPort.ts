/**
 * `EnemyPort` — Enemy 模块对外暴露的能力(见 plan/modules/enemy.md §2,本文件是 M4 阶段
 * 落地的**最小 stub**)。
 *
 * 背景:Combat 模块(M4)在 Enemy 模块(M5)**之前**落地,而 Combat 需要
 *  1. `list()` 选目标(TargetSelector 射程内最近)
 *  2. `applyDamage()` 写伤害(HitResolver onCollisionStart 时)
 *  3. 期望杀敌后收到"是否致死"反馈(决定 `isKill` / 触发 `enemy:killed` 事件)
 *
 * 因此本文件先按 M4 的最小需求落地三个方法 + 一份 `EnemySnapshot` 数据类型,
 * 完整 EnemyPort 在 M5 模块上线时再**扩**接口(不破坏 Combat 已经定下的形状)。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 其他模块**只**通过这个 interface 调用 Enemy 的能力。
 *  - 任何 `import { ... } from "@/modules/enemy/internal/..."` 都是破坏约束。
 */
import type { ActorId, Vec2 } from "../types";

/** 敌人种类(字符串字面量联合由 M5 Enemy 模块填;Combat 只读不解释)。 */
export type EnemyKind = string;

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
 * `DamageOutcome` — `applyDamage` 的返回结果。
 *
 * 用途:让 Combat 在一次 `onCollisionStart` 回调内**同步**拿到"这一发有没有
 * 把目标打死"——避免再去监听 `enemy:dying` 异步等结果(那样要管时序、
 * 多投射物打到同一人时的 race)。`isKill=true` 时 Combat 立刻发 `enemy:killed`。
 *
 * 后续 M5 可能扩展字段(`wasCrit / wasDodged` …),Combat 只读 `isKill` 即可。
 */
export interface DamageOutcome {
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
   * @returns `DamageOutcome` 描述本次结果;`isKill=true` 时 Combat 立刻发 `enemy:killed`。
   *
   * 错误 / 找不到 id:实现方走 no-op(返回 `hp: 0, isKill: false` 或类似约定;
   * 第一版固定返回 `{ isKill: false, hp: 0 }`)。
   */
  applyDamage(id: ActorId, amount: number, from?: unknown): DamageOutcome;
}
