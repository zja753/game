/**
 * `GameSceneController` — 场景状态机(plan/modules/progression.md §6 子模块 1)。
 *
 * 整局游戏的"导演":维护 `GameScene` 有限状态机,**唯一**允许改 scene / 调
 * `ClockControl.start/stop` / 调 `MapObstaclePort.loadLevel` / 调 `EnemyPort.clear()`
 * / 调 `PortalSpawner.spawn|despawn` 的位置(progression.md §5 + §6 关键设计点)。
 *
 * ---
 *
 * ## 状态转移表(roadmap §1 + progression.md §3)
 *
 * ```
 *   character_select  --pickCharacter-->  running
 *   running          --xp >= xpToNext--> levelup_modal
 *   levelup_modal    --reward:picked--->  running
 *   running          --timer = 0------->  portal
 *   running          --isFinal+clear--->  victory
 *   portal           --advance-------->  shop        (或 victory,见下)
 *   shop             --advance-------->  running
 *   *                --player:died--->  gameover
 * ```
 *
 * 注:`portal → shop` 与 `portal → victory` 的区分:当 `currentLevelConfig.isFinal === true`
 * 且 `running → portal` 的触发源是"敌人清空"(而不是 timer 归零)时,意味着
 * "玩家打完了最终 Boss",此时 `portal → shop` 改为 `portal → victory`。
 * 第一版(roadmap §3.5)关卡数有限,这条分支**保留**但**不强制测试覆盖**。
 *
 * `pauseToggle` 是 `running` 的**子态**(`paused` 标志位),不产生新的 `GameScene`。
 *
 * ---
 *
 * ## 物理副作用(roadmap §1 表格 + progression.md §5)
 *
 * 每个状态转移 = 三件事(本类独占):
 *   1. `bus.emit({ type: "level:phase", scene, context })`
 *   2. `clock.start() / stop()` —— 暂停 / 恢复物理世界
 *   3. `MapObstaclePort.loadLevel(...)` / `EnemyPort.clear()` /
 *      `PortalSpawner.spawn(...)` / `despawnActor` 之类的物理换页
 *
 * 任何模块**只**能通过 `ProgressionPort.advance()` / `pauseToggle()` /
 * `endRun()` / `pickCharacter()` 触发转移;不能直接调本类。
 *
 * ---
 *
 * ## 设计原则
 *
 *  - **不**订阅 `EventBus` —— `ProgressionModule` 持有本类 + 替它订阅;本类
 *    接收的是"事件已经被 ProgressionModule 翻译成方法调用"的高层接口。
 *  - **不**调 `EventBus` —— 但持有 `bus` 引用,在 `transition()` 里 emit。
 *  - **不**读 `Date.now() / performance.now()` —— 帧推进由 `ProgressionModule`
 *    在 `onTick` 里调 `tick(dt)`。
 *  - **不**持 Player/Enemy 引用 —— 通过 `EnemyPort.count()` 查询敌人数量。
 *  - **不**渲染 / **不**调 HUD —— `level:phase` 发出去 HUD 自己订阅。
 */
import type {
  CharacterId,
  GameScene,
  LevelConfig,
  RewardId,
  SceneContext,
  ShopItem,
  Vec2,
} from "../../../runtime/types";
import type { GameEventBus } from "../../../runtime/EventBus";
import type { ClockControl } from "../../../runtime/types";
import type { EnemyPort } from "../../../runtime/ports/EnemyPort";
import type { MapObstaclePort } from "../../../runtime/ports/MapObstaclePort";
import type { LevelId } from "../../../runtime/types";

import { xpToNext } from "./XpCurve";
import { FIRST_LEVEL, getLevelConfig, getMaxLevel } from "./LevelCatalog";
import type { SceneStats, SceneStatsSnapshot } from "./SceneStats";
import type { PortalSpawnerHandle } from "./PortalSpawner";
import type { LevelUpOrchestratorHandle } from "./LevelUpOrchestrator";
import type { ShopOrchestratorHandle } from "./ShopOrchestrator";

/** 升级时 `level:up` 事件的负载挑选字段(rewards.md §3)。 */
export interface LevelUpChoices {
  /** 升级后的玩家等级(1-based)。 */
  level: number;
  /** 升级三选一候选 ID 列表。 */
  choices: readonly RewardId[];
}

