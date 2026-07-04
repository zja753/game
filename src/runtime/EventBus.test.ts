/**
 * `createGameEventBus` 合约测试。
 *
 * 覆盖点(plan §2.1):
 *  - `on(type, handler)` 返回反订阅函数;调反订阅后 handler 不再被调。
 *  - `emit(event)` 同步广播,只有注册过 `type` 的 handler 收到。
 *  - handler 内部 `off` 自己不影响本次 emit 遍历(基于 Set 拷贝迭代)。
 *  - `clear()` 清空所有订阅。
 *  - 类型层面:订阅 `input:fire` 时 handler 收到的 payload 一定带 `pressed: true`。
 */
import { describe, expect, it, vi } from "vite-plus/test";
import { createGameEventBus } from "./EventBus";
import type { InputFireEvent, InputMoveEvent } from "./EventBus";

describe("createGameEventBus", () => {
  it("emit 触发同 type 的 handler;其他 type 不触发", () => {
    const bus = createGameEventBus();
    const move = vi.fn();
    const fire = vi.fn();
    bus.on("input:move", move);
    bus.on("input:fire", fire);
    bus.emit({ type: "input:move", dx: 1, dy: 0 });
    expect(move).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledTimes(0);
  });

  it("反订阅后 handler 不再被调", () => {
    const bus = createGameEventBus();
    const h = vi.fn();
    const off = bus.on("input:move", h);
    bus.emit({ type: "input:move", dx: 1, dy: 0 });
    off();
    bus.emit({ type: "input:move", dx: 1, dy: 0 });
    expect(h).toHaveBeenCalledTimes(1);
  });

  it("handler 内反订阅自己,本次 emit 后续 handler 仍可执行", () => {
    const bus = createGameEventBus();
    const h1 = vi.fn(() => off1());
    const h2 = vi.fn();
    const off1 = bus.on("input:move", h1);
    bus.on("input:move", h2);
    bus.emit({ type: "input:move", dx: 0, dy: 0 });
    // h1 反订阅后下一次 emit 不会再被调
    bus.emit({ type: "input:move", dx: 0, dy: 0 });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(2);
    void off1;
  });

  it("clear 清空所有订阅", () => {
    const bus = createGameEventBus();
    const h = vi.fn();
    bus.on("input:move", h);
    bus.on("input:fire", () => {});
    bus.clear();
    bus.emit({ type: "input:move", dx: 0, dy: 0 });
    bus.emit({ type: "input:fire", pressed: true });
    expect(h).toHaveBeenCalledTimes(0);
  });

  it("subscriberCount 反映订阅数(跨 type 合计)", () => {
    const bus = createGameEventBus();
    expect(bus.subscriberCount()).toBe(0);
    const a = bus.on("input:move", () => {});
    bus.on("input:fire", () => {});
    bus.on("input:pause", () => {});
    expect(bus.subscriberCount()).toBe(3);
    a();
    expect(bus.subscriberCount()).toBe(2);
  });

  it("类型层面:订阅 input:fire 的 handler 收到的 payload 带 pressed:true", () => {
    const bus = createGameEventBus();
    let received: InputFireEvent | null = null;
    bus.on("input:fire", (e) => {
      received = e;
    });
    bus.emit({ type: "input:fire", pressed: true });
    expect(received).not.toBeNull();
    expect((received as unknown as InputFireEvent).pressed).toBe(true);
  });

  it("类型层面:订阅 input:move 的 handler 收到 dx / dy 数字", () => {
    const bus = createGameEventBus();
    let received: InputMoveEvent | null = null;
    bus.on("input:move", (e) => {
      received = e;
    });
    bus.emit({ type: "input:move", dx: 0.5, dy: -0.5 });
    expect(received).toEqual({ type: "input:move", dx: 0.5, dy: -0.5 });
  });
});
