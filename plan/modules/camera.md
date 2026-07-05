# Module-Camera

> 顶层路线见 [`../modular-roadmap.md`](../modular-roadmap.md)。本文件是 Camera 模块的自留地:Port / 事件 / 内部子模块拆分。本模块负责**世界坐标 → 屏幕视图的投影**:玩家跟随 + 地图边缘 hard clamp,**完全复刻土豆兄弟原版手感**,不做任何形式的摄像机缓动 / 过渡动画。

---

## 1. 职责

- 持有"摄像机世界坐标"(Excalibur `Scene.camera.pos` 的写入方)。
- 每帧:跟随玩家 → 地图边缘 hard clamp → 写入引擎。
- 暴露 `pos` / `viewportSize` 给 HUD 做小地图、屏幕边缘提示等。
- 订阅 `map:loaded`,切关时重算 clamp 范围。

**不做**:玩家移动、地图加载、敌人 AI、UI 渲染、摄像机缓动 / 过渡动画 / shake / zoom。

---

## 2. 对外 Port

文件:`game/src/runtime/ports/CameraPort.ts`

```ts
interface CameraPort {
  pos(): Vec2; // 当前摄像机世界坐标(左上角)
  viewportSize(): Vec2; // 视口尺寸(像素)
  isOnScreen(worldPos: Vec2): boolean; // 给 Combat / Enemy 做屏幕外裁剪用:返回 worldPos 是否落在当前摄像机可见矩形内(被 mapBounds 截断)
  // 注意:本模块不暴露 setPos() / setFollow() —— 跟随规则是模块内部不变量,
  // 任何模块"想移动摄像机"的诉求都通过 PlayerPort.pos() 改变玩家位置实现。
}
```

`isOnScreen` 的实现直接复用 `§5 CameraController.computeCameraPos` 的几何,等价于 `clampRange.contains(worldPos)`,其中 `clampRange` 由 `viewportSize + mapBounds` 派生。这样所有"摄像机相关"的几何(可见区域、裁剪、跟随)都集中在 Camera 模块一处,Combat / Enemy 不需要自己再算一遍。

`Vec2` 在 `runtime/types.ts` 集中定义。

---

## 3. 事件

- **输入事件**:
  - `map:loaded`(订阅,用于切关时重算 clamp 范围)。
  - `player:moved`(可选优化 —— 若改为事件驱动可省掉每帧 tick 轮询;首版用 RuntimePort 的 tick 轮询 `PlayerPort.pos()`,两者等价,选哪种由实现决定)。
- **输出事件**:
  - `camera:moved { pos, viewportSize }`(给 HUD 做小地图 / 屏幕边缘提示)。

---

## 4. 权威字段

- `camera.pos`(摄像机世界坐标,Excalibur `Scene.camera.pos` 的写入方)。
- `camera.viewportSize`(视口像素尺寸,从 `RuntimePort.viewportSize()` 派生)。
- 当前 `clampRange`(摄像机 pos 的合法区间 `[min, max]`),由 `MapObstaclePort.bounds()` + `viewportSize()` 派生,**不**独立存储为玩家可见字段。

---

## 5. 内部子模块草案

按关注点拆 2 个内部子模块,**都**在本模块目录 `modules/camera/` 下:

- `CameraController`:核心数学。提供**纯函数** `computeCameraPos(playerPos, mapBounds, viewportSize) → cameraPos`,不持有任何 Excalibur 引用,**完全可单测**。这是 §7 验收点的核心。
- `CameraFollower`:挂在 RuntimePort 的 tick 上,每帧 `PlayerPort.pos()` → `computeCameraPos` → 写入 `engine.currentScene.camera.pos` → 与上一帧不同则 `bus.emit("camera:moved")`。

**核心不变量(锁死实现)**:

```ts
// 不变量 §A:摄像机每帧 = clamp(玩家位置, 半视口, 地图边界 - 半视口)
function computeCameraPos(playerPos: Vec2, mapBounds: Rect, viewport: Vec2): Vec2 {
  const half = viewport.div(2);
  // min = 半视口;max = mapBounds - 半视口(但要保证 max >= min,以应对 viewport > mapBounds 的退化情况)
  const minX = half.x;
  const minY = half.y;
  const maxX = Math.max(half.x, mapBounds.maxX - half.x);
  const maxY = Math.max(half.y, mapBounds.maxY - half.y);
  return {
    x: Math.min(Math.max(playerPos.x, minX), maxX),
    y: Math.min(Math.max(playerPos.y, minY), maxY),
  };
}
```

不变量 §A 是**纯几何公式**,与 Excalibur / Actor / EventBus 都无关。`CameraController` 只暴露这个函数,`CameraFollower` 调用它。

---

## 6. 与其他模块的 Port 依赖

**消费**:

- `RuntimePort.viewportSize()`:拿视口像素尺寸。
- `RuntimePort.engine`:写入 `engine.currentScene.camera.pos`。
- `RuntimePort.onTick(handler)`:每帧驱动 `CameraFollower`。
- `PlayerPort.pos()`:拿玩家位置。
- `MapObstaclePort.bounds()`:拿地图边界算 clamp。

**被消费**(本模块对外):

- `CameraPort` 被 `HudUi` 通过 `ctx.camera` 读 `pos` / `viewportSize`(用于小地图 / 边缘提示);首版可只读 `ctx.camera`,不强求依赖 `CameraPort`。
- `CameraPort.isOnScreen(worldPos)` 被 `Combat` / `Enemy` 在做屏幕外裁剪时调(可选优化,首版不强制):子弹飞出一屏就不算命中、敌人在视口外就不跑 AI —— 走 CameraPort 而不是 RuntimePort.viewportSize(),避免"摄像机跟随"和"屏幕外裁剪"两边各自维护一套可见区域几何。

---

## 7. 验收

`pnpm exec vp check` 全绿;`pnpm dev` 接进 RootContainer 后用 RuntimePort/PlayerPort/MapObstaclePort Mock 跑:

- 玩家在地图中心 → `camera.pos === player.pos`
- 出 half-viewport 但未到 clamp → `camera.pos.x === player.pos.x`
- 走到 clamp 边界 → `camera.pos.x` 停住,玩家相对摄像机偏移
- 切关 → `MapObstaclePort.bounds()` 返回新边界,clamp 范围立即重算(瞬移)
- 视口 > 地图 → 摄像机锁在地图中心

> 测试只在你给具体 repro 或点名时再补,见顶层 §5。

---

## 8. 不做清单

- 不做缓动 / smoothing / 跟随速度参数(硬跟随,`camera.pos = computeCameraPos(player.pos)`,无 lerp / spring)。
- 不做切关过渡动画(瞬移,符合土豆兄弟)。
- 不做摄像机 shake / 屏幕震动(M2+ 再考虑)。
- 不做 zoom(M2+ 再考虑)。
- 不做摄像机区域触发(进入某区域自动切镜头等)。
- 不写摄像机状态到 Player / MapObstacle(违反权威原则)。
- 不监听 `Engine.onPostUpdate` 直接操作 camera(走 RuntimePort.onTick,保持依赖方向一致)。
