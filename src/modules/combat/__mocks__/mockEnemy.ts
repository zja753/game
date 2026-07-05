/**
 * `createMockEnemy` — Enemy 模块的 Mock 工厂(占位,见 plan §5.1)。
 *
 * 状态:
 *  - Enemy 模块**尚未落地**(M5 排在 M4 之后),但 `runtime/ports/EnemyPort.ts`
 *    已先定好接口形态。本工厂就是给 Combat 单测 + 集成测试提供
 *    `EnemyPort` stub 的;等 Enemy 模块上线后,那边的 `__mocks__/mockEnemy.ts`
 *    会成为正式 mock。
 *  - 实现:测试通过 `addEnemy` / `setEnemyHp` 维护一个"敌人列表";`list()`
 *    每次现算(返回浅拷贝);`applyDamage` 走"扣血 → 判 kill"两步;
 *    `spawn` 返回自增 id(走测试驱动,真实模块会调 `RuntimePort.spawnActor`)。
 *  - **不**依赖 Excalibur(纯 TS),测试不需要 setup 浏览器全局。
 *
 * 关键不变量:
 *  - `list()` 返回的是"窗口",每次调用都基于最新内部状态计算。
 *  - `applyDamage` 返回的 `DamageResult.hp` 是"扣完后的剩余 HP",
 *    调用方(`HitResolver`)拿来判定 `isKill`。
 *  - `damageDealtToEnemy(id)` 累加器:测试断言"这发打到了 X 敌人、扣了 N 点"。
 *  - `spawn` / `clear` 是 M5 Enemy 模块上线后新增的接口;mock 在 M4 阶段先
 *    提供"足够 Combat 不被类型卡住"的占位实现。
 */
import type { ActorId, EnemyKind, Vec2 } from "../../../runtime/types";
import type { DamageResult, EnemyPort, EnemySnapshot } from "../../../runtime/ports/EnemyPort";

/** Mock 工厂的可调参数。 */
export interface MockEnemyOptions {
  /** 默认敌人 HP(供 `addEnemy` 不传 hp 时填);默认 100。 */
  defaultHp?: number;
  /** `spawn()` 自增 id 的起点(避免和测试里 `addEnemy` 用的固定 id 撞);默认 1。 */
  spawnIdBase?: number;
}

/** `createMockEnemy` 返回的扩展 Port,带 spy / 驱动函数。 */
export interface MockEnemyHandle extends EnemyPort {
  /** spy:已注册的敌人列表(只读)。 */
  readonly enemies: ReadonlyArray<EnemySnapshot>;
  /** spy:被调过的 `applyDamage` 次数。 */
  readonly damageCallCount: number;
  /** spy:被调过的 `spawn` 次数 + 参数(`kind, pos` 列表)。 */
  readonly spawnedCalls: ReadonlyArray<{ kind: EnemyKind; pos: Vec2; id: ActorId }>;
  /** spy:被调过的 `clear` 次数。 */
  readonly clearCallCount: number;
  /** spy:某 id 累计受到的伤害(测试断言"打到了 X 敌人")。 */
  damageDealtToEnemy(id: ActorId): number;

  /** 测试驱动:加一个敌人。 */
  addEnemy(snap: { id: ActorId; kind: EnemyKind; pos: Vec2; hp?: number; maxHp?: number }): void;
  /** 测试驱动:直接覆盖某 id 的 HP(模拟"被打了但还没死")。 */
  setEnemyHp(id: ActorId, hp: number): void;
  /** 测试驱动:移除某 id 的敌人。 */
  removeEnemy(id: ActorId): void;
  /** 清空所有敌人 + spy 状态(测试间隔离)。 */
  reset(): void;
}

/**
 * 创建一个 Mock 敌人 Port。
 */
export function createMockEnemy(opts: MockEnemyOptions = {}): MockEnemyHandle {
  const defaultHp = opts.defaultHp ?? 100;
  const spawnIdBase = opts.spawnIdBase ?? 1;
  const enemies = new Map<ActorId, EnemySnapshot>();
  const damageLog = new Map<ActorId, number>();
  const spawnLog: Array<{ kind: EnemyKind; pos: Vec2; id: ActorId }> = [];
  let damageCallCount = 0;
  let clearCallCount = 0;
  let nextSpawnId = spawnIdBase;

  const port: MockEnemyHandle = {
    list(): readonly EnemySnapshot[] {
      // 每次现算:返回快照数组(浅拷贝,调用方只读不写)。
      return Array.from(enemies.values()).map((e) => ({ ...e }));
    },

    applyDamage(id: ActorId, amount: number, _from?: unknown): DamageResult {
      void _from;
      damageCallCount += 1;
      const e = enemies.get(id);
      if (!e) {
        // 找不到 id 走 no-op(plan §EnemyPort.applyDamage 注释:"找不到 id 走 no-op")。
        return { isKill: false, hp: 0 };
      }
      if (amount <= 0 || e.hp <= 0) {
        // 已死 / 非正伤害:不扣。
        return { isKill: false, hp: e.hp };
      }
      const newHp = Math.max(0, e.hp - amount);
      const isKill = newHp <= 0;
      enemies.set(id, { ...e, hp: newHp });
      damageLog.set(id, (damageLog.get(id) ?? 0) + amount);
      return { isKill, hp: newHp };
    },

    // ---- M5 EnemyPort 完整表面(本 mock 是过渡) ----
    // spawn:返回自增 id 并把"刚生成的敌人"挂到 enemies 表,默认 100 HP。
    // 不广播 `enemy:spawned` 事件(测试用 addEnemy 直接构造更可控)。
    spawn(kind: EnemyKind, pos: Vec2): ActorId {
      const id = nextSpawnId++;
      spawnLog.push({ kind, pos: { x: pos.x, y: pos.y }, id });
      enemies.set(id, {
        id,
        kind,
        pos: { x: pos.x, y: pos.y },
        hp: defaultHp,
        maxHp: defaultHp,
      });
      return id;
    },
    count(): number {
      return enemies.size;
    },
    clear(): void {
      clearCallCount += 1;
      enemies.clear();
      damageLog.clear();
    },

    // ---- spy 视图 ----
    get enemies() {
      return Array.from(enemies.values()).map((e) => ({ ...e }));
    },
    get damageCallCount() {
      return damageCallCount;
    },
    get spawnedCalls() {
      return spawnLog.slice();
    },
    get clearCallCount() {
      return clearCallCount;
    },
    damageDealtToEnemy(id) {
      return damageLog.get(id) ?? 0;
    },

    // ---- 驱动方法 ----
    addEnemy(snap) {
      enemies.set(snap.id, {
        id: snap.id,
        kind: snap.kind,
        pos: { x: snap.pos.x, y: snap.pos.y },
        hp: snap.hp ?? defaultHp,
        maxHp: snap.maxHp ?? snap.hp ?? defaultHp,
      });
    },
    setEnemyHp(id, hp) {
      const e = enemies.get(id);
      if (e) enemies.set(id, { ...e, hp });
    },
    removeEnemy(id) {
      enemies.delete(id);
    },
    reset() {
      enemies.clear();
      damageLog.clear();
      spawnLog.length = 0;
      damageCallCount = 0;
      clearCallCount = 0;
      nextSpawnId = spawnIdBase;
    },
  };

  return port;
}
