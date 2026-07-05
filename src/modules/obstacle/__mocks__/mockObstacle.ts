/**
 * `createMockObstacle` — MapObstacle 模块的正式 Mock 工厂。
 *
 * 与 `src/modules/player/__mocks__/mockMapObstacle.ts` 的关系(roadmap §0.3):
 *  - 早期 Player / Combat / Enemy / Camera / Progression 上线时,`MapObstacle`
 *    模块还没落地,Player 自己放了一份"早期接入的轻量 mock",只覆盖自己测试
 *    需要的最小子集。
 *  - MapObstacle 模块**落地**后,本工厂成为**正式** mock,统一 mock 来源。
 *  - Player 自带的 `createMockMapObstacle` **不**删除,作为"历史兼容 mock"
 *    保留(只覆盖 Player 测试需要的那部分,避免回归);后续若两套 mock 的
 *    行为出现分歧,优先以本工厂为准。
 *
 * 关键不变量:
 *  - `isBlocked(p)` 语义与 `runtime/ports/MapObstaclePort.ts` 完全一致:
 *    默认空地图(没有任何障碍),`addBlockedRect` / `addBlockedPoint` 注册
 *    静态障碍;`isBlocked` 走矩形 + 点命中。
 *  - 默认 bounds = 2000 × 1500(对应 `MapCatalog.LEVEL_1` 默认地图大小,
 *    让 `MapObstacle.bounds()` 在 mock 与真实模块下行为一致)。
 *  - 矩形是闭区间(`min <= p <= max`);点的命中用 `POINT_EPSILON` 容差。
 *  - `loadLevel(id)` 走 spy(记入 `loadedLevels`),**不**广播 `map:loaded`
 *    事件(mock 不持 bus);下游测试如需事件,自行用 `createMockObstacle`
 *    返回的 `__emitMapLoaded` 驱动。
 *  - **不**依赖 Excalibur(纯 TS),所以测试不需要 setup 浏览器全局。
 */
import type { HitResult, LevelId, Vec2 } from "../../../runtime/types";
import type { MapData, MapObstaclePort } from "../../../runtime/ports/MapObstaclePort";

/** Mock 工厂的可调参数。 */
export interface MockObstacleOptions {
  /** 初始 bounds 最小角;默认 `{x:0,y:0}`。 */
  boundsMin?: Vec2;
  /** 初始 bounds 最大角;默认 `{x:2000,y:1500}`(与 `MapCatalog.LEVEL_1` 一致)。 */
  boundsMax?: Vec2;
  /** 初始 playerSpawn;默认 `{x:400,y:750}`(与 `MapCatalog.LEVEL_1` 一致)。 */
  playerSpawn?: Vec2;
  /** 初始 portalSpawn;默认 `{x:1900,y:200}`(与 `MapCatalog.LEVEL_1` 一致)。 */
  portalSpawn?: Vec2;
}

/** Mock 工厂返回的扩展 Port,带 spy / 驱动函数。 */
export interface MockObstacleHandle extends MapObstaclePort {
  /** spy:注册过的障碍矩形列表(只读,顺序无关)。 */
  readonly blockedRects: ReadonlyArray<{ min: Vec2; max: Vec2 }>;
  /** spy:`addBlockedPoint` 注册过的点列表(只读)。 */
  readonly blockedPoints: ReadonlyArray<Vec2>;
  /** spy:被调过的 `loadLevel` ID 列表。 */
  readonly loadedLevels: ReadonlyArray<LevelId>;
  /** spy:被查过的点总数(每次 `isBlocked` +1)。 */
  readonly isBlockedCallCount: number;
  /** spy:被调过的 `raycast` 次数。 */
  readonly raycastCallCount: number;

