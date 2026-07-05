/**
 * `CameraFollower` — 帧驱动的摄像机跟随器(plan/modules/camera.md §5 子模块 2)。
 *
 * 职责:
 *  - 挂在 `RuntimePort.onTick` 上,每帧 `preupdate`:
 *     1. 读 `PlayerPort.pos()` 拿玩家位置;
 *     2. 读 `MapObstaclePort.bounds()` 拿当前关卡地图边界(切关时事件驱动重读);
 *     3. 读 `RuntimePort.viewportSize()` 拿视口尺寸(Excalibur 画布大小,resize 实时);
 *     4. 调 `CameraController.computeCameraPos(...)` 算新摄像机位置;
 *     5. 写入 `engine.currentScene.camera.pos`(Excalibur 摄像机的权威写入方);
 *     6. 与上一帧位置不同则 `bus.emit("camera:moved")`(HudUi 订阅做小地图)。
 *  - 订阅 `map:loaded`,切关时立刻把缓存的 mapBounds 标"脏",下一帧重读;
 *    旧关卡的 clamp 范围瞬时被新关卡覆盖(无动画,符合土豆兄弟手感)。
 *
 * 设计原则:
 *  - **不**订阅 `player:moved` 边沿事件 —— 用每帧轮询 + diff 抑制,避免漏
 *    触发(若 player:moved 在某帧漏发,跟随会停一帧,违反"摄像机永远 = clamp(玩家)"
 *    不变量)。
 *  - **不**走 `Engine.onPostUpdate` 直接操作 camera(roadmap §7 铁律)——
 *    走 `RuntimePort.onTick`,保持依赖方向一致。
 *  - `mapBounds` 缓存:首版不持有"上一帧 mapBounds"做 diff 优化,只缓存当前
 *    mapBounds + 切关时标脏;`isOnScreen` 由 Port 直接走 `controller.isOnScreen` 实时算,
 *    不读缓存,保证与 `computeCameraPos` 共用同一份几何(camera.md §5)。
 *
 * Excalibur 写入细节:
 *  - `engine.currentScene.camera.pos` 是 `Vector`,可写。写入前用 `engine.currentScene`
 *    取当前活动场景(注意:**只**在 `tick` 阶段访问,避免装配期还没 goToScene 就读)。
 *  - 若 `engine.currentScene` 不存在(未加载场景),跳过写 —— 测试 / 装配期可能
 *    出现这种情况,本 follower 不抛错。
 */
import { vec } from "excalibur";
import type { GameEventBus } from "../../../runtime/EventBus";
import type { RuntimePort } from "../../../runtime/ports/RuntimePort";
import type { MapObstaclePort } from "../../../runtime/ports/MapObstaclePort";
import type { PlayerPort } from "../../../runtime/ports/PlayerPort";
import type { Rect, Vec2 } from "../../../runtime/types";

import type { CameraController } from "./CameraController";

/** `CameraFollower` 工厂返回的接口。 */
export interface CameraFollower {
  /**
   * 启动帧驱动订阅 + 切关事件订阅。返回 `dispose` 闭包(测试 / HMR 用,
   * 业务代码**不**调 —— Camera 生命周期 = 进程生命,见 CameraModule 注释)。
   */
  start(): () => void;
}

/** `CameraFollower` 工厂依赖。 */
export interface CameraFollowerDeps {
  bus: GameEventBus;
  runtime: RuntimePort;
  obstacles: MapObstaclePort;
  player: PlayerPort;
  controller: CameraController;
}

/**
 * 创建 `CameraFollower`,绑定依赖 + 控制器;**不**立刻订阅,由调用方
 * (`CameraModule.create`)在装配完后调 `start()`。
 */
export function createCameraFollower(deps: CameraFollowerDeps): CameraFollower {
  // 缓存当前 mapBounds;`null` = 下一帧再读(装配期切关后再读)。
  let cachedBounds: Rect | null = null;

  // 切关事件 → 缓存标"脏",下一帧重读。
  const unsubscribeMapLoaded = deps.bus.on("map:loaded", () => {
    cachedBounds = null;
  });
  function tick(): void {
    // 1) 拿 player 位置(每帧轮询,player:moved 边沿事件作 backup)。
    const playerPos: Vec2 = deps.player.pos();

    // 2) 拿 mapBounds:首次 / 切关后下一帧再读(避免装配期 `obstacles.bounds()`
    //    还没初始化就访问)。assign 到本地非空 `bounds` 上,让 TS 后续能正确收窄。
    if (cachedBounds === null) {
      cachedBounds = deps.obstacles.bounds();
    }
    const bounds: Rect = cachedBounds;

    // 3) 拿 viewportSize(走 RuntimePort —— Excalibur 画布实时尺寸,resize
    //    后 `RuntimeModule.viewportSize` 自动反映)。
    const vp = deps.runtime.viewportSize();
    const viewport: Vec2 = { x: vp.width, y: vp.height };

    // 4) 算新位置(锁死公式,见 CameraController)。
    const newPos: Vec2 = deps.controller.computeCameraPos(playerPos, bounds, viewport);

    // 5) 写入 Excalibur 摄像机:仅在场景已加载时写,装配期 / 测试无场景跳过。
    const scene = deps.runtime.engine.currentScene;
    if (scene) {
      // 比较后写入(避免每帧冗余写触发 Camera.hasChanged() 内部状态)。
      const cur = scene.camera.pos;
      if (cur.x !== newPos.x || cur.y !== newPos.y) {
        // Excalibur `Camera.pos` 是 `Vector` 类型,setter 要求 Vector 实例;
        // 协议层 `Vec2` 是 `{x, y}` 纯数据,用 `vec(x, y)` 工厂转一下,避免
        // 直接赋值时被 TS 拒绝(也不在 setter 里走 prototype hack)。
        scene.camera.pos = vec(newPos.x, newPos.y);
        // 6) 与上一帧不同则广播(camera.md §3,HudUi 订阅)。
        // 注:EventBus 协议层(见 runtime/EventBus.ts `CameraMovedEvent`)用的是
        // *扁平*字段 `x` / `y` / `viewportWidth` / `viewportHeight`,不是
        // spec §3 写的 `pos` / `viewportSize` 嵌套形式 —— 协议层为准。
        deps.bus.emit({
          type: "camera:moved",
          x: newPos.x,
          y: newPos.y,
          viewportWidth: viewport.x,
          viewportHeight: viewport.y,
        });
      }
    }
  }

  return {
    start() {
      // 帧驱动订阅:每帧 preupdate 调一次 `tick`。
      // 注意:返回的 dispose 是 `onTick` 的 unsubscribe,我们包一层把它
      // 和切关订阅的 dispose 合并成一个总 dispose。
      const unsubscribeTick = deps.runtime.onTick(tick);
      return () => {
        unsubscribeTick();
        unsubscribeMapLoaded();
      };
    },
  };
}
