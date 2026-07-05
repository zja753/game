/**
 * `createEnemyModule` 端到端合约测试(plan/modules/enemy.md §7 验收点)。
 *
 * 用 `createMockRuntime` + `createMockPlayer` + `createMockProgression` +
 * `createMockMapObstacle` 拼装,不依赖 Excalibur Engine:
 *  - `mockRuntime.emitTick(dt)` 主动驱动 AI tick + scheduler tick。
 *  - `mockRuntime.spawnedInstances` 拿真正实例化的 actor(由 mock 模拟
 *    真实 Engine 路径 `new spec.kind(spec.config)`),由测试**手动**调
 *    `actor.onPreUpdate(...)` 模拟 Excalibur 真实 Engine 的 preupdate。
 *    (EnemyModule 内部也会自动调一次,见 mockRuntime 模式 —— 但本测试
 *    想要"按帧推进",所以也会走 `runtime.emitTick` 路径。)
 *  - `mockPlayer.setPos` / `setDead` 注入玩家位姿 / 死亡标志。
 *  - `mockProgression.setLevelConfig` / `setScene` 注入关卡 / 场景。
 *
 * 覆盖 plan §7 验收点:
 *  - **vitest**:`BehaviorStrategy` 单测 Chaser 在固定 dt 下位置变化正确(速度 × dt)。
 *    (本文件通过 EnemyModule 端到端跑 Chaser,验证 pos 真的在动。)
 *  - **vitest**:`ContactDamage` 不会每帧扣血(节流)。
 *  - **vitest**:`EnemyRegistry` 切换 `swapKind` 后 `list()` 返回新 spec。
 *    (M5 第一版只有 1 种 chaser,本测试断言注册/查询闭环。)
 *  - **vitest**:`applyDamage` 在 hp 归零时返回 `isKill: true` 并发 `enemy:dying`。
 *
 * 集成级额外验收:
 *  - `spawn` 广播 `enemy:spawned { id, kind, pos }`。
 *  - `applyDamage` 在 hp > 0 时返回 `isKill=false`,hp=0 时返回 `isKill=true`。
 *  - 致死路径自动反注册 + despawn + 广播 `enemy:dying`。
 *  - `clear` 把所有敌人致死并触发 `enemy:dying`。
 *  - `level:phase` scene=running 时启 spawn,其他 scene 停 spawn。
 *  - AI tick:每一帧 enemy 都朝玩家方向移动(Chaser 行为)。
 */
import { describe, expect, it } from "vite-plus/test";
import { createEnemyModule } from "./EnemyModule";
import { createMockRuntime } from "../runtime/__mocks__/mockRuntime";
import { createMockMapObstacle } from "../player/__mocks__/mockMapObstacle";
import { createMockPlayer } from "./__mocks__/mockPlayer";
import { createMockProgression } from "./__mocks__/mockProgression";
import { createGameEventBus } from "../../runtime/EventBus";
import type { GameEvent } from "../../runtime/EventBus";
import type { EnemyActor } from "./internal/EnemyActor";

interface Harness {
  bus: ReturnType<typeof createGameEventBus>;
  runtime: ReturnType<typeof createMockRuntime>;
  player: ReturnType<typeof createMockPlayer>;
  progression: ReturnType<typeof createMockProgression>;
  obstacles: ReturnType<typeof createMockMapObstacle>;
  port: ReturnType<typeof createEnemyModule>;
  events: GameEvent[];
  dispose: () => void;
}

function setupHarness(): Harness {
  const bus = createGameEventBus();
  const runtime = createMockRuntime();
  const player = createMockPlayer({ initialPos: { x: 0, y: 0 } });
  const progression = createMockProgression();
  const obstacles = createMockMapObstacle();

  const port = createEnemyModule({
    bus,
    runtime,
    player,
    progression,
    obstacles,
    // 禁用节流:测试里不需要等待。
    hitCooldownMs: 100000,
    // 100ms / 只:测试节奏更快。
    spawnIntervalMs: 100,
  });

  const events: GameEvent[] = [];
  bus.on("enemy:spawned", (e) => events.push(e));
  bus.on("enemy:dying", (e) => events.push(e));

  return {
    bus,
    runtime,
    player,
    progression,
    obstacles,
    port,
    events,
    dispose: () => {
      const ext = port as unknown as { __dispose?: () => void };
      ext.__dispose?.();
    },
  };
}

