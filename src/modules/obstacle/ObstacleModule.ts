/**
 * `ObstacleModule` — MapObstacle 模块对外的"装配层"(plan/modules/obstacle.md §2-§7)。
 *
 * 把三个内部子模块(`MapCatalog` / `CollisionGrid` / `RayCaster`)组合起来,
 * 实现 `MapObstaclePort` 接口的全部方法,然后把这个 Port 实例暴露给根容器 /
 * 其他模块使用。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 这个文件**只**能被根容器 `import`。
 *  - 其他模块**不**能 import 它,只能 import 根容器传给它们的 `MapObstaclePort`。
 *  - 本模块**不持有**任何其他模块的 Port 引用(obstacle.md §6:无 Port 依赖)。
 *
 * 权威字段(obstacle.md §4):
 *  - 当前 `MapDefinition`(walls / playerSpawn / portalSpawn / bounds)——
 *    切关时由 `loadLevel(id)` 整体替换。
 *  - 当前 `CollisionGrid`(从 walls 烧出)——
 *    切关时随 walls 一起重建。
 *
 * 模块间事件契约(plan §3 + EventBus 当前字典):
 *  - 订阅:**无**(纯静态数据,无输入事件)。
 *  - 发出 `map:loaded { level }`(切关后广播一次,Camera 订阅它重算 clamp 范围)。
 *
 * 启动顺序:
 *  - 默认关卡 = `"level-1"`(obstacle.md §5 + runtime/types.ts 当前 `LevelId` 定义)。
 *    工厂在第一次构造时**不**主动 loadLevel(避免 RootContainer 装配阶段就
 *    触发"map:loaded"事件,干扰测试断言);由 RootContainer 在装配完毕后
 *    显式调 `port.loadLevel("level-1")` 完成首次加载。
 */
import type { LevelId, Vec2 } from "../../runtime/types";
import type { GameEventBus } from "../../runtime/EventBus";
import type { HitResult } from "../../runtime/types";
import type { MapData, MapObstaclePort } from "../../runtime/ports/MapObstaclePort";

import { createMapCatalog, type MapCatalog, type MapDefinition } from "./internal/MapCatalog";
import { createCollisionGrid, type CollisionGrid } from "./internal/CollisionGrid";
import { createRayCaster, type RayCaster } from "./internal/RayCaster";

/** 默认起始关卡(协议层 `LevelId` 联合里**唯一定义**的值,见 runtime/types.ts)。 */
const DEFAULT_LEVEL: LevelId = "level-1";

/** `createObstacleModule` 工厂签名。 */
export interface ObstacleModuleDeps {
  /** 事件总线(切关时广播 `map:loaded`)。 */
  bus: GameEventBus;
}

/**
 * `createObstacleModule` 工厂返回的扩展 Port(测试 / HMR 用)。
 *
 * 业务代码拿到的就是 `MapObstaclePort`,不带 `__dispose` / `__level`;装配完
 * 就当普通 Port 用;测试可访问内部逃逸口断言当前关卡 / 切关历史。
 */
export type ObstaclePortFactory = (deps: ObstacleModuleDeps) => MapObstaclePort & {
  /** 测试 / HMR 用:无事件订阅 / 无定时器,dispose 是 no-op。 */
  __dispose: () => void;
  /** 测试 / HMR 用:当前生效的关卡 ID。 */
  __level: () => LevelId;
};

/**
 * 创建 MapObstacle 模块实例。
 *
 * 生命周期(由根容器保证):
 *  1. 根容器 `createObstacleModule({ bus })` → 拿 `MapObstaclePort`。
 *  2. 根容器在装配阶段(连同 Player / Enemy / Camera 装配完后)调
 *     `port.loadLevel("level-1")` 完成首次加载(会广播 `map:loaded`)。
 *  3. 业务模块(Progression 调 `loadLevel`、Player / Enemy / Combat 调
 *     `isBlocked` / `raycast`、Camera 调 `bounds`、Progression 调
 *     `playerSpawn` / `portalSpawn`)拿这个 Port。
 *  4. 销毁:根容器生命 = 进程生命,本模块**不**主动 dispose;测试 / HMR
 *     可调 `__dispose`(当前为 no-op)。
 */
export const createObstacleModule: ObstaclePortFactory = (deps) => {
  // ---- 0. 内部子模块装配 ----
  const catalog: MapCatalog = createMapCatalog();
  // 内部可变状态:当前关卡的定义 + 烧好的网格 + DDA。
  let currentDef: MapDefinition | null = null;
  let currentGrid: CollisionGrid | null = null;
  let currentCaster: RayCaster | null = null;
  let currentLevel: LevelId | null = null;

  // ---- 内部辅助:确保当前关卡已加载(惰性) ----
  function ensureLoaded(): {
    def: MapDefinition;
    grid: CollisionGrid;
    caster: RayCaster;
  } {
    if (currentDef && currentGrid && currentCaster) {
      return { def: currentDef, grid: currentGrid, caster: currentCaster };
    }
    // 防御性兜底:外部忘了调 `loadLevel`,自动 load 默认关卡(不广播事件,
    // 避免"装配期就被打日志"的副作用)。
    const def = catalog.get(DEFAULT_LEVEL);
    const grid = createCollisionGrid(def.bounds, def.walls);
    const caster = createRayCaster(grid);
    currentDef = def;
    currentGrid = grid;
    currentCaster = caster;
    currentLevel = def.id;
    return { def, grid, caster };
  }

  // ---- 1. 公开 Port ----
  const port: MapObstaclePort = {
    isBlocked(p: Vec2): boolean {
      const { grid } = ensureLoaded();
      return grid.isBlocked(p);
    },
    bounds() {
      const { def } = ensureLoaded();
      return def.bounds;
    },
    raycast(from: Vec2, dir: Vec2, maxDist: number): HitResult | null {
      const { caster } = ensureLoaded();
      return caster.cast(from, dir, maxDist);
    },
    playerSpawn(): Vec2 {
      const { def } = ensureLoaded();
      return def.playerSpawn;
    },
    portalSpawn(): Vec2 {
      const { def } = ensureLoaded();
      return def.portalSpawn;
    },
    level(): MapData {
      const { def } = ensureLoaded();
      // 协议层只暴露 id + bounds(obstacle.md §2);walls / spawn 严格不外露。
      return { id: def.id, bounds: def.bounds };
    },
    loadLevel(id: LevelId): void {
      const def = catalog.get(id);
      const grid = createCollisionGrid(def.bounds, def.walls);
      const caster = createRayCaster(grid);
      currentDef = def;
      currentGrid = grid;
      currentCaster = caster;
      currentLevel = def.id;
      // 广播切关事件(obstacle.md §3):Camera 订阅它重算 clamp 范围。
      // 注意:这是"map:loaded"的**唯一** emit 点,与 Progression 切 scene 解耦
      // (Progression 切 scene 走 `level:phase`,与切地图是两件事)。
      deps.bus.emit({ type: "map:loaded", level: def.id });
    },
  };

  // ---- 2. dispose / 内部逃逸口(测试 / HMR 用)----
  const portWithExtras = port as MapObstaclePort & {
    __dispose: () => void;
    __level: () => LevelId;
  };
  portWithExtras.__dispose = (): void => {
    // 当前实现不订阅任何 bus.on,dispose 是 no-op。保留 escape hatch。
  };
  portWithExtras.__level = (): LevelId => {
    if (currentLevel === null) {
      // 装配阶段访问 __level 还没显式 load:返回默认值,避免 null 污染断言。
      return DEFAULT_LEVEL;
    }
    return currentLevel;
  };

  return portWithExtras;
};
