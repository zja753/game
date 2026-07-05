/**
 * `CollisionLayerManager`:把 Runtime 的 `addLayer` / `raycast` Port 压扁到 Excalibur
 * `CollisionGroup` + `PhysicsWorld.rayCast` 上(见 plan/modules/runtime.md §5.4)。
 *
 * 设计要点:
 *  - 用一个 `name -> category` 表 + `category -> 允许命中的 category 集合` 表,
 *    自己维护"哪些 layer 互相能撞"的状态;另维护 `name -> CollisionGroup`
 *    缓存供 `groupFor` 复用,避免二次走 `CollisionGroupManager.create`。
 *  - `addLayer(a, b)` 是**对**操作:A 的允许列表里加 B,B 的允许列表里加 A。
 *    重复调用幂等(同一个 category 上重复 add 一个同名 layer 不会双开)。
 *  - `raycast` 用 Excalibur 的 `collisionMask` 做后端过滤:把 caller 给的 `layers`
 *    转成 bitmask,丢给 `physics.rayCast`。一个 layer 都没指明(空数组)时,
 *    视作"无过滤",走 Excalibur 默认 `CollisionGroup.All.category = -1`。
 *  - **不**缓存 `_mask` / `_category` 之类的内部字段;我们只持有 Excalibur
 *    给回来的 `CollisionGroup` 引用。我们独占 collision group 命名空间,所以
 *    ctor 里调 `CollisionGroupManager.reset()`。
 *
 * 约束:
 *  - 私有 Runtime 子模块,**不**外露;其他模块只看到 `RuntimeCollisionPort`。
 *  - 只依赖 `excalibur`。
 */
import type { Actor, Engine } from "excalibur";
import { CollisionGroup, CollisionGroupManager, Ray, Vector } from "excalibur";

import type { HitResult, Vec2 } from "../../../runtime/types";

/**
 * Excalibur `CollisionGroup.All.category === -1`,代表"不屏蔽任何类别"。
 * `physics.rayCast` 在没有 `collisionGroup` / `collisionMask` 时就是用它,
 * 我们自己也复刻这个语义,作为"空 layers"分支的默认值。
 */
const COLLISION_ALL_MASK = CollisionGroup.All.category;

/**
 * 私有子模块 — 只供 `RuntimeModule` 装配使用。
 *
 * 持有:
 *  - 一个 `Engine` 引用(读 `currentScene.physics` 拿 `PhysicsWorld`);
 *  - 一份 `layer -> category` 表(`addLayer` 时按需分配);
 *  - 一份 `category -> 允许命中的 category` 表(`addLayer(a, b)` 给两边都加)。
 */
export class CollisionLayerManager {
  private readonly engine: Engine;

  /** layer 名 -> Excalibur 分配的 category bit。`null` 表示该名字尚未注册。 */
  private readonly layerToCategory: Map<string, number> = new Map();

  /**
   * category -> 该层能命中的 category 集合。
   * 这里**不**存 layer 自己的 collision mask,我们自己推 raycast 的 mask。
   */
  private readonly categoryToAllowed: Map<number, Set<number>> = new Map();

  /**
   * layer 名 -> Excalibur `CollisionGroup` 句柄。
   * 在 `ensureLayer` 第一次见到名字时连同 category 一起缓存,后续 `groupFor`
   * 直接复用,**不**再走 `CollisionGroupManager.create` —— 否则二次调用会因
   * `existingGroup.mask !== undefined` 抛 "already exists with a different mask"。
   */
  private readonly layerToGroup: Map<string, CollisionGroup> = new Map();

  constructor(engine: Engine) {
    this.engine = engine;
    // 我们独占 collision group 命名空间:每次构造都清掉旧的注册,
    // 避免开发期 HMR / 重复装配残留名字。
    CollisionGroupManager.reset();
  }

  /**
   * 注册两个 layer "会撞"。
   *
   * 幂等性:
   *  - layer 名字**第一次**见到才会向 Excalibur 申请 category。
   *    `CollisionGroupManager.create(name)` 在同名 + 同 mask 下会返回已有组,
   *    后续再 addLayer 时同名层**不会**分配新 category。
   *  - 关系是双向的:`addLayer('a', 'b')` 等价于把 A 的 allowed 加 B、
   *    B 的 allowed 加 A。重复调用不会重复插入(`Set` 去重)。
   *
   * 调用顺序不限;但 actor 上挂 layer 必须在 spawn 之前,且需要先把 layer
   * 名字注册到这里得到 category(这部分职责在 `RuntimeModule.spawnActor` 里
   * 桥接,见 Port 说明)。
   */
  addLayer(a: string, b: string): void {
    if (a === b) {
      // 自碰撞没有意义,跳过;调用方写错也别炸。
      return;
    }

    const catA = this.ensureLayer(a);
    const catB = this.ensureLayer(b);

    // 双向注册关系(set 自动去重,天然幂等)。
    this.allowedFor(catA).add(catB);
    this.allowedFor(catB).add(catA);
  }

