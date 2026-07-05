/**
 * `EnemyRegistry` 单元测试(plan/modules/enemy.md §5 内部子模块 1 + §7 验收点)。
 *
 * 测:
 *  - `registerEnemySpec` / `getEnemySpec` / `hasEnemySpec` / `requireEnemySpec`:
 *    已注册 / 未注册两条路径;`requireEnemySpec` 对未知 kind 抛错。
 *  - `registerBehavior` / `requireBehavior` / `getBehavior`:同上。
 *  - `listEnemyKinds`:按注册顺序返回。
 *  - `_resetRegistryForTests`:清空后状态对得上"刚启动"的样子。
 *  - `DEFAULT_CHASER_SPEC` 默认值:复刻土豆兄弟首关(80 速 / 20HP / 5 接触伤害)。
 */
import { describe, expect, it, beforeEach } from "vite-plus/test";
import {
  DEFAULT_CHASER_SPEC,
  _resetRegistryForTests,
  getBehavior,
  getEnemySpec,
  hasEnemySpec,
  listEnemyKinds,
  registerBehavior,
  registerEnemySpec,
  requireBehavior,
  requireEnemySpec,
} from "./EnemyRegistry";
import type { BehaviorStrategy } from "./EnemyRegistry";

beforeEach(() => {
  _resetRegistryForTests();
});

function makeDummyBehavior(id: string): BehaviorStrategy {
  return {
    id,
    tick() {
      return { x: 0, y: 0 };
    },
  };
}

describe("EnemyRegistry", () => {
  describe("registerEnemySpec / getEnemySpec / hasEnemySpec", () => {
    it("未注册 kind → getEnemySpec 返回 null,hasEnemySpec=false", () => {
      expect(getEnemySpec("chaser")).toBe(null);
      expect(hasEnemySpec("chaser")).toBe(false);
    });

    it("已注册 kind → get 返回同对象,has=true", () => {
      registerEnemySpec("chaser", { ...DEFAULT_CHASER_SPEC, label: "测试版" });
      const got = getEnemySpec("chaser");
      expect(got).not.toBe(null);
      expect(got?.label).toBe("测试版");
      expect(hasEnemySpec("chaser")).toBe(true);
    });

    it("重复注册 → 覆盖(便于单测 reload)", () => {
      registerEnemySpec("chaser", { ...DEFAULT_CHASER_SPEC, label: "v1" });
      registerEnemySpec("chaser", { ...DEFAULT_CHASER_SPEC, label: "v2" });
      expect(getEnemySpec("chaser")?.label).toBe("v2");
    });
  });

  describe("requireEnemySpec", () => {
    it("未注册 → 抛错", () => {
      expect(() => requireEnemySpec("不存在")).toThrow(/Unknown EnemyKind/);
    });

    it("已注册 → 返回 spec", () => {
      registerEnemySpec("chaser", DEFAULT_CHASER_SPEC);
      expect(requireEnemySpec("chaser")).toBe(DEFAULT_CHASER_SPEC);
    });
  });

  describe("registerBehavior / requireBehavior / getBehavior", () => {
    it("未注册 id → getBehavior 返回 null,requireBehavior 抛错", () => {
      expect(getBehavior("anything")).toBe(null);
      expect(() => requireBehavior("missing")).toThrow(/Unknown BehaviorId/);
    });

    it("已注册 id → 双向都返回", () => {
      const b = makeDummyBehavior("test-bhv");
      registerBehavior(b);
      expect(getBehavior("test-bhv")).toBe(b);
      expect(requireBehavior("test-bhv")).toBe(b);
    });
  });

  describe("listEnemyKinds", () => {
    it("空 → 返回空数组", () => {
      expect(listEnemyKinds()).toEqual([]);
    });

    it("多个注册 → 按注册顺序返回", () => {
      registerEnemySpec("a", { ...DEFAULT_CHASER_SPEC, label: "a" });
      registerEnemySpec("b", { ...DEFAULT_CHASER_SPEC, label: "b" });
      registerEnemySpec("c", { ...DEFAULT_CHASER_SPEC, label: "c" });
      expect(listEnemyKinds()).toEqual(["a", "b", "c"]);
    });
  });

  describe("DEFAULT_CHASER_SPEC", () => {
    it("默认数值匹配土豆兄弟首关(chapter 1 杂兵)", () => {
      expect(DEFAULT_CHASER_SPEC.behavior).toBe("chaser");
      expect(DEFAULT_CHASER_SPEC.speed).toBe(80);
      expect(DEFAULT_CHASER_SPEC.maxHp).toBe(20);
      expect(DEFAULT_CHASER_SPEC.contactDamage).toBe(5);
      expect(DEFAULT_CHASER_SPEC.xpReward).toBe(1);
      expect(DEFAULT_CHASER_SPEC.label).toBe("chaser");
    });
  });
});
