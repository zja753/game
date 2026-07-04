/**
 * `IntentNormalizer` 合约测试。
 *
 * 覆盖点(plan §6 验收点):
 *  - WASD 复合按压的 `axisMove()` 输出符合预期,模长 = 1。
 *  - `flush()` 边沿 → `input:fire` 仅发一次(再次按下才发下一次)。
 *  - `flush()` 在 axis 变化时发 `input:move`,无变化不发。
 *  - "玩家松开归零"也发 `input:move`(`lastAxis` 状态从非零 → 零)。
 *  - 视口中心与 `screenPos` 重合时,`axisAim()` 返回 `{x:0, y:0}`。
 *  - 视口中心 → 任意点的 `axisAim()` 是单位向量。
 */
import { describe, expect, it } from "vite-plus/test";
import { IntentNormalizer } from "./IntentNormalizer";
import { createGameEventBus } from "../../../runtime/EventBus";
import type { InputKey } from "../../../runtime/types";
import type { Vec2 } from "../../../runtime/types";

/** 构造一组可控的 KeyboardMap-shaped deps(纯 in-memory,不走 DOM)。 */
function makeDeps(viewport = { width: 800, height: 600 }) {
  const held = new Set<InputKey>();
  let pendingEdges: InputKey[] = [];
  const bus = createGameEventBus();
  return {
    bus,
    deps: {
      bus,
      isDown: (k: InputKey) => held.has(k),
      consumeEdges: () => {
        if (pendingEdges.length === 0) return [] as ReadonlyArray<InputKey>;
        const out = pendingEdges;
        pendingEdges = [];
        return out;
      },
      viewportSize: () => viewport,
    },
    press: (k: InputKey) => {
      if (held.has(k)) return;
      held.add(k);
      pendingEdges.push(k);
    },
    release: (k: InputKey) => {
      held.delete(k);
    },
  };
}

const ONE_OVER_SQRT2 = 1 / Math.sqrt(2);

describe("IntentNormalizer.axisMove", () => {
  it("空按键时返回零向量", () => {
    const { deps } = makeDeps();
    const n = new IntentNormalizer(deps);
    expect(n.axisMove()).toEqual({ x: 0, y: 0 });
  });

  it("单按 W:返回 (0, -1)", () => {
    const { deps, press } = makeDeps();
    press("up");
    const n = new IntentNormalizer(deps);
    expect(n.axisMove()).toEqual({ x: 0, y: -1 });
  });

  it("单按 D:返回 (1, 0)", () => {
    const { deps, press } = makeDeps();
    press("right");
    expect(new IntentNormalizer(deps).axisMove()).toEqual({ x: 1, y: 0 });
  });

  it("W+D 复合:返回归一化 (1/√2, -1/√2),模长 = 1", () => {
    const { deps, press } = makeDeps();
    press("up");
    press("right");
    const axis = new IntentNormalizer(deps).axisMove();
    expect(axis.x).toBeCloseTo(ONE_OVER_SQRT2);
    expect(axis.y).toBeCloseTo(-ONE_OVER_SQRT2);
    expect(Math.hypot(axis.x, axis.y)).toBeCloseTo(1);
  });

  it("W+A 复合(对角反向):返回 (-1/√2, -1/√2),模长 = 1", () => {
    const { deps, press } = makeDeps();
    press("up");
    press("left");
    const axis = new IntentNormalizer(deps).axisMove();
    expect(axis.x).toBeCloseTo(-ONE_OVER_SQRT2);
    expect(axis.y).toBeCloseTo(-ONE_OVER_SQRT2);
    expect(Math.hypot(axis.x, axis.y)).toBeCloseTo(1);
  });

  it("W+S 对按(垂直反向):返回 (0, 0),模长 = 0", () => {
    const { deps, press } = makeDeps();
    press("up");
    press("down");
    const axis = new IntentNormalizer(deps).axisMove();
    expect(axis).toEqual({ x: 0, y: 0 });
  });
});