  /**
   * 从 `from` 沿 `dir` 发射射线,长度 `maxDist`,只碰 `layers` 列出的 layer。
   * `layers` 为空时退化为"不屏蔽"(等同 Excalibur 默认 `CollisionGroup.All`)。
   *
   * 返回**最近**一次命中(`distance` 最小),命中点的 `body.owner`
   * 我们当作 `Actor` 用 — Excalibur 中 collider 挂在 Actor 上,
   * `body.owner` 是 `Entity`,运行时类型是 `Actor`,所以转一下。
   *
   * 边界:
   *  - 任何 layer 都没匹配到(`combinedMask === 0`)→ 直接返回 `null`。
   *    也避免 Excalibur 把 mask=0 当作"全匹配"(在不同版本里语义可能漂)。
   *  - 空场景 / 无 collider → Excalibur 返回 `[]`,我们也返 `null`。
   */
  raycast(from: Vec2, dir: Vec2, maxDist: number, layers: string[]): HitResult | null {
    const physics = this.engine.currentScene.physics;
    if (!physics) return null;

    const ray = new Ray(new Vector(from.x, from.y), new Vector(dir.x, dir.y));

    // `layers` 留空 → 不过滤,沿用 Excalibur 默认(它会填 `CollisionGroup.All.category`)
    const mask: number = layers.length === 0 ? COLLISION_ALL_MASK : this.combinedMaskFor(layers);

    // 显式 0 = "当前端没有任何匹配层";直接 short-circuit,避免语义漂移。
    if (mask === 0) return null;

    const hits = physics.rayCast(ray, {
      maxDistance: maxDist,
      collisionMask: mask,
    });
    if (hits.length === 0) return null;

    // 线性找最近(O(n));raycast 一般命中小集合,排前做没价值。
    let nearest = hits[0];
    for (let i = 1; i < hits.length; i++) {
      if (hits[i].distance < nearest.distance) nearest = hits[i];
    }

    const point = nearest.point;
    const normal = nearest.normal;
    // Excalibur:collider 挂在 Actor 上,`body.owner` 静态类型是 `Entity`,
    // 运行时就是 `Actor`(我们系统里只有 Actor 会持有 collider)。
    const ownerActor = nearest.body.owner as unknown as Actor;

    return {
      actor: ownerActor,
      position: { x: point.x, y: point.y },
      normal: { x: normal.x, y: normal.y },
      distance: nearest.distance,
    };
  }

  private ensureLayer(name: string): number {
    const existing = this.layerToCategory.get(name);
    if (existing !== undefined) return existing;

    const group = CollisionGroupManager.create(name);
    const category = group.category;

    this.layerToCategory.set(name, category);
    this.layerToGroup.set(name, group);
    if (!this.categoryToAllowed.has(category)) {
      this.categoryToAllowed.set(category, new Set());
    }
    return category;
  }

  /**
   * 注册并返回 layer 的 Excalibur `CollisionGroup`(供 `RuntimeModule.spawnActor`
   * 给刚生成的 actor 设 `body.group` 用)。
   *
   * 幂等:同名 layer 拿到同一份 group(走 `layerToGroup` 缓存,**不**再调
   * `CollisionGroupManager.create`)。Excalibur 的 manager 在"同名 + mask 不一致"
   * 时会抛错,而我们 `addLayer` 路径里调过的 `create(name)` 给 group 写入的
   * mask 是个数字(`~bit`),与 `create(name)` 第二次调用传的 `undefined` 不
   * 相等 → 必须缓存,不能让 manager 看到第二次调用。
   */
  groupFor(name: string): CollisionGroup {
    this.ensureLayer(name);
    // `ensureLayer` 已经把 group 缓存进 `layerToGroup`;非空断言安全。
    return this.layerToGroup.get(name)!;
  }

  /** 拿到 layer 对应的 allowed-set;没有就建一个空集。 */
  private allowedFor(category: number): Set<number> {
    let set = this.categoryToAllowed.get(category);
    if (!set) {
      set = new Set();
      this.categoryToAllowed.set(category, set);
    }
    return set;
  }

  /**
   * 把若干 layer 名 OR 成一个 bitmask,用于 `physics.rayCast` 的 `collisionMask`。
   * 不认识的 layer 名跳过(不会把它当成 0 bit 处理)。
   * 如果**一个都没**找到,返回 0(调用方再 short-circuit 成 `null`)。
   */
  private combinedMaskFor(layers: string[]): number {
    let mask = 0;
    for (const name of layers) {
      const cat = this.layerToCategory.get(name);
      if (cat !== undefined) mask |= cat;
    }
    return mask;
  }
}
