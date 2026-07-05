/**
 * `PlayerMover` 单元测试(plan/modules/player.md §7 验收点)。
 *
 * 测:
 *  - vel = 0 时 step() 不调 isBlocked 也不写位置(零向量早退)。
 *  - 横移通过时,水平位移按 vel*dt 写入;撞墙则水平不动、单尝试垂直轴。
 *  - 竖移通过 / 撞墙的对称路径(单轴 vel != 0)。
 *  - setVel 自动把超长向量 clamp 到 maxSpeed(避免斜角 buff 让玩家飞出)。
 *  - stop() / reset() 把 vel 清零。
 *  - 设置 setMaxSpeed 后,setVel 的 clamp 上限跟着走。
 *  - 轴分离:贴墙横移会被卡,但垂直方向仍能前进(不卡墙角)。
 */
import { describe, expect, it } from "vite-plus/test";
import { PlayerMover, DEFAULT_PLAYER_SPEED } from "./PlayerMover";
import type { MapObstaclePort } from "../../../runtime/ports/MapObstaclePort";
import type { Vec2 } from "../../../runtime/types";

/**
 * 内置 `MapObstacle` stub:接受一组"被挡住"的点矩形,`isBlocked` 走点查询。
 * 默认空地图 → 所有点都自由。
 */
function makeObstacles(rects: Array<{ min: Vec2; max: Vec2 }> = []): {
  port: MapObstaclePort;
  blockedCallCount: () => number;
} {
  let blockedCalls = 0;
  const port: MapObstaclePort = {
    isBlocked(p: Vec2): boolean {
      blockedCalls++;
      for (const r of rects) {
        if (p.x >= r.min.x && p.x <= r.max.x && p.y >= r.min.y && p.y <= r.max.y) {
          return true;
        }
      }
      return false;
    },
    bounds: () => ({
      min: { x: 0, y: 0 },
      max: { x: 1000, y: 1000 },
    }),
    loadLevel: () => {},
    raycast: () => null,
    playerSpawn: () => ({ x: 500, y: 500 }),
    portalSpawn: () => ({ x: 950, y: 950 }),
    level: () => ({
      id: "level-1",
      bounds: { min: { x: 0, y: 0 }, max: { x: 1000, y: 1000 } },
    }),
  };
  return {
    port,
    blockedCallCount: () => blockedCalls,
  };
}

/** 持有 mover + 当前写入位置(用 getter 暴露快照)。 */
interface MoverHarness {
  mover: PlayerMover;
  pos(): Vec2;
  blockedCalls(): number;
}
function makeMover(rects: Array<{ min: Vec2; max: Vec2 }> = []): MoverHarness {
  let cur: Vec2 = { x: 50, y: 50 };
  const obs = makeObstacles(rects);
  const mover = new PlayerMover({
    obstacles: obs.port,
    applyPosition: (p) => {
      cur = { x: p.x, y: p.y };
    },
    getPosition: () => ({ x: cur.x, y: cur.y }),
  });
  return {
    mover,
    pos: () => ({ x: cur.x, y: cur.y }),
    blockedCalls: obs.blockedCallCount,
  };
}

describe("PlayerMover", () => {
  it("vel = 0 时 step() 早退,不写位置也不查 isBlocked", () => {
    const m = makeMover();
    m.mover.step(16);
    expect(m.pos()).toEqual({ x: 50, y: 50 });
    expect(m.blockedCalls()).toBe(0);
  });

  it("vel 非零 + 空地图:水平移动 dt × vel", () => {
    const m = makeMover();
    m.mover.setVel({ x: 100, y: 0 });
    m.mover.step(100); // dt=100ms, vel=100px/s → dx=10
    expect(m.pos().x).toBeCloseTo(60, 6);
    expect(m.pos().y).toBeCloseTo(50, 6);
  });

  it("dt <= 0 时 step() 是 no-op", () => {
    const m = makeMover();
    m.mover.setVel({ x: 100, y: 0 });
    m.mover.step(0);
    expect(m.pos()).toEqual({ x: 50, y: 50 });
    m.mover.step(-5);
    expect(m.pos()).toEqual({ x: 50, y: 50 });
  });

  it("横移撞墙:水平被卡,后续可垂直继续走(轴分离)", () => {
    // 墙在玩家右侧,x ∈ [60, 100], y ∈ [40, 60]
    const m = makeMover([{ min: { x: 60, y: 40 }, max: { x: 100, y: 60 } }]);
    m.mover.setVel({ x: 100, y: 0 });
    m.mover.step(100); // 试图向 +x 推 10
    expect(m.pos().x).toBe(50); // 完全卡住,水平没动
    expect(m.pos().y).toBe(50);

    // 单独走 Y(垂直方向)能走:墙只挡 X。
    m.mover.setVel({ x: 0, y: 100 });
    m.mover.step(100);
    expect(m.pos().x).toBe(50);
    expect(m.pos().y).toBeCloseTo(60, 6);
  });

  it("斜角 vel=√2 × max 时,setVel 自动 clamp 模长到 maxSpeed", () => {
    const m = makeMover();
    m.mover.setVel({ x: 300, y: 0 });
    const v = m.mover.currentVel();
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(DEFAULT_PLAYER_SPEED, 6);
  });

  it("setMaxSpeed 后,clamp 上限跟着改", () => {
    const m = makeMover();
    m.mover.setMaxSpeed(500);
    m.mover.setVel({ x: 1000, y: 0 });
    const v = m.mover.currentVel();
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(500, 6);
  });

  it("stop() 把 vel 清零", () => {
    const m = makeMover();
    m.mover.setVel({ x: 100, y: 0 });
    m.mover.stop();
    expect(m.mover.currentVel()).toEqual({ x: 0, y: 0 });
  });

  it("reset() 把 vel 清零,且把 maxSpeed 回到默认", () => {
    const m = makeMover();
    m.mover.setVel({ x: 100, y: 0 });
    m.mover.setMaxSpeed(500);
    m.mover.reset();
    expect(m.mover.currentVel()).toEqual({ x: 0, y: 0 });
    expect(m.mover.maxSpeedValue()).toBe(DEFAULT_PLAYER_SPEED);
  });
});
