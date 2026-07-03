/**
 * 投射物 Actor (M0.4)。
 *
 * 设计:
 * - 持 `damage / speed / lifetime / owner / range`,沿开火瞬间锁定的单位向量 `dir` 匀速直行。
 * - 销毁三保险:
 *   1. `lifetime` 到 0(秒);
 *   2. 已飞过 `range`(用 `startPos` 累计位移平方);
 *   3. 撞到 `wall.tag === 'wall'` 的 actor。
 * - 命中敌人(`enemy.tag === 'enemy'`)时:`enemyHealth.takeDamage(damage)`,然后自毁。
 *   敌人若已 `isKilled()`(M0.6 接入)静默,不重复结算。
 * - **不**对 `owner` 友军造成伤害:撞到 `owner` 直接静默穿透不杀自己。
 *   玩家一般不会被自己的子弹追到,这里是兜底,例如未来 boss 战 owner = ally。
 * - `CollisionType.Passive`:子弹自己不受碰撞影响,只是触发别人的 onCollisionStart。
 *
 * 边界:不做特效/贴图,占位用 `PROJECTILE_COLOR` 矩形,后续 M1 改贴图。
 */
import { Actor, CollisionType, Color, Engine, Vector } from "excalibur";

import { Health } from "../components/Health";
import {
  ENEMY_TAG,
  PROJECTILE_COLOR,
  PROJECTILE_LIFETIME_S,
  PROJECTILE_SIZE_PX,
  PROJECTILE_SPEED_PX,
  WALL_TAG,
} from "../balance";

/** 构造选项。`dir` 必须是非零单位向量(开火方负责 normalize),`owner` 用来做友军判定。 */
export interface ProjectileOptions {
  damage: number;
  /** 单次飞行速度(像素/秒),与 `dir` 一起决定 vel。 */
  speed?: number;
  /** 存活上限(秒);同时是 `range` 自毁的并行保险。 */
  lifetime?: number;
  /** 最大飞行距离(像素);超程即 kill。 */
  range: number;
  /** 单位方向向量;调用方需先 `normalize()`。 */
  dir: Vector;
  /** 友军判定:撞到此 actor 不造成伤害。 */
  owner: Actor;
}

/**
 * 单发投射物。
 *
 * 用法:在 `Weapon.tryFire` 中 `new Projectile(...).init()` 之后 `scene.add(p)`。
 * 这里把 `init` 做成一个零参方法,方便在 new 之后立刻读到 `this` 的位置。
 */
export class Projectile extends Actor {
  public readonly damage: number;
  public readonly speed: number;
  public readonly lifetime: number;
  public readonly range: number;
  public readonly owner: Actor;
  /** 飞行方向,开火瞬间锁定;后续不再变。 */
  private readonly dir: Vector;
  /** 飞行起点,用于 `range` 判定。 */
  private readonly startPos: Vector;
  /** 累计飞行时间(秒),到 `lifetime` 自毁。 */
  private elapsed: number = 0;
  /** 撞墙后置 true,防止 `kill()` 在同一帧被多次调起。 */
  private consumed: boolean = false;

  constructor(config: ProjectileOptions, startPos: Vector) {
    super({
      x: startPos.x,
      y: startPos.y,
      width: PROJECTILE_SIZE_PX,
      height: PROJECTILE_SIZE_PX,
      // Passive:子弹自己不被撞飞,但仍会触发其它 actor 的 collisionstart。
      collisionType: CollisionType.Passive,
    });
    this.damage = config.damage;
    this.speed = config.speed ?? PROJECTILE_SPEED_PX;
    this.lifetime = config.lifetime ?? PROJECTILE_LIFETIME_S;
    this.range = config.range;
    this.owner = config.owner;
    this.dir = config.dir;
    this.startPos = startPos.clone();
    // 子弹画在玩家/敌人之上,贴近 HUD 视觉层(玩家 z=10,血条 z=11,子弹 z=12)。
    this.z = 12;
    this.vel.setTo(this.dir.x * this.speed, this.dir.y * this.speed);
    // 子弹拖到 ENEMY_TAG / WALL_TAG 双 tag,后续 M3 改用真实 collider 也不冲突。
    this.addTag("projectile");
  }

  override onPreUpdate(_engine: Engine, elapsedMs: number): void {
    if (this.consumed) return;
    this.elapsed += elapsedMs / 1000;
    if (this.elapsed >= this.lifetime) {
      this.die();
      return;
    }
    // 累计位移 vs `range` —— 用平方距离比较,省一次 sqrt。
    const dx = this.pos.x - this.startPos.x;
    const dy = this.pos.y - this.startPos.y;
    if (dx * dx + dy * dy >= this.range * this.range) {
      this.die();
    }
  }

  /**
   * 与敌/墙的碰撞结算。
   * 友军(owner)直接放过,不做任何动作(也不 kill 自己)。
   */
  public handleCollision(other: Actor): void {
    if (this.consumed) return;
    if (other.hasTag(ENEMY_TAG)) {
      // 敌人已死(被其它子弹先杀)就跳过,避免重复结算。
      const components = other.getComponents();
      const health = components.find((c): c is Health => c instanceof Health);
      if (health && !health.isDead) {
        health.takeDamage(this.damage, { source: this });
      }
      this.die();
      return;
    }
    if (other.hasTag(WALL_TAG)) {
      this.die();
      return;
    }
    // 其它 actor(玩家/其它投射物)无视。
  }

  /**
   * 占位绘制:在 actor 中心画一个 `PROJECTILE_COLOR` 的实心方块。
   * 接入位置在 `onPostDraw`,与玩家血条保持一致风格;actor 自身 transform 已应用,
   * 所以 `(0, 0)` 就是 actor 中心。
   */
  public installDraw(): void {
    this.graphics.onPostDraw = (ctx) => {
      const half = PROJECTILE_SIZE_PX / 2;
      ctx.drawRectangle(
        new Vector(-half, -half),
        PROJECTILE_SIZE_PX,
        PROJECTILE_SIZE_PX,
        Color.fromHex(PROJECTILE_COLOR),
      );
    };
  }

  /** 一次性自毁守卫。Excalibur 的 `kill()` 重复调是 no-op,这里只是显式表达语义。 */
  private die(): void {
    if (this.consumed) return;
    this.consumed = true;
    this.kill();
  }
}
