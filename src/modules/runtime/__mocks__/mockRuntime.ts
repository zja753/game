/**
 * `createMockRuntime` — Runtime 模块的 Mock 工厂。
 *
 * 按 plan/modular-roadmap.md §0.3 / §5.1,逻辑型模块(Combat / Enemy / Progression …)
 * 的单测需要 stub 掉 Runtime 的 `spawnActor` / `onTick` / `objectPool`,而不是真的起
 * Excalibur Engine。这个工厂就是干这个的:
 *
 *  - `spawnActor` 按真实 Engine 路径 `new spec.kind(spec.config)` 实例化,
 *    加进 `spawnedInstances` map 供测试驱动(默认 Excalibur 在 mock 下不真跑)。
 *  - `now()` 返回 0(可手动 `setNow(ms)`),不需要 Engine。
 *  - `objectPool` 内部就是一个真正的 `ObjectPool`,保留验收测试。
 *  - `collision.addLayer` / `raycast` no-op + return null。
 *  - `viewportSize` 走固定 800×600。
 *  - `engine` 是一个 stub,只填类型断言需要的字段,业务上没人会碰它。
 *
 * 关键不变量:
 *  - 不依赖 Excalibur(纯 TS),所以测试不需要 setup 浏览器全局,跑得快。
 *  - `createMockRuntime()` 之间互不影响(每次都 new)。
 */
import type { ActorId, ActorSpec, HitResult, SceneSpec, Vec2 } from "../../../runtime/types";
import type { RuntimePort, RuntimePool } from "../../../runtime/ports/RuntimePort";

import { ObjectPool } from "../internal/ObjectPool";

/** Mock 工厂的可调参数。 */
export interface MockRuntimeOptions {
  /** 起始 spawn id;默认 1。 */
  startId?: number;
  /** 初始 viewport 宽;默认 800。 */
  viewportWidth?: number;
  /** 初始 viewport 高;默认 600。 */
  viewportHeight?: number;
}

/** `createMockRuntime` 返回的扩展 Port,带 spy / 驱动函数。 */
export interface MockRuntimeHandle extends RuntimePort {
  /** 注入的 spawn 规格列表(测试断言用了哪些 kind / config)。 */
  readonly spawned: ReadonlyArray<ActorSpec<unknown>>;
  /** 注入的 despawn id 列表。 */
  readonly despawned: ReadonlyArray<ActorId>;
  /**
   * mock 路径下**实例化出来的** actor(id → instance),供测试驱动
   * `onCollisionStart` / `onPreUpdate` 等实例方法用。
   *
   * 注:真实 Engine 路径下 Excalibur 自己 `new spec.kind(spec.config)` 并
   * 把实例放 scene;mock 路径下复刻这个行为。`new` 抛错时(如依赖浏览器全局)
   * 该 id 映射到 `null`,测试可跳过。
   */
  readonly spawnedInstances: ReadonlyMap<ActorId, unknown>;
  /** 已注册的 layer pair 列表(顺序无关,但用于断言 addLayer 被调到过)。 */
  readonly layersAdded: ReadonlyArray<readonly [string, string]>;
  emitTick(dt: number): void;
  /** 手动设 now()。 */
  setNow(ms: number): void;
  /** 取得已注册的 onTick 订阅者数量(供测试断言反订阅是否生效)。 */
  tickSubscriberCount(): number;
  /** 重置内部 spy 状态(id 计数器 / spawned 列表等)。 */
  reset(): void;
}

export function createMockRuntime(opts: MockRuntimeOptions = {}): MockRuntimeHandle {
  // ---- spy / 状态 ----
  const startId = opts.startId ?? 1;
  let nextId = startId;
  let nowMs = 0;
  let vw = opts.viewportWidth ?? 800;
  let vh = opts.viewportHeight ?? 600;
  const spawned: ActorSpec<unknown>[] = [];
  const despawned: ActorId[] = [];
  const spawnedInstances = new Map<ActorId, unknown>();
  const layersAdded: Array<readonly [string, string]> = [];
  const tickSubs = new Set<(dt: number) => void>();
  const pools = new Map<string, RuntimePool<unknown>>();

  // engine stub:没人该用它,只是类型上必须有。
  const engineStub = {
    // 只暴露一些必要字段(类型上需要,运行时被访问就抛错,提醒用户别用)。
    get _forbidden() {
      throw new Error("mockRuntime: 业务代码不应在 mock 路径里访问 engine");
    },
  };

  const port: MockRuntimeHandle = {
    // engine 是逃生舱口,mock 模式下我们挂个空对象上去。
    // 测试断言时通过 cast 拿到对应字段会触发上面的 getter,抛错提醒误用。
    engine: engineStub as unknown as RuntimePort["engine"],

    now: () => nowMs,

    spawnActor<TConfig>(spec: ActorSpec<TConfig>): ActorId {
      // mock 路径下**也**按真实 Engine 路径 `new spec.kind(spec.config)` 实例化
      // actor(让 onCollisionStart / onPreUpdate 这类 actor 内部方法可被测试驱动)。
      // 实例化抛错时(actor 类依赖浏览器 API)走 fallback:只记 spec 推一个递增 id。
      let instance: unknown = null;
      try {
        instance = new spec.kind(spec.config);
      } catch {
        instance = null;
      }
      const id = nextId++;
      spawned.push(spec as ActorSpec<unknown>);
      spawnedInstances.set(id, instance);
      return id;
    },

    despawnActor(id: ActorId): void {
      despawned.push(id);
    },

    loadScene<T>(scene: SceneSpec<T>): T {
      // mock 模式下 setup 同步跑,结果直接返回(无 Excalibur director 异步语义)。
      if (scene.setup) {
        return scene.setup({
          // stub Scene:与 collision.raycast 等一样,没人该调它。
          get _forbidden() {
            throw new Error("mockRuntime: setup 不应访问 Scene");
          },
        } as never);
      }
      return undefined as T;
    },

    onTick(cb: (dt: number) => void): () => void {
      tickSubs.add(cb);
      return () => {
        tickSubs.delete(cb);
      };
    },

    objectPool<T>(key: string, factory: () => T, reset: (item: T) => void): RuntimePool<T> {
      const existing = pools.get(key);
      if (existing) {
        return existing as RuntimePool<T>;
      }
      const pool = new ObjectPool<T>(factory, reset);
      pools.set(key, pool as RuntimePool<unknown>);
      return pool;
    },

    viewportSize(): { width: number; height: number } {
      return { width: vw, height: vh };
    },

    collision: {
      addLayer(a: string, b: string): void {
        layersAdded.push([a, b] as const);
      },
      raycast(_from: Vec2, _dir: Vec2, _maxDist: number, _layers: string[]): HitResult | null {
        return null;
      },
    },

    // ---- 驱动方法 ----
    emitTick(dt: number): void {
      nowMs += dt;
      // 拷贝迭代,避免 cb 里反订阅导致 Set 被修改。
      for (const cb of tickSubs) cb(dt);
    },
    setNow(ms: number): void {
      nowMs = ms;
    },
    tickSubscriberCount(): number {
      return tickSubs.size;
    },
    reset(): void {
      nextId = startId;
      nowMs = 0;
      spawned.length = 0;
      despawned.length = 0;
      spawnedInstances.clear();
      layersAdded.length = 0;
      tickSubs.clear();
      pools.clear();
    },

    // ---- spy 视图 ----
    get spawned() {
      return spawned;
    },
    get despawned() {
      return despawned;
    },
    get spawnedInstances() {
      return spawnedInstances;
    },
    get layersAdded() {
      return layersAdded;
    },
  };

  return port;
}
