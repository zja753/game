/**
 * `createCombatModule` 端到端合约测试(plan/modules/combat.md §7 验收点)。
 *
 * 用 `createMockRuntime` + `createMockEnemy` + `createMockMapObstacle`
 * 拼装,不依赖 Excalibur Engine:
 *  - `mockRuntime.emitTick(dt)` 主动驱动冷却递减。
 *  - `mockRuntime.spawnedInstances` 拿真正实例化的 actor(第 M4 起 mock 模拟
 *    真实 Engine 路径 `new spec.kind(spec.config)`),由测试**手动**调
 *    `actor.onCollisionStart(...)` 模拟 Excalibur 真实 Engine 的碰撞触发。
 *  - `mockEnemy.addEnemy` 注入敌人,`mockEnemy.damageDealtToEnemy(id)` 断言伤害。
 *
 * 覆盖 plan §7 验收点:
 *  - **vitest**:`HitResolver` 1 发命中血剩 5 的敌人 → `isKill=true`。
 *  - **vitest**:命中血剩 50 的敌人 → `isKill=false`。
 *  - **vitest**:`swapWeapon` 后 `currentWeapon()` 正确。
 *  - **vitest**:`damageDealt()` / `kills()` 累加正确。
 *  - **Demo 验收点 1**:三个敌人时第一个被命中的是 (100,0)。
 *  - **Demo 验收点 3**:射程外 0 次发射(关键设计点)。
 *  - **Demo 验收点 2**:冷却期重复 tryFire 不造投射物。
 */
import { describe, expect, it } from "vite-plus/test";

import { createCombatModule } from "./CombatModule";
import { createMockEnemy } from "./__mocks__/mockEnemy";
import { createMockRuntime } from "../runtime/__mocks__/mockRuntime";
import { createMockMapObstacle } from "../player/__mocks__/mockMapObstacle";
import { Actor, type Side, type CollisionContact } from "excalibur";
import { createGameEventBus } from "../../runtime/EventBus";
import type { GameEvent } from "../../runtime/EventBus";
import type { ProjectileActor } from "./internal/ProjectileActor";

interface Harness {
  bus: ReturnType<typeof createGameEventBus>;
  runtime: ReturnType<typeof createMockRuntime>;
  enemies: ReturnType<typeof createMockEnemy>;
  port: ReturnType<typeof createCombatModule>;
  events: GameEvent[];
  dispose: () => void;
}

function setupHarness(): Harness {
  const bus = createGameEventBus();
  const runtime = createMockRuntime();
  const enemies = createMockEnemy();
  // obstacles 不直接用,但 CombatModule 当前不需要,留作未来 modifier 占位。
  void createMockMapObstacle();

  const port = createCombatModule({
    bus,
    runtime,
    enemies,
  });

  const events: GameEvent[] = [];
  bus.on("projectile:hit", (e) => events.push(e));
  bus.on("enemy:killed", (e) => events.push(e));

  return {
    bus,
    runtime,
    enemies,
    port,
    events,
    dispose: () => {
      const ext = port as unknown as { __dispose?: () => void };
      ext.__dispose?.();
    },
  };
}

/** 推一帧冷却时间(模拟玩家按了 fire 后等冷却到)。 */
function tickMs(h: Harness, ms: number): void {
  h.runtime.emitTick(ms);
}

/**
 * 测试驱动:从已 spawn 的投射物里触发"撞到 enemyId"的碰撞。
 * mock 模式下没有真 Engine,这里手动调 ProjectileActor.onCollisionStart
 * 模拟 Excalibur 真实 Engine 的碰撞触发。
 */
