/**
 * `createMockCombat` — Combat 模块的 Mock 工厂(占位,见 plan §5.1)。
 *
 * 状态:
 *  - Combat 模块**已落地**(M4,2026-07-03),正式 mock 在
 *    `src/modules/combat/__mocks__/mockEnemy.ts`(EnemyPort 侧)与
 *    `src/modules/combat/CombatModule.ts`(完整装配)里。
 *  - 本工厂保留在 Player 模块下,作为"Player 单测用的最小 CombatPort stub",
 *    **不**引入 `EnemyPort` / `RuntimePort` 等依赖 — 玩家模块单测只关心
 *    `tryFire` 是否被调到,不需要武器 / 投射物 / 敌人这些子系统的真实现。
 *  - 第一版(2026-07-03 前)只 stub `tryFire()`,M4 起扩展为完整
 *    `CombatPort` 接口形态(其他方法走 no-op / 0 / [] 兜底)。
 */
import type { ActorId, Vec2, WeaponId } from "../../../runtime/types";
import type { CombatPort, FireResult } from "../../../runtime/ports/CombatPort";

/** `createMockCombat` 返回的扩展 Port,带 spy / 驱动函数。 */
export interface MockCombatHandle extends CombatPort {
  /** spy:被调过的 `tryFire` 次数。 */
  readonly fireCount: number;
  /** spy:最近一次 `tryFire` 调用的入参(测试断言"按了 fire 时传对了 origin")。 */
  readonly lastTryFireArgs: { now: number; ownerId: ActorId; origin: Vec2 } | null;
  /** 测试驱动:是否允许开火(默认 `true`);关掉后 `tryFire` 返回 `false` 且不计数。 */
  setCanFire(canFire: boolean): void;
  /** 清空 spy(测试间隔离)。 */
  reset(): void;
}

export function createMockCombat(): MockCombatHandle {
  let canFire = true;
  let count = 0;
  let lastArgs: { now: number; ownerId: ActorId; origin: Vec2 } | null = null;
  let currentWeapon: WeaponId = "pistol";
  let totalDamage = 0;
  let totalKills = 0;

  const port: MockCombatHandle = {
    tryFire(now: number, ownerId: ActorId, origin: Vec2): FireResult {
      if (!canFire) return false;
      count++;
      lastArgs = { now, ownerId, origin: { x: origin.x, y: origin.y } };
      return true;
    },
    swapWeapon(id: WeaponId): void {
      currentWeapon = id;
    },
    currentWeapon(): WeaponId {
      return currentWeapon;
    },
    damageDealt(): number {
      return totalDamage;
    },
    kills(): number {
      return totalKills;
    },
    listWeapons(): readonly WeaponId[] {
      return ["pistol"];
    },

    // ---- spy 视图 ----
    get fireCount() {
      return count;
    },
    get lastTryFireArgs() {
      return lastArgs;
    },

    // ---- 驱动方法 ----
    setCanFire(v: boolean): void {
      canFire = v;
    },
    reset(): void {
      canFire = true;
      count = 0;
      lastArgs = null;
      currentWeapon = "pistol";
      totalDamage = 0;
      totalKills = 0;
    },
  };

  return port;
}
