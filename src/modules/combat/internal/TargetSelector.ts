/**
 * `TargetSelector` — 选目标(plan/modules/combat.md §5 内部子模块 4)。
 *
 * 职责:在 `tryFire` 内部从 `EnemyPort.list()` 提供的快照里,
 *      找 **origin 距离 ≤ range** 的 **最近一个** 敌人。
 *
 * 关键设计点(plan §5 / §7 Demo 验收点 3):
 *  - 找不到目标(射程外或无敌人)返回 `null`,**不**消耗冷却 —— 这就是
 *    "打不到不浪费弹药"的语义,实现方按 `null` 决定 tryFire 整体返回 false。
 *  - 不区分"有敌人在场上但超射程"和"完全没敌人":都返回 `null`。
 *  - 距离用欧式距离(`Math.hypot`);不区分 `player` 朝向(plan §5
 *    "射程内最近"语义)。
 *  - **不**做缓存,linear scan 即可(`EnemyPort.list()` 返回的列表规模
 *    第一版 ≤ 50,O(n) 不成问题)。
 *
 * 纯函数化:不依赖 Excalibur、不依赖 EventBus,单测可直接喂数据。
 */
import type { Vec2 } from "../../../runtime/types";
import type { EnemySnapshot } from "../../../runtime/ports/EnemyPort";

/**
 * 选目标结果:`{ target }` 描述胜出者,或 `{ target: null }` 描述没找到。
 *
 * 用对象包一层(而不是直接 `EnemySnapshot | null`)是给后续
 * 扩展留位(比如"附带目标距离 / 方向"等);现在没多余字段。
 */
export interface TargetSelection {
  target: EnemySnapshot | null;
}

/**
 * 从 `enemies` 列表里挑一个射程内最近的敌人。
 *
 * @param origin 弹道起点(世界坐标,像素)。
 * @param range 射程(像素);**不**做 clamp(由调用方传合法正数)。
 * @param enemies 候选列表(由 `EnemyPort.list()` 提供)。
 * @returns `{ target: <EnemySnapshot> }` 或 `{ target: null }`(找不到时)。
 */
export function selectNearestInRange(
  origin: Vec2,
  range: number,
  enemies: readonly EnemySnapshot[],
): TargetSelection {
  let best: EnemySnapshot | null = null;
  // 初始化成 Infinity:第一个距离 ≤ range 的敌人**一定**进来(避免"边界 = range
  // 但 bestDist 也被初始化成 range"导致首次失配);距离相等时保持遍历顺序的
  // "第一个胜出"(严格 <)。
  let bestDist = Number.POSITIVE_INFINITY;

  for (const e of enemies) {
    const dx = e.pos.x - origin.x;
    const dy = e.pos.y - origin.y;
    const dist = Math.hypot(dx, dy);
    // 射程检查:超出 range 不考虑。严格 <:距离相等时保持遍历顺序的
    // "第一个胜出",避免后写的把前写的覆盖。
    if (dist <= range && dist < bestDist) {
      best = e;
      bestDist = dist;
    }
  }

  return { target: best };
}
