/**
 * `CollisionGrid` — 32px 空间网格(plan/modules/obstacle.md §5 子模块 2)。
 *
 * 职责:
 *  - 把"该关所有 AABB 墙壁"烧进一个固定 32px 单元的网格;
 *  - 提供 O(1) 的"点在不在墙里"查询(`isBlocked`)。
 *  - 提供"cell 是否被占据 + 邻接 cell 是否空"给 `RayCaster` 推法线用
 *    (DDA 命中 cell 后,沿 4 邻接方向找第一个"空"cell,该方向即命中面法线)。
 *
 * 设计原则:
 *  - **不**依赖 Excalibur(纯 TS,数组下标模拟 2D 网格),单测可独立跑。
 *  - 网格按"关卡 bounds 推导"自动铺满,cell 大小硬编码 32px(plan §5)。
 *  - 占据状态 = 单一布尔(`isBlockedCell`)。**不**记录"这块墙来自哪个 rect",
 *    因为本模块对外只承诺"点是否在墙里",不暴露具体 rect —— 避免业务模块
 *    反向推断地图布局(obstacle.md §8 不做清单:不做具体墙信息出口)。
 *  - 网格坐标系:cell `(cx, cy)` 的世界范围是
 *    `[cx*32, (cx+1)*32] × [cy*32, (cy+1)*32]`(闭区间,首尾 cell 与 bounds 对齐)。
 *  - `isBlocked` 用"点 → cell → 查表 + 边界闭区间校正"实现:对刚好在 cell 边界的
 *    点(`p.x % 32 === 0`),用 `cx - 1` 兜底查询,避免"墙的右边界点不算被占"的 bug。
 *    这点对手柄 / 子像素移动的浮点坐标也稳。
 */
import type { Rect, Vec2 } from "../../../runtime/types";

/** 网格 cell 大小(plan §5 硬约束:32px)。 */
export const CELL_SIZE = 32;

/** 占据状态:`Uint8Array` 默认全 0 = 自由;`1` = 被墙占据。首版关卡矩形不重叠,1bit 够用。 */
const CELL_BLOCKED = 1;

/** `CollisionGrid` 工厂返回的接口。 */
export interface CollisionGrid {
  /** 该关的"世界地图 AABB"(从 walls 推导,等价于 MapDefinition.bounds)。 */
  readonly bounds: Rect;
  /** 该网格的 cell 数量 —— 调试 / 验收点(plan §7:"视口 > 地图 → 摄像机锁中心"涉及)。 */
  readonly cols: number;
  readonly rows: number;
  /**
   * 点 `p` 是否被静态障碍占据。
   * - 在 `bounds` 之外 → 也算"被占据"(玩家走出地图边缘 = 撞墙,符合土豆兄弟)。
   *   Camera clamp 在前,Player Mover 不会真走出,但 `isBlocked` 仍按这个语义
   *   兜底,避免漏判。
   * - 在 `bounds` 之内 → 查 cell 表。
   * - 边界点(`p.x % 32 === 0`):用 `cx - 1` 兜底,理由见文件头注释。
   */
  isBlocked(p: Vec2): boolean;
  /**
   * 内部用:cell `(cx, cy)` 是否被墙占据。`cx` / `cy` 在网格范围外返回 `true`
   * (与 `isBlocked` 的"出界算占据"语义一致),便于 `RayCaster` 的 DDA 在墙
   * 紧贴地图边界的退化情况里直接停。
   */
  isBlockedCell(cx: number, cy: number): boolean;
  /**
   * 内部用:从 cell `(cx, cy)` 出发,沿 `dir` 方向找"最近的空 cell",返回该方向
   * 的单位向量。`RayCaster` 用这个来算命中面法线。
   *
   * `dir` 是 4 选 1 方向(单位向量),实现是 1 ~ 4 次邻居查询,纯 O(1)。
   * 全部邻居都被墙占满(被夹在墙里)时返回 `null`,此时法线无意义,RayCaster
   * 会把它当作"穿墙命中"特殊处理(用 raycast 自身方向的反向作为 fallback normal)。
   */
  emptyNeighborNormal(cx: number, cy: number, dir: Vec2): Vec2 | null;
}

/**
 * 把世界坐标 `p` 换算成 cell 索引。**不**做范围裁剪;调用方拿到索引后自己
 * 用 `isBlockedCell` 判断。
 *
 * 边界点(`p.x === col*CELL_SIZE`)按"属于左侧 cell"处理(`floor`),与
 * `isBlocked` 的闭区间语义一致。
 */
function pointToCell(p: number): number {
  return Math.floor(p / CELL_SIZE);
}

