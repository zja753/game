/**
 * `HealthController` — 玩家血量状态机(plan/modules/player.md §5)。
 *
 * 职责:
 *  1. 持有 `hp` / `maxHp` / `invulnerableTimer`(毫秒)。
 *  2. 暴露 `applyDamage` / `applyHeal` / `isDead` 给 `PlayerActor` 调用。
 *  3. 维护"接触敌人 Set"(`inContactEnemies`)做接触伤害节流:同一个 enemy
 *     在重叠期间只算一次扣血;`collisionend` 时再删。
 *  4. 每帧被 `PlayerActor.onPreUpdate` 调一次 `tick(dt)`,推进无敌帧计时。
 *  5. 死亡时通过 `onDeath` 钩子通知 `PlayerActor`(让它把 actor 隐藏 + vel=0)。
 *
 * 关键不变量(plan §6 验收点):
 *  - 受伤 3 次(10/10/10)只有 2 次实际扣血:无敌帧 `0.4s` 节流。
 *  - 死亡时 `isDead()` 一次 `true` 后**不**会变回 `false`;`reset()` 才会复位。
 *  - 接触伤害节流:同 enemy 重叠期间只扣一次。
 *
 * 设计原则:
 *  - **不**持有 Excalibur 任何对象;纯数据 + 钩子,单测能完全脱离引擎跑。
 *  - 死亡钩子用回调(`onDeath`)而不是 EventBus 直接 emit —— EventBus
 *    发事件由 `PlayerModule` 统一编排,避免 HealthController 直接耦合
 *    事件总线的事件 payload 形状(便于改字段时只动一处)。
 */
import type { BuffSpec, DamageSource } from "../../../runtime/ports/PlayerPort";

/** 默认 HP 上限(模块内常量,后续可被 `addBuff({ modifiers: { maxHp: +n } })` 改)。 */
export const DEFAULT_PLAYER_MAX_HP = 100;

/** 无敌帧时长,毫秒(plan §7 验收点 = `0.4s`)。 */
export const INVULNERABLE_DURATION_MS = 400;

/** `HealthController` 的外部依赖(钩子 + 时间源)。 */
export interface HealthControllerDeps {
  /** 当前逻辑时间,毫秒;`PlayerActor` 转发 `RuntimePort.now()`。 */
  now: () => number;
  /** 死亡触发时调(仅在 `hp` 从 >0 → 0 这一拍调一次)。 */
  onDeath: (at: number) => void;
  /** 受伤触发时调(仅在实际扣血后调,无敌帧 / 已死亡 / 收到 0 伤害时**不**调)。 */
  onDamage: (hp: number, maxHp: number, from: unknown) => void;
  /**
   * buff 注册时调(`addBuff` 入口),便于 `PlayerActor` 把它广播到 `player:moved` 之外
   * 的内部钩子上(目前为空操作,留给后续 RewardShop 联调用)。
   * 不存在时为 no-op。
   */
  onBuffAdded?: (buff: BuffSpec) => void;
}

export class HealthController {
  private hp: number = DEFAULT_PLAYER_MAX_HP;
  private readonly maxHp: number = DEFAULT_PLAYER_MAX_HP;
  /**
   * 剩余无敌帧时间,毫秒;`<= 0` 表示可以再受伤。
   * 用"剩余时间"而不是"上次受伤时刻"——`reset` / `pause` 时可以方便地
   * 直接归零,而不用算时间差。
   */
  private invulnerableTimer: number = 0;

  /**
   * 接触敌人 Set,做"同 enemy 重叠只扣一次"的节流(plan §7)。
   * `key` 是 enemy 的 `ActorId`(EnemyPort 那边给);`number` 即 Excalibur
   * `Actor.id` 数字,本模块不直接 import Excalibur,只把 `unknown` 收进来。
   *
   * 当前接口用 `unknown` 是因为 Enemy 模块**未落地**;EnemyPort 落地后
   * 这里改成 `Set<ActorId>`(由 Port 类型收口)。
   */
  private inContactEnemies: Set<number> = new Set();

  /** `true` 一旦进入死亡;`reset()` 之前**不**变回 `false`。 */
  private dead: boolean = false;

  private readonly deps: HealthControllerDeps;

  constructor(deps: HealthControllerDeps) {
    this.deps = deps;
  }

  // ---- 查询 ----

  hpValue(): number {
    return this.hp;
  }

  maxHpValue(): number {
    return this.maxHp;
  }

  isDead(): boolean {
    return this.dead;
  }

