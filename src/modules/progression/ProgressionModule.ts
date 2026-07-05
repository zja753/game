/**
 * `ProgressionModule` — Progression 模块对外的"装配层"(plan/modules/progression.md)。
 *
 * 把内部子模块(`GameSceneController` / `XpCurve` / `LevelCatalog` /
 * `SceneStats` / `PortalSpawner` / `PortalActor` / `ShopOrchestrator` /
 * `LevelUpOrchestrator`)组合起来,实现 `ProgressionPort` 接口的全部方法,
 * 然后把这个 Port 实例暴露给根容器 / 其他模块使用。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 这个文件**只**能被根容器 `import`。
 *  - 其他模块**不能** import 它,只能 import 根容器传给它们的 `ProgressionPort`。
 *
 * 权威字段(plan/modules/progression.md §4):
 *  - `level / xp / scene / timer / currentLevelConfig` / `paused` — 全在
 *    `GameSceneController` 内持有,通过 Port 暴露读 / 写能力。
 *
 * 模块间事件契约(plan §3 + EventBus 当前字典):
 *  - 订阅 `enemy:killed { xp }` → `controller.onEnemyKilled`。
 *  - 订阅 `player:died` → `controller.onPlayerDied`。
 *  - 订阅 `reward:picked { id, kind }` → `controller.onRewardPicked`。
 *  - 订阅 `input:pause`(roadmap §1 表格)→ `controller.pauseToggle`。
 *  - 发出 `xp:gained` / `level:up` / `level:phase` / `timer:tick` / `portal:appeared`。
 */
import type { CharacterId, GameScene, LevelConfig, LevelId } from "../../runtime/types";
import type { GameEventBus } from "../../runtime/EventBus";
import type { ClockControl } from "../../runtime/types";
import type { RuntimePort } from "../runtime";
import type { ProgressionPort } from "../../runtime/ports/ProgressionPort";
import type { MapObstaclePort } from "../../runtime/ports/MapObstaclePort";
import type { EnemyPort } from "../../runtime/ports/EnemyPort";
import type { RewardShopPort } from "../../runtime/ports/RewardShopPort";

import {
  createGameSceneController,
  type GameSceneControllerHandle,
} from "./internal/GameSceneController";
import { createPortalSpawner, PORTAL_COLLISION_LAYER } from "./internal/PortalSpawner";
import { createShopOrchestrator } from "./internal/ShopOrchestrator";
import { createLevelUpOrchestrator } from "./internal/LevelUpOrchestrator";
import { createSceneStats } from "./internal/SceneStats";

/** 传送门碰撞层名(供调用方在 `runtime.collision.addLayer("portal", "wall")` 时引用)。 */
export { PORTAL_COLLISION_LAYER };

/** `createProgressionModule` 工厂签名。 */
export interface ProgressionModuleDeps {
  /** 事件总线。 */
  bus: GameEventBus;
  /** Runtime Port(onTick 帧推进 + 引擎 clock 控制子口)。 */
  runtime: RuntimePort;
  /** 引擎 clock 控制窄口(roadmap §1 场景切换的物理实现第 2 步)。 */
  clock: ClockControl;
  /** 障碍 / 关卡加载。 */
  map: MapObstaclePort;
  /** 敌人查询 / 清场。 */
  enemies: EnemyPort;
  /** 升级 / 商店编排。 */
  rewardShop: RewardShopPort;
  /**
   * 可选:`character_select` 场景下"可角色列表"(`SceneContext.characters`)。
   * 不传走 `["default"]`(roadmap §1 标注"首版可跳到 running")。
   */
  characterList?: readonly CharacterId[];
  /**
   * 可选:关卡(stage)→ `LevelId` 的映射;不传走"stage 1 → 'level-1',
   * 其余 → 'level-N'"(见 `GameSceneController.defaultLevelIdFor`)。
   */
  levelIdFor?: (stage: number) => LevelId;
}
/**
 * 创建 Progression 模块实例。
 *
 * 生命周期(由根容器保证):
 *  1. 根容器 `createProgressionModule({ bus, runtime, clock, map, enemies, rewardShop })`
 *     → 拿 `ProgressionPort`。
 *  2. 根容器 `runtime.collision.addLayer("portal", "wall")` 等在 spawn 之前完成。
 *  3. 业务模块(HUD 读 `level:phase` / Combat 调 `currentLevelConfig` /
 *     HUD 调 `pauseToggle`)拿这个 Port。
 *  4. 销毁:根容器生命 = 进程生命,本模块**不**主动 dispose;测试 / HMR
 *     可调 `__dispose` 反订阅。
 */