describe("IntentNormalizer.axisAim", () => {
  it("screenPos 与视口中心重合时返回零向量", () => {
    const { deps } = makeDeps({ width: 800, height: 600 });
    const n = new IntentNormalizer(deps);
    expect(n.axisAim({ x: 400, y: 300 })).toEqual({ x: 0, y: 0 });
  });

  it("screenPos 在视口右上:返回 (1/√2, 1/√2),模长 = 1", () => {
    const { deps } = makeDeps({ width: 800, height: 600 });
    // 视口中心 (400, 300),目标 (500, 400) → 差 (100, 100) → 归一化 (1/√2, 1/√2)
    const axis = new IntentNormalizer(deps).axisAim({ x: 500, y: 400 });
    expect(axis.x).toBeCloseTo(ONE_OVER_SQRT2);
    expect(axis.y).toBeCloseTo(ONE_OVER_SQRT2);
    expect(Math.hypot(axis.x, axis.y)).toBeCloseTo(1);
  });

  it("screenPos 纯右移 100:返回 (1, 0)", () => {
    const { deps } = makeDeps({ width: 800, height: 600 });
    const axis = new IntentNormalizer(deps).axisAim({ x: 500, y: 300 });
    expect(axis).toEqual({ x: 1, y: 0 });
  });
});

describe("IntentNormalizer.flush", () => {
  it("axis 变化时 emit input:move;无变化时不 emit", () => {
    const { deps, press } = makeDeps();
    const n = new IntentNormalizer(deps);
    const moveEvents: Vec2[] = [];
    deps.bus.on("input:move", (e) => moveEvents.push({ x: e.dx, y: e.dy }));

    // 初始帧:无按键 → axis = (0,0),与 lastAxis 一致 → 不发
    n.flush();
    expect(moveEvents.length).toBe(0);

    // 按 W → axis 变化 → 发
    press("up");
    n.flush();
    expect(moveEvents.length).toBe(1);
    expect(moveEvents[0]).toEqual({ x: 0, y: -1 });

    // 第二次 flush:axis 不变 → 不发
    n.flush();
    expect(moveEvents.length).toBe(1);
  });

  it("玩家松开归零时也发 input:move", () => {
    const { deps, press, release } = makeDeps();
    const n = new IntentNormalizer(deps);
    const moveEvents: Vec2[] = [];
    deps.bus.on("input:move", (e) => moveEvents.push({ x: e.dx, y: e.dy }));

    press("up");
    n.flush();
    expect(moveEvents.length).toBe(1);
    release("up");
    n.flush();
    expect(moveEvents.length).toBe(2);
    expect(moveEvents[1]).toEqual({ x: 0, y: 0 });
  });

  it("fire 边沿触发一次 input:fire;松开再按才发下一次", () => {
    const { deps, press, release } = makeDeps();
    const n = new IntentNormalizer(deps);
    const fireEvents: number[] = [];
    deps.bus.on("input:fire", () => fireEvents.push(1));

    press("fire");
    n.flush();
    expect(fireEvents.length).toBe(1);

    // 第二次 flush:不按 fire,不发
    n.flush();
    expect(fireEvents.length).toBe(1);

    // 持续按住(不松开),再 flush:依然不发
    n.flush();
    expect(fireEvents.length).toBe(1);

    // 松开,再按:才发下一次
    release("fire");
    press("fire");
    n.flush();
    expect(fireEvents.length).toBe(2);
  });

  it("pause 边沿触发一次 input:pause", () => {
    const { deps, press } = makeDeps();
    const n = new IntentNormalizer(deps);
    const pauseEvents: number[] = [];
    deps.bus.on("input:pause", () => pauseEvents.push(1));

    press("pause");
    n.flush();
    expect(pauseEvents.length).toBe(1);

    n.flush();
    expect(pauseEvents.length).toBe(1);
  });

  it("移动键的边沿不 emit 任何事件(只有 axis 变化时 emit move)", () => {
    const { deps, press } = makeDeps();
    const n = new IntentNormalizer(deps);
    const fireEvents: number[] = [];
    const pauseEvents: number[] = [];
    const moveEvents: number[] = [];
    deps.bus.on("input:fire", () => fireEvents.push(1));
    deps.bus.on("input:pause", () => pauseEvents.push(1));
    deps.bus.on("input:move", () => moveEvents.push(1));

    press("up");
    n.flush();
    // move 应当发 1 次;fire / pause 都不发
    expect(moveEvents.length).toBe(1);
    expect(fireEvents.length).toBe(0);
    expect(pauseEvents.length).toBe(0);
  });

  it("单帧内 fire + pause 同时按:两个事件都发", () => {
    const { deps, press } = makeDeps();
    const n = new IntentNormalizer(deps);
    const fireEvents: number[] = [];
    const pauseEvents: number[] = [];
    deps.bus.on("input:fire", () => fireEvents.push(1));
    deps.bus.on("input:pause", () => pauseEvents.push(1));

    press("fire");
    press("pause");
    n.flush();
    expect(fireEvents.length).toBe(1);
    expect(pauseEvents.length).toBe(1);
  });
});
