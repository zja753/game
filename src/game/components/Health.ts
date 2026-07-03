/**
 * `Health` 组件 —— 任何 Actor 都能挂的通用血量 / 无敌帧容器。
 *
 * 设计约定 (M0.1 锁定):
 * - 与具体业务 (玩家 / 敌人 / Boss) 解耦;消费方通过 `onDamage` / `onDeath` 事件订阅。
 * - 无敌帧只挡 `takeDamage`,不影响 `heal`。
 * - 时间单位统一为**秒**,内部 `update(elapsedMs)` 接受毫秒并内部除 1000。
 * - 事件总线选 Excalibur 的 `EventEmitter`,M0 阶段全里程碑统一使用同一种。
 *
 * 用法:
 *   const health = new Health({ maxHp: 100, invulnerableDuration: 0.4 });
 *   actor.addComponent(health);
 *   health.on('damage', ({ amount, hp }) => { ... });
 *   health.on('death', () => { ... });
 */
import { Actor, Component, EventEmitter } from "excalibur";

import { HEALTH_INVULNERABLE_DURATION_S } from "../balance";

/** `damage` 事件回调入参。 */
export interface HealthDamagePayload {
  /** 本次实际扣除的 HP。`invulnerableTimer > 0` 时为 0 且事件不会触发。 */
  amount: number;
  /** 扣血后剩余 HP。 */
  hp: number;
  /** 上限 HP,方便 UI 直接绘制比例。 */
  maxHp: number;
  /** 伤害来源,可选 (M0 仅作转发,M1+ 可能用来做"哪类敌人打的我")。 */
  source?: unknown;
}

/** 构造选项。除 `maxHp` 外均有默认值。 */
export interface HealthOptions {
  maxHp: number;
  /** 初始 HP,默认等于 `maxHp`。 */
  hp?: number;
  /** 受伤后进入无敌帧的时长(秒),默认读 `balance.ts`。 */
  invulnerableDuration?: number;
}

/** `Health` 自带事件名集合 —— 用 `as const` 收口避免拼写漂移。 */
export const HealthEvent = {
  Damage: "damage",
  Death: "death",
} as const;

/**
 * 通用血量组件。
 *
 * 实现要点:
 * - `takeDamage` 在 `invulnerableTimer > 0` 时**静默**返回 `false`,不触发 `damage` 事件。
 * - 成功扣血时把 `invulnerableTimer` 重置成 `invulnerableDuration`。
 * - `hp` 不会跌破 0;扣到 0 时只触发一次 `death`。
 * - `heal` 不能让 `hp` 超过 `maxHp`,且不会重置无敌帧。
 */
export class Health extends Component {
  /** 剩余 HP。 */
  public hp: number;
  /** 上限 HP。 */
  public readonly maxHp: number;
  /** 剩余无敌帧时长(秒)。 */
  public invulnerableTimer: number;
  /** 受伤后进入无敌帧的时长(秒)。 */
  public readonly invulnerableDuration: number;
  /** 是否已死亡 —— 一旦置 true 后续 `takeDamage` 仍返回 false,但不再重复发 death。 */
  public isDead: boolean = false;

  /** 事件总线,与 Excalibur 其它子系统保持一致 API (`on` / `off` / `emit`)。 */
  public readonly events: EventEmitter = new EventEmitter();

  constructor(options: HealthOptions) {
    super();
    this.maxHp = options.maxHp;
    this.hp = options.hp ?? options.maxHp;
    this.invulnerableDuration = options.invulnerableDuration ?? HEALTH_INVULNERABLE_DURATION_S;
    this.invulnerableTimer = 0;
  }

  /** 当前是否处于无敌帧。 */
  public isInvulnerable(): boolean {
    return this.invulnerableTimer > 0;
  }

  /**
   * 受伤。
   * @returns 是否实际扣血(被无敌帧挡掉或已死亡时为 `false`)。
   */
  public takeDamage(amount: number, opts?: { source?: unknown }): boolean {
    if (amount <= 0) return false;
    if (this.isDead) return false;
    if (this.invulnerableTimer > 0) return false;

    this.hp = Math.max(0, this.hp - amount);
    this.invulnerableTimer = this.invulnerableDuration;

    this.events.emit(HealthEvent.Damage, {
      amount,
      hp: this.hp,
      maxHp: this.maxHp,
      source: opts?.source,
    } satisfies HealthDamagePayload);

    if (this.hp <= 0) {
      this.isDead = true;
      this.events.emit(HealthEvent.Death);
    }
    return true;
  }

  /**
   * 治疗。超过 `maxHp` 自动截断;不会清除无敌帧。
   * @returns 实际恢复量。
   */
  public heal(amount: number): number {
    if (amount <= 0 || this.isDead) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - before;
  }

  /**
   * 推进计时器。`elapsedMs` 单位为毫秒(与 Excalibur 的 `onPreUpdate` 入参一致)。
   * 暴露成 public 是为了让 actor 在 `onPreUpdate` 中调用,也方便单测用假时钟驱动。
   */
  public update(elapsedMs: number): void {
    if (this.invulnerableTimer > 0) {
      this.invulnerableTimer = Math.max(0, this.invulnerableTimer - elapsedMs / 1000);
    }
  }

  /**
   * 订阅 `damage` 事件。返回取消订阅的函数,避免与 Excalibur 的 `Subscription` 模式耦合。
   */
  public onDamage(handler: (payload: HealthDamagePayload) => void): () => void {
    this.events.on(HealthEvent.Damage, handler);
    return () => this.events.off(HealthEvent.Damage, handler);
  }

  /** 订阅 `death` 事件。 */
  public onDeath(handler: () => void): () => void {
    this.events.on(HealthEvent.Death, handler);
    return () => this.events.off(HealthEvent.Death, handler);
  }

  /**
   * 挂到 actor 时自动把 `update(elapsedMs)` 接到 `onPreUpdate`。
   * 单测不挂 actor,因此不会触发这条路径。
   */
  public override onAdd(owner: Actor): void {
    owner.on("preupdate", ({ elapsed }) => this.update(elapsed));
  }
}
