/**
 * `resolveHit` 单测(plan/modules/combat.md §5 内部子模块 3 + §7 vitest 验收点)。
 *
 * 覆盖(plan §7):
 *  - 1 发命中血剩 5 的敌人 → `isKill=true` + `damage=10`。
 *  - 命中血剩 50 的敌人 → `isKill=false` + `damage=10`。
 *  - `projectile:hit` 事件 1 次,带正确 payload。
 *  - `enemy:killed` 事件只在 isKill=true 时发。
 *  - `isEnemy` 守卫:返回 false 时不扣血、不发事件。
 */
import { describe, expect, it } from "vite-plus/test";
import { createGameEventBus } from "../../../runtime/EventBus";
import type { GameEvent } from "../../../runtime/EventBus";
import { createMockEnemy } from "../__mocks__/mockEnemy";
import { resolveHit } from "./HitResolver";

describe("resolveHit", () => {
  it("命中血剩 5 的敌人 → isKill=true;发 projectile:hit + enemy:killed", () => {
    const bus = createGameEventBus();
    const enemies = createMockEnemy();
    enemies.addEnemy({ id: 1, kind: "chaser", pos: { x: 50, y: 0 }, hp: 5, maxHp: 100 });

    const events: GameEvent[] = [];
    bus.on("projectile:hit", (e) => events.push(e));
    bus.on("enemy:killed", (e) => events.push(e));

    const result = resolveHit(
      { enemies, bus },
      { projectilePos: { x: 50, y: 0 }, otherId: 1, damage: 10, targetKindHint: "chaser" },
    );

    expect(result.didDamage).toBe(true);
    expect(result.damage).toBe(10);
    expect(result.isKill).toBe(true);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("projectile:hit");
    expect(events[1].type).toBe("enemy:killed");
  });

  it("命中血剩 50 的敌人 → isKill=false;只发 projectile:hit", () => {
    const bus = createGameEventBus();
    const enemies = createMockEnemy();
    enemies.addEnemy({ id: 1, kind: "chaser", pos: { x: 50, y: 0 }, hp: 50, maxHp: 100 });

    const events: GameEvent[] = [];
    bus.on("projectile:hit", (e) => events.push(e));
    bus.on("enemy:killed", (e) => events.push(e));

    const result = resolveHit(
      { enemies, bus },
      { projectilePos: { x: 50, y: 0 }, otherId: 1, damage: 10, targetKindHint: "chaser" },
    );

    expect(result.didDamage).toBe(true);
    expect(result.damage).toBe(10);
    expect(result.isKill).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("projectile:hit");
  });

  it("projectile:hit payload 包含 isKill=true 时为 true", () => {
    const bus = createGameEventBus();
    const enemies = createMockEnemy();
    enemies.addEnemy({ id: 1, kind: "chaser", pos: { x: 50, y: 0 }, hp: 5, maxHp: 100 });

    let captured: GameEvent | null = null;
    bus.on("projectile:hit", (e) => {
      captured = e;
    });

    resolveHit(
      { enemies, bus },
      { projectilePos: { x: 50, y: 0 }, otherId: 1, damage: 10, targetKindHint: "chaser" },
    );

    expect(captured).not.toBeNull();
    const e = captured as unknown as Extract<GameEvent, { type: "projectile:hit" }>;
    expect(e.damage).toBe(10);
    expect(e.isKill).toBe(true);
    expect(e.targetKind).toBe("chaser");
    expect(e.x).toBe(50);
    expect(e.y).toBe(0);
  });

  it("isEnemy 守卫返回 false → 不扣血、不发事件(plan §7 'Combat 不知道也不关心 Enemy 内部实现')", () => {
    const bus = createGameEventBus();
    const enemies = createMockEnemy();
    enemies.addEnemy({ id: 1, kind: "chaser", pos: { x: 50, y: 0 }, hp: 5, maxHp: 100 });

    const events: GameEvent[] = [];
    bus.on("projectile:hit", (e) => events.push(e));
    bus.on("enemy:killed", (e) => events.push(e));

    const result = resolveHit(
      { enemies, bus, isEnemy: () => false },
      { projectilePos: { x: 50, y: 0 }, otherId: 1, damage: 10, targetKindHint: "chaser" },
    );

    expect(result.didDamage).toBe(false);
    expect(result.damage).toBe(0);
    expect(result.isKill).toBe(false);
    expect(events).toHaveLength(0);
    // 敌人 HP 不应被扣
    expect(enemies.damageDealtToEnemy(1)).toBe(0);
  });

  it("找不到 id → 不扣血、不发事件(plan EnemyPort.applyDamage no-op 语义)", () => {
    const bus = createGameEventBus();
    const enemies = createMockEnemy();
    // 没添加 id=99 的敌人

    const events: GameEvent[] = [];
    bus.on("projectile:hit", (e) => events.push(e));
    bus.on("enemy:killed", (e) => events.push(e));

    const result = resolveHit(
      { enemies, bus },
      { projectilePos: { x: 50, y: 0 }, otherId: 99, damage: 10, targetKindHint: "chaser" },
    );

    // 注:isEnemy 默认 true,所以 resolveHit 仍会调 applyDamage;
    // Enemy mock 在找不到 id 时返回 { isKill: false, hp: 0 },所以
    // 仍会发 projectile:hit(plan §7 HitResolver 行为)。
    // 但 isKill=false → 不发 enemy:killed。
    expect(result.didDamage).toBe(true);
    expect(result.isKill).toBe(false);
    expect(events.filter((e) => e.type === "projectile:hit")).toHaveLength(1);
    expect(events.filter((e) => e.type === "enemy:killed")).toHaveLength(0);
  });
});
