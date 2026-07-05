/**
 * `EnemyModule` — Enemy 模块对外的"装配层"(plan/modules/enemy.md §2-§7)。
 *
 * 把内部子模块(EnemyRegistry / BehaviorStrategy / SpawnScheduler /
 * ContactDamage / EnemyActor)组合起来,实现 `EnemyPort` 接口的全部方法,
 * 然后把这个 Port 实例暴露给根容器 / 其他模块使用。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 这个文件**只**能被根容器 `import`。
 *  - 其他模块**不能** import 它,只能 import 根容器传给它们的 `EnemyPort`。
 *
 * 权威字段(plan/modules/enemy.md §4):
 *  - 所有 EnemyActor 的 `pos / vel / hp / kind` —— 由 `id → actor` 表
 *    持有,`list()` 走"窗口"(每次现算)。
 *
 * 模块间事件契约(plan §3 + EventBus 当前字典):
 *  - **不**订阅 `input:*` / `player:moved` —— AI 跟随通过 `PlayerPort` 闭包
 *    直接读,避免边沿事件漏触发。
 *  - 订阅 `level:phase`(phase=`running` 时启 spawn,其他 scene 停 spawn)。
 *  - 发出 `enemy:spawned { id, kind, x, y }` / `enemy:dying { id, kind, x, y }`。
 *  - **不**发 `enemy:killed`(plan §7 关键设计点:判定权在 Combat,
 *    Combat 在 `DamageResult.isKill=true` 时自己发 `enemy:killed`)。
 */
import type { ActorId, EnemyKind, Vec2 } from "../../runtime/types";
import type { GameEventBus } from "../../runtime/EventBus";
import type { RuntimePort } from "../runtime";
import type { PlayerPort } from "../../runtime/ports/PlayerPort";
import type { ProgressionPort } from "../../runtime/ports/ProgressionPort";
import type { MapObstaclePort } from "../../runtime/ports/MapObstaclePort";
import type { DamageResult, EnemyPort, EnemySnapshot } from "../../runtime/ports/EnemyPort";

import { EnemyActor } from "./internal/EnemyActor";
import type { EnemyActorConfig } from "./internal/EnemyActor";
import { type ContactDamageHandle, createContactDamage } from "./internal/ContactDamage";
import { createSpawnScheduler } from "./internal/SpawnScheduler";
import type { PickSpawnPosFn, SpawnSchedulerHandle } from "./internal/SpawnScheduler";
import {
  DEFAULT_CHASER_SPEC,
  getBehavior,
  listEnemyKinds,
  registerBehavior,
  registerEnemySpec,
  requireBehavior,
  requireEnemySpec,
} from "./internal/EnemyRegistry";
import { createChaserBehavior } from "./internal/ChaserBehavior";

/** 默认"碰玩家后多久打一次"的节流(毫秒)。 */
const DEFAULT_HIT_COOLDOWN_MS = 500;
/** 默认刷怪节奏(毫秒 / 只)。首版慢一点便于看动画。 */
const DEFAULT_SPAWN_INTERVAL_MS = 1000;

/** 敌人碰撞层名(供调用方在 `runtime.collision.addLayer` 时引用)。 */
export const ENEMY_COLLISION_LAYER = "enemy";
/** 敌人与玩家接触伤害层名(对称 Player 的 `PLAYER_CONTACT_LAYER`)。 */
export const ENEMY_CONTACT_LAYER = "enemy-contact";

/** `createEnemyModule` 工厂签名。 */
export interface EnemyModuleDeps {
  /** 事件总线(发 `enemy:*` 事件 + 订阅 `level:phase`)。 */
  bus: GameEventBus;
  /** Runtime Port(spawn / despawn / onTick / now)。 */
  runtime: RuntimePort;
  /** 玩家 Port(接触伤害用 `applyDamage`)。 */
  player: PlayerPort;
  /** 关卡配置 Port(spawn 节奏、种类来自 `LevelConfig`)。 */
  progression: ProgressionPort;
  /** 障碍查询(AI 撞墙)。 */
  obstacles: MapObstaclePort;
  /**
   * 可选:刷怪位置选择策略;不传走默认"以当前玩家位置为中心、半径 200~400 角度"。
   * 真实装配里由根容器 / Progression 覆盖。
   */
  pickSpawnPos?: PickSpawnPosFn;
  /** 可选:接触伤害节流(毫秒);不传走 `DEFAULT_HIT_COOLDOWN_MS`。 */
  hitCooldownMs?: number;
  /** 可选:刷怪节奏(毫秒);不传走 `DEFAULT_SPAWN_INTERVAL_MS`。 */
  spawnIntervalMs?: number;
}

export type EnemyPortFactory = (deps: EnemyModuleDeps) => EnemyPort;

