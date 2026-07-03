/**
 * `Pistol` 单测 (M0.4)。
 *
 * 关注点:
 * - 射程内最近敌人:会被选为目标,且 `tryFire` 返回 `true`、scene 内出现新 actor。
 * - 射程外 / 无敌人:`tryFire` 返回 `false`,**不**消耗节流。
 * - 节流窗口:成功开火后,`now < nextFireAtMs` 期间反复 `tryFire` 一律拒绝。
 * - 节流推进时机:连续 `tryFire` 没目标时,**不**改变 `nextFireAtMs`。
 *
 * 选 Excalibur 真实 `Scene` + `Actor`:
 * 不需要 `Engine` 启动,`Scene.actors` 的 getter 在 `add` 后即可枚举。
 */
import { describe, expect, it } from "vite-plus/test";
import { Actor, CollisionType, Scene, Vector } from "excalibur";

import { Pistol } from "./Pistol";
import { ENEMY_TAG, WEAPON_FIRE_RATE_HZ } from "../balance";

/** 玩家/敌人位置可控的简易 Actor。 */
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

describe("Pistol", () => {
  it("射程内找到最近敌人,tryFire 返回 true 并生成 projectile", () => {
    const scene = new Scene();
    const player = makeActor(0, 0);
    const enemy1 = makeActor(300, 0, [ENEMY_TAG]); // 距离 300,在 360 内
    const enemy2 = makeActor(200, 0, [ENEMY_TAG]); // 距离 200,更近
    scene.add(player);
    scene.add(enemy1);
    scene.add(enemy2);

    const pistol = new Pistol();
    const ok = pistol.tryFire({
      now: 1000,
      owner: player,
      ownerPos: player.pos,
      scene,
    });
    expect(ok).toBe(true);
    // 玩家 1 + 敌人 2 + 投射物 1
    expect(scene.actors.length).toBe(4);
    const projectile = scene.actors.find((a) => a.hasTag("projectile"));
    expect(projectile).toBeDefined();
    // 投射物朝 enemy2 方向 (1, 0)
    expect(projectile?.vel.x).toBeGreaterThan(0);
    expect(Math.abs(projectile?.vel.y ?? 0)).toBeLessThan(1e-6);
  });

  it("射程外(>360 像素)不开火,不消耗节流", () => {
    const scene = new Scene();
    const player = makeActor(0, 0);
    const farEnemy = makeActor(400, 0, [ENEMY_TAG]); // 距离 400
    scene.add(player);
    scene.add(farEnemy);

    const pistol = new Pistol();
    // 第一次:无目标
    expect(pistol.tryFire({ now: 1000, owner: player, ownerPos: player.pos, scene })).toBe(false);
    // 第二次(把敌人在 now=1100 时挪进射程):节流必须没被消耗,应该能开火
    farEnemy.pos = new Vector(300, 0);
    expect(pistol.tryFire({ now: 1100, owner: player, ownerPos: player.pos, scene })).toBe(true);
  });

  it("成功开火后,节流窗口内的 tryFire 全部拒绝", () => {
    const scene = new Scene();
    const player = makeActor(0, 0);
    const enemy = makeActor(100, 0, [ENEMY_TAG]);
    scene.add(player);
    scene.add(enemy);

    const pistol = new Pistol();
    const periodMs = 1000 / WEAPON_FIRE_RATE_HZ;
    expect(pistol.tryFire({ now: 0, owner: player, ownerPos: player.pos, scene })).toBe(true);
    // 节流内(now < period):拒绝
    expect(pistol.tryFire({ now: periodMs - 1, owner: player, ownerPos: player.pos, scene })).toBe(
      false,
    );
    // 刚到 period:可再次开火
    expect(pistol.tryFire({ now: periodMs, owner: player, ownerPos: player.pos, scene })).toBe(
      true,
    );
  });

  it("无敌人时不消耗节流:反复 tryFire,只要一直没有目标就不推进", () => {
    const scene = new Scene();
    const player = makeActor(0, 0);
    scene.add(player);

    const pistol = new Pistol();
    for (let i = 0; i < 5; i++) {
      expect(pistol.tryFire({ now: 10 * i, owner: player, ownerPos: player.pos, scene })).toBe(
        false,
      );
    }
    // 此时在 t=0 加进一个敌人,应该立刻能开火(节流仍是初始 0)。
    const enemy = makeActor(50, 0, [ENEMY_TAG]);
    scene.add(enemy);
    expect(pistol.tryFire({ now: 100, owner: player, ownerPos: player.pos, scene })).toBe(true);
  });
});
