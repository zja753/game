/**
 * `HealthController` 单元测试(plan/modules/player.md §7 验收点)。
 *
 * 测:
 *  - 受伤 3 次(10/10/10):第一二次扣血,第三次被无敌帧挡掉 —— 只调 2 次 onDamage。
 *  - 死亡时 isDead() 一次 true 之后**不**会变回 false;`reset()` 才复位。
 *  - 接触伤害节流:同 enemyId 在重叠期间只扣一次;`endContact` 后再 begin 才再扣。
 *  - 加血封顶 maxHp;`amount <= 0` 是 no-op。
 *  - `applyDamage(amount <= 0)` / 已死亡 → 不调 onDamage / onDeath,返回 false。
 *  - `applyDamage` 一次性把 hp 打空,触发 `onDeath`,先 onDamage 后 onDeath。
 *  - `addBuff` 透传给 onBuffAdded(空操作本模块不存)。
 */
import { describe, expect, it } from "vite-plus/test";
import {
  HealthController,
  DEFAULT_PLAYER_MAX_HP,
  INVULNERABLE_DURATION_MS,
} from "./HealthController";
import type { BuffSpec } from "../../../runtime/ports/PlayerPort";
import type { HealthControllerDeps } from "./HealthController";

/** 测试用 deps 工厂,记录 onDamage / onDeath / onBuffAdded 调用序列。 */
function makeDeps(nowMs = 0): HealthControllerDeps & {
  damage: Array<{ hp: number; maxHp: number; from: unknown }>;
  deaths: number[];
  buffs: BuffSpec[];
  setNow(ms: number): void;
} {
  const ret: ReturnType<typeof makeDeps> = {
    now: () => nowMs,
    onDamage: (hp, maxHp, from) => {
      ret.damage.push({ hp, maxHp, from });
    },
    onDeath: (at) => {
      ret.deaths.push(at);
    },
    onBuffAdded: (b) => {
      ret.buffs.push(b);
    },
    damage: [],
    deaths: [],
    buffs: [],
    setNow(_ms: number) {
      // present for shape parity; not used (HealthController 一次扣血后读 now()).
    },
  };
  return ret;
}

