/**
 * 单发 Pistol 武器 (M0.4)。
 *
 * 设计:
 * - 持有 `range / fireRate / damage`,`tryFire` 是**唯一**的开火入口。
 * - **找不到目标** → `return false`,不发弹、**不**推进节流窗口
 *   (验证清单要求"打不到不消耗",玩家松开能立即再按)。
 * - **找到目标** → 在 scene 内添加一颗 `Projectile`,把节流窗口推到 `now + 1/fireRate`。
 * - 节流:内部 `nextFireAtMs`;首次开火时为 0,因此玩家进游戏按第一下就能打。
 * - 时间源:由调用方传 `now`(`Engine.clock.now()`),Weapon 本身不读引擎,
 *   方便 M0 单测和未来替换测试时钟。
 *
 * 选型说明 (M0.4 任务文档要求"在文件头注释里注明"):
 * - 用 `scene.actors` 直接遍历 + 距离平方比较,不做空间索引。
 *   M0 敌人数量级 (≤ ENEMY_MAX_COUNT=60) 完全够用;M3 多了再上 quadtree。
 * - 友军判定交给 `Projectile` 自身,Weapon 只负责"是否有合法目标"和"开火"两件事。
 */
import { Actor, Scene, Vector } from "excalibur";

import { Projectile } from "./Projectile";
import { WEAPON_DAMAGE, WEAPON_FIRE_RATE_HZ, WEAPON_RANGE_PX } from "../balance";

/** `tryFire` 入参。 */
export interface TryFireContext {
  /** 当前时间戳(毫秒),一般是 `engine.clock.now()`。 */
  now: number;
  /** 武器持有者(玩家),用来给 `Projectile.owner` 做友军判定。 */
  owner: Actor;
  /** 开火原点(玩家位置)。 */
  ownerPos: Vector;
  /** 投射物出生的 Scene。 */
  scene: Scene;
}

export interface PistolOptions {
  /** 射程(像素),默认 360。 */
  range?: number;
  /** 射速(发/秒),默认 2。 */
  fireRate?: number;
  /** 单发伤害,默认 10。 */
  damage?: number;
}

/**
 * 单发 Pistol。
 *
 * 用法:玩家持 `new Pistol()`;按攻击键时 `pistol.tryFire({ now, owner, ownerPos, scene })`,
 * 根据返回值判定是否真的开火(不强制消费输入,留给调用方处理)。
 */
export class Pistol {
  public readonly range: number;
  public readonly fireRate: number;
  public readonly damage: number;
  /** 节流窗口:下一次允许开火的最小 `now` 戳(毫秒)。 */
  private nextFireAtMs: number = 0;

  constructor(options: PistolOptions = {}) {
    this.range = options.range ?? WEAPON_RANGE_PX;
    this.fireRate = options.fireRate ?? WEAPON_FIRE_RATE_HZ;
    this.damage = options.damage ?? WEAPON_DAMAGE;
  }

  /**
   * 尝试开火。
   * @returns `true` 命中并开火;`false` 没目标 / 还在节流窗内。
   *   两种 `false` 都不推进节流(M0 文档的"打不到不消耗"语义)。
   */
  public tryFire(ctx: TryFireContext): boolean {
    // 节流只在成功开火后才推进,先看 now 是否还在窗口内。
    if (ctx.now < this.nextFireAtMs) return false;

    const target = this.findNearestEnemy(ctx.scene, ctx.ownerPos);
    if (!target) return false;

    // 锁定方向并发射。距离为 0 的极端情况(站到敌人脸上)用 (1, 0) 兜底,
    // 此时 Projectile 也会在 0 距离立即撞 enemy,等价于"贴脸打一枪"。
    const dx = target.pos.x - ctx.ownerPos.x;
    const dy = target.pos.y - ctx.ownerPos.y;
    const dist = Math.hypot(dx, dy);
    const dir = dist > 0 ? new Vector(dx / dist, dy / dist) : new Vector(1, 0);

    const projectile = new Projectile(
      {
        damage: this.damage,
        range: this.range,
        dir,
        owner: ctx.owner,
      },
      ctx.ownerPos,
    );
    projectile.installDraw();
    // M0.4:在子弹上挂自己的 collisionstart 监听 —— 一律交给 `Projectile.handleCollision` 决定
    // 是打中敌人扣血、撞墙自毁、还是无视。Weapon 不在这里写业务逻辑。
    projectile.on("collisionstart", (evt) => {
      const other = evt.other.owner;
      // `Collider.owner` 在类型上是 `Entity`,只有 `Actor` 子类才有 `pos` 等运行时所需字段;
      // 用 `instanceof Actor` 收敛,排除纯 Entity(项目里其实只有 Actor)。
      if (other instanceof Actor) projectile.handleCollision(other);
    });
    ctx.scene.add(projectile);

    // 成功开火后才推进节流窗口。
    this.nextFireAtMs = ctx.now + 1000 / this.fireRate;
    return true;
  }

  /**
   * 在 `range` 内挑一个**最近**的 `Enemy`。
   * 直接遍历 `scene.actors`,用距离平方比较省一次 sqrt。
   * 跳过已 `isKilled()` 的(M0.6 之后有),避免对尸体开火。
   * 同距时取**首个**遇到的(用 `<` 而不是 `<=`),保证玩家行为可预测。
   */
  private findNearestEnemy(scene: Scene, ownerPos: Vector): Actor | null {
    let best: Actor | null = null;
    let bestDistSq = this.range * this.range;
    for (const actor of scene.actors) {
      if (!actor.hasTag("enemy")) continue;
      if (actor.isKilled()) continue;
      const dx = actor.pos.x - ownerPos.x;
      const dy = actor.pos.y - ownerPos.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        best = actor;
        bestDistSq = distSq;
      }
    }
    return best;
  }
}
