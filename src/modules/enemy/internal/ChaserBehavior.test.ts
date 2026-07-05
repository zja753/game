/**
 * `ChaserBehavior` 单元测试(plan/modules/enemy.md §5 内部子模块 2 + §7 验收点)。
 *
 * 测:
 *  - "敌人 + 玩家" 返回朝玩家的**单位向量**(模长 1)。
 *  - 玩家不存在 → 原地不动(返回 0 向量)。
 *  - 自己与玩家重合 → 原地不动(避免 NaN)。
 *  - 方向与"距离"无关,纯几何朝向(1m 与 100m 距离方向相同)。
 *  - 同方向上跑 5 秒,自己 / 玩家距离变近(行为策略 + 速度配合后,验证方向正确)。
 */
import { describe, expect, it } from "vite-plus/test";
import { createChaserBehavior } from "./ChaserBehavior";
import type { BehaviorContext } from "./EnemyRegistry";

function makeCtx(
  self: { x: number; y: number },
  player: { x: number; y: number } | null,
): BehaviorContext {
  return {
    now: 0,
    dt: 16,
    self: { id: 1, kind: "chaser", pos: { x: self.x, y: self.y }, hp: 100 },
    player: player ? { id: 99, pos: { x: player.x, y: player.y } } : null,
  };
}

describe("ChaserBehavior", () => {
  it("返回朝玩家的单位向量(模长 = 1)", () => {
    const bhv = createChaserBehavior();
    const ctx = makeCtx({ x: 0, y: 0 }, { x: 30, y: 40 });
    const v = bhv.tick(ctx);
    expect(v.x).toBeCloseTo(0.6, 5);
    expect(v.y).toBeCloseTo(0.8, 5);
    const len = Math.hypot(v.x, v.y);
    expect(len).toBeCloseTo(1.0, 5);
  });

  it("距离无关:1000px 远 vs 1px 远,方向相同", () => {
    const bhv = createChaserBehavior();
    const farCtx = makeCtx({ x: 0, y: 0 }, { x: 3000, y: 4000 });
    const nearCtx = makeCtx({ x: 0, y: 0 }, { x: 0.3, y: 0.4 });
    const far = bhv.tick(farCtx);
    const near = bhv.tick(nearCtx);
    // 方向应一致(忽略浮点尾迹)。
    expect(far.x).toBeCloseTo(near.x, 5);
    expect(far.y).toBeCloseTo(near.y, 5);
  });

  it("玩家不存在 → 原地不动 (0, 0)", () => {
    const bhv = createChaserBehavior();
    const v = bhv.tick(makeCtx({ x: 50, y: 50 }, null));
    expect(v).toEqual({ x: 0, y: 0 });
  });

  it("自己与玩家重合 → 原地不动(避免 NaN)", () => {
    const bhv = createChaserBehavior();
    const v = bhv.tick(makeCtx({ x: 100, y: 100 }, { x: 100, y: 100 }));
    expect(v).toEqual({ x: 0, y: 0 });
  });

  it("id 字段 = 'chaser'(与 EnemySpec.behavior 同源)", () => {
    const bhv = createChaserBehavior();
    expect(bhv.id).toBe("chaser");
  });

  it("方向 + 速度(80px/s)模拟追击:5 帧后距离变近(<起始距离)", () => {
    const bhv = createChaserBehavior();
    // 起始 100px 远,80px/s 速度。1 秒后距离 < 100 - 80 = 20。
    let self = { x: 0, y: 0 };
    const dt = 200; // 200ms / 帧
    const speed = 80; // px/s
    for (let i = 0; i < 5; i++) {
      const v = bhv.tick({
        now: i * dt,
        dt,
        self: { id: 1, kind: "chaser", pos: self, hp: 100 },
        player: { id: 99, pos: { x: 100, y: 0 } },
      });
      const step = (speed * dt) / 1000;
      self = { x: self.x + v.x * step, y: self.y + v.y * step };
    }
    // 1 秒后:距离 < 100 - 80 = 20
    const dist = Math.hypot(self.x - 100, self.y - 0);
    expect(dist).toBeLessThanOrEqual(20);
    expect(dist).toBeGreaterThan(0);
  });
});
