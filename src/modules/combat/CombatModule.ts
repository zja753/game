/**
 * `CombatModule` — Combat 模块对外的"装配层"(plan/modules/combat.md §3-§7)。
 *
 * 把内部子模块(WeaponRegistry / ProjectileFactory / HitResolver / TargetSelector)
 * 组合起来,实现 `CombatPort` 接口的全部方法,然后把这个 Port 实例
 * 暴露给根容器 / 其他模块使用。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 这个文件**只**能被根容器 `import`。
 *  - 其他模块**不**能 import 它,只能 import 根容器传给它们的 `CombatPort`。
 *
 * 权威字段(plan/modules/combat.md §4):
 *  - `currentWeapon` / 累计 `damageDealt` / 累计 `kills` / 武器发射冷却。
 *  - **不**持"当前场上敌人"列表(plan §3 / §7:Combat 不维护,
 *    每次 `tryFire` 现场调 `EnemyPort.list()` 拉快照)。
 *
 * 模块间事件契约(plan §3 + EventBus 当前字典):
 *  - 订阅 `player:moved`(plan §3 用于"近距优先"目标选择 — 第一版
 *    走 `tryFire(now, ownerId, origin)` 拿 origin,这一事件订阅可放
 *    后续增强再做)。
 *  - 发出 `projectile:hit` / `enemy:killed`(由 HitResolver 通过 bus 发出)。
 *  - 内部监听自己的 `projectile:hit` 来累加 `damageDealt`;监听
 *    `enemy:killed` 来累加 `kills`。
 */
import type { ActorId, Vec2, WeaponId } from "../../runtime/types";
import type { GameEventBus } from "../../runtime/EventBus";
import type { RuntimePort } from "../runtime";
import type { CombatPort, FireResult } from "../../runtime/ports/CombatPort";
import type { EnemyPort } from "../../runtime/ports/EnemyPort";

import {
  defaultWeaponId,
  getWeaponSpec,
  hasWeapon,
  listWeaponIds,
} from "./internal/WeaponRegistry";
import type { WeaponSpec } from "./internal/WeaponRegistry";
import { selectNearestInRange } from "./internal/TargetSelector";
import type { HitResolverDeps } from "./internal/HitResolver";
import { createProjectileFactory } from "./internal/ProjectileFactory";

/** 投射物碰撞层名(供 `runtime.collision.addLayer` 调用时引用)。 */
export const PROJECTILE_COLLISION_LAYER = "projectile";

/** `createCombatModule` 工厂签名。 */
export interface CombatModuleDeps {
  /** 事件总线(发 + 订阅 Combat 相关事件)。 */
  bus: GameEventBus;
  /** Runtime Port(spawn 投射物)。 */
  runtime: RuntimePort;
  /** 敌人查询 + 写伤害(Enemy 模块 M5 落地后注入;M4 期间由 mock 提供)。 */
  enemies: EnemyPort;
  /**
   * 可选:初始武器(默认 `pistol`)。RootContainer 装配阶段不传,测试可用。
   */
  initialWeapon?: WeaponId;
  /**
   * 可选:投射物碰撞层名(默认 `PROJECTILE_COLLISION_LAYER`)。
   */
  projectileLayer?: string;
  /**
   * 可选:"这是个敌人 id 吗" 判定器。HitResolver 在 `onHit` 时拿 `otherId` 调一次,
   * 返回 `false` 时不扣血、不发事件(撞墙 / 撞队友等场景)。
   *
   * 不传走默认:任何 id 都算"可扣血"。**真实装配时,Enemy 模块的 collision layer
   * 已经过滤了非敌人,这里只是双重保险**(plan §7)。
   */
  isEnemy?: (id: ActorId) => boolean;
}

export type CombatPortFactory = (deps: CombatModuleDeps) => CombatPort;

/**
 * 创建 Combat 模块实例。
 *
 * 生命周期(由根容器保证):
 *  1. 根容器 `createCombatModule({ bus, runtime, enemies })` → 拿 `CombatPort`。
 *  2. 根容器 `runtime.collision.addLayer("projectile", "wall")` /
 *     `runtime.collision.addLayer("projectile", "enemy")` 在 spawn 之前完成。
 *  3. 业务模块(典型:Player 转发 `input:fire` → `combat.tryFire(...)`)拿这个 Port。
 *  4. 销毁:根容器生命 = 进程生命,本模块**不**主动 dispose;若测试 / HMR 路径
 *     需要,可以调返回对象上的 `__dispose` 反订阅 bus.on。
 */
