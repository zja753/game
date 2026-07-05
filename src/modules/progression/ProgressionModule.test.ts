/**
 * `createProgressionModule` 端到端合约测试(plan/modules/progression.md §8 验收点)。
 *
 * 用 `createMockRuntime` + `createMockEnemy` + `createMockMapObstacle` +
 * `createMockRewardShop` 拼装,不依赖 Excalibur Engine:
 *  - `mockRuntime.emitTick(dt)` 主动驱动 Progression 帧推进 + timer 递减。
 *  - `mockEnemy` 提供 `count()` 走真实 Progression 逻辑的"敌人清空"判定。
 *  - `mockMapObstacle.portalSpawn()` 提供 portal 生成点(默认 bounds 对角)。
 *  - `mockRewardShop` 提供 `rollLevelUpChoices` / `rollShopItems` / `applyReward`。
 *  - `mockClock` 是 `ClockControl` 的 spy 实现,断言 start/stop 被调过。
 *
 * 覆盖 plan §8 验收点:
 *  - **vitest**:初始 `scene="character_select"`,`xp=0`,`level=1`,`xpToNext=5`(等级 1 base)。
 *  - **vitest**:`pickCharacter` → `scene="running"`,`timer=duration`。
 *  - **vitest**:`enemy:killed { xp: 3 }` → `xp=3` 触发 `xp >= xpToNext(1)=5`?——否。
 *    调整为 `xp: 5` 单发触发升级,或 `xp: 3 + xp: 3` 累计触发。
 *  - **vitest**:`reward:picked { id, kind="levelup" }` → 调 `applyReward` +
 *    `level:phase.scene="running"` + `clock.start`。
 *  - **vitest**:`enemy:killed` 累计本局击杀 / `projectile:hit` 累计伤害。
 *  - **vitest**:推进 `dt` 到 timer 归零 → `level:phase.scene="portal"` + 1 次 `portal:appeared`。
 *  - **vitest**:`portal → advance()` → `scene="shop"`(非 final 时)。
 *  - **vitest**:`shop → advance()` → `stage++`,`scene="running"`。
 *  - **vitest**:`player:died` 任意 scene → `gameover` + `clock.stop`。
 *  - **vitest**:`pauseToggle` 在 `running` 切 paused + `clock.stop`,再切回来 + `clock.start`。
 *  - **vitest**:`startRun()` 从 `gameover` 回 `character_select`。
 */
import { describe, expect, it, vi } from "vite-plus/test";

import { createProgressionModule } from "./ProgressionModule";
import { createMockRuntime } from "../runtime/__mocks__/mockRuntime";
import { createMockMapObstacle } from "../player/__mocks__/mockMapObstacle";
import { createMockEnemy } from "../enemy/__mocks__/mockEnemy";
import { createMockRewardShop } from "./__mocks__/mockRewardShop";
import { createGameEventBus } from "../../runtime/EventBus";
import type { GameEvent } from "../../runtime/EventBus";
import type { ClockControl } from "../../runtime/types";
import type { ProgressionPort } from "../../runtime/ports/ProgressionPort";

interface MockClock extends ClockControl {
  /** `clock.start` 被调次数。 */
  startCount: number;
  /** `clock.stop` 被调次数。 */
  stopCount: number;
  /** 当前时钟是否在跑。 */
  isRunning: boolean;
  /** 清零所有 spy(测试间隔离)。 */
  reset(): void;
}

function createMockClock(): MockClock {
  let running = false;
  let startCalls = 0;
  let stopCalls = 0;
  const clock: MockClock = {
    start: () => {
      startCalls += 1;
      running = true;
    },
    stop: () => {
      stopCalls += 1;
      running = false;
    },
    get isRunning() {
      return running;
    },
    get startCount() {
      return startCalls;
    },
    get stopCount() {
      return stopCalls;
    },
    reset: () => {
      running = false;
      startCalls = 0;
      stopCalls = 0;
    },
  };
  return clock;
}

