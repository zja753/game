/**
 * `GameContext` 工厂实现(plan/modular-roadmap.md §2.2 + §6)。
 *
 * 协议层(`runtime/GameContext.ts`)只暴露"形状"——实现放在本文件。
 * 装配时由 `RootContainer` 调一次,把已建好的 Port 引用包成"只读快照窗口"。
 *
 * 设计原则(roadmap §2.2 + §0.2):
 *  - 字段全是 `readonly` + 函数;**不**存副本 —— 实现方持有 Port,getter 内部
 *    走 Port 拿最新值。
 *  - **不**提供 set。写一律走 EventBus / Port。
 *  - `player.facing()` 在协议层是 `() => number`,PlayerPort 没直接暴露
 *    facing —— 通过 `__actor` 逃逸口读 `PlayerActor.facing.facingAngle()`。
 *    装配时 caller 传 player 时一并把 player actor 引用塞进 closure。
 */
import type { Vec2 } from "./types";
import type {
  CameraContext,
  EnemiesContext,
  GameContext,
  MapContext,
  PlayerContext,
  WeaponsContext,
} from "./GameContext";

// 协议层 GameContext 是 **type**,不导出 runtime 值;
// 这里为了让 RootContainer 一行 `import { createGameContext, type GameContext, ... }`
// 把"实现"和"类型"都拿齐,这里再 export 一遍。
export type { GameContext };

/**
 * `player.facing` 的取值闭包 —— 装配时由 caller 注入,因为协议层 `PlayerPort`
 * 没暴露 facing(它属于 PlayerActor 内部状态)。
 */
export type FacingReader = () => number;

/**
 * 装配时由 RootContainer 额外提供的"额外绑定" —— 比 `GameContextSources`
 * 多一个非 Port 字段(`playerActorFacing`)。
 */
export interface GameContextBindings {
  player: import("./ports/PlayerPort").PlayerPort;
  weapons: import("./ports/CombatPort").CombatPort;
  enemies: import("./ports/EnemyPort").EnemyPort;
  map: import("./ports/MapObstaclePort").MapObstaclePort;
  camera: import("./ports/CameraPort").CameraPort;
  /** 玩家面向角读闭包(由 `PlayerActor.facing.facingAngle()` 提供)。 */
  playerActorFacing: FacingReader;
}

/**
 * 创建 `GameContext`(装配时由 RootContainer 调一次)。
 *
 * 所有 getter 走对应 Port;不缓存任何字段 —— 调用方拿到的是当时最新值
 * (roadmap §2.2 明确"模块用'发布者更新内部状态'模式")。
 */
export function createGameContext(bindings: GameContextBindings): GameContext {
  const player: PlayerContext = {
    id: () => bindings.player.id(),
    pos: (): Vec2 => bindings.player.pos(),
    hp: () => bindings.player.hp(),
    maxHp: () => bindings.player.maxHp(),
    // PlayerPort 没暴露 facing —— 通过 binding 注入的 `__actor.facing.facingAngle()`
    facing: () => bindings.playerActorFacing(),
  };

  const weapons: WeaponsContext = {
    current: () => bindings.weapons.currentWeapon(),
  };

  const enemies: EnemiesContext = {
    list: () => bindings.enemies.list(),
    count: () => bindings.enemies.count(),
  };

  const map: MapContext = {
    bounds: () => bindings.map.bounds(),
    isBlocked: (p) => bindings.map.isBlocked(p),
  };

  const camera: CameraContext = {
    pos: () => bindings.camera.pos(),
    viewportSize: () => bindings.camera.viewportSize(),
  };

  return {
    player,
    weapons,
    enemies,
    map,
    camera,
  };
}
