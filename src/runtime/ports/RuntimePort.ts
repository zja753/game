/**
 * `RuntimePort`:Runtime 模块对外暴露的能力(见 plan/modules/runtime.md §2)。
 *
 * **唯一**允许被其他模块 import 的 Runtime 符号就是 `RuntimePort` 这个 interface。
 * 任何 `import { ... } from "@/modules/runtime/internal/..."` 都是破坏约束。
 */
import type { Engine } from "excalibur";
import type { ActorId, ActorSpec, HitResult, SceneSpec, Vec2 } from "../types";

/** 对象池的运行时接口(Runtime 在内部用 `ObjectPool<T>` 实现,这里只暴露 `acquire/release`)。 */
export interface RuntimePool<T> {
  acquire(): T;
  release(item: T): void;
}

/** 碰撞子系统 Port。 */
export interface RuntimeCollisionPort {
  /**
   * 注册两个 collision layer "会撞"。同一对调用多次幂等。
   * 必须在 spawn 该 layer 的 Actor 之前调用。
   */
  addLayer(a: string, b: string): void;

  /**
   * 从 `from` 沿 `dir` 发射长度 `maxDist` 的射线,
   * 只碰 `layers` 列出的 layer,返回最近的命中(`layers` 为空时只碰 `CollisionGroup.All` 的目标)。
   */
  raycast(from: Vec2, dir: Vec2, maxDist: number, layers: string[]): HitResult | null;
}

export interface RuntimePort {
  /** 逃生舱口:99% 情况下别碰,只用于"Port 真的没覆盖到"的边角。 */
  engine: Engine;

  /**
   * 统一时钟,毫秒。
   * 暂停时(`engine.clock` 停)不变;恢复后继续累加 dt。
   * 业务模块应该用这个而不是 `Date.now()` / `performance.now()`。
   */
  now(): number;

  /**
   * 统一工厂:用 `spec` 造 Actor,加进当前场景,登记到 Runtime 内部句柄表,返回 `ActorId`。
   * 调用方**只**持有 id,不直接持 Actor 引用(权威原则)。
   */
  spawnActor<TConfig = unknown>(spec: ActorSpec<TConfig>): ActorId;

  /** `spawnActor` 的反向操作。找不到对应 Actor 时是 no-op。 */
  despawnActor(id: ActorId): void;

  /**
   * 加载场景(幂等且原子)。`T` 是场景级共享状态的根句柄。
   * 旧场景的所有 Actor 会被 `engine.removeScene` 卸掉。
   */
  loadScene<T>(scene: SceneSpec<T>): T;

  /**
   * 帧驱动订阅。`cb` 每帧(`preupdate`)被调一次,`dt` 是该帧的 delta(毫秒)。
   * 返回反订阅函数。
   */
  onTick(cb: (dt: number) => void): () => void;

  /**
   * 泛型对象池。同一个 `key` 在整个游戏里只允许存在一个池,第二次传相同 key
   * 直接返回已有的池(防止模块各自 new 自己的池,最后撞车)。
   */
  objectPool<T>(key: string, factory: () => T, reset: (item: T) => void): RuntimePool<T>;

  /** 视口尺寸(像素),跟着 Excalibur `screen.resolution` / `screen.viewport` 走,resize 时自动更新。 */
  viewportSize(): { width: number; height: number };

  readonly collision: RuntimeCollisionPort;
}