interface Harness {
  bus: ReturnType<typeof createGameEventBus>;
  runtime: ReturnType<typeof createMockRuntime>;
  enemies: ReturnType<typeof createMockEnemy>;
  map: ReturnType<typeof createMockMapObstacle>;
  rewardShop: ReturnType<typeof createMockRewardShop>;
  clock: MockClock;
  port: ProgressionPort & {
    __dispose: () => void;
    __controller: unknown;
    __levelIdFor: (stage: number) => string;
  };
  events: GameEvent[];
  dispose: () => void;
}

function setupHarness(): Harness {
  const bus = createGameEventBus();
  const runtime = createMockRuntime();
  const enemies = createMockEnemy();
  const map = createMockMapObstacle();
  const rewardShop = createMockRewardShop();
  const clock = createMockClock();

  const port = createProgressionModule({
    bus,
    runtime,
    clock,
    map,
    enemies,
    rewardShop,
  });

  const events: GameEvent[] = [];
  bus.on("level:phase", (e) => events.push(e));
  bus.on("level:up", (e) => events.push(e));
  bus.on("xp:gained", (e) => events.push(e));
  bus.on("timer:tick", (e) => events.push(e));
  bus.on("portal:appeared", (e) => events.push(e));

  return {
    bus,
    runtime,
    enemies,
    map,
    rewardShop,
    clock,
    port,
    events,
    dispose: () => port.__dispose(),
  };
}

function phaseEvents(h: Harness, scene: string) {
  return h.events.filter(
    (e): e is Extract<GameEvent, { type: "level:phase" }> =>
      e.type === "level:phase" && e.scene === scene,
  );
}

function tickMs(h: Harness, ms: number): void {
  h.runtime.emitTick(ms);
}

