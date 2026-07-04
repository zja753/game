/**
 * `WeaponRegistry` 单测(plan/modules/combat.md §5 内部子模块 1 + §7 验收点)。
 *
 * 覆盖:
 *  - `getWeaponSpec("pistol")` 返回 spec,dmg/range/cooldown 与 plan §9 一致。
 *  - `hasWeapon("pistol")` true / `hasWeapon("shotgun")` false(防御性)。
 *  - `defaultWeaponId()` 返回 `'pistol'`。
 *  - `listWeaponIds()` 包含 `'pistol'`,且是 readonly。
 *  - `baseCooldownMs` 派生正确(`1000 / fireRate`)。
 */
import { describe, expect, it } from "vite-plus/test";
import { defaultWeaponId, getWeaponSpec, hasWeapon, listWeaponIds } from "./WeaponRegistry";

describe("WeaponRegistry", () => {
  it("defaultWeaponId() 返回 'pistol'", () => {
    expect(defaultWeaponId()).toBe("pistol");
  });

  it("listWeaponIds() 至少包含 pistol", () => {
    const ids = listWeaponIds();
    expect(ids).toContain("pistol");
  });

  it("hasWeapon('pistol') true;未知 id 走 false", () => {
    expect(hasWeapon("pistol")).toBe(true);
    // 故意走 `as never` 模拟"未注册的 id" — TypeScript 不让我们直接传未知字面量。
    expect(hasWeapon("shotgun" as never)).toBe(false);
  });

  it("pistol spec 与 plan §9 一致(damage=10, range=600, baseCooldownMs=250)", () => {
    const spec = getWeaponSpec("pistol");
    expect(spec.damage).toBe(10);
    expect(spec.range).toBe(600);
    expect(spec.fireRate).toBe(4);
    expect(spec.baseCooldownMs).toBeCloseTo(250, 5);
  });

  it("pistol projectileCount=1(无散布),spread=0", () => {
    const spec = getWeaponSpec("pistol");
    expect(spec.projectileCount).toBe(1);
    expect(spec.spread).toBe(0);
  });
});
