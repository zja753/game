/**
 * `ProgressionPort` — Progression 模块对外暴露的能力(见 plan/modules/progression.md §2)。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 其他模块**只**通过这个 interface 调用 Progression 的能力。
 *  - 任何 `import { ... } from "@/modules/progression/internal/..."` 都是破坏约束。
 *  - Progression 模块**目前未落地**(M6);本文件先按 plan §2 锁定接口形态。
 *
 * 重要设计(progression.md §5 关键设计点 + roadmap §1):
 *  - Progression 是**唯一**拥有 `GameScene` 状态机事实的模块。
 *  - 其他模块**不**直接知道 scene 概念,只通过订阅 `level:phase` 事件被动响应。
 *  - 场景切换的物理实现 = Progression 独占三件事:
 *    1. `bus.emit({ type: "level:phase", ... })`
 *    2. `runtime.engine.clock.start() / stop()`(通过 `ClockControl` 窄口,见 runtime/types.ts)
 *    3. 调 `MapObstaclePort.loadLevel(n)` / `EnemyPort.clear()` 等物理换页
 *
 * 因此 `ProgressionPort` 的"写"方法(advance / pauseToggle / endRun 等)是
 * 整局游戏"申请场景切换"**唯一**合法入口。其他模块调 `advance()` 表示
 * "请从 portal → shop",内部 Progression 自己完成上面三件事。
 */
import type { CharacterId, GameScene, LevelConfig } from "../types";

/**
 * `ProgressionPort` — 游戏"导演"对外的能力。
 *
 * 拆为"读"和"写"两簇(对齐 progression.md §2):
 *  - **读**:其它模块通过 `GameContext.progression` 间接读(roadmap §2.2);
 *    直接持有本 Port 的模块很少(Progression 是大多数模块的"信息源",
 *    它们订阅 `level:phase` 事件而非直接轮询)。
 *  - **写**:RootContainer 在装配时**不**主动调,只在收到用户意图(玩家点
 *    "下一关"按钮 → HUD 发 `reward:picked` / `map:advanced` 事件 → Progression
 *    内部调 `advance()`)时使用。
 */
export interface ProgressionPort {
  // ---- 读 ----

  /** 当前关卡(1-based,玩家达到的关卡;roadmap 区分"关卡"和"玩家等级")。 */
  level(): number;

  /** 当前玩家经验值(从 0 累加)。 */
  xp(): number;

  /** 升到下一玩家等级需要的经验(由 `XpCurve` 派生;**不**保证 `xpToNext() > xp()`)。 */
  xpToNext(): number;

  /** 当前 `GameScene`(roadmap §1)。其他模块**不**应直接读,优先订阅 `level:phase`。 */
  scene(): GameScene;

  /**
   * 当前关配置(roadmap 描述的 `LevelConfig`,见 runtime/types.ts)。
   * Enemy 模块用它决定一波刷几只、按什么间隔;Combat 不读。
   * 关卡切换时由 Progression 内部更新。
   */
  currentLevelConfig(): LevelConfig;

  /**
   * 剩余关卡倒计时(秒,`running` scene 下才有意义;其它 scene 返回 0)。
   * HUD 渲染顶部计时条;Progression 内部在 `onTick` 推 `timer -= dt`。
   */
  timer(): number;

  // ---- 写 ----

  /**
   * 进入 / 退出暂停(`running` 内部子态,progression.md §3 / §5 明确"不是独立 GameScene")。
   *
   * 触发源:Input 模块订阅 `input:pause` 边沿 → 调本方法。
   * 副作用:调 `ClockControl.stop()` / `start()` 暂停物理世界(玩家、敌人、投射物冻住,UI 不冻);
   * 发 `level:phase { scene: "running", context: { ... } }` 事件,HUD 据此显示/隐藏暂停面板。
   */
  pauseToggle(): void;

  /**
   * 玩家手动放弃本局(M7+ 才有,见 progression.md §2;M0 实现空函数即可)。
   *
   * 副作用:同 `player:died`(切到 `gameover` scene),`RunStats` 字段标记"主动弃局"。
   */
  endRun(): void;

  /**
   * "下一关"申请:portal → shop / shop → running(下一关,progression.md §2)。
   *
   * 触发源:
   *  - `portal → shop`:玩家接触 PortalActor 时 Enemy / Progression 内部检测
   *    "玩家 pos 距 portal pos < 阈值"后调;或 HUD 在 `scene: portal` 下显示
   *    "按 X 进入商店"提示(玩家按 X)后调。
   *  - `shop → running`:玩家离开商店面板(HUD 关闭商店浮层)后调。
   *
   * 副作用由 Progression 内部完成:广播 `level:phase` + 调 `MapObstaclePort.loadLevel` +
   * 调 `EnemyPort.clear()` / `EnemyPort.spawn(...)` 启动新一波 + `ClockControl` 启停。
   * 调用方**不**直接做以上任何一件事。
   */
  advance(): void;

  /**
   * 角色选择:`character_select → running`(M0 占位,见 progression.md §2)。
   *
   * 角色系统启用前(roadmap §1 标注"首版可跳到 running"),本方法可空实现;
   * 后续启用时此方法是 `character_select` 场景下玩家"点开始游戏"的入口。
   */
  pickCharacter(id: CharacterId): void;
}