  /** 测试驱动:注册一个轴对齐矩形障碍(闭区间)。 */
  addBlockedRect(min: Vec2, max: Vec2): void;
  /** 测试驱动:注册一个点障碍(精确命中,带 `POINT_EPSILON` 容差)。 */
  addBlockedPoint(p: Vec2): void;
  /** 测试驱动:直接覆盖当前 bounds(不走 `loadLevel`)。 */
  setBounds(min: Vec2, max: Vec2): void;
  /** 测试驱动:覆盖 playerSpawn。 */
  setPlayerSpawn(p: Vec2): void;
  /** 测试驱动:覆盖 portalSpawn。 */
  setPortalSpawn(p: Vec2): void;
  /** 测试驱动:注册一组 "raycast → 命中" 的预设(供 mock raycast 走查表)。 */
  setRaycastResult(from: Vec2, dir: Vec2, maxDist: number, result: HitResult | null): void;
  /**
   * 测试驱动:`loadLevel` 后手动 emit `map:loaded` 事件回调(本 mock 不持 bus,
   * 由调用方把 `bus` 传进来或直接驱动下游订阅者)。
   */
  __emitMapLoaded(bus: { emit: (e: { type: "map:loaded"; level: LevelId }) => void }): void;
  /** 清空所有障碍 + 回到默认 bounds(测试间隔离)。 */
  reset(): void;
}

/** 点命中容差;`isBlocked({x:1.0001, y:2.0001})` 与 `{x:1,y:2}` 等价。 */
const POINT_EPSILON = 0.001;

/** 默认 bounds / spawn —— 与 `MapCatalog.LEVEL_1` 对齐,见该文件注释。 */
const DEFAULT_BOUNDS_MIN: Vec2 = { x: 0, y: 0 };
const DEFAULT_BOUNDS_MAX: Vec2 = { x: 2000, y: 1500 };
const DEFAULT_PLAYER_SPAWN: Vec2 = { x: 400, y: 750 };
const DEFAULT_PORTAL_SPAWN: Vec2 = { x: 1900, y: 200 };

/** 默认关卡 ID —— 与 `MapCatalog.LEVEL_1.id` 对齐。 */
const DEFAULT_LEVEL: LevelId = "level-1";

/**
 * 判断 `p` 是否在闭区间矩形 `[min, max]` 内(含边界)。
 * 轴对齐,无旋转。
 */
function pointInRect(p: Vec2, min: Vec2, max: Vec2): boolean {
  return p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y;
}

/** raycast 预设 key 的编码(浮点容差量化到 0.01 像素,避免查表漏命中)。 */
function raycastKey(from: Vec2, dir: Vec2, maxDist: number): string {
  const q = (n: number) => Math.round(n * 100);
  return `${q(from.x)},${q(from.y)}|${q(dir.x)},${q(dir.y)}|${q(maxDist)}`;
}

/**
 * 创建 Mock MapObstacle Port。
 */