export const createCombatModule: CombatPortFactory = (deps) => {
  const layer = deps.projectileLayer ?? PROJECTILE_COLLISION_LAYER;
  const initial: WeaponId = deps.initialWeapon ?? defaultWeaponId();

  // ---- 0. 内部状态 ----
  /** 当前武器(plan §4 权威字段)。 */
  let currentWeapon: WeaponId = initial;
  /** 累计伤害(plan §4 权威字段;HUD 读)。 */
  let totalDamage = 0;
  /** 累计击杀(plan §4 权威字段;HUD 读)。 */
  let totalKills = 0;
  /** 武器冷却(毫秒,自上次开火起的"距下次可开火"的剩余时间)。 */
  let cooldownRemaining = 0;

  // ---- 1. 内部 HitResolver 配置 + ProjectileFactory ----
  /**
   * `HitResolver` 的依赖对象;它在每次 `onHit` 触发时拿这个对象 + 命中文本
   * 调 `resolveHit`。`bus` 字段是 Combat 模块共用的同一个 bus。
   *
   * 注:`resolveHit` 内部会 emit `projectile:hit` / `enemy:killed`;
   * Combat 模块在下面订阅这两个事件来累加 `damageDealt` / `kills`。
   */
  const hitResolver: HitResolverDeps = {
    enemies: deps.enemies,
    bus: deps.bus,
    isEnemy: deps.isEnemy,
  };

  const projectileFactory = createProjectileFactory({
    runtime: deps.runtime,
    hitResolver,
    projectileLayer: layer,
  });

  // ---- 2. 事件订阅:累加 damageDealt / kills ----
  const offProjectileHit = deps.bus.on("projectile:hit", (e) => {
    totalDamage += e.damage;
  });
  const offEnemyKilled = deps.bus.on("enemy:killed", () => {
    totalKills += 1;
  });

  // ---- 3. 帧驱动:冷却递减 ----
  /**
   * `RuntimePort.onTick` 每帧调一次,本模块用它把武器冷却递减。
   * 没在跑游戏(GameScene != running)时也走 onTick 路径,
   * 由 Progression 通过 `engine.clock.stop()` 冻结整个 Excalibur 时钟
   * 自动停;Combat 自身不维护 enabled flag(plan §5 Combat 不做场景状态机)。
   */
  const offTick = deps.runtime.onTick((dt) => {
    if (cooldownRemaining > 0) {
      cooldownRemaining = Math.max(0, cooldownRemaining - dt);
    }
  });

  // ---- 4. 选目标 + 算开火方向 ----
  /**
   * 选目标 + 算方向。
   * - 选最近(target 在 `range` 内) = 玩家目前面对的方向无关(plan §5)。
   * - 方向 = `target.pos - origin` 归一化;target 不存在时走 `null`。
   */
  function selectTarget(
    origin: Vec2,
    spec: WeaponSpec,
  ): { targetId: ActorId; dir: Vec2; kind: string } | null {
    const enemies = deps.enemies.list();
    const sel = selectNearestInRange(origin, spec.range, enemies);
    if (sel.target === null) return null;
    const dx = sel.target.pos.x - origin.x;
    const dy = sel.target.pos.y - origin.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) {
      // origin 和 target 重合(异常);不走开火。
      return null;
    }
    return {
      targetId: sel.target.id,
      dir: { x: dx / len, y: dy / len },
      kind: sel.target.kind,
    };
  }

  // ---- 5. tryFire 核心 ----
  /**
   * 玩家按 fire 调一次。
   *
   * 关键不变量(plan §5 / §7 Demo 验收点 3):
   *  - 冷却没好 → 立刻 `return false`,**不**消耗 ammo,**不**造投射物。
   *  - 射程内没目标 → 同样 `return false`,**不**消耗冷却(plan §5 关键设计点)。
   *
   * `FireResult` 暂固定为 `true`(成功开火) / `false`(未开火);后续 Combat
   * 增强时这里可以返回更详细的对象,Port 接口已经声明成 `unknown` 兼容扩展。
   */
  function tryFireImpl(now: number, _ownerId: ActorId, origin: Vec2): FireResult {
    void now; // 暂未使用(冷却走 onTick dt);保留参数为后续"远程重武器"扩展
    if (cooldownRemaining > 0) return false;
    const spec = getWeaponSpec(currentWeapon);
    const sel = selectTarget(origin, spec);
    if (sel === null) {
      // 关键:射程外不开火 — 冷却**不**消耗,玩家可保持"扣住扳机"等敌进射程。
      return false;
    }
    // 进入冷却。
    cooldownRemaining = spec.baseCooldownMs;
    // 派 projectileCount 颗投射物(霰弹;Pistol = 1)。
    for (let i = 0; i < spec.projectileCount; i++) {
      let dir = sel.dir;
      if (spec.spread > 0 && spec.projectileCount > 1) {
        // 简单扇形散布:第 i 发偏转 ±spread/2 范围。
        const t = spec.projectileCount === 1 ? 0 : i / (spec.projectileCount - 1) - 0.5;
        const angle = t * spec.spread;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        dir = {
          x: sel.dir.x * cos - sel.dir.y * sin,
          y: sel.dir.x * sin + sel.dir.y * cos,
        };
      }
      projectileFactory.spawn({
        origin,
        dir,
        speed: spec.projectileSpeed,
        lifetimeMs: spec.projectileLifetimeMs,
        damage: spec.damage,
        ownerId: _ownerId,
        targetKindHint: sel.kind,
      });
    }
    return true;
  }

  // ---- 6. swapWeapon ----
  function swapWeapon(id: WeaponId): void {
    if (!hasWeapon(id)) {
      // 未注册的武器 ID:plan §2 写"走 no-op + console.warn",避免把异常
      // 抛进 tryFire 路径。第一版打 warn,生产环境用 logger 替换。
      console.warn(`[Combat] swapWeapon: unknown weapon id "${id}"`);
      return;
    }
    currentWeapon = id;
    // 切武器时重置冷却(避免 Pistol(250ms)→ 切回 Pistol 时还有 200ms 残冷却)。
    cooldownRemaining = 0;
  }

  // ---- 7. 公开 Port ----
  const port: CombatPort = {
    tryFire: tryFireImpl,
    swapWeapon,
    currentWeapon: () => currentWeapon,
    damageDealt: () => totalDamage,
    kills: () => totalKills,
    listWeapons: () => listWeaponIds(),
  };

  // ---- 8. 内部 dispose(测试 / HMR 路径)----
  // 业务模块**不**该用 — 用完就破坏 Combat 模块的封装。
  const portWithDispose = port as CombatPort & {
    __dispose: () => void;
    __projectileLayer: string;
  };
  portWithDispose.__dispose = (): void => {
    offTick();
    offProjectileHit();
    offEnemyKilled();
  };
  portWithDispose.__projectileLayer = layer;

  return port;
};