/**
 * 创建一个 `CollisionGrid`,从一组 AABB 墙壁矩形烧成网格。
 *
 * - `bounds`:**该网格覆盖的世界范围**;`walls` 全部在 `bounds` 之内
 *   (MapCatalog 装配时保证)。若 `walls` 有 cell 在 `bounds` 外,会抛错
 *   (roadmap §0.2:协议层漏数据立刻炸出来)。
 * - 网格大小由 `(bounds, CELL_SIZE)` 推导,自动按"刚好能铺满"取整。
 */
export function createCollisionGrid(bounds: Rect, walls: readonly Rect[]): CollisionGrid {
  const minCx = pointToCell(bounds.min.x);
  const minCy = pointToCell(bounds.min.y);
  // `maxCx` 用 `ceil` 包含右/上边界本身(闭区间语义)。
  const maxCx = Math.ceil(bounds.max.x / CELL_SIZE);
  const maxCy = Math.ceil(bounds.max.y / CELL_SIZE);

  const cols = maxCx - minCx;
  const rows = maxCy - minCy;

  if (cols <= 0 || rows <= 0) {
    throw new Error(
      `[CollisionGrid] Invalid bounds: ${JSON.stringify(bounds)} yields ${cols}x${rows} grid`,
    );
  }

  // 烧墙:用 1 行连续整数数组当稀疏 2D 网格,索引 = `cy * cols + cx`。
  const cells = new Uint8Array(cols * rows);

  function cellIndex(cx: number, cy: number): number {
    return (cy - minCy) * cols + (cx - minCx);
  }

  // 把每个 AABB 矩形标到网格里。逐 cell 标记(每个 AABB 最多覆盖 (W/32)*(H/32)
  // 个 cell,首版关卡矩形很少,O(total) 烧墙开销可忽略)。
  for (const wall of walls) {
    if (
      wall.min.x < bounds.min.x ||
      wall.min.y < bounds.min.y ||
      wall.max.x > bounds.max.x ||
      wall.max.y > bounds.max.y
    ) {
      throw new Error(
        `[CollisionGrid] Wall ${JSON.stringify(wall)} is outside bounds ${JSON.stringify(bounds)}`,
      );
    }
    const fromCx = pointToCell(wall.min.x);
    const fromCy = pointToCell(wall.min.y);
    const toCx = pointToCell(wall.max.x);
    const toCy = pointToCell(wall.max.y);
    for (let cy = fromCy; cy <= toCy; cy++) {
      for (let cx = fromCx; cx <= toCx; cx++) {
        cells[cellIndex(cx, cy)] = CELL_BLOCKED;
      }
    }
  }

  return {
    bounds,
    cols,
    rows,
    isBlocked(p) {
      // 出界 = 被占据(防御性兜底,Camera clamp 在前不会真发生)。
      if (p.x < bounds.min.x || p.x > bounds.max.x) return true;
      if (p.y < bounds.min.y || p.y > bounds.max.y) return true;
      const cx = pointToCell(p.x);
      const cy = pointToCell(p.y);
      // 在 grid 范围内查表;出 cell 范围(理论上不会发生,因为 bounds 已铺满)
      // 一律按"被占"兜底。
      if (cx < minCx || cx >= maxCx || cy < minCy || cy >= maxCy) return true;
      return cells[cellIndex(cx, cy)] === CELL_BLOCKED;
    },
    isBlockedCell(cx, cy) {
      if (cx < minCx || cx >= maxCx || cy < minCy || cy >= maxCy) return true;
      return cells[cellIndex(cx, cy)] === CELL_BLOCKED;
    },
    emptyNeighborNormal(cx, cy, dir) {
      // dir 是单位向量;用四象限归类到 4 选 1 方向(±x / ±y)。
      // 注意:dir 与网格轴夹角过大时(>45°),法线从 x 切到 y —— 这是预期行为,
      // DDA 步进的"主轴"概念一致;RayCaster 调用方按 DDA 步进方向传参,法线
      // 与入射方向垂直,符合物理学直觉。
      let nx = 0;
      let ny = 0;
      if (dir.x > 0) nx = 1;
      else if (dir.x < 0) nx = -1;
      if (dir.y > 0) ny = 1;
      else if (dir.y < 0) ny = -1;
      // 4 邻接:先试主轴,再试副轴。优先返回"第一个空邻接",与"玩家撞哪面墙"
      // 的视觉直觉一致(主轴方向先碰到空地)。
      if (nx !== 0 && !this.isBlockedCell(cx + nx, cy)) {
        return { x: nx, y: 0 };
      }
      if (ny !== 0 && !this.isBlockedCell(cx, cy + ny)) {
        return { x: 0, y: ny };
      }
      // 夹在墙里:返回 null(调用方用 fallback normal)。
      return null;
    },
  };
}
