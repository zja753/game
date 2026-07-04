/**
 * `FacingTracker` 单元测试(plan/modules/player.md §7 验收点)。
 *
 * 测:
 *  - 默认策略:玩家面朝鼠标(`InputPort.axisAim`)方向。
 *  - 鼠标在玩家正中心(零向量)时,`facing` 保持上一帧,而不是被强制归零。
 *  - 鼠标远离玩家时,`facingAngle()` 用 `Math.atan2` 给出正确弧度。
 *  - `reset()` 把 facing 清零;下一帧 `update()` 会重新从 `axisAim` 读。
 *
 * 不依赖 Excalibur;`InputPort` 用最小 stub 注入。
 *
 * 实现上用 `InputFixture` 而**不**用解构 `setAim`,避免 `tsgolint` 的
 * `unbound-method` 警告把对象方法的引用当成 unbound 触发误报。
 */
import { describe, expect, it } from "vite-plus/test";
import { FacingTracker } from "./FacingTracker";
import type { InputPort } from "../../../runtime/ports/InputPort";
import type { Vec2 } from "../../../runtime/types";

/** 极简 `InputPort` stub —— 只暴露 FacingTracker 用到的两条路径。 */
interface InputFixture {
  port: InputPort;
  setAim(v: Vec2): void;
}

function makeInput(initialAim: Vec2 = { x: 1, y: 0 }): InputFixture {
  let aim = { ...initialAim };
  // 用箭头方法绑 `this`(其实是 no-op),避免把对象成员误判成 unbound method。
  const setAim = (v: Vec2): void => {
    aim = { x: v.x, y: v.y };
  };
  const port: InputPort = {
    isDown: () => false,
    axisMove: () => ({ x: 0, y: 0 }),
    axisAim: () => ({ x: aim.x, y: aim.y }),
    mousePos: () => ({ x: 0, y: 0 }),
    enable: () => {},
    disable: () => {},
  };
  return { port, setAim };
}

describe("FacingTracker", () => {
  it("update() 把 facing 设成当前 axisAim 方向", () => {
    const fx = makeInput({ x: 3, y: 4 });
    const tracker = new FacingTracker({ input: fx.port });
    fx.setAim({ x: 1, y: 0 });
    tracker.update();
    const f = tracker.current();
    expect(Math.hypot(f.x, f.y)).toBeCloseTo(1, 6);
    expect(f.x).toBeCloseTo(1, 6);
    expect(f.y).toBeCloseTo(0, 6);
  });

  it("axisAim 返回零向量时,保持上一帧 facing(不强制归零)", () => {
    const fx = makeInput({ x: 1, y: 0 });
    const tracker = new FacingTracker({ input: fx.port });
    fx.setAim({ x: 1, y: 0 });
    tracker.update();
    const before = tracker.current();
    // 鼠标移到玩家正中心 → axisAim → {0, 0}
    fx.setAim({ x: 0, y: 0 });
    tracker.update();
    const after = tracker.current();
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("facingAngle() 在 facing 未初始化时返回 0", () => {
    const fx = makeInput({ x: 1, y: 0 });
    const tracker = new FacingTracker({ input: fx.port });
    expect(tracker.facingAngle()).toBe(0);
  });

  it("facingAngle() 对 (1, 0) → 0,对 (0, 1) → +π/2", () => {
    const fx = makeInput();
    const tracker = new FacingTracker({ input: fx.port });
    fx.setAim({ x: 1, y: 0 });
    tracker.update();
    expect(tracker.facingAngle()).toBeCloseTo(0, 6);

    fx.setAim({ x: 0, y: 1 });
    tracker.update();
    expect(tracker.facingAngle()).toBeCloseTo(Math.PI / 2, 6);
  });

  it("reset() 清空 facing;之后 update() 会重新读 axisAim", () => {
    const fx = makeInput({ x: 1, y: 0 });
    const tracker = new FacingTracker({ input: fx.port });
    fx.setAim({ x: 1, y: 0 });
    tracker.update();
    expect(tracker.current()).toEqual({ x: 1, y: 0 });

    tracker.reset();
    expect(tracker.current()).toEqual({ x: 0, y: 0 });

    fx.setAim({ x: 0, y: 1 });
    tracker.update();
    expect(tracker.current()).toEqual({ x: 0, y: 1 });
  });
});
