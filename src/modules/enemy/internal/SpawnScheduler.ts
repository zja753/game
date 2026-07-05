/**
 * `SpawnScheduler` — 敌人刷怪调度器(plan/modules/enemy.md §5 内部子模块 3)。
 *
 * 职责:
 *  - 接收"关卡配置"(`LevelConfig` 来自 Progression)决定刷哪种敌人、密度多少。
 *  - 每帧(`onTick`)按 `enemyDensity` 节奏 spawn 敌人,直到 `count() >= cap`。
 *  - `cap` 来自 `LevelConfig.maxAlive`(M0 阶段 roadmap 写"density"是
 *    "每关同时存活上限",本模块**统一按"上限"语义**实现)。
 *  - 场景切到非 `running` 时(`level:phase` 事件)停 spawn;`running` 时启 spawn。
 *
 * 关键不变量(plan §7 验收点 + §3 / §4 关键设计点):
 *  - 不知道"现在有几个敌人在场"由 `EnemyModule.list()` 提供;它只问
 *    `getAliveCount` 这个回调。
 *  - spawn 的"种类"走 `LevelConfig.allowedKinds[0]`(第一版只刷一种;后续
 *    多 kind 时按权重随机)。
 *  - spawn 的"位置"由调用方在构造时给一个 `pickSpawnPos(ctx) → Vec2`
 *    函数;第一版测试里可传"固定位置",真实装配时 Progression / MapObstacle
 *    提供"在玩家视野外但不超出地图"的位置(plan §4 关键设计点:
 *    "AI 跟随" = 玩家在 spawn pos 选择里**不**起决定作用)。
 *  - **不**直接 `RuntimePort.spawnActor` —— 委托给 `EnemyModule` 提供的
 *    `spawnOne(kind, pos)` 回调,把"知道 EnemyActor / 知道 EnemyRegistry"
 *    的部分全部隔离在 EnemyModule 内,SpawnScheduler 保持纯逻辑。
 *
 * 复用性:
 *  - 单测里 `spawnOne` 是 spy(记每次 spawn 的 kind+pos),
 *    `getAliveCount` 是固定值,验证"按密度 spawn 几次"。
 *  - `enabled` 切换可在测试里手动调(不订阅 EventBus),真实装配时
 *    EnemyModule 在 `level:phase` 回调里调 `setEnabled(scene === "running")`。
 */
import type { ActorId, EnemyKind, LevelConfig, Vec2 } from "../../../runtime/types";

/** "从 LevelConfig 决定是否要 spawn" 所需的最小上下文。 */
export interface SpawnTickContext {
  /** 当前关卡配置(roadmap §1 `LevelConfig`)。 */
  level: LevelConfig;
  /** 当前逻辑时间(毫秒),用于"按时间窗口节奏 spawn"。 */
  now: number;
  /** 帧 delta(毫秒)。 */
  dt: number;
}

/** "spawn 一个敌人"的回调 —— 由 EnemyModule 实现(走 `EnemyPort.spawn` 委托给
 *  真实 spawn + 内部表登记 + 广播 `enemy:spawned`)。 */
export type SpawnOneFn = (kind: EnemyKind, pos: Vec2) => ActorId;

/** "返回当前场上敌人数"的回调 —— 由 EnemyModule 实现(走 `EnemyPort.count`)。 */
export type GetAliveCountFn = () => number;

/** "生成 spawn 位置"的回调 —— 由调用方决定位置策略(测试里给固定点,
 *  真实装配里给"地图边界外推"等)。 */
export type PickSpawnPosFn = (ctx: PickSpawnPosContext) => Vec2;

/** `pickSpawnPos` 收到的上下文。 */
export interface PickSpawnPosContext {
  /** 当前关卡配置。 */
  level: LevelConfig;
  /** 当前场上已存活的敌人数(可能用于"分散分布"决策)。 */
  aliveCount: number;
  /** 当前帧逻辑时间。 */
  now: number;
}

/**
 * `SpawnScheduler` 配置依赖。
 */