export type ProgressionPortFactory = (deps: ProgressionModuleDeps) => ProgressionPort & {
  /** 测试 / HMR 用:反订阅所有 bus.on / onTick 闭包。 */
  __dispose: () => void;
  /** 测试用:暴露 `GameSceneController` 句柄(便于断言内部状态)。 */
  __controller: GameSceneControllerHandle;
  /** 测试用:暴露 stage → LevelId 的映射(默认实现可见)。 */
  __levelIdFor: (stage: number) => LevelId;
};
export const createProgressionModule: ProgressionPortFactory = (deps) => {
  // ---- 0. 内部子模块装配 ----
  const stats = createSceneStats();
  const portal = createPortalSpawner(deps.runtime);
  const levelUp = createLevelUpOrchestrator(deps.rewardShop);
  const shop = createShopOrchestrator(deps.rewardShop);

  // ---- 1. GameSceneController(本模块的核心) ----
  const controller: GameSceneControllerHandle = createGameSceneController({
    bus: deps.bus,
    clock: deps.clock,
    map: deps.map,
    enemies: deps.enemies,
    portal,
    levelUp,
    shop,
    rewardShop: deps.rewardShop,
    stats,
    characterList: deps.characterList,
    levelIdFor: deps.levelIdFor,
  });

  // ---- 2. EventBus 订阅(roadmap §1 + progression.md §3)----
  /** `enemy:killed { xp }` → 累加 xp + 升级判定。 */
  const offEnemyKilled = deps.bus.on("enemy:killed", (e) => {
    controller.onEnemyKilled(e.xp);
  });

  /** `player:died` → gameover scene。 */
  const offPlayerDied = deps.bus.on("player:died", () => {
    controller.onPlayerDied();
  });

  /** `reward:picked { id, kind }` → 应用奖励 + 切 scene。 */
  const offRewardPicked = deps.bus.on("reward:picked", (e) => {
    controller.onRewardPicked(e.id, e.kind);
  });

  /** `input:pause` → pauseToggle(roadmap §1 表格 + progression.md §3)。 */
  const offInputPause = deps.bus.on("input:pause", () => {
    controller.pauseToggle();
  });

  // ---- 3. 帧推进(tick 推 timer + 状态转移)----
  /**
   * `runtime.onTick` 每帧调一次,把 dt 转给 `controller.tick`。
   * `controller.tick` 内部:
   *  - 累计 `stats.elapsed`(仅 running + 未暂停);
   *  - 推 `timer`,达 0 时切到 portal / victory;
   *  - 发 `timer:tick` 事件。
   */
  const offTick = deps.runtime.onTick((dt) => {
    controller.tick(dt);
  });

  // ---- 4. 累加本局伤害(由 `projectile:hit` 驱动;Roadmap §2 RunStats.damageDealt)----
  const offProjectileHit = deps.bus.on("projectile:hit", (e) => {
    if (e.damage > 0) stats.recordDamage(e.damage);
  });

  // ---- 5. 公开 Port ----
  const port: ProgressionPort = {
    level: () => controller.level(),
    xp: () => controller.xp(),
    xpToNext: () => controller.xpToNext(),
    scene: () => controller.scene(),
    // 兼容旧调用:roadmap §1 / progression.md §2 写 `phase()` = scene() 的子集。
    // 现在直接透传 scene()(roadmap §3 `level:phase` 事件命名也用 `scene`)。
    // 保留 getter 形式避免破坏已有 caller 引用。
    currentLevelConfig: () => controller.currentLevelConfig(),
    timer: () => controller.timer(),
    pauseToggle: () => controller.pauseToggle(),
    endRun: () => controller.endRun(),
    advance: () => controller.advance(),
    startRun: () => controller.startRun(),
    stage: () => controller.stage(),
    pickCharacter: (id: CharacterId) => controller.pickCharacter(id),
  };

  // 注:`phase()` 不在 ProgressionPort 上(port 协议层只有 scene())。
  // 旧 `phase: "running" | "portal" | "shop"` 是 roadmap §3 表里"旧 phase" 的语义,
  // 现在 ProgressionPort 用 `scene(): GameScene`(roadmap §2 字段更全);调用方
  // 自己 `if (s === "running" || s === "portal" || s === "shop")`。

  // ---- 6. dispose / 内部 escape hatch(测试 / HMR 用)----
  const portWithDispose = port as ProgressionPort & {
    __dispose: () => void;
    __controller: GameSceneControllerHandle;
    __levelIdFor: (stage: number) => LevelId;
  };
  portWithDispose.__dispose = (): void => {
    offTick();
    offEnemyKilled();
    offPlayerDied();
    offRewardPicked();
    offInputPause();
    offProjectileHit();
  };
  portWithDispose.__controller = controller;
  // 暴露 `levelIdFor` 供测试断言"切关时调了哪个 id"(默认实现不可见)。
  // 不直接保存 deps.levelIdFor,因为默认实现来自 GameSceneController。
  portWithDispose.__levelIdFor =
    deps.levelIdFor ??
    ((stage: number): LevelId => (stage === 1 ? "level-1" : `level-${stage}`) as LevelId);

  return portWithDispose;
};

// 注:`GameScene` 重新 export 出来,方便外部(测试 / Mock)引用 Progression 用的场景联合,
// 不用再 import runtime/types。
export type { GameScene, LevelConfig };
