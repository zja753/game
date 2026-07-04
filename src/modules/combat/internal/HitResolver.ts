/**
 * `HitResolver` — 命中伤害判定(plan/modules/combat.md §5 内部子模块 3)。
 *
 * 职责:在 `ProjectileActor.onCollisionStart` 触发的瞬间,接收
 *  `(projectilePos, otherId, damage)` 三参,做以下事情:
 *    1. 把 `otherId` 当成"敌人"调 `EnemyPort.applyDamage` 扣血。
 *    2. 拿 `DamageOutcome.isKill` 决定要不要发 `enemy:killed` 事件。
 *    3. 始终发 `projectile:hit` 事件(HUD 命中飘字)。
 *
 * 第一版公式(M0 简单版,plan §5):
 *  - 伤害 = 武器 `damage` 字段,**不**做暴击 / 防御 / modifier 链。
 *  - 致死判定 = `EnemyPort.applyDamage(...).isKill`(由 Enemy 模块裁决)。
 *  - `xp` 字段(M5 Enemy 模块没落地前)默认 0;后续 M5 在 `enemy:killed`
 *    事件里通过 `EnemyPort` 扩展 XP 来源时,这里通过额外 payload 解决。
 *
 * 设计原则:
 *  - 纯函数化,无状态,不依赖 Excalibur。
 *  - 唯一外部依赖是 `EnemyPort` + `GameEventBus`,通过参数注入。
 *  - **不**做冷却 / 装填(那是 `tryFire` 路径的事,HitResolver 只管"打到了之后")。
 */
import type { ActorId, Vec2 } from "../../../runtime/types";
import type { EnemyPort } from "../../../runtime/ports/EnemyPort";
import type { GameEventBus } from "../../../runtime/EventBus";

/** `HitResolver` 构造配置。 */
export interface HitResolverDeps {
  /** Enemy 模块的只读 + 写伤害入口。 */
  enemies: EnemyPort;
  /** 事件总线,发出 `projectile:hit` / `enemy:killed`。 */
  bus: GameEventBus;
  /**
   * 把 Excalibur `Actor.id` 翻译成"敌人"判定用 id 的查找。
   * Combat **不**知道敌人 Actor 的内部结构 —— 这个 lookup 委托给调用方
   * 决定"这个 id 算不算敌人"(plan §7 "Combat 不知道也不关心 Enemy 内部实现")。
   *
   * 返回 `true` 当且仅当 `id` 是一颗投射物应当造成伤害的目标。
   * 默认实现:任何 id 都算目标(兼容性兜底;真实装配时 Enemy 模块的
   * collision layer 已经过滤了非敌人,这里只是双重保险)。
   */
  isEnemy?: (id: ActorId) => boolean;
}

/** 一次命中解析的结果(纯数据,给上层做日志 / 统计用)。 */
export interface HitResolution {
  /** 是否真的造成了扣血(过滤掉"撞墙"等非敌人碰撞)。 */
  didDamage: boolean;
  /** 伤害值(若 `didDamage=false` 为 0)。 */
  damage: number;
  /** 本次是否击杀。 */
  isKill: boolean;
  /** 被命中的目标 id。 */
  targetId: ActorId;
  /** 命中世界坐标。 */
  pos: Vec2;
}

/**
 * 处理"投射物命中目标"事件。
 *
 * @param resolver 已注入依赖的 resolver(由 CombatModule 在装配阶段创建)。
 * @param args `projectilePos` = 投射物命中瞬间的世界坐标(用作 `projectile:hit.x/y`);
 *              `otherId` = 撞到的 Actor id(由 Excalibur `onCollisionStart` 给出);
 *              `damage` = 本次伤害值(由 `WeaponSpec.damage` 提供);
 *              `targetKindHint` = 目标种类(由调用方在选目标时记下,直接透传,
 *                                避免 HitResolver 现场再 `EnemyPort.list()` 查)。
 * @returns 解析结果。
 */
export function resolveHit(
  resolver: HitResolverDeps,
  args: { projectilePos: Vec2; otherId: ActorId; damage: number; targetKindHint?: string },
): HitResolution {
  const { projectilePos, otherId, damage } = args;
  const isEnemy = resolver.isEnemy ?? ((): boolean => true);
  if (!isEnemy(otherId)) {
    // 撞到墙 / 队友等"非敌人"目标:不发任何事件,不消耗伤害。
    return { didDamage: false, damage: 0, isKill: false, targetId: otherId, pos: projectilePos };
  }

  const outcome = resolver.enemies.applyDamage(otherId, damage, {
    kind: "projectile",
    source: "combat",
  });

  resolver.bus.emit({
    type: "projectile:hit",
    x: projectilePos.x,
    y: projectilePos.y,
    targetKind: args.targetKindHint ?? "unknown",
    damage,
    isKill: outcome.isKill,
  });

  if (outcome.isKill) {
    resolver.bus.emit({
      type: "enemy:killed",
      kind: args.targetKindHint ?? "unknown",
      x: projectilePos.x,
      y: projectilePos.y,
      // 第一版 xp 暂为 0(M5 Enemy 模块落地后 EnemyPort 会暴露 kind→xp 映射,
      // HitResolver 拿额外查询填这里;先埋字段占位)。
      xp: 0,
    });
  }

  return {
    didDamage: true,
    damage,
    isKill: outcome.isKill,
    targetId: otherId,
    pos: projectilePos,
  };
}