export function createMockObstacle(opts: MockObstacleOptions = {}): MockObstacleHandle {
  const blockedRects: Array<{ min: Vec2; max: Vec2 }> = [];
  const blockedPoints: Vec2[] = [];
  const loadedLevels: LevelId[] = [];
  const raycastResults = new Map<string, HitResult | null>();
  let boundsMin: Vec2 = opts.boundsMin ?? DEFAULT_BOUNDS_MIN;
  let boundsMax: Vec2 = opts.boundsMax ?? DEFAULT_BOUNDS_MAX;
  let playerSpawn: Vec2 = opts.playerSpawn ?? DEFAULT_PLAYER_SPAWN;
  let portalSpawn: Vec2 = opts.portalSpawn ?? DEFAULT_PORTAL_SPAWN;
  let isBlockedCallCount = 0;
  let raycastCallCount = 0;

  const port: MapObstaclePort = {
    isBlocked(p: Vec2): boolean {
      isBlockedCallCount++;
      // 默认空地图:出界算被占(与真实模块 `CollisionGrid` 语义一致,见该文件)。
      if (p.x < boundsMin.x || p.x > boundsMax.x) return true;
      if (p.y < boundsMin.y || p.y > boundsMax.y) return true;
      for (const r of blockedRects) {
        if (pointInRect(p, r.min, r.max)) return true;
      }
      for (const bp of blockedPoints) {
        if (Math.abs(p.x - bp.x) < POINT_EPSILON && Math.abs(p.y - bp.y) < POINT_EPSILON) {
          return true;
        }
      }
      return false;
    },
    bounds() {
      return { min: { ...boundsMin }, max: { ...boundsMax } };
    },
    raycast(from: Vec2, dir: Vec2, maxDist: number): HitResult | null {
      raycastCallCount++;
      const preset = raycastResults.get(raycastKey(from, dir, maxDist));
      if (preset !== undefined) return preset;
      // 未注册预设:走"沿 dir 走 maxDist,沿途查 isBlocked"的兜底实现,
      // 让 mock 在没有显式预设时也能给出"最少正确"行为。
      const len = Math.hypot(dir.x, dir.y);
      if (len === 0 || maxDist <= 0) return null;
      const ux = dir.x / len;
      const uy = dir.y / len;
      const step = 1; // 1 像素一步,够细;mock 不追求性能
      for (let d = 0; d <= maxDist; d += step) {
        const p: Vec2 = { x: from.x + ux * d, y: from.y + uy * d };
        if (port.isBlocked(p)) {
          return {
            actor: null as unknown as HitResult["actor"],
            position: p,
            // 法线:取 dir 4 邻接里"第一个不是阻挡"的方向;mock 简化用 -dir 作 fallback。
            normal: { x: -ux, y: -uy },
            distance: d,
          };
        }
      }
      return null;
    },
    playerSpawn() {
      return { ...playerSpawn };
    },
    portalSpawn() {
      return { ...portalSpawn };
    },
    level(): MapData {
      return { id: DEFAULT_LEVEL, bounds: { min: { ...boundsMin }, max: { ...boundsMax } } };
    },
    loadLevel(id: LevelId) {
      loadedLevels.push(id);
      // mock 不广播事件;调用方需要的话调 `__emitMapLoaded(bus)` 手动驱动。
    },
  };

  const handle: MockObstacleHandle = {
    ...port,
    blockedRects,
    blockedPoints,
    loadedLevels,
    get isBlockedCallCount() {
      return isBlockedCallCount;
    },
    get raycastCallCount() {
      return raycastCallCount;
    },
    addBlockedRect(min: Vec2, max: Vec2) {
      blockedRects.push({ min: { ...min }, max: { ...max } });
    },
    addBlockedPoint(p: Vec2) {
      blockedPoints.push({ ...p });
    },
    setBounds(min: Vec2, max: Vec2) {
      boundsMin = { ...min };
      boundsMax = { ...max };
    },
    setPlayerSpawn(p: Vec2) {
      playerSpawn = { ...p };
    },
    setPortalSpawn(p: Vec2) {
      portalSpawn = { ...p };
    },
    setRaycastResult(from: Vec2, dir: Vec2, maxDist: number, result: HitResult | null) {
      raycastResults.set(raycastKey(from, dir, maxDist), result);
    },
    __emitMapLoaded(bus) {
      bus.emit({ type: "map:loaded", level: DEFAULT_LEVEL });
    },
    reset() {
      blockedRects.length = 0;
      blockedPoints.length = 0;
      loadedLevels.length = 0;
      raycastResults.clear();
      boundsMin = opts.boundsMin ?? DEFAULT_BOUNDS_MIN;
      boundsMax = opts.boundsMax ?? DEFAULT_BOUNDS_MAX;
      playerSpawn = opts.playerSpawn ?? DEFAULT_PLAYER_SPAWN;
      portalSpawn = opts.portalSpawn ?? DEFAULT_PORTAL_SPAWN;
      isBlockedCallCount = 0;
      raycastCallCount = 0;
    },
  };

  return handle;
}
