/**
 * `ProjectileFactory` — 投射物工厂(plan/modules/combat.md §5 内部子模块 2)。
 *
 * 职责:
 *  - `spawn` 一颗投射物:把"开火上下文"(`origin / dir / speed / lifetime /
 *    damage / targetKindHint / ownerId`)装成 `ActorSpec`,
 *    调 `RuntimePort.spawnActor` 把 actor 加进场景。
 *  - 投射物命中(`onHit`)或寿命到(`onSelfDestruct`)触发时,把 actor
 *    从场景移除(`runtime.despawnActor`)。
 *  - 命中伤害走 `HitResolver.resolveHit` —— 工厂本身**不**做伤害计算。
 *
 * 设计原则:
 *  - **不**做池化:`new ProjectileActor({...})` 直接作为 `config` 传给
 *    `runtime.spawnActor`;Excalibur 自己 `new spec.kind(spec.config)`。
 *    池化(Memory-pool)是优化项,等真有 GC 压力再加(`ObjectPool` 接口
 *    已就绪,见 `runtime/ports/RuntimePort`)。
 *  - `onSelfDestruct` 内部直接 `despawnActor(id)`,不依赖外部回收。
 *  - `onHit` 走 `HitResolver`,**不**做 cooldown / 装填(那是 tryFire 的事)。
 *  - 命中坐标(传给 `projectile:hit`)第一版用"开火 origin"近似;
 *    后续要让 `ProjectileActor` 暴露 `currentPos()` 再精确化。
 */
import type { RuntimePort } from "../../../runtime/ports/RuntimePort";
import type { ActorId, Vec2 } from "../../../runtime/types";

import { ProjectileActor } from "./ProjectileActor";
import type { HitResolverDeps } from "./HitResolver";
import { resolveHit } from "./HitResolver";

/** `ProjectileFactory` 构造配置。 */
export interface ProjectileFactoryDeps {
  /** Runtime Port(spawn / despawn)。 */
  runtime: RuntimePort;
  /** `HitResolver` 的依赖(工厂内部现造现用,不缓存 resolver state)。 */
  hitResolver: HitResolverDeps;
  /**
   * 投射物碰撞层名(供 `runtime.collision.addLayer` 调用时引用)。
   * 默认 `"projectile"`。多模块装配时由调用方覆盖避免冲突。
   */
  projectileLayer?: string;
}

/** 工厂返回的扩展句柄,带 spy。 */
export interface ProjectileFactoryHandle {
  /**
   * 造一颗投射物(spawn 进场景 + 绑回调)。
   *
   * @param args `origin` / `dir`(已归一化)/ `speed` / `lifetimeMs` /
   *             `damage` / `ownerId` / `targetKindHint`。
   * @returns 投射物的 ActorId。
   */
  spawn(args: {
    origin: Vec2;
    dir: Vec2;
    speed: number;
    lifetimeMs: number;
    damage: number;
    ownerId: ActorId;
    targetKindHint?: string;
  }): ActorId;

  /**
   * 投射物碰撞层名(由 Combat 装配层在 `runtime.collision.addLayer` 时引用)。
   */
  readonly projectileLayer: string;

  /** 测试 spy:已 spawn 的投射物 id 列表。 */
  readonly spawnedIds: ReadonlyArray<ActorId>;
  /** 测试 spy:已 despawn 的投射物 id 列表(命中 / 寿命到的累计)。 */
  readonly despawnedIds: ReadonlyArray<ActorId>;
  /** 清空 spy。 */
  reset(): void;
}

/**
 * 创建 Projectile 工厂。
 *
 * 注:Excalibur 0.32 的 `RuntimePort.spawnActor` 调用方式 = `new spec.kind(spec.config)`。
 * 所以我们把 `ProjectileActor` 当 `kind`,`config` 是它的构造配置。
 */
export function createProjectileFactory(deps: ProjectileFactoryDeps): ProjectileFactoryHandle {
  const runtime = deps.runtime;
  const resolver = deps.hitResolver;
  const layer = deps.projectileLayer ?? "projectile";
  const spawnedIds: ActorId[] = [];
  const despawnedIds: ActorId[] = [];

  const handle: ProjectileFactoryHandle = {
    spawn(args) {
      // 用 closure 捕获 `id`:`spawnActor` 返回后才填。
      let actorId: ActorId | null = null;

      const onHit = (otherId: ActorId): void => {
        // 命中坐标第一版近似 = 玩家发射点(origin);足够 HUD 飘字。
        // 后续要精确再让 ProjectileActor 暴露 currentPos。
        const hitPos: Vec2 = { x: args.origin.x, y: args.origin.y };
        resolveHit(resolver, {
          projectilePos: hitPos,
          otherId,
          damage: args.damage,
          targetKindHint: args.targetKindHint,
        });
        // 命中后:actor 自己已经 markSelfDestruct(在 ProjectileActor.onCollisionStart
        // 里),这里 despawn + 记录。
        if (actorId !== null) {
          runtime.despawnActor(actorId);
          despawnedIds.push(actorId);
        }
      };

      const onSelfDestruct = (): void => {
        if (actorId !== null) {
          runtime.despawnActor(actorId);
          despawnedIds.push(actorId);
        }
      };

      const id = runtime.spawnActor<ConstructorParameters<typeof ProjectileActor>[0]>({
        kind: ProjectileActor as unknown as new (
          config: ConstructorParameters<typeof ProjectileActor>[0],
        ) => ProjectileActor,
        config: {
          origin: args.origin,
          dir: args.dir,
          speed: args.speed,
          lifetimeMs: args.lifetimeMs,
          onHit,
          onSelfDestruct,
        },
        layer,
      });
      actorId = id;
      spawnedIds.push(id);
      return id;
    },
    projectileLayer: layer,
    get spawnedIds() {
      return spawnedIds;
    },
    get despawnedIds() {
      return despawnedIds;
    },
    reset() {
      spawnedIds.length = 0;
      despawnedIds.length = 0;
    },
  };

  return handle;
}