  /** 当前无敌帧剩余时长(毫秒);0 = 可受伤。 */
  invulnerableRemaining(): number {
    return this.invulnerableTimer;
  }

  /** 当前接触敌人数量(供测试断言)。 */
  inContactCount(): number {
    return this.inContactEnemies.size;
  }

  // ---- 写入 ----

  /**
   * 扣血。
   * - 已死亡 → 直接返回 `false`。
   * - 仍在无敌帧 → 直接返回 `false`(**不**重置计时器)。
   * - `amount <= 0` → 返回 `false`。
   * - 实际扣血后:hp = max(0, hp - amount),无敌帧重置为 `INVULNERABLE_DURATION_MS`。
   *   hp 归 0 时:置 `dead = true` + 调 `onDeath(now())`。
   *   否则:调 `onDamage(newHp, maxHp, from)`。
   *
   * @returns `true` 当且仅当本次实际扣了血。
   */
  applyDamage(amount: number, from?: DamageSource): boolean {
    if (this.dead) return false;
    if (amount <= 0) return false;
    if (this.invulnerableTimer > 0) return false;

    const newHp = Math.max(0, this.hp - amount);
    this.hp = newHp;
    // 扣血成功,进入无敌帧(防止高频伤害一次扣到 0)。
    this.invulnerableTimer = INVULNERABLE_DURATION_MS;

    if (newHp === 0) {
      this.dead = true;
      // 死亡算"最后一次扣血"——onDamage 在 onDeath 前发,这样 HUD 看到
      // hp=0 的瞬间立刻能感知到死亡,避免错过。
      this.deps.onDamage(newHp, this.maxHp, from);
      this.deps.onDeath(this.deps.now());
      return true;
    }

    this.deps.onDamage(newHp, this.maxHp, from);
    return true;
  }

  /**
   * 加血。`amount <= 0` 时 no-op。**不**超过 `maxHp`。
   * 死亡后仍然允许加血(`PlayerPort.reset()` 是更彻底的复位入口);
   * 但本模块的契约里**不**鼓励,这里保持语义对称。
   */
  applyHeal(amount: number): void {
    if (amount <= 0) return;
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  /**
   * 注册 buff。同 `id` 的 buff 累加 `stacks`;不存在则新建。
   * 第一版**不**做移除 / 过期;后续按需扩展。
   *
   * 当前实现:不维护 buff 表(等 M6 RewardShop 落地再加);只把 spec 透传给
   * `onBuffAdded` 钩子,让装配层自行解释。`PlayerPort` 的"权威 buffs 列表"
   * 这条线等 M6 拉起来再补;**不**在本模块里埋 forward-compat 的空 Map。
   */
  addBuff(buff: BuffSpec): void {
    this.deps.onBuffAdded?.(buff);
  }

  // ---- 帧驱动 / 接触节流 ----

  /**
   * 帧驱动:`PlayerActor.onPreUpdate` 每帧调一次。
   * 推进无敌帧计时(毫秒)。
   */
  tick(_dt: number): void {
    if (this.invulnerableTimer > 0) {
      this.invulnerableTimer = Math.max(0, this.invulnerableTimer - _dt);
    }
  }

  /**
   * 进入接触。Enemy 在 `collisionstart` 时调。
   *
   * @returns `true` 当且仅当本次"新进入"且成功触发了一次扣血
   *          (节流:已在 Set 里的 enemy 不会重复扣)。
   */
  beginContact(enemyId: number, dmg: number): boolean {
    if (this.inContactEnemies.has(enemyId)) return false;
    this.inContactEnemies.add(enemyId);
    if (dmg <= 0) return false;
    return this.applyDamage(dmg, { kind: "contact", enemyId });
  }

  /**
   * 离开接触。Enemy 在 `collisionend` 时调,把对应 id 从 Set 删掉。
   * 找不到 id 时是 no-op(容错:玩家"快进穿出"边界可能出边沿事件丢失)。
   */
  endContact(enemyId: number): void {
    this.inContactEnemies.delete(enemyId);
  }

  /**
   * 重置(plan §2 `PlayerPort.reset`):
   *  - HP 满血。
   *  - 死亡标志清掉。
   *  - 无敌帧清零。
   *  - 接触敌人 Set 清空。
   *  - **不**重置 maxHp(本模块首版把 maxHp 当常量,后续 buff 系统来再加 `setMaxHp`)。
   */
  reset(): void {
    this.hp = this.maxHp;
    this.dead = false;
    this.invulnerableTimer = 0;
    this.inContactEnemies.clear();
  }
}
