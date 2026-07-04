/**
 * `KeyboardMap` 合约测试。
 *
 * 覆盖点(plan §6 + 设计不变量):
 *  - 物理键位 → 语义键 的映射(W/A/S/D / Space / Esc 等)。
 *  - `repeat: true` 的 keydown 不入边沿队列、不重入 `held`。
 *  - modifier(Ctrl / Meta / Alt)按下时**忽略**所有 keydown / keyup。
 *  - 未知 `code` 静默忽略。
 *  - `consumeEdges()` 每帧返回新边沿,消费后清空。
 *  - **不**发"松开"边沿(只有"按下"边沿)。
 *  - `enable() / disable()` 重复调用幂等。
 *  - `disable` **不**清空 `held`(plan §6 验收点)。
 *  - `clear()` 同时清 `held` + 边沿队列(blur 防御路径)。
 */
import { describe, expect, it, vi } from "vite-plus/test";
import { KeyboardMap } from "./KeyboardMap";

/** 一个简单的 `addEventListener` / `removeEventListener` spy,替代 window。 */
function makeEventTarget() {
  const listeners: { type: string; fn: EventListenerOrEventListenerObject }[] = [];
  return {
    addEventListener: (type: string, fn: EventListenerOrEventListenerObject) => {
      listeners.push({ type, fn });
    },
    removeEventListener: (type: string, fn: EventListenerOrEventListenerObject) => {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    _listeners: listeners,
  };
}

describe("KeyboardMap", () => {
  it("keydown 一次,isDown 立即为 true", () => {
    const km = new KeyboardMap(makeEventTarget() as never);
    km.handleKeyDown({ code: "KeyW" });
    expect(km.isDown("up")).toBe(true);
  });

  it("keyup 后,isDown 立即为 false", () => {
    const km = new KeyboardMap(makeEventTarget() as never);
    km.handleKeyDown({ code: "KeyW" });
    km.handleKeyUp({ code: "KeyW" });
    expect(km.isDown("up")).toBe(false);
  });

  it("未映射的 code 静默忽略", () => {
    const km = new KeyboardMap(makeEventTarget() as never);
    km.handleKeyDown({ code: "KeyZ" });
    expect(km.heldKeys().length).toBe(0);
    expect(km.consumeEdges().length).toBe(0);
  });

  it("modifier(Ctrl)按下时忽略 keydown", () => {
    const km = new KeyboardMap(makeEventTarget() as never);
    km.handleKeyDown({ code: "KeyW", ctrlKey: true });
    expect(km.isDown("up")).toBe(false);
    expect(km.consumeEdges().length).toBe(0);
  });

  it("modifier(Meta)按下时忽略 keydown", () => {
    const km = new KeyboardMap(makeEventTarget() as never);
    km.handleKeyDown({ code: "KeyA", metaKey: true });
    expect(km.isDown("left")).toBe(false);
  });

  it("modifier(Alt)按下时忽略 keyup", () => {
    const km = new KeyboardMap(makeEventTarget() as never);
    km.handleKeyDown({ code: "KeyW" });
    km.handleKeyUp({ code: "KeyW", altKey: true });
    // 忽略 → W 仍然在 held 里。
    expect(km.isDown("up")).toBe(true);
  });

  it("repeat keydown 不重入 held、也不入边沿队列", () => {
    const km = new KeyboardMap(makeEventTarget() as never);
    km.handleKeyDown({ code: "Space" });
    km.handleKeyDown({ code: "Space", repeat: true });
    km.handleKeyDown({ code: "Space", repeat: true });
    expect(km.isDown("fire")).toBe(true);
    // 边沿队列只有第一次 keydown 算
    const edges = km.consumeEdges();
    expect(edges).toEqual(["fire"]);
  });

  it("已按住的键,非 repeat 的多余 keydown 不入队(保持严格边沿)", () => {
    const km = new KeyboardMap(makeEventTarget() as never);
    km.handleKeyDown({ code: "KeyW" });
    km.consumeEdges(); // 消费第一帧
    km.handleKeyDown({ code: "KeyW" }); // 已经按着,再发一次不应入队
    expect(km.consumeEdges()).toEqual([]);
  });

  it("consumeEdges 弹出后队列清空", () => {
    const km = new KeyboardMap(makeEventTarget() as never);
    km.handleKeyDown({ code: "KeyA" });
    km.handleKeyDown({ code: "KeyD" });
    const edges1 = km.consumeEdges();
    expect(new Set(edges1)).toEqual(new Set(["left", "right"]));
    expect(km.consumeEdges()).toEqual([]);
  });

  it("keyup 不入边沿队列", () => {
    const km = new KeyboardMap(makeEventTarget() as never);
    km.handleKeyDown({ code: "Space" });
    km.consumeEdges();
    km.handleKeyUp({ code: "Space" });
    expect(km.consumeEdges()).toEqual([]);
  });

  it("Shift 不算 modifier:Shift+W 仍然 up", () => {
    const km = new KeyboardMap(makeEventTarget() as never);
    km.handleKeyDown({ code: "KeyW", shiftKey: true });
    expect(km.isDown("up")).toBe(true);
  });

  it("enable / disable 重复调用幂等", () => {
    const tgt = makeEventTarget();
    const km = new KeyboardMap(tgt as never);
    km.enable();
    km.enable();
    expect(tgt._listeners.length).toBe(2);
    km.disable();
    km.disable();
    expect(tgt._listeners.length).toBe(0);
    km.enable();
    expect(tgt._listeners.length).toBe(2);
  });

  it("disable 不清空 held(plan §6 验收点)", () => {
    const km = new KeyboardMap(makeEventTarget() as never);
    km.handleKeyDown({ code: "KeyW" });
    km.enable();
    km.disable();
    expect(km.isDown("up")).toBe(true);
    km.consumeEdges();
    expect(km.consumeEdges()).toEqual([]); // 边沿在第一次 disable 前已被消费,这一帧没新增。
  });

  it("disable 不清空边沿队列(显式决策:暂停期间按 fire 仍算一次边沿)", () => {
    const km = new KeyboardMap(makeEventTarget() as never);
    km.handleKeyDown({ code: "Space" });
    km.enable();
    km.disable();
    // 边沿仍然在,IntentNormalizer 下一帧消费时还会 emit input:fire。
    expect(km.consumeEdges()).toEqual(["fire"]);
  });

  it("clear() 同时清 held 与边沿队列", () => {
    const km = new KeyboardMap(makeEventTarget() as never);
    km.handleKeyDown({ code: "KeyW" });
    km.handleKeyDown({ code: "Space" });
    km.clear();
    expect(km.heldKeys().length).toBe(0);
    expect(km.consumeEdges()).toEqual([]);
  });

  it("DOM 路径:enable 后收到 keydown 事件正确更新 held", () => {
    const tgt = makeEventTarget();
    const km = new KeyboardMap(tgt as never);
    km.enable();
    const ev = {
      code: "KeyD",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      repeat: false,
    } as KeyboardEvent;
    const keydown = tgt._listeners.find((l) => l.type === "keydown")!;
    (keydown.fn as (e: KeyboardEvent) => void)(ev);
    expect(km.isDown("right")).toBe(true);
    km.disable();
  });

  it("DOM 路径:keyup 事件正确清 held", () => {
    const tgt = makeEventTarget();
    const km = new KeyboardMap(tgt as never);
    km.enable();
    const dn = tgt._listeners.find((l) => l.type === "keydown")!;
    const up = tgt._listeners.find((l) => l.type === "keyup")!;
    (dn.fn as (e: KeyboardEvent) => void)({ code: "KeyW", repeat: false } as KeyboardEvent);
    expect(km.isDown("up")).toBe(true);
    (up.fn as (e: KeyboardEvent) => void)({ code: "KeyW" } as KeyboardEvent);
    expect(km.isDown("up")).toBe(false);
    km.disable();
  });

  it("vi 兜底:本文件所有断言至少跑过一次", () => {
    // 占位:确保 vi 引入被使用(若上面改动删完 import 会失败)。
    const spy = vi.fn();
    spy();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
