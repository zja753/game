# Module-MapObstacle

> 顶层路线见 [`../modular-roadmap.md`](../modular-roadmap.md)。本文件是 MapObstacle 模块的自留地:Port / 事件 / 内部子模块拆分。本模块是**纯静态数据 + 查询**,无 Port 依赖。

---

## 1. 职责

静态地图数据(墙 / 地面 / 出生点 / 传送门生成点 / 商店位置)、碰撞查询、关卡切换。**不**做动态生成。

---

## 2. 对外 Port

文件:`game/src/runtime/ports/MapObstaclePort.ts`

```ts
interface MapObstaclePort {
  bounds(): Rect;
  isBlocked(x: number, y: number): boolean;
  raycast(from: Vec2, dir: Vec2, maxDist: number): HitResult | null;
  playerSpawn(): Vec2; // 玩家初始位置
  portalSpawn(): Vec2; // 传送门生成点
  level(): MapData; // 当前关地图(供 M3 之后)
  loadLevel(level: number): void; // 切关时 Progression 调
}
```

`Rect` / `Vec2` / `HitResult` / `MapData` 在 `runtime/types.ts` 集中定义。

---

## 3. 事件

- **输入事件**:无(纯静态数据)。
- **输出事件**:
  - `map:loaded { level }`(给 HUD 显示关卡名 / Progression 知道关卡变了)。

---

## 4. 权威字段

`MapData`(当前关的墙集合 / 出生点 / 传送门点)。

---

## 5. 内部子模块草案

按数据形态拆 3 个内部子模块,**都**在本模块目录 `modules/obstacle/` 下:

- `MapCatalog`:`level → MapData`(JSON / TS 数据表,纯静态)。第一版 1 关,M2+ 扩。
- `CollisionGrid`:空间网格(格子大小 32px)用于 `isBlocked` 快速查询。
- `RayCaster`:DDA 在网格上做光线投射(给 `raycast` 用)。

---

## 6. 与其他模块的 Port 依赖

无(被 Player / Enemy / Combat / Progression 通过 Port 注入查询)。

---

## 7. 验收

`pnpm exec vp check` 全绿;`pnpm dev` 接进 RootContainer 后:画 1 关地图,点击任意点 DOM 上显示 `isBlocked(x,y)` 结果(红/绿);从出生点向右射线 1000px 碰到第一堵墙即停。

> 测试只在你给具体 repro 或点名时再补,见顶层 §5。

---

## 8. 不做清单

- 不做敌人 spawn(交给 Enemy.SpawnScheduler)。
- 不做关卡倒计时(交给 Progression)。
- 不做动态障碍(关卡内墙是静态的;动态墙留到 M8+ 扩展)。
- 不做 tile 渲染(渲染由 Excalibur Actor 工厂 + Runtime 完成,本模块只提供数据)。
