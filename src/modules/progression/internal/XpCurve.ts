/**
 * `XpCurve` — 玩家升级经验曲线(plan/modules/progression.md §6 子模块 2)。
 *
 * **纯函数**,无副作用,无 IO。`XpCurve` 只回答一个数学问题:
 * "从等级 `N-1` 升到 `N` 需要多少经验"。
 *
 * 等级语义:
 *  - 玩家从 1 级开始(roadmap `levelup_modal` 是 1→2 的转移)。
 *  - `xpToNext(level)` 返回"当前等级 `level` 升到 `level+1` 所需经验"。
 *  - 等级 1 时返回 base;等级越高,需要的经验越多。
 *
 * 曲线形状(plan §6 `XpCurve` 注释:"数值表在 `modules/_shared/xpCurve.ts`"):
 *  - 复刻土豆兄弟的"指数近似线性"曲线:基线 + 等级倍率。
 *  - 我们用 `base + perLevel * (level - 1) + growth * (level - 1) ** 1.5`
 *    —— 一阶项保证低等级步长平稳,二阶项让高等级压力递增但不至于爆炸。
 *  - 数值参数独立为常量,便于后续调参。
 *
 * 复用性:
 *  - 单测里直接 `expect(xpToNext(1)).toBe(...)` 即可,不需要 mock。
 *  - 装配阶段 GameSceneController 调它算 `xpToNext`。
 */

/** 等级 1 升到 2 所需经验(基准)。 */
const BASE_XP = 5;
/** 每一级额外的线性项(等级 `N` 增 `perLevel * (N-1)`)。 */
const PER_LEVEL_XP = 5;
/** 每一级的指数增长项(等级 `N` 增 `growth * (N-1) ** 1.5`)。 */
const GROWTH_XP = 0.5;

/**
 * 升到下一玩家等级所需经验。
 *
 * @param level 当前玩家等级(1-based;1 → 2 算 `xpToNext(1)`)。
 * @returns 所需经验(正数);`< 1` 也算 1(避免 `level=0` 时返回 0)。
 *
 * **不**保证 `xpToNext() > xp()` —— `xp()` 是当前经验,可比 0 大、达到阈值时跨级。
 */
export function xpToNext(level: number): number {
  if (level < 1) {
    // 容错:等级 < 1 视为 1。
    return Math.max(1, BASE_XP);
  }
  const linear = PER_LEVEL_XP * (level - 1);
  const growth = GROWTH_XP * (level - 1) ** 1.5;
  const raw = BASE_XP + linear + growth;
  // 向下取整,数值更稳定(避免 7.5 这种对玩家提示不友好的浮点)。
  return Math.max(1, Math.floor(raw));
}
