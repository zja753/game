/**
 * ObjectPool 单元测试。
 *
 * 验收点(见 plan/modules/runtime.md §6.2):
 *  - `acquire/release` 1000 次后无内存泄漏(`inUseCount` 归零)。
 *  - `release` 同一对象两次幂等(不重复 reset,不破坏池)。
 *  - `reset` 一定在 `release` 路径上被调,且**只有一次**。
 */
import { describe, expect, it, vi } from "vite-plus/test";
import { ObjectPool } from "./ObjectPool";

describe("ObjectPool", () => {
  it("1000 次 acquire/release 后 inUseCount 严格等于 0", () => {
    const factory = vi.fn(() => ({}));
    const reset = vi.fn();
    const pool = new ObjectPool<Record<string, unknown>>(factory, reset);

    const acquired: Record<string, unknown>[] = [];
    for (let i = 0; i < 1000; i++) {
      acquired.push(pool.acquire());
    }
    expect(pool.inUseCount).toBe(1000);
    // 1000 次 acquire 全是新造的(池空)
    expect(factory).toHaveBeenCalledTimes(1000);
    expect(reset).not.toHaveBeenCalled();

    for (const item of acquired) {
      pool.release(item);
    }
    expect(pool.inUseCount).toBe(0);
    // 1000 次 release 调了 1000 次 reset
    expect(reset).toHaveBeenCalledTimes(1000);
  });

  it("再次 acquire 优先复用 release 入池的对象", () => {
    const factory = vi.fn(() => ({ id: Math.random() }));
    const reset = vi.fn();
    const pool = new ObjectPool<{ id: number }>(factory, reset);

    const a = pool.acquire();
    pool.release(a);
    const b = pool.acquire();
    // 第二次 acquire 拿到的应该就是 a(同一个引用)
    expect(b).toBe(a);
    // factory 整个生命周期只调一次
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("release 同一对象两次是 no-op", () => {
    const factory = vi.fn(() => ({}));
    const reset = vi.fn();
    const pool = new ObjectPool<Record<string, unknown>>(factory, reset);

    const item = pool.acquire();
    pool.release(item);
    pool.release(item); // double release
    pool.release(item); // triple release,just in case

    expect(reset).toHaveBeenCalledTimes(1);
    // 池里只有一份(否则后续 acquire 会拿到两个不同的"空池 pop"——其实是同一份,OK)
    expect(pool.inUseCount).toBe(0);

    // 后续 acquire 仍然能拿到 item
    const reused = pool.acquire();
    expect(reused).toBe(item);
  });

  it("acquire 在池空时调用 factory,在池非空时复用", () => {
    const factory = vi.fn(() => ({ tag: "fresh" }));
    const reset = vi.fn();
    const pool = new ObjectPool<{ tag: string }>(factory, reset);

    const a = pool.acquire();
    const b = pool.acquire();
    expect(factory).toHaveBeenCalledTimes(2);
    pool.release(a);
    pool.release(b);
    expect(pool.inUseCount).toBe(0);

    const c = pool.acquire();
    const d = pool.acquire();
    // 没有新造,复用
    expect(factory).toHaveBeenCalledTimes(2);
    // LIFO 顺序:后 release 的 b 先被 pop(top of free stack)
    expect(c).toBe(b);
    expect(d).toBe(a);
  });

  it("reset 收到正确的对象引用", () => {
    const items: unknown[] = [];
    const factory = () => {
      const o = { n: items.length };
      items.push(o);
      return o;
    };
    const reset = vi.fn();
    const pool = new ObjectPool<{ n: number }>(factory, reset);

    const a = pool.acquire();
    const b = pool.acquire();
    pool.release(a);
    pool.release(b);
    // reset 收到过 a 和 b
    expect(reset.mock.calls.map((c) => c[0])).toContain(a);
    expect(reset.mock.calls.map((c) => c[0])).toContain(b);
  });
});
