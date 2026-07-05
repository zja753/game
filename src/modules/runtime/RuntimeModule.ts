/**
 * `RuntimeModule` — Runtime 模块对外的"装配层"。
 *
 * 把四个内部子模块(`ObjectPool` / `FrameClock` / `EngineFactory` /
 * `CollisionLayerManager`)组合起来,实现 `RuntimePort` 接口的全部方法,
 * 然后把这个 Port 实例暴露给根容器 / 其他模块使用。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 这个文件**只**能被根容器 `import`。
 *  - 其他模块**不**能 import 它,只能 import 根容器传给它们的 `RuntimePort`。
 *
 * 权威字段(plan/modules/runtime.md §4):
 *  - `engine` 实例 / Actor 句柄表 / 对象池表 / 碰撞层表 → 全在本模块持有,
 *    通过 Port 暴露读 / 写能力。
 */
import type { ActorId, ActorSpec, SceneSpec, Vec2 } from "../../runtime/types";
import type { RuntimePort, RuntimePool } from "../../runtime/ports/RuntimePort";
import { Actor, Scene } from "excalibur";

import { ObjectPool } from "./internal/ObjectPool";
import { FrameClock } from "./internal/FrameClock";
import { CollisionLayerManager } from "./internal/CollisionLayerManager";
import { create as createEngine, destroy as destroyEngine } from "./internal/EngineFactory";

/** `createRuntimeModule` 接受的依赖(将来根容器注入,首版只用 `canvas`)。 */
export interface RuntimeModuleDeps {
  /** 引擎挂载的 DOM canvas 元素。 */
  canvas: HTMLCanvasElement;
  /** 初始视口尺寸(像素)。不传走 800×600。 */
  width?: number;
  height?: number;
  /** 背景色(`#rrggbb` / `#rrggbbaa`),可选。 */
  backgroundColor?: string;
}

/** `createRuntimeModule` 工厂签名(根容器在装配阶段调用一次)。 */
export type RuntimePortFactory = (deps: RuntimeModuleDeps) => RuntimePort;

/**
 * 创建 Runtime 模块实例。
 *
 * 调用顺序(由根容器保证):
 *  1. `createRuntimeModule({ canvas })` → 拿 `RuntimePort`。
 *  2. 业务模块 `new XxxModule({ runtime: port })` 拿到这个 Port。
 *  3. 业务模块 `port.spawnActor(...)` 之前要先 `port.collision.addLayer(...)`。
 *
 * 销毁:目前不主动暴露 `destroy`(根容器生命 = 进程生命),但保留 `__dispose`
 * 作为逃生舱口,供测试 / HMR 调用。
 */
