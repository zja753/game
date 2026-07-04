/**
 * `createInputModule` / `createMockInput` 合约测试。
 *
 * 覆盖点(plan §6 验收点 + 设计不变量):
 *  - 用 `createMockRuntime` + 自定义 DOM target 装配 `createInputModule`,
 *    跑端到端:模拟 keydown → emitTick → 事件出现。
 *  - `axisMove()` 复合归一化为单位向量。
 *  - `input:fire` 仅在按下瞬间发 1 次(松开再按才发下一次)。
 *  - `enable() / disable()` 切换**不**清空按键表。
 *  - `__dispose` 摘监听 + 反订阅 onTick。
 *  - `createMockInput` 工厂对其他模块的合约(spy / 驱动方法)。
 */
import { describe, expect, it } from "vite-plus/test";
import { createInputModule } from "./InputModule";
import { createMockInput } from "./__mocks__/mockInput";
import { createMockRuntime } from "../runtime/__mocks__/mockRuntime";
import { createGameEventBus } from "../../runtime/EventBus";
import type { GameEvent } from "../../runtime/EventBus";

const ONE_OVER_SQRT2 = 1 / Math.sqrt(2);

/**
 * 简单的 DOM target stub —— 满足 `EventTarget` 契约。
 *
 * `addEventListener` / `removeEventListener` 记录监听器;
 * `dispatch(type, ev)` 模拟浏览器分发事件;
 * `count(type)` 调试用。
 */
