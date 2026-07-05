/**
 * `ContactDamage` — 敌人与玩家接触时的扣血节流(plan/modules/enemy.md §5 内部子模块 4)。
 *
 * 职责:
 *  - 接收"敌人 id + 玩家 id"两个 ActorId,在 `onContactStart` 时调一次
 *    `PlayerPort.applyDamage(enemySpec.contactDamage)` 扣血。
 *  - 接触期间**每帧**的 `onContactStay` 不会再扣血 —— 由 `lastHitAt` /
 *    `hitCooldownMs` 节流。
 *  - 玩家离开接触时清掉内部状态(避免悬挂)。
 *
 * 关键不变量(plan §7 验收点):
 *  - 同 enemyId 与玩家重叠的连续多帧里只扣一次血。
 *  - "离开接触 + 重新接触"才会再扣一次(只要跨过 `hitCooldownMs`)。
 *  - `endContact` 对未注册的 enemyId 是 no-op(容错)。
 *
 * 与 Player 模块的分工:
 *  - Player 模块的 `HealthController` 也有自己的一套"同 enemyId 接触只扣一次"
 *    节流(`inContactEnemies` Set),**那是**基于"Excalibur collisionstart/end"
 *    触发的边沿事件。
 *  - 本模块的 `lastHitAt` 节流走"敌人侧" —— 即使 Player 模块的 contact 节流
 *    失效(边沿事件漏触发,excalibur 已知问题),敌人这一侧也会"自重":
 *    每隔 `hitCooldownMs` 才允许再扣一次,作为**双重保险**。
 *  - 实际生产:两个节流并存;先到先得,谁先到 `applyDamage` 谁就扣血。
 */
import type { ActorId } from "../../../runtime/types";
import type { PlayerPort } from "../../../runtime/ports/PlayerPort";

/** 默认"两次接触伤害之间的最小间隔"(毫秒)。土豆兄弟原版手感约 500ms。 */
export const DEFAULT_HIT_COOLDOWN_MS = 500;

/** `ContactDamage` 的最小依赖 —— 由 EnemyModule 在装配时注入。 */
export interface ContactDamageDeps {
  /** 玩家扣血入口(走 `PlayerPort`)。 */
  player: PlayerPort;
  /**
   * 每次扣血之间的最小间隔(毫秒)。不传走 `DEFAULT_HIT_COOLDOWN_MS`。
   * 调小 = 敌人更"刺",调大 = 更"钝";后续可被敌人 spec 覆盖(M6+)。
   */
  hitCooldownMs?: number;
  /**
   * 当前逻辑时间(毫秒)。由 EnemyModule 注入 `runtime.now()`。
   */
  now: () => number;
}

/** 一次接触伤害的"上下文" —— `EnemyActor` 在碰撞回调里调时传入。 */
export interface ContactHitContext {
  /** 发起接触伤害的敌人 id(本敌人)。 */
  enemyId: ActorId;
  /** 该敌人 spec 的 contactDamage 字段(由 EnemyActor 拉来,避免再问 EnemyModule)。 */
  damage: number;
}

/** `ContactDamage` 状态。 */
interface ContactState {
  /** 上一次对玩家造成伤害的时间戳(毫秒)。0 表示从未造成过。 */
  lastHitAt: number;
}

/**
 * `ContactDamage` 句柄 —— `EnemyModule` 装配时 new 一个,每个 `EnemyActor`
 * 在 `onCollisionStart` 时调 `tryHit`。
 */
export interface ContactDamageHandle {
  /**
   * 敌人"接触开始"时调一次:立即尝试扣一次血,然后开始节流。
   * 返回 `true` 当且仅当这次**真的**扣了血。
   */
  onContactStart(ctx: ContactHitContext): boolean;
  /**
   * 敌人"接触中"每帧调:如果距离上次扣血已过 `hitCooldownMs`,再扣一次。
   * 返回 `true` 当且仅当这次**真的**扣了血。
   */
  onContactStay(ctx: ContactHitContext): boolean;
  /**
   * 敌人"接触结束"时调:清掉内部节流状态,下次 begin 重新立即扣血。
   * 未知 enemyId 是 no-op(容错)。
   */
  onContactEnd(enemyId: ActorId): void;
  /** 重置所有内部状态(测试 / 关卡重开)。 */
  reset(): void;
}

/**
 * 创建 `ContactDamage` 实例。
 */
export function createContactDamage(deps: ContactDamageDeps): ContactDamageHandle {
  const cooldown = deps.hitCooldownMs ?? DEFAULT_HIT_COOLDOWN_MS;
  const now = deps.now;
  const states = new Map<ActorId, ContactState>();

  function tryHit(ctx: ContactHitContext): boolean {
    const at = now();
    const st = states.get(ctx.enemyId);
    if (st !== undefined && at - st.lastHitAt < cooldown) {
      // 节流中:不扣血,也不更新 lastHitAt(避免把节流时间推到更远)。
      return false;
    }
    if (ctx.damage <= 0) {
      // damage <= 0 视作"该敌人不会主动接触伤害";登记状态但**不**调
      // applyDamage,避免 0 伤害事件风暴(HealthController 也会 no-op,
      // 但跳过 PlayerPort 这一层更省)。
      states.set(ctx.enemyId, { lastHitAt: at });
      return false;
    }
    // 真的扣一次血。注意 PlayerPort.applyDamage 在无敌帧内是 no-op;
    // 但本模块**不**关心结果(玩家侧的扣血节流由 HealthController 负责)。
    deps.player.applyDamage(ctx.damage, { kind: "contact", enemyId: ctx.enemyId });
    states.set(ctx.enemyId, { lastHitAt: at });
    return true;
  }

  const handle: ContactDamageHandle = {
    onContactStart(ctx) {
      return tryHit(ctx);
    },
    onContactStay(ctx) {
      return tryHit(ctx);
    },
    onContactEnd(enemyId) {
      states.delete(enemyId);
    },
    reset() {
      states.clear();
    },
  };

  return handle;
}