export const createRuntimeModule: RuntimePortFactory = (deps) => {
  // ---- 1. Engine 生命周期 ----
  const engine = createEngine(deps.canvas, {
    width: deps.width,
    height: deps.height,
    backgroundColor: deps.backgroundColor,
  });

  // ---- 2. 时钟 / 帧驱动 ----
  const clock = new FrameClock();
  clock.attach(engine);

  // ---- 3. 碰撞层 / raycast ----
  const collisions = new CollisionLayerManager(engine);

  // ---- 4. 权威表 ----
  /** `ActorId` -> `Actor` 的句柄表,只有 `spawnActor` / `despawnActor` 写。 */
  const actors = new Map<ActorId, Actor>();
  /** `pool key` -> 已注册的 `ObjectPool`,同一个 key 重复拿给同一份。 */
  const pools = new Map<string, RuntimePool<unknown>>();

  // ---- 5. loadScene 内部用:每个 key 缓存其 root 句柄 ----
  const sceneRoots = new Map<string, unknown>();

  // ---- 6. Port 方法实现 ----
  const port: RuntimePort = {
    engine,

    now: () => clock.now(),

    spawnActor<TConfig>(spec: ActorSpec<TConfig>): ActorId {
      // `spec.config` 兼容两种形态:
      //  - 普通 config 对象 → `new spec.kind(config)`(Excalibur 自己造 actor);
      //  - 已经是 `Actor` 实例(根容器复用某个模块预先 new 的实例,如 PlayerModule
      //    的 PlayerActor —— 它持有 Mover / Health / Facing 闭包,再造一份就失去
      //    装配层的句柄) → 直接用。
      // 这里用 `instanceof Actor` 区分,业务模块**不**该依赖这个分支,只 RootContainer
      // 在拼装 Player 这种"模块内部已构造好实例"时走它。
      const actor: Actor =
        spec.config instanceof Actor
          ? (spec.config as unknown as Actor)
          : new (spec.kind as new (cfg: TConfig) => Actor)(spec.config);
      // 必须加进 currentScene,引擎才画它、才做物理。
      engine.currentScene.add(actor);
      // 把 `spec.layer` 映射到 Excalibur CollisionGroup 并挂到 actor.body.group。
      // 没设 layer = 默认 `CollisionGroup.All`(与 Excalibur 默认一致),不分配新 group。
      if (spec.layer !== undefined) {
        actor.body.group = collisions.groupFor(spec.layer);
      }
      const id = actor.id;
      actors.set(id, actor);
      return id;
    },

    despawnActor(id: ActorId): void {
      const actor = actors.get(id);
      if (!actor) return;
      // Excalibur 的 kill() 是"标记为待销毁",引擎下一帧真正移除。
      actor.kill();
      actors.delete(id);
    },

    loadScene<T>(scene: SceneSpec<T>): T {
      // 幂等且原子:同 key 反复 addScene 是 no-op,goToScene 让 director 切场景。
      // 旧场景的 actor 列表由 director 卸掉,不需要手动清 actors 表 — 那些
      // actor 已经被 Excalibur 移除,后续 despawn 是 no-op。
      const SceneCtor = class extends Scene {};
      engine.addScene(scene.key, SceneCtor);

      // `setup` 钩子语义(见 plan §2.1 `loadScene`):调用方把"场景级共享状态"
      // 挂到 T 上,MapObstacle / Progression / Enemy 共读。
      // 首版我们**不**等 director 切完场景;在切换前同步跑 setup,
      // 把结果缓存到 sceneRoots,等 goToScene 完成后再"使用"它。
      // 调用方拿到的 T 就是 setup 的返回值,这样 Progression / MapObstacle
      // 装配期能立即读到场景级常量。
      if (scene.setup) {
        // 第二次 loadScene 同一个 key 不重复 setup(幂等)。
        const cached = sceneRoots.get(scene.key) as T | undefined;
        if (cached !== undefined) {
          void engine.goToScene(scene.key);
          return cached;
        }
        const root = scene.setup(engine.currentScene);
        sceneRoots.set(scene.key, root);
        void engine.goToScene(scene.key);
        return root;
      }
      void engine.goToScene(scene.key);
      return undefined as T;
    },

    onTick(cb: (dt: number) => void): () => void {
      return clock.onTick(cb);
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
      // 跟着 Excalibur `screen.resolution` 走(单位:逻辑像素)。
      // EngineFactory 在 Fixed 模式下手动同步过 window resize,所以这里实时反映。
      const r = engine.screen.resolution;
      return { width: r.width, height: r.height };
    },

    collision: {
      addLayer(a: string, b: string): void {
        collisions.addLayer(a, b);
      },
      raycast(from: Vec2, dir: Vec2, maxDist: number, layers: string[]) {
        return collisions.raycast(from, dir, maxDist, layers);
      },
    },
  };

  // ---- 7. 内部 dispose(测试 / HMR 路径) ----
  const dispose = (): void => {
    // 清掉所有已登记的 actor。
    for (const actor of actors.values()) {
      actor.kill();
    }
    actors.clear();
    pools.clear();
    sceneRoots.clear();
    destroyEngine(engine);
  };

  // 把 dispose 挂到 port 上,作为逃生舱口(测试 / HMR 用)。
  // 业务模块**不**该用 — 用完就破坏 Runtime 的封装。
  // 用命名本地变量持有扩展后的类型,避免在赋值后再读 inline cast。
  const portWithDispose = port as RuntimePort & { __dispose: () => void };
  portWithDispose.__dispose = dispose;

  return port;
};
