/**
 * `PlayerPort` — Player 模块对外暴露的能力(见 plan/modules/player.md §2)。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 其他模块**只**通过这个 interface 调用 Player 的能力。
 *  - 任何 `import { ... } from "@/modules/player/internal/..."` 都是破坏约束。
 *  - Player 模块自身也**不**直接被 import,根容器在装配时把它作为
 *    `PlayerPort` 注入到 Combat / Enemy / Camera / HudUi 等模块。
 */
import type { ActorId, Vec2 } from "../types";

/**
 * `BuffSpec` — 被动叠加的 buff 描述(M6+ 用,见 plan/modules/player.md §2)。
 *
 * 当前第一版**不**消费 `stacks` / `modifiers` 的具体字段,只把 spec
 * 存进权威表。后续 RewardShop 注册的回调可以从 `modifiers` 读出
 * "攻击 +10% / 移速 +5%"之类的修改量。本模块对外**不**导出具体
 * modifier 形状(只暴露 `unknown`),由后续模块按需定义。
 */
export interface BuffSpec {
  /** 唯一 id(由 RewardShop 颁发,`PlayerPort.addBuff` 不做查重)。 */
  id: string;
  /** 调试用标签,渲染层 / 日志可读。 */
  label: string;
  /** 显示层图标 URL / emoji,可选。 */
  icon?: string;
  /**
   * 自由形态的"修改量"载荷。第一版 Player 模块**只**把它挂到权威表上,
   * 业务模块读这个 spec 自行解释;不破坏 Player ↔ RewardShop 的解耦。
   */
  modifiers?: unknown;
  /** 叠加层数;`undefined` 视为 1。 */
  stacks?: number;
}

/**
 * `DamageSource` — 伤害来源的占位类型。
 *
 * 设计原则:PlayerPort**不**关心谁打过来;它只是接收一个 `unknown`
 * payload(由调用方决定是 enemy id、projectile id 还是 effect 字符串),
 * 在 `player:damaged` 事件中**不**传播原始引用,只透传"是谁"。
 * 当前实现用 `unknown` 是为了避免类型在模块间泄露;后续如果要
 * 写日志 / 触发反击,可以再 narrow。
 */
export type DamageSource = unknown;

/**
 * `PlayerPort`:Player 模块对外暴露的能力。
 *
 * 设计要点:
 *  - `pos() / setPos()` 是位置权威读写入口。Combat 用 `pos()` 算弹道起点,
 *    Enemy / Camera 用它做接触伤害 / 跟随。
 *  - `applyDamage()` 返回 `true` 表示"实际扣了血"(无敌帧 / 已死亡时为 `false`),
 *    让调用方可以快速判断"这次伤害是否生效",不用额外再读 `isDead()`。
 *  - `applyHeal()` **不**超过 `maxHp()`(封顶处理在本模块内做)。
 *  - `addBuff()` 是被动叠加接口,本模块只记账,具体效果由消费方读 `modifiers`。
 *  - `reset()` 把 HP / 位置 / 无敌帧 / 接触敌人集合 / buffs 全部回初值
 *    (重开 / 切关时调用)。
 */
export interface PlayerPort {
  /**
   * 玩家 ActorId(由根容器在 spawn 后通过 `PlayerModule` 暴露的 `__setId`
   * 注入;Combat 用来作 `tryFire` 的 `ownerId`)。
   *
   * 注入前返回 `0`(占位);真实装配时必须在 `runtime.spawnActor` 拿到
   * 玩家 id 后立刻调一次 `__setId(id)`。
   */
  id(): ActorId;
  /** 当前世界坐标(像素)。 */
  pos(): Vec2;
  /**
   * 设置玩家位置。**不**做越界 / 撞墙检查,调用方负责合法位置
   * (典型用途:初始 spawn / 传送门后定位)。
   */
  setPos(v: Vec2): void;

  /** 当前 HP,`[0, maxHp()]`。 */
  hp(): number;
  /** HP 上限。`applyHeal` 用此封顶。 */
  maxHp(): number;

  /**
   * 扣血。
   * @param amount 伤害值,**不**能为负(负值会被 `applyHeal` 接收)。
   * @param from 伤害来源(谁打的)。仅在 `player:damaged` 事件里原样转发,
   *             本模块**不**解释这个字段。
   * @returns `true` 当且仅当本次实际扣了血(未在无敌帧 / 未死 / 收到正伤害)。
   */
  applyDamage(amount: number, from?: DamageSource): boolean;

  /**
   * 加血;**不**超过 `maxHp()`。`amount <= 0` 是 no-op。
   */
  applyHeal(amount: number): void;

  /**
   * 注册一个 buff 到权威表。同 `id` 的 buff 累加 `stacks`(默认 +1);
   * 不存在的 `id` 直接新增条目。**不**做移除 / 过期——后续按需加。
   */
  addBuff(buff: BuffSpec): void;

  /** 玩家是否已死亡(`hp() <= 0`)。 */
  isDead(): boolean;

  /**
   * 把玩家状态回初值:HP 满血、位置 = `{x:0, y:0}`、无敌帧 / 接触敌人集合清空、
   * buffs 清空。重开 / 切关时调用一次。
   */
  reset(): void;
}
