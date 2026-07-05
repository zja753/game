/**
 * `SpawnScheduler` 单元测试(plan/modules/enemy.md §5 内部子模块 3 + §7 验收点)。
 *
 * 测:
 *  - `enabled=false` → tick 不 spawn。
 *  - "已满"(`getAliveCount() >= enemyDensity`)→ 不 spawn。
 *  - 节奏未到(`now - lastSpawn < interval`)→ 不 spawn。
 *  - 节奏到了 + 有空位 → spawn 1 个(走 spy 验证 kind / pos)。
 *  - `setEnabled` / `reset` / `isEnabled` 行为正确。
 *  - `LevelConfig.allowedKinds` 为空 → 不 spawn(返回空数组)。
 *  - `pickSpawnPos` 用默认值时取 ctx.now 决定(确定性)。
 */
import { describe, expect, it, beforeEach } from "vite-plus/test";
import { createSpawnScheduler } from "./SpawnScheduler";
import type { ActorId, LevelConfig, Vec2 } from "../../../runtime/types";

let spawnedCalls: Array<{ kind: string; pos: Vec2 }> = [];
let aliveCount = 0;
function makeHarness(opts?: { intervalMs?: number; pickPos?: (n: number) => Vec2 }) {
  spawnedCalls = [];
  aliveCount = 0;
  return createSpawnScheduler({
    spawnOne: (kind, pos) => {
      spawnedCalls.push({ kind, pos: { x: pos.x, y: pos.y } });
      return spawnedCalls.length;
    },
    getAliveCount: () => aliveCount,
    pickSpawnPos: opts?.pickPos
      ? (ctx: { level: LevelConfig; aliveCount: number; now: number }) => opts.pickPos!(ctx.now)
      : (ctx: { level: LevelConfig; aliveCount: number; now: number }) => ({ x: ctx.now, y: 0 }),
    spawnIntervalMs: opts?.intervalMs ?? 1000,
  });
}

function makeConfig(over: Partial<LevelConfig> = {}): LevelConfig {
  return {
    duration: 60,
    enemyDensity: 5,
    isFinal: false,
    allowedKinds: ["chaser"],
    ...over,
  };
}

function tick(scheduler: ReturnType<typeof makeHarness>, now: number, level: LevelConfig) {
  return scheduler.tick({ now, dt: 16, level });
}

beforeEach(() => {
  spawnedCalls = [];
  aliveCount = 0;
});

describe("SpawnScheduler", () => {
  it("enabled=false → tick 返回空数组", () => {
    const s = makeHarness();
    s.setEnabled(false);
    const ids = tick(s, 1000, makeConfig());
    expect(ids).toEqual([]);
    expect(spawnedCalls).toEqual([]);
  });

  it("alive 已达上限 → 不 spawn", () => {
    const s = makeHarness();
    aliveCount = 5; // = enemyDensity
    const ids = tick(s, 1000, makeConfig({ enemyDensity: 5 }));
    expect(ids).toEqual([]);
    expect(spawnedCalls).toEqual([]);
  });

  it("节奏未到 → 不 spawn", () => {
    const s = makeHarness({ intervalMs: 1000 });
    // 第一次 tick 触发 spawn(now=1000 - (-Infinity) > 1000)
    const first = tick(s, 1000, makeConfig());
    expect(first.length).toBe(1);
    // 第二次 tick 500ms 后,节奏未到(500 < 1000)
    const second = tick(s, 1500, makeConfig());
    expect(second).toEqual([]);
  });

  it("节奏到了 + 有空位 → spawn 1 个(走 spy 验证 kind + pos)", () => {
    const s = makeHarness({ intervalMs: 1000, pickPos: () => ({ x: 42, y: 7 }) });
    const ids = tick(s, 2000, makeConfig());
    expect(ids.length).toBe(1);
    expect(spawnedCalls).toEqual([{ kind: "chaser", pos: { x: 42, y: 7 } }]);
  });

  it("多次 tick 节奏:每 1000ms spawn 一次", () => {
    const s = makeHarness({ intervalMs: 1000 });
    tick(s, 1000, makeConfig());
    tick(s, 1500, makeConfig()); // 节奏未到
    tick(s, 2000, makeConfig()); // 节奏到了
    tick(s, 3000, makeConfig()); // 节奏到了
    expect(spawnedCalls.length).toBe(3);
  });

  it("setEnabled / isEnabled 反映状态", () => {
    const s = makeHarness();
    expect(s.isEnabled()).toBe(true);
    s.setEnabled(false);
    expect(s.isEnabled()).toBe(false);
    s.setEnabled(true);
    expect(s.isEnabled()).toBe(true);
  });

  it("reset → lastSpawnAt 回到 -Infinity,下一 tick 立即 spawn", () => {
    const s = makeHarness({ intervalMs: 1000 });
    tick(s, 1000, makeConfig());
    tick(s, 1500, makeConfig());
    expect(spawnedCalls.length).toBe(1);
    s.reset();
    // reset 后第一次 tick(now < interval)也会 spawn,因为 lastSpawnAt = -Infinity
    const ids = tick(s, 0, makeConfig());
    expect(ids.length).toBe(1);
  });

  it("allowedKinds 为空 → 不 spawn", () => {
    const s = makeHarness();
    const ids = tick(s, 1000, makeConfig({ allowedKinds: [] }));
    expect(ids).toEqual([]);
    expect(spawnedCalls).toEqual([]);
  });

  it("batchSize > 1 → 一次 tick 刷多个", () => {
    const s = createSpawnScheduler({
      spawnOne: (_kind, pos) => {
        spawnedCalls.push({ kind: "chaser", pos: { x: pos.x, y: pos.y } });
        return spawnedCalls.length as ActorId;
      },
      getAliveCount: () => aliveCount,
      pickSpawnPos: (ctx) => ({ x: ctx.now, y: 0 }),
      spawnIntervalMs: 1000,
      batchSize: 3,
    });
    // alive=0, capacity=10:应一次刷 3 个
    const ids = tick(s, 2000, makeConfig({ enemyDensity: 10 }));
    expect(ids.length).toBe(3);
    expect(spawnedCalls.length).toBe(3);
  });
});
