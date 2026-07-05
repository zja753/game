/**
 * `SceneStats` — 局内累计统计(plan/modules/progression.md §4 权威字段 +
 * progression.md §3 `RunStats` 协议)。
 *
 * 集中持有:
 *  - `elapsedMs`:本局已过逻辑时间(毫秒;`running` scene 下累加)。
 *  - `kills`:本局累计击杀(由 `enemy:killed` 累加)。
 *  - `damageDealt`:本局累计伤害(由 `projectile:hit` 累加)。
 *  - `lastDamageDealtLevel` / `lastKillsLevel`:升级阈值(用于"升级时
 *    把这些值塞进 `level:up` payload"——首版不传,留位)。
 *
 * 设计原则:
 *  - 纯逻辑、无 IO:不订阅 bus、不调 bus,由 `ProgressionModule`
 *    持有本类实例,在事件回调里调 `record`。
 *  - 调方(`GameSceneController` / `ProgressionModule`)读 `snapshot()`
 *    拿 `RunStats`(roadmap §1 `SceneContext` 里 `gameover.stats` / `victory.stats`)。
 *  - `reset()` 在"玩家从 gameover 重新开局"时调(`startRun` 走这里)。
 *
 * 复用性:
 *  - 单测里直接 `new SceneStats()` + `recordKill()` / `recordDamage()` 即可。
 *  - `levelNumber` 由 Progression 自己持有(模块需要"知道当前是几级"
 *    来填 `RunStats.playerLevel`),本类不重复。
 */

/** 公开的统计记录(读)。 */
export interface SceneStatsSnapshot {
  /** 本局已过逻辑时间(毫秒)。 */
  elapsedMs: number;
  /** 累计击杀数。 */
  kills: number;
  /** 累计伤害。 */
  damageDealt: number;
}

/**
 * 创建局内统计实例(轻量 POJO,无 class 继承需求)。
 */
export interface SceneStats {
  /** 增加 `elapsedMs`(毫秒)。 */
  addElapsed(dt: number): void;
  /** 累加一次击杀(由 `enemy:killed` 事件驱动)。 */
  recordKill(): void;
  /** 累加一次伤害(由 `projectile:hit` 事件驱动,只看本局内的;跨关不重置)。 */
  recordDamage(amount: number): void;
  /** 当前 `elapsedMs`(毫秒;`runStats` 用)。 */
  elapsedMs(): number;
  /** 当前击杀数。 */
  kills(): number;
  /** 当前累计伤害。 */
  damageDealt(): number;
  /** 读一份快照(`SceneContext.stats` 用)。 */
  snapshot(): SceneStatsSnapshot;
  /** 重置全部累计值(玩家从 gameover 重新开局时调)。 */
  reset(): void;
}

export function createSceneStats(): SceneStats {
  let elapsedMs = 0;
  let kills = 0;
  let damageDealt = 0;

  return {
    addElapsed(dt) {
      if (dt > 0) elapsedMs += dt;
    },
    recordKill() {
      kills += 1;
    },
    recordDamage(amount) {
      if (amount > 0) damageDealt += amount;
    },
    elapsedMs() {
      return elapsedMs;
    },
    kills() {
      return kills;
    },
    damageDealt() {
      return damageDealt;
    },
    snapshot() {
      return { elapsedMs, kills, damageDealt };
    },
    reset() {
      elapsedMs = 0;
      kills = 0;
      damageDealt = 0;
    },
  };
}
