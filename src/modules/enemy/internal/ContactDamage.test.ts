/**
 * `ContactDamage` 单元测试(plan/modules/enemy.md §5 内部子模块 4 + §7 验收点)。
 *
 * 测:
 *  - 第一次 onContactStart:扣血成功,applyDamage 被调一次。
 *  - 紧接着 onContactStay(节流期内):不扣血。
 *  - 等到节流过去后,onContactStay:再扣一次。
 *  - endContact → 再次 begin 时立即扣血(状态清掉)。
 *  - endContact 对未知 enemyId 是 no-op(容错)。
 *  - damage <= 0:不调 applyDamage,只更新时间戳(避免 0 伤害风暴)。
 *  - reset 清掉所有状态。
 */
import { describe, expect, it, beforeEach } from "vite-plus/test";
import { DEFAULT_HIT_COOLDOWN_MS, createContactDamage } from "./ContactDamage";
import type { ActorId, Vec2 } from "../../../runtime/types";
import type { PlayerPort } from "../../../runtime/ports/PlayerPort";

let nowMs = 0;
let damageLog: Array<{ amount: number; from: unknown }> = [];

function makePlayerStub(): PlayerPort {
  return {
    id: () => 99 as ActorId,
    pos: (): Vec2 => ({ x: 0, y: 0 }),
    setPos: () => {},
    hp: () => 100,
    maxHp: () => 100,
    applyDamage: (amount, from) => {
      damageLog.push({ amount, from });
      return true;
    },
    applyHeal: () => {},
    addBuff: () => {},
    isDead: () => false,
    reset: () => {},
  };
}

beforeEach(() => {
  nowMs = 0;
  damageLog = [];
});

describe("ContactDamage", () => {
  it("第一次 onContactStart:扣血成功", () => {
    const cd = createContactDamage({
      player: makePlayerStub(),
      now: () => nowMs,
    });
    const r = cd.onContactStart({ enemyId: 1 as ActorId, damage: 5 });
    expect(r).toBe(true);
    expect(damageLog.length).toBe(1);
    expect(damageLog[0]?.amount).toBe(5);
  });

  it("节流期内 onContactStay:不扣血", () => {
    const cd = createContactDamage({
      player: makePlayerStub(),
      now: () => nowMs,
    });
    cd.onContactStart({ enemyId: 1 as ActorId, damage: 5 });
    nowMs = 100; // 在 500ms 节流内
    const r = cd.onContactStay({ enemyId: 1 as ActorId, damage: 5 });
    expect(r).toBe(false);
    expect(damageLog.length).toBe(1);
  });

  it("节流过去后 onContactStay:再扣一次", () => {
    const cd = createContactDamage({
      player: makePlayerStub(),
      now: () => nowMs,
    });
    cd.onContactStart({ enemyId: 1 as ActorId, damage: 5 });
    nowMs = DEFAULT_HIT_COOLDOWN_MS + 1;
    const r = cd.onContactStay({ enemyId: 1 as ActorId, damage: 5 });
    expect(r).toBe(true);
    expect(damageLog.length).toBe(2);
  });

  it("endContact → 再次 begin 时立即扣血(状态清掉)", () => {
    const cd = createContactDamage({
      player: makePlayerStub(),
      now: () => nowMs,
    });
    cd.onContactStart({ enemyId: 1 as ActorId, damage: 5 });
    cd.onContactEnd(1 as ActorId);
    // 立刻 begin(还没过节流) — 由于上次节流状态被清,这次会成功。
    const r = cd.onContactStart({ enemyId: 1 as ActorId, damage: 5 });
    expect(r).toBe(true);
    expect(damageLog.length).toBe(2);
  });

  it("endContact 对未知 enemyId 是 no-op(容错)", () => {
    const cd = createContactDamage({
      player: makePlayerStub(),
      now: () => nowMs,
    });
    expect(() => cd.onContactEnd(999 as ActorId)).not.toThrow();
  });

  it("damage <= 0:不调 applyDamage,但仍更新时间戳", () => {
    const cd = createContactDamage({
      player: makePlayerStub(),
      now: () => nowMs,
    });
    const r = cd.onContactStart({ enemyId: 1 as ActorId, damage: 0 });
    expect(r).toBe(false);
    expect(damageLog.length).toBe(0);
    // 紧接着在节流内 onContactStay 仍返回 false
    const r2 = cd.onContactStay({ enemyId: 1 as ActorId, damage: 0 });
    expect(r2).toBe(false);
  });

  it("reset → 清空所有状态", () => {
    const cd = createContactDamage({
      player: makePlayerStub(),
      now: () => nowMs,
    });
    cd.onContactStart({ enemyId: 1 as ActorId, damage: 5 });
    expect(damageLog.length).toBe(1);
    cd.reset();
    // reset 后立即 begin 也能扣(因为状态清空了)
    const r = cd.onContactStart({ enemyId: 1 as ActorId, damage: 5 });
    expect(r).toBe(true);
    expect(damageLog.length).toBe(2);
  });

  it("from 字段透传到 PlayerPort.applyDamage", () => {
    const cd = createContactDamage({
      player: makePlayerStub(),
      now: () => nowMs,
    });
    cd.onContactStart({ enemyId: 7 as ActorId, damage: 5 });
    expect(damageLog[0]?.from).toEqual({ kind: "contact", enemyId: 7 });
  });

  it("不同 enemyId 互不干扰", () => {
    const cd = createContactDamage({
      player: makePlayerStub(),
      now: () => nowMs,
    });
    cd.onContactStart({ enemyId: 1 as ActorId, damage: 5 });
    // 另一个 enemy 接触开始,节流不冲突
    const r2 = cd.onContactStart({ enemyId: 2 as ActorId, damage: 5 });
    expect(r2).toBe(true);
    expect(damageLog.length).toBe(2);
  });
});