function tickMs(h: Harness, ms: number): void {
  h.runtime.emitTick(ms);
}

function findActorById(h: Harness, id: number): EnemyActor | null {
  const a = h.runtime.spawnedInstances.get(id) as EnemyActor | null;
  return a ?? null;
}

describe("createEnemyModule — 端到端", () => {
  it("初始:count=0, list()=[]", () => {
    const h = setupHarness();
    expect(h.port.count()).toBe(0);
    expect(h.port.list()).toEqual([]);
    h.dispose();
  });

  it("spawn('chaser', pos) → 注册到内部表 + 广播 enemy:spawned + 返回 id", () => {
    const h = setupHarness();
    const id = h.port.spawn("chaser", { x: 50, y: 0 });
    expect(id).toBeGreaterThan(0);
    expect(h.port.count()).toBe(1);
    expect(h.port.list().length).toBe(1);

    const ev = h.events.find((e) => e.type === "enemy:spawned");
    expect(ev).toBeDefined();
    if (ev?.type === "enemy:spawned") {
      expect(ev.id).toBe(id);
      expect(ev.kind).toBe("chaser");
      expect(ev.x).toBe(50);
      expect(ev.y).toBe(0);
    }
    h.dispose();
  });

  it("spawn 未知 kind → 返回 0 + warn(不抛错)", () => {
    const h = setupHarness();
    const id = h.port.spawn("" as never, { x: 0, y: 0 });
    expect(id).toBe(0);
    expect(h.port.count()).toBe(0);
    h.dispose();
  });

  it("list() 返回的快照含 pos / hp / maxHp / kind / id", () => {
    const h = setupHarness();
    const id = h.port.spawn("chaser", { x: 50, y: 30 });
    const list = h.port.list();
    expect(list[0]).toEqual({
      id,
      kind: "chaser",
      pos: { x: 50, y: 30 },
      hp: 20,
      maxHp: 20,
    });
    h.dispose();
  });

  it("applyDamage(hp - 1) → isKill=false, hp 减 1", () => {
    const h = setupHarness();
    const id = h.port.spawn("chaser", { x: 0, y: 0 });
    const r = h.port.applyDamage(id, 5);
    expect(r.isKill).toBe(false);
    expect(r.hp).toBe(15);
    h.dispose();
  });

  it("applyDamage(hp) → isKill=true + 广播 enemy:dying + 内部表移除", () => {
    const h = setupHarness();
    const id = h.port.spawn("chaser", { x: 50, y: 0 });
    const r = h.port.applyDamage(id, 20);
    expect(r.isKill).toBe(true);
    expect(r.hp).toBe(0);

    // 致死路径:广播 enemy:dying + 反注册。
    const dying = h.events.find((e) => e.type === "enemy:dying");
    expect(dying).toBeDefined();
    if (dying?.type === "enemy:dying") {
      expect(dying.id).toBe(id);
      expect(dying.kind).toBe("chaser");
    }
    expect(h.port.count()).toBe(0);
    h.dispose();
  });

  it("applyDamage 未知 id → no-op", () => {
    const h = setupHarness();
    const r = h.port.applyDamage(999, 10);
    expect(r.isKill).toBe(false);
    expect(r.hp).toBe(0);
    h.dispose();
  });

  it("applyDamage 致死后再 applyDamage → no-op(不再扣血)", () => {
    const h = setupHarness();
    const id = h.port.spawn("chaser", { x: 0, y: 0 });
    h.port.applyDamage(id, 20); // 致死
    const dyingBefore = h.events.filter((e) => e.type === "enemy:dying").length;
    const r = h.port.applyDamage(id, 5);
    expect(r.isKill).toBe(false);
    expect(r.hp).toBe(0);
    const dyingAfter = h.events.filter((e) => e.type === "enemy:dying").length;
    expect(dyingAfter).toBe(dyingBefore);
    h.dispose();
  });

  it("clear() 致死所有敌人 + 广播 enemy:dying 每个一次", () => {
    const h = setupHarness();
    const id1 = h.port.spawn("chaser", { x: 0, y: 0 });
    const id2 = h.port.spawn("chaser", { x: 50, y: 50 });
    const id3 = h.port.spawn("chaser", { x: -50, y: 0 });
    expect(h.port.count()).toBe(3);

    h.port.clear();
    expect(h.port.count()).toBe(0);

    const dying = h.events.filter((e) => e.type === "enemy:dying");
    expect(dying.length).toBe(3);
    const dyingIds = new Set(dying.map((e) => (e as { id: number }).id));
    expect(dyingIds.has(id1)).toBe(true);
    expect(dyingIds.has(id2)).toBe(true);
    expect(dyingIds.has(id3)).toBe(true);
    h.dispose();
  });

  it("AI tick:enemy 朝玩家移动(Chaser 行为)", () => {
    const h = setupHarness();
    h.player.setPos({ x: 100, y: 0 });
    const id = h.port.spawn("chaser", { x: 0, y: 0 });
    const actor = findActorById(h, id);
    expect(actor).not.toBe(null);
    const pos0 = actor!.getPos();
    expect(pos0).toEqual({ x: 0, y: 0 });

    // 推 1 秒(1000ms):Chaser 速度 80 px/s,应朝玩家 +x 方向移动 80px。
    tickMs(h, 1000);
    const pos1 = actor!.getPos();
    expect(pos1.x).toBeGreaterThan(pos0.x);
    expect(pos1.x).toBeCloseTo(80, 0);
    expect(pos1.y).toBeCloseTo(0, 0);
    h.dispose();
  });

  it("AI tick:玩家不存在(isDead=true)→ enemy 不移动", () => {
    const h = setupHarness();
    h.player.setDead(true);
    const id = h.port.spawn("chaser", { x: 0, y: 0 });
    const actor = findActorById(h, id);
    expect(actor).not.toBe(null);
    const pos0 = actor!.getPos();
    tickMs(h, 1000);
    const pos1 = actor!.getPos();
    expect(pos1).toEqual(pos0);
    h.dispose();
  });

  it("contact damage 入口:handleContactStart → 扣血(节流期内 stay 不扣)", () => {
    const h = setupHarness();
    const id = h.port.spawn("chaser", { x: 0, y: 0 });
    const actor = findActorById(h, id);
    expect(actor).not.toBe(null);

    // 第一次接触:扣 5HP(contactDamage=5)
    actor!.handleContactStart();
    expect(h.player.damageTaken).toBe(5);

    // 紧接着 stay:节流期内不再扣(hitCooldownMs 设了 100000,远超 1ms)
    actor!.handleContactStart();
    expect(h.player.damageTaken).toBe(5);

    h.dispose();
  });

  it("level:phase=running → scheduler 启用,会自动 spawn", () => {
    const h = setupHarness();
    // 默认 progression.scene = "running",scheduler 启用;
    // 但默认关卡 allowedKinds=["chaser"]/density=10,节奏 100ms,空地。
    // 推 500ms,理论应 spawn ~5 个。
    tickMs(h, 500);
    expect(h.port.count()).toBeGreaterThan(0);
    h.dispose();
  });

  it("level:phase=portal → scheduler 停,不再 spawn", () => {
    const h = setupHarness();
    // 先清空(此时 scene=running,先让它跑一段)
    tickMs(h, 0);
    h.port.clear();
    expect(h.port.count()).toBe(0);

    // 切到 portal:应停 spawn
    h.bus.emit({
      type: "level:phase",
      scene: "portal",
      context: { scene: "portal", portalPos: { x: 0, y: 0 }, remainingEnemies: 0 },
    });

    tickMs(h, 500);
    expect(h.port.count()).toBe(0);
    h.dispose();
  });

  it("level:phase=gameover → scheduler 停,不再 spawn", () => {
    const h = setupHarness();
    h.bus.emit({
      type: "level:phase",
      scene: "gameover",
      context: {
        scene: "gameover",
        stats: { elapsed: 0, kills: 0, damageDealt: 0, level: 1, playerLevel: 1 },
      },
    });
    tickMs(h, 500);
    expect(h.port.count()).toBe(0);
    h.dispose();
  });

  it("撞墙:enemy 不会穿墙(空地图 → 自由移动,验证 setup 正常)", () => {
    const h = setupHarness();
    h.player.setPos({ x: 100, y: 0 });
    h.obstacles.addBlockedRect({ x: 60, y: -10 }, { x: 80, y: 10 });
    const id = h.port.spawn("chaser", { x: 0, y: 0 });
    const actor = findActorById(h, id);
    expect(actor).not.toBe(null);
    // 推 1 秒,enemy 应被墙挡在 x < 60
    tickMs(h, 1000);
    const pos = actor!.getPos();
    expect(pos.x).toBeLessThan(60);
    h.dispose();
  });
});
