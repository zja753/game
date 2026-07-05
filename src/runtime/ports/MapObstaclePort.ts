/**
 * `MapObstaclePort` — MapObstacle 模块对外暴露的能力(见 plan/modules/obstacle.md §2)。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 其他模块**只**通过这个 interface 调用 MapObstacle 的能力。
 *  - 任何 `import { ... } from "@/modules/obstacle/internal/..."` 都是破坏约束。
 *  - `LevelId` 在 `runtime/types.ts` 集中定义(协议层),所有模块共享。
 *
 * 设计原则:
 *  - 接口**不**出现其他模块的类型名(plan §2.3);关卡 ID 走 `LevelId` 字面量。
 *  - `isBlocked` 用**点查询**(`Vec2`)而不是 AABB 拉框,理由:
 *     - Player / Combat / Enemy 的实际碰撞都是"某个点(脚底 / 弹道中点)有没有墙";
 *      提供"拉框"等于让实现方再写一遍 SAT 缩小到点,徒增 API 表面。
 *    - 后续真要拉框时,加 `isBoxBlocked(min, max)` 即可,旧方法不动。
 *  - `bounds()` 返回 `Rect`(runtime/types.ts),Camera 用作 clamp / 视口外裁剪。
 *  - `raycast()` 暴露光投射:挡墙判断 + AI 反射 + 投射物最远射程。
 *  - `playerSpawn` / `portalSpawn` 是关卡级的"重要点"出口 —— 由 MapObstacle 拥有,
 *    因为这两点由"地图"决定,不属于 Player / Progression 业务。
 *  - `level()` 给"当前关地图数据"的只读视图;首版不强制使用(HUD 可只读
 *    `SceneContext` 拿关卡 ID),M2+ 真要画小地图时再依赖。
 */
import type { LevelId, Rect, Vec2 } from "../types";
import type { HitResult } from "../types";

/**
 * 当前关地图数据只读视图(obstacle.md §4 `权威字段`)。
 * 协议层只给"id + bounds"两字段;详细墙体数据(网格 / 多边形)由 MapObstacle
 * 内部持有,**不**通过 Port 暴露 —— 外部一律走 `isBlocked` / `raycast` 查询。
 */
export interface MapData {
  /** 关卡 ID(与 `loadLevel` 入参一致)。 */
  id: LevelId;
  /** 关卡轴对齐包围盒(等价于 `bounds()` 的返回值,这里再嵌一份方便 HOC)。 */
  bounds: Rect;
}

export interface MapObstaclePort {
  /**
   * 点 `p`(世界坐标,像素)**是否被静态障碍占据**。
   * - `true` = 此处有墙 / 不可走,移动 / 弹道应被阻止。
   * - `false` = 此处空地。
   *
   * 实现方可以按"格点 / 矩形 / 多边形"任意一种内部模型做查询。
   */
  isBlocked(p: Vec2): boolean;

  /**
   * 当前关卡的世界坐标包围盒(轴对齐矩形)。
   * - `min` 左下角;`max` 右上角。
   * - 摄像机用它做边缘 clamp;AI / 弹道用它做"出界裁剪"。
   */
  bounds(): Rect;

  /**
   * 从 `from` 沿 `dir` 发射长度 `maxDist` 的射线,**只**碰"墙"(静态障碍)层。
   * - 用于:Enemy AI 检测前方有没有墙(决定是否转向 / 反弹);
   *   Combat 投射物最远射程的"提前碰撞距离"预估。
   * - 与 `RuntimePort.collision.raycast` 的区别:这里是"地图层 raycast",
   *   关注**任意静态障碍**(包括非碰撞注册的墙);后者只查 `addLayer` 注册过的
   *   两两碰撞组。
   */
  raycast(from: Vec2, dir: Vec2, maxDist: number): HitResult | null;

  /**
   * 当前关卡玩家出生点(世界坐标,像素)。
   *
   * Player 模块在 `setPos` 时**应该**用这个值,而不是硬编码 `{0,0}`;MapObstacle
   * 根据关卡定义提供出生点(如关卡 1 是地图中心、关卡 2 是地图角落)。
   */
  playerSpawn(): Vec2;

  /**
   * 当前关卡传送门生成点(世界坐标,像素)。
   *
   * Progression 在 `running → portal` 转移时调 `RuntimePort.spawnActor`
   * 生成 PortalActor 时,应该用这个点作为位置;由 MapObstacle 决定"门该
   * 出现在哪"(一般是地图对角 / 远离出生点)。
   */
  portalSpawn(): Vec2;

  /**
   * 当前关卡数据的只读视图(详见 `MapData`)。
   * 首版 HUD 可不依赖;留给 M2+ 画小地图用。
   */
  level(): MapData;

  /**
   * 切到关卡 `id`(Progression 落地时由它调)。
   * 切换后 `isBlocked` / `bounds` / `playerSpawn` / `portalSpawn` / `level`
   * 全部反映新关卡的内容;同时广播 `map:loaded` 事件(Camera 订阅)。
   */
  loadLevel(id: LevelId): void;
}
