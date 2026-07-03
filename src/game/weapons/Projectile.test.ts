/**
 * `Projectile` 单测 (M0.4) —— 与 `Pistol.test.ts` 同级覆盖。
 *
 * 关注点:
 * - 三种自毁路径:`lifetime` 到 0 / 飞出 `range` / 撞墙。
 * - 命中敌人:对 `Health.takeDamage` 结算,自己 `kill()`。
 * - 命中 owner:静默穿透,不扣血、不自毁。
 * - 命中已死敌人(被其它子弹先杀):不重复结算,但仍 `kill()` 自己。
 * - `consumed` 守卫:同帧多次碰撞不会重复 `kill()`。
 *
 * 不启动 Engine,直接 `new Scene()` + `new Actor()`,然后手动推进
 * `projectile.onPreUpdate(_, elapsedMs)` 模拟时间流逝。
 */
import { describe, expect, it } from "vite-plus/test";
import { Actor, CollisionType, Scene, Vector } from "excalibur";

import { Projectile } from "./Projectile";
import { Health } from "../components/Health";
import { ENEMY_TAG, PROJECTILE_LIFETIME_S, PROJECTILE_SPEED_PX, WALL_TAG } from "../balance";

/** 玩家/敌人/墙的最小 actor 工厂。 */
function makeActor(x: number, y: number, tags: string[] = []): Actor {
  const a = new Actor({
    x,
    y,
    width: 8,
    height: 8,
    collisionType: CollisionType.Active,
  });
  for (const t of tags) a.addTag(t);
  return a;
}

/** 沿 `dir` 直行、初始 `speed` 的 projectile 工厂。 */
function makeProjectile(
  start: Vector,
  dir: Vector,
  range: number,
  owner: Actor,
  damage = 10,
): Projectile {
  const p = new Projectile({ damage, range, dir: dir.normalize(), owner }, start);
  p.installDraw();
  return p;
}

/** 推进 projectile `elapsedMs` 毫秒(模拟 `onPreUpdate` 单次调用)。 */
function tick(p: Projectile, elapsedMs: number): void {
  p.onPreUpdate(undefined as never, elapsedMs);
}

describe("Projectile", () => {
  it("lifetime 到 0 自毁", () => {
    const scene = new Scene();
    const owner = makeActor(0, 0);
    scene.add(owner);
    const p = makeProjectile(new Vector(0, 0), new Vector(1, 0), 1000, owner);
    scene.add(p);

    // 跑满 lifetime(向上取整避免浮点误差)
    const total = Math.ceil(PROJECTILE_LIFETIME_S * 1000);
    tick(p, total);
    expect(p.isKilled()).toBe(true);
  });

  it("飞过 range 自毁(快于 lifetime)", () => {
    const scene = new Scene();
    const owner = makeActor(0, 0);
    scene.add(owner);
    // range 100px / 速度 PROJECTILE_SPEED_PX=600 → ~0.167s 撞范围边界,
    // 远小于 PROJECTILE_LIFETIME_S=1.5s,验证 range 保险优先触发。
    // 单测里不启 Engine,Actor 的 vel → pos 积分不会跑;我们直接设 pos 越过 range。
    const range = 100;
    const p = makeProjectile(new Vector(0, 0), new Vector(1, 0), range, owner);
    scene.add(p);

    p.pos.setTo(range * 1.1, 0);
    tick(p, 1);
    expect(p.isKilled()).toBe(true);
  });

  it("撞墙自毁(走完 lifetime 还没到 range 也行;这里测瞬间撞墙)", () => {
    const scene = new Scene();
    const owner = makeActor(0, 0);
    const wall = makeActor(50, 0, [WALL_TAG]);
    scene.add(owner);
    scene.add(wall);
    const p = makeProjectile(new Vector(0, 0), new Vector(1, 0), 1000, owner);
    scene.add(p);

    p.handleCollision(wall);
    expect(p.isKilled()).toBe(true);
  });

  it("命中敌人:Health 扣血,projectile 自身 kill", () => {
    const scene = new Scene();
    const owner = makeActor(0, 0);
    const enemy = makeActor(100, 0, [ENEMY_TAG]);
    const enemyHealth = new Health({ maxHp: 30, invulnerableDuration: 0 });
    enemy.addComponent(enemyHealth);
    scene.add(owner);
    scene.add(enemy);
    const p = makeProjectile(new Vector(0, 0), new Vector(1, 0), 1000, owner, 10);
    scene.add(p);

    p.handleCollision(enemy);
    expect(enemyHealth.hp).toBe(20);
    expect(p.isKilled()).toBe(true);
  });

  it("命中 owner:静默穿透,不扣血、不自毁", () => {
    const scene = new Scene();
    const owner = makeActor(0, 0);
    const ownerHealth = new Health({ maxHp: 100, invulnerableDuration: 0 });
    owner.addComponent(ownerHealth);
    scene.add(owner);
    const p = makeProjectile(new Vector(0, 0), new Vector(1, 0), 1000, owner, 10);
    scene.add(p);

    p.handleCollision(owner);
    expect(ownerHealth.hp).toBe(100);
    expect(p.isKilled()).toBe(false);
  });

  it("命中已死敌人:不重复扣血,但 projectile 仍自毁", () => {
    const scene = new Scene();
    const owner = makeActor(0, 0);
    const enemy = makeActor(100, 0, [ENEMY_TAG]);
    const enemyHealth = new Health({ maxHp: 10, invulnerableDuration: 0 });
    enemy.addComponent(enemyHealth);
    // 预杀:把 hp 打到 0
    enemyHealth.takeDamage(10);
    expect(enemyHealth.isDead).toBe(true);
    scene.add(owner);
    scene.add(enemy);
    const p = makeProjectile(new Vector(0, 0), new Vector(1, 0), 1000, owner, 10);
    scene.add(p);

    p.handleCollision(enemy);
    // hp 仍为 0(没有再扣)
    expect(enemyHealth.hp).toBe(0);
    // 子弹自己仍然自毁(避免穿透到后面的 actor)
    expect(p.isKilled()).toBe(true);
  });

  it("consumed 守卫:同帧多次 handleCollision 不会重复 kill()", () => {
    const scene = new Scene();
    const owner = makeActor(0, 0);
    const enemy = makeActor(100, 0, [ENEMY_TAG]);
    const enemyHealth = new Health({ maxHp: 30, invulnerableDuration: 0 });
    enemy.addComponent(enemyHealth);
    scene.add(owner);
    scene.add(enemy);
    const p = makeProjectile(new Vector(0, 0), new Vector(1, 0), 1000, owner, 10);
    scene.add(p);

    p.handleCollision(enemy);
    p.handleCollision(enemy);
    p.handleCollision(enemy);
    // 只扣了一次 10 滴
    expect(enemyHealth.hp).toBe(20);
    expect(p.isKilled()).toBe(true);
  });

  it("默认速度与 lifetime 取自 balance 常量", () => {
    const scene = new Scene();
    const owner = makeActor(0, 0);
    scene.add(owner);
    const p = makeProjectile(new Vector(0, 0), new Vector(1, 0), 1000, owner);
    expect(p.speed).toBe(PROJECTILE_SPEED_PX);
    expect(p.lifetime).toBe(PROJECTILE_LIFETIME_S);
  });
});