describe("HealthController", () => {
  it("applyDamage 正常路径:扣血 + 进无敌帧 + 调 onDamage", () => {
    const deps = makeDeps(1000);
    const c = new HealthController(deps);
    expect(c.hpValue()).toBe(DEFAULT_PLAYER_MAX_HP);

    const ok = c.applyDamage(10, "enemy-A");
    expect(ok).toBe(true);
    expect(c.hpValue()).toBe(DEFAULT_PLAYER_MAX_HP - 10);
    expect(c.invulnerableRemaining()).toBe(INVULNERABLE_DURATION_MS);
    expect(deps.damage).toEqual([
      { hp: DEFAULT_PLAYER_MAX_HP - 10, maxHp: DEFAULT_PLAYER_MAX_HP, from: "enemy-A" },
    ]);
    expect(deps.deaths).toEqual([]);
  });

  it("3 次 10 点伤害只有 2 次实际扣血(无敌帧节流),plan §7 验收点", () => {
    const deps = makeDeps();
    const c = new HealthController(deps);
    expect(c.applyDamage(10, "a")).toBe(true);
    expect(c.applyDamage(10, "b")).toBe(false); // 无敌帧内
    expect(c.applyDamage(10, "c")).toBe(false); // 无敌帧内
    expect(c.hpValue()).toBe(DEFAULT_PLAYER_MAX_HP - 10);
    expect(deps.damage.length).toBe(1);
  });

  it("dead 一旦为 true,后续 applyDamage 永远 false(plan §7 验收点)", () => {
    const deps = makeDeps();
    const c = new HealthController(deps);
    c.applyDamage(DEFAULT_PLAYER_MAX_HP, "fatal");
    expect(c.isDead()).toBe(true);
    expect(deps.deaths.length).toBe(1);
    expect(c.applyDamage(10, "extra")).toBe(false);
    expect(c.applyDamage(10, "extra-2")).toBe(false);
    expect(deps.deaths.length).toBe(1);
    expect(c.hpValue()).toBe(0);
  });

  it("扣血致死:onDamage 在 onDeath 之前调", () => {
    const order: string[] = [];
    const c = new HealthController({
      now: () => 9999,
      onDamage: () => order.push("damage"),
      onDeath: () => order.push("death"),
    });
    expect(c.applyDamage(DEFAULT_PLAYER_MAX_HP, "fatal")).toBe(true);
    expect(order).toEqual(["damage", "death"]);
  });

  it("amount <= 0 是 no-op,既不扣血也不调 onDamage", () => {
    const deps = makeDeps();
    const c = new HealthController(deps);
    expect(c.applyDamage(0)).toBe(false);
    expect(c.applyDamage(-5)).toBe(false);
    expect(c.hpValue()).toBe(DEFAULT_PLAYER_MAX_HP);
    expect(deps.damage.length).toBe(0);
  });

  it("applyHeal 封顶 maxHp;`amount <= 0` no-op", () => {
    const deps = makeDeps();
    const c = new HealthController(deps);
    c.applyDamage(50, "x");
    c.applyHeal(20);
    expect(c.hpValue()).toBe(DEFAULT_PLAYER_MAX_HP - 30);
    c.applyHeal(9999);
    expect(c.hpValue()).toBe(DEFAULT_PLAYER_MAX_HP);
    c.applyHeal(0);
    expect(c.hpValue()).toBe(DEFAULT_PLAYER_MAX_HP);
    c.applyHeal(-10);
    expect(c.hpValue()).toBe(DEFAULT_PLAYER_MAX_HP);
  });

  it("tick(dt) 推进无敌帧计时", () => {
    const deps = makeDeps();
    const c = new HealthController(deps);
    c.applyDamage(10, "a");
    expect(c.invulnerableRemaining()).toBe(INVULNERABLE_DURATION_MS);
    c.tick(100);
    expect(c.invulnerableRemaining()).toBe(INVULNERABLE_DURATION_MS - 100);
    c.tick(99999);
    expect(c.invulnerableRemaining()).toBe(0);
    c.tick(50);
    expect(c.invulnerableRemaining()).toBe(0); // 不变负
  });

  it("节流:同 enemyId 重叠只扣一次;endContact 后再 begin 才再扣(plan §7)", () => {
    const deps = makeDeps();
    const c = new HealthController(deps);
    expect(c.beginContact(7, 10)).toBe(true);
    expect(c.inContactCount()).toBe(1);
    // 还在接触 + 仍在无敌帧:都返回 false,但不重复扣血。
    expect(c.beginContact(7, 10)).toBe(false);
    expect(c.inContactCount()).toBe(1);

    // 离开接触 + 等无敌帧过去 → 再 begin 会再扣一次。
    c.endContact(7);
    expect(c.inContactCount()).toBe(0);
    c.tick(INVULNERABLE_DURATION_MS + 1);
    expect(c.beginContact(7, 10)).toBe(true);
    expect(deps.damage.length).toBe(2);
  });

  it("endContact 对未注册的 enemyId 是 no-op(容错)", () => {
    const deps = makeDeps();
    const c = new HealthController(deps);
    c.endContact(999); // 不存在,不报错
    expect(c.inContactCount()).toBe(0);
  });

  it("reset() 复满 HP + 重置死亡标志 / 无敌帧 / 接触表", () => {
    const deps = makeDeps();
    const c = new HealthController(deps);
    c.applyDamage(DEFAULT_PLAYER_MAX_HP, "kill");
    expect(c.isDead()).toBe(true);
    c.beginContact(11, 5);
    c.reset();
    expect(c.hpValue()).toBe(DEFAULT_PLAYER_MAX_HP);
    expect(c.isDead()).toBe(false);
    expect(c.invulnerableRemaining()).toBe(0);
    expect(c.inContactCount()).toBe(0);
  });

  it("addBuff 透传给 onBuffAdded(本模块不存 buff 表)", () => {
    const deps = makeDeps();
    const c = new HealthController(deps);
    const spec: BuffSpec = { id: "speed+", label: "Speed+", stacks: 1 };
    c.addBuff(spec);
    expect(deps.buffs).toEqual([spec]);
  });
});
