/**
 * `MapCatalog` — 静态地图数据表(plan/modules/obstacle.md §5 子模块 1)。
 *
 * 职责:
 *  - 持有 `LevelId → MapDefinition` 的映射;
 *  - 提供 `get(id)` 取出"当前关卡的墙壁矩形 + 出生点 + 传送门点 + 世界 bounds"。
 *
 * 数据形态(纯静态):
 *  - `walls: readonly Rect[]` —— 该关所有静态 AABB 障碍;首版关卡 1 给一组
 *    围栏 + 中间挡板,完全复刻土豆兄弟首关的"开放地图 + 局部挡板"手感。
 *  - `playerSpawn / portalSpawn: Vec2` —— 该关出生点 / 传送门点。
 *  - `bounds: Rect` —— 该关的"世界地图 AABB",摄像机 clamp / 屏幕外裁剪 共同使用。
 *
 * 设计原则:
 *  - **不**依赖 Excalibur(纯 TS 数据),单测不需要 setup 浏览器全局。
 *  - **不**持有 Port 引用,只暴露查表;切关时由 `ObstacleModule` 调 `get(id)` 拿数据,
 *    再装进 `CollisionGrid`。
 *  - 与 `runtime/types.ts` 的 `LevelId` 协议层定义保持一致:
 *    联合里有 `"level-1"`,此处 catalog 用同名字面量 key。
 *  - 后续加新关时,只在本文件里**追加** `LEVEL_DEFINITIONS` 入口即可,不动协议层。
 */
import type { LevelId, Rect, Vec2 } from "../../../runtime/types";

/**
 * 单关卡的完整静态数据(关卡作者视角的"完整地图定义")。
 *
 * 区别于协议层 `MapObstaclePort.MapData`:
 *  - `MapData` 是 Port 暴露给外部的"只读视图",只携带 `id` + `bounds`;
 *  - `MapDefinition` 是本模块**内部**的"全量数据",包含所有墙壁矩形 + 出生点。
 *    外部**不**看到 —— Player / Camera 只通过 `isBlocked` / `bounds` / `playerSpawn`
 *    查,不允许直接读 `walls`(避免业务模块依赖具体地图布局,见 obstacle.md §8)。
 */
export interface MapDefinition {
  /** 关卡 ID(协议层 `LevelId`)。 */
  readonly id: LevelId;
  /** 该关世界地图 AABB —— Camera clamp / 屏幕外裁剪 用。 */
  readonly bounds: Rect;
  /** 该关所有静态 AABB 障碍(世界坐标,像素)。闭区间 `[min, max]`。 */
  readonly walls: readonly Rect[];
  /** 玩家出生点(世界坐标,像素)。 */
  readonly playerSpawn: Vec2;
  /** 传送门生成点(世界坐标,像素)。 */
  readonly portalSpawn: Vec2;
}

/** 关卡 1 地图大小(像素):2000 × 1500。Camera clamp 范围由此派生。 */
const LEVEL_1_WIDTH = 2000;
const LEVEL_1_HEIGHT = 1500;

/**
 * 关卡 1 静态数据(roadmap §3.5 + obstacle.md §5):
 *  - 一组外围围栏墙(留一个 200 像素缺口给玩家"侧身"出去,避免视觉太堵);
 *  - 中间几块挡板(让 AI / 玩家有视线阻挡,符合土豆兄弟首关的"局部掩体"手感);
 *  - 玩家在地图中心,传送门在右下角(对角,最远点)。
 *
 * 注意点:
 *  - 全部矩形都是**闭区间**(`min <= p <= max`);`CollisionGrid.isBlocked` 与
 *    raycast 都按这个语义实现。
 *  - 挡板厚度 64 像素(2 个 32px cell),既能在 32px 网格里清晰表达"墙",也避免
 *    玩家卡死在像素级边缝。
 */
const LEVEL_1: MapDefinition = {
  id: "level-1",
  bounds: {
    min: { x: 0, y: 0 },
    max: { x: LEVEL_1_WIDTH, y: LEVEL_1_HEIGHT },
  },
  // 外围围栏:上下左右四面墙,留右侧缺口。
  walls: [
    // 上墙
    { min: { x: 0, y: 0 }, max: { x: LEVEL_1_WIDTH, y: 64 } },
    // 下墙
    { min: { x: 0, y: LEVEL_1_HEIGHT - 64 }, max: { x: LEVEL_1_WIDTH, y: LEVEL_1_HEIGHT } },
    // 左墙
    { min: { x: 0, y: 0 }, max: { x: 64, y: LEVEL_1_HEIGHT } },
    // 右墙(留底部 200 像素缺口,从 y=LEVEL_1_HEIGHT-200 起断开,作为"出口")
    { min: { x: LEVEL_1_WIDTH - 64, y: 0 }, max: { x: LEVEL_1_WIDTH, y: LEVEL_1_HEIGHT - 200 } },
    // 中间挡板 1(横向,地图中线略上)
    { min: { x: 600, y: 500 }, max: { x: 1100, y: 564 } },
    // 中间挡板 2(竖向,右侧)
    { min: { x: 1500, y: 300 }, max: { x: 1564, y: 900 } },
  ],
  // 出生点 = 地图中心(避开挡板)。
  playerSpawn: { x: 400, y: 750 },
  // 传送门 = 右上角(对角,远离出生点)。
  portalSpawn: { x: 1900, y: 200 },
};

/** 全部关卡的静态表(roadmap §3.5:首版 1 关,后续按需扩)。 */
const LEVEL_DEFINITIONS: Readonly<Record<LevelId, MapDefinition>> = {
  "level-1": LEVEL_1,
};

/** `MapCatalog` 工厂返回的接口。 */
export interface MapCatalog {
  /**
   * 取关卡 `id` 的完整定义。**未注册**的 `LevelId` 抛错
   * (roadmap §0.2:不返回 `null`,让协议层漏数据时立刻炸出来)。
   */
  get(id: LevelId): MapDefinition;
  /** 列出当前已注册的所有关卡 ID(测试 / 调试用;首版业务不依赖)。 */
  list(): readonly LevelId[];
}

/**
 * 创建 `MapCatalog` 实例。
 *
 * 注意:工厂**不**接收任何依赖(纯静态表),可以全局复用;但为了与其它子模块
 * 风格一致 + 测试可替换,仍然走工厂模式。
 */
export function createMapCatalog(): MapCatalog {
  return {
    get(id) {
      const def = LEVEL_DEFINITIONS[id];
      if (!def) {
        throw new Error(`[MapCatalog] Unknown level id: ${String(id)}`);
      }
      return def;
    },
    list() {
      return Object.keys(LEVEL_DEFINITIONS) as LevelId[];
    },
  };
}
