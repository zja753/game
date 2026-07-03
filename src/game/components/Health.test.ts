/**
 * `Health` 组件单测 —— 不依赖 Excalibur 引擎,纯逻辑验证。
 *
 * 关注点:
 * - `takeDamage` 在无敌帧约束下按 `floor(t / invulnerableDuration)` 的频率触发 `damage` 事件;
 * - `death` 事件只在 HP 归零的瞬间触发一次,之后 `takeDamage` 静默;
 * - `heal` 不打破无敌帧,也不让 HP 越界;
 * - `update` 按传入毫秒数正确推进无敌帧。
 */
import { describe, expect, it, vi } from "vite-plus/test";

import { Health, HealthEvent, type HealthDamagePayload } from "./Health";

describe("Health", () => {
  it("按 invulnerableDuration 节流触发 damage 事件 (floor(t / 0.4))", () => {
    vi.useFakeTimers();
    try {
      const h = new Health({ maxHp: 10, invulnerableDuration: 0.4 });
      const damage = vi.fn();
      h.onDamage(damage);

      // 每帧推进 16.67ms (60fps),持续 2 秒。
      // floor(2000 / 400) = 5 次有效扣血。
      const frames = 120;
      for (let i = 0; i < frames; i++) {
        h.takeDamage(1);
        h.update(16.6667);
      }

      expect(damage).toHaveBeenCalledTimes(5);
      expect(h.hp).toBe(5);
      expect(h.isInvulnerable()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hp 归零触发一次 death,后续 takeDamage 静默", () => {
    const h = new Health({ maxHp: 3, invulnerableDuration: 0 });
    const death = vi.fn();
    h.onDeath(death);

    expect(h.takeDamage(3)).toBe(true);
    expect(h.hp).toBe(0);
    expect(h.isDead).toBe(true);
    expect(death).toHaveBeenCalledTimes(1);

    // 死亡后继续尝试扣血:不报错、不再触发 damage / death。
    const damage = vi.fn();
    h.onDamage(damage);
    expect(h.takeDamage(99)).toBe(false);
    expect(death).toHaveBeenCalledTimes(1);
    expect(damage).not.toHaveBeenCalled();
  });

  it("heal 不超过 maxHp,且不清除无敌帧", () => {
    const h = new Health({ maxHp: 10, invulnerableDuration: 0.4 });
    h.takeDamage(8);
    expect(h.hp).toBe(2);
    expect(h.isInvulnerable()).toBe(true);

    expect(h.heal(100)).toBe(8); // 实际只回了 8
    expect(h.hp).toBe(10);
    expect(h.isInvulnerable()).toBe(true); // 无敌帧仍在
  });

  it("takeDamage 在 invulnerableTimer > 0 时静默返回 false,不扣血", () => {
    const h = new Health({ maxHp: 10, invulnerableDuration: 0.4 });
    const damage = vi.fn();
    h.onDamage(damage);

    expect(h.takeDamage(1)).toBe(true);
    expect(h.takeDamage(1)).toBe(false);
    expect(h.takeDamage(1)).toBe(false);
    expect(h.hp).toBe(9);
    expect(damage).toHaveBeenCalledTimes(1);
  });

  it("update 推进 invulnerableTimer,衰减到 0 后 isInvulnerable 为 false", () => {
    const h = new Health({ maxHp: 10, invulnerableDuration: 0.4 });
    h.takeDamage(1);
    expect(h.invulnerableTimer).toBeCloseTo(0.4);

    h.update(200);
    expect(h.invulnerableTimer).toBeCloseTo(0.2);
    expect(h.isInvulnerable()).toBe(true);

    h.update(500); // 超出剩余值,自动夹到 0
    expect(h.invulnerableTimer).toBe(0);
    expect(h.isInvulnerable()).toBe(false);
  });

  it("damage 事件 payload 携带 amount / hp / maxHp / source", () => {
    const h = new Health({ maxHp: 5, invulnerableDuration: 0 });
    const seen: HealthDamagePayload[] = [];
    h.onDamage((p) => seen.push(p));

    h.takeDamage(2, { source: "test-enemy" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ amount: 2, hp: 3, maxHp: 5, source: "test-enemy" });
  });

  it("HealthEvent 常量与订阅通道一致", () => {
    const h = new Health({ maxHp: 1, invulnerableDuration: 0 });
    const damage = vi.fn();
    h.events.on(HealthEvent.Damage, damage);
    h.takeDamage(1);
    expect(damage).toHaveBeenCalledTimes(1);
  });
});