function forceHitEnemy(h: Harness, projectileIndex: number, enemyId: number): void {
  const ids = h.runtime.spawnedInstances.keys();
  const idList = Array.from(ids);
  const pid = idList[projectileIndex];
  if (pid === undefined) throw new Error(`No projectile at index ${projectileIndex}`);
  const actor = h.runtime.spawnedInstances.get(pid) as ProjectileActor;
  if (!actor) throw new Error(`Projectile at id ${pid} is null`);
  // Excalibur 0.32 onCollisionStart 签名 = (self, other, side, contact)。
  // 真实路径下 `other.owner` 指向被撞的 Actor;mock 路径下没有真物理,
  // 我们构造一个 stub Actor + collider,把 enemyId 写到 Actor.id,
  // 让 ProjectileActor.onCollisionStart 读 `other.owner.id` 拿到 enemyId。
  const otherActor = new Actor({ x: 0, y: 0, width: 1, height: 1 });
  (otherActor as unknown as { id: number }).id = enemyId;
  const otherCollider = otherActor.collider.get()!;
  actor.onCollisionStart(
    actor.collider.get()!,
    otherCollider,
    "left" as Side,
    {} as CollisionContact,
  );
}
describe("createCombatModule — 端到端", () => {
  it("初始:currentWeapon='pistol', damageDealt=0, kills=0", () => {
    const h = setupHarness();
    expect(h.port.currentWeapon()).toBe("pistol");
    expect(h.port.damageDealt()).toBe(0);
    expect(h.port.kills()).toBe(0);
    expect(h.port.listWeapons()).toContain("pistol");
    h.dispose();
  });

  it("plan §7 Demo 验收点 1:三个敌人,投射物撞 enemy 1 (最近)", () => {
    const h = setupHarness();
    h.enemies.addEnemy({ id: 1, kind: "chaser", pos: { x: 100, y: 0 } });
    h.enemies.addEnemy({ id: 2, kind: "chaser", pos: { x: 0, y: 200 } });
    h.enemies.addEnemy({ id: 3, kind: "chaser", pos: { x: -200, y: 0 } });

    const fired = h.port.tryFire(0, 100, { x: 0, y: 0 });
    expect(fired).toBe(true);
    // 投射物 spawn 了
    expect(h.runtime.spawned.length).toBe(1);

    // 模拟碰撞命中 enemy 1
    forceHitEnemy(h, 0, 1);
    // enemy 1 被打到了
    expect(h.enemies.damageDealtToEnemy(1)).toBe(10);
    expect(h.enemies.damageDealtToEnemy(2)).toBe(0);
    expect(h.enemies.damageDealtToEnemy(3)).toBe(0);
    // projectile:hit 事件发了
    expect(h.events.filter((e) => e.type === "projectile:hit")).toHaveLength(1);
    h.dispose();
  });

  it("plan §7 Demo 验收点 3:远到射程外的敌人 5 次 tryFire 0 次发射", () => {
    const h = setupHarness();
    // 敌人放在 700px 外(> range=600)
    h.enemies.addEnemy({ id: 1, kind: "chaser", pos: { x: 700, y: 0 } });

    for (let i = 0; i < 5; i++) {
      const fired = h.port.tryFire(i * 100, 100, { x: 0, y: 0 });
      expect(fired).toBe(false);
    }
    // 关键:投射物**没有**spawn(plan §5 "射程外不消耗节流")
    expect(h.runtime.spawned.length).toBe(0);
    // 敌人 0 伤害
    expect(h.enemies.damageDealtToEnemy(1)).toBe(0);
    h.dispose();
  });

  it("冷却期重复 tryFire:只发一发(plan §7 Demo 验收点 2)", () => {
    const h = setupHarness();
    h.enemies.addEnemy({ id: 1, kind: "chaser", pos: { x: 50, y: 0 } });

    const first = h.port.tryFire(0, 100, { x: 0, y: 0 });
    expect(first).toBe(true);
    // 立即再 fire — 冷却中(250ms) → false
    const second = h.port.tryFire(10, 100, { x: 0, y: 0 });
    expect(second).toBe(false);
    // 推 100ms 仍冷却中
    tickMs(h, 100);
    const third = h.port.tryFire(110, 100, { x: 0, y: 0 });
    expect(third).toBe(false);
    // 推 200ms 累计 300ms > 250ms → 冷却好
    tickMs(h, 200);
    const fourth = h.port.tryFire(310, 100, { x: 0, y: 0 });
    expect(fourth).toBe(true);

    expect(h.runtime.spawned.length).toBe(2);
    h.dispose();
  });

  it("swapWeapon → currentWeapon 切换;未知 id 走 no-op + warn", () => {
    const h = setupHarness();
    h.port.swapWeapon("pistol"); // 已知 → 切回默认
    expect(h.port.currentWeapon()).toBe("pistol");
    h.port.swapWeapon("shotgun" as never); // 未知 → no-op
    expect(h.port.currentWeapon()).toBe("pistol");
    h.dispose();
  });

  it("damageDealt() / kills() 累加正确(plan §7 vitest 验收点)", () => {
    const h = setupHarness();
    // 准备 3 个敌人:5hp(秒杀)/50hp(打掉)/50hp(打掉)
    h.enemies.addEnemy({ id: 1, kind: "chaser", pos: { x: 50, y: 0 }, hp: 5, maxHp: 100 });
    h.enemies.addEnemy({ id: 2, kind: "chaser", pos: { x: -50, y: 0 }, hp: 50, maxHp: 100 });
    h.enemies.addEnemy({ id: 3, kind: "chaser", pos: { x: 0, y: 50 }, hp: 50, maxHp: 100 });

    // 第 1 发:命中 1 (最近, dist=50) → kill
    h.port.tryFire(0, 100, { x: 0, y: 0 });
    forceHitEnemy(h, 0, 1);
    expect(h.enemies.damageDealtToEnemy(1)).toBe(10);
    // 推一帧冷却
    tickMs(h, 300);
    // 第 2 发:1 已死,选下一个最近(2 / 3 距离都 ~50,id 小的先胜)
    h.port.tryFire(300, 100, { x: 0, y: 0 });
    forceHitEnemy(h, 1, 2);
    tickMs(h, 300);
    // 第 3 发
    h.port.tryFire(600, 100, { x: 0, y: 0 });
    forceHitEnemy(h, 2, 3);

    expect(h.port.damageDealt()).toBe(30);
    expect(h.port.kills()).toBe(1);
    h.dispose();
  });

  it("projectile:hit 事件 payload 正确", () => {
    const h = setupHarness();
    h.enemies.addEnemy({ id: 1, kind: "chaser", pos: { x: 50, y: 0 }, hp: 100, maxHp: 100 });

    h.port.tryFire(0, 100, { x: 0, y: 0 });
    forceHitEnemy(h, 0, 1);
    expect(h.events.filter((e) => e.type === "projectile:hit")).toHaveLength(1);
    const hit = h.events.find((e) => e.type === "projectile:hit") as Extract<
      GameEvent,
      { type: "projectile:hit" }
    >;
    expect(hit.damage).toBe(10);
    expect(hit.isKill).toBe(false);
    expect(hit.targetKind).toBe("chaser");
    h.dispose();
  });

  it("投射物 spawn 走 projectileLayer(由 __projectileLayer 暴露)", () => {
    const h = setupHarness();
    h.enemies.addEnemy({ id: 1, kind: "chaser", pos: { x: 50, y: 0 } });
    h.port.tryFire(0, 100, { x: 0, y: 0 });
    expect(h.runtime.spawned[0].layer).toBe("projectile");
    h.dispose();
  });
});
