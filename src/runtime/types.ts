/**
 * Runtime 模块共享类型。
 *
 * 这些类型供 Port 接口、模块实现、Mock 工厂共用,
 * **禁止**在 `modules/<other>/` 出现。
 *
 * 设计原则:类型形状只锁"语义",不强耦合到 Excalibur 的内部 class
 * (例如 `Actor` / `Scene` / `Vector`)。这样:
 *  - 上游:Excalibur 的具体类可以无缝塞进来(spawn 时 `new spec.kind(...)`)。
 *  - 下游:Mock 工厂可以用普通对象模拟 `Actor`。
 *  - 跨模块:消费者拿到的都是字面量 `{ x, y }` 而不是 Excalibur Vector 实例。
 */
import type { Actor, Scene } from "excalibur";

/** 二维向量/坐标。`x` / `y` 都是世界坐标(像素)。 */
export interface Vec2 {
  x: number;
  y: number;
}

/** Actor 唯一 ID。Runtime 在 spawn 时把 Excalibur 的 `actor.id` 提出来包成这个。 */
export type ActorId = number;

/** spawn 时用的 Actor 类。 */
export type ActorCtor<TConfig> = new (config: TConfig) => Actor;

/**
 * spawn 的规格:
 *  - `kind`:Actor 类的构造函数(Excalibur 风格,接受任意 config)。
 *  - `config`:传给构造函数的配置(位置、贴图、collision group 等,由调用方决定形状)。
 *  - `layer`:可选的 collision layer 名(注册过的字符串),Runtime 在内部映射到 Excalibur CollisionGroup。
 */
export interface ActorSpec<TConfig = unknown> {
  kind: ActorCtor<TConfig>;
  config: TConfig;
  layer?: string;
}

/**
 * 场景规格:
 *  - `key`:引擎里注册场景用的字符串 key(loadScene 内部用 `engine.addScene(key, ...)`)。
 *  - `setup`:可选钩子,场景被引擎激活时调用;把场景级共享状态挂到 `T` 上返回。
 */
export interface SceneSpec<T> {
  key: string;
  setup?: (scene: Scene) => T;
}

/**
 * Raycast 命中结果。
 *  - `actor`:被命中的 Excalibur Actor(权威引用,允许调用方读 `actor.id` / `actor.pos`)。
 *  - `position`:世界坐标命中点。
 *  - `normal`:命中面的法向量(单位向量,供 AI 反弹用)。
 *  - `distance`:从 `from` 沿 `dir` 到命中点的距离(像素)。
 */
export interface HitResult {
  actor: Actor;
  position: Vec2;
  normal: Vec2;
  distance: number;
}

/**
 * 按键意图(模块间共享的"逻辑按键"字面量联合)。
 *
 * 设计原则:
 *  - **不**绑定具体物理键位(W/A/S/D / Space / 等),而是用语义名。
 *  - 物理键位 → 语义键的映射在 `modules/input/internal/KeyboardMap` 里完成。
 *  - 这样 Player / Progression 等模块只引用 `InputKey`,换键位不影响它们。
 *  - 联合放在 `runtime/types.ts` 是因为它是"协议层"的一部分,不属于任何业务模块。
 */
export type InputKey = "up" | "down" | "left" | "right" | "fire" | "pause";
