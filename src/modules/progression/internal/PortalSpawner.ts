/**
 * `PortalSpawner` — 传送门生成器(plan/modules/progression.md §6 子模块 4)。
 *
 * 职责:
 *  - 在 `running → portal` 转移瞬间,通过 `RuntimePort.spawnActor` 在
 *    `MapObstaclePortal.portalSpawn()` 给的坐标生成一个 `PortalActor`。
 *  - 持有"当前场上 portal 的 ActorId";`portal → shop` 转移时
 *    `despawnActor` 把它从场上抹掉。
 *  - 保证**同时只存在一个**传送门(防止旧 portal 没 despawn 完又生新一个)。
 *
 * 设计原则:
 *  - 不订阅 EventBus / 不调 EventBus —— 纯命令式对象,由
 *    `GameSceneController` 在转移时调 `spawn` / `despawn`。
 *  - 不知道"现在是哪个 scene" —— 由 caller 决定调谁的时机。
 *  - 不知道 `GameSceneController` 的存在 —— 双向解耦(roadmap §0.1)。
 *
 * 复用性:
 *  - 单测里 `runtime.spawned[0].kind === PortalActor` 即可断言"portal 生了"。
 *  - `lastSpawnedPos` / `lastDespawnedId` 暴露给测试断言"在哪儿生 / 杀了谁"。
 */
import type { ActorId, Vec2 } from "../../../runtime/types";
import type { RuntimePort } from "../../../runtime/ports/RuntimePort";
import { PortalActor, type PortalActorConfig } from "./PortalActor";

/** 传送门碰撞层名(供调用方在 `runtime.collision.addLayer("portal", "wall")` 时引用)。 */
export const PORTAL_COLLISION_LAYER = "portal";

/** `PortalSpawner` 句柄。 */
export interface PortalSpawnerHandle {
  /**
   * 在 `pos` 处生成 portal,返回新 ActorId。
   *
   * 如果场上已有 portal(未 despawn),先 despawn 旧的,再生成新的。
   * 防御性 —— 正常路径下 caller 不会重复调。
   */
  spawn(pos: Vec2): ActorId;
  /**
   * 抹掉当前 portal(若有)。无 portal 时是 no-op。
   * 在 `portal → shop` / `portal → gameover` / `portal → victory` 转移时调。
   */
  despawn(): void;
  /** 当前 portal 的 ActorId;无 portal 时返回 0。 */
  currentId(): ActorId;
}

/**
 * 创建 `PortalSpawner`。
 *
 * 唯一依赖:`RuntimePort`(用于 spawnActor / despawnActor)。本类
 * 自身不订阅 bus / 不调 bus,纯命令式。
 */
export function createPortalSpawner(runtime: RuntimePort): PortalSpawnerHandle {
  let currentId: ActorId = 0;

  return {
    spawn(pos) {
      if (currentId !== 0) {
        // 防御:旧 portal 还在场上 —— 先清掉,避免场上残留。
        runtime.despawnActor(currentId);
        currentId = 0;
      }
      const config: PortalActorConfig = { pos: { x: pos.x, y: pos.y } };
      currentId = runtime.spawnActor<PortalActorConfig>({
        kind: PortalActor as unknown as new (config: PortalActorConfig) => PortalActor,
        config,
        layer: PORTAL_COLLISION_LAYER,
      });
      return currentId;
    },
    despawn() {
      if (currentId === 0) return;
      runtime.despawnActor(currentId);
      currentId = 0;
    },
    currentId() {
      return currentId;
    },
  };
}
