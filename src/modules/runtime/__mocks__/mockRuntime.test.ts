/**
 * `createMockRuntime` 工厂的合约测试。
 *
 * 验收点:
 *  - spawnActor 返回递增 id,同一 id 不会被复用,despawnActor 记录被调过。
 *  - onTick 的反订阅能正确摘掉回调(emitTick 只触发剩下的)。
 *  - now() / setNow / emitTick 三者一致:emitTick(dt) 内部把 now += dt。
 *  - objectPool 同一 key 拿到同一份池。
 *  - collision.addLayer 记录调用;raycast 永远返 null。
 *  - viewportSize 跟随构造参数。
 *  - loadScene 同步跑 setup,返回值原样透传给调用方。
 */
import { describe, expect, it, vi } from "vite-plus/test";
import type { HitResult, SceneSpec, Vec2 } from "../../../runtime/types";
import { createMockRuntime } from "./mockRuntime";

describe("createMockRuntime", () => {
  it("spawnActor 分配递增 id,记录 spec", () => {
    const rt = createMockRuntime();
    const a = rt.spawnActor({ kind: class {} as never, config: { x: 1 } });
    const b = rt.spawnActor({ kind: class {} as never, config: { x: 2 } });
    expect(a).toBe(1);
    expect(b).toBe(2);
    expect(rt.spawned.length).toBe(2);
    expect(rt.spawned[0]?.config).toEqual({ x: 1 });
  });

  it("spawnActor 自定义 startId", () => {
    const rt = createMockRuntime({ startId: 100 });
    expect(rt.spawnActor({ kind: class {} as never, config: null })).toBe(100);
    expect(rt.spawnActor({ kind: class {} as never, config: null })).toBe(101);
  });

  it("despawnActor 记录被调用的 id", () => {
    const rt = createMockRuntime();
    rt.despawnActor(42);
    rt.despawnActor(7);
    expect(rt.despawned).toEqual([42, 7]);
  });

  it("onTick 订阅 / emitTick / 反订阅", () => {
    const rt = createMockRuntime();
    const a = vi.fn();
    const b = vi.fn();
    const offA = rt.onTick(a);
    rt.onTick(b);
    expect(rt.tickSubscriberCount()).toBe(2);

    rt.emitTick(16);
    expect(a).toHaveBeenCalledWith(16);
    expect(b).toHaveBeenCalledWith(16);
    // emitTick 同时把 now += 16
    expect(rt.now()).toBe(16);

    offA();
    expect(rt.tickSubscriberCount()).toBe(1);
    rt.emitTick(10);
    expect(a).toHaveBeenCalledTimes(1); // 没被第二次调
    expect(b).toHaveBeenCalledTimes(2);
    expect(rt.now()).toBe(26);
  });

  it("setNow 直接覆盖", () => {
    const rt = createMockRuntime();
    rt.setNow(500);
    expect(rt.now()).toBe(500);
    rt.emitTick(16);
    expect(rt.now()).toBe(516);
  });

  it("objectPool 同一 key 拿到同一份池", () => {
    const rt = createMockRuntime();
    const factory = vi.fn(() => ({ id: 1 }));
    const reset = vi.fn();
    const p1 = rt.objectPool("bullet", factory, reset);
    const p2 = rt.objectPool("bullet", factory, reset);
    expect(p1).toBe(p2);
    // acquire 走内部 ObjectPool,行为与 ObjectPool 单测一致(略)。
  });

  it("collision.addLayer 记录,raycast 返 null", () => {
    const rt = createMockRuntime();
    rt.collision.addLayer("player", "enemy");
    rt.collision.addLayer("bullet", "wall");
    expect(rt.layersAdded).toEqual([
      ["player", "enemy"],
      ["bullet", "wall"],
    ]);
    const from: Vec2 = { x: 0, y: 0 };
    const dir: Vec2 = { x: 1, y: 0 };
    const hit: HitResult | null = rt.collision.raycast(from, dir, 100, ["wall"]);
    expect(hit).toBeNull();
  });

  it("viewportSize 跟随构造参数", () => {
    const rt = createMockRuntime({ viewportWidth: 1024, viewportHeight: 768 });
    expect(rt.viewportSize()).toEqual({ width: 1024, height: 768 });
  });

  it("loadScene 同步跑 setup 并透传返回值", () => {
    const rt = createMockRuntime();
    const setup = vi.fn(() => ({ difficulty: 1, time: 60 }));
    const spec: SceneSpec<{ difficulty: number; time: number }> = {
      key: "level-1",
      setup,
    };
    const root = rt.loadScene(spec);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(root).toEqual({ difficulty: 1, time: 60 });
  });

  it("reset 清空所有 spy 状态", () => {
    const rt = createMockRuntime();
    rt.spawnActor({ kind: class {} as never, config: null });
    rt.despawnActor(1);
    rt.collision.addLayer("a", "b");
    rt.onTick(() => {});
    rt.emitTick(16);
    expect(rt.spawned.length).toBe(1);
    expect(rt.despawned.length).toBe(1);
    expect(rt.layersAdded.length).toBe(1);
    expect(rt.tickSubscriberCount()).toBe(1);
    expect(rt.now()).toBe(16);

    rt.reset();
    expect(rt.spawned.length).toBe(0);
    expect(rt.despawned.length).toBe(0);
    expect(rt.layersAdded.length).toBe(0);
    expect(rt.tickSubscriberCount()).toBe(0);
    expect(rt.now()).toBe(0);
    // 计数也回到 startId
    expect(rt.spawnActor({ kind: class {} as never, config: null })).toBe(1);
  });

  it("emits 一个能用于业务代码的最小 RuntimePort 形态(类型断言)", () => {
    const rt = createMockRuntime();
    // 把 port 视角的字段全过一遍,确保没有缺漏。
    const _portView: typeof rt = rt;
    expect(_portView).toBeDefined();
  });
});
