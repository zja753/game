/**
 * `LevelCatalog` — 关卡配置表(plan/modules/progression.md §6 子模块 3)。
 *
 * 把"关卡 ID(1-based)→ `LevelConfig`"这个映射集中到一个纯函数 / 表里。
 * 后续调参(改时长、改密度、改精英出现时机)只动这里。
 *
 * 第一版只放 5 关(roadmap §3.5:"第一版只放 1 把 Pistol + 1 种 Chaser
 * 接口框架",所以关卡数也先压低;后续可按需扩)。
 *
 * 数值含义(见 `LevelConfig` 注释):
 *  - `duration`:关卡内战斗时长(秒),倒计时归零进 `portal` scene。
 *  - `enemyDensity`:该关**同时存活敌人上限**(roadmap 沿用)。
 *  - `allowedKinds`:该关允许的敌人种类;`EnemyRegistry` 必须覆盖。
 *  - `eliteAt`:该关精英敌人首次出现的剩余时间(秒);`undefined` = 不刷。
 *  - `isFinal`:是否最终关 —— `true` 时打掉 Boss 进 `victory` 而非 `shop`。
 *
 * 设计原则:
 *  - 纯数据 / 纯函数,无 IO、无副作用。
 *  - `getLevelConfig(level)` 越界时走"返回第 1 关"兜底(roadmap 强调
 *    "关卡切换"是 `Progression` 独占,调方**不**应给非法 level)。
 *  - 不写"前一关 +1 = 后一关"的递推 —— 显式表更易读、易调。
 */

import type { LevelConfig } from "../../../runtime/types";

/** 第一版关卡配置表(roadmap §3.5:只放 1 种 Chaser / 1 把 Pistol)。 */
const LEVEL_TABLE: Readonly<Record<number, LevelConfig>> = {
  1: {
    duration: 30,
    enemyDensity: 8,
    allowedKinds: ["chaser"],
    isFinal: false,
  },
  2: {
    duration: 35,
    enemyDensity: 12,
    allowedKinds: ["chaser"],
    eliteAt: 10,
    isFinal: false,
  },
  3: {
    duration: 40,
    enemyDensity: 15,
    allowedKinds: ["chaser"],
    eliteAt: 15,
    isFinal: false,
  },
  4: {
    duration: 45,
    enemyDensity: 20,
    allowedKinds: ["chaser"],
    eliteAt: 20,
    isFinal: false,
  },
  5: {
    duration: 60,
    enemyDensity: 25,
    allowedKinds: ["chaser"],
    eliteAt: 25,
    isFinal: true,
  },
};

/** 第一关的 level(1-based;`currentLevelConfig` 默认返回它)。 */
export const FIRST_LEVEL = 1;

/**
 * 取关卡 `level`(1-based)的配置。
 *
 * @param level 1-based 关卡号;越界时走"返回第 1 关"兜底 + console.warn。
 * @returns 该关的 `LevelConfig`(从表里查)。
 *
 * 不修改内部状态;纯查表。
 */
export function getLevelConfig(level: number): LevelConfig {
  const cfg = LEVEL_TABLE[level];
  if (!cfg) {
    // 越界(level 超出表):兜底返回第 1 关,提醒调用方"关卡表该扩了"。
    // 用 `warn` 而不是 `throw`,因为 Progression 自己只在装配时调一次,
    // 越界只意味着关卡表没加,不应当炸掉游戏。
    // eslint-disable-next-line no-console -- 单点调试提示
    console.warn(`[Progression] LevelCatalog: unknown level ${level}, falling back to level 1`);
    const fallback = LEVEL_TABLE[FIRST_LEVEL];
    // 一定存在(表是常量)。
    return fallback!;
  }
  return cfg;
}

/**
 * 关卡表里"最大的关卡号"(第一版 = 5;通关 = 打死 level 5 的 Boss)。
 *
 * 用途:
 *  - `GameSceneController` 在 `running → portal → shop → running` 切换
 *    时检查 `nextLevel > maxLevel` → 直接进 `victory`。
 *  - 单测断言"通关后不再产生 portal"。
 */
export function getMaxLevel(): number {
  let max = 0;
  for (const k of Object.keys(LEVEL_TABLE)) {
    const n = Number(k);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}