function makeDomTarget() {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const target: EventTarget = {
    addEventListener(type: string, fn: EventListenerOrEventListenerObject) {
      let s = listeners.get(type);
      if (!s) {
        s = new Set();
        listeners.set(type, s);
      }
      s.add(fn);
    },
    removeEventListener(type: string, fn: EventListenerOrEventListenerObject) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(_ev: Event): boolean {
      return true;
    },
  };
  return {
    target,
    dispatch(type: string, ev: Event) {
      const s = listeners.get(type);
      if (!s) return;
      for (const fn of Array.from(s)) {
        if (typeof fn === "function") fn(ev);
        else fn.handleEvent(ev);
      }
    },
    count(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

/** 构造一个 `KeyboardEvent` 形状的 fake event。 */
function fakeKey(
  code: string,
  opts: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean }> = {},
) {
  return {
    code,
    ctrlKey: !!opts.ctrlKey,
    metaKey: !!opts.metaKey,
    altKey: !!opts.altKey,
    repeat: !!opts.repeat,
  } as KeyboardEvent;
}

function fakeMouse(clientX: number, clientY: number) {
  return { clientX, clientY } as MouseEvent;
}

describe("createInputModule — 端到端", () => {
  it("装配后 onTick 订阅数 = 1", () => {
    const rt = createMockRuntime();
    const bus = createGameEventBus();
    const dom = makeDomTarget();
    const port = createInputModule({ bus, runtime: rt, target: dom.target });
    expect(rt.tickSubscriberCount()).toBe(1);
    (port as unknown as { __dispose: () => void }).__dispose();
  });

  it("enable 后挂上 keydown / keyup / mousemove / mousedown / mouseup", () => {
    const rt = createMockRuntime();
    const bus = createGameEventBus();
    const dom = makeDomTarget();
    const port = createInputModule({ bus, runtime: rt, target: dom.target });
    port.enable();
    expect(dom.count("keydown")).toBe(1);
    expect(dom.count("keyup")).toBe(1);
    expect(dom.count("mousemove")).toBe(1);
    expect(dom.count("mousedown")).toBe(1);
    expect(dom.count("mouseup")).toBe(1);
    (port as unknown as { __dispose: () => void }).__dispose();
  });

  it("axisMove 实时反映按键状态(单按 W)", () => {
    const rt = createMockRuntime();
    const bus = createGameEventBus();
    const dom = makeDomTarget();
    const port = createInputModule({ bus, runtime: rt, target: dom.target });
    port.enable();
    dom.dispatch("keydown", fakeKey("KeyW"));
    expect(port.axisMove()).toEqual({ x: 0, y: -1 });
    (port as unknown as { __dispose: () => void }).__dispose();
  });

  it("W+D 复合:axisMove 是单位向量(模长 = 1)", () => {
    const rt = createMockRuntime();
    const bus = createGameEventBus();
    const dom = makeDomTarget();
    const port = createInputModule({ bus, runtime: rt, target: dom.target });
    port.enable();
    dom.dispatch("keydown", fakeKey("KeyW"));
    dom.dispatch("keydown", fakeKey("KeyD"));
    const axis = port.axisMove();
    expect(axis.x).toBeCloseTo(ONE_OVER_SQRT2);
    expect(axis.y).toBeCloseTo(-ONE_OVER_SQRT2);
    expect(Math.hypot(axis.x, axis.y)).toBeCloseTo(1);
    (port as unknown as { __dispose: () => void }).__dispose();
  });

  it("onTick 触发:keydown 后第一帧 emit input:move", () => {
    const rt = createMockRuntime();
    const bus = createGameEventBus();
    const dom = makeDomTarget();
    const port = createInputModule({ bus, runtime: rt, target: dom.target });
    port.enable();

    const events: GameEvent[] = [];
    bus.on("input:move", (e) => events.push(e));

    dom.dispatch("keydown", fakeKey("KeyW"));
    rt.emitTick(16);
    expect(events.length).toBe(1);
    expect(events[0]).toEqual({ type: "input:move", dx: 0, dy: -1 });

    (port as unknown as { __dispose: () => void }).__dispose();
  });

  it("input:fire 仅在按下瞬间发 1 次;松开再按才发下一次(plan §6)", () => {
    const rt = createMockRuntime();
    const bus = createGameEventBus();
    const dom = makeDomTarget();
    const port = createInputModule({ bus, runtime: rt, target: dom.target });
    port.enable();

    const fires: GameEvent[] = [];
    bus.on("input:fire", (e) => fires.push(e));

    // 按下
    dom.dispatch("keydown", fakeKey("Space"));
    rt.emitTick(16);
    expect(fires.length).toBe(1);

    // 第二帧不按:不发
    rt.emitTick(16);
    expect(fires.length).toBe(1);

    // 持续按住(重复 keydown):不发
    dom.dispatch("keydown", fakeKey("Space", { repeat: true }));
    rt.emitTick(16);
    expect(fires.length).toBe(1);

    // 松开
    dom.dispatch("keyup", fakeKey("Space"));
    rt.emitTick(16);
    expect(fires.length).toBe(1);

    // 再按
    dom.dispatch("keydown", fakeKey("Space"));
    rt.emitTick(16);
    expect(fires.length).toBe(2);

    (port as unknown as { __dispose: () => void }).__dispose();
  });

  it("disable 不清空按键表(plan §6 验收点)", () => {
    const rt = createMockRuntime();
    const bus = createGameEventBus();
    const dom = makeDomTarget();
    const port = createInputModule({ bus, runtime: rt, target: dom.target });
    port.enable();
    dom.dispatch("keydown", fakeKey("KeyW"));
    expect(port.isDown("up")).toBe(true);
    port.disable();
    // disable 后 isDown 仍然为 true
    expect(port.isDown("up")).toBe(true);
    // 重新 enable
    port.enable();
    expect(port.isDown("up")).toBe(true);
    (port as unknown as { __dispose: () => void }).__dispose();
  });

  it("axisAim 在自定义 viewport 下从中心指向目标", () => {
    const rt = createMockRuntime({ viewportWidth: 1000, viewportHeight: 500 });
    const bus = createGameEventBus();
    const dom = makeDomTarget();
    const port = createInputModule({ bus, runtime: rt, target: dom.target });
    // 视口中心 (500, 250);目标 (700, 350) → 差 (200, 100) → 归一化
    const axis = port.axisAim({ x: 700, y: 350 });
    expect(Math.hypot(axis.x, axis.y)).toBeCloseTo(1);
    (port as unknown as { __dispose: () => void }).__dispose();
  });

  it("mousePos 反映最近一次 mousemove", () => {
    const rt = createMockRuntime();
    const bus = createGameEventBus();
    const dom = makeDomTarget();
    const port = createInputModule({ bus, runtime: rt, target: dom.target });
    port.enable();
    dom.dispatch("mousemove", fakeMouse(120, 240));
    expect(port.mousePos()).toEqual({ x: 120, y: 240 });
    (port as unknown as { __dispose: () => void }).__dispose();
  });

  it("__dispose 摘所有 DOM 监听 + 反订阅 onTick", () => {
    const rt = createMockRuntime();
    const bus = createGameEventBus();
    const dom = makeDomTarget();
    const port = createInputModule({ bus, runtime: rt, target: dom.target });
    port.enable();
    expect(dom.count("keydown")).toBe(1);
    (port as unknown as { __dispose: () => void }).__dispose();
    expect(dom.count("keydown")).toBe(0);
    expect(rt.tickSubscriberCount()).toBe(0);
  });
});

describe("createMockInput", () => {
  it("press / release 更新 isDown", () => {
    const m = createMockInput();
    m.press("up");
    expect(m.isDown("up")).toBe(true);
    m.release("up");
    expect(m.isDown("up")).toBe(false);
  });

  it("emitMove 在 axis 变化时 emit input:move", () => {
    const m = createMockInput();
    const events: GameEvent[] = [];
    m.on("input:move", (e) => events.push(e));
    m.press("right");
    m.emitMove();
    expect(events.length).toBe(1);
    expect(events[0]).toEqual({ type: "input:move", dx: 1, dy: 0 });
  });

  it("fire 边沿触发一次;松开再按才发下一次", () => {
    const m = createMockInput();
    const events: GameEvent[] = [];
    m.on("input:fire", (e) => events.push(e));
    m.press("fire");
    m.emitMove();
    m.emitMove();
    expect(events.length).toBe(1);
    m.release("fire");
    m.press("fire");
    m.emitMove();
    expect(events.length).toBe(2);
  });

  it("axisMove 复合归一化是单位向量", () => {
    const m = createMockInput();
    m.press("up");
    m.press("right");
    const axis = m.axisMove();
    expect(Math.hypot(axis.x, axis.y)).toBeCloseTo(1);
  });

  it("axisAim 从视口中心指向目标", () => {
    const m = createMockInput({ viewportWidth: 1000, viewportHeight: 500 });
    const axis = m.axisAim({ x: 700, y: 350 });
    expect(Math.hypot(axis.x, axis.y)).toBeCloseTo(1);
  });

  it("mousePos / moveMouse 反映最新位置", () => {
    const m = createMockInput();
    m.moveMouse({ x: 50, y: 60 });
    expect(m.mousePos()).toEqual({ x: 50, y: 60 });
  });

  it("reset 清空所有 spy 状态", () => {
    const m = createMockInput();
    m.press("up");
    m.moveMouse({ x: 10, y: 20 });
    m.emitMove();
    expect(m.heldKeys.length).toBe(1);
    expect(m.emitted.length).toBe(1);
    m.reset();
    expect(m.heldKeys.length).toBe(0);
    expect(m.emitted.length).toBe(0);
    expect(m.isDown("up")).toBe(false);
    expect(m.mousePos()).toEqual({ x: 0, y: 0 });
  });
});