/** `GameSceneController` 构造依赖。 */
export interface GameSceneControllerDeps {
  /** 事件总线(emit `level:phase` / `level:up` / `xp:gained` / `timer:tick` / `portal:appeared`)。 */
  bus: GameEventBus;
  /** 引擎时钟控制(roadmap §1 场景切换的物理实现第 2 步)。 */
  clock: ClockControl;
  /** 障碍 / 关卡加载(物理换页)。 */
  map: MapObstaclePort;
  /** 敌人查询 / 清场。 */
  enemies: EnemyPort;
  /** 传送门生成器(`running → portal` 时 spawn,`portal → shop` 时 despawn)。 */
  portal: PortalSpawnerHandle;
  /** 升级三选一编排。 */
  levelUp: LevelUpOrchestratorHandle;
  /** 商店编排。 */
  shop: ShopOrchestratorHandle;
  /** `RewardShopPort`(本模块**只**用 `applyReward`;`rollXxx` 走 orchestrator)。
   *  持有完整 Port 是因为 `applyReward` 必须在 `reward:picked` 路径下同步执行
   *  (rewards.md §7 关键设计点)。 */
  rewardShop: import("../../../runtime/ports/RewardShopPort").RewardShopPort;
  /** 局内统计(累加 elapsed/kills/damage,出 `RunStats` 用)。 */
  stats: SceneStats;
  /**
   * `character_select → running` 时给"角色列表"用(roadmap §1 标注"首版可跳到 running")。
   * 不传时,`pickCharacter` 走 no-op + console.warn,并自动用 `["default"]` 作为占位。
   */
  characterList?: readonly CharacterId[];
  /**
   * `level → LevelId` 的映射;Progression 内部用它把"关卡(1-based)"转成
   * `MapObstaclePort.loadLevel` 用的 `LevelId`。
   *
   * 不传时,关卡 1 走 `"level-1"`(runtime/types.ts 当前定义的 `LevelId`),
   * 其余关卡兜底走 `level-N`(测试通常不依赖具体值)。
   */
  levelIdFor?: (stage: number) => LevelId;
}

/** `GameSceneController` 句柄(由 `ProgressionModule` 持有,做事件订阅和帧推进)。 */
export interface GameSceneControllerHandle {
  // ---- 读(由 `ProgressionPort` 透出)----
  /** 当前玩家等级(1-based;升级时 ++)。 */
  level(): number;
  /** 当前玩家经验(累加 `enemy:killed.xp`)。 */
  xp(): number;
  /** 升到下一等级所需经验(`xpToNext(level)`)。 */
  xpToNext(): number;
  /** 当前 `GameScene`。 */
  scene(): GameScene;
  /** 当前关卡(1-based;升级**不**改 stage,只改 level)。 */
  stage(): number;
  /** 剩余关卡倒计时(秒;仅 `running` scene 下有值,其他 scene 返回 0)。 */
  timer(): number;
  /** 是否在暂停子态(roadmap §1 明确"不是独立 GameScene")。 */
  paused(): boolean;
  /** 当前关 `LevelConfig`(roadmap §1)。 */
  currentLevelConfig(): LevelConfig;

  // ---- 写(对应 `ProgressionPort`)----
  /** `character_select → running`(roadmap §1 表;首版自动跳到 running)。 */
  pickCharacter(id: CharacterId): void;
  /** 进入 / 退出暂停子态。 */
  pauseToggle(): void;
  /** 玩家手动弃局:同 `player:died`(切到 `gameover` scene)。 */
  endRun(): void;
  /** `portal → shop` 或 `shop → running(下一关)`。 */
  advance(): void;
  /** 重开:从 `gameover` / `victory` 回 `character_select`(roadmap §1 表格)。 */
  startRun(): void;

  // ---- 帧推进(由 `ProgressionModule.onTick` 调)----
  /**
   * 每帧调一次。语义:
   *  - `running` + 未暂停 → `timer -= dt / 1000`,达 0 触发 `running → portal`。
   *    - 倒计时到 0 时若 `currentLevelConfig.isFinal` 且场上敌人已清空,
   *      进 `victory`(打完了最终 Boss);否则进 `portal`。
   *  - `running` + 暂停 → timer 不动。
   *  - 其他 scene → 推 `SceneStats.elapsed`? —— 不,只 `running` 累计。
   *  - `level:phase` 转移瞬间**不**重置 dt(由 caller 控制 0 长度帧)。
   *
   * 副作用:
   *  - 发 `timer:tick { remaining, total }`(仅 `running` + 未暂停时)。
   *  - 触发状态转移时按转移表 emit `level:phase`。
   */
  tick(dt: number): void;

