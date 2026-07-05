/**
 * `ChaserBehavior` — "匀速朝玩家"行为(plan/modules/enemy.md §5 内部子模块 2)。
 *
 * 第一版:唯一行为。每个 tick 把"自己→玩家"的方向归一化,乘以 spec.speed,
 * 作为这一帧的目标速度返回。
 *
 * 关键设计点(plan §5):
 *  - **不**写 if/else 大链;新增行为 = 注册新策略。`ChaserBehavior` 是
 *    `BehaviorStrategy` 接口的一个具体实现,跟未来的 `DasherBehavior` /
 *    `ShooterBehavior` 平级。
 *  - 行为策略**只**返回 vel,**不**直接写 `EnemyActor` 状态。
 *  - 行为策略不持"目标"引用 —— 玩家位姿走 `BehaviorContext.player`,
 *    行为策略自己决定"目标选谁"("无玩家"返回 `{x:0, y:0}` 原地不动)。
 *
 * 边界:
 *  - 玩家不存在(`ctx.player == null`)→ 原地不动。
 *  - 自己跟玩家重合 → 原地不动(避免 `atan2(0,0)` 的 NaN)。
 *  - 速度按 `EnemySpec.speed` 走,行为策略**不**做"buff 加成"之类的
 *    改动(那是 EnemyActor / 后续 RewardShop 的事,行为策略保持纯函数)。
 */
import type { Vec2 } from "../../../runtime/types";
import type { BehaviorContext, BehaviorStrategy } from "./EnemyRegistry";

/**
 * 构造一个 `ChaserBehavior` 实例(单例 / 多例都行,内部无状态)。
 *
 * `id` 字段直接写死 `"chaser"`(与 `EnemySpec.behavior` 同源)。
 */
export function createChaserBehavior(): BehaviorStrategy {
  return {
    id: "chaser",
    tick(ctx: BehaviorContext): Vec2 {
      if (ctx.player === null) {
        return { x: 0, y: 0 };
      }
      const dx = ctx.player.pos.x - ctx.self.pos.x;
      const dy = ctx.player.pos.y - ctx.self.pos.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) {
        // 自己跟玩家重合(已经在接触距离):不移动,让 ContactDamage 处理扣血。
        return { x: 0, y: 0 };
      }
      // 注:这里**不**读 `ctx.self.hp` / `ctx.player.id` — 行为策略只关心位姿。
      // Chaser 速度由 EnemyActor 在装配时根据 `EnemySpec.speed` 注入到 ctx 外部,
      // 此处直接归一化方向 → 用 magnitude = 1,真正速度在 `EnemyActor` 那一层
      // 用 magnitude × spec.speed 算出来。
      // (本行为策略不直接读 spec,保持纯函数:它只决定"方向",不决定"快慢"。)
      void ctx.dt;
      void ctx.now;
      return { x: dx / len, y: dy / len };
    },
  };
}
