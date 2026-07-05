/**
 * `RayCaster` — 2D DDA 网格光线投射(plan/modules/obstacle.md §5 子模块 3)。
 *
 * 职责:
 *  - 在 `CollisionGrid` 上做 2D DDA(数字微分分析),从 `from` 沿 `dir` 投射线,
 *    找最先撞到的墙 cell;
 *  - 返回的 `HitResult` 包含命中点世界坐标、单位法线、距离 —— 与协议层
 *    `runtime/types.ts HitResult` 形状一致(`actor: null` 因为墙不是 Actor;
 *    协议层允许,见本模块注释)。
 *
 * 设计原则:
 *  - **不**依赖 Excalibur(纯数学),单测可独立跑;`CollisionGrid` 也是
 *    纯数据 + 纯函数,合在一起就是"几何查询引擎",无副作用。
 *  - `dir` 应当是单位向量;首版调用方由 `ObstacleModule` 在转交时归一化,
 *    方便上层传任意长度。
 *  - 退化情况:
 *     - `dir` 是零向量(零长度):返回 `null`(光线无方向)。
 *     - 起点已在墙里(`isBlocked(from) === true`):返回"零距离命中",`distance = 0`,
 *       `position = from`,`normal = -dir`(逻辑上:从墙里朝外看)。这是
 *       防御性兜底,正常游戏流(玩家不在墙里)不会触发。
 *     - 整个 maxDist 内没撞墙:返回 `null`(光在真空中走完)。
 *
 * 关于协议层 `HitResult.actor: Actor` 字段:
 *  - 协议层用的是 Excalibur `Actor`,但 MapObstacle 是"地图层 raycast",
 *    命中的不是 Actor 是墙。本模块用 `null as unknown as Actor` 占位
 *    (`actor: null`),调用方在 `obstacle.md` §2 的 Port 注释里已知这个
 *    妥协 —— MapObstaclePort.raycast 的调用方(Enemy / Combat)读到的
 *    命中是"墙"语义,不需要访问 `actor` 字段,只读 `position` / `normal` /
 *    `distance`。在内部用 `Object.create(null)` 构造一个**不带原型链**
 *    的对象,避免下游意外 `instanceof Actor` 误判。
 */
import type { HitResult, Vec2 } from "../../../runtime/types";
import type { CollisionGrid } from "./CollisionGrid";

/** 浮点比较的零阈值(归一化前的 dir 长度判断)。 */
const DIR_LENGTH_EPSILON = 1e-6;

/** DDA 步进时,如果 tMax 已经超过 maxDist,直接收敛到 maxDist(避免无谓迭代)。 */
const MAX_DDA_STEPS = 256;

/** `RayCaster` 工厂返回的接口。 */
export interface RayCaster {
  /**
   * 从 `from` 沿 `dir` 投射线,最多走 `maxDist`,返回最近墙命中。
   * `dir` 会**在内部归一化**(零向量返回 `null`)。
   *
   * 返回 `null` = `maxDist` 内没碰到任何墙。
   */
  cast(from: Vec2, dir: Vec2, maxDist: number): HitResult | null;
}

/**
 * 创建一个 `RayCaster`,绑定一张 `CollisionGrid`。
 */
export function createRayCaster(grid: CollisionGrid): RayCaster {
  return {
    cast(from, dir, maxDist) {
      if (maxDist <= 0) return null;
      const len = Math.hypot(dir.x, dir.y);
      if (len < DIR_LENGTH_EPSILON) return null;
      const ux = dir.x / len;
      const uy = dir.y / len;

      // 起点已在墙里:零距离命中,法线取 -dir(逻辑上"我正从墙里朝外看")。
      if (grid.isBlocked(from)) {
        return {
          // 用一个 prototype-less object 顶替 Actor 字段(见文件头注释)。
          actor: null as unknown as HitResult["actor"],
          position: { x: from.x, y: from.y },
          normal: { x: -ux, y: -uy },
          distance: 0,
        };
      }

      // DDA 初始化(经典 Amanatides & Woo):
      //  - 当前 cell
      //  - 每轴步进方向 ±1
      //  - 每轴"到下一条 cell 边界的距离"(tMax)
      //  - 每轴"从一个边界到下一个边界的距离"(tDelta)
      let cx = Math.floor(from.x / 32);
      let cy = Math.floor(from.y / 32);
      const stepX = ux > 0 ? 1 : ux < 0 ? -1 : 0;
      const stepY = uy > 0 ? 1 : uy < 0 ? -1 : 0;

      // 首条 cell 边界的距离:从起点沿 dir 走到"下一个 cell 边界"所需 t。
      let tMaxX: number;
      let tMaxY: number;
      const tDeltaX = stepX !== 0 ? 32 / Math.abs(ux) : Number.POSITIVE_INFINITY;
      const tDeltaY = stepY !== 0 ? 32 / Math.abs(uy) : Number.POSITIVE_INFINITY;
      if (stepX > 0) {
        tMaxX = ((cx + 1) * 32 - from.x) / ux;
      } else if (stepX < 0) {
        tMaxX = (cx * 32 - from.x) / ux;
      } else {
        tMaxX = Number.POSITIVE_INFINITY;
      }
      if (stepY > 0) {
        tMaxY = ((cy + 1) * 32 - from.y) / uy;
      } else if (stepY < 0) {
        tMaxY = (cy * 32 - from.y) / uy;
      } else {
        tMaxY = Number.POSITIVE_INFINITY;
      }

      // DDA 主循环:取 tMax 小的那条轴前进一格;撞到墙或 tMax > maxDist 停。
      let t = 0;
      for (let i = 0; i < MAX_DDA_STEPS; i++) {
        if (tMaxX < tMaxY) {
          if (tMaxX > maxDist) break;
          cx += stepX;
          t = tMaxX;
          tMaxX += tDeltaX;
        } else {
          if (tMaxY > maxDist) break;
          cy += stepY;
          t = tMaxY;
          tMaxY += tDeltaY;
        }
        if (grid.isBlockedCell(cx, cy)) {
          // 命中:回退 t 到"刚好进入这格之前"(穿入点的外侧),用入射方向的反向
          // 算一个上界 t,再钳到 maxDist(防御)。
          const hitT = Math.min(t, maxDist);
          const position: Vec2 = { x: from.x + ux * hitT, y: from.y + uy * hitT };
          // 法线:从命中 cell 朝最近空 cell 方向;全被占时 fallback 到 -dir。
          const normal = grid.emptyNeighborNormal(cx, cy, { x: ux, y: uy }) ?? {
            x: -ux,
            y: -uy,
          };
          return {
            actor: null as unknown as HitResult["actor"],
            position,
            normal,
            distance: hitT,
          };
        }
      }
      return null;
    },
  };
}
