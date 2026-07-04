/**
 * `MapObstaclePort` — MapObstacle 模块对外暴露的能力(见 plan/modules/obstacle.md §2)。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 其他模块**只**通过这个 interface 调用 MapObstacle 的能力。
 *  - 任何 `import { ... } from "@/modules/obstacle/internal/..."` 都是破坏约束。
 *  - MapObstacle 模块**目前未落地**,本文件先提供"接口最小集"(Player
 *    落地时所需的 `isBlocked`),后续 Combat / Enemy / Progression 落地时
 *    再往里加方法即可。Player 模块直接按当前接口依赖,后续扩展不影响它。
 *
 * 设计原则:
 *  - 接口**不**出现其他模块的类型名(plan §2.3);用 `string` 描述关卡 ID。
 *  - `isBlocked` 用**点查询**(`Vec2`)而不是 AABB 拉框,理由:
 *     - Player / Combat / Enemy 的实际碰撞都是"某个点(脚底 / 弹道中点)有没有墙";
 *      提供"拉框"等于让实现方再写一遍 SAT 缩小到点,徒增 API 表面。
 *    - 后续真要拉框时,加 `isBoxBlocked(min, max)` 即可,旧方法不动。
 *  - `bounds()` 暴露地图轴对齐包围盒,Camera 用作 clamp / 视口外裁剪。
 */
import type { Vec2 } from "../types";

/** 关卡 ID(字符串字面量联合由 MapObstacle 落地时填)。 */
export type LevelId = string;

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
  bounds(): { min: Vec2; max: Vec2 };

  /**
   * 切到关卡 `n`(后续 Progression 落地时由它调)。
   * 切换后 `isBlocked` / `bounds` 反映新关卡的内容。
   *
   * 第一版 Player 不调这个;**只**为把"接口形态"提前定下来,后续
   * MapObstacle 落地时直接接上。
   */
  loadLevel(id: LevelId): void;
}