  // ---- 事件驱动(由 `ProgressionModule` 调;不订阅 bus)----
  /** `enemy:killed { xp }` → 累加 xp,达阈值时切到 `levelup_modal`。 */
  onEnemyKilled(xp: number): void;
  /** `player:died` → 切到 `gameover`;同样停时钟。 */
  onPlayerDied(): void;
  /** `reward:picked { id, kind }` → 切回 `running`,调 `RewardShopPort.applyReward`。 */
  onRewardPicked(id: RewardId, kind: "levelup" | "shop"): void;

  // ---- 测试 / 装配用 ----
  /** `__currentLevelConfig` 的快照(同 `currentLevelConfig()`,留作显式). */
  __forceResetForTest(): void;
}

/**
 * 把关卡(stage,1-based)转成 `LevelId` 字面量(供 `MapObstaclePort.loadLevel`)。
 *
 * 默认:stage=1 → `"level-1"`(runtime/types.ts 协议层定义),
 * 其余走 `"level-N"`(测试 / 未来关卡占位)。
 */
function defaultLevelIdFor(stage: number): LevelId {
  if (stage === 1) return "level-1" as LevelId;
  return `level-${stage}` as LevelId;
}

/**
 * 创建 `GameSceneController`。
 */
export function createGameSceneController(
  deps: GameSceneControllerDeps,
): GameSceneControllerHandle {
  const bus = deps.bus;
  const clock = deps.clock;
  const map = deps.map;
  const enemies = deps.enemies;
  const portal = deps.portal;
  const levelUp = deps.levelUp;
  const shop = deps.shop;
  const stats = deps.stats;
  const characters = deps.characterList ?? ["default" as CharacterId];
  const levelIdFor = deps.levelIdFor ?? defaultLevelIdFor;

  // ---- 状态 ----
  let scene: GameScene = "character_select";
  let stage = FIRST_LEVEL;
  let playerLevel = 1;
  let xp = 0;
  let pausedFlag = false;
  let timer = 0;
  /** 关卡配置缓存,避免每次 `currentLevelConfig()` 现算。 */
  let levelCfgCache: LevelConfig = getLevelConfig(stage);

  // ---- 工具 ----

  function levelConfig(): LevelConfig {
    return levelCfgCache;
  }

  function currentSceneContext(): SceneContext {
    switch (scene) {
      case "running":
        return { scene: "running" };
      case "levelup_modal": {
        // 当前 levelup 候选(由 onEnemyKilled 触发的最近一次计算缓存)。
        const choices = lastLevelUpChoices;
        return { scene: "levelup_modal", choices };
      }
      case "portal": {
        const pos = lastPortalPos ?? { x: 0, y: 0 };
        const remaining = enemies.count();
        return { scene: "portal", portalPos: pos, remainingEnemies: remaining };
      }
      case "shop": {
        const items = lastShopItems;
        return { scene: "shop", items };
      }
      case "character_select":
        return { scene: "character_select", characters };
      case "gameover": {
        const s: SceneStatsSnapshot = stats.snapshot();
        return {
          scene: "gameover",
          stats: {
            elapsed: s.elapsedMs / 1000,
            kills: s.kills,
            damageDealt: s.damageDealt,
            level: stage,
            playerLevel,
          },
        };
      }
      case "victory": {
        const s: SceneStatsSnapshot = stats.snapshot();
        return {
          scene: "victory",
          stats: {
            elapsed: s.elapsedMs / 1000,
            kills: s.kills,
            damageDealt: s.damageDealt,
            level: stage,
            playerLevel,
          },
        };
      }
    }
  }

  /**
   * 一次性 emit + 物理副作用 + 状态写。
   * **唯一**改 `scene` 字段的地方。
   */
  function transition(to: GameScene, ctx?: SceneContext): void {
    scene = to;
    if (ctx) {
      // 调用方主动提供 context(用于 character_select / levelup_modal / shop
      // 等带数据的场景);portal 走 currentSceneContext() 现算。
    }
    bus.emit({ type: "level:phase", scene: to, context: ctx ?? currentSceneContext() });
  }

  // ---- 升级 / 商店缓存(emit `level:up` / SceneContext 时需要)----
  let lastLevelUpChoices: readonly RewardId[] = [];
  let lastShopItems: readonly ShopItem[] = [];
  let lastPortalPos: Vec2 | null = null;

  // ---- 转移函数(每个都包"emit + 时钟 + 物理换页")----

  function toRunning(): void {
    // 物理换页:加载关卡 + 清场。
    map.loadLevel(levelIdFor(stage));
    enemies.clear();
    // 关卡配置刷新。
    levelCfgCache = getLevelConfig(stage);
    // 重置倒计时。
    timer = levelCfgCache.duration;
    // 时钟启动。
    clock.start();
    // emit。
    transition("running", { scene: "running" });
  }

  function toLevelUpModal(level: number): void {
    const choices = levelUp.rollChoices(level);
    lastLevelUpChoices = choices;
    // 升级触发与 scene → levelup_modal 是同一时刻发的两件事。
    bus.emit({ type: "level:up", level, choices });
    // 时钟停 + emit。
    clock.stop();
    transition("levelup_modal", { scene: "levelup_modal", choices });
  }

  function toPortal(): void {
    // 先 despawn 旧 portal(防御)。
    portal.despawn();
    // 在地图给的"传送门生成点"生成 portal。
    const pos = map.portalSpawn();
    portal.spawn(pos);
    lastPortalPos = pos;
    // emit `portal:appeared`(roadmap §1 转移表注释 + EventBus 字典)。
    bus.emit({ type: "portal:appeared", x: pos.x, y: pos.y });
    // 时钟停 + emit level:phase。
    clock.stop();
    transition("portal");
  }

  function toShop(): void {
    // 商店不需要 portal 了。
    portal.despawn();
    // roll 商店商品。
    const items = shop.rollItems(stage);
    lastShopItems = items;
    // 时钟停(roadmap §1 表格:`shop` scene 时钟停)。
    clock.stop();
    transition("shop", { scene: "shop", items });
  }

  function toVictory(): void {
    portal.despawn();
    clock.stop();
    transition("victory");
  }

  function toGameOver(): void {
    portal.despawn();
    clock.stop();
    transition("gameover");
  }

  function toCharacterSelect(): void {
    // 重置统计 + 玩家等级 + stage(roadmap §1 `startRun` 注释)。
    stats.reset();
    playerLevel = 1;
    xp = 0;
    pausedFlag = false;
    timer = 0;
    stage = FIRST_LEVEL;
    levelCfgCache = getLevelConfig(stage);
    portal.despawn();
    enemies.clear();
    clock.stop();
    transition("character_select", { scene: "character_select", characters });
  }

  // ---- 公开句柄 ----

  const handle: GameSceneControllerHandle = {
    level: () => playerLevel,
    xp: () => xp,
    xpToNext: () => xpToNext(playerLevel),
    scene: () => scene,
    stage: () => stage,
    timer: () => timer,
    paused: () => pausedFlag,
    currentLevelConfig: levelConfig,

    pickCharacter(id) {
      // 校验:character_list 包含 id 即可;首版总是"default" → 任意 id 都接受。
      // 不在 character_list 里时 warn + no-op。
      if (!characters.includes(id) && !characters.includes("default" as CharacterId)) {
        // eslint-disable-next-line no-console -- 单点调试提示
        console.warn(`[Progression] pickCharacter: unknown character "${id}"`);
        return;
      }
      // 任何 scene 都可以 pick?——roadmap §1 仅 `character_select → running`。
      // 其他 scene 时 pick 走 no-op(防止"运行中"被劫持)。
      if (scene !== "character_select") return;
      toRunning();
    },

    pauseToggle() {
      // 仅 `running` 有效;其他 scene no-op(roadmap §1 注释:"暂停是 running 子态")。
      if (scene !== "running") return;
      pausedFlag = !pausedFlag;
      if (pausedFlag) {
        clock.stop();
      } else {
        clock.start();
      }
      // emit level:phase 让 HUD 更新暂停面板(上下文仍是 running)。
      // 不改 scene —— roadmap §1 明确"不是独立 GameScene"。
      bus.emit({ type: "level:phase", scene: "running", context: { scene: "running" } });
    },

    endRun() {
      // 手动弃局:仅 `running` 有效;其他 scene no-op。
      if (scene === "character_select") return;
      toGameOver();
    },

    advance() {
      // roadmap §1:`portal → shop` / `shop → running(下一关)`。
      // 不在 portal / shop 时 no-op(防御)。
      if (scene === "portal") {
        // final level + 进入 portal → victory(roadmap §1 表格注释:portal 在最终关卡时
        // 直接走 victory)。
        if (levelConfig().isFinal) {
          toVictory();
        } else {
          toShop();
        }
        return;
      }
      if (scene === "shop") {
        // 切到下一关(stage + 1)。
        if (stage >= getMaxLevel()) {
          // 已经最大关 — 不应进入 shop 才对;但防御一下,直接 victory。
          toVictory();
          return;
        }
        stage += 1;
        toRunning();
        return;
      }
      // 其他 scene:`advance` 不适用 —— no-op。
    },

    startRun() {
      // 从 gameover / victory 回 character_select。
      if (scene !== "gameover" && scene !== "victory") return;
      toCharacterSelect();
    },

    tick(dt) {
      if (scene !== "running") return;
      if (pausedFlag) return;
      // 累计本局 elapsed(roadmap §1 `RunStats.elapsed` 用)。
      stats.addElapsed(dt);
      // 推 timer(dt 是毫秒,转换为秒)。
      const dtSec = dt / 1000;
      const before = timer;
      timer = Math.max(0, timer - dtSec);
      bus.emit({ type: "timer:tick", remaining: timer, total: before });
      if (timer <= 0 && before > 0) {
        // 倒计时归零,进 portal。
        toPortal();
        return;
      }
      // 额外检查:场上敌人已清空 且 isFinal → victory。
      // `before > 0` 保证不触发在"刚 toRunning 完、enemies 还没 spawn"的
      // 第一帧(否则 stage 5 一上来就胜利了)。
      // 注:这条路径**仅**在 isFinal 时生效;非 final 进 portal(由"倒计时 / 玩家意图"触发)。
      if (before > 0 && levelConfig().isFinal && enemies.count() === 0) {
        toVictory();
        return;
      }
      // 注:非 final 场景的"敌人清空 → portal"是后续增强;首版只走"timer 归零"。
    },

    onEnemyKilled(killedXp) {
      // 仅 `running` 累计经验(roadmap §3 注释)。
      if (scene !== "running") return;
      if (killedXp <= 0) return;
      xp += killedXp;
      bus.emit({ type: "xp:gained", amount: killedXp, total: xp });
      // 累计本局击杀。
      stats.recordKill();
      // 累计本局伤害?不,击杀只走 recordKill,伤害由 projectile:hit 累加。
      // 升级判定:xp >= xpToNext → 切到 levelup_modal(只升**一次**——
      // 跨级升级由本帧后续切回 running 时再次 tick 触发)。
      if (xp >= xpToNext(playerLevel)) {
        playerLevel += 1;
        toLevelUpModal(playerLevel);
      }
    },

    onPlayerDied() {
      // 任何 scene 收到都切到 gameover(roadmap §1 表:任何 → gameover)。
      toGameOver();
    },

    onRewardPicked(id, kind) {
      // 仅 `levelup_modal` / `shop` scene 接受;其他 no-op。
      if (scene !== "levelup_modal" && scene !== "shop") return;
      // scene 与 kind 必须匹配:levelup_modal 场景下玩家只能点 kind=levelup;
      // 不匹配说明 HUD 串了,no-op 兜底。
      if (scene === "levelup_modal" && kind !== "levelup") return;
      if (scene === "shop" && kind !== "shop") return;
      // 应用奖励:rewards.md §7 关键设计点 — Progression 收到 `reward:picked`
      // 后,自己调 `RewardShopPort.applyReward` 真正改权威字段。
      // 失败时 no-op(applyReward 不抛错,rewards.md §7 验收点)。
      const result = deps.rewardShop.applyReward(id);
      if (!result.ok) {
        // eslint-disable-next-line no-console -- 单点调试提示
        console.warn(`[Progression] applyReward failed: ${result.reason} for id="${id}"`);
      }
      // 切回 running(roadmap §1 表 + rewards.md §3:仅 levelup_modal 切;
      // shop scene 玩家点完商品后 scene 仍为 shop,等 `advance()` 主动触发下一关)。
      if (scene === "levelup_modal") {
        // levelup → running:playerLevel 不变,只切 scene。
        clock.start();
        transition("running", { scene: "running" });
      }
      // shop:不变 scene,等玩家主动 advance。
    },

    __forceResetForTest() {
      scene = "character_select";
      stage = FIRST_LEVEL;
      playerLevel = 1;
      xp = 0;
      pausedFlag = false;
      timer = 0;
      levelCfgCache = getLevelConfig(stage);
      lastLevelUpChoices = [];
      lastShopItems = [];
      lastPortalPos = null;
    },
  };

  return handle;
}
