/**
 * `createMockMapObstacle` — MapObstacle 模块的 Mock 工厂(占位,见 plan §5.1)。
 *
 * 状态:
 *  - MapObstacle 模块**尚未落地**,但 `runtime/ports/MapObstaclePort.ts` 已
 *    先定好接口形态。本工厂就是给 Player / Combat / Enemy / Camera / Progression
 *    的单测提供 `MapObstaclePort` stub 的,等 MapObstacle 模块上线后,
 *    那边的 `__mocks__/mockObstacle.ts` 会成为正式 mock,本文件保留作
 *    "早期接入的过渡 mock"以避免空模块被拆出来。
 *  - 当前实现:支持测试显式 `addBlockedRect` / `addBlockedPoint` 注册静态
 *    障碍;`isBlocked` 走矩形 + 点 命中检测。`bounds` 默认给一张 2000×2000
 *    的地图,测试可以用 `setBounds` 覆盖。
 *  - **不**依赖 Excalibur(纯 TS),所以测试不需要 setup 浏览器全局。
 *
 * 关键不变量:
 *  - `isBlocked(p)` 的语义与 `runtime/ports/MapObstaclePort.ts` 一致。
 *  - 默认全是空地图(没有任何障碍),Player 单测里"墙碰撞"路径不会被
 *    这层 mock 误伤。
 *  - 矩形是闭区间(`min <= p <= max`);点的命中用 `EQUALS_EPSILON` 容差。
 */
import type { LevelId, Vec2 } from "../../../runtime/types";
import type { MapObstaclePort } from "../../../runtime/ports/MapObstaclePort";

/** Mock 工厂的可调参数。 */
export interface MockMapObstacleOptions {
  /** 初始 bounds 最小角;默认 `{x:0,y:0}`。 */
  boundsMin?: Vec2;
  /** 初始 bounds 最大角;默认 `{x:2000,y:2000}`。 */
  boundsMax?: Vec2;
}

/** Mock 工厂返回的扩展 Port,带 spy / 驱动函数。 */
export interface MockMapObstacleHandle extends MapObstaclePort {
  /** spy:注册过的障碍矩形列表(只读,顺序无关)。 */
  readonly blockedRects: ReadonlyArray<{ min: Vec2; max: Vec2 }>;
  /** spy:`addBlockedPoint` 注册过的点列表(只读)。 */
  readonly blockedPoints: ReadonlyArray<Vec2>;
  /** spy:被调过的 `loadLevel` ID 列表。 */
  readonly loadedLevels: ReadonlyArray<LevelId>;
  /** spy:被查过的点总数(每次 `isBlocked` +1)。 */
  readonly isBlockedCallCount: number;

  /** 测试驱动:注册一个轴对齐矩形障碍(闭区间)。 */
  addBlockedRect(min: Vec2, max: Vec2): void;
  /** 测试驱动:注册一个点障碍(精确命中)。 */
  addBlockedPoint(p: Vec2): void;
  /** 测试驱动:直接覆盖当前 bounds。 */
  setBounds(min: Vec2, max: Vec2): void;
  /** 清空所有障碍 + 回到默认 bounds(测试间隔离)。 */
  reset(): void;
}

/** Excalibur `Vector` 风格的容差;Player 单测用点查询时用得上。 */
const POINT_EPSILON = 0.001;

/**
 * 判断 `p` 是否在闭区间矩形 `[min, max]` 内(含边界)。
 * 轴对齐,无旋转。
 */
function pointInRect(p: Vec2, min: Vec2, max: Vec2): boolean {
  return p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y;
}

export function createMockMapObstacle(opts: MockMapObstacleOptions = {}): MockMapObstacleHandle {
  let bMin: Vec2 = opts.boundsMin ?? { x: 0, y: 0 };
  let bMax: Vec2 = opts.boundsMax ?? { x: 2000, y: 2000 };
  const rects: Array<{ min: Vec2; max: Vec2 }> = [];
  const points: Vec2[] = [];
  const loaded: LevelId[] = [];
  let isBlockedCalls = 0;

  const port: MockMapObstacleHandle = {
    isBlocked(p: Vec2): boolean {
      isBlockedCalls++;
      // 点精确命中
      for (const pt of points) {
        if (Math.abs(pt.x - p.x) < POINT_EPSILON && Math.abs(pt.y - p.y) < POINT_EPSILON) {
          return true;
        }
      }
      // 矩形闭区间命中
      for (const r of rects) {
        if (pointInRect(p, r.min, r.max)) return true;
      }
      return false;
    },

    bounds() {
      return { min: { x: bMin.x, y: bMin.y }, max: { x: bMax.x, y: bMax.y } };
    },

    loadLevel(id: LevelId): void {
      loaded.push(id);
    },

    // ---- M9 完整 Port 表面(obstacle.md §2,本 mock 是过渡) ----
    // raycast 走"遍历 rects 算 t"——首版 Player / Combat / Enemy 不调,
    // 但接口要求存在,返回 null 表示 mock 里没墙挡。
    raycast(): null {
      return null;
    },
    // playerSpawn / portalSpawn:默认给 bounds 中心 + 对角,
    // 与真实 MapObstacle 的"出生点 + 传送门点"语义一致(测试可 `setBounds` 改边界)。
    playerSpawn(): Vec2 {
      return { x: (bMin.x + bMax.x) / 2, y: (bMin.y + bMax.y) / 2 };
    },
    portalSpawn(): Vec2 {
      return { x: bMax.x - 50, y: bMax.y - 50 };
    },
    level() {
      return { id: "level-1" as LevelId, bounds: { min: bMin, max: bMax } };
    },

    // ---- 驱动方法 ----
    addBlockedRect(min: Vec2, max: Vec2): void {
      // 复制进 / 复制出,避免外部修改内部状态。
      rects.push({ min: { x: min.x, y: min.y }, max: { x: max.x, y: max.y } });
    },
    addBlockedPoint(p: Vec2): void {
      points.push({ x: p.x, y: p.y });
    },
    setBounds(min: Vec2, max: Vec2): void {
      bMin = { x: min.x, y: min.y };
      bMax = { x: max.x, y: max.y };
    },
    reset(): void {
      bMin = opts.boundsMin ?? { x: 0, y: 0 };
      bMax = opts.boundsMax ?? { x: 2000, y: 2000 };
      rects.length = 0;
      points.length = 0;
      loaded.length = 0;
      isBlockedCalls = 0;
    },

    // ---- spy 视图 ----
    get blockedRects() {
      return rects;
    },
    get blockedPoints() {
      return points;
    },
    get loadedLevels() {
      return loaded;
    },
    get isBlockedCallCount() {
      return isBlockedCalls;
    },
  };

  return port;
}