describe("createProgressionModule — 端到端", () => {
  it("初始:character_select / level=1 / xp=0 / xpToNext=5", () => {
    const h = setupHarness();
    expect(h.port.scene()).toBe("character_select");
    expect(h.port.level()).toBe(1);
    expect(h.port.xp()).toBe(0);
    expect(h.port.xpToNext()).toBe(5);
    h.dispose();
  });

  it("pickCharacter → running + clock.start + loadLevel + timer=duration", () => {
    const h = setupHarness();
    h.port.pickCharacter("default");
    expect(h.port.scene()).toBe("running");
    expect(h.port.timer()).toBe(30); // level 1 duration
    expect(h.map.loadedLevels).toEqual(["level-1"]);
    expect(h.clock.isRunning).toBe(true);
    h.dispose();
  });

  it("plan §8 验收:enemy:killed xp=3 → xp=3 < 5(未升级)", () => {
    const h = setupHarness();
    h.port.pickCharacter("default");
    h.bus.emit({ type: "enemy:killed", kind: "chaser", x: 0, y: 0, xp: 3 });
    expect(h.port.xp()).toBe(3);
    expect(h.port.scene()).toBe("running");
    h.dispose();
  });

  it("plan §8 验收:enemy:killed xp=5 单发 → 触发升级 + level:up + level:phase scene=levelup_modal + clock.stop", () => {
    const h = setupHarness();
    h.port.pickCharacter("default");
    h.bus.emit({ type: "enemy:killed", kind: "chaser", x: 0, y: 0, xp: 5 });
    expect(h.port.xp()).toBe(5);
    expect(h.port.scene()).toBe("levelup_modal");
    const levelUp = h.events.filter(
      (e): e is Extract<GameEvent, { type: "level:up" }> => e.type === "level:up",
    );
    expect(levelUp).toHaveLength(1);
    expect(levelUp[0].level).toBe(2);
    expect(levelUp[0].choices.length).toBe(3);
    expect(phaseEvents(h, "levelup_modal")).toHaveLength(1);
    expect(h.clock.isRunning).toBe(false);
    h.dispose();
  });

  it("plan §8 验收:levelup_modal → reward:picked → running + applyReward + clock.start", () => {
    const h = setupHarness();
    h.port.pickCharacter("default");
    h.bus.emit({ type: "enemy:killed", kind: "chaser", x: 0, y: 0, xp: 5 });
    expect(h.port.scene()).toBe("levelup_modal");
    expect(h.clock.isRunning).toBe(false);
    h.bus.emit({ type: "reward:picked", id: "heal_small", kind: "levelup" });
    expect(h.rewardShop.appliedIds).toEqual(["heal_small"]);
    expect(h.port.scene()).toBe("running");
    expect(h.clock.isRunning).toBe(true);
    h.dispose();
  });

  it("applyReward 失败时 no-op + warn(不抛错)", () => {
    const h = setupHarness();
    h.port.pickCharacter("default");
    h.bus.emit({ type: "enemy:killed", kind: "chaser", x: 0, y: 0, xp: 5 });
    h.rewardShop.setApplyResult({ ok: false, reason: "unregistered" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.bus.emit({ type: "reward:picked", id: "heal_small", kind: "levelup" });
    expect(h.rewardShop.appliedIds).toEqual(["heal_small"]);
    expect(h.port.scene()).toBe("running");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    h.dispose();
  });

  it("plan §8 验收:推进 30 秒 → portal scene + portal:appeared 1 次", () => {
    const h = setupHarness();
    h.port.pickCharacter("default");
    expect(h.port.timer()).toBe(30);
    tickMs(h, 30000);
    expect(h.port.scene()).toBe("portal");
    const portalAppeared = h.events.filter(
      (e): e is Extract<GameEvent, { type: "portal:appeared" }> => e.type === "portal:appeared",
    );
    expect(portalAppeared).toHaveLength(1);
    const portalPhase = phaseEvents(h, "portal")[0];
    expect(portalPhase.context).toMatchObject({ scene: "portal" });
    if (portalPhase.context.scene === "portal") {
      expect(portalPhase.context.portalPos).toEqual({ x: 1950, y: 1950 });
      expect(portalPhase.context.remainingEnemies).toBe(0);
    }
    h.dispose();
  });

  it("portal → advance() → shop(scene 非 final)", () => {
    const h = setupHarness();
    h.port.pickCharacter("default");
    tickMs(h, 30000);
    expect(h.port.scene()).toBe("portal");
    h.port.advance();
    expect(h.port.scene()).toBe("shop");
    const shopPhase = phaseEvents(h, "shop")[0];
    if (shopPhase.context.scene === "shop") {
      expect(shopPhase.context.items.length).toBe(4);
    }
    h.dispose();
  });

  it("shop → advance() → running(stage 2, levelIdFor='level-2', timer=35)", () => {
    const h = setupHarness();
    h.port.pickCharacter("default");
    tickMs(h, 30000);
    h.port.advance();
    h.port.advance();
    expect(h.port.scene()).toBe("running");
    expect(h.map.loadedLevels).toEqual(["level-1", "level-2"]);
    expect(h.port.timer()).toBe(35);
    h.dispose();
  });

  it("stage 5 isFinal + enemies 0 → tick 后 → victory", () => {
    const h = setupHarness();
    h.port.pickCharacter("default");
    // 推进到 stage 5:每关 duration 不同(30/35/40/45/60),造一个足够大的 tick 覆盖所有。
    // 每关需要:timer 归零 → portal → advance (shop) → advance (running 下一关)。
    // 60_000ms 一次推进足以跨过任何关。
    for (let i = 0; i < 4; i++) {
      tickMs(h, 60_000);
      h.port.advance(); // portal → shop
      h.port.advance(); // shop → running 下一关
    }
    expect(h.port.stage()).toBe(5);
    expect(h.enemies.count()).toBe(0);
    tickMs(h, 100);
    expect(h.port.scene()).toBe("victory");
    h.dispose();
  });

  it("player:died(任意 scene)→ gameover + clock.stop", () => {
    const h = setupHarness();
    h.port.pickCharacter("default");
    expect(h.clock.isRunning).toBe(true);
    h.bus.emit({ type: "player:died", at: 1000 });
    expect(h.port.scene()).toBe("gameover");
    expect(h.clock.isRunning).toBe(false);
    const gameoverPhase = phaseEvents(h, "gameover")[0];
    expect(gameoverPhase.context.scene).toBe("gameover");
    h.dispose();
  });

  it("pauseToggle(running)切 paused + clock.stop;再 toggle 切回 + clock.start", () => {
    const h = setupHarness();
    h.port.pickCharacter("default");
    expect(h.clock.isRunning).toBe(true);
    h.port.pauseToggle();
    expect(h.port.scene()).toBe("running");
    expect(h.clock.isRunning).toBe(false);
    const t1 = h.port.timer();
    tickMs(h, 1000);
    expect(h.port.timer()).toBe(t1);
    h.port.pauseToggle();
    expect(h.clock.isRunning).toBe(true);
    tickMs(h, 1000);
    expect(h.port.timer()).toBeLessThan(t1);
    h.dispose();
  });

  it("startRun 从 gameover 回 character_select + 清统计", () => {
    const h = setupHarness();
    h.port.pickCharacter("default");
    h.bus.emit({ type: "enemy:killed", kind: "chaser", x: 0, y: 0, xp: 3 });
    h.bus.emit({ type: "player:died", at: 1000 });
    expect(h.port.scene()).toBe("gameover");
    h.port.startRun();
    expect(h.port.scene()).toBe("character_select");
    expect(h.port.xp()).toBe(0);
    expect(h.port.level()).toBe(1);
    h.dispose();
  });

  it("projectile:hit 累加本局 damageDealt;gameover.stats 可读", () => {
    const h = setupHarness();
    h.port.pickCharacter("default");
    h.bus.emit({
      type: "projectile:hit",
      x: 0,
      y: 0,
      targetKind: "chaser",
      damage: 10,
      isKill: false,
    });
    h.bus.emit({
      type: "projectile:hit",
      x: 0,
      y: 0,
      targetKind: "chaser",
      damage: 5,
      isKill: false,
    });
    h.bus.emit({ type: "player:died", at: 1000 });
    const gameoverPhase = phaseEvents(h, "gameover")[0];
    if (gameoverPhase.context.scene === "gameover") {
      expect(gameoverPhase.context.stats.damageDealt).toBe(15);
      expect(gameoverPhase.context.stats.kills).toBe(0);
    }
    h.dispose();
  });

  it("enemy:killed 累计本局 kills", () => {
    const h = setupHarness();
    h.port.pickCharacter("default");
    h.bus.emit({ type: "enemy:killed", kind: "chaser", x: 0, y: 0, xp: 1 });
    h.bus.emit({ type: "enemy:killed", kind: "chaser", x: 0, y: 0, xp: 1 });
    h.bus.emit({ type: "player:died", at: 1000 });
    const gameoverPhase = phaseEvents(h, "gameover")[0];
    if (gameoverPhase.context.scene === "gameover") {
      expect(gameoverPhase.context.stats.kills).toBe(2);
    }
    h.dispose();
  });

  it("endRun(running)→ gameover(手动弃局)", () => {
    const h = setupHarness();
    h.port.pickCharacter("default");
    h.port.endRun();
    expect(h.port.scene()).toBe("gameover");
    h.dispose();
  });

  it("levelup_modal 收到 kind='shop' 的 reward:picked → no-op(scene 不切,applyReward 不调)", () => {
    const h = setupHarness();
    h.port.pickCharacter("default");
    h.bus.emit({ type: "enemy:killed", kind: "chaser", x: 0, y: 0, xp: 5 });
    expect(h.port.scene()).toBe("levelup_modal");
    h.bus.emit({ type: "reward:picked", id: "heal_small", kind: "shop" });
    expect(h.port.scene()).toBe("levelup_modal");
    expect(h.rewardShop.appliedIds).toEqual([]);
    h.dispose();
  });

  it("timer 推进到 portal 时,SceneContext 携带 portalPos + remainingEnemies", () => {
    const h = setupHarness();
    h.port.pickCharacter("default");
    // 加 1 个敌人,remainingEnemies 应为 1
    h.enemies.addEnemy({ id: 1, kind: "chaser", pos: { x: 100, y: 100 }, hp: 50, maxHp: 50 });
    tickMs(h, 30000);
    const portalPhase = phaseEvents(h, "portal")[0];
    if (portalPhase.context.scene === "portal") {
      expect(portalPhase.context.remainingEnemies).toBe(1);
    }
    h.dispose();
  });
});
