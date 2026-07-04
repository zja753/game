/**
 * `selectNearestInRange` 单测(plan/modules/combat.md §5 内部子模块 4 + §7 Demo 验收点 3)。
 *
 * 覆盖:
 *  - 单个敌人 → 命中。
 *  - 多个敌人 → 选**最近**的(不区分方向,仅距离)。
 *  - 边界距离 = range → 命中(闭区间)。
 *  - 边界距离 = range + ε → 不命中(plan §5 "射程外不消耗节流"的关键路径)。
 *  - 空列表 → `{ target: null }`。
 *  - 距离相等 → 取遍历顺序的第一个(线性扫描稳定性)。
 */
import { describe, expect, it } from "vite-plus/test";
import { selectNearestInRange } from "./TargetSelector";
import type { EnemySnapshot } from "../../../runtime/ports/EnemyPort";

const mkEnemy = (id: number, x: number, y: number): EnemySnapshot => ({
  id,
  kind: "chaser",
  pos: { x, y },
  hp: 100,
  maxHp: 100,
});

describe("selectNearestInRange", () => {
  it("空列表 → { target: null }", () => {
    expect(selectNearestInRange({ x: 0, y: 0 }, 600, []).target).toBeNull();
  });

  it("单个敌人在射程内 → 命中", () => {
    const e = mkEnemy(1, 100, 0);
    const sel = selectNearestInRange({ x: 0, y: 0 }, 600, [e]);
    expect(sel.target).toEqual(e);
  });

  it("多个敌人 → 选最近的(plan §7 Demo 验收点 1:100,0 优先于 0,200 与 -200,0)", () => {
    const e1 = mkEnemy(1, 100, 0); // dist = 100
    const e2 = mkEnemy(2, 0, 200); // dist = 200
    const e3 = mkEnemy(3, -200, 0); // dist = 200
    const sel = selectNearestInRange({ x: 0, y: 0 }, 600, [e1, e2, e3]);
    expect(sel.target?.id).toBe(1);
  });

  it("射程边界 = range(闭区间)→ 命中", () => {
    // 距离恰好 600
    const e = mkEnemy(1, 600, 0);
    const sel = selectNearestInRange({ x: 0, y: 0 }, 600, [e]);
    expect(sel.target).not.toBeNull();
  });

  it("射程边界 = range + ε → 不命中(plan §5 关键设计点)", () => {
    // 距离 600.5,微超 range
    const e = mkEnemy(1, 600.5, 0);
    const sel = selectNearestInRange({ x: 0, y: 0 }, 600, [e]);
    expect(sel.target).toBeNull();
  });

  it("距离相同时 → 遍历顺序的第一个(稳定性)", () => {
    const e1 = mkEnemy(1, 100, 0);
    const e2 = mkEnemy(2, 0, 100);
    // 距离都是 sqrt(20000) ≈ 141.42
    const sel = selectNearestInRange({ x: 0, y: 0 }, 600, [e1, e2]);
    expect(sel.target?.id).toBe(1);
  });

  it("origin 与 target 重合(数学上 0 距离,但仍有敌人)→ 命中", () => {
    // 选目标路径返回最近;0 距离算最近
    const e = mkEnemy(1, 0, 0);
    const sel = selectNearestInRange({ x: 0, y: 0 }, 600, [e]);
    expect(sel.target).toEqual(e);
  });
});