export interface SpawnSchedulerDeps {
  /** 真实 spawn 入口(走 `EnemyPort.spawn`)。 */
  spawnOne: SpawnOneFn;
  /** 当前敌人数查询(走 `EnemyPort.count`)。 */
  getAliveCount: GetAliveCountFn;
  /** spawn 位置选择策略(由调用方实现)。 */
  pickSpawnPos: PickSpawnPosFn;
  /**
   * 可选:每两次 spawn 之间的最小间隔(毫秒);`undefined` = 不强制节流,
   * 只看"alive < density"就 spawn。首版(密度低)用节流避免一次性刷 5 个。
   * 默认 1000ms(1 秒 1 个)。
   */
  spawnIntervalMs?: number;
  /**
   * 可选:每次 spawn 多少个(单帧多刷)。默认 1。
   * 仅供特殊关卡(开局面板一波刷)使用;首版不传。
   */
  batchSize?: number;
}

/** `SpawnScheduler` 句柄。 */
export interface SpawnSchedulerHandle {
  /**
   * 帧驱动入口 —— 每帧由 `EnemyModule.onTick` 调一次。
   * 内部:若 `enabled && alive < density`,按 `spawnIntervalMs` 节奏 spawn。
   *
   * @returns 本帧新 spawn 的敌人 id 列表(可能为空)。
   */
  tick(ctx: SpawnTickContext): readonly ActorId[];
  /** 启 / 停 spawn(由 `level:phase` 事件驱动;测试里可手动)。 */
  setEnabled(v: boolean): void;
  /** 当前是否启用。 */
  isEnabled(): boolean;
  /**
   * 切关时重置状态(清节流时间,让新关一上来就立刻 spawn)。
   * 不动 `enabled` 标志 —— 切关时 scene 可能不是 running,由 caller 自己 set。
   */
  reset(): void;
}

/**
 * 创建 `SpawnScheduler`。
 */
export function createSpawnScheduler(deps: SpawnSchedulerDeps): SpawnSchedulerHandle {
  const interval = deps.spawnIntervalMs ?? 1000;
  const batch = deps.batchSize ?? 1;
  let enabled = true;
  let lastSpawnAt = -Infinity;

  function spawnOne(ctx: SpawnTickContext): ActorId | null {
    const allowed = ctx.level.allowedKinds;
    if (allowed.length === 0) return null;
    // 第一版:从 `allowedKinds[0]` 取种(roadmap 明确"第一版只 1 种 chaser")。
    // 后续可改成"按权重随机";M0/M5 阶段就一。
    const kind = allowed[0] as EnemyKind;
    if (typeof kind !== "string" || kind.length === 0) return null;
    const pos = deps.pickSpawnPos({
      level: ctx.level,
      aliveCount: deps.getAliveCount(),
      now: ctx.now,
    });
    return deps.spawnOne(kind, pos);
  }

  const handle: SpawnSchedulerHandle = {
    tick(ctx) {
      if (!enabled) return [];
      // `density` 字段在 LevelConfig 里是"同时存活上限"(roadmap 沿用)。
      if (deps.getAliveCount() >= ctx.level.enemyDensity) {
        // 已达上限,只更新时间戳,避免一帧多调 spawnOne。
        lastSpawnAt = ctx.now;
        return [];
      }
      if (ctx.now - lastSpawnAt < interval) {
        // 节奏未到。
        return [];
      }
      const out: ActorId[] = [];
      for (let i = 0; i < batch; i++) {
        // 每次都重检"上限"(batch 内可能刷满)。
        if (deps.getAliveCount() >= ctx.level.enemyDensity) break;
        const id = spawnOne(ctx);
        if (id === null) break;
        out.push(id);
        lastSpawnAt = ctx.now;
      }
      return out;
    },
    setEnabled(v) {
      enabled = v;
    },
    isEnabled() {
      return enabled;
    },
    reset() {
      lastSpawnAt = -Infinity;
    },
  };

  return handle;
}
