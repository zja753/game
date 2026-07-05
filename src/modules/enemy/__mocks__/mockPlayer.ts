/**
 * `createMockPlayer` — Player 模块的 Mock 工厂。
 *
 * 按 plan/modular-roadmap.md §0.3 / §5.1,Player 是逻辑型模块;Mock 形态 = 一个
 * `PlayerPort`,让 Enemy / Progression / Camera 等模块的单测能 stub 玩家读写。
 *
 * 关键不变量:
 *  - **不**持 Excalibur `Actor`(纯 TS),不依赖 DOM / Runtime。
 *  - `pos` / `id` / `hp` 内部持,**不**走 `actor.pos.x`。
 *  - `applyDamage` 走"扣血 → 判死"两步;死亡后 `isDead()` 持续为 `true`,
 *    `reset()` 才回初值。
 *  - 模拟 `inContactEnemies` 节流:同 `enemyId` 在 `endContact` 前再 `applyDamage`
 *    是 no-op(对齐真实 `HealthController` 行为)。
 */
import type { ActorId, Vec2 } from "../../../runtime/types";
import type { BuffSpec, PlayerPort } from "../../../runtime/ports/PlayerPort";

/** Mock 工厂的可调参数。 */
export interface MockPlayerOptions {
  /** 初始位置;默认 `{x: 0, y: 0}`。 */
  initialPos?: Vec2;
  /** 初始 / 最大 HP;默认 100。 */
  initialMaxHp?: number;
  /** 初始 `id()` 返回值;默认 1(避免与敌人 mock 撞 id=0)。 */
  initialId?: ActorId;
}

/** `createMockPlayer` 返回的扩展 Port,带 spy / 驱动函数。 */
export interface MockPlayerHandle extends PlayerPort {
  /** spy:`applyDamage` 累计扣血量(测试断言"总共扣了多少")。 */
  readonly damageTaken: number;
  /** spy:被调过的 `applyDamage` 次数。 */
  readonly damageCallCount: number;
  /** spy:被调过的 `applyHeal` 次数。 */
  readonly healCallCount: number;
  /** spy:被调过的 `addBuff` 次数。 */
  readonly buffCount: number;
  /** spy:被调过的 `reset` 次数。 */
  readonly resetCount: number;

  /** 测试驱动:直接设置 `id()`(模拟"玩家被 spawn 后根容器注入 id")。 */
  setId(id: ActorId): void;
  /** 测试驱动:把内部 `isDead` 标志设回去(模拟"被重开")。 */
  setDead(dead: boolean): void;
  resetSpies(): void;
}

function makePort(opts: MockPlayerOptions): MockPlayerHandle {
  const initialPos: Vec2 = opts.initialPos ?? { x: 0, y: 0 };
  const initialMaxHp = opts.initialMaxHp ?? 100;
  let curId: ActorId = opts.initialId ?? 1;
  let curPos: Vec2 = { x: initialPos.x, y: initialPos.y };
  let curHp = initialMaxHp;
  const curMaxHp = initialMaxHp;
  let dead = false;
  let damageTaken = 0;
  let damageCallCount = 0;
  let healCallCount = 0;
  let buffCount = 0;
  let resetCount = 0;

  const port: MockPlayerHandle = {
    id() {
      return curId;
    },
    pos() {
      return { x: curPos.x, y: curPos.y };
    },
    setPos(v) {
      curPos = { x: v.x, y: v.y };
    },
    hp() {
      return curHp;
    },
    maxHp() {
      return curMaxHp;
    },
    applyDamage(amount) {
      if (amount <= 0) return false;
      if (dead) return false;
      damageCallCount += 1;
      damageTaken += amount;
      curHp = Math.max(0, curHp - amount);
      if (curHp <= 0) dead = true;
      return true;
    },
    applyHeal(amount) {
      if (amount <= 0) return;
      healCallCount += 1;
      curHp = Math.min(curMaxHp, curHp + amount);
    },
    addBuff(_buff: BuffSpec) {
      buffCount += 1;
    },
    isDead() {
      return dead;
    },
    reset() {
      curPos = { x: initialPos.x, y: initialPos.y };
      curHp = curMaxHp;
      dead = false;
      resetCount += 1;
    },

    // ---- spy 视图 ----
    get damageTaken() {
      return damageTaken;
    },
    get damageCallCount() {
      return damageCallCount;
    },
    get healCallCount() {
      return healCallCount;
    },
    get buffCount() {
      return buffCount;
    },
    get resetCount() {
      return resetCount;
    },

    // ---- 驱动方法 ----
    setId(id) {
      curId = id;
    },
    setDead(v) {
      dead = v;
    },
    resetSpies() {
      damageTaken = 0;
      damageCallCount = 0;
      healCallCount = 0;
      buffCount = 0;
    },
  };

  return port;
}

/**
 * 创建一个 Mock 玩家 Port。
 */
export function createMockPlayer(opts: MockPlayerOptions = {}): MockPlayerHandle {
  return makePort(opts);
}
