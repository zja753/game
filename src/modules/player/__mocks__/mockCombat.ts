/**
 * `createMockCombat` — Combat 模块的 Mock 工厂(占位,见 plan §5.1)。
 *
 * 状态:
 *  - Combat 模块**尚未落地**,但 `runtime/ports/CombatPort.ts` 已先定好
 *    接口形态。本工厂就是给 Player 单测提供 `CombatPort` stub 的,
 *    等 Combat 模块上线后,那边的 `__mocks__/mockCombat.ts` 会成为正式 mock。
 *  - 当前实现:`tryFire()` 默认返回 `true`(默认都能开火),测试可调
 *    `setCanFire(false)` 模拟"冷却中";`fireCount` 记 `tryFire` 调用次数。
 *  - **不**依赖 Excalibur(纯 TS)。
 */
import type { CombatPort } from "../../../runtime/ports/CombatPort";

/** `createMockCombat` 返回的扩展 Port,带 spy / 驱动函数。 */
export interface MockCombatHandle extends CombatPort {
  /** spy:被调过的 `tryFire` 次数。 */
  readonly fireCount: number;
  /** 测试驱动:是否允许开火(默认 `true`);关掉后 `tryFire` 返回 `false` 且不计数。 */
  setCanFire(canFire: boolean): void;
  /** 清空 spy(测试间隔离)。 */
  reset(): void;
}

export function createMockCombat(): MockCombatHandle {
  let canFire = true;
  let count = 0;

  const port: MockCombatHandle = {
    tryFire(): boolean {
      if (!canFire) return false;
      count++;
      return true;
    },

    // ---- spy 视图 ----
    get fireCount() {
      return count;
    },

    // ---- 驱动方法 ----
    setCanFire(v: boolean): void {
      canFire = v;
    },
    reset(): void {
      canFire = true;
      count = 0;
    },
  };

  return port;
}