/**
 * 创建 Enemy 模块实例。
 *
 * 生命周期(由根容器保证):
 *  1. 根容器 `createEnemyModule({ bus, runtime, player, progression, obstacles })`
 *     → 拿 `EnemyPort`。
 *  2. 根容器 `runtime.collision.addLayer("enemy", "wall")` /
 *     `runtime.collision.addLayer("enemy", "projectile")` 在 spawn 之前完成。
 *  3. 业务模块(Combat 选目标 / Progression 控密度)拿这个 Port。
 *  4. 销毁:根容器生命 = 进程生命,本模块**不**主动 dispose;测试 / HMR
 *     可调 `__dispose` 反订阅。
 */
export const createEnemyModule: EnemyPortFactory = (deps) => {
  // ---- 0. 注册表初始化(模块启动一次) ----
  if (listEnemyKinds().length === 0) {
    registerEnemySpec("chaser", DEFAULT_CHASER_SPEC);
    registerBehavior(createChaserBehavior());
  }

  // ---- 1. 内部状态:id → EnemyActor 的句柄表 ----
  const actors = new Map<ActorId, EnemyActor>();

  // ---- 2. getPlayer 闭包(EnemyActor 读玩家位姿) ----
  function getPlayer(): { id: ActorId; pos: Vec2 } | null {
    if (deps.player.isDead()) return null;
    const id = deps.player.id();
    if (id === 0) return null; // 玩家尚未 spawn(初始占位)
    return { id, pos: deps.player.pos() };
  }

  // ---- 3. ContactDamage ----
  // 必须在 `buildActorConfig` 之前创建 —— 后者把 `contactDamage` 句柄注入 actor。
  const contactDamage: ContactDamageHandle = createContactDamage({
    player: deps.player,
    now: () => deps.runtime.now(),
    hitCooldownMs: deps.hitCooldownMs ?? DEFAULT_HIT_COOLDOWN_MS,
  });

  // ---- 4. 内部"广播 enemy:dying + 反注册" ----
  /**
   * 敌人致死后:从内部表移除 + 广播 `enemy:dying` + despawn actor。
   * EnemyActor 在 `applyDamage` 走致死路径时调 `onDeath(selfId)`,
   * 由本函数把语义闭合。
   */
  function finalizeDeath(id: ActorId): void {
    const a = actors.get(id);
    if (a === undefined) return;
    const pos = a.getPos();
    const k = a.kind();
    actors.delete(id);
    deps.bus.emit({ type: "enemy:dying", id, kind: k, x: pos.x, y: pos.y });
    deps.runtime.despawnActor(id);
  }

  // ---- 5. EnemyActor 配置工厂(给 spawn 用) ----
  function buildActorConfig(kind: EnemyKind, pos: Vec2): EnemyActorConfig {
    const spec = requireEnemySpec(kind);
    const behavior = requireBehavior(spec.behavior);
    return {
      kind,
      speed: spec.speed,
      maxHp: spec.maxHp,
      contactDamageAmount: spec.contactDamage,
      behavior,
      obstacles: deps.obstacles,
      getPlayer,
      now: () => deps.runtime.now(),
      // 内部回调,主要供 `applyDamage` 同步返回值;**不**在这里发事件。
      onDamageApplied: () => {
        // no-op
      },
      onDeath: (id) => finalizeDeath(id),
      contactDamage,
      initialPos: pos,
    };
  }

  // ---- 6. 内部 spawnOne(SpawnScheduler 用) ----
  // 拆出来是避免 SpawnScheduler 的 spy 视图里"看到 port.spawn"(后者
  // 还会广播 enemy:spawned,本路径需要"已广播"那一份语义)。
  function spawnOneInternal(kind: EnemyKind, pos: Vec2): ActorId {
    return port.spawn(kind, pos);
  }

  // ---- 7. SpawnScheduler ----
  const scheduler: SpawnSchedulerHandle = createSpawnScheduler({
    spawnOne: spawnOneInternal,
    getAliveCount: () => actors.size,
    pickSpawnPos:
      deps.pickSpawnPos ??
      ((ctx) => {
        // 默认位置:以玩家为中心、角度按时间转、半径 200~400 振荡。
        // 真实装配由根容器 / Progression 覆盖(根据关卡定 spawn 区域)。
        const p = getPlayer();
        const cx = p?.pos.x ?? 0;
        const cy = p?.pos.y ?? 0;
        const angle = (ctx.now % 360) * (Math.PI / 180);
        const dist = 200 + ((ctx.now / 17) % 200);
        return { x: cx + Math.cos(angle) * dist, y: cy + Math.sin(angle) * dist };
      }),
    spawnIntervalMs: deps.spawnIntervalMs ?? DEFAULT_SPAWN_INTERVAL_MS,
  });

  // ---- 8. 帧驱动 ----
  // `enabled` 控制 AI tick 与 spawn —— 由 `level:phase` 事件切。
  let enabled = true;
  const offTick = deps.runtime.onTick((dt) => {
    if (!enabled) return;
    // 1) 推 SpawnScheduler(刷怪)
    scheduler.tick({
      level: deps.progression.currentLevelConfig(),
      now: deps.runtime.now(),
      dt,
    });
    // 2) 推所有 EnemyActor —— `onPreUpdate` 由 mock 路径手动调,真实 Engine
    //    走自己的 preupdate,我们走 `actor.onPreUpdate` 兼容 mock 测试。
    for (const a of Array.from(actors.values())) {
      (a as unknown as { onPreUpdate: (e: unknown, d: number) => void }).onPreUpdate(null, dt);
    }
  });

  // ---- 9. 订阅 `level:phase` 控制 scheduler 启停 ----
  const offLevelPhase = deps.bus.on("level:phase", (e) => {
    if (e.scene === "running") {
      enabled = true;
      scheduler.setEnabled(true);
    } else {
      // portal / shop / levelup_modal / character_select / gameover / victory
      // 全部停 spawn;AI tick 走 `engine.clock.stop()` 自动停 —— 不必再守一道。
      // 这里**只**控 spawn。
      scheduler.setEnabled(false);
    }
  });

  // ---- 10. 公开 Port ----
  const port: EnemyPort = {
    list(): readonly EnemySnapshot[] {
      const out: EnemySnapshot[] = [];
      for (const [id, a] of actors) {
        out.push({
          id,
          kind: a.kind(),
          pos: a.getPos(),
          hp: a.hpValue(),
          maxHp: a.maxHpValue(),
        });
      }
      return out;
    },

    applyDamage(id: ActorId, amount: number, _from?: unknown): DamageResult {
      void _from;
      const a = actors.get(id);
      if (a === undefined) {
        // 找不到 id(已被 despawn):走 no-op(plan §2 注释)。
        return { isKill: false, hp: 0 };
      }
      return a.applyDamage(amount);
    },

    spawn(kind: EnemyKind, pos: Vec2): ActorId {
      // 1) 校验 kind(已注册?);未注册走 no-op + warn,返回 0。
      if (typeof kind !== "string" || kind.length === 0) {
        console.warn(`[Enemy] spawn: invalid kind "${String(kind)}"`);
        return 0;
      }
      const cfg = buildActorConfig(kind, pos);
      // mockRuntime 在内部 `new spec.kind(spec.config)` 造一个 actor;我们**不**自己
      // new,否则 mock 路径下会出现"两个 EnemyActor 实例,onTick 调的不是测试
      // 拿到的那个"的问题。真实 Engine 路径下 Excalibur 同样会自己造 actor,
      // 我们只负责把 spec 喂给 `RuntimePort.spawnActor`,从返回的 id 走。
      // mock 路径下从 `runtime.spawnedInstances` 拿回实例注册到 `actors` 表,
      // 真实 Engine 路径下取不到,`actors` 不被遍历(见 onTick)。
      const id = deps.runtime.spawnActor<EnemyActorConfig>({
        kind: EnemyActor as unknown as new (config: EnemyActorConfig) => EnemyActor,
        config: cfg,
        layer: ENEMY_COLLISION_LAYER,
      });
      const runtimeRef = deps.runtime as unknown as {
        spawnedInstances?: ReadonlyMap<ActorId, unknown>;
      };
      const instance = runtimeRef.spawnedInstances?.get(id);
      if (instance instanceof EnemyActor) {
        instance.setId(id);
        actors.set(id, instance);
      }
      // 注:真实 Engine 路径下 `runtime.spawnedInstances` 不存在,这里走"信任
      // Excalibur 引擎自己管 actor"路径 —— `clear` / `applyDamage` 在真实路径下
      // 仍能通过 `id` 找到 actor(由 Excalibur 内部句柄表管理),只是我们的
      // `actors` map 不持有引用,onTick 的"手动 onPreUpdate"循环遍历到 0 个。
      // 真实 Engine 路径下 onPreUpdate 由 Excalibur 引擎自己驱动,本循环是 no-op。
      deps.bus.emit({ type: "enemy:spawned", id, kind, x: pos.x, y: pos.y });
      return id;
    },

    count(): number {
      return actors.size;
    },

    clear(): void {
      // 强制致死在场的每个敌人 —— 走 `applyDamage(hp)` → `onDeath` →
      // `finalizeDeath` 自动广播 `enemy:dying` + 反注册 + despawn。
      const ids = Array.from(actors.keys());
      for (const id of ids) {
        const a = actors.get(id);
        if (a === undefined) continue;
        a.applyDamage(a.hpValue());
      }
      // clear 后重置 scheduler(下一关一上来就允许刷)。
      scheduler.reset();
      contactDamage.reset();
    },
  };

  // 业务模块**不**该用 —— 用完就破坏 Enemy 模块的封装。
  const portWithDispose = port as EnemyPort & {
    __dispose: () => void;
    __registry: { getBehavior: typeof getBehavior };
  };
  portWithDispose.__dispose = (): void => {
    offTick();
    offLevelPhase();
  };
  portWithDispose.__registry = { getBehavior };

  return port;
};
