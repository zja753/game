/**
 * `MouseMap` 合约测试。
 *
 * 覆盖点:
 *  - `mousemove` 更新 `position()`。
 *  - `mousedown` / `mouseup` 更新按钮位掩码。
 *  - `position()` 返回**新对象**(防御性拷贝,改返回不影响内部)。
 *  - `enable / disable` 重复调用幂等,挂 / 摘 DOM 监听。
 *  - `disable` 不清空 pos / buttons(plan §6 验收点)。
 *  - `clear()` 同时清 pos + buttons。
 *  - 鼠标事件**不**走 modifier 抑制(键盘 modifier 与鼠标无关)。
 */
import { describe, expect, it } from "vite-plus/test";
import { MouseMap, MouseButton } from "./MouseMap";

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

describe("MouseMap", () => {
  it("初始 position = {0, 0}", () => {
    const mm = new MouseMap(makeEventTarget() as never);
    expect(mm.position()).toEqual({ x: 0, y: 0 });
  });

  it("mousemove 更新 position", () => {
    const mm = new MouseMap(makeEventTarget() as never);
    mm.handleMouseMove({ clientX: 100, clientY: 200 });
    expect(mm.position()).toEqual({ x: 100, y: 200 });
  });

  it("position 返回新对象(改返回不影响内部)", () => {
    const mm = new MouseMap(makeEventTarget() as never);
    mm.handleMouseMove({ clientX: 50, clientY: 60 });
    const p1 = mm.position();
    p1.x = 999;
    expect(mm.position().x).toBe(50);
  });

  it("mousedown 左键 / 中键 / 右键 位掩码正确", () => {
    const mm = new MouseMap(makeEventTarget() as never);
    mm.handleMouseDown({ button: 0 });
    expect(mm.buttonsDown()).toBe(MouseButton.Left);
    mm.handleMouseDown({ button: 1 });
    expect(mm.buttonsDown()).toBe(MouseButton.Left | MouseButton.Middle);
    mm.handleMouseDown({ button: 2 });
    expect(mm.buttonsDown()).toBe(MouseButton.Left | MouseButton.Right | MouseButton.Middle);
  });

  it("mouseup 清除对应位", () => {
    const mm = new MouseMap(makeEventTarget() as never);
    mm.handleMouseDown({ button: 0 });
    mm.handleMouseDown({ button: 2 });
    mm.handleMouseUp({ button: 0 });
    expect(mm.buttonsDown()).toBe(MouseButton.Right);
  });

  it("未知 button 码被忽略", () => {
    const mm = new MouseMap(makeEventTarget() as never);
    mm.handleMouseDown({ button: 99 });
    expect(mm.buttonsDown()).toBe(MouseButton.None);
  });

  it("enable / disable 重复调用幂等", () => {
    const tgt = makeEventTarget();
    const mm = new MouseMap(tgt as never);
    mm.enable();
    mm.enable();
    expect(tgt._listeners.length).toBe(3);
    mm.disable();
    mm.disable();
    expect(tgt._listeners.length).toBe(0);
  });

  it("disable 不清空 position / buttons(plan §6 验收点)", () => {
    const mm = new MouseMap(makeEventTarget() as never);
    mm.handleMouseMove({ clientX: 100, clientY: 100 });
    mm.handleMouseDown({ button: 0 });
    mm.enable();
    mm.disable();
    expect(mm.position()).toEqual({ x: 100, y: 100 });
    expect(mm.buttonsDown()).toBe(MouseButton.Left);
  });

  it("clear 清空 pos + buttons", () => {
    const mm = new MouseMap(makeEventTarget() as never);
    mm.handleMouseMove({ clientX: 100, clientY: 100 });
    mm.handleMouseDown({ button: 0 });
    mm.clear();
    expect(mm.position()).toEqual({ x: 0, y: 0 });
    expect(mm.buttonsDown()).toBe(MouseButton.None);
  });

  it("DOM 路径:enable 后收到 mousemove 事件更新 position", () => {
    const tgt = makeEventTarget();
    const mm = new MouseMap(tgt as never);
    mm.enable();
    const ev = { clientX: 200, clientY: 300 } as MouseEvent;
    const listener = tgt._listeners.find((l) => l.type === "mousemove")!;
    (listener.fn as (e: MouseEvent) => void)(ev);
    expect(mm.position()).toEqual({ x: 200, y: 300 });
    mm.disable();
  });

  it("DOM 路径:enable 后 mousedown 更新位掩码", () => {
    const tgt = makeEventTarget();
    const mm = new MouseMap(tgt as never);
    mm.enable();
    const listener = tgt._listeners.find((l) => l.type === "mousedown")!;
    (listener.fn as (e: MouseEvent) => void)({ button: 0 } as MouseEvent);
    expect(mm.buttonsDown()).toBe(MouseButton.Left);
    mm.disable();
  });
});
